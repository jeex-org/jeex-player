/**
 * Every pose and path the camera layer reads: the presentation pose, the walk
 * spawn, the per-room poses, the navigation points and the autotour.
 *
 * Invariant: this section only checks that the numbers are FINITE and that the
 * indices point at waypoints that exist. Whether a pose stands inside the flat
 * is a separate question with a separate answer — a warning, not a refusal —
 * and it lives in `reachability.ts`, because it needs the solved plan.
 *
 * Pure module: no `three`, no DOM.
 */

import { isFiniteVec3, requirePose, type ValidationContext } from './context.js';
import { TOUR_CHECKPOINT_HEIGHT_MARGIN_M, TOUR_CHECKPOINT_HEIGHT_MIN_M, TOUR_CHECKPOINT_NAME_MAX, TOUR_PITCH_LIMIT_RAD } from '../types.js';

/** The two document-level poses; they are checked before anything references them. */
export function checkPoses(ctx: ValidationContext): void {
  requirePose(ctx.scene.presentationCamera, 'Presentation camera', 'presentationCamera');
  if (ctx.scene.walkSpawn !== undefined) requirePose(ctx.scene.walkSpawn, 'Walk spawn', 'walkSpawn');
}

/** One pose per room, keyed by a room the document declares. */
function checkRoomCameras(ctx: ValidationContext): void {
  for (const roomId of Object.keys(ctx.scene.roomCameras)) {
    const path = `roomCameras.${roomId}`;
    if (!ctx.roomIds.has(roomId)) ctx.fail('room-camera-unknown-room', path, `Room camera references unknown room ${roomId}`, { roomId });
    const camera = ctx.scene.roomCameras[roomId]!;
    if (!isFiniteVec3(camera.position) || !isFiniteVec3(camera.target)) {
      ctx.fail('room-camera-invalid', path, `Room camera ${roomId} has an invalid position or target`);
    }
  }
}

/** The walk graph's seed points. */
function checkNavigationPoints(ctx: ValidationContext): void {
  const points = ctx.scene.navigation.points;
  if (!Array.isArray(points) || points.length === 0) {
    ctx.fail('navigation-points-missing', 'navigation.points', 'Scene needs navigation points');
  }
  for (const [index, point] of points.entries()) {
    if (!isFiniteVec3(point)) {
      ctx.fail('navigation-point-invalid', `navigation.points[${index}]`, 'Navigation points must have finite coordinates');
    }
  }
}

/**
 * The autotour: its path, and the gaze keys and speed zones that index into it.
 *
 * `at` is a waypoint INDEX, so it must be an integer inside the path — a cue
 * pointing past the end would be silently dropped at playback time.
 */
function checkAutotour(ctx: ValidationContext): void {
  const tour = ctx.scene.autotour;
  if (!Array.isArray(tour.path) || tour.path.length < 2) {
    ctx.fail('autotour-path-too-short', 'autotour.path', 'Autotour needs a path with at least two points');
  }
  for (const [index, point] of tour.path.entries()) {
    if (!isFiniteVec3(point)) ctx.fail('autotour-path-point-invalid', `autotour.path[${index}]`, 'Autotour path has an invalid point');
  }
  for (const [index, gaze] of (tour.gaze ?? []).entries()) {
    const path = `autotour.gaze[${index}]`;
    if (!Number.isInteger(gaze.at) || gaze.at < 0 || gaze.at >= tour.path.length) {
      ctx.fail('autotour-gaze-waypoint-invalid', `${path}.at`, 'Autotour gaze references an invalid waypoint', {
        at: gaze.at,
        waypoints: tour.path.length,
      });
    }
    if (!isFiniteVec3(gaze.target)) ctx.fail('autotour-gaze-target-invalid', `${path}.target`, 'Autotour gaze has an invalid target');
  }
  for (const [index, zone] of (tour.zones ?? []).entries()) {
    const path = `autotour.zones[${index}]`;
    if (!Number.isInteger(zone.at) || zone.at < 0 || zone.at >= tour.path.length) {
      ctx.fail('autotour-zone-waypoint-invalid', `${path}.at`, 'Autotour speed zone references an invalid waypoint', {
        at: zone.at,
        waypoints: tour.path.length,
      });
    }
    if (typeof zone.speed !== 'number' || !(zone.speed > 0)) {
      ctx.fail('autotour-zone-speed-invalid', `${path}.speed`, 'Autotour speed zone has an invalid speed', { speed: zone.speed });
    }
  }
}

