/**
 * The tour-camera tool's host commands (`ViewerHandle.addCheckpoint` and its
 * neighbours) over the tools of one stage: the overlay, the look-through pilot
 * and its bar. Loaded with the other authoring tools (`authoring.ts`); the
 * handle reaches these through the authoring port (`authoring-port.ts`).
 *
 * The mode switch is the handle's own (`switchMode`, `handle-commands.ts`):
 * a look-through's return goes through it, so the chrome and the `mode` event
 * follow exactly as for a button press, but as an implicit switch, which keeps
 * the restored pose instead of resetting it. The handle's switch in turn calls
 * `modeChanged`, which ends a running look-through without keeping it: the
 * pilot's walk is not the visitor's walk.
 */

import * as THREE from 'three';
import type { ViewerMode } from '../scene/types.js';
import { framePose, poseFromEye } from '../camera/checkpoint-placement.js';
import type { CheckpointOverlay } from '../camera/checkpoint-overlay.js';
import type { CheckpointPilot } from '../camera/checkpoint-pilot.js';
import type { LookThroughBar } from '../ui/look-through-bar.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ViewerEvents } from './viewer-events.js';
import type { ViewerStage } from './viewer-stage.js';
import type { SceneMount } from './scene-mount.js';

export type CheckpointCommandsDeps = {
  stage: ViewerStage;
  overlay: CheckpointOverlay;
  pilot: CheckpointPilot;
  lookThrough: LookThroughBar;
  mount: () => SceneMount;
  events: ViewerEvents;
  ui: ViewerUI;
  /** The overlay switch as the host left it. */
  visible: () => boolean;
  /** The handle's one mode switch; `explicit: false` keeps the pose it finds. */
  switchMode: (mode: ViewerMode, explicit: boolean) => void;
};

export type CheckpointCommands = {
  addCheckpoint(id: string): boolean;
  startCheckpointPlacement(id: string): boolean;
  cancelCheckpointPlacement(): void;
  setCheckpointFromView(id: string): boolean;
  frameCheckpoint(id: string): boolean;
  lookThroughCheckpoint(id: string): boolean;
  endLookThrough(commit: boolean): boolean;
  focusCheckpoint(id: string | null): boolean;
  revertCheckpointEdit(): void;
  modeChanged(mode: ViewerMode): void;
};

export function checkpointCommands(deps: CheckpointCommandsDeps): CheckpointCommands {
  const { stage, overlay, pilot, lookThrough } = deps;
  /** Where the orbit stood when a look-through began, to return to. */
  let pilotReturn: { position: THREE.Vector3; target: THREE.Vector3; mode: ViewerMode } | null = null;

  /**
   * Ends a running look-through: reads the eye, returns the camera to where
   * the orbit stood, and — when `commit` — reports the new pose as one edit.
   */
  const endPilot = (commit: boolean): boolean => {
    const result = pilot.end();
    const director = stage.director;
    if (!result || !director) return false;
    lookThrough.hide();
    const back = pilotReturn;
    pilotReturn = null;
    if (back) director.controller.setPose(back.position, back.target);
    deps.switchMode(back?.mode ?? 'orbit', false);
    const scene = deps.mount().model?.scene;
    if (commit && scene) {
      overlay.applyPose(result.id, poseFromEye(scene.ceilingHeight, result.eye), `Camera ${result.id} looked through`, result.baseRev);
    }
    overlay.focusCheckpoint(result.id);
    deps.events.emit('checkpointLookThrough', { id: null });
    return true;
  };

  return {
    addCheckpoint: (id) => overlay.addCheckpoint(id),
    startCheckpointPlacement: (id) => overlay.startPlacing(id),
    cancelCheckpointPlacement: () => overlay.cancelPlacing(),
    setCheckpointFromView: (id) => overlay.setCheckpointFromView(id),

    frameCheckpoint(id) {
      const checkpoint = overlay.checkpoint(id);
      const director = stage.director;
      if (!checkpoint || !director || !deps.visible()) return false;
      if (pilot.id !== null) endPilot(false);
      if (director.controller.getMode() !== 'orbit') deps.switchMode('orbit', false);
      const frame = framePose(checkpoint);
      director.controller.flyTo(toVector(frame.position), toVector(frame.target));
      overlay.focusCheckpoint(id);
      return true;
    },

    lookThroughCheckpoint(id) {
      const director = stage.director;
      const checkpoint = overlay.checkpoint(id);
      const scene = deps.mount().model?.scene;
      if (!director || !checkpoint || !scene || !deps.visible()) return false;
      if (pilot.id !== null) endPilot(false);
      overlay.focusCheckpoint(id);
      const mode = director.controller.getMode();
      const pose = director.controller.getPose();
      pilotReturn = { position: pose.position, target: pose.target, mode: mode === 'plan3d' ? 'plan3d' : 'orbit' };
      const { position, yaw, pitch } = checkpoint;
      const eye = toVector(position);
      director.enterWalkAt({
        position: eye,
        target: eye.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))),
      });
      overlay.setMode('walk');
      pilot.begin(id, position.y, scene.ceilingHeight, deps.mount().model?.rev ?? 0);
      const order = (scene.tourCheckpoints ?? []).findIndex((candidate) => candidate.id === id) + 1;
      lookThrough.show(order > 0 ? order : 1);
      deps.ui.setModeButtons('walk');
      director.hint('hint.lookThrough');
      deps.events.emit('mode', 'walk');
      deps.events.emit('checkpointLookThrough', { id });
      return true;
    },

    endLookThrough: (commit) => endPilot(commit),
    focusCheckpoint: (id) => overlay.focusCheckpoint(id),
    revertCheckpointEdit: () => overlay.revert(),

    modeChanged(mode) {
      if (pilot.id !== null) endPilot(false);
      // A gesture cannot survive leaving the mode it could start in (`orbit`).
      overlay.setMode(mode);
    },
  };
}

function toVector(point: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}
