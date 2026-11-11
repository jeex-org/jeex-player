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

import { isUuidV7, type MirrorAxis, type SceneData, type ViewerMode } from '../scene/types.js';
import type { Locale, Messages } from '../ui/messages.js';
import type { NewCheckpoint, PlanView, ViewerSlots, ViewerState } from './viewer-handle.js';
import { readViewerState } from './viewer-state.js';
import type { ViewerStage } from './viewer-stage.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import { toViewerError, type ViewerEvents } from './viewer-events.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { SceneMount } from './scene-mount.js';
import type { ExportSurfaces } from './export-surfaces.js';
import type { FurnitureAnimator } from '../geometry/furniture-animator.js';
import type { ViewerContext } from './viewer-context.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerSelection, ViewerSelectionTarget } from './selection.js';
import type { SelectionDescription } from '../ui/selection-options.js';
import { authoringPort, type AuthoringPort } from './authoring-port.js';
import { defaultLogger } from '../shared/logger.js';
import { LightTemperatureControl } from './light-temperature-control.js';
import { QualityControl } from './quality-control.js';

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
  messages: () => Messages;
  setMessages: (messages: Messages) => void;
};

export type HandleCommands = {
  /** The context's boxes, straight through: nothing here decides anything about them. */
  readonly slots: ViewerSlots;
  /** The colour temperature of the artificial light: the host's `setLightTemperature`, the panel, new roots (`light-temperature-control.ts`). */
  readonly lightTemperature: LightTemperatureControl;
  /** The render quality tier: the host's `setQuality`, the element's live attribute, the auto machine (`quality-control.ts`). */
  readonly quality: QualityControl;
  /** The authoring tools' switches and their lazy chunk (`authoring-port.ts`); the boot binds them, the teardown unbinds them. */
  readonly authoring: AuthoringPort;
  setMode(mode: ViewerMode): void;
  getMode(): ViewerMode;
  /** The mode a host set before the camera existed, once (the start view applies it); internal, never on the public handle. */
  takeRequestedMode(): ViewerMode | null;
  getFurnitureVisible(): boolean;
  getLocale(): Locale;
  getState(): ViewerState;
  getScene(): SceneData | null;
  /** What an export draws room surfaces with (`export-surfaces.ts`); internal, never on the public handle. */
  exportSurfaces(): ExportSurfaces | null;
  focusRoom(roomId: string): boolean;
  stepCamera(to: 'next' | 'previous' | 'first' | 'last' | number): boolean;
  setLocale(locale: Locale): void;
  /** Re-reads the root's theme into what CSS cannot paint; before the stage exists its construction reads it anyway. */
  refreshTheme(): void;
  setSelection(target: ViewerSelectionTarget | null): void;
  planView(): PlanView | null;
  describeSelection(target: ViewerSelection): SelectionDescription | null;
  resize(): void;
  setFurnitureVisible(visible: boolean, reapply?: boolean): void;
  /** Shows or hides the tour-camera placement overlay (default OFF); the first switch-on loads the authoring tools. */
  setCheckpointOverlay(visible: boolean): void;
  isCheckpointOverlayVisible(): boolean;
  /** «Add from current view» (`viewer-handle.ts`); `false` before the stack exists or the tools are in. */
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
  /** Arms or disarms the plan tool; the first arming loads it with the other authoring tools. */
  setPlanTool(enabled: boolean): void;
  /** Puts the committed drawing back after the host refused the last `planEdit`. */
  revertPlanEdit(): void;
};

