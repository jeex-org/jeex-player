/**
 * The ONE answer to "what route does the tour ride": the authored `autotour`
 * when the document has no tour checkpoints to speak of, a walk from the first
 * camera to the last when it does.
 *
 * The director's `setScene` feeds this to the tour player and the placement
 * overlay's trajectory (`camera/checkpoint-trajectory.ts`) draws the same
 * answer, so the route the editor DRAWS can never drift from the route the
 * tour RIDES. A document with fewer than two checkpoints falls back to the
 * authored route exactly as a pre-checkpoint document always did.
 *
 * A checkpoint route:
 * - STARTS on camera 1 in its pose and ENDS on the last camera in its pose —
 *   the player enters it with a one-second glide to camera 1, never a fly-in (`kind: 'checkpoints'`);
 * - joins consecutive cameras through the walkable space and the openings
 *   (`TourNavigation`, built by the caller from the solved plan) and still
 *   passes EXACTLY through every camera position. A leg crosses a wall ONLY
 *   inside an opening — a door first, a window where no door reaches the
 *   camera's room — through the opening's pinned centre, at a height inside it; every leg is checked (`legIsLegal`) before it is
 *   ridden, and a corner whose rounding fails is rounded less, down to the
 *   bare chain corner, which crosses at the pinned centres by construction;
 * - is smooth: every corner of the control polyline is rounded with a bounded
 *   fillet and the height eases from camera to camera (`tour-track.ts`);
 * - carries the gaze as DIRECTIONS: each camera's own yaw/pitch at the camera,
 *   the level travel direction in between. A world point six metres ahead of a
 *   camera looking down lay under the floor, and the tour stared at it.
 *
 * Pure module: no `three`, no DOM. The navigation arrives as a parameter, so
 * this module reads no plan and the `jeex-viewer/ops` entry that exports it
 * never pulls the router in.
 */

import type { TourNavigation, TourWaypoint } from '../navigation/tour-legs.js';
import { cornerReach, easedHeights, roundCorners, type RoundedTrack } from './tour-track.js';
import type { SceneData, TourCheckpoint, Vec2, Vec3 } from './types.js';

/** A look direction: yaw 0 = +Z, positive toward +X; pitch positive up. Radians. */
export type TourLook = { readonly yaw: number; readonly pitch: number };

/**
 * One key of the gaze track, at path index `at`. The route's own vocabulary —
 * the player's input, never the document's: an authored `autotour` key is the
 * `target` kind, a checkpoint route adds a camera's `direction` and the
 * `travel` look (along the path, at level pitch).
 */
export type RouteGazeKey =
  | { readonly at: number; readonly target: Vec3 }
  | { readonly at: number; readonly direction: TourLook }
  | { readonly at: number; readonly travel: true };

/**
 * What the tour player rides. The authored `autotour` IS one (no `kind`); a
 * checkpoint route says so with `kind: 'checkpoints'`, which tells the player
 * that the path is already the smooth curve (ride it as a polyline, never
 * fillet it off the cameras) and that the run is entered with a glide to camera 1.
 */
export type TourRoute = {
  readonly kind?: 'checkpoints';
  readonly speed?: number;
  readonly path: readonly Vec3[];
  readonly gaze?: readonly RouteGazeKey[];
  readonly zones?: SceneData['autotour']['zones'];
  /** A checkpoint route's cameras: the `path` index of each, in tour order. */
  readonly cameras?: readonly number[];
};

/** Cruise speed when `SceneData.autotour.speed` is not authored, metres/second. */
export const DEFAULT_TOUR_SPEED_MPS = 1.4;

/**
 * Metres between two samples of the checkpoint route handed to the player.
 *
 * Parsed, not written as a bare literal: Bun 1.4.2 inlines a literal `const`
 * into its uses, and its line coverage then reports everything from here to
 * the end of the file as never run (measured: 14.8 % of this file
 * reported, 84.8 % actually run), which sank `src/scene` under its floor.
 * Same value, same type.
 */
export const TOUR_SPLINE_STEP_M = Number('0.1');
/**
 * Path metres the gaze takes per radian of turn between a camera's view and
 * the travel direction: a half-turn takes about three metres, so at walking
 * pace the view never swings faster than a person turning their head.
 */