/**
 * The tour checkpoints (`SceneData.tourCheckpoints`): ids, finite poses, the
 * ±`TOUR_PITCH_LIMIT_RAD` tilt and a height that stays between the floor and
 * the document's own ceiling.
 *
 * The pitch limit IS this section's business, beside the height's: a document
 * reaches the validator from anywhere (an import, a hand edit), not only from
 * the op that clamps, and a pitch beyond the limit names a shot nothing can
 * ever aim. Height hangs off the document's `ceilingHeight`, which no field
 * schema can see; the limit is the one constant read by both sides.
 *
 * The ids join `ctx.claim`'s one namespace like every other entity's: a UUID
 * names one thing, so a checkpoint may not reuse a room's, and
 * `set_tour_checkpoints` refuses the same ids this section does.
 */
function checkTourCheckpoints(ctx: ValidationContext): void {
  const checkpoints = ctx.scene.tourCheckpoints;
  if (checkpoints === undefined) return;
  if (!Array.isArray(checkpoints)) ctx.fail('tour-checkpoints-not-array', 'tourCheckpoints', 'Tour checkpoints must be an array');
  for (const [index, checkpoint] of checkpoints.entries()) {
    const path = `tourCheckpoints[${index}]`;
    if (!checkpoint || typeof checkpoint !== 'object') ctx.fail('tour-checkpoint-not-object', path, 'Tour checkpoints must be objects');
    ctx.claim('tour checkpoint', checkpoint.id, `${path}.id`);
    if (!isFiniteVec3(checkpoint.position)) {
      ctx.fail('tour-checkpoint-position-invalid', `${path}.position`, 'Tour checkpoint has an invalid position');
    }
    if (!Number.isFinite(checkpoint.yaw)) {
      ctx.fail('tour-checkpoint-yaw-invalid', `${path}.yaw`, 'Tour checkpoint has an invalid yaw');
    }
    if (!Number.isFinite(checkpoint.pitch) || Math.abs(checkpoint.pitch) > TOUR_PITCH_LIMIT_RAD) {
      ctx.fail('tour-checkpoint-pitch-invalid', `${path}.pitch`, 'Tour checkpoint pitch is outside the ±50° tilt', {
        pitch: checkpoint.pitch,
      });
    }
    checkCheckpointName(ctx, checkpoint.name, `${path}.name`);
    const heightMax = ctx.scene.ceilingHeight - TOUR_CHECKPOINT_HEIGHT_MARGIN_M;
    if (checkpoint.position.y < TOUR_CHECKPOINT_HEIGHT_MIN_M || checkpoint.position.y > heightMax) {
      ctx.fail(
        'tour-checkpoint-height-out-of-range',
        `${path}.position.y`,
        `Tour checkpoint height must be between ${TOUR_CHECKPOINT_HEIGHT_MIN_M} and ${heightMax} metres`,
        { y: checkpoint.position.y },
      );
    }
  }
}

/**
 * A checkpoint's optional name: absent is fine; present, it is the trimmed,
 * non-empty string of at most `TOUR_CHECKPOINT_NAME_MAX` characters the op
 * would have stored — a document is refused for what the op never writes.
 */
function checkCheckpointName(ctx: ValidationContext, name: unknown, path: string): void {
  if (name === undefined) return;
  if (typeof name !== 'string' || name.trim() !== name || name.length === 0 || name.length > TOUR_CHECKPOINT_NAME_MAX) {
    ctx.fail(
      'tour-checkpoint-name-invalid',
      path,
      `Tour checkpoint name must be 1–${TOUR_CHECKPOINT_NAME_MAX} characters without outer spaces`,
      {
        name: typeof name === 'string' ? name : typeof name,
      },
    );
  }
}

/** The four camera-facing collections, in the order the document declares them. */
export function checkCameras(ctx: ValidationContext): void {
  checkRoomCameras(ctx);
  checkNavigationPoints(ctx);
  checkAutotour(ctx);
  checkTourCheckpoints(ctx);
}
