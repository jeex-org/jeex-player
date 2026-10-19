/**
 * The geometry of the tour track: the control polyline of a checkpoint route —
 * every camera, and between two cameras the waypoints of the walk through the
 * openings — with its corners ROUNDED, and the height eased from camera to
 * camera.
 *
 * Rounding: every corner gets a clamped Bezier fillet whose tangent length is
 * bounded by `TRACK_CORNER_MAX_M` and by half of each neighbouring straight, so
 * a fillet never reaches past the middle of a straight and two fillets never
 * overlap.
 * - A CUT corner (a waypoint of the walk) is a quadratic Bezier from a point
 *   on the incoming straight to a point on the outgoing one, the corner its
 *   control point: tangent-continuous with both straights; with equal arms
 *   `k` its tightest radius is `k·cos²(θ/2)/sin(θ/2)`, at the apex.
 * - A THROUGH corner (a camera, an opening's pinned centre) is two cubic
 *   Beziers that meet ON the corner with the bisecting tangent, so the track
 *   passes exactly through it with a continuous direction.
 * - A through corner that turns back by more than `TRACK_TURNAROUND_RAD` is
 *   left sharp: no curve can turn back on the spot, and the player brings the
 *   run to a standstill there instead (`camera/tour-motion.ts`).
 * The caller shrinks a corner (`reach`) whose curve leaves the walkable space
 * and rebuilds; at zero reach the corner is the bare polyline corner.
 *
 * Pure module: no `three`, no DOM.
 */

import { smootherstep } from '../shared/math.js';
import type { Vec2 } from './types.js';

/** The longest tangent a corner's rounding takes along either straight, metres. */
export const TRACK_CORNER_MAX_M = 1.5;
/** A through corner that turns back by more than this stays sharp (a standstill), radians. */
export const TRACK_TURNAROUND_RAD = (100 / 180) * Math.PI;
/** The share of a straight either of its corners may round off. */
const CORNER_SHARE = 0.5;
/** The share of a straight a corner may round off when the corner at its other end takes none. */
const LONE_SHARE = 0.9;
/** A corner that turns by less than this is straight, radians. */
const STRAIGHT_RAD = 1e-3;
/** How far a height correction (under a door head, over a window sill) spreads along the track, metres. */
const HEIGHT_EASE_M = 1;

/** The rounded track: plan points, and per control its sample index and the samples its rounding spans. */
export type RoundedTrack = {
  readonly points: Vec2[];
  /** Sample index of each control: exact for a through corner, the apex region for a cut one. */
  readonly at: number[];
  /** First and last sample index of each control's rounding (both `at` when the corner is sharp). */
  readonly span: Array<readonly [number, number]>;
};

/** The tangent lengths of one corner's rounding along its incoming and its outgoing straight, metres. */
export type Reach = { readonly before: number; readonly after: number };

const SHARP: Reach = { before: 0, after: 0 };

/**
 * The tangent lengths each control's rounding may take: none at both ends, on
 * a straight and at a through corner that turns back; else at most
 * `TRACK_CORNER_MAX_M` along either straight, and at most half of the
 * straight — all of it but a sliver when the corner at its other end takes
 * nothing (an opening's centre on a straight crossing, a sharp turnaround,
 * an end of the track), so a short straight into a doorway still leaves the
 * turn a long arm on its open side.
 */
export function cornerReach(controls: readonly Vec2[], through: readonly boolean[]): Reach[] {
  const rounds = controls.map((corner, index) => {
    const before = controls[index - 1];
    const after = controls[index + 1];
    if (!before || !after) return false;
    const turn = turnOf(before, corner, after);
    return turn >= STRAIGHT_RAD && !(through[index] && turn > TRACK_TURNAROUND_RAD);
  });
  const arm = (from: number, to: number): number =>
    Math.min(TRACK_CORNER_MAX_M, flat(controls[from]!, controls[to]!) * (rounds[to] ? CORNER_SHARE : LONE_SHARE));
  return controls.map((_, index) => (rounds[index] ? { before: arm(index, index - 1), after: arm(index, index + 1) } : SHARP));
}

/**
 * The control polyline with each corner rounded by its `reach` (a cut or a
 * through fillet, see the module doc), sampled about every `step` metres.
 * Consecutive controls must be distinct.
 */
export function roundCorners(controls: readonly Vec2[], through: readonly boolean[], reach: readonly Reach[], step: number): RoundedTrack {
  const points: Vec2[] = [{ ...controls[0]! }];
  const at: number[] = [0];
  const span: Array<readonly [number, number]> = [[0, 0]];
  let exit: Vec2 = controls[0]!;
  for (let index = 1; index < controls.length; index += 1) {
    const corner = controls[index]!;
    const before = controls[index - 1]!;
    const after = controls[index + 1];
    const arms = after ? (reach[index] ?? SHARP) : SHARP;
    const inward = unit(before, corner);
    const round = arms.before > 0 && arms.after > 0;
    const entry = round ? along(corner, inward, -arms.before) : corner;
    straight(points, exit, entry, step);
    const first = points.length - 1;
    if (round && after) {
      const outward = unit(corner, after);
      exit = along(corner, outward, arms.after);
      if (through[index]) at.push(throughFillet(points, corner, inward, outward, arms, step));
      else at.push(cutFillet(points, entry, corner, exit, arms.before + arms.after, step));
    } else {
      exit = corner;
      at.push(first);
    }
    span.push([first, points.length - 1]);
  }
  return { points, at, span };
}

