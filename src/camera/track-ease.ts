/**
 * The speed ramps of a checkpoint run: the run leaves a standstill over
 * `TRACK_RAMP_SECONDS` and settles into
 * the last camera's pose over the same time, the speed factor following a
 * smoothstep. The ramps are a WARP of the route clock: real seconds in, route
 * seconds out, so the speed profile of the route itself (cruise, turnaround
 * zones) is untouched and the run still ends exactly on the route's end.
 *
 * A ramp of length `R` real seconds covers `R / 2` route seconds (the mean of
 * a smoothstep is one half). A run shorter than one second of travel scales
 * both ramps down in proportion (`rampFor`), so they never overlap past the
 * middle and a short step still lands on its pose.
 *
 * Pure module: no `three`, no DOM.
 */

/** Seconds of the ease-in and of the ease-out of a checkpoint run. */
export const TRACK_RAMP_SECONDS = 0.5;

/** The ramp length for a run of `motionSeconds` of travel at full speed. */
export function rampFor(motionSeconds: number): number {
  return TRACK_RAMP_SECONDS * Math.min(1, Math.max(0, motionSeconds));
}

/**
 * Route time a ramp has covered after `x` of it, in ramp lengths: the integral
 * of the smoothstep speed factor, `x³ − x⁴/2`, and `x − ½` past its end.
 */
function rampCovered(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return x - 0.5;
  return x * x * x - (x * x * x * x) / 2;
}

/** The inverse of `rampCovered` on `[0, ½]`: how far into the ramp it covers `covered` (bisection). */
function rampAt(covered: number): number {
  const target = Math.min(0.5, Math.max(0, covered));
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 40; step += 1) {
    const mid = (lo + hi) / 2;
    if (rampCovered(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * One frame of the warped clock: the route time `elapsed` advanced by `delta`
 * real seconds, `since` real seconds after the run last left a standstill
 * (`null` when it is not easing in), `motionEnd` the route time the motion
 * ends at, `ramp` the ramp length in real seconds. Never passes `motionEnd`
 * while easing out; past it (the end hold) the clock runs plainly.
 */
export function warpStep(elapsed: number, delta: number, since: number | null, motionEnd: number, ramp: number): number {
  if (ramp <= 0 || delta <= 0) return elapsed + Math.max(0, delta);
  let next = elapsed + delta;
  if (since !== null && since < ramp) next = elapsed + ramp * (rampCovered((since + delta) / ramp) - rampCovered(since / ramp));
  const left = motionEnd - elapsed;
  if (left > 0 && left < ramp / 2) {
    const into = ramp * rampAt(left / ramp);
    const after = Math.max(0, into - delta);
    next = Math.min(next, motionEnd - ramp * rampCovered(after / ramp));
  }
  return next;
}

/**
 * The PLAYBACK clock of a whole run from a standstill to its end: 1x seconds
 * of the run as the viewer plays it,
 * ramps included, against route seconds. A run of `motionEnd` route seconds
 * of travel plays for `motionEnd + ramp` seconds (each ramp of `ramp`
 * seconds covers half of that in route time), and the end hold after it runs
 * plainly. This is the clock a host reads (`progress().elapsed`,
 * `duration`), seeks by (`seekTime`) and records by (`capture.frames`), so a
 * recording carries the same ease-in and ease-out as the live run.
 *
 * `routeTimeAt` maps playback seconds to route seconds; `playbackTimeAt` is
 * its inverse. Both are monotone and continuous; with `ramp <= 0` both are
 * the identity. `ramp` never exceeds `motionEnd / 2` (`rampFor`), so the two
 * ramps never overlap.
 */
export function routeTimeAt(playback: number, motionEnd: number, ramp: number): number {
  if (ramp <= 0) return Math.max(0, playback);
  const p = Math.max(0, playback);
  const landing = motionEnd + ramp;
  if (p >= landing) return motionEnd + (p - landing);
  if (p < ramp) return ramp * rampCovered(p / ramp);
  if (p > landing - ramp) return motionEnd - ramp * rampCovered((landing - p) / ramp);
  return p - ramp / 2;
}

/** The inverse of `routeTimeAt`: the playback second a run reaches route time `route` at. */
export function playbackTimeAt(route: number, motionEnd: number, ramp: number): number {
  if (ramp <= 0) return Math.max(0, route);
  const r = Math.max(0, route);
  const landing = motionEnd + ramp;
  if (r >= motionEnd) return landing + (r - motionEnd);
  if (r < ramp / 2) return ramp * rampAt(r / ramp);
  if (r > motionEnd - ramp / 2) return landing - ramp * rampAt((motionEnd - r) / ramp);
  return r + ramp / 2;
}
