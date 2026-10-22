/**
 * Whether ONE object may stand where it is being dragged.
 *
 * The rules are the linter's (`layout/rules/`), never a second copy: every
 * hard rule exposes an `item` check, and `judge` asks exactly those against a
 * `LintContext` that holds the REST of the scene, built once per drag
 * (`dragContext`). The scene does not change under a drag, so the door zones,
 * window bands and wall slabs are the same for every frame and every mask
 * cell. Circulation is the one hard rule without an item check: it floods a
 * whole room, so it is judged on commit (`SceneModel.apply({ lint:
 * 'strict-new' })`), not per frame.
 *
 * What a drag MAKES of a pointer (wall snap, rising onto a top, the settle)
 * is `asset-pose.ts`; the field of legal places is `asset-mask.ts`. Both judge
 * through `poseItem`, which builds the object the way the linter does
 * (`lintItemOf`), so every fact of the placement (its scale, its mirror) is
 * read in one place.
 *
 * Pure module: no `three`, no DOM.
 */

import { leftN, norm, projectOnPolyline, sub } from '../plan/plan-geometry.js';
import { nearestFace } from './rules/context.js';
import { lintContext, lintItemOf, shippedFacts, type LayoutCatalogue, type LayoutFacts } from './layout-lint.js';
import { LAYOUT_RULES } from './rules/index.js';
import { standsOn } from './rules/surfaces.js';
import type { LayoutIssue, LintContext, LintItem } from './rules/context.js';
import type { SolvedPlan, WallFace } from '../plan/plan-solver.js';
import type { Bounds } from '../plan/plan-geometry.js';
import type { DemoAsset, SceneData, Vec2 } from '../scene/types.js';

/** The hard rules that can judge one item on its own, in report order. */
const ITEM_RULES = LAYOUT_RULES.filter((rule) => rule.severity === 'error' && rule.item !== undefined);

/** A pose a drag proposes: the placement's position and yaw. */
export type DragPose = { readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly rotationY: number };

/** An object standing on the dragged host's top at drag start: it moves and turns with the host. */
export type Carried = { readonly placement: DemoAsset };

/** Everything a drag judges against, prepared once when it starts. */
export type DragContext = {
  /** The scene WITHOUT the dragged object and what it carries, as the rules read it. */
  readonly ctx: LintContext;
  /** The dragged placement as committed. */
  readonly placement: DemoAsset;
  readonly facts: LayoutFacts;
  /** What stands on its top at drag start; empty for anything else. */
  readonly carried: readonly Carried[];
  /**
   * Set by `narrowDrag`: `ctx` holds only what can touch a body inside `box`,
   * and `whole` is the context it was cut from, for a pose that leaves the box
   * (a wall snap can turn and shift a pose further than any fixed slack).
   */
  readonly narrowed?: { readonly box: Bounds; readonly whole: LintContext } | undefined;
};

export type Judgement = { readonly ok: boolean; readonly issues: readonly LayoutIssue[] };

/**
 * The drag context for `assetId`, or `null` when the scene does not carry it
 * or the bank does not know it. Whatever stands on its top now is carried
 * and leaves the context with it: it is not an obstacle to its host.
 */
export function dragContext(
  scene: SceneData,
  plan: SolvedPlan,
  assetId: string,
  catalogue: LayoutCatalogue = shippedFacts,
): DragContext | null {
  const placement = scene.assets.find((asset) => asset.id === assetId);
  if (!placement) return null;
  const facts = catalogue(placement);
  if (!facts) return null;
  const full = lintContext(scene, plan, catalogue);
  const host = full.items.find((item) => item.placement.id === assetId);
  const carried = host?.surfaces.top ? full.items.filter((item) => standsOn(item, host)) : [];
  const gone = new Set([assetId, ...carried.map((item) => item.placement.id)]);
  const ctx: LintContext = { ...full, items: full.items.filter((item) => !gone.has(item.placement.id)) };
  return { ctx, placement, facts, carried: carried.map((item) => ({ placement: item.placement })) };
}