/** The read/write surface `viewer-api.ts` projects onto `ViewerHandle`. */
export function handleCommands(deps: HandleCommandsDeps): HandleCommands {
  /**
   * The authoring tools behind one lazy boundary: the overlay, the
   * look-through, the asset move tool and the plan tool. The chunk loads on the first switch
   * turned on, and the commands below answer «not loaded» until it is in.
   */
  const authoring: AuthoringPort = authoringPort({
    stage: deps.stage,
    load: () => import('./authoring.js'),
    start: (module, stage) =>
      module.startAuthoring({
        stage,
        mount: deps.mount,
        events: deps.events,
        ui: deps.ui,
        roots: deps.context.roots,
        signal: deps.context.signal,
        messages: deps.messages(),
        handle: () => commands,
        visible: () => authoring.checkpointOverlay(),
        switchMode,
      }),
    log: defaultLogger,
    report: (error) => deps.events.emit('error', toViewerError('internal', error, deps.messages().t('error.unknown'))),
  });
  /** A host's `setMode` before there was a camera to switch: the start view opens in it. */
  let requestedMode: ViewerMode | null = null;

  /**
   * The one mode switch behind the handle. `explicit` is a host's or a
   * visitor's own choice (`setMode`: a mode button, the API, the embed
   * protocol) and goes through `director.selectMode`, which ends a choice of
   * 360 in the Reset camera pose. The handle's own internal
   * returns to 360 (the end of a look-through, `frameCheckpoint`) are implicit: they set or
   * fly the pose themselves, and a reset would undo it.
   */
  function switchMode(mode: ViewerMode, explicit: boolean): void {
    // Before the first document there is nothing to switch and nothing to
    // announce: the start view applies the mode (`viewer-boot.ts`).
    if (!deps.stage()?.director) {
      requestedMode = mode;
      return;
    }
    // Any other mode ends a look-through without keeping it, and a checkpoint
    // gesture cannot survive leaving the mode it could start in.
    authoring.modeChanged(mode);
    const director = deps.stage()?.director;
    if (explicit) director?.selectMode(mode);
    else director?.setMode(mode);
    deps.ui.setModeButtons(mode);
    deps.ui.setHintForMode(mode);
    deps.events.emit('mode', mode);
  }

  const lightTemperature = new LightTemperatureControl({
    initial: deps.options.lighting.temperature,
    scene: () => deps.stage()?.runtime.scene,
    invalidate: () => deps.stage()?.runtime.demand.invalidate(),
    relit: () => deps.stage()?.walkLighting.relit(),
    emit: (change) => deps.events.emit('lightTemperature', change),
    reflect: (value) => deps.ui.setLightTemperature(value),
  });
  // The panel opens on the mount option; every later change reaches it through `reflect`.
  deps.ui.setLightTemperature(lightTemperature.value);

  /** The mode on screen: the director's once a document built it, the requested one or the mount option's before that. */
  const currentMode = (): ViewerMode => deps.stage()?.director?.controller.getMode() ?? requestedMode ?? deps.options.view.mode;

  const quality = new QualityControl({
    initial: deps.options.quality,
    runtime: () => deps.stage()?.runtime,
    applyChainTier: (inputs) => deps.stage()?.walkPost.applyTierInputs(inputs) ?? false,
    // The machine's sampling arms only while the room lighting is live AND the
    // mode is one it shows: `state()` stays 'live' in orbit and plan after one
    // walk visit, and those modes' frames are a different cost with different
    // motion — they feed nothing.
    lightingLive: () => {
      const mode = currentMode();
      return deps.stage()?.walkLighting.state() === 'live' && (mode === 'walk' || mode === 'tour');
    },
    invalidate: () => deps.stage()?.runtime.demand.invalidate(),
  });
  // A new scene load restarts the auto machine and puts the screen back on the
  // tier it restarts on; a pinned tier is unaffected. The `scene` event also
  // fires after every plan-level revision of the SAME scene: only a changed
  // scene id is a new load, or an editing session would reset the machine —
  // and give back the recovery budget — on every ceiling and opening edit.
  let lastSceneId: string | null = null;
  deps.events.on('scene', ({ sceneId }) => {
    if (sceneId === lastSceneId) return;
    lastSceneId = sceneId;
    quality.newScene();
  });

  const commands: HandleCommands = {
    slots: deps.context.slots,
    lightTemperature,
    quality,
    authoring,

    setMode(mode) {
      switchMode(mode, true);
    },

    getMode() {
      return currentMode();
    },

    takeRequestedMode() {
      const mode = requestedMode;
      requestedMode = null;
      return mode;
    },

    getFurnitureVisible() {
      return deps.furnitureVisible();
    },

    getLocale() {
      return deps.messages().locale;
    },

    refreshTheme() {
      deps.stage()?.applyTheme();
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
        checkpoints: () => ({ lookThrough: authoring.lookThroughId(), placing: authoring.placing() }),
        lightTemperature: () => lightTemperature.value,
      });
    },

    exportSurfaces() {
      return deps.mount().exportSurfaces();
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
      // And the authoring tools' own chrome, when they are in.
      authoring.retranslate(messages);
      deps.stage()?.walkCameras.retranslate(messages);
    },

    /**
     * What the HOST asked to highlight (`render/selection-highlight.ts`). A
     * target whose id is not a UUID highlights nothing, like an unknown one.
     */
    setSelection(target) {
      const valid = target !== null && isUuidV7(target.id) ? target : null;
      deps.stage()?.selection.setSelection(valid);
      deps.stage()?.planModes.setSelection(valid);
    },

    planView() {
      return deps.stage()?.planModes.view() ?? null;
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

    setCheckpointOverlay: (visible) => authoring.setCheckpointOverlay(visible),
    isCheckpointOverlayVisible: () => authoring.checkpointOverlay(),
    addCheckpoint: (request) => authoring.addCheckpoint(request.id),
    startCheckpointPlacement: (request) => authoring.startCheckpointPlacement(request.id),
    cancelCheckpointPlacement: () => authoring.cancelCheckpointPlacement(),
    setCheckpointFromView: (id) => authoring.setCheckpointFromView(id),
    frameCheckpoint: (id) => authoring.frameCheckpoint(id),
    lookThroughCheckpoint: (id) => authoring.lookThroughCheckpoint(id),
    endLookThrough: (commit) => authoring.endLookThrough(commit),
    focusCheckpoint: (id) => authoring.focusCheckpoint(id),
    revertCheckpointEdit: () => authoring.revertCheckpointEdit(),
    setAssetMoveTool: (enabled) => authoring.setAssetMoveTool(enabled),
    armAssetMove: () => authoring.armAssetMove(),
    revertAssetEdit: () => authoring.revertAssetEdit(),
    mirrorAsset: (assetId, axis) => authoring.mirrorAsset(assetId, axis),
    turnAsset: (assetId, steps) => authoring.turnAsset(assetId, steps),
    setPlanTool: (enabled) => authoring.setPlanTool(enabled),
    revertPlanEdit: () => authoring.revertPlanEdit(),
  };
  return commands;
}
