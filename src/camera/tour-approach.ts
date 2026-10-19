/**
 * The APPROACH of an authored tour: the fly-in from wherever the camera
 * happens to be to the head of the route, a phase of its own with its own
 * curve and clock (`tour-player.ts`, progress invariant). It never enters the
 * route's samples, length, duration, speed zones or gaze track, so a host
 * that scrubs by fraction always addresses the same authored metres.
 */

import type * as THREE from 'three';
import { positionOnPath, sampleFilletedPath, FILLET_SAMPLE, type SampledPath } from './tour-path.js';
import { smoothstep } from '../shared/math.js';

/** Seconds of the authored route's ease-in, which the approach shares. */
export const START_RAMP = 1.2;
/** Target length of the approach fly-in, seconds. */
const LEAD_SECONDS = 7;
/** Closer than this to the head of the route, metres, the camera is already on it. */
const APPROACH_MIN = 0.4;

type Pose = { position: THREE.Vector3; target: THREE.Vector3 };

/** The fly-in that precedes the route when the camera starts off it. */
export type Approach = {
  path: SampledPath;
  /** Cruise speed of the fly-in, m/s. */
  speed: number;
  duration: number;
  elapsed: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  /** Route distance the fly-in lands on, and the route clock that goes with it. */
  entryDistance: number;
  entryTime: number;
};

/**
 * Metres covered by the approach after `t` seconds: cruise `speed` with the
 * same `START_RAMP` ease-in the route uses, so a fly-in that begins on the
 * current view does not jerk out of it, and arrives at full speed.
 */
function approachDistance(t: number, speed: number): number {
  if (t <= 0) return 0;
  return t <= START_RAMP ? (speed * t * t) / (2 * START_RAMP) : speed * (t - START_RAMP / 2);
}

/**
 * The fly-in from `from` to `route`, or `null` when the camera is already on
 * it.
 *
 * It lands on `entry`, one `START_RAMP` INTO the route rather than on its
 * first metre: the route's own ease-in is baked into its time table, so a
 * hand-over at distance 0 would stop the camera dead at the junction and
 * accelerate it again. Landing where the ramp is spent joins two runs already
 * at speed.
 */
export function approachTo(
  from: Pose,
  route: SampledPath,
  entry: { distance: number; pose: Pose; time: number },
  baseSpeed: number,
): Approach | null {
  const first = route.samples[0];
  if (!first) return null;
  const head = first.p;
  if (from.position.distanceTo(head) <= APPROACH_MIN) return null;
  const controls =
    entry.distance > FILLET_SAMPLE
      ? [from.position.clone(), head.clone(), entry.pose.position.clone()]
      : [from.position.clone(), head.clone()];
  const path = sampleFilletedPath(controls);
  if (path.length <= 1e-3) return null;
  // Fast enough that a twenty-metre approach is a dive, never a crawl at the
  // slowest indoor zone speed the route happens to open with.
  const speed = Math.max(baseSpeed, path.length / LEAD_SECONDS);
  return {
    path,
    speed,
    duration: path.length / speed + START_RAMP / 2,
    elapsed: 0,
    fromTarget: from.target.clone(),
    toTarget: entry.pose.target.clone(),
    entryDistance: entry.distance,
    entryTime: entry.time,
  };
}

/** Where the fly-in stands and looks after its `elapsed` seconds. */
export function approachPose(approach: Approach): Pose {
  const distance = Math.min(approach.path.length, approachDistance(approach.elapsed, approach.speed));
  const u = approach.path.length > 0 ? distance / approach.path.length : 1;
  return {
    position: positionOnPath(approach.path, distance),
    target: approach.fromTarget.clone().lerp(approach.toTarget, smoothstep(u)),
  };
}
