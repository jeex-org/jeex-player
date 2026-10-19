/**
 * The camera, navigation, autotour and tour-checkpoint operations: `set_camera`,
 * `set_navigation`, `set_autotour`, `set_tour_checkpoints`.
 *
 * None of these touch the plan or the painted state, so the geometry layer
 * never needs to rebuild or repaint over them; what they touch is the camera
 * half of `ops/context.ts`'s `TouchedEntity` (`camera` with its target,
 * `navigation`, `autotour`, `tourCheckpoints`), which nothing else reports.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../../shared/committed.js';
import { clamp } from '../../shared/math.js';
import type {
  CameraPose,
  SceneData,
  SetAutotourOp,
  SetCameraOp,
  SetCameraTarget,
  SetNavigationOp,
  SetTourCheckpointsOp,
  TourCheckpoint,
} from '../types.js';
import {
  OpError,
  TOUCHED_AUTOTOUR,
  TOUCHED_NAVIGATION,
  TOUCHED_TOUR_CHECKPOINTS,
  claimedIds,
  requireNewId,
  round,
  touchedCamera,
  type OpOutcome,
} from './context.js';
import {
  TOUR_CHECKPOINT_HEIGHT_MARGIN_M,
  TOUR_CHECKPOINT_HEIGHT_MIN_M,
  TOUR_CHECKPOINT_NAME_MAX,
  TOUR_PITCH_LIMIT_RAD,
  TOUR_SPEED,
} from './limits.js';

/** The summary fragment naming one camera target. */
function targetLabel(target: SetCameraTarget): string {
  return typeof target === 'object' ? `room:${target.room}` : target;
}

/** Every coordinate of a pose has to be a real number, or the camera has nowhere to render from. */
function requireFinitePose(pose: CameraPose): void {
  const values = [pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new OpError('set_camera needs finite coordinates');
  }
}

/** A fresh, plain copy: the op's pose is never the draft's own object. */
function copyPose(pose: CameraPose): CameraPose {
  return {
    position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    target: { x: pose.target.x, y: pose.target.y, z: pose.target.z },
  };
}

function poseText(pose: CameraPose): string {
  return `(${round(pose.position.x)}, ${round(pose.position.y)}, ${round(pose.position.z)})`;
}

/**
 * Sets or clears one of the scene's three camera kinds.
 *
 * `remove: true` is only meaningful for `walkSpawn` and a room: the
 * presentation camera is mandatory (`SceneData.presentationCamera` is not
 * optional) and refuses removal outright.
 */
export function applySetCamera(scene: Draft<SceneData>, op: SetCameraOp): OpOutcome {
  const label = targetLabel(op.target);
  const touched = [touchedCamera(op.target)];

  if (typeof op.target === 'object') {
    const roomId = op.target.room;
    if (!scene.rooms.some((room) => room.id === roomId)) throw new OpError(`Unknown room ${roomId}`);
  }

  if (op.remove === true) {
    if (op.target === 'presentation') throw new OpError('The presentation camera is required and cannot be removed');
    if (op.target === 'walkSpawn') delete scene.walkSpawn;
    else delete scene.roomCameras[op.target.room];
    return { summary: `Camera ${label} removed`, touched };
  }

  if (!op.pose) throw new OpError('set_camera needs a pose unless remove is true');
  requireFinitePose(op.pose);
  const pose = copyPose(op.pose);
  if (op.target === 'presentation') scene.presentationCamera = pose;
  else if (op.target === 'walkSpawn') scene.walkSpawn = pose;
  else scene.roomCameras[op.target.room] = pose;

  return { summary: `Camera ${label} set to ${poseText(pose)}`, touched };
}

/** Replaces the walk-mode navigation waypoints wholesale. */
export function applySetNavigation(scene: Draft<SceneData>, op: SetNavigationOp): OpOutcome {
  if (op.points.length === 0) throw new OpError('set_navigation needs at least one point');
  op.points.forEach((point, index) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      throw new OpError(`set_navigation point ${index} needs finite coordinates`);
    }
  });
  scene.navigation = { points: op.points.map((point) => ({ x: point.x, y: point.y, z: point.z })) };
  return {
    summary: `Navigation set to ${op.points.length} point${op.points.length === 1 ? '' : 's'}`,
    touched: [TOUCHED_NAVIGATION],
  };
}