export const TOUR_GAZE_METRES_PER_RAD = 1;
/** Shortest and longest such turn, metres of path. */
const GAZE_TURN_MIN_M = 0.75;
const GAZE_TURN_MAX_M = 3;
/** Travel look must hold for at least this much of a leg to be worth the two turns, metres. */
const TRAVEL_HOLD_MIN_M = 0.3;
/** The chord the travel direction is read along, metres (the player reads it the same way). */
const TRAVEL_CHORD_M = 1;
/** How many times a corner whose rounding fails the leg check is rounded less before it stays sharp. */
const ROUNDING_ATTEMPTS = 6;
/** A rounding shorter than this that still fails goes straight to the sharp corner, metres. */
const ROUNDING_MIN_M = 0.05;
/** How far from an opening's waypoint its height band holds the track, metres. */
const BAND_REACH_M = 0.5;

/** Whether the document carries a checkpoint route the tour should ride. */
export function hasTourRoute(scene: Pick<SceneData, 'tourCheckpoints'>): boolean {
  return (scene.tourCheckpoints?.length ?? 0) >= 2;
}

/**
 * The checkpoint route as a dense polyline, in tour order.
 *
 * With `navigation`: each pair of consecutive cameras is joined by a chain
 * through the openings (`navigation.route`: doors, else one window), and the
 * whole control polyline — every camera, every chain waypoint — has its
 * corners rounded (`tour-track.ts`): a waypoint's corner
 * is cut by a bounded fillet, a camera and an opening's pinned centre are
 * passed EXACTLY on a curve with a continuous direction. A corner whose
 * curve fails the leg check (`legIsLegal`: off the walkable space, or
 * through a wall outside an opening) is rounded less and less, down to the
 * bare chain corner, which crosses each wall at its pinned centre by
 * construction. A pair no chain joins at all (a room with no opening) keeps
 * the straight hop. Heights ease from camera to camera along each leg
 * (`easedHeights`), under a door head and inside a window's band.
 *
 * Without `navigation` (no solved plan at hand): the camera positions alone,
 * their corners rounded the same way.
 *
 * `at[i]` is the index in `path` of checkpoint `i`. Two consecutive checkpoints
 * on the same spot collapse into one path point.
 */
export function checkpointPathOf(checkpoints: readonly TourCheckpoint[], navigation?: TourNavigation): { path: Vec3[]; at: number[] } {
  const cameras: Vec3[] = [];
  const cameraOf: number[] = [];
  for (const checkpoint of checkpoints) {
    const last = cameras.at(-1);
    if (!last || gap(last, checkpoint.position) > 1e-6) cameras.push({ ...checkpoint.position });
    cameraOf.push(cameras.length - 1);
  }
  if (cameras.length < 2) return { path: cameras.map((point) => ({ ...point })), at: cameraOf };

  const controls = controlsOf(cameras, navigation);
  const reach = cornerReach(controls.points, controls.through);
  let ride = rideOf(roundCorners(controls.points, controls.through, reach, TOUR_SPLINE_STEP_M), controls, cameras, navigation);
  if (!navigation) return { path: ride.path, at: cameraOf.map((camera) => ride.at[camera]!) };
  for (let attempt = 0; attempt < ROUNDING_ATTEMPTS; attempt += 1) {
    const failing = illegalSamples(ride.path, ride.at, navigation);
    if (failing.length === 0) break;
    let shrunk = false;
    ride.track.span.forEach(([first, last], index) => {
      const arms = reach[index]!;
      if (arms.before <= 0 || !failing.some((sample) => sample >= first - 1 && sample <= last + 1)) return;
      reach[index] =
        Math.min(arms.before, arms.after) < ROUNDING_MIN_M ? { before: 0, after: 0 } : { before: arms.before / 2, after: arms.after / 2 };
      shrunk = true;
    });
    if (!shrunk) break;
    ride = rideOf(roundCorners(controls.points, controls.through, reach, TOUR_SPLINE_STEP_M), controls, cameras, navigation);
  }
  return { path: ride.path, at: cameraOf.map((camera) => ride.at[camera]!) };
}

/**
 * The route the tour rides for `scene`: the checkpoint route when there are at
 * least two cameras, else the authored `autotour` verbatim. Zones never
 * survive the derivation — they index waypoints of the authored path, and the
 * checkpoint path is a different polyline; the player derives a checkpoint
 * run's speed from the track itself (`camera/tour-motion.ts`).
 *
 * `navigation` is the walkable space of the scene's solved plan
 * (`navigation/tour-legs.tourNavigation`); without it the legs are the
 * rounded polyline through the cameras.
 */