/** The dragged object at `pose`, as the rules read it. */
export function poseItem(drag: DragContext, pose: DragPose): LintItem {
  const placement: DemoAsset = { ...drag.placement, position: { ...pose.position }, rotationY: pose.rotationY };
  return lintItemOf(placement, drag.facts, drag.ctx.plan, drag.ctx.scene.ceilingHeight);
}

/** The cheap, often failing rules first: `fits` stops at the first issue, so the order is its cost. */
const QUICK_ORDER: readonly string[] = ['on-floor', 'height-fit', 'ceiling-hung', 'wall-facing', 'inside-a-wall', 'no-interpenetration'];
const QUICK_RULES = [...ITEM_RULES].sort((a, b) => quickRank(a.id) - quickRank(b.id));

function quickRank(id: string): number {
  const rank = QUICK_ORDER.indexOf(id);
  return rank === -1 ? QUICK_ORDER.length : rank;
}

/**
 * Whether `item` raises no hard issue, stopping at the first rule that
 * raises one: the same verdict as `judge(ctx, item).ok` for a fraction of the
 * cost when it is illegal, which is what most cells of a field are.
 */
export function fits(ctx: LintContext, item: LintItem): boolean {
  return misfit(ctx, item) === null;
}

/** The first hard issue `item` raises, in `fits`'s order, or `null` when it raises none. */
export function misfit(ctx: LintContext, item: LintItem): LayoutIssue | null {
  const issues: LayoutIssue[] = [];
  for (const rule of QUICK_RULES) {
    rule.item!(ctx, item, issues);
    if (issues.length > 0) return issues[0]!;
  }
  return null;
}

/**
 * Every hard issue `item` raises against the rest of the scene in `ctx`
 * (circulation aside, see the header). `ok` is the absence of any.
 */
export function judge(ctx: LintContext, item: LintItem): Judgement {
  const issues: LayoutIssue[] = [];
  for (const rule of ITEM_RULES) rule.item!(ctx, item, issues);
  return { ok: issues.length === 0, issues };
}

/* -------------------------------------------------------------- narrow --- */

/** How far a door's clear zone and leaf reach beyond its width, metres (generous). */
const DOOR_REACH_M = 1.2;

/** Whether a plan polygon reaches into the box `[minX, maxX] × [minZ, maxZ]`. */
function reaches(poly: readonly Vec2[], box: Bounds): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of poly) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return !(maxX < box.minX || minX > box.maxX || maxZ < box.minZ || minZ > box.maxZ);
}

/**
 * The context reduced to what can touch an object inside `box`: the items,
 * wall slabs and doors near it. A mask judges thousands of cells of one room
 * against the same few neighbours, and a settle hundreds of poses around one
 * point, so each narrows once. Doors are kept whole when any of their zones
 * could reach (their zones are cached per door list, so a narrowed list builds
 * its own once).
 */
export function narrowContext(ctx: LintContext, box: Bounds): LintContext {
  const items = ctx.items.filter((other) => {
    const body = other.quad ?? other.mount?.quad;
    return body !== undefined && reaches(body, box);
  });
  const solids = ctx.solids.filter((solid) => reaches(solid.quad, box));
  const doors = ctx.doors.filter(
    (door) =>
      Math.abs(door.centre.x - (box.minX + box.maxX) / 2) <= (box.maxX - box.minX) / 2 + door.width + DOOR_REACH_M &&
      Math.abs(door.centre.z - (box.minZ + box.maxZ) / 2) <= (box.maxZ - box.minZ) / 2 + door.width + DOOR_REACH_M,
  );
  return { ...ctx, items, solids, doors };
}

/** `drag` judged against only what can touch a body inside `box`; the context it was cut from stays reachable. */
export function narrowDrag(drag: DragContext, box: Bounds): DragContext {
  return { ...drag, ctx: narrowContext(drag.ctx, box), narrowed: { box, whole: drag.narrowed?.whole ?? drag.ctx } };
}

