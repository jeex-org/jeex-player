/**
 * One smooth curve through a cleared polyline, sampled at equal arc length.
 *
 * A route from `room-graph.ts` is a chain of clear legs, not a track: it turns
 * on the spot at every waypoint and stops twice at every doorway. Driving a
 * camera along it waypoint by waypoint is what made scripted travel feel
 * broken. This module turns the chain into the line a person would actually
 * walk — corners cut where cutting them is clear, corners rounded, the whole
 * thing resampled every `TRAVEL_SAMPLE_M` — so the driver only has to advance
 * one arc-length variable at a constant speed.
 *
 * Invariants (see `travel-path.test.ts`):
 * - consecutive samples are exactly `TRAVEL_SAMPLE_M` apart (the tail is
 *   whatever is left), so distance and time are the same thing to the caller;
 * - every shortcut and every rounded corner was accepted by the SAME `clear`
 *   predicate that accepted the route's legs — the curve never leaves the space
 *   the router proved walkable;
 * - the two standoff points of a doorway are never pulled out of the route and
 *   the middle of the leg between them stays straight, so a door is crossed
 *   square to the opening and not on a diagonal.
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, dist, len, norm, sub } from '../plan/plan-geometry.js';
import type { Vec2 } from '../scene/types.js';

/** Spacing of the samples the camera is driven along, metres. */
export const TRAVEL_SAMPLE_M = 0.05;
/** Largest bite a rounded corner takes out of each of its legs, metres. */
export const TURN_RADIUS_M = 0.9;
/** Share of a leg one corner may eat; two corners must not meet in the middle. */
const CORNER_CUT_FRACTION = 0.48;
/** Share of the FIRST or LAST leg its one corner may eat. */
const END_CUT_FRACTION = 0.9;
/**
 * How much of a doorway leg a turn may borrow at each end, metres. The rest —
 * the middle of the standoff pair, which is the part inside the wall — is
 * crossed dead straight and square to the opening.
 */
const DOOR_CUT_M = 0.4;
/** Share of a doorway leg one of its two corners may borrow. */
const DOOR_CUT_FRACTION = 0.45;
/** Below this a cut is not worth trying: the corner stays sharp, metres. */
const MIN_CUT_M = 0.15;
/** A fillet tighter than this is not a turn but a pivot; the corner stays sharp, metres. */
const MIN_RADIUS_M = 0.05;
/** Two waypoints closer than this are the same waypoint, metres. */
const MERGE_M = 1e-4;
/** Corners flatter than this are not corners at all, radians. */
const STRAIGHT_RAD = 1e-3;

/**
 * A route waypoint. `door` marks the two standoff points of one doorway, whose
 * shared leg must stay straight (`room-graph.routeToRoom` sets it).
 */
export type TravelWaypoint = Vec2 & { door?: string | undefined };

/**
 * A waypoint copied field by field, so an OPTIONAL door tag stays optional.
 *
 * `{ ...point }` would carry `door: undefined` into the copy, and a waypoint
 * with an explicit `undefined` tag is not the same object as one without it:
 * `'door' in waypoint` answers differently, and a structural comparison in a
 * test fails on a key nobody set.
 */
export function cloneWaypoint(waypoint: TravelWaypoint): TravelWaypoint {
  return { x: waypoint.x, z: waypoint.z, ...(waypoint.door === undefined ? {} : { door: waypoint.door }) };
}

export type TravelPath = {
  /** Samples at equal arc-length spacing, first = start, last = goal. */
  points: Vec2[];
  /** Cumulative distance of every sample, metres; `length = at.at(-1)`. */
  at: number[];
  length: number;
};

/** Whether a straight step from `a` to `b` is walkable; the router's own test. */
export type ClearTest = (a: Vec2, b: Vec2) => boolean;

/** Drops repeated waypoints, keeping whichever of a pair carries a door tag. */
function merged(route: readonly TravelWaypoint[]): TravelWaypoint[] {
  const points: TravelWaypoint[] = [];
  for (const point of route) {
    const previous = points.at(-1);
    if (previous && dist(previous, point) <= MERGE_M) {
      if (point.door !== undefined) points[points.length - 1] = point;
      continue;
    }
    points.push(point);
  }
  return points;
}

/**
 * Removes every waypoint a straight line can skip.
 *
 * A door standoff point is never removed: it is what squares the camera up to
 * the opening, and the leg between a pair is the one leg that has to stay.
 */