export function tourRouteOf(scene: Pick<SceneData, 'autotour' | 'tourCheckpoints'>, navigation?: TourNavigation): TourRoute {
  const checkpoints = scene.tourCheckpoints;
  if (!hasTourRoute(scene) || !checkpoints) return scene.autotour;
  const { path, at } = checkpointPathOf(checkpoints, navigation);
  // Every camera on one spot: no trajectory, the authored route stays.
  if (path.length < 2) return scene.autotour;
  // `exactOptionalPropertyTypes` plus the schema's readonly fields: the speed
  // is spread in only when the document authors one, never set to `undefined`.
  return {
    kind: 'checkpoints',
    ...(scene.autotour.speed === undefined ? {} : { speed: scene.autotour.speed }),
    path,
    gaze: gazeKeysOf(checkpoints, path, at),
    cameras: at,
  };
}

/**
 * Each camera's own direction at the camera; on a leg long enough to travel,
 * the level travel look from a turn's length after the camera to a turn's
 * length before the next one, each turn sized by its angle
 * (`TOUR_GAZE_METRES_PER_RAD`). The player eases between neighbouring keys,
 * so the view turns from a camera's view into the travel direction and back
 * into the next camera's view before arrival. A leg too short for both turns
 * turns straight from one camera's view into the next one's.
 */
function gazeKeysOf(checkpoints: readonly TourCheckpoint[], path: readonly Vec3[], at: readonly number[]): RouteGazeKey[] {
  const distance = cumulative(path);
  const keys: RouteGazeKey[] = [];
  checkpoints.forEach((checkpoint, index) => {
    keys.push({ at: at[index]!, direction: { yaw: checkpoint.yaw, pitch: checkpoint.pitch } });
    const next = at[index + 1];
    const arriving = checkpoints[index + 1];
    if (next === undefined || !arriving) return;
    const start = distance[at[index]!]!;
    const end = distance[next]!;
    const leaveYaw = chordYaw(path, distance, start, Math.min(end, start + TRAVEL_CHORD_M));
    const arriveYaw = chordYaw(path, distance, Math.max(start, end - TRAVEL_CHORD_M), end);
    if (leaveYaw === null || arriveYaw === null) return;
    const out = turnLength(checkpoint, leaveYaw);
    const into = turnLength(arriving, arriveYaw);
    if (out + into + TRAVEL_HOLD_MIN_M > end - start) return;
    const leave = indexAtDistance(distance, start + out);
    const arrive = indexAtDistance(distance, end - into);
    if (leave > at[index]! && arrive > leave && arrive < next) keys.push({ at: leave, travel: true }, { at: arrive, travel: true });
  });
  return keys;
}

/** Path metres a turn from `camera`'s view to a level look along `yaw` takes. */
function turnLength(camera: TourCheckpoint, yaw: number): number {
  const turn = Math.abs(shortYaw(camera.yaw, yaw)) + Math.abs(camera.pitch);
  return Math.min(GAZE_TURN_MAX_M, Math.max(GAZE_TURN_MIN_M, turn * TOUR_GAZE_METRES_PER_RAD));
}

/** Yaw of the chord between two path distances, `null` when it has no plan length. */
function chordYaw(path: readonly Vec3[], distance: readonly number[], from: number, to: number): number | null {
  const a = path[indexAtDistance(distance, from)]!;
  const b = path[indexAtDistance(distance, to)]!;
  if (flat(a, b) < 1e-6) return null;
  return Math.atan2(b.x - a.x, b.z - a.z);
}

/** `to - from` wrapped into `[-PI, PI)`. */
function shortYaw(from: number, to: number): number {
  const turn = 2 * Math.PI;
  return ((((to - from + Math.PI) % turn) + turn) % turn) - Math.PI;
}

// ---- The legs ---------------------------------------------------------------

/** The control polyline: every camera and every chain waypoint, distinct, with what each one asks of the track. */
type Controls = {
  points: Vec2[];
  /** Whether the track must pass exactly through the control (a camera, an opening's pinned centre). */
  through: boolean[];
  /** The height band an opening's waypoint keeps, `null` elsewhere. */
  band: Array<{ low: number; high: number } | null>;
  /** The control index of each camera. */
  camera: number[];
};

function controlsOf(cameras: readonly Vec3[], navigation: TourNavigation | undefined): Controls {
  const controls: Controls = { points: [], through: [], band: [], camera: [] };
  const push = (point: Vec2, through: boolean, band: { low: number; high: number } | null): void => {
    const last = controls.points.at(-1);
    if (last && flat(last, point) < 1e-6) {
      controls.through[controls.through.length - 1] ||= through;
      return;
    }
    controls.points.push({ x: point.x, z: point.z });
    controls.through.push(through);
    controls.band.push(band);
  };
  push(cameras[0]!, true, null);
  controls.camera.push(0);
  for (let leg = 1; leg < cameras.length; leg += 1) {
    const chain = navigation?.route(cameras[leg - 1]!, cameras[leg]!) ?? null;
    if (chain && chain.length >= 2) {
      for (const waypoint of chain.slice(1, -1)) {
        const band = waypoint.low === undefined && waypoint.high === undefined ? null : bandOf(waypoint);
        push(waypoint, waypoint.pinned === true, band);
      }
    }
    push(cameras[leg]!, true, null);
    controls.camera.push(controls.points.length - 1);
  }
  return controls;
}

