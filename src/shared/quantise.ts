/**
 * Two determinism primitives over plan points: a grid key that hashes
 * near-coincident points into one bucket, and a canonical rotation of a closed
 * ring.
 *
 * Invariant: both are decided by the GEOMETRY alone. Neither reads an index, a
 * counter or the order the caller happened to build its array in, so two
 * documents that describe the same shape produce the same key and the same
 * ring whatever order their vertices were authored in. That is the whole point
 * of the pair: an id, a golden test or an exchange file derived from them is
 * reproducible byte for byte.
 *
 * The two ideas — `qkey` grid hashing and `canonical_ring` — are credited to
 * OpenGeometry's `geometry/poly2d.rs`; the code here is our own,
 * re-implemented from a description of the ideas — nothing is copied from
 * that MPL-2.0 codebase.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError } from './errors.js';

/** The `(x, z)` plan point both helpers work on; `Vec2` and any richer vertex fit. */
type PlanPoint = { readonly x: number; readonly z: number };

/** `Math.round` without its negative zero, so `-0` and `0` stringify alike. */
const cell = (value: number, grid: number): number => Math.round(value / grid) + 0;

/**
 * Grid key for hashing near-coincident points: `Math.round(v / grid)` per axis,
 * joined with `,`.
 *
 * Two points within `grid / 2` of a cell boundary's own side share a key, which
 * is what an IMPORTER welds endpoints by (`DEFAULT_TOLERANCE.merge` as the
 * grid). The SOLVER never uses it: a plan that is already a planar embedding
 * has its coincidences expressed as shared node ids, and re-deriving them from
 * a hash would let a 4 mm construction gap disappear silently.
 *
 * The axes are joined rather than summed or multiplied, so `(1, 23)` and
 * `(12, 3)` cannot collide.
 *
 * @throws ViewerLibError `bad-params` when `grid` is not a positive finite
 * number, or a coordinate is not finite: every other answer here is a silently
 * wrong bucket.
 */
export function quantiseKey(p: PlanPoint, grid: number): string {
  if (!Number.isFinite(grid) || grid <= 0) {
    throw new ViewerLibError('bad-params', `quantiseKey needs a positive finite grid, got ${grid}`);
  }
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
    throw new ViewerLibError('bad-params', `quantiseKey needs a finite point, got (${p.x}, ${p.z})`);
  }
  return `${cell(p.x, grid)},${cell(p.z, grid)}`;
}

/**
 * Rotates a ring so it starts at its lexicographically smallest vertex (`x`,
 * then `z`); keeps orientation. Empty stays empty.
 *
 * A rotation, never a sort: the cyclic order IS the shape, and the winding
 * carries the room-versus-facade convention of the whole plan layer, so the
 * signed area of the result equals the signed area of the input. Ties keep the
 * first occurrence, so a degenerate ring that visits one point twice still has
 * exactly one answer.
 *
 * The elements are the caller's own objects, moved into a new array; nothing is
 * cloned, so a ring of `WallFace` vertices keeps whatever else it carries.
 */
export function canonicalRing<T extends PlanPoint>(ring: readonly T[]): T[] {
  if (ring.length === 0) return [];
  let at = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const candidate = ring[i]!;
    const best = ring[at]!;
    if (candidate.x < best.x || (candidate.x === best.x && candidate.z < best.z)) at = i;
  }
  return [...ring.slice(at), ...ring.slice(0, at)];
}
