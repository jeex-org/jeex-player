/**
 * The glide a checkpoint run opens with (`GLIDE_SECONDS`): a straight line
 * from the view on screen to one pose,
 * position and look together, eased in and out — the one deliberate
 * exception to the route's wall rule, because it lasts a second and ends on
 * a camera. A duration of 0 is the reduced-motion cut. The tour player opens
 * a run with it; the walk entry and a short walk step glide with it alone.
 */

import * as THREE from 'three';
import { lookPoint, turnAim, yawDelta, type Aim } from './tour-path.js';
import { clamp, inverseSmoothstep, smoothstep } from '../shared/math.js';

/** Seconds of the glide: from the current view to camera 1. */
export const GLIDE_SECONDS = 1;
/**
 * The longest step the glide takes between two drawn frames, metres. A
 * one-second ease from a presentation view 24 m away moves the camera 1.8 m
 * in one frame at the runtime's 50 ms delta clamp: a visible jump on a slow
 * machine, or during the first heavy frames of the far view. A slow frame
 * therefore slows the glide instead; at 60 fps
 * the cap binds only beyond about 40 m, so the usual glide is exactly
 * `GLIDE_SECONDS` long.
 */
export const GLIDE_MAX_STEP_M = 1;
/** A view this close to the target's look, radians (and close enough to its place), is already there: no glide. */
const GLIDE_LOOK_MIN = 0.02;
/** How far a look reaches ahead of the eye when a pose names no distance, metres. */
const GAZE_REACH_M = 3;

type Pose = { position: THREE.Vector3; target: THREE.Vector3 };

export type Glide = { elapsed: number; duration: number; from: THREE.Vector3; fromAim: Aim; to: THREE.Vector3; toAim: Aim };

/**
 * The glide from `from` to `to`, or `null` when there is nothing to glide
 * (the view already stands within `near` metres of `to`, looking its way).
 * Without `from` it is a cut.
 */
export function glideTo(to: Pose, from: Pose | undefined, instant: boolean, near: number): Glide | null {
  const toAim = aimOf(to);
  if (!from) return { elapsed: 0, duration: 0, from: to.position, fromAim: toAim, to: to.position, toAim };
  const fromAim = aimOf(from);
  const still = Math.abs(yawDelta(fromAim.yaw, toAim.yaw)) + Math.abs(fromAim.pitch - toAim.pitch) <= GLIDE_LOOK_MIN;
  if (from.position.distanceTo(to.position) <= near && still) return null;
  return { elapsed: 0, duration: instant ? 0 : GLIDE_SECONDS, from: from.position.clone(), fromAim, to: to.position, toAim };
}

/** Advances the glide by one frame: the pose to draw, or `null` once it has landed. */
export function glideStep(glide: Glide, delta: number): Pose | null {
  glide.elapsed += glideAdvance(glide, delta);
  if (glide.duration <= 0 || glide.elapsed >= glide.duration) return null;
  const u = smoothstep(glide.elapsed / glide.duration);
  const position = glide.from.clone().lerp(glide.to, u);
  return { position, target: lookPoint(position, turnAim(glide.fromAim, glide.toAim, u)) };
}

/**
 * How far the glide clock may move this frame: `delta`, or less when the
 * eased position would step more than `GLIDE_MAX_STEP_M` along the line.
 */
function glideAdvance(glide: Glide, delta: number): number {
  const length = glide.from.distanceTo(glide.to);
  if (glide.duration <= 0 || length <= GLIDE_MAX_STEP_M) return delta;
  const reached = smoothstep(glide.elapsed / glide.duration) + GLIDE_MAX_STEP_M / length;
  if (reached >= 1) return delta;
  return Math.min(delta, inverseSmoothstep(reached) * glide.duration - glide.elapsed);
}

/** The aim of a pose: the direction from its eye to its target, and how far that is. */
export function aimOf(pose: Pose): Aim {
  const offset = pose.target.clone().sub(pose.position);
  const reach = offset.length();
  if (reach < 1e-9) return { yaw: 0, pitch: 0, reach: GAZE_REACH_M };
  return { yaw: Math.atan2(offset.x, offset.z), pitch: Math.asin(clamp(offset.y / reach, -1, 1)), reach };
}
