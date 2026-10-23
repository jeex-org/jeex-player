/**
 * The stage's `checkpoints` dependency bag (`viewer-stage.ts`), assembled
 * apart from the composition root for the same reason `director-wiring.ts` is:
 * `ViewerApp` has a size limit and the wiring is a table of late-bound reads.
 *
 * The overlay's switch lives on `ViewerApp` (`checkpointsVisible`) and reaches
 * the stage through the `enabled` getter; the events go straight onto the
 * public fan-out; the document, its plan and its revision are read off the
 * mount, which is the one place a committed `SceneModel` is guaranteed
 * current. The three commands the tool's own chrome raises — frame a camera,
 * look through it, end the look-through — go to the HOST commands
 * (`handle-commands.ts`), so the preview card's button and the look-through
 * bar do exactly what `handle.lookThroughCheckpoint` / `endLookThrough` do.
 */

import { obstaclesFor } from '../assets/asset-footprint.js';
import { tourNavigation } from '../navigation/tour-legs.js';
import type { ViewerEvents } from './viewer-events.js';
import type { SceneMount } from './scene-mount.js';
import type { StageCheckpoints, ViewerStage } from './viewer-stage.js';
import type { HandleCommands } from './handle-commands.js';
import type { ViewerUI } from '../ui/viewer-ui.js';

export function checkpointsWiring(deps: {
  visible: () => boolean;
  events: ViewerEvents;
  mount: () => SceneMount;
  stage: () => ViewerStage | undefined;
  handle: () => HandleCommands;
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