/**
 * Updates the parts of the autotour run the op names; an omitted field keeps
 * the scene's current value. `gaze[].at` and `zones[].at` are
 * indices into the EFFECTIVE path — the one this op leaves in place, whether
 * that is a freshly given `path` or the scene's existing one — because
 * `tour-player.ts` reads them the same way (`Number.isInteger(at) && 0 <= at
 * < path.length`) and an op that left an index dangling would only fail
 * silently there instead of here.
 */
export function applySetAutotour(scene: Draft<SceneData>, op: SetAutotourOp): OpOutcome {
  if (op.path === undefined && op.gaze === undefined && op.zones === undefined && op.speed === undefined) {
    throw new OpError('set_autotour needs at least one field to change');
  }

  const path = op.path ?? scene.autotour.path;
  if (path.length < 2) throw new OpError('set_autotour needs a path of at least 2 points');
  path.forEach((point, index) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      throw new OpError(`set_autotour path point ${index} needs finite coordinates`);
    }
  });

  const gaze = op.gaze ?? scene.autotour.gaze;
  gaze.forEach((key) => {
    if (!Number.isInteger(key.at) || key.at < 0 || key.at >= path.length) {
      throw new OpError(`set_autotour gaze.at ${key.at} is outside the path`);
    }
  });

  const zones = op.zones ?? scene.autotour.zones;
  (zones ?? []).forEach((zone) => {
    if (!Number.isInteger(zone.at) || zone.at < 0 || zone.at >= path.length) {
      throw new OpError(`set_autotour zones.at ${zone.at} is outside the path`);
    }
  });

  const parts: string[] = [];
  if (op.path !== undefined) {
    scene.autotour.path = path.map((point) => ({ x: point.x, y: point.y, z: point.z }));
    parts.push(`path ${path.length} points`);
  }
  if (op.gaze !== undefined) {
    scene.autotour.gaze = gaze.map((key) => ({ at: key.at, target: { x: key.target.x, y: key.target.y, z: key.target.z } }));
    parts.push(`gaze ${gaze.length} key${gaze.length === 1 ? '' : 's'}`);
  }
  if (op.zones !== undefined) {
    scene.autotour.zones = op.zones.map((zone) => ({ at: zone.at, speed: zone.speed }));
    parts.push(`zones ${op.zones.length} key${op.zones.length === 1 ? '' : 's'}`);
  }
  if (op.speed !== undefined) {
    const clamped = clamp(op.speed, TOUR_SPEED[0], TOUR_SPEED[1]);
    scene.autotour.speed = clamped;
    parts.push(`speed ${round(clamped)} m/s`);
  }

  return { summary: `Autotour updated: ${parts.join(', ')}`, touched: [TOUCHED_AUTOTOUR] };
}

/**
 * Replaces the tour checkpoints wholesale.
 *
 * The list the op carries IS the list the scene gets, in tour order — there is
 * no merge, because a journal replay must land on the same list every time and
 * "insert at index" is where replays disagree. An empty list is the op's way
 * of saying "no checkpoints": the field is dropped and the tour falls back to
 * the authored `autotour` (`tour-route.ts`).
 *
 * Clamps, not refusals, for the two continuous ranges — the same decision
 * `set_autotour` makes for `speed` — so a drag gesture that ends a hair past a
 * limit commits the clamped pose instead of losing the whole batch at the
 * layout gate. What is REFUSED is what clamping cannot repair: an id that is
 * not a UUID v7, that the list repeats, or that another entity of the document
 * already claims (`requireNewId`'s `invalid_id` / `duplicate_id`; the
 * checkpoints being replaced do not count against their successors), or a
 * coordinate that is not a number. The ids come from the caller, like every
 * creating operation's.
 */
