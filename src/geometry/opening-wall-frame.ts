/**
 * The frames an opening is built in, and the one mapping between them.
 *
 * An opening group stands at its centre on the wall centreline, turned by
 * `rotation.y = angleY` with `angleY = atan2(tangent.z, tangent.x)`. A turn
 * about `Y` sends local `+x` to `(cos, -sin)`, so the group's local `x` is the
 * wall's tangent MIRRORED in `z`: it is the wall line only on a wall that runs
 * along an axis. Two frames therefore exist inside a group:
 *
 *  - the GROUP frame, where a plan point lands through `toLocal` (the exact
 *    inverse of the group's transform). The chorded parts of an arc are placed
 *    this way, each with the `localRotation` of its own chord;
 *  - the WALL frame, `x` along the wall line and `z` across it, which is how
 *    every flat part (jamb, head, rail, pane, bar, leaf, track, pick box, sill
 *    board) is measured out. It is the group frame turned by
 *    `WallFrame.angle`; a part is mapped into the group by `onWall` (its
 *    position and its turn), a pick box by `fromWall` plus that turn, never
 *    placed at a raw group-frame `x`.
 *
 * The wall frame's turn is `localRotation` of the tangent, `-2 * angleY`, taken
 * modulo a half turn into `[-π/2, π/2)`: its `x` may run either way along the
 * wall (a leaf reads its hinge end out of the frame, never assumes it), and on
 * an axis-aligned wall the turn is exactly zero, so such a wall builds the same
 * numbers it always has.
 */

import type * as THREE from 'three';
import type { ArcDef } from '../plan/plan-geometry.js';
import type { Vec2 } from '../scene/types.js';

/** Where an opening sits on its wall centreline. */
export type OpeningPlacement = {
  point: Vec2;
  angleY: number;
  /** Normal of the room-owning side of the wall. */
  normal: Vec2;
  sill: number;
  head: number;
  /** Centreline arc of the wall; absent on a straight wall. */
  arc?: ArcDef | undefined;
  /** Opening span along the arc, arc length from node `a`. */
  t0?: number | undefined;
  t1?: number | undefined;
  /** `+1` when the room lies OUTSIDE the arc circle, `-1` when inside. */
  interiorOutward?: 1 | -1 | undefined;
};

/** The wall frame of one opening: its turn inside the group, with that turn's cosine and sine. */
export type WallFrame = { readonly angle: number; readonly cos: number; readonly sin: number };

/**
 * A plan point on the wall, expressed in the opening group's local frame.
 * The group is a rotation about `Y` by `placement.angleY` at
 * `placement.point`, so the inverse is that rotation transposed.
 */
export function toLocal(placement: OpeningPlacement, p: Vec2): Vec2 {
  const cos = Math.cos(placement.angleY);
  const sin = Math.sin(placement.angleY);
  const dx = p.x - placement.point.x;
  const dz = p.z - placement.point.z;
  return { x: cos * dx - sin * dz, z: sin * dx + cos * dz };
}

/** A plan DIRECTION expressed in the opening group's local frame. */
export function toLocalVector(placement: OpeningPlacement, v: Vec2): Vec2 {
  const cos = Math.cos(placement.angleY);
  const sin = Math.sin(placement.angleY);
  return { x: cos * v.x - sin * v.z, z: sin * v.x + cos * v.z };
}

/**
 * `rotation.y` a child of the group needs so that its own `+x` points along
 * the plan direction `d`. A `rotation.y` of `phi` sends `+x` to
 * `(cos phi, -sin phi)` in `(x, z)`, hence the negated `z`.
 */
export function localRotation(placement: OpeningPlacement, d: Vec2): number {
  return Math.atan2(-d.z, d.x) - placement.angleY;
}

/** The wall frame of an opening (see the header for why its turn is what it is). */
export function wallFrame(placement: OpeningPlacement): WallFrame {
  const turn = -2 * placement.angleY;
  const angle = turn - Math.PI * Math.round(turn / Math.PI);
  return { angle, cos: Math.cos(angle), sin: Math.sin(angle) };
}

/** A wall-frame point (`x` along the wall line, `z` across it) in the group frame. */
export function fromWall(frame: WallFrame, x: number, z: number): Vec2 {
  return { x: frame.cos * x + frame.sin * z, z: -frame.sin * x + frame.cos * z };
}

/** A group-frame vector in the wall frame: the wall frame's turn undone. */
function groupToWall(frame: WallFrame, v: Vec2): Vec2 {
  return { x: frame.cos * v.x - frame.sin * v.z, z: frame.sin * v.x + frame.cos * v.z };
}

/** A plan point in the wall frame. */
export function toWall(placement: OpeningPlacement, frame: WallFrame, p: Vec2): Vec2 {
  return groupToWall(frame, toLocal(placement, p));
}

/** A plan DIRECTION in the wall frame. */
export function toWallVector(placement: OpeningPlacement, frame: WallFrame, v: Vec2): Vec2 {
  return groupToWall(frame, toLocalVector(placement, v));
}

/**
 * Puts a part measured out in the wall frame into the group: its position
 * mapped by `fromWall`, the frame's turn added to its own.
 */
export function onWall<T extends THREE.Object3D>(frame: WallFrame, part: T): T {
  const at = fromWall(frame, part.position.x, part.position.z);
  part.position.x = at.x;
  part.position.z = at.z;
  part.rotation.y += frame.angle;
  return part;
}
