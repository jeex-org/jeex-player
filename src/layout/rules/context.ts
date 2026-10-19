/**
 * What every layout rule is handed, and the plan geometry more than one of
 * them needs.
 *
 * A rule is `{ id, severity, run(ctx, out) }` and nothing else: it reads the
 * prepared context and appends issues. `layout-lint.ts` builds the context
 * once and dispatches over `LAYOUT_RULES`, so adding a rule is adding a file
 * and one line to the table — never another hand-written call in a growing
 * chain.
 *
 * Everything here reasons about convex quads in plan: a footprint OBB from the
 * object bank, a wall slab with its door voids cut out, a door clear zone, a
 * door leaf from `door-swing.ts`.
 *
 * Pure module: no `three`, no DOM.
 */

import { dot, leftN, mul, sub } from '../../plan/plan-geometry.js';
import { spanQuad, type Obb } from '../../plan/plan-geometry.js';
import { projectOnPolyline } from '../../plan/plan-geometry.js';
import type { DoorSwing } from '../../plan/door-swing.js';
import type { AssetLayout, SurfaceFacts } from '../../assets/asset-types.js';
import type { SolvedPlan, WallFace } from '../../plan/plan-solver.js';
import type { DemoAsset, SceneData, Vec2, Wall } from '../../scene/types.js';
import type { LayoutIssue, LayoutRule } from '../layout-issue.js';

/* ------------------------------------------------------------- tunables --- */

/** Penetration deeper than this counts as an intersection, metres. */
export const TOUCH_TOL_M = 0.02;
/** Depth of the clear zone in front of a door, metres (rule 3). */
export const DOOR_CLEAR_M = 0.9;
/** Fraction of the opening width the clear zone spans (rule 3). */
export const DOOR_CLEAR_SPAN = 0.9;

/* ---------------------------------------------------------------- model --- */

/*
 * The issue vocabulary (`LayoutRule`, `LAYOUT_RULE_IDS`, `layoutRuleOrder`,
 * `LayoutIssue`) lives one layer down in `layout/layout-issue.ts` so that
 * `SceneModel.apply` can report issues without importing the linter that
 * computes them (`.dependency-cruiser.cjs`, layer `layout/issue`). It is
 * re-exported here unchanged: every rule module already asks this file for it.
 */
export { LAYOUT_RULE_IDS, layoutRuleOrder } from '../layout-issue.js';
export type { LayoutIssue, LayoutRule } from '../layout-issue.js';

/** One placement, resolved against the object bank and reduced to plan geometry. */
export type LintItem = {
  placement: DemoAsset;
  archetype: string;
  anchor: 'floor' | 'wall' | 'ceiling';
  /** `[width, height, depth]` after the placement scale, metres. */
  dims: [number, number, number];
  /** Mounted height of the group, metres. */
  y: number;
  /** Yaw of the footprint box, radians (the placement's own rotation). */
  angle: number;
  /** Unit direction the front looks along, after the legacy yaw compensation. */
  front: Vec2;
  box: Obb | null;
  quad: Vec2[] | null;
  roomId: string | null;
  /** The archetype's own layout facts, straight from the catalogue entry. */
  layout: AssetLayout | undefined;
  /**
   * The body of a wall- or ceiling-mounted item: its plan quad and the height
   * band it fills, `null` for a floor
   * item, which `quad` already describes. Wall items pivot at the centre of
   * their volume, ceiling items at the top of their body.
   */
  mount: { quad: Vec2[]; low: number; high: number } | null;
  /** Surfaces and tucking (`surfaces.ts`) at this placement's size; `{}` for none. */
  surfaces: SurfaceFacts;
};

/** One run of wall body, with the doorways cut out of it. */
export type Solid = { wallId: string; quad: Vec2[] };

/** A door or passage, with the sides that own a room and the leaf it swings. */
export type DoorZone = {
  wall: Wall;
  openingId: string;
  type: 'door' | 'passage';
  centre: Vec2;
  tangent: Vec2;
  width: number;
  thickness: number;
  /** One entry per side that owns a room. */
  sides: Array<{ roomId: string; normal: Vec2 }>;
  swing: DoorSwing | null;
};

export type LintContext = {
  items: LintItem[];
  solids: Solid[];
  doors: DoorZone[];
  plan: SolvedPlan;
  scene: SceneData;
};

export type LayoutRuleModule = {
  id: LayoutRule;
  severity: 'error' | 'warning';
  run(ctx: LintContext, out: LayoutIssue[]): void;
  /**
   * The issues of this rule that involve ONE item, judged against the rest of
   * `ctx` (which may or may not carry the item itself; an item never meets
   * itself). What `layout/asset-legality.ts` asks while an object is dragged.
   * A rule without it is room-wide (circulation) and is judged on commit.
   */
  item?: (ctx: LintContext, item: LintItem, out: LayoutIssue[]) => void;
};