function stringPull(route: TravelWaypoint[], clear: ClearTest): TravelWaypoint[] {
  const points = [...route];
  for (let i = 1; i + 1 < points.length;) {
    const point = points[i]!;
    if (point.door === undefined && clear(points[i - 1]!, points[i + 1]!)) {
      points.splice(i, 1);
      // A removal can open the shortcut its neighbour was waiting for.
      if (i > 1) i -= 1;
      continue;
    }
    i += 1;
  }
  return points;
}

/** Whether the leg starting at `index` is the straight run through one doorway. */
function isDoorLeg(points: TravelWaypoint[], index: number): boolean {
  const a = points[index];
  const b = points[index + 1];
  return a?.door !== undefined && a.door === b?.door;
}

/**
 * Samples of the circular fillet that leaves the incoming leg `cut` metres
 * before `corner` and rejoins the outgoing one `cut` metres after it.
 *
 * A circle, not a Bézier: the fillet's whole job is to keep the turn rate low,
 * and for a given cut the constant-curvature arc is the flattest curve there
 * is — every spline with the same tangents has a tighter spot somewhere.
 */
function fillet(corner: Vec2, inDir: Vec2, outDir: Vec2, turn: number, cut: number): Vec2[] {
  const half = Math.abs(turn) / 2;
  const radius = cut / Math.tan(half);
  const start = { x: corner.x - inDir.x * cut, z: corner.z - inDir.z * cut };
  if (radius < MIN_RADIUS_M) return [];
  // Centre on the internal bisector, `radius / cos(turn/2)` from the corner.
  const bisector = norm(sub(outDir, inDir));
  if (len(bisector) < EPS) return [];
  const centre = {
    x: corner.x + (bisector.x * radius) / Math.cos(half),
    z: corner.z + (bisector.z * radius) / Math.cos(half),
  };
  const end = { x: corner.x + outDir.x * cut, z: corner.z + outDir.z * cut };
  const from = Math.atan2(start.z - centre.z, start.x - centre.x);
  let sweep = Math.atan2(end.z - centre.z, end.x - centre.x) - from;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const steps = Math.max(2, Math.ceil((radius * Math.abs(sweep)) / TRAVEL_SAMPLE_M));
  const samples: Vec2[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = from + (sweep * step) / steps;
    samples.push({ x: centre.x + Math.cos(angle) * radius, z: centre.z + Math.sin(angle) * radius });
  }
  return samples;
}

/** Whether every consecutive pair of `samples` is walkable. */
function samplesClear(samples: readonly Vec2[], clear: ClearTest): boolean {
  for (let i = 0; i + 1 < samples.length; i += 1) {
    if (!clear(samples[i]!, samples[i + 1]!)) return false;
  }
  return true;
}

/**
 * How far the corner at `corner` may cut into the leg that runs to `end`.
 *
 * A doorway leg lends less than a room one and never more than `DOOR_CUT_M`,
 * so a straight band across the wall survives whatever the turn on either side
 * asks for. Lending NOTHING — the first design — turns
 * both standoff points into hairpins no constant-speed camera can follow, so
 * the leg gives up its two ends.
 */
function cutRoom(points: TravelWaypoint[], end: number, corner: number): number {
  const leg = dist(points[corner]!, points[end]!);
  if (isDoorLeg(points, Math.min(corner, end))) return Math.min(DOOR_CUT_M, DOOR_CUT_FRACTION * leg);
  // The first and last legs answer to one corner only, so that corner may take
  // nearly all of them; every other leg is shared with the corner at its far
  // end and the two bites must not meet.
  const shared = end > 0 && end + 1 < points.length;
  return Math.min(TURN_RADIUS_M, (shared ? CORNER_CUT_FRACTION : END_CUT_FRACTION) * leg);
}

/** Signed turn between two headings, wrapped to ±π. */
function turnBetween(inDir: Vec2, outDir: Vec2): number {
  let turn = Math.atan2(outDir.x, outDir.z) - Math.atan2(inDir.x, inDir.z);
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  return turn;
}

