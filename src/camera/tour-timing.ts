/**
 * The pure tables of a tour route: where each look aims along the route, how
 * long a gaze transition lasts, which way round it turns, the authored route's
 * speed at every metre and its time→distance table.
 *
 * Every function here reads a sampled route and its keys and returns numbers;
 * none keeps state or touches the camera. `TourPlayer` builds its clip from
 * them once per route and reads `aimAt` per frame.
 *
 * Invariant: the time table is monotonic in both time and distance, starts at
 * `{ t: 0, d: 0 }` and ends with the hold on the final view at the route's
 * full length.
 */

import * as THREE from 'three';
import { positionOnPath, turnTrack, yawDelta, type Aim, type Look, type SampledPath } from './tour-path.js';
import { clamp, smoothstep } from '../shared/math.js';
import { START_RAMP } from './tour-approach.js';

const GAZE_TURN_RATE = 30; // deg/s of gaze panning; transition length follows the turn angle
/** Metres of path per gaze transition, at least. */
export const GAZE_MIN_WINDOW = 2.0;
const GAZE_MAX_WINDOW = 7.0;
const ZONE_BLEND = 2.0; // metres over which adjacent speed zones blend
const END_RAMP = 1.4; // seconds of ease-out
const END_RAMP_FLOOR = 0.45; // slowest fraction of cruise speed at the very end
/** Seconds held on the final view. */
export const END_HOLD = 0.4;
const TABLE_STEP = 0.05;
/** Path metres between two samples of a gaze transition's way round (`turnsOf`). */
const TURN_GRID_M = 0.02;
/** How far a direction or travel look reaches ahead of the eye, metres (the floor guard may shorten it). */
export const GAZE_REACH_M = 3;
/** Path metres ahead a `travel` key of a non-checkpoint route aims at. */
const TRAVEL_LOOKAHEAD_M = 1;

/** A gaze key placed on the route. */
type PlacedLook = { d: number; look: Look };

/**
 * A look resolved at `distance` along the route, seen from `eye` (the route
 * position there unless given): a target's direction and distance, a
 * camera's own direction, or the level direction of travel.
 */
export function aimAt(route: SampledPath, look: Look, distance: number, eye = positionOnPath(route, distance)): Aim {
  if ('target' in look) {
    const offset = look.target.clone().sub(eye);
    const reach = offset.length();
    if (reach < 1e-6) return { ...travelAim(route, distance), reach: 0 };
    return { yaw: Math.atan2(offset.x, offset.z), pitch: Math.asin(clamp(offset.y / reach, -1, 1)), reach };
  }
  if ('direction' in look) return { yaw: look.direction.yaw, pitch: look.direction.pitch, reach: GAZE_REACH_M };
  return { ...travelAim(route, distance), reach: GAZE_REACH_M };
}

/** The level direction of travel at `distance`: a chord one stride ahead, the route's last stride over its last metre. */
function travelAim(route: SampledPath, distance: number): { yaw: number; pitch: number } {
  const start = Math.max(0, Math.min(distance, route.length - TRAVEL_LOOKAHEAD_M));
  const from = positionOnPath(route, start);
  const to = positionOnPath(route, start + TRAVEL_LOOKAHEAD_M);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return { yaw: Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(dx, dz), pitch: 0 };
}

/** The way round of the transition from `from` into `next` over its window (`turnTrack`). */
export function turnsOf(route: SampledPath, from: Look, next: PlacedLook, window: number): number[] {
  return turnTrack(Math.max(1, Math.ceil(window / TURN_GRID_M)), (u) => {
    const d = next.d - window + window * u;
    return aimAt(route, next.look, d).yaw - aimAt(route, from, d).yaw;
  });
}

/** Gaze transition length in path metres, scaled by the turn angle at the next key. */
export function gazeWindow(route: SampledPath, current: PlacedLook, next: PlacedLook): number {
  const a = aimAt(route, current.look, current.d);
  const b = aimAt(route, next.look, next.d);
  if (a.reach < 1e-3 || b.reach < 1e-3) return GAZE_MIN_WINDOW;
  const angle = Math.abs(yawDelta(a.yaw, b.yaw)) * (180 / Math.PI);
  return THREE.MathUtils.clamp(angle / GAZE_TURN_RATE, GAZE_MIN_WINDOW, GAZE_MAX_WINDOW);
}

/** The authored route's cruise speed at `dist`, blended over `ZONE_BLEND` metres into each next zone. */
export function speedAt(zoneStarts: readonly { d: number; speed: number }[], baseSpeed: number, dist: number): number {
  let speed = zoneStarts[0]?.speed ?? baseSpeed;
  for (let index = 1; index < zoneStarts.length; index += 1) {
    // `index` is bounded by the loop condition.
    const zone = zoneStarts[index]!;
    if (dist >= zone.d) {
      speed = zone.speed;
    } else if (dist >= zone.d - ZONE_BLEND) {
      speed = THREE.MathUtils.lerp(speed, zone.speed, smoothstep((dist - (zone.d - ZONE_BLEND)) / ZONE_BLEND));
      break;
    } else {
      break;
    }
  }
  return speed;
}

/**
 * Integrates the authored route's speed profile (ease-in and ease-out
 * included) into a time→distance table; a checkpoint run's comes from
 * `tour-motion.ts`.
 *
 * The ease-out is measured in metres left, not against a guessed total run
 * time: the time estimate needs a fixed point that does not converge once the
 * speed zones are slower than the base speed, and the diverging pass leaves
 * the camera crawling at the ramp floor over the whole last leg.
 */
export function buildTimeTable(length: number, speedAtDistance: (dist: number) => number): Array<{ t: number; d: number }> {
  const samples: Array<{ t: number; d: number }> = [{ t: 0, d: 0 }];
  let time = 0;
  let dist = 0;
  let guard = 0;
  while (dist < length && guard < 60000) {
    time += TABLE_STEP;
    guard += 1;
    const cruise = speedAtDistance(dist);
    const tail = (length - dist) / Math.max(cruise * END_RAMP, 1e-6);
    const ramp = Math.min(1, time / START_RAMP, Math.max(END_RAMP_FLOOR, tail));
    const step = cruise * ramp * TABLE_STEP;
    dist = Math.min(length, dist + step);
    samples.push({ t: time, d: dist });
  }
  // Brief hold on the final view so the run lands softly instead of cutting off.
  samples.push({ t: time + END_HOLD, d: length });
  return samples;
}