/**
 * Whether two plan polygons' bounding boxes are further apart than `pad`: the
 * cheap test in front of a separating-axis one. A `true` is proof they do not
 * overlap; a `false` proves nothing. Allocation-free: a drag's mask calls it
 * hundreds of thousands of times.
 */
export function apart(a: readonly Vec2[], b: readonly Vec2[], pad = 0): boolean {
  let aMinX = Infinity;
  let aMaxX = -Infinity;
  let aMinZ = Infinity;
  let aMaxZ = -Infinity;
  for (const point of a) {
    if (point.x < aMinX) aMinX = point.x;
    if (point.x > aMaxX) aMaxX = point.x;
    if (point.z < aMinZ) aMinZ = point.z;
    if (point.z > aMaxZ) aMaxZ = point.z;
  }
  let bMinX = Infinity;
  let bMaxX = -Infinity;
  let bMinZ = Infinity;
  let bMaxZ = -Infinity;
  for (const point of b) {
    if (point.x < bMinX) bMinX = point.x;
    if (point.x > bMaxX) bMaxX = point.x;
    if (point.z < bMinZ) bMinZ = point.z;
    if (point.z > bMaxZ) bMaxZ = point.z;
  }
  return bMaxX < aMinX - pad || bMinX > aMaxX + pad || bMaxZ < aMinZ - pad || bMinZ > aMaxZ + pad;
}

/* ------------------------------------------------------- shared geometry --- */

/** Rectangle of depth `depth` on the side `normal` points at, spanning `span` metres. */
export function sideZone(door: DoorZone, normal: Vec2, span: number, depth: number): Vec2[] {
  const sign = dot(normal, leftN(door.tangent)) > 0 ? 1 : -1;
  const near = door.thickness / 2;
  const range: [number, number] = sign > 0 ? [near, near + depth] : [-(near + depth), -near];
  return spanQuad(door.centre, door.tangent, [-span / 2, span / 2], range);
}

/** Support radius of an oriented box along `axis` — half its extent in that direction. */
export function support(box: Obb, axis: Vec2): number {
  const ex: Vec2 = { x: Math.cos(box.angle), z: Math.sin(box.angle) };
  const ez: Vec2 = { x: -Math.sin(box.angle), z: Math.cos(box.angle) };
  return Math.abs(box.hx * dot(axis, ex)) + Math.abs(box.hz * dot(axis, ez));
}

/** Gap between two oriented boxes along the line joining their centres, metres. */
export function boxGap(a: Obb, b: Obb): number {
  const delta = sub({ x: b.x, z: b.z }, { x: a.x, z: a.z });
  const span = Math.hypot(delta.x, delta.z);
  if (span < 1e-6) return -Math.min(a.hx, a.hz) - Math.min(b.hx, b.hz);
  const axis = mul(delta, 1 / span);
  return span - support(a, axis) - support(b, axis);
}

/** Distance from a plan point to an oriented box, `0` inside it. */
export function pointToBox(box: Obb, point: Vec2): number {
  const dx = point.x - box.x;
  const dz = point.z - box.z;
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const lx = Math.abs(dx * cos + dz * sin) - box.hx;
  const lz = Math.abs(-dx * sin + dz * cos) - box.hz;
  return Math.hypot(Math.max(0, lx), Math.max(0, lz));
}

/** A wall face in an issue's sentence: its side and the wall it belongs to. */
export function faceLabel(face: WallFace): string {
  return `side ${face.side} of wall ${face.wallId}`;
}

/** Nearest wall face of `roomId` to a plan point, with the perpendicular gap. */
export function nearestFace(plan: SolvedPlan, roomId: string | null, point: Vec2): { face: WallFace; distance: number; t: number } | null {
  let best: { face: WallFace; distance: number; t: number } | null = null;
  for (const face of plan.faces.values()) {
    if (roomId !== null && face.roomId !== roomId) continue;
    const hit = projectOnPolyline(face.polyline, point, face.length);
    if (!hit) continue;
    if (!best || hit.distance < best.distance) best = { face, distance: hit.distance, t: hit.t };
  }
  return best;
}

/** The two ends of an item's width, projected onto the face it sits on. */
export function faceSpan(item: LintItem, face: WallFace, centre: Vec2): [number, number] {
  const right: Vec2 = { x: -item.front.z, z: item.front.x };
  const ends = [
    { x: centre.x + (right.x * item.dims[0]) / 2, z: centre.z + (right.z * item.dims[0]) / 2 },
    { x: centre.x - (right.x * item.dims[0]) / 2, z: centre.z - (right.z * item.dims[0]) / 2 },
  ];
  const ts = ends.map((end) => projectOnPolyline(face.polyline, end, face.length)?.t ?? 0).sort((a, b) => a - b);
  return [ts[0]!, ts[1]!];
}

/** The plan position of a placement. */
export function positionOf(item: LintItem): Vec2 {
  return { x: item.placement.position.x, z: item.placement.position.z };
}

/** The plan centre of an item's footprint box. */
export function boxCentre(box: Obb): Vec2 {
  return { x: box.x, z: box.z };
}
