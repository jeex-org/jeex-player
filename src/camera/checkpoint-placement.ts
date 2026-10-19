/**
 * Where a NEW tour camera stands, as pure functions of the plan and a view:
 * every answer lies on
 * navigable floor, at eye height, with a level pitch — never inside a
 * partition wall (where placing it at the orbit target can land), and never
 * with the orbit's steep downward tilt.
 *
 * Two rules:
 * - an EYE pose (walk, «Look through») is copied exactly: that is the shot the
 *   author is looking at;
 * - an ORBIT view casts the screen centre onto the floor (fallback: the orbit
 *   target), stands it on navigable floor, and steps back toward the author so
 *   the camera looks INTO the space the author is looking at.
 *
 * `standOn` is the one gate all of them pass: `clampToNavigation` pulls a point
 * into the nearest room, `resolveNavigationTarget` steps it off furniture.
 */

import { clamp } from '../shared/math.js';
import {
  EYE_HEIGHT_M,
  clampToNavigation,
  isInDoorway,
  isNavigable,
  resolveNavigationTarget,
  type Obstacle,
} from '../navigation/navigation.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import {
  TOUR_CHECKPOINT_HEIGHT_MARGIN_M,
  TOUR_CHECKPOINT_HEIGHT_MIN_M,
  TOUR_PITCH_LIMIT_RAD,
  type SceneData,
  type TourCheckpoint,
  type Vec3,
} from '../scene/types.js';

/** The level pitch a new camera takes: a gentle −7°, inside a −5° to −10° band. */
export const LEVEL_PITCH_RAD = -(7 / 180) * Math.PI;
/** How far «Add from current view» steps back from the looked-at point toward the author, metres. */
export const STEP_BACK_M = 1.5;
/** Two cameras closer than half this share a spot; a new one steps on by this much, metres. */
export const ADD_SPACING_M = 1;
/**
 * The ceiling a placement falls back to before the first document answers.
 * Matches the schema's own floor (`ceilingHeight >= 2`) rounded up, so a clamp
 * against it can never put a marker through a real ceiling.
 */
export const FALLBACK_CEILING_M = 2.2;

/** What placement reads of the committed document. */
export type PlacementContext = {
  readonly plan: SolvedPlan;
  readonly scene: SceneData;
  readonly obstacles: readonly Obstacle[];
};

/** A camera's pose without its identity. */
export type CheckpointPose = Pick<TourCheckpoint, 'position' | 'yaw' | 'pitch'>;

/** Eye height clamped under the document's ceiling. */
export function eyeHeight(ceilingHeight: number, height = EYE_HEIGHT_M): number {
  return clamp(height, TOUR_CHECKPOINT_HEIGHT_MIN_M, ceilingHeight - TOUR_CHECKPOINT_HEIGHT_MARGIN_M);
}

/** Whether a plan point is somewhere the tour can stand (a room, or a doorway passage). */
export function canStand(plan: SolvedPlan, point: { x: number; z: number }): boolean {
  const probe = { x: point.x, y: EYE_HEIGHT_M, z: point.z };
  return isNavigable(plan, probe) || isInDoorway(plan, probe);
}

/** The nearest point the tour can stand on: into a room, then off the furniture. */
export function standOn(context: PlacementContext, point: { x: number; z: number }): { x: number; z: number } {
  const inside = clampToNavigation(context.plan, context.scene.ceilingHeight, { x: point.x, y: EYE_HEIGHT_M, z: point.z });
  const clear = resolveNavigationTarget(context.plan, context.scene, inside, context.obstacles);
  const chosen = canStand(context.plan, clear) ? clear : inside;
  return { x: chosen.x, z: chosen.z };
}

/** Yaw and pitch of a look from `from` toward `to` (yaw 0 = +Z, positive toward +X). */
export function lookAngles(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const horizontal = Math.hypot(dx, dz);
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, horizontal || 1e-6) };
}

/** The exact eye pose of a walk or a look-through, height and pitch clamped to what a checkpoint may carry. */
export function poseFromEye(ceilingHeight: number, eye: { position: Vec3; target: Vec3 }): CheckpointPose {
  const { yaw, pitch } = lookAngles(eye.position, eye.target);
  return {
    position: { x: eye.position.x, y: eyeHeight(ceilingHeight, eye.position.y), z: eye.position.z },
    yaw,
    pitch: clamp(pitch, -TOUR_PITCH_LIMIT_RAD, TOUR_PITCH_LIMIT_RAD),
  };
}

/**
 * The orbit rule: the looked-at floor point (`centre`, else the orbit
 * `target`) stood on navigable floor, then stepped back toward the author by
 * up to `STEP_BACK_M` — the longest step that still stands — and on past any
 * camera already at that spot. Yaw is the orbit's horizontal view direction,
 * pitch is level.
 */
export function poseFromOrbit(
  context: PlacementContext,
  view: { position: Vec3; target: Vec3; centre: Vec3 | null },
  existing: readonly TourCheckpoint[],
): CheckpointPose {
  const aim = view.centre ?? view.target;
  const { yaw } = lookAngles(view.position, aim);
  const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const looked = standOn(context, aim);
  let spot = looked;
  for (const back of [STEP_BACK_M, STEP_BACK_M * (2 / 3), STEP_BACK_M / 3]) {
    const candidate = { x: looked.x - forward.x * back, z: looked.z - forward.z * back };
    if (canStand(context.plan, candidate)) {
      spot = candidate;
      break;
    }
  }
  // A second «add» from the same view would stack a camera on the first: step
  // forward along the view until the spot is free, re-checking the floor.
  const occupied = (point: { x: number; z: number }): boolean =>
    existing.some((other) => Math.hypot(other.position.x - point.x, other.position.z - point.z) < ADD_SPACING_M / 2);
  for (let tries = 1; tries <= 8 && occupied(spot); tries += 1) {
    const candidate = { x: spot.x + forward.x * ADD_SPACING_M, z: spot.z + forward.z * ADD_SPACING_M };
    if (canStand(context.plan, candidate)) spot = candidate;
    else break;
  }
  return { position: { x: spot.x, y: eyeHeight(context.scene.ceilingHeight), z: spot.z }, yaw, pitch: LEVEL_PITCH_RAD };
}

/**
 * A click-to-place drop: the pressed floor point stood on navigable floor;
 * aimed at the release point when the press was dragged (more than 0.3 m on
 * the floor), else along `fallbackYaw` (the orbit's view direction).
 */
export function poseFromDrop(
  context: PlacementContext,
  press: { x: number; z: number },
  release: { x: number; z: number } | null,
  fallbackYaw: number,
): CheckpointPose {
  const spot = standOn(context, press);
  const aimed = release !== null && Math.hypot(release.x - press.x, release.z - press.z) > 0.3;
  const yaw = aimed ? Math.atan2(release.x - press.x, release.z - press.z) : fallbackYaw;
  return { position: { x: spot.x, y: eyeHeight(context.scene.ceilingHeight), z: spot.z }, yaw, pitch: LEVEL_PITCH_RAD };
}

/**
 * Where the orbit flies to FRAME a camera: behind it and above, looking at it,
 * close enough that the body and its handles are big on screen.
 */
export function framePose(checkpoint: TourCheckpoint): { position: Vec3; target: Vec3 } {
  const back = 2.6;
  const { x, y, z } = checkpoint.position;
  return {
    position: { x: x - Math.sin(checkpoint.yaw) * back, y: y + 2.1, z: z - Math.cos(checkpoint.yaw) * back },
    target: { x, y: y * 0.5, z },
  };
}
