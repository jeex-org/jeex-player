/**
 * Which triangles of the shell a walk can never see, recorded by the builder
 * that makes them, for the light bake: the shell export writes those
 * triangles apart so the bake gives them no lightmap, and the viewer draws
 * them with live lighting (`lightmap/shell-export.ts`). They are never
 * dropped or hidden: the dollhouse cut can expose some of them.
 *
 * The record is one flag per triangle (1 unseen, 0 seen) in the geometry's
 * triangle order (index order for an indexed geometry), kept beside the
 * geometry rather than in `userData`, which the user-facing glTF export
 * would carry. It describes the geometry object it was recorded for: a clone
 * or a transformed copy has none, and a geometry without a record is all
 * seen.
 *
 * What is unseen is decided from the construction, never from rendered
 * light: a floor slab's bottom and sides (the slab sits in the site slab), a
 * wall prism's back (inside the other face's prism), its bottom on the floor,
 * its caps where another prism of the face or the next wall covers them, a
 * skirting board's back and bottom, a junction core's bottom. Wall and core
 * tops stay seen: they are lit, and the dollhouse shows them.
 */

import { EPS, dist } from '../plan/plan-geometry.js';
import type { SolvedPlan, WallFace } from '../plan/plan-solver.js';
import type { FaceQuad } from '../plan/plan-openings.js';
import type { SceneData, Vec2 } from '../scene/types.js';

/** Minimal geometry identity: anything the record can be kept for. */
type Geometry = object;

const RECORDS = new WeakMap<Geometry, Uint8Array>();

/** Records the unseen flags of `geometry`'s triangles, in its triangle order. */
export function recordUnseen(geometry: Geometry, flags: Uint8Array): void {
  RECORDS.set(geometry, flags);
}

/** The recorded flags of `geometry`'s triangles, or `undefined` when nothing was recorded (all seen). */
export function unseenTriangles(geometry: Geometry): Readonly<Uint8Array> | undefined {
  return RECORDS.get(geometry);
}

/** `count` copies of `flag`. */
export const flagsOf = (count: number, flag: 0 | 1): Uint8Array => new Uint8Array(count).fill(flag);

/** Concatenated flags, in part order. */
export function concatFlags(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The flags of one quad prism (`quadPrism`'s triangle order: front, back,
 * start cap, end cap, bottom, top; two triangles each). `covered` says
 * whether each cap is covered by solid wall.
 */
export function prismFlags(quad: Pick<FaceQuad, 'y0'>, covered: { start: boolean; end: boolean }): Uint8Array {
  const bottom = quad.y0 <= EPS ? 1 : 0;
  return Uint8Array.from([0, 0, 1, 1, +covered.start, +covered.start, +covered.end, +covered.end, bottom, bottom, 0, 0]);
}

/** Skirting box flags (`BoxGeometry` order +x, −x, +y, −y, +z, −z; +z faces the room): bottom and back unseen. */
export const SKIRTING_BOX_FLAGS = Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);

/**
 * Whether the cap of `quad` at `at` (its start or end, `t` in face units)
 * is covered: by another quad of the same face that touches it over its
 * whole height, or, at the face's own end, by the wall that continues there.
 */
export function capCovered(face: WallFace, quad: FaceQuad, at: 'start' | 'end', faceEndCovered: boolean): boolean {
  const t = at === 'start' ? quad.t0 : quad.t1;
  if (at === 'start' ? t <= EPS : t >= face.length - EPS) return faceEndCovered;
  return face.quads.some(
    (other) =>
      other !== quad &&
      Math.abs((at === 'start' ? other.t1 : other.t0) - t) <= EPS &&
      other.y0 <= quad.y0 + EPS &&
      other.y1 >= quad.y1 - EPS,
  );
}

/**
 * Whether each end of `face` meets wall that covers its caps: always at a
 * junction, except where a wall continues collinearly into one of another
 * thickness (a jog), whose step stays exposed.
 */
export function faceEndsCovered(
  face: WallFace,
  scene: Pick<SceneData, 'nodes' | 'walls'>,
  plan: Pick<SolvedPlan, 'centrelines'>,
): { start: boolean; end: boolean } {
  const wall = scene.walls.find((w) => w.id === face.wallId);
  if (!wall) return { start: false, end: false };
  const point = (id: string): Vec2 | undefined => scene.nodes.find((node) => node.id === id)?.p;
  const covered = (end: Vec2): boolean => {
    const a = point(wall.a);
    const b = point(wall.b);
    if (!a || !b) return false;
    const node = dist(end, a) <= dist(end, b) ? wall.a : wall.b;
    const own = leaving(plan, wall, node);
    if (!own) return false;
    return !scene.walls.some((other) => {
      if (other.id === wall.id || (other.a !== node && other.b !== node) || other.thickness === wall.thickness) return false;
      const dir = leaving(plan, other, node);
      return dir !== undefined && dir.x * own.x + dir.z * own.z < -1 + 1e-6;
    });
  };
  return { start: covered(face.polyline[0]!), end: covered(face.polyline.at(-1)!) };
}

/** Unit direction of `wall`'s centreline (node `a` to `b`) leaving `nodeId`. */
function leaving(plan: Pick<SolvedPlan, 'centrelines'>, wall: { id: string; a: string }, nodeId: string): Vec2 | undefined {
  const polyline = plan.centrelines.find((line) => line.wallId === wall.id)?.polyline;
  if (!polyline || polyline.length < 2) return undefined;
  const atA = wall.a === nodeId;
  const [from, to] = atA ? [polyline[0]!, polyline[1]!] : [polyline.at(-1)!, polyline.at(-2)!];
  const length = dist(from, to);
  return length <= EPS ? undefined : { x: (to.x - from.x) / length, z: (to.z - from.z) / length };
}
