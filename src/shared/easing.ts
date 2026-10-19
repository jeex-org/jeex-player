/**
 * Shared easing curves for camera tweens, fades and furniture animation.
 *
 * Invariant: every curve clamps its input to `[0, 1]` and pins the endpoints
 * (`f(0) = 0`, `f(1) = 1`), so a stale or overshooting clock can never push a
 * tween past its target. The clamp itself and the plain Hermite ramp
 * (`smoothstep`) are numeric primitives and live in `shared/math.ts`; what is
 * left here is the curves with a SHAPE of their own. Pure module: no `three`,
 * no DOM.
 */

import { clamp01 } from './math.js';

/** Overshoot of `easeOutBack`; `1.1` gives a ~1.3 % pop past the target. */
const BACK_OVERSHOOT = 1.1;

/** Ease-out with a small overshoot past 1 before settling back exactly on 1. */
export function easeOutBack(t: number): number {
  const c3 = BACK_OVERSHOOT + 1;
  const x = clamp01(t);
  return 1 + c3 * (x - 1) ** 3 + BACK_OVERSHOOT * (x - 1) ** 2;
}

/** Slow start, slow end, exactly `0.5` at the midpoint; symmetric about it. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}
