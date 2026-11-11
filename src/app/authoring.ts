/**
 * The lazy half of the authoring boundary: the tools a published tour never
 * arms, built on one stage when a host first turns one on
 * (`authoring-port.ts` loads this module and binds it). Nothing here is in the
 * boot bundle.
 *
 * On the stage it builds the tour-camera overlay, the look-through pilot and
 * its bar, and the camera-preview card; it hangs the overlay's group under its
 * own `tourAuthoring` group in the render scene, and owns the asset move tool
 * (`asset-move-wiring.ts`) and the plan tool (`plan-tool-wiring.ts`). The frame work runs through the stage's authoring
 * hooks (`ViewerStage.setAuthoring`), at the places the stage fixes, so the
 * frame order does not depend on when this module loaded.
 *
 * Input order: the overlay and the pilot listen in the capture phase, so they
 * win over the selection controller and the camera input that bound before
 * them; the asset tool listens on the canvas's parent in the capture phase and
 * wins over both.
 *
 * Invariant: `dispose()` removes everything built here from the stage, the
 * render scene and the DOM; the stage's own state is as it was before.
 */

import * as THREE from 'three';
import { AUTHORING_MODES } from '../camera/authoring-modes.js';
import { CheckpointOverlay } from '../camera/checkpoint-overlay.js';
import { CheckpointPilot } from '../camera/checkpoint-pilot.js';
import { LookThroughBar } from '../ui/look-through-bar.js';
import { CameraPreview } from '../ui/camera-preview.js';
import type { ViewerMode } from '../scene/types.js';
import type { Messages } from '../ui/messages.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ViewerRoots } from '../ui/viewer-shell.js';
import type { Authoring } from './authoring-port.js';
import { checkpointCommands } from './authoring-checkpoints.js';
import { checkpointsWiring, type CheckpointHostCommands } from './checkpoints-wiring.js';
import { assetMoveWiring } from './asset-move-wiring.js';
import { planToolWiring } from './plan-tool-wiring.js';
import type { SceneMount } from './scene-mount.js';
import type { ViewerEvents } from './viewer-events.js';
import type { ViewerStage } from './viewer-stage.js';

export type AuthoringDeps = {
  stage: ViewerStage;
  mount: () => SceneMount;
  events: ViewerEvents;
  ui: ViewerUI;
  roots: ViewerRoots;
  /** The mounted viewer's lifetime; every listener here carries it. */
  signal: AbortSignal;
  /** The catalogue on screen now; `retranslate` hands the next one. */
  messages: Messages;
  /** The host commands, for the tool's own buttons (frame, look through, done). */
  handle: () => CheckpointHostCommands;
  /** The overlay switch as the host left it (`authoring-port.ts`). */
  visible: () => boolean;
  /** The handle's one mode switch (`handle-commands.ts`). */
  switchMode: (mode: ViewerMode, explicit: boolean) => void;
};