/** The box `radius` metres round `centre`. */
export function boxAround(centre: Vec2, radius: number): Bounds {
  return { minX: centre.x - radius, maxX: centre.x + radius, minZ: centre.z - radius, maxZ: centre.z + radius };
}

/* ----------------------------------------------------------- wall poses --- */

/** The plan point `t` metres along a face, and the face's inward normal there. */
export function faceFrame(face: WallFace, t: number): { point: Vec2; normal: Vec2 } {
  const points = face.polyline;
  let chord = 0;
  for (let i = 0; i + 1 < points.length; i += 1) chord += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z);
  const target = face.length > 0 ? (Math.min(Math.max(t, 0), face.length) * chord) / face.length : 0;
  let travelled = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (travelled + segment >= target || i + 2 === points.length) {
      const k = segment > 0 ? Math.min(1, Math.max(0, (target - travelled) / segment)) : 0;
      const along = norm(sub(b, a));
      let normal = leftN(along);
      if (normal.x * face.normal.x + normal.z * face.normal.z < 0) normal = { x: -normal.x, z: -normal.z };
      return { point: { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }, normal };
    }
    travelled += segment;
  }
  return { point: points[0] ?? { x: 0, z: 0 }, normal: face.normal };
}

/** The yaw whose front looks along `normal` (`free-space.ts` reads it the same way). */
export function yawFacing(normal: Vec2): number {
  return Math.atan2(-normal.x, -normal.z);
}

/**
 * `t` clamped so the object's width stays on `face`: it stops at the ends of
 * its face rather than wrapping round a corner (the middle when the face is
 * narrower than the object).
 */
export function wallAlong(drag: DragContext, face: WallFace, t: number): number {
  const width = drag.facts.dims[0] * Math.abs(drag.placement.scale ?? 1);
  return face.length <= width ? face.length / 2 : Math.min(face.length - width / 2, Math.max(width / 2, t));
}

/**
 * A wall item hung on `face` at `t` metres along it (clamped so its width
 * stays on the face), its centre `y` above the floor: back flat on the face,
 * front into the room.
 */
export function wallPose(drag: DragContext, face: WallFace, t: number, y: number): DragPose {
  const scale = Math.abs(drag.placement.scale ?? 1);
  const { point, normal } = faceFrame(face, wallAlong(drag, face, t));
  const half = (drag.facts.dims[2] * scale) / 2;
  return {
    position: { x: point.x + normal.x * half, y, z: point.z + normal.z * half },
    rotationY: yawFacing(normal) - drag.facts.yaw,
  };
}

/** The rooms a wall item may slide into from `roomId`: its own and every room a doorway joins to it. */
export function reachableRooms(ctx: LintContext, roomId: string | null): Set<string> {
  const rooms = new Set<string>();
  if (roomId === null) return rooms;
  rooms.add(roomId);
  for (const door of ctx.doors) {
    if (!door.sides.some((side) => side.roomId === roomId)) continue;
    for (const side of door.sides) rooms.add(side.roomId);
  }
  return rooms;
}

/** The face a wall pose hangs on, and where along it. */
export function faceOf(drag: DragContext, pose: DragPose): { face: WallFace; t: number } | null {
  const item = poseItem(drag, pose);
  const near = nearestFace(drag.ctx.plan, item.roomId, { x: pose.position.x, z: pose.position.z });
  return near ? { face: near.face, t: near.t } : null;
}

/** The nearest face a wall object in `roomId` may slide onto (its room and the rooms a doorway joins), and where along it. */
export function nearestReachableFace(drag: DragContext, roomId: string | null, point: Vec2): { face: WallFace; t: number } | null {
  const rooms = reachableRooms(drag.ctx, roomId);
  let best: { face: WallFace; t: number; distance: number } | null = null;
  for (const face of drag.ctx.plan.faces.values()) {
    if (face.roomId === null || !rooms.has(face.roomId)) continue;
    const hit = projectOnPolyline(face.polyline, point, face.length);
    if (hit && (!best || hit.distance < best.distance)) best = { face, t: hit.t, distance: hit.distance };
  }
  return best ? { face: best.face, t: best.t } : null;
}