export function applySetTourCheckpoints(scene: Draft<SceneData>, op: SetTourCheckpointsOp): OpOutcome {
  if (!Array.isArray(op.checkpoints)) throw new OpError('set_tour_checkpoints needs a checkpoint list');
  const taken = claimedIds(scene);
  for (const replaced of scene.tourCheckpoints ?? []) taken.delete(replaced.id);
  for (const [index, checkpoint] of op.checkpoints.entries()) {
    requireNewId(scene, checkpoint.id, 'set_tour_checkpoints', `checkpoints[${index}].id`, taken);
  }

  const heightMax = scene.ceilingHeight - TOUR_CHECKPOINT_HEIGHT_MARGIN_M;
  if (heightMax <= TOUR_CHECKPOINT_HEIGHT_MIN_M) {
    throw new OpError('set_tour_checkpoints needs a ceilingHeight above the checkpoint height floor');
  }

  const checkpoints: TourCheckpoint[] = op.checkpoints.map((checkpoint, index) => {
    if (!Number.isFinite(checkpoint.position.x) || !Number.isFinite(checkpoint.position.y) || !Number.isFinite(checkpoint.position.z)) {
      throw new OpError(`set_tour_checkpoints checkpoint ${index} needs finite coordinates`);
    }
    if (!Number.isFinite(checkpoint.yaw) || !Number.isFinite(checkpoint.pitch)) {
      throw new OpError(`set_tour_checkpoints checkpoint ${index} needs finite look angles`);
    }
    const name = checkpointName(checkpoint.name, index);
    return {
      id: checkpoint.id,
      position: {
        x: checkpoint.position.x,
        y: clamp(checkpoint.position.y, TOUR_CHECKPOINT_HEIGHT_MIN_M, heightMax),
        z: checkpoint.position.z,
      },
      yaw: normaliseAngle(checkpoint.yaw),
      pitch: clamp(checkpoint.pitch, -TOUR_PITCH_LIMIT_RAD, TOUR_PITCH_LIMIT_RAD),
      ...(name === undefined ? {} : { name }),
    };
  });

  const parts: string[] = [];
  if (checkpoints.length === 0) delete scene.tourCheckpoints;
  else {
    scene.tourCheckpoints = checkpoints;
    parts.push(`${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'}`);
  }
  if (op.speed !== undefined) {
    const clamped = clamp(op.speed, TOUR_SPEED[0], TOUR_SPEED[1]);
    scene.autotour.speed = clamped;
    parts.push(`speed ${round(clamped)} m/s`);
  }
  if (checkpoints.length === 0) parts.unshift('checkpoints cleared');

  return {
    summary: `Tour set: ${parts.join(', ')}`,
    touched: op.speed === undefined ? [TOUCHED_TOUR_CHECKPOINTS] : [TOUCHED_TOUR_CHECKPOINTS, TOUCHED_AUTOTOUR],
  };
}

/**
 * A checkpoint name as stored: trimmed, and dropped when nothing is left. Too
 * long is REFUSED, not cut — the room name's rule (`ROOM_NAME_MAX`): a cut name
 * is a name the author never typed.
 */
function checkpointName(name: string | undefined, index: number): string | undefined {
  if (name === undefined) return undefined;
  if (typeof name !== 'string') throw new OpError(`set_tour_checkpoints checkpoint ${index} needs a text name`);
  const trimmed = name.trim();
  if (trimmed.length > TOUR_CHECKPOINT_NAME_MAX) {
    throw new OpError(`set_tour_checkpoints checkpoint ${index} name is longer than ${TOUR_CHECKPOINT_NAME_MAX} characters`);
  }
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Folds an angle into `(-PI, PI]`, so a checkpoint's yaw is stable across replays. */
function normaliseAngle(angle: number): number {
  let folded = angle % (Math.PI * 2);
  if (folded <= -Math.PI) folded += Math.PI * 2;
  else if (folded > Math.PI) folded -= Math.PI * 2;
  return folded;
}
