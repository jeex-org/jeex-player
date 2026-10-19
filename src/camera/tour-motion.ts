/**
 * How a checkpoint run MOVES along its track: where it looks at every metre,
 * and how fast it goes there.
 *
 * Gaze. Between two cameras the run
 * looks along its travel direction — the track's heading, smoothed over
 * `HEADING_SIGMA_M` so a tight fillet in a doorway never whips the view — at
 * level pitch. Around each camera the look blends into the camera's exact
 * yaw and pitch on a smootherstep over the route's turn window (the route's
 * `travel` keys mark where it starts and ends), so the angular velocity is
 * continuous everywhere and zero ON each camera: the view settles into the
 * camera's frame and leaves it again without a jolt. A leg too short for both
 * turns blends from one camera's look straight into the next one's, along
 * the short yaw arc.
 *
 * Speed. The cruise speed is a ceiling, not a constant: the run slows
 * wherever the gaze would turn faster than `MAX_YAW_RATE`, tilt faster than
 * `MAX_PITCH_RATE` or change either rate faster than `MAX_GAZE_ACCEL`, wherever a curve would push sideways harder than
 * `MAX_LATERAL_ACCEL`, and comes to a standstill where the track turns back
 * on a camera. The limits are joined by `MAX_ALONG_ACCEL` both ways, so the
 * speed itself never jumps. The track ramps at a standstill come on top, as the
 * player's clock warp (`track-ease.ts`).
 *
 * Pure module: no `three`, no DOM. Rates are per second at 1x; a faster
 * speed setting scales every one of them.
 */

import { smootherstep } from '../shared/math.js';
import type { TourLook } from '../scene/tour-route.js';
import type { Vec3 } from '../scene/types.js';

/** The fastest the gaze may turn left or right at 1x, radians per second. */
export const MAX_YAW_RATE = (75 / 180) * Math.PI;
/** The fastest the gaze may tilt up or down at 1x, radians per second. */
export const MAX_PITCH_RATE = (30 / 180) * Math.PI;
/** The fastest the gaze's turn or tilt may itself speed up or slow down at 1x, radians per second². */
export const MAX_GAZE_ACCEL = (100 / 180) * Math.PI;
/** The hardest a curve may push sideways at 1x, m/s². */
const MAX_LATERAL_ACCEL = 1.2;
/** The hardest the run may speed up or slow down along the track at 1x, m/s². */
const MAX_ALONG_ACCEL = 1;
/** Standard deviation of the smoothing of the travel heading, metres of track. */
const HEADING_SIGMA_M = 0.4;
/** Metres between two samples of the speed profile and the heading. */
const GRID_M = 0.05;
/** The track turns back on a camera when its direction turns by more than this there, radians. */
const TURNAROUND_RAD = (100 / 180) * Math.PI;
/** The slowest a standstill point is crossed at, m/s: a true zero would never be left. */
const CRAWL_MPS = 0.02;

/** One camera's look on the track: where it stands (metres along) and where it looks. */
export type CameraLook = { readonly d: number; readonly look: TourLook };
/** One leg's travel stretch: from `leave` to `arrive` metres the run looks where it goes. */
export type TravelStretch = { readonly leave: number; readonly arrive: number };

export type TrackMotionInput = {
  readonly length: number;
  /** The track position `d` metres along it. */
  readonly positionAt: (d: number) => Vec3;
  /** Every camera, in track order, the first at 0 and the last at `length`. */
  readonly cameras: readonly CameraLook[];
  /** The travel stretch of each leg that has one (between the leg's cameras). */
  readonly travel: readonly TravelStretch[];
  /** Cruise speed, m/s. */
  readonly cruise: number;
};

/** One entry of a time table: route seconds, metres, and (a checkpoint run's) speed there, m/s. */
export type TimeEntry = { t: number; d: number; v?: number };

export type TrackMotion = {
  /** The look `d` metres along the track. */
  gaze: (d: number) => TourLook;
  /** Route time → distance, from 0 to the end of the motion, 1x, with the speed at every entry. */
  table: TimeEntry[];
};

/**
 * Metres reached `time` seconds into the cell `a → b`: at a constant
 * acceleration from `a.v` when the cell carries speeds, so the speed is
 * continuous from cell to cell (a linear read would hold it constant per
 * cell and step it at every boundary); linear otherwise.
 */
export function cellDistance(a: TimeEntry, b: TimeEntry, time: number): number {
  const span = b.t - a.t;
  const tau = time - a.t;
  if (span <= 0) return a.d;
  if (a.v === undefined || b.v === undefined) return a.d + (b.d - a.d) * (tau / span);
  const accel = (2 * (b.d - a.d - a.v * span)) / (span * span);
  return a.d + a.v * tau + 0.5 * accel * tau * tau;
}