/** Straight samples from `from` (already on the track) to `to`, about `step` apart, `to` included. */
function straight(points: Vec2[], from: Vec2, to: Vec2, step: number): void {
  const length = flat(from, to);
  if (length < 1e-9) return;
  const count = Math.max(1, Math.ceil(length / step));
  for (let index = 1; index <= count; index += 1) {
    const u = index / count;
    points.push(index === count ? { x: to.x, z: to.z } : { x: from.x + (to.x - from.x) * u, z: from.z + (to.z - from.z) * u });
  }
}

/** The quadratic fillet from `entry` to `exit` around `corner`; answers the sample index of its apex. */
function cutFillet(points: Vec2[], entry: Vec2, corner: Vec2, exit: Vec2, arms: number, step: number): number {
  const count = Math.max(2, Math.ceil(arms / step));
  let apex = points.length - 1;
  for (let index = 1; index <= count; index += 1) {
    const u = index / count;
    const a = (1 - u) * (1 - u);
    const b = 2 * u * (1 - u);
    const c = u * u;
    points.push({ x: a * entry.x + b * corner.x + c * exit.x, z: a * entry.z + b * corner.z + c * exit.z });
    if (index * 2 <= count) apex = points.length - 1;
  }
  return apex;
}

/**
 * The two cubics through `corner`: in along `inward`, through the corner on
 * the bisecting tangent, out along `outward`. Answers the corner's sample
 * index, where the sample IS the corner.
 */
function throughFillet(points: Vec2[], corner: Vec2, inward: Vec2, outward: Vec2, arms: Reach, step: number): number {
  const bisector = normalised({ x: inward.x + outward.x, z: inward.z + outward.z }) ?? outward;
  const k = arms.before;
  const m = arms.after;
  const halves: Array<readonly [Vec2, Vec2, Vec2, Vec2]> = [
    [along(corner, inward, -k), along(corner, inward, (-2 * k) / 3), along(corner, bisector, -k / 2), corner],
    [corner, along(corner, bisector, m / 2), along(corner, outward, (2 * m) / 3), along(corner, outward, m)],
  ];
  let centre = points.length - 1;
  halves.forEach(([p0, p1, p2, p3], half) => {
    const count = Math.max(2, Math.ceil((half === 0 ? k : m) / step));
    for (let index = 1; index <= count; index += 1) {
      const u = index / count;
      const v = 1 - u;
      const w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u] as const;
      points.push(
        half === 0 && index === count
          ? { x: corner.x, z: corner.z }
          : { x: w[0] * p0.x + w[1] * p1.x + w[2] * p2.x + w[3] * p3.x, z: w[0] * p0.z + w[1] * p1.z + w[2] * p2.z + w[3] * p3.z },
      );
    }
    if (half === 0) centre = points.length - 1;
  });
  return centre;
}

/**
 * Heights along one leg, from `fromY` on its first sample to `toY` on its
 * last: eased by a smootherstep of the plan distance, so the camera rises or
 * sinks without a vertical jolt at either camera, then held between `low`
 * and `high` per sample (under a door head, over a window sill). A held
 * stretch is eased in and out: each sample's excess fades over
 * `HEIGHT_EASE_M` either way on a smootherstep, and the track takes the
 * largest such correction, which keeps every bound where it applied and
 * starts the climb or the dip with zero slope.
 */
export function easedHeights(
  points: readonly Vec2[],
  fromY: number,
  toY: number,
  low: readonly number[],
  high: readonly number[],
): number[] {
  const distance = [0];
  for (let index = 1; index < points.length; index += 1) distance.push(distance[index - 1]! + flat(points[index - 1]!, points[index]!));
  const total = distance.at(-1)! || 1;
  const base = distance.map((metres) => fromY + (toY - fromY) * smootherstep(metres / total));
  const down = faded(
    base.map((y, index) => Math.max(0, y - (high[index] ?? Number.POSITIVE_INFINITY))),
    distance,
  );
  const up = faded(
    base.map((y, index) => Math.max(0, (low[index] ?? Number.NEGATIVE_INFINITY) - y)),
    distance,
  );
  const heights = base.map((y, index) => y - down[index]! + up[index]!);
  // Both ends stand exactly on their cameras' heights, whatever a band near them asked for.
  heights[heights.length - 1] = toY;
  heights[0] = fromY;
  return heights;
}

/** The largest of every sample's excess faded out over `HEIGHT_EASE_M` of track: never below the excess itself. */
function faded(excess: readonly number[], distance: readonly number[]): readonly number[] {
  const held = excess.flatMap((value, index) => (value > 0 ? [{ value, at: distance[index]! }] : []));
  if (held.length === 0) return excess;
  return distance.map((here) =>
    held.reduce((best, { value, at }) => Math.max(best, value * (1 - smootherstep(Math.abs(here - at) / HEIGHT_EASE_M))), 0),
  );
}

/** The angle a polyline turns by at `corner`, radians in `[0, π]`. */
function turnOf(before: Vec2, corner: Vec2, after: Vec2): number {
  const a = unit(before, corner);
  const b = unit(corner, after);
  return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
}

function unit(from: Vec2, to: Vec2): Vec2 {
  return normalised({ x: to.x - from.x, z: to.z - from.z }) ?? { x: 0, z: 1 };
}

function normalised(vector: Vec2): Vec2 | null {
  const length = Math.hypot(vector.x, vector.z);
  return length < 1e-9 ? null : { x: vector.x / length, z: vector.z / length };
}

function along(point: Vec2, direction: Vec2, distance: number): Vec2 {
  return { x: point.x + direction.x * distance, z: point.z + direction.z * distance };
}

function flat(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
