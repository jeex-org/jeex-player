/**
 * The tour-camera overlay's reads and sinks (`StageCheckpoints`), a table of
 * late-bound reads assembled for `authoring.ts`, which builds the overlay in
 * the authoring chunk.
 *
 * The overlay's switch lives on the authoring port (`authoring-port.ts`) and
 * reaches the overlay through the `enabled` getter; the events go straight
 * onto the public fan-out; the document, its plan and its revision are read
 * off the mount, which is the one place a committed `SceneModel` is
 * guaranteed current. The three commands the tool's own chrome raises — frame
 * a camera, look through it, end the look-through — go to the HOST commands
 * (`handle-commands.ts`), so the preview card's button and the look-through
 * bar do exactly what `handle.lookThroughCheckpoint` / `endLookThrough` do.
 */

import { obstaclesFor } from '../assets/asset-footprint.js';
import { tourNavigation } from '../navigation/tour-legs.js';
import type { ViewerEvents } from './viewer-events.js';
import type { SceneMount } from './scene-mount.js';
import type * as THREE from 'three';
import type { ViewerStage } from './viewer-stage.js';
import type { CheckpointEdit, CheckpointSelect } from '../camera/checkpoint-types.js';
import type { Obstacle } from '../navigation/navigation.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { TourNavigation } from '../navigation/tour-legs.js';
import type { SceneData, TourCheckpoint } from '../scene/types.js';
import type { ViewerUI } from '../ui/viewer-ui.js';

/** The three host commands the tool's own chrome raises (`HandleCommands` carries them). */
export type CheckpointHostCommands = {
  frameCheckpoint(id: string): boolean;
  lookThroughCheckpoint(id: string): boolean;
  endLookThrough(commit: boolean): boolean;
};

/** The tour-camera tool's reads and sinks, as the overlay takes them (`authoring.ts` builds the overlay). */
export type StageCheckpoints = {
  enabled: () => boolean;
  scene: () => SceneData | null;
  /** The committed plan's walkable space, for the trajectory the tube draws; `null` before the first document. */
  navigation: () => TourNavigation | null;
  /** The committed plan, for the floor rules of placement and moves. */
  plan: () => SolvedPlan | null;
  /** The committed furniture footprints a placement steps off. */
  obstacles: () => readonly Obstacle[];
  rev: () => number;
  pose: () => { position: THREE.Vector3; target: THREE.Vector3 } | null;
  onSelect: (selection: CheckpointSelect) => void;
  onEdit: (edit: CheckpointEdit) => void;
  onPlacing: (active: boolean) => void;
  frame: (checkpoint: TourCheckpoint) => void;
  lookThrough: (id: string) => void;
  endLookThrough: (commit: boolean) => void;
};

export function checkpointsWiring(deps: {
  visible: () => boolean;
  events: ViewerEvents;
  mount: () => SceneMount;
  stage: () => ViewerStage | undefined;
  handle: () => CheckpointHostCommands;
  ui: ViewerUI;
}): StageCheckpoints {
  return {
    enabled: deps.visible,
    scene: () => deps.mount().model?.scene ?? null,
    navigation: () => {
      const model = deps.mount().model;
      return model ? tourNavigation(model.plan, model.scene) : null;
    },
    plan: () => deps.mount().model?.plan ?? null,
    obstacles: () => {
      const model = deps.mount().model;
      return model ? obstaclesFor(model.scene, deps.mount().assetFacts()) : [];
    },
    rev: () => deps.mount().model?.rev ?? 0,
    pose: () => deps.stage()?.director?.controller.getPose() ?? null,
    onSelect: (selection) => deps.events.emit('checkpointSelect', selection),
    onEdit: (edit) => deps.events.emit('checkpointEdit', edit),
    onPlacing: (active) => {
      // The hint says how to get out of the state it announces; leaving it
      // restores the mode's own hint.
      const stage = deps.stage();
      if (active) stage?.director?.hint('hint.checkpointPlacing');
      else if (stage?.mode) deps.ui.setHintForMode(stage.mode);
      deps.events.emit('checkpointPlacing', { active });
    },
    frame: (checkpoint) => deps.handle().frameCheckpoint(checkpoint.id),
    lookThrough: (id) => deps.handle().lookThroughCheckpoint(id),
    endLookThrough: (commit) => deps.handle().endLookThrough(commit),
  };
}
