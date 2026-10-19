/**
 * The methods `ViewerHandle` calls straight through to the composition root
 * (`viewer-api.ts`'s `handle.setMode: (mode) => app.handle.setMode(mode)` and
 * its neighbours) — the read/write surface a host holds, as opposed to
 * `ui-commands.ts`'s bag (what the BUILT-IN chrome may ask) and
 * `director-wiring.ts`'s table (what the camera director needs).
 *
 * `messages` and `furnitureVisible` are read AND written here (`setLocale`
 * retranslates, `setFurnitureVisible` toggles the collision and the ripple),
 * so both come in as a getter/setter pair rather than a plain value: the
 * field itself stays on `ViewerApp`, which is also where `init()`, `buildStage`
 * and the command bags above read the very same source of truth.
 */

import * as THREE from 'three';
import { isUuidV7, type MirrorAxis, type SceneData, type ViewerMode } from '../scene/types.js';
import { framePose, poseFromEye } from '../camera/checkpoint-placement.js';
import type { Locale, Messages } from '../ui/messages.js';
import type { NewCheckpoint, ViewerSlots, ViewerState } from './viewer-handle.js';
import { readViewerState } from './viewer-state.js';
import type { ViewerStage } from './viewer-stage.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ViewerEvents } from './viewer-events.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { SceneMount } from './scene-mount.js';
import type { FurnitureAnimator } from '../geometry/furniture-animator.js';
import type { ViewerContext } from './viewer-context.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerSelection, ViewerSelectionTarget } from './selection.js';
import type { SelectionDescription } from '../ui/selection-options.js';
import { assetMoveWiring } from './asset-move-wiring.js';
import type { AssetMoveControl } from '../edit/asset-move-session.js';

type HandleCommandsDeps = {
  stage: () => ViewerStage | undefined;
  ui: ViewerUI;
  events: ViewerEvents;
  tour: TourControls;
  /** Read lazily, like everything else: the field is assigned late in the constructor. */
  mount: () => SceneMount;
  animator: FurnitureAnimator;
  context: ViewerContext;
  options: ViewerOptions;
  furnitureVisible: () => boolean;
  setFurnitureVisible: (visible: boolean) => void;
  /** The placement overlay's switch; the field itself lives on `ViewerApp`. */
  checkpointsVisible: () => boolean;
  setCheckpointsVisible: (visible: boolean) => void;
  messages: () => Messages;
  setMessages: (messages: Messages) => void;
};

export type HandleCommands = {
  /** The context's boxes, straight through: nothing here decides anything about them. */
  readonly slots: ViewerSlots;
  setMode(mode: ViewerMode): void;
  getMode(): ViewerMode;
  getFurnitureVisible(): boolean;
  getLocale(): Locale;
  getState(): ViewerState;
  getScene(): SceneData | null;
  focusRoom(roomId: string): boolean;
  stepCamera(to: 'next' | 'previous' | 'first' | 'last' | number): boolean;
  setLocale(locale: Locale): void;
  setSelection(target: ViewerSelectionTarget | null): void;
  describeSelection(target: ViewerSelection): SelectionDescription | null;
  resize(): void;
  setFurnitureVisible(visible: boolean, reapply?: boolean): void;
  /** Shows or hides the tour-camera placement overlay (default OFF). */
  setCheckpointOverlay(visible: boolean): void;
  isCheckpointOverlayVisible(): boolean;
  /** «Add from current view» (`viewer-handle.ts`); `false` before the stack exists. */
  addCheckpoint(request: NewCheckpoint): boolean;
  startCheckpointPlacement(request: NewCheckpoint): boolean;
  cancelCheckpointPlacement(): void;
  setCheckpointFromView(id: string): boolean;
  frameCheckpoint(id: string): boolean;
  lookThroughCheckpoint(id: string): boolean;
  endLookThrough(commit: boolean): boolean;
  /** Focuses a checkpoint as a click on its marker would; `null` clears. */
  focusCheckpoint(id: string | null): boolean;
  /** Redraws the committed checkpoints after the host refused an edit. */
  revertCheckpointEdit(): void;
  /** Arms or disarms the asset move tool; the first arming loads it. */
  setAssetMoveTool(enabled: boolean): void;
  /** The next press moves the selected object to it (the «Move» toggle). */
  armAssetMove(): void;
  /** Puts the start pose of the last `assetEdit` back after the host refused it. */
  revertAssetEdit(): void;
  /** Toggles one mirror axis of a placement, judged like a move. */
  mirrorAsset(assetId: string, axis: MirrorAxis): boolean;
  /** Turns a placement `steps` × 15°; `false` when it cannot. */
  turnAsset(assetId: string, steps: number): boolean;
};

