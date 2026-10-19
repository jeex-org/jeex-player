/**
 * Where a door leaf is hinged, which way it opens and what it sweeps.
 *
 * One authority for both consumers: `opening-builder.ts` places the rendered
 * leaf from it and `layout-lint.ts` checks the same rectangle against walls and
 * furniture, so what the linter clears is exactly what the viewer draws.
 *
 * It lives in `plan/`: it is trigonometry over the solved plan and the
 * document, and nothing about doors as OBJECTS. While it sat in `doors/` — four
 * layers up — the plan drawing, the layout linter and the opening builder all
 * had to reach up to ask where a leaf swings (five known layer violations).
 *
 * Invariants:
 * - the resting leaf never turns past `LEAF_REST_ANGLE_RAD` (90 degrees), so it
 *   can never reach the wall plane of the wall that meets this one at the jamb;
 * - an omitted `hinge` falls on the jamb FARTHER from its wall end, i.e. away
 *   from the perpendicular wall that lands there;
 * - an omitted `swing` opens into the room with the free run: the only room of
 *   an exterior wall, else the larger of the two rooms the wall separates.
 *
 * Pure module: no `three`, no DOM.
 */

import {
  EPS,
  arcFromChord,
  arcLength,
  arcPointAt,
  arcTangent,
  dist,
  dot,
  leftN,
  mul,
  norm,
  signedArea,
  spanQuad,
  sub,
} from './plan-geometry.js';
import type { SolvedPlan } from './plan-solver.js';
import type { Opening, SceneData, Vec2, Wall } from '../scene/types.js';

/** Rest angle of an open leaf, radians: a quarter turn, never more (rule 4). */
export const LEAF_REST_ANGLE_RAD = Math.PI / 2;
/** Door leaf thickness in metres; the builder uses the same figure. */
export const LEAF_THICKNESS_M = 0.045;
/** Angular samples taken across the swept sector when it is tested for clearance. */
const SWEEP_STEPS = 9;

export type DoorSwing = {
  openingId: string;
  wallId: string;
  /** Jamb the leaf hangs on, named by the wall node it is nearer to. */
  hinge: 'a' | 'b';
  /** `'in'` towards the wall's interior side, `'out'` towards the other one. */
  swing: 'in' | 'out';
  /** Opening centre on the wall centreline. */
  centre: Vec2;
  /** Unit tangent at the opening, from node `a` towards node `b`. */
  tangent: Vec2;
  /** Hinge point on the wall centreline. */
  pivot: Vec2;
  /** Unit direction from the hinge towards the other jamb (the closed leaf). */
  closed: Vec2;
  /** Unit normal the leaf swings towards. */
  open: Vec2;
  /** Clear leaf length in metres (opening width minus the two frame rebates). */
  leaf: number;
  /** Room the leaf swings into; `null` when that side is outside the plan. */
  roomId: string | null;
};

/** Centreline run of a wall: its endpoints, its true length and its arc. */
function wallRun(scene: SceneData, wall: Wall): { a: Vec2; b: Vec2; length: number; arc?: ReturnType<typeof arcFromChord> } {
  const a = scene.nodes.find((node) => node.id === wall.a)!.p;
  const b = scene.nodes.find((node) => node.id === wall.b)!.p;
  if (!wall.arc) return { a, b, length: dist(a, b) };
  const arc = arcFromChord(a, b, wall.arc.radius, wall.arc.ccw);
  return { a, b, length: arcLength(arc), arc };
}

/** Point and unit tangent at a travel distance along a wall centreline. */
export function pointAt(scene: SceneData, wall: Wall, t: number): { point: Vec2; tangent: Vec2 } {
  const run = wallRun(scene, wall);
  if (!run.arc) {
    const direction = norm(sub(run.b, run.a));
    return { point: { x: run.a.x + direction.x * t, z: run.a.z + direction.z * t }, tangent: direction };
  }
  const angle = run.arc.a0 + run.arc.sweep * (run.length > EPS ? t / run.length : 0);
  return { point: arcPointAt(run.arc, angle), tangent: arcTangent(run.arc, angle) };
}

/**
 * The wall's INTERIOR side: the side the solved plan gives a room to, and the
 * left of `a -> b` when the wall separates two rooms. `swing: 'in'` names it.
 */
