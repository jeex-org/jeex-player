/**
 * Which door a point of the 2D plan lands on: the leaf line or the swing
 * sector `plan-drawing.ts` draws for it. In `plan2d` a click is answered by
 * this before the 3D pick, because that pick is cast from straight above and
 * lands on the floor (or the furniture) under the drawn symbol, never on the
 * door.
 *
 * Invariants (see `door-symbol-hit.test.ts`):
 * - a point inside a quarter sector or within half a leaf's thickness of a
 *   leaf line names that door; anything else names none;
 * - where symbols overlap, the door whose centre is nearer the point wins;
 * - the answer is read off the drawing's own primitives, so what is hit is
 *   exactly what is painted, a double door's two leaves included.
 *
 * Pure module: no `three`, no DOM.
 */

import { LEAF_THICKNESS_M } from './door-swing.js';
import { dist, dot, sub } from './plan-geometry.js';
import type { PlanDrawing, PlanPrimitive } from './plan-drawing.js';
import type { Vec2 } from '../scene/types.js';

/** The door under a point: its opening and the wall it hangs on. */
export type DoorSymbolHit = { readonly openingId: string; readonly wallId: string };

type Leaf = Extract<PlanPrimitive, { kind: 'leaf' }>;
type Swing = Extract<PlanPrimitive, { kind: 'swing' }>;

/**
 * The door whose drawn leaf or swing sector contains `point` (plan metres), or
 * `null`. `slop` widens the leaf band and the arc's radius by that many metres,
 * so a caller can give the pointer a few pixels of grace.
 */
export function doorSymbolAt(drawing: PlanDrawing, point: Vec2, slop = 0): DoorSymbolHit | null {
  let best: { hit: DoorSymbolHit; distance: number } | null = null;
  for (const primitive of drawing.primitives) {
    const inside =
      (primitive.kind === 'swing' && insideSector(primitive, point, slop)) || (primitive.kind === 'leaf' && onLeaf(primitive, point, slop));
    if (!inside) continue;
    const door = primitive.door;
    const distance = dist(point, door.centre);
    if (best === null || distance < best.distance) best = { hit: { openingId: door.openingId, wallId: door.wallId }, distance };
  }
  return best?.hit ?? null;
}

/** Inside the quarter sector of radius `radius` between `a0` and `a1`, boundary included. */
function insideSector(swing: Swing, point: Vec2, slop: number): boolean {
  const offset = sub(point, swing.centre);
  if (Math.hypot(offset.x, offset.z) > swing.radius + slop) return false;
  const middle = (swing.a0 + swing.a1) / 2;
  const half = Math.abs(swing.a1 - swing.a0) / 2;
  const turn = 2 * Math.PI;
  const delta = ((((Math.atan2(offset.z, offset.x) - middle + Math.PI) % turn) + turn) % turn) - Math.PI;
  return Math.abs(delta) <= half;
}

/** Within half a leaf's thickness (plus `slop`) of the leaf line, between its two ends. */
function onLeaf(leaf: Leaf, point: Vec2, slop: number): boolean {
  const run = sub(leaf.to, leaf.from);
  const length2 = dot(run, run);
  const t = length2 > 0 ? Math.min(1, Math.max(0, dot(sub(point, leaf.from), run) / length2)) : 0;
  const nearest = { x: leaf.from.x + run.x * t, z: leaf.from.z + run.z * t };
  return dist(point, nearest) <= LEAF_THICKNESS_M / 2 + slop;
}
