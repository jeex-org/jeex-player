/**
 * The named tolerances of the plan layer, in one place.
 *
 * Invariant: there is ONE numeric answer per question, and each question has a
 * name. «Are these two points the same point» (`linear`), «do these two
 * centrelines touch» (`planar`), «are these two directions the same direction»
 * (`angular`) and «may an importer weld these two endpoints together»
 * (`merge`) are four different questions, and answering them all with a single
 * `EPS` is how a solver ends up either welding a 4 mm construction gap or
 * splitting a pair of parallel walls into a sliver face.
 *
 * `EPS` and `EPS_PLANAR` keep their exact previous values and are re-exported
 * by `plan-geometry.ts`, so none of their call sites changes behaviour.
 *
 * The idea of an explicit tolerance context alongside explicit units is
 * credited to OpenGeometry's `tolerance.rs` / `units.rs`; the code here is
 * our own — nothing is copied from that MPL-2.0 codebase.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Vec2 } from '../scene/types.js';

/**
 * Linear and angular tolerances are different questions: «are these points one
 * point» versus «are these walls parallel». A tolerance context carries both,
 * plus the two thresholds that sit between them.
 */
export type Tolerance = {
  /** Metres. Coincidence of points and directions; the historical `EPS`. */
  readonly linear: number;
  /** Metres. Contact test between two centrelines; the historical `EPS_PLANAR`. */
  readonly planar: number;
  /** Radians. Parallelism and the tie-break in half-edge ordering. */
  readonly angular: number;
  /** Metres. Endpoint snapping an IMPORTER may apply; the solver never does. */
  readonly merge: number;
};

/**
 * The tolerances every plan module works to.
 *
 * - `linear` 1e-6 m: below this, points and directions are equal. A micron is
 *   four orders below the survey precision of any plan we accept, so it only
 *   ever absorbs floating-point noise.
 * - `planar` 1e-4 m: two centrelines closer than this touch, so the plan must
 *   carry a shared node there. Two orders of magnitude above the survey
 *   precision of a plan and two below the thinnest wall.
 * - `angular` 1e-3 rad (0.057°): two exit directions this close are one
 *   direction as far as the fan around a node is concerned.
 * - `merge` 5e-3 m: the widest gap an importer may weld shut. A whole
 *   millimetre-scale band above `planar` on purpose — a DXF or IFC file
 *   carries endpoints that were never meant to be exact, and a plan drawn to
 *   the millimetre must not gain a node per rounding error.
 */
export const DEFAULT_TOLERANCE: Tolerance = { linear: 1e-6, planar: 1e-4, angular: 1e-3, merge: 0.005 };

/** Geometric tolerance in metres: below this, points and directions are equal. */
export const EPS = DEFAULT_TOLERANCE.linear;

/**
 * Planarity tolerance in metres: two centrelines closer than this touch, so
 * the plan must carry a shared node there. Two orders of magnitude above the
 * survey precision of a plan and two below the thinnest wall.
 */
export const EPS_PLANAR = DEFAULT_TOLERANCE.planar;

const TURN = 2 * Math.PI;

/**
 * `a` and `b` are the same direction, to `tol.angular`.
 *
 * Wrap-around aware: the comparison is on the shortest signed difference, so
 * `0` and `2π - 1e-4` are equal and no caller has to normalise its angles
 * first. A non-finite angle is equal to nothing, including itself.
 *
 * The difference is folded by SUBTRACTING whole turns (`delta - TURN *
 * round(delta / TURN)`) rather than by `%` into `[0, 2π)` and mirroring:
 * the mirrored form computes `2π - (2π - tol)`, which is not `tol` in binary
 * floating point, so a pair authored exactly on the documented edge would fail
 * a test it passes in the other direction.
 */
export function anglesEqual(a: number, b: number, tol: Tolerance = DEFAULT_TOLERANCE): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const delta = a - b;
  return Math.abs(delta - TURN * Math.round(delta / TURN)) <= tol.angular;
}

/**
 * `a` and `b` are the same point, to `tol.linear`.
 *
 * The test is on the euclidean distance, not per axis: a per-axis test accepts
 * a pair `tol * sqrt(2)` apart on the diagonal, which is exactly the case a
 * near-degenerate mitre produces.
 */
export function pointsCoincident(a: Vec2, b: Vec2, tol: Tolerance = DEFAULT_TOLERANCE): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) <= tol.linear;
}