/** The dense polyline of the whole curve: straight runs plus rounded corners. */
function roundCorners(points: TravelWaypoint[], clear: ClearTest): Vec2[] {
  const curve: Vec2[] = [{ x: points[0]!.x, z: points[0]!.z }];
  for (let i = 1; i + 1 < points.length; i += 1) {
    const corner = points[i]!;
    const inDir = norm(sub(corner, points[i - 1]!));
    const outDir = norm(sub(points[i + 1]!, corner));
    if (len(inDir) < EPS || len(outDir) < EPS || Math.abs(turnBetween(inDir, outDir)) < STRAIGHT_RAD) {
      curve.push({ x: corner.x, z: corner.z });
      continue;
    }
    // The same bite out of both legs: a fillet is only as round as its
    // stingier side, and taking more from the other one buys nothing.
    const room = Math.min(cutRoom(points, i - 1, i), cutRoom(points, i + 1, i));
    const turn = turnBetween(inDir, outDir);

    let rounded: Vec2[] | null = null;
    for (let cut = room; cut >= MIN_CUT_M; cut /= 2) {
      const samples = fillet(corner, inDir, outDir, turn, cut);
      if (samples.length === 0 || !samplesClear(samples, clear)) continue;
      rounded = samples;
      break;
    }
    // A corner nothing rounds stays sharp: still one continuous motion, only
    // with the head turning ahead of the body (`camera-controller.ts`).
    if (rounded) curve.push(...rounded);
    else curve.push({ x: corner.x, z: corner.z });
  }
  const goal = points.at(-1)!;
  curve.push({ x: goal.x, z: goal.z });
  return curve;
}

/** Equal-arc-length samples of a dense polyline; the tail is whatever is left. */
function resample(curve: Vec2[]): TravelPath {
  const cumulative: number[] = [0];
  const kept: Vec2[] = [curve[0]!];
  for (let i = 1; i < curve.length; i += 1) {
    const step = dist(kept.at(-1)!, curve[i]!);
    if (step < EPS) continue;
    kept.push(curve[i]!);
    cumulative.push(cumulative.at(-1)! + step);
  }
  const total = cumulative.at(-1)!;
  if (kept.length < 2 || total < EPS) return { points: [{ ...kept[0]! }], at: [0], length: 0 };

  const points: Vec2[] = [];
  const at: number[] = [];
  let segment = 0;
  const count = Math.floor(total / TRAVEL_SAMPLE_M);
  for (let index = 0; index <= count; index += 1) {
    const s = index * TRAVEL_SAMPLE_M;
    while (segment + 2 < kept.length && cumulative[segment + 1]! < s) segment += 1;
    const a = kept[segment]!;
    const b = kept[segment + 1]!;
    const span = cumulative[segment + 1]! - cumulative[segment]!;
    const local = span < EPS ? 0 : Math.min(1, Math.max(0, (s - cumulative[segment]!) / span));
    points.push({ x: a.x + (b.x - a.x) * local, z: a.z + (b.z - a.z) * local });
    at.push(s);
  }
  if (total - at.at(-1)! > EPS) {
    points.push({ ...kept.at(-1)! });
    at.push(total);
  } else {
    points[points.length - 1] = { ...kept.at(-1)! };
    at[at.length - 1] = total;
  }
  return { points, at, length: total };
}

/**
 * Turns a clear polyline into one smooth curve that keeps every leg's clearance.
 *
 * `clear(a, b)` is the same predicate `routeToRoom` accepts the legs with:
 * the plan's `canTraverse` and the furniture test. Shortcuts and rounded
 * corners are only kept when it accepts them, so a curve can never be less
 * walkable than the route it came from.
 */
export function buildTravelPath(route: readonly TravelWaypoint[], clear: ClearTest): TravelPath {
  const points = merged(route);
  if (points.length === 0) return { points: [{ x: 0, z: 0 }], at: [0], length: 0 };
  if (points.length === 1) return { points: [{ x: points[0]!.x, z: points[0]!.z }], at: [0], length: 0 };
  return resample(roundCorners(stringPull(points, clear), clear));
}

/** Point on the path at distance `s` (clamped), linear between samples. */
export function pointAt(path: TravelPath, s: number): Vec2 {
  const points = path.points;
  if (points.length < 2) return { ...points[0]! };
  const clamped = Math.min(path.length, Math.max(0, s));
  const index = Math.min(points.length - 2, Math.max(0, Math.floor(clamped / TRAVEL_SAMPLE_M)));
  const a = points[index]!;
  const b = points[index + 1]!;
  const span = path.at[index + 1]! - path.at[index]!;
  const local = span < EPS ? 0 : (clamped - path.at[index]!) / span;
  return { x: a.x + (b.x - a.x) * local, z: a.z + (b.z - a.z) * local };
}

/** Unit tangent at distance `s`, central difference over one sample. */
export function tangentAt(path: TravelPath, s: number): Vec2 {
  const half = TRAVEL_SAMPLE_M / 2;
  const step = sub(pointAt(path, s + half), pointAt(path, s - half));
  if (len(step) > EPS) return norm(step);
  const whole = sub(pointAt(path, path.length), pointAt(path, 0));
  return len(whole) > EPS ? norm(whole) : { x: 0, z: 1 };
}