export function startAuthoring(deps: AuthoringDeps): Authoring {
  const { stage, roots } = deps;
  const runtime = stage.runtime;
  const checkpoints = checkpointsWiring({
    visible: deps.visible,
    events: deps.events,
    mount: deps.mount,
    stage: () => stage,
    handle: deps.handle,
    ui: deps.ui,
  });
  /** The camera a pointer ray is cast through right now (`PlanModes.pickCamera`), as the overlay's camera type. */
  const rayCamera = (): THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined => {
    const camera = stage.planModes.pickCamera();
    return camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera ? camera : undefined;
  };
  const overlay = new CheckpointOverlay({
    canvas: roots.canvas,
    camera: () => stage.camera,
    drawCamera: () => stage.planModes.activeCamera(),
    // Rays through the camera object selection casts with: the top view in plan3d.
    rayCamera,
    mode: () => stage.mode ?? 'plan2d',
    scene: checkpoints.scene,
    navigation: checkpoints.navigation,
    plan: checkpoints.plan,
    obstacles: checkpoints.obstacles,
    floorPoint: (clientX, clientY) => stage.picker.floorPoint(clientX, clientY, rayCamera() ?? stage.camera),
    keys: roots.root,
    container: roots.viewport,
    frame: checkpoints.frame,
    rev: checkpoints.rev,
    enabled: checkpoints.enabled,
    pose: checkpoints.pose,
    onSelect: checkpoints.onSelect,
    onEdit: checkpoints.onEdit,
    onPlacing: checkpoints.onPlacing,
    // The editing modes draw on demand: every change of the rig is a new picture.
    onChange: () => runtime.demand.invalidate(),
    signal: deps.signal,
  });
  /** «Look through»: holds the piloted camera's height over the walk rig (`camera/checkpoint-pilot.ts`). */
  const pilot = new CheckpointPilot({ camera: stage.camera, keys: roots.root, onKeyEnd: checkpoints.endLookThrough, signal: deps.signal });
  const lookThrough = new LookThroughBar({
    container: roots.viewport,
    messages: deps.messages,
    onEnd: checkpoints.endLookThrough,
    signal: deps.signal,
  });
  /**
   * The overlay's parent in the render scene: the host's switch lives on the
   * overlay's own group, the MODE's on this one (the authoring rig is hidden
   * in `walk` and `tour`), so leaving `walk` restores exactly what the switch
   * says without either side remembering the other.
   */
  const group = new THREE.Group();
  group.name = 'tourAuthoring';
  group.visible = false;
  group.add(overlay.group);
  runtime.scene.add(group);
  const preview = new CameraPreview({
    container: roots.viewport,
    root: roots.root,
    scene: () => runtime.scene,
    renderer: () => runtime.renderer,
    overlay: () => overlay,
    mode: () => stage.mode,
    messages: deps.messages,
    onLookThrough: checkpoints.lookThrough,
    onChange: () => runtime.demand.invalidate(),
    onInsetDrawn: () => runtime.demand.insetDrawn(),
    signal: deps.signal,
  });
  const assetMove = assetMoveWiring({
    stage: () => stage,
    mount: deps.mount,
    events: deps.events,
    ui: deps.ui,
    roots,
    signal: deps.signal,
  });
  const planTool = planToolWiring({ stage, mount: deps.mount, events: deps.events, ui: deps.ui, roots, signal: deps.signal });
  const commands = checkpointCommands({
    stage,
    overlay,
    pilot,
    lookThrough,
    mount: deps.mount,
    events: deps.events,
    ui: deps.ui,
    visible: deps.visible,
    switchMode: deps.switchMode,
  });

  stage.setAuthoring({
    afterCamera: () => {
      // A look-through holds the camera's own height over the walk rig's eye.
      pilot.update();
      // Read per frame, like the mini-map's mode: a mode reached by any route
      // (a button, a manual grab mid-tour) hides or restores the rig.
      const mode = stage.mode;
      group.visible = mode !== undefined && AUTHORING_MODES.has(mode);
      // Size floor, constant-size handles and badges, for the pose just set.
      overlay.frame();
    },
    // Last, before the draw decision: the overlay's cheap transforms are applied
    // live during a drag, the expensive tube rebuild is deferred to here, once
    // per tick, so the frame drawn now shows the finished trajectory; then the
    // preview card syncs and asks for a frame if its picture changed.
    frameEnd: () => {
      overlay.flush();
      preview.sync();
    },
    // The inset is drawn over the main picture, and only over one that was
    // just drawn: a skipped tick presents the last picture, inset included.
    postRender: () => preview.drawAfter(runtime.demand.counters().draws),
    // The overlay rebuilds from the committed list; an active focus survives
    // when the document still carries its checkpoint.
    document: (scene) => overlay.setScene(scene),
  });
  // Bound after a document is on screen: the overlay starts from it.
  const current = deps.mount().model?.scene;
  if (current) overlay.setScene(current);
  runtime.demand.invalidate();

  return {
    ...commands,
    setCheckpointOverlay: (visible) => overlay.setEnabled(visible),
    setAssetMoveTool: (enabled) => assetMove.setEnabled(enabled),
    armAssetMove: () => assetMove.arm(),
    revertAssetEdit: () => assetMove.revert(),
    mirrorAsset: (assetId, axis) => assetMove.mirror(assetId, axis),
    turnAsset: (assetId, steps) => assetMove.turnAsset(assetId, steps),
    setPlanTool: (enabled) => planTool.setEnabled(enabled),
    revertPlanEdit: () => planTool.revert(),
    retranslate(messages) {
      // The camera-preview card's label (`ui/camera-preview.ts`) and the look-through bar.
      preview.retranslate(messages);
      lookThrough.retranslate(messages);
    },
    lookThroughId: () => pilot.id,
    placing: () => overlay.placing(),
    debug: () => ({ checkpointOverlay: overlay.group, assetMove: assetMove.debug() }),
    dispose() {
      stage.setAuthoring(null);
      preview.dispose();
      pilot.dispose();
      lookThrough.dispose();
      runtime.scene.remove(group);
      assetMove.dispose();
      planTool.dispose();
      overlay.dispose();
      runtime.demand.invalidate();
    },
  };
}