/** The read/write surface `viewer-api.ts` projects onto `ViewerHandle`. */
export function handleCommands(deps: HandleCommandsDeps): HandleCommands {
  /** The stage's asset move switch, built on first use: the tool itself loads lazily behind it. */
  const assetMove = (): AssetMoveControl | null => {
    const stage = deps.stage();
    if (!stage) return null;
    stage.assetMove ??= assetMoveWiring({
      stage: deps.stage,
      mount: deps.mount,
      events: deps.events,
      ui: deps.ui,
      roots: deps.context.roots,
      signal: deps.context.signal,
    });
    return stage.assetMove;
  };
  // A host may arm the tool before the first document built the stage; the
  // switch is remembered and applied as soon as a stage is there.
  let assetMoveWanted = false;
  deps.events.on('scene', () => {
    if (assetMoveWanted) assetMove()?.setEnabled(true);
  });
  /**
   * Ends a running look-through: reads the eye, returns the camera to where
   * the orbit stood, and — when `commit` — reports the new pose as one edit.
   * The mode switch back goes through `switchMode`, so the chrome and the
   * `mode` event follow exactly as for a button press — but as an implicit
   * switch, which keeps the restored pose instead of resetting it.
   */
  const endPilot = (commit: boolean): boolean => {
    const stage = deps.stage();
    const result = stage?.pilot.end();
    const director = stage?.director;
    if (!stage || !result || !director) return false;
    stage.lookThrough.hide();
    const back = pilotReturn;
    pilotReturn = null;
    if (back) director.controller.setPose(back.position, back.target);
    switchMode(back?.mode ?? 'orbit', false);
    const scene = deps.mount().model?.scene;
    if (commit && scene) {
      stage.overlay.applyPose(
        result.id,
        poseFromEye(scene.ceilingHeight, result.eye),
        `Camera ${result.id} looked through`,
        result.baseRev,
      );
    }
    stage.overlay.focusCheckpoint(result.id);
    deps.events.emit('checkpointLookThrough', { id: null });
    return true;
  };
  /** Where the orbit stood when a look-through began, to return to. */
  let pilotReturn: { position: THREE.Vector3; target: THREE.Vector3; mode: ViewerMode } | null = null;

  /**
   * The one mode switch behind the handle. `explicit` is a host's or a
   * visitor's own choice (`setMode`: a mode button, the API, the embed
   * protocol) and goes through `director.selectMode`, which ends a choice of
   * 360 in the Reset camera pose. The handle's own internal
   * returns to 360 (`endPilot`, `frameCheckpoint`) are implicit: they set or
   * fly the pose themselves, and a reset would undo it.
   */
  function switchMode(mode: ViewerMode, explicit: boolean): void {
    // Any other mode ends a look-through without keeping it: the pilot's
    // walk is not the visitor's walk.
    if ((deps.stage()?.pilot.id ?? null) !== null) endPilot(false);
    const director = deps.stage()?.director;
    if (explicit) director?.selectMode(mode);
    else director?.setMode(mode);
    // A gesture cannot survive leaving the mode it could start in (`orbit`).
    deps.stage()?.overlay.setMode(mode);
    deps.ui.setModeButtons(mode);
    deps.ui.setHintForMode(mode);
    deps.events.emit('mode', mode);
  }

  const commands: HandleCommands = {
    slots: deps.context.slots,

    setMode(mode) {
      switchMode(mode, true);
    },

    getMode() {
      return deps.stage()?.director?.controller.getMode() ?? deps.options.view.mode;
    },

    getFurnitureVisible() {
      return deps.furnitureVisible();
    },

    getLocale() {
      return deps.messages().locale;
    },

    /** One consistent read of the whole graph (`viewer-state.ts`). */
    getState() {
      return readViewerState({
        mode: () => this.getMode(),
        tour: () => deps.tour.progress(),
        furnitureVisible: () => deps.furnitureVisible(),
        locale: () => deps.messages().locale,
        model: () => deps.mount().model,
        walkCamera: () => deps.stage()?.director?.walkCamera() ?? { index: null, count: 0 },
        checkpoints: () => ({ lookThrough: deps.stage()?.pilot.id ?? null, placing: deps.stage()?.overlay.placing() ?? false }),
      });
    },

    /** A deep, mutable copy of the committed document; `null` before the first one. */
    getScene() {
      return deps.mount().model?.toJSON() ?? null;
    },

    /** A room is named by its UUID; anything else is refused like an unknown room. */
    focusRoom(roomId) {
      if (!isUuidV7(roomId)) return false;
      return deps.stage()?.director?.focusRoom(roomId) ?? false;
    },

    stepCamera(to) {
      return deps.stage()?.director?.stepCamera(to) ?? false;
    },

    /** Re-translates the chrome in place; the geometry is not touched. */
    setLocale(locale) {
      const messages = deps.context.retranslate(locale);
      deps.setMessages(messages);
      deps.ui.retranslate(messages);
      // The camera stack keeps a catalogue of its own — it is where every hint
      // the rigs raise by key is turned into words (`camera-director.ts`).
      deps.stage()?.director?.retranslate(messages);
      // And the camera-preview card's label (`ui/camera-preview.ts`) and the look-through bar.
      deps.stage()?.preview.retranslate(messages);
      deps.stage()?.lookThrough.retranslate(messages);
      deps.stage()?.walkCameras.retranslate(messages);
    },

    /**
     * What the HOST asked to highlight (`render/selection-highlight.ts`). A
     * target whose id is not a UUID highlights nothing, like an unknown one.
     */
    setSelection(target) {
      deps.stage()?.selection.setSelection(target !== null && isUuidV7(target.id) ? target : null);
    },

    /**
     * What the viewer's own panel would offer for a selection, as data
     * (the same answer the panel renders). `null` before the first document, and
     * for a selection with nothing to offer. Independent of `options.edits`: it reads the
     * document, it opens nothing.
     */
    describeSelection(target) {
      return deps.mount().editor?.describeSelection(target) ?? null;
    },

    resize() {
      deps.stage()?.resize();
    },

    /**
     * Shows or hides all demo furniture. `reapply` pushes the authoritative state
     * onto a freshly built group (a rebuild always makes furniture visible)
     * without replaying the ripple when nothing changed.
     */
    setFurnitureVisible(visible, reapply = false) {
      deps.setFurnitureVisible(visible);
      deps.stage()?.director?.controller.setFurnitureCollision(visible);
      deps.ui.setFurnitureState(visible);
      if (!reapply || !visible) deps.animator.setVisible(visible);
    },

    setCheckpointOverlay(visible) {
      deps.setCheckpointsVisible(visible);
      deps.stage()?.overlay.setEnabled(visible);
    },

    isCheckpointOverlayVisible() {
      return deps.checkpointsVisible();
    },

    addCheckpoint(request) {
      return deps.stage()?.overlay.addCheckpoint(request.id) ?? false;
    },

    startCheckpointPlacement(request) {
      return deps.stage()?.overlay.startPlacing(request.id) ?? false;
    },

    cancelCheckpointPlacement() {
      deps.stage()?.overlay.cancelPlacing();
    },

    setCheckpointFromView(id) {
      return deps.stage()?.overlay.setCheckpointFromView(id) ?? false;
    },

    frameCheckpoint(id) {
      const stage = deps.stage();
      const checkpoint = stage?.overlay.checkpoint(id);
      const director = stage?.director;
      if (!stage || !checkpoint || !director || !deps.checkpointsVisible()) return false;
      if (stage.pilot.id !== null) endPilot(false);
      if (director.controller.getMode() !== 'orbit') switchMode('orbit', false);
      const frame = framePose(checkpoint);
      director.controller.flyTo(toVector(frame.position), toVector(frame.target));
      stage.overlay.focusCheckpoint(id);
      return true;
    },

    lookThroughCheckpoint(id) {
      const stage = deps.stage();
      const director = stage?.director;
      const checkpoint = stage?.overlay.checkpoint(id);
      const scene = deps.mount().model?.scene;
      if (!stage || !director || !checkpoint || !scene || !deps.checkpointsVisible()) return false;
      if (stage.pilot.id !== null) endPilot(false);
      stage.overlay.focusCheckpoint(id);
      const mode = director.controller.getMode();
      const pose = director.controller.getPose();
      pilotReturn = { position: pose.position, target: pose.target, mode: mode === 'plan3d' ? 'plan3d' : 'orbit' };
      const { position, yaw, pitch } = checkpoint;
      const eye = toVector(position);
      director.enterWalkAt({
        position: eye,
        target: eye.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))),
      });
      stage.overlay.setMode('walk');
      stage.pilot.begin(id, position.y, scene.ceilingHeight, deps.mount().model?.rev ?? 0);
      const order = (scene.tourCheckpoints ?? []).findIndex((candidate) => candidate.id === id) + 1;
      stage.lookThrough.show(order > 0 ? order : 1);
      deps.ui.setModeButtons('walk');
      director.hint('hint.lookThrough');
      deps.events.emit('mode', 'walk');
      deps.events.emit('checkpointLookThrough', { id });
      return true;
    },

    endLookThrough(commit) {
      return endPilot(commit);
    },

    focusCheckpoint(id) {
      return deps.stage()?.overlay.focusCheckpoint(id) ?? false;
    },

    revertCheckpointEdit() {
      deps.stage()?.overlay.revert();
    },

    setAssetMoveTool(enabled) {
      assetMoveWanted = enabled;
      assetMove()?.setEnabled(enabled);
    },

    armAssetMove() {
      assetMove()?.arm();
    },

    revertAssetEdit() {
      deps.stage()?.assetMove?.revert();
    },

    mirrorAsset(assetId, axis) {
      return deps.stage()?.assetMove?.mirror(assetId, axis) ?? false;
    },

    turnAsset(assetId, steps) {
      return deps.stage()?.assetMove?.turnAsset(assetId, steps) ?? false;
    },
  };
  return commands;
}

function toVector(point: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}