function bandOf(waypoint: TourWaypoint): { low: number; high: number } {
  return { low: waypoint.low ?? Number.NEGATIVE_INFINITY, high: waypoint.high ?? Number.POSITIVE_INFINITY };
}

/**
 * The rounded track lifted to 3D: per leg, heights eased from one camera to
 * the next, kept under a door head and inside the band of every opening
 * waypoint within `BAND_REACH_M`. `at` is the path index of each camera.
 */
function rideOf(
  track: RoundedTrack,
  controls: Controls,
  cameras: readonly Vec3[],
  navigation: TourNavigation | undefined,
): { track: RoundedTrack; path: Vec3[]; at: number[] } {
  const path: Vec3[] = [];
  const at: number[] = [0];
  const banded = controls.band.flatMap((band, index) => (band ? [{ point: controls.points[index]!, band }] : []));
  for (let leg = 1; leg < cameras.length; leg += 1) {
    const first = track.at[controls.camera[leg - 1]!]!;
    const last = track.at[controls.camera[leg]!]!;
    const points = track.points.slice(first, last + 1);
    const near = (point: Vec2) => banded.filter((entry) => flat(entry.point, point) <= BAND_REACH_M).map((entry) => entry.band);
    const high = points.map((point) =>
      Math.min(navigation?.ceilingAt(point) ?? Number.POSITIVE_INFINITY, ...near(point).map((band) => band.high)),
    );
    const low = points.map((point) => Math.max(Number.NEGATIVE_INFINITY, ...near(point).map((band) => band.low)));
    const heights = easedHeights(points, cameras[leg - 1]!.y, cameras[leg]!.y, low, high);
    points.forEach((point, index) => {
      if (leg > 1 && index === 0) return;
      path.push({ x: point.x, y: heights[index]!, z: point.z });
    });
    at.push(path.length - 1);
  }
  return { track, path, at };
}

/**
 * The leg check every ride passes before the tour rides it:
 * every hop crosses walls only inside an opening, clear of its jambs and at a
 * height inside it, and every sample stands on walkable ground, in an
 * opening's passage, or on the short hop that joins a camera against a wall
 * to the walkable area.
 */
export function legIsLegal(samples: readonly Vec3[], navigation: TourNavigation): boolean {
  return illegalAt(samples, navigation).length === 0;
}

/** The indexes of the samples (both ends of a failing hop) that break `legIsLegal`. */
function illegalAt(samples: readonly Vec3[], navigation: TourNavigation): number[] {
  const failing: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    if (!navigation.throughOpenings(samples[index - 1]!, samples[index]!)) failing.push(index - 1, index);
  }
  samples.forEach((sample, index) => {
    if (index === 0 || index === samples.length - 1) return;
    if (!navigation.walkable(sample) && !navigation.inOpening(sample) && !nearEnd(samples, sample)) failing.push(index);
  });
  return failing;
}

/** `illegalAt` over every leg of `path` (`at`: the camera indexes), in path indexes. */
function illegalSamples(path: readonly Vec3[], at: readonly number[], navigation: TourNavigation): number[] {
  return at.slice(1).flatMap((end, leg) => {
    const start = at[leg] ?? 0;
    return illegalAt(path.slice(start, end + 1), navigation).map((index) => index + start);
  });
}

/** Whether `sample` is within the joining hop of either end of its leg. */
function nearEnd(samples: readonly Vec3[], sample: Vec3): boolean {
  const reach = 0.6;
  return flat(sample, samples[0]!) <= reach || flat(sample, samples.at(-1)!) <= reach;
}

function gap(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function flat(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Cumulative 3D arc length at every point of `path`. */
function cumulative(path: readonly Vec3[]): number[] {
  const out = [0];
  for (let index = 1; index < path.length; index += 1) out.push(out[index - 1]! + gap(path[index - 1]!, path[index]!));
  return out;
}

/** The first index whose cumulative distance reaches `target`. */
function indexAtDistance(distance: readonly number[], target: number): number {
  const index = distance.findIndex((value) => value >= target);
  return index < 0 ? distance.length - 1 : index;
}