/** The inverse of `cellDistance`: seconds after `a.t` the cell reaches `d`. */
export function cellTime(a: TimeEntry, b: TimeEntry, d: number): number {
  const span = b.t - a.t;
  const delta = d - a.d;
  if (span <= 0 || b.d - a.d <= 0) return a.t;
  if (a.v === undefined || b.v === undefined) return a.t + span * (delta / (b.d - a.d));
  const accel = (2 * (b.d - a.d - a.v * span)) / (span * span);
  const root = Math.sqrt(Math.max(0, a.v * a.v + 2 * accel * delta));
  return a.t + (a.v + root > 1e-12 ? (2 * delta) / (a.v + root) : 0);
}

/** The gaze and the time table of a checkpoint run. */
export function trackMotion(input: TrackMotionInput): TrackMotion {
  const heading = smoothedHeading(input);
  const gaze = (d: number): TourLook => gazeAt(input, heading, d);
  return { gaze, table: timeTable(input, gaze) };
}

// ---- Gaze -------------------------------------------------------------------

/** The smoothed travel heading of each leg, read by leg index and distance. */
type Heading = { at: (leg: number, d: number) => number };

function gazeAt(input: TrackMotionInput, heading: Heading, d: number): TourLook {
  const { cameras } = input;
  let leg = 0;
  while (leg < cameras.length - 2 && d > cameras[leg + 1]!.d) leg += 1;
  const from = cameras[leg]!;
  const to = cameras[leg + 1] ?? from;
  if (to.d - from.d < 1e-9) return d < to.d ? from.look : to.look;
  const stretch = input.travel.find((candidate) => candidate.leave >= from.d - 1e-9 && candidate.arrive <= to.d + 1e-9);
  if (!stretch) {
    const u = smootherstep((d - from.d) / (to.d - from.d));
    return {
      yaw: from.look.yaw + shortArc(from.look.yaw, to.look.yaw) * u,
      pitch: from.look.pitch + (to.look.pitch - from.look.pitch) * u,
    };
  }
  const travel = heading.at(leg, d);
  const fromYaw = heading.at(leg, from.d) + shortArc(heading.at(leg, from.d), from.look.yaw);
  const toYaw = heading.at(leg, to.d) + shortArc(heading.at(leg, to.d), to.look.yaw);
  const leaving = d < stretch.leave ? 1 - smootherstep((d - from.d) / Math.max(1e-9, stretch.leave - from.d)) : 0;
  const arriving = d > stretch.arrive ? smootherstep((d - stretch.arrive) / Math.max(1e-9, to.d - stretch.arrive)) : 0;
  return {
    yaw: travel + leaving * (fromYaw - travel) + arriving * (toYaw - travel),
    pitch: leaving * from.look.pitch + arriving * to.look.pitch,
  };
}

/**
 * The travel heading, unwrapped and smoothed per leg: a Gaussian of
 * `HEADING_SIGMA_M` over the direction of the track, never reaching across a
 * camera (where the track may turn back).
 */
function smoothedHeading(input: TrackMotionInput): Heading {
  const legs = input.cameras.slice(1).map((camera, index) => legHeading(input, input.cameras[index]!.d, camera.d));
  return {
    at(index, d) {
      const leg = legs[index];
      if (!leg) return 0;
      // Catmull-Rom between the grid values: the heading's rate is continuous
      // from cell to cell, where a linear read would step it at every cell.
      const last = leg.values.length - 1;
      const x = Math.min(last, Math.max(0, (d - leg.start) / leg.step));
      const i = Math.min(Math.floor(x), Math.max(0, last - 1));
      const u = x - i;
      const p0 = leg.values[Math.max(0, i - 1)]!;
      const p1 = leg.values[i]!;
      const p2 = leg.values[Math.min(last, i + 1)]!;
      const p3 = leg.values[Math.min(last, i + 2)]!;
      return p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
    },
  };
}

function legHeading(input: TrackMotionInput, start: number, end: number): { start: number; step: number; values: number[] } {
  const count = Math.max(1, Math.round((end - start) / GRID_M));
  const raw: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    const d = start + ((end - start) * index) / count;
    const a = input.positionAt(Math.max(start, d - GRID_M));
    const b = input.positionAt(Math.min(end, d + GRID_M));
    const yaw = Math.hypot(b.x - a.x, b.z - a.z) < 1e-9 ? (raw.at(-1) ?? 0) : Math.atan2(b.x - a.x, b.z - a.z);
    raw.push(raw.length === 0 ? yaw : raw.at(-1)! + shortArc(raw.at(-1)!, yaw));
  }
  const step = (end - start) / count;
  const reach = Math.ceil((3 * HEADING_SIGMA_M) / Math.max(step, 1e-9));
  const values = raw.map((_, index) => {
    let sum = 0;
    let weight = 0;
    for (let other = Math.max(0, index - reach); other <= Math.min(raw.length - 1, index + reach); other += 1) {
      const w = Math.exp(-0.5 * (((other - index) * step) / HEADING_SIGMA_M) ** 2);
      sum += w * raw[other]!;
      weight += w;
    }
    return sum / weight;
  });
  return { start, step, values };
}