export function interiorSideOf(plan: SolvedPlan, wallId: string, tangent: Vec2): { normal: Vec2; roomId: string | null } {
  const faces = [...plan.faces.values()].filter((face) => face.wallId === wallId);
  const rooms = faces.filter((face) => face.roomId !== null);
  if (rooms.length === 1) return { normal: rooms[0]!.normal, roomId: rooms[0]!.roomId };
  const left = leftN(tangent);
  const onLeft = rooms.find((face) => dot(face.normal, left) > 0);
  if (onLeft) return { normal: onLeft.normal, roomId: onLeft.roomId };
  return { normal: left, roomId: null };
}

/** Room on the side `normal` points at, `null` when that side is the facade. */
function roomOnSide(plan: SolvedPlan, wallId: string, normal: Vec2): string | null {
  for (const face of plan.faces.values()) {
    if (face.wallId !== wallId) continue;
    if (dot(face.normal, normal) > 0.5) return face.roomId;
  }
  return null;
}

function roomArea(plan: SolvedPlan, roomId: string | null): number {
  if (!roomId) return 0;
  const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
  return room ? Math.abs(signedArea(room.polygon)) : 0;
}

/**
 * Frame rebate the builder eats on each jamb, in metres, so the linter's leaf
 * is the built one.
 *
 * HANDED IN rather than looked up: the number comes from the opening VARIANT
 * bank, which lives in `assets/` — four layers above this one. Passing it keeps
 * the trigonometry at the bottom of the order where its three consumers can all
 * reach it, and it is what `assets/opening-frame.openingFrameWidth` answers.
 */
export type FrameWidthOf = (opening: Opening) => number;

/**
 * Hinge, swing side and leaf geometry of one door, honouring whatever the
 * opening authored and filling the rest in from the plan.
 */
export function resolveDoorSwing(scene: SceneData, plan: SolvedPlan, wall: Wall, opening: Opening, frameWidthOf: FrameWidthOf): DoorSwing {
  const half = opening.width / 2;
  const { point: centre, tangent } = pointAt(scene, wall, opening.center);
  const interior = interiorSideOf(plan, wall.id, tangent);

  const outward = mul(interior.normal, -1);
  const outerRoom = roomOnSide(plan, wall.id, outward);
  const swing: 'in' | 'out' =
    opening.swing ??
    (interior.roomId === null ? 'out' : outerRoom === null || roomArea(plan, interior.roomId) >= roomArea(plan, outerRoom) ? 'in' : 'out');
  const open = swing === 'in' ? interior.normal : outward;
  const roomId = swing === 'in' ? interior.roomId : outerRoom;

  const run = wallRun(scene, wall);
  const gapA = opening.center - half;
  const gapB = run.length - (opening.center + half);
  const hinge: 'a' | 'b' = opening.hinge ?? (gapA >= gapB ? 'a' : 'b');

  const frame = Math.min(frameWidthOf(opening), opening.width / 4);
  const jambT = hinge === 'a' ? opening.center - half + frame : opening.center + half - frame;
  const { point: pivot } = pointAt(scene, wall, jambT);
  const closed = hinge === 'a' ? tangent : mul(tangent, -1);
  return {
    openingId: opening.id,
    wallId: wall.id,
    hinge,
    swing,
    centre,
    tangent,
    pivot,
    closed,
    open,
    leaf: Math.max(0, opening.width - 2 * frame),
    roomId,
  };
}

/** Rectangle the leaf occupies at `angle` radians from the closed position. */
export function doorLeafQuad(swing: DoorSwing, angle: number, thickness = LEAF_THICKNESS_M): Vec2[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const direction = norm({
    x: swing.closed.x * cos + swing.open.x * sin,
    z: swing.closed.z * cos + swing.open.z * sin,
  });
  return spanQuad(swing.pivot, direction, [0, swing.leaf], [-thickness / 2, thickness / 2]);
}

/** The swept sector, sampled from closed to the rest angle as leaf rectangles. */
export function doorSweepQuads(swing: DoorSwing, steps = SWEEP_STEPS): Vec2[][] {
  const quads: Vec2[][] = [];
  for (let i = 0; i <= steps; i += 1) quads.push(doorLeafQuad(swing, (LEAF_REST_ANGLE_RAD * i) / steps));
  return quads;
}

/** Every door of the scene with its resolved swing, in authoring order. */
export function doorSwings(scene: SceneData, plan: SolvedPlan, frameWidthOf: FrameWidthOf): DoorSwing[] {
  const out: DoorSwing[] = [];
  for (const wall of scene.walls) {
    for (const opening of wall.openings ?? []) {
      if (opening.type !== 'door') continue;
      out.push(resolveDoorSwing(scene, plan, wall, opening, frameWidthOf));
    }
  }
  return out;
}
