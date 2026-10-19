/**
 * The numeric primitives every layer shares: range clamping and linear
 * interpolation. One implementation each, at the bottom of the layer order, so
 * a curve, a rig, a texture and the plan solver cannot disagree about what
 * "clamp" means at the edges.
 *
 * Invariant: a non-finite input and an inverted range both collapse to the LOW
 * bound rather than propagating `NaN`, so no caller has to guard its inputs
 * before clamping. `lerp` is the one exception — it is exact arithmetic with no
 * range of its own and passes non-finite values straight through.
 *
 * Pure module: no `three`, no DOM.
 */

/**
 * `value` held inside `[low, high]`.
 *
 * A non-finite value and an inverted range both collapse to `low`: a clamp is
 * asked for a value INSIDE the range, and `low` is the only answer available
 * when the range itself is meaningless.
 */
export function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  if (high < low) return low;
  return Math.min(high, Math.max(low, value));
}

/** `clamp(value, 0, 1)`: the unit range every progress and mix factor lives in. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Linear interpolation from `a` to `b` at `t`.
 *
 * `t` is NOT clamped: a caller sampling a gradient past its last stop, or
 * extrapolating a plank colour, wants the straight line, and the ones that do
 * not pass `clamp01(t)`.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Hermite `3t² - 2t³` over the clamped unit range: zero slope at both ends,
 * exactly `0.5` at the midpoint.
 */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * The `t` in `[0, 1]` whose `smoothstep` is `y` (clamped): the closed-form
 * root of the Hermite cubic, `½ − sin(asin(1 − 2y) / 3)`.
 */
export function inverseSmoothstep(y: number): number {
  return 0.5 - Math.sin(Math.asin(1 - 2 * clamp01(y)) / 3);
}

/**
 * Perlin's quintic `6t⁵ − 15t⁴ + 10t³` over the clamped unit range: zero
 * slope AND zero curvature at both ends, so a blend that starts or stops on
 * it never jerks the rate it drives (the tour's gaze and heights).
 */
export function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (6 * x - 15) + 10);
}

/** Folds an angle into `(-PI, PI]`. */
export function wrapAngle(angle: number): number {
  let folded = angle % (Math.PI * 2);
  if (folded <= -Math.PI) folded += Math.PI * 2;
  else if (folded > Math.PI) folded -= Math.PI * 2;
  return folded;
}