// ---- Speed ------------------------------------------------------------------

/**
 * The speed profile on a grid of `GRID_M`, limited by the gaze's rates, the
 * track's curvature and the turnarounds, joined by `MAX_ALONG_ACCEL`, and
 * integrated into a time → distance table.
 */
function timeTable(input: TrackMotionInput, gaze: (d: number) => TourLook): TimeEntry[] {
  const { length } = input;
  if (length <= 0) return [{ t: 0, d: 0 }];
  const count = Math.max(1, Math.ceil(length / GRID_M));
  const step = length / count;
  // A grid point ON every camera, so a turnaround's standstill is exactly where the track turns back.
  const stops = new Set(
    input.cameras
      .slice(1, -1)
      .filter((camera) => turnsBack(input, camera.d))
      .map((camera) => camera.d),
  );
  const grid = [
    ...new Set([...Array.from({ length: count + 1 }, (_, index) => (length * index) / count), ...input.cameras.map((camera) => camera.d)]),
  ]
    .filter((d) => d >= 0 && d <= length)
    .sort((a, b) => a - b);
  const limit = grid.map((d) => (stops.has(d) ? 0 : speedLimit(input, gaze, d, step)));
  const speed = joined(limit, grid);
  const table: TimeEntry[] = [{ t: 0, d: 0, v: speed[0]! }];
  for (let index = 1; index < grid.length; index += 1) {
    const mean = Math.max(CRAWL_MPS, (speed[index - 1]! + speed[index]!) / 2);
    table.push({ t: table.at(-1)!.t + (grid[index]! - grid[index - 1]!) / mean, d: grid[index]!, v: speed[index]! });
  }
  return table;
}

function speedLimit(input: TrackMotionInput, gaze: (d: number) => TourLook, d: number, step: number): number {
  const before = Math.max(0, d - step);
  const after = Math.min(input.length, d + step);
  const span = Math.max(1e-9, after - before);
  const a = gaze(before);
  const here = gaze(d);
  const b = gaze(after);
  const yawRate = Math.abs(shortArc(a.yaw, b.yaw)) / span;
  const pitchRate = Math.abs(b.pitch - a.pitch) / span;
  // At speed v a gaze that bends by ψ'' per metre² turns ever faster by v²·ψ''.
  const half = span / 2;
  const bend =
    Math.max(Math.abs(shortArc(here.yaw, b.yaw) - shortArc(a.yaw, here.yaw)), Math.abs(b.pitch - 2 * here.pitch + a.pitch)) / (half * half);
  const curvature = turnOf(input.positionAt(before), input.positionAt(d), input.positionAt(after)) / span;
  return Math.min(
    input.cruise,
    yawRate > 1e-9 ? MAX_YAW_RATE / yawRate : Number.POSITIVE_INFINITY,
    pitchRate > 1e-9 ? MAX_PITCH_RATE / pitchRate : Number.POSITIVE_INFINITY,
    curvature > 1e-9 ? Math.sqrt(MAX_LATERAL_ACCEL / curvature) : Number.POSITIVE_INFINITY,
    bend > 1e-9 ? Math.sqrt(MAX_GAZE_ACCEL / bend) : Number.POSITIVE_INFINITY,
  );
}

/** The speed limits joined by `MAX_ALONG_ACCEL` forward and backward: the highest speed that never jumps. */
function joined(limit: readonly number[], grid: readonly number[]): number[] {
  const speed = [...limit];
  const rise = (index: number): number => 2 * MAX_ALONG_ACCEL * (grid[index + 1]! - grid[index]!);
  for (let index = 1; index < speed.length; index += 1)
    speed[index] = Math.min(speed[index]!, Math.sqrt(speed[index - 1]! ** 2 + rise(index - 1)));
  for (let index = speed.length - 2; index >= 0; index -= 1)
    speed[index] = Math.min(speed[index]!, Math.sqrt(speed[index + 1]! ** 2 + rise(index)));
  return speed;
}

/** Whether the track turns back at `d` (a camera at the end of a dead end). */
function turnsBack(input: TrackMotionInput, d: number): boolean {
  const reach = 2 * GRID_M;
  return turnOf(input.positionAt(d - reach), input.positionAt(d), input.positionAt(d + reach)) > TURNAROUND_RAD;
}

/** The angle the track turns by at `b`, between the hops `a → b` and `b → c`, radians in `[0, π]`. */
function turnOf(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const vx = c.x - b.x;
  const vz = c.z - b.z;
  const lu = Math.hypot(ux, uz);
  const lv = Math.hypot(vx, vz);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv))));
}

/** `to - from` wrapped into `[-π, π)`: the short way round. */
function shortArc(from: number, to: number): number {
  const turn = 2 * Math.PI;
  return ((((to - from + Math.PI) % turn) + turn) % turn) - Math.PI;
}
