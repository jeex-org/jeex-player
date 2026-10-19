/**
 * Floor outlines: a room polygon extended with one rectangular notch per
 * door-like opening on its own wall faces, so a floor runs THROUGH every
 * doorway instead of stopping at the inner face.
 *
 * Invariant: a notch is as
 * wide as its opening measured along the wall, and as deep as
 * - `thickness / 2` — to the wall CENTRELINE — when the other side of the wall
 *   is another room (a loggia counts), so the two floors meet edge to edge with
 *   no overlap and no strip of site slab between them;
 * - `thickness` — to the FAR FACE — when the other side is outside, so the
 *   entrance floor reaches the exterior plane and nothing shows underneath.
 *
 * The notch is spliced into the outline, not added as a separate mesh: one mesh
 * per room keeps painting, picking, `navigable` and the skirting spans exactly
 * as they were, and the world-metre UVs carry the finish across the notch.
 *
 * Curved walls use the CHORD between the two jamb points: the intermediate arc
 * vertices inside the opening are dropped, which is also what the frame does.
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, add, dist, leftN, mul, norm, sub } from './plan-geometry.js';
import { clamp } from '../shared/math.js';
import type { SolvedPlan, WallFace } from './plan-solver.js';

import type { SceneData, Vec2 } from '../scene/types.js';
import { faceKey, isDoorLike } from '../scene/types.js';

/** One doorway notch of a room floor, in plan coordinates. */
export type FloorNotch = {
  openingId: string;
  /**
   * Four points, positively oriented and in outline order: the two jamb points
   * on the room's inner face first and last, the two on the far edge between
   * them.
   */
  quad: Vec2[];
};

/** A notch resolved onto one face: `t` range on the face, depth into the wall. */
type FaceNotch = { openingId: string; t0: number; t1: number; depth: number };

/**
 * How deep the notch on `face` cuts into its wall, metres. The far side is the
 * facade exactly when the wall's other side has no room, and only then does the
 * floor run the whole thickness.
 */
function notchDepth(plan: SolvedPlan, face: WallFace, thickness: number): number {
  const other = face.side === 'L' ? 'R' : 'L';
  const outside = plan.faces.has(faceKey(null, face.wallId, other));
  return outside ? thickness : thickness / 2;
}

/** Door-like openings of `face`, clipped to it and ordered along it. */
function notchesOfFace(plan: SolvedPlan, scene: SceneData, face: WallFace): FaceNotch[] {
  const wall = scene.walls.find((candidate) => candidate.id === face.wallId);
  if (!wall) return [];
  const depth = notchDepth(plan, face, wall.thickness);
  const out: FaceNotch[] = [];
  let cursor = 0;
  const doors = face.openings.filter((opening) => isDoorLike(opening.type)).sort((a, b) => a.t0 - b.t0);
  for (const door of doors) {
    const t0 = Math.max(cursor, door.t0);
    const t1 = Math.min(face.length, door.t1);
    if (t1 - t0 <= EPS) continue;
    out.push({ openingId: door.id, t0, t1, depth });
    cursor = t1;
  }
  return out;
}

/** Cumulative arc length at each vertex of `polyline`. */
function stations(polyline: readonly Vec2[]): number[] {
  const out = [0];
  for (let i = 0; i + 1 < polyline.length; i += 1) out.push(out[i]! + dist(polyline[i]!, polyline[i + 1]!));
  return out;
}

/**
 * Point of a face polyline at arc length `t`, with the unit normal pointing
 * INTO the room there. `leftN` of the travel direction is the face's own side,
 * arcs included, so the notch is dug along its negation.
 */
function sampleFace(face: WallFace, t: number): { point: Vec2; inward: Vec2 } {
  const line = face.polyline;
  const marks = stations(line);
  for (let i = 0; i + 1 < line.length; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const step = marks[i + 1]! - marks[i]!;
    if (step <= EPS) continue;
    if (t <= marks[i + 1]! + EPS || i + 2 === line.length) {
      const tangent = norm(sub(b, a));
      return { point: add(a, mul(tangent, clamp(t - marks[i]!, 0, step))), inward: leftN(tangent) };
    }
  }
  const last = line.at(-1) ?? { x: 0, z: 0 };
  return { point: { x: last.x, z: last.z }, inward: { x: 0, z: 0 } };
}

/** The four corners of one face notch, in outline order. */
function notchQuad(face: WallFace, notch: FaceNotch): Vec2[] {
  const a = sampleFace(face, notch.t0);
  const b = sampleFace(face, notch.t1);
  return [a.point, sub(a.point, mul(a.inward, notch.depth)), sub(b.point, mul(b.inward, notch.depth)), b.point];
}

/**
 * The notch rectangles of a room on their own, for tests and the 2D plan
 * drawing. Empty for an unknown room.
 */
export function floorNotches(plan: SolvedPlan, scene: SceneData, roomId: string): FloorNotch[] {
  const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
  if (!room) return [];
  const out: FloorNotch[] = [];
  for (const face of room.loop) {
    for (const notch of notchesOfFace(plan, scene, face)) {
      out.push({ openingId: notch.openingId, quad: notchQuad(face, notch) });
    }
  }
  return out;
}

/**
 * The room polygon with one notch per door-like opening on its faces — the
 * outline `ShellBuilder.buildFloors` extrudes. Positively oriented, like the
 * solver polygon it extends; empty for an unknown room.
 */
export function floorOutline(plan: SolvedPlan, scene: SceneData, roomId: string): Vec2[] {
  const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
  if (!room) return [];
  // A room solved from its source's own outline bounds no wall side, so there
  // are no faces to walk and no doorway to notch: its slab is that outline.
  if (room.loop.length === 0) return room.polygon.map((point) => ({ x: point.x, z: point.z }));

  const outline: Vec2[] = [];
  const push = (point: Vec2): void => {
    const previous = outline.at(-1);
    if (previous && dist(previous, point) <= EPS) return;
    outline.push({ x: point.x, z: point.z });
  };

  for (const face of room.loop) {
    const line = face.polyline;
    const marks = stations(line);
    let vertex = 0;
    for (const notch of notchesOfFace(plan, scene, face)) {
      while (vertex < line.length && marks[vertex]! <= notch.t0 + EPS) {
        push(line[vertex]!);
        vertex += 1;
      }
      for (const corner of notchQuad(face, notch)) push(corner);
      while (vertex < line.length && marks[vertex]! < notch.t1 - EPS) vertex += 1;
    }
    while (vertex < line.length) {
      push(line[vertex]!);
      vertex += 1;
    }
  }

  while (outline.length > 1 && dist(outline[0]!, outline.at(-1)!) <= EPS) outline.pop();
  return outline;
}
