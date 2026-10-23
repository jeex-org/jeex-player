/**
 * The composition root: the object graph of ONE mounted viewer.
 *
 * `ViewerApp` loads a scene through a `SceneRepository`, wraps it in a
 * `SceneModel`, and wires the shell, the 3D stage, the picker, the doors, the
 * tour, the UI, the dollhouse and the editor together. It owns no markup, no
 * geometry and no scene state of its own — every one of those belongs to a
 * collaborator, and this module's whole job is knowing which.
 *
 * It is separate from `viewer-api.ts` because they answer different questions.
 * `viewer-api.ts` is the SURFACE — `mountViewer`, the handle, the exported
 * types — and it is what the three embed forms import. This is the
 * WIRING behind it, and a host never names it.
 *
 * Lifecycle invariant: `SceneMount` owns the document-to-geometry lifecycle and
 * `ViewerStage` owns the renderer and the camera stack; this module owns what
 * is DERIVED from a document (doors, furniture toggle, debug API) and re-seeds
 * all of it in `onDocument`. `dispose()` is idempotent and releases everything
 * any of the three allocated.
 *
 * Props invariant: every behaviour switch is an option, never a button. The
 * built-in chrome only reflects them, which is why
 * `chrome.controls: false` can take the whole bar away without taking anything
 * else with it.
 */

import type { ProjectInfo } from './project-wiring.js';
import type { SceneSource } from '../scene/scene-repository.js';
import { DocumentSource } from './document-source.js';
import { SceneModel } from '../scene/scene-model.js';
import { Picker } from '../geometry/picker.js';
import { hasWebGL } from '../render/render-runtime.js';
import { ViewerUI, type ViewerCommands } from '../ui/viewer-ui.js';
import { createViewerContext, ViewerDisposedError, type ViewerContext } from './viewer-context.js';
import { ViewerPageGlobals } from './viewer-page-globals.js';
import {
  sceneErrorCode,
  ViewerEvents,
  toViewerError,
  type ViewerError,
  type ViewerEventMap,
  type ViewerEventName,
} from './viewer-events.js';
import type { Messages } from '../ui/messages.js';
import { FullscreenController } from '../ui/fullscreen-controller.js';
import { Dollhouse } from '../geometry/dollhouse.js';
import { FurnitureAnimator } from '../geometry/furniture-animator.js';
import { SceneMount, textureEnvOf } from './scene-mount.js';
import { editsWiring } from './edits-wiring.js';
import { createTourControls, TourEvents, type TourControls } from '../camera/tour-controls.js';
import type { ViewerOptions } from './viewer-options.js';
import { prefersReducedMotion, resolveMotionInstant, watchMotion } from './motion-wiring.js';
import { handleCommands, type HandleCommands } from './handle-commands.js';
import { captureCommands, poseOf, type CaptureCommands } from './capture-commands.js';
import { frameHooksFor } from './viewer-frame.js';
import { seedForDocument } from './document-wiring.js';
import { DoorController } from './door-controller.js';
import { contextRecovery } from './context-recovery.js';
import { uiCommands } from './ui-commands.js';
import { stageWiring } from './stage-wiring.js';
import { applyStartView, nextFrame, showBootStep } from './viewer-boot.js';
import { ViewerStage } from './viewer-stage.js';
import type { Logger } from '../shared/logger.js';
import { instanceLogger, raiseFailure } from './viewer-failure.js';
import { telemetryWiring, type Embedding, type TelemetryWiring } from './telemetry-wiring.js';
import type { UsageSink } from '../shared/usage.js';

export class ViewerApp {
  readonly options: ViewerOptions;
  private readonly context: ViewerContext;
  private readonly roots: ViewerContext['roots'];
  private messages: Messages;
  private readonly picker: Picker;
  private readonly shell: FullscreenController;
  /** This instance's sink: `options.onLog`, else the console (`viewer-failure.ts`). */
  private readonly log: Logger = instanceLogger(() => this.options);
  private readonly tourEvents = new TourEvents(this.log);
  private readonly events = new ViewerEvents(this.log);
  /** Anonymous telemetry (`telemetry-wiring.ts`); every method a no-op when it is off. */
  private readonly telemetry: TelemetryWiring;
  private readonly usage: UsageSink = (action) => this.telemetry.usage(action);
  /**
   * The public tour surface. It is created before the camera stack exists and
   * defers to it, so a host can hold `handle.tour` from the moment
   * `mountViewer` returns; a command issued that early is replayed on the first
   * route (`tour-controls.ts`).
   */
  readonly tour: TourControls = createTourControls(
    {
      engageTour: () => this.stage?.director?.engageTour() ?? null,
      toggleTour: () => this.stage?.director?.toggleTour(),
      player: () => this.stage?.director?.tour ?? null,
      onSpeed: (speed) => this.events.emit('tourSpeed', { speed }),
    },
    this.tourEvents,
  );
  /** The commands the control bar and the progress bar can ask of the application. */
  private readonly commands: ViewerCommands = uiCommands({
    mount: () => this.mount,
    shell: () => this.shell,
    tour: this.tour,
    messages: () => this.messages,
    director: () => this.stage?.director,
    setMode: (mode) => this.handle.setMode(mode),
    setFurnitureVisible: (visible) => this.handle.setFurnitureVisible(visible),
    furnitureVisible: () => this.furnitureVisible,
    onFullscreenUnavailable: (message) => this.ui.setHint(message),
    usage: this.usage,
  });
  private readonly ui: ViewerUI;
  /**
   * `handle.capture` (`capture-commands.ts`). Built here rather than in the
   * command bag because it reads the RENDERER, which is the stage's and not
   * something any other command needs.
   */
  readonly capture: CaptureCommands = captureCommands({
    runtime: () => this.stage?.runtime,
    model: () => this.mount.model,
    livePose: () => poseOf(this.stage?.director?.controller.getPose()),
    options: () => this.options,
    messages: () => this.messages,
    shellState: () => this.dollhouse.state,
    ready: () => this.booted,
    tour: () => this.stage?.director?.tour,
    postChain: () => this.stage?.captureChain() ?? Promise.resolve(null),
  });
  /**
   * The `ViewerHandle` read/write methods (`handle-commands.ts`); built at the
   * end of the constructor. `viewer-api.ts` projects these onto the handle
   * DIRECTLY: a wrapper here for each of them was ten methods of pass-through
   * in the one module whose size limit says it may only delegate.
   */
  readonly handle: HandleCommands;
  /** The boot's source, the latest replacement's, and the project on screen (`document-source.ts`). */
  private readonly documents: DocumentSource;
  private readonly dollhouse = new Dollhouse(() => this.picker.exteriors());
  private readonly animator = new FurnitureAnimator();
  private readonly doors: DoorController;
  private readonly mount: SceneMount;
  /** The renderer, camera, view modes, map and director; `undefined` before boot. */
  private stage?: ViewerStage | undefined;
  private furnitureVisible = true;
  /** The placement overlay's switch; default OFF, like every published-tour behaviour. */
  private checkpointsVisible = false;
  /** True from the first frame of the first document until the next teardown. */
  private booted = false;
  /** True between `teardown()` and the next `init()`; Retry clears it. */
  private disposed = false;
  /** True once `dispose()` has run; unlike `disposed` it is never cleared. */
  private released = false;
  /** This instance's side of `__viewerDebug` / `__appReady` / `__viewerReadyAt`. */
  private readonly globals = new ViewerPageGlobals(this);
  /** What a lost and a restored GL context mean here (`context-recovery.ts`). */
  private readonly recovery = contextRecovery({
    ui: () => this.ui,
    mount: () => this.mount,
    messages: () => this.messages,
    emitError: (error) => this.events.emit('error', error),
    announceReady: (model) => {
      void this.announceReady(model).catch(() => undefined);
    },
    syncMinimap: () => this.stage?.syncMinimap(),
    released: () => this.released,
  });

  constructor(container: HTMLElement, options: ViewerOptions, embedding: Embedding = { embed: 'script' }) {
    this.options = options;
    // The SCENE SOURCE first, because this is the one line that can throw: a
    // library that quietly mounts SOME apartment is worse than one that says
    // it was not told which. Resolved before any DOM is built, so a throw
    // never leaves the host with an exception, a dangling viewer root and no
    // handle to dispose it with.
    this.documents = new DocumentSource(options.scene, this.log);
    // The context is built next: everything below is scoped to its root and
    // speaks its catalogue, and nothing reaches for the host document again.
    this.context = createViewerContext(container, options.locale, options.slots);
    watchMotion({ motion: options.motion, signal: this.context.signal, onChange: (instant) => this.stage?.director?.setMotion(instant) }); // reduced motion
    // The page globals belong to the FIRST viewer that mounts; a second one
    // leaves them alone (`viewer-globals.ts`).
    this.globals.claim();
    this.roots = this.context.roots;
    this.messages = this.context.messages;
    this.picker = new Picker(this.roots.canvas);
    this.shell = new FullscreenController(this.roots.viewport, {
      onFullscreenChange: () => this.ui.updateFullscreenButton(),
      signal: this.context.signal,
    });
    this.ui = new ViewerUI({
      shell: this.shell,
      roots: this.roots,
      messages: this.messages,
      commands: this.commands,
      onPanelClose: () => this.mount.editor?.forgetPanelTarget(),
      // Re-runs THIS instance's boot; `location.reload()` would reload a host
      // page the viewer does not own.
      onRetry: () => {
        void this.retry();
      },
      signal: this.context.signal,
      usage: this.usage,
    });
    // Bound right here, not deep inside `init()` — see `ViewerUI.bind()` for
    // why a boot that fails before the scene loads still needs this.
    this.ui.bind();
    this.doors = new DoorController({
      container: this.roots.viewport,
      canvas: this.roots.canvas,
      messages: this.messages,
      interactive: options.doors.interactive,
      autoOpen: () => options.doors.autoOpen,
      openings: () => this.mount.builder?.openingsList() ?? [],
      group: (openingId) => this.mount.builder?.getOpeningGroup(openingId) ?? null,
      camera: () => this.stage?.camera,
      viewport: this.shell,
      mode: () => this.stage?.mode,
      panelOpen: () => this.ui.isPanelOpen(),
      travelling: () => this.stage?.director?.controller.isTravelling() === true,
      signal: this.context.signal,
      usage: this.usage,
    });
    this.mount = new SceneMount({
      runtime: () => this.stage?.runtime,
      picker: this.picker,
      dollhouse: this.dollhouse,
      animator: this.animator,
      ui: this.ui,
      messages: this.messages,
      renderPreview: (group) => this.stage?.runtime.preview.render(group) ?? null,
      edits: editsWiring(this.options, (edit) => this.events.emit('edit', edit)),
      onDocument: (model) => this.onDocument(model),
      onAssetsChanged: (model) => this.stage?.director?.controller.refreshObstacles(model.scene),
      // A variant swap hands out a new opening group with its leaf open again.
      onOpeningsChanged: () => this.doors.reapply(),
      onError: (error) => this.events.emit('error', error),
      onModelsSettled: (model, result) => this.telemetry.modelsSettled(model, result),
      usage: this.usage,
      textureEnv: () => textureEnvOf(this.stage?.runtime.renderer, this.options.resolveTexture, this.log),
    });
    this.telemetry = telemetryWiring({
      ...embedding,
      options,
      container,
      events: this.events,
      tourEvents: this.tourEvents,
      project: () => this.project(),
      plan: () => this.mount.model?.plan,
      fullscreen: () => this.shell.isFullscreen(),
    });
    this.handle = handleCommands({
      stage: () => this.stage,
      ui: this.ui,
      events: this.events,
      tour: this.tour,
      mount: () => this.mount,
      animator: this.animator,
      context: this.context,
      options: this.options,
      furnitureVisible: () => this.furnitureVisible,
      setFurnitureVisible: (visible) => {
        this.furnitureVisible = visible;
      },
      checkpointsVisible: () => this.checkpointsVisible,
      setCheckpointsVisible: (visible) => {
        this.checkpointsVisible = visible;
      },
      messages: () => this.messages,
      setMessages: (messages) => {
        this.messages = messages;
      },
    });
  }

  get element(): HTMLElement {
    return this.roots.root;
  }

  on<K extends ViewerEventName>(event: K, callback: (payload: ViewerEventMap[K]) => void): () => void {
    return this.events.on(event, callback);
  }

  async init(): Promise<void> {
    try {
      // Re-claimed, not assumed: the Retry path runs `init()` again on an
      // instance whose failure may have given the globals back, and a viewer
      // that writes `__appReady` without holding the claim overwrites whatever
      // took it in the meantime.
      this.globals.claim();
      showBootStep(this.ui, this.messages, 'support');
      if (!hasWebGL()) {
        this.fail(
          { code: 'webgl-unavailable', message: this.messages.t('error.noWebglBody') },
          this.messages.t('error.noWebglTitle'),
          false,
        );
        return;
      }
      showBootStep(this.ui, this.messages, 'scene');
      const loaded = await this.documents.boot();
      const model = loaded.model;
      showBootStep(this.ui, this.messages, 'geometry');
      await nextFrame(this.context.signal);
      this.buildStage(model);
      if (this.stage) this.telemetry.attach(this.stage);
      this.mount.mountDocument(loaded);
      this.stage?.director?.setMotion(resolveMotionInstant(this.options.motion, prefersReducedMotion()));
      showBootStep(this.ui, this.messages, 'furniture');
      await nextFrame(this.context.signal);
      // `bind()` itself already ran, in the constructor (below).
      this.ui.setChromeOptions(this.options);
      this.ui.setTourBarEnabled(this.options.tour.progressBar);
      showBootStep(this.ui, this.messages, 'ready');
      await nextFrame(this.context.signal);
      this.ui.showViewer();
      this.globals.publishReady();
      this.ui.setHintForMode('orbit');
      // The mode the page opens in, and whether the tour runs behind it.
      const { options, ui, tour } = this;
      applyStartView({
        options,
        ui,
        tour,
        setMode: (mode) => this.handle.setMode(mode),
        engageTour: () => void this.stage?.director?.engageTour(),
      });
      // The map's own state must be right BEFORE the first frame: `__appReady`
      // is already set, and an embedding page (or a browser check) may read
      // the card's `data-visible` in the same task.
      this.stage?.syncMinimap();
      this.ui.wakeControls();
      const { dollhouse, animator, doors, mount } = this;
      this.stage?.start(frameHooksFor({ stage: () => this.stage, dollhouse, animator, doors, mount, anchor: this.context.anchor }));
      this.booted = true;
      this.events.emit('ready', { options: this.options, sceneId: model.scene.id });
    } catch (error) {
      // A boot the host cut short is not a failure to report: the shell it
      // would put the card in has already been removed from the container.
      if (error instanceof ViewerDisposedError) throw error;
      const failure = toViewerError(sceneErrorCode(error), error, this.messages.t('error.unknown'));
      this.fail(failure, this.messages.t('error.title'), true);
      throw error;
    }
  }

  /** Everything that exists once per MOUNT rather than once per document. */
  private buildStage(model: SceneModel): void {
    this.stage = new ViewerStage(
      stageWiring({
        roots: this.roots,
        viewport: this.shell,
        messages: this.messages,
        dollhouse: this.dollhouse,
        options: this.options,
        events: this.events,
        mount: this.mount,
        signal: this.context.signal,
        onContextLost: () => this.recovery.onLost(),
        onContextRestored: () => this.recovery.onRestored(),
        stage: () => this.stage,
        checkpointsVisible: () => this.checkpointsVisible,
        handle: () => this.handle,
        picker: this.picker,
        ui: this.ui,
        doors: this.doors,
        tourEvents: this.tourEvents,
        usage: this.usage,
      }),
      model.scene.presentationCamera.position,
    );
  }

  /** The manifest and folder of the project on screen, or `null` (`ViewerHandle.project`). */
  project(): ProjectInfo | null {
    return this.documents.project();
  }

  /**
   * Replaces the scene. The document is loaded and validated BEFORE anything is released, so a failure
   * leaves the current scene on screen and `rev` untouched — the host gets a rejection and an `error`
   * event, not a blank viewer. Calls race by START order (`document-source.ts`).
   */
  async loadScene(source: SceneSource): Promise<void> {
    this.telemetry.loadStarted();
    const loaded = await this.documents.replace(
      source,
      () => this.released,
      (error) => this.events.emit('error', toViewerError(sceneErrorCode(error), error, this.messages.t('error.unknown'))),
    );
    if (loaded === null) return;
    this.telemetry.beforePresent(loaded.model.scene.id);
    this.mount.present(loaded);
    await this.announceReady(loaded.model);
  }

  /**
   * `ready` for `model`, emitted after the first frame that actually SHOWS it.
   *
   * Both `init()` and `loadScene` wait for that frame: emitting in the same task as the mount
   * would hand a host that swapped scenes and screenshotted on `ready` the previous frame.
   * One meaning of the event, whichever path raised it.
   */
  private async announceReady(model: SceneModel): Promise<void> {
    await nextFrame(this.context.signal);
    this.events.emit('ready', { options: this.options, sceneId: model.scene.id });
  }

  /** Re-seeds every consumer of a new document, in one pass (`document-wiring.ts`). */
  private onDocument(model: SceneModel): void {
    seedForDocument(
      {
        ui: this.ui,
        options: this.options,
        dollhouse: this.dollhouse,
        stage: () => this.stage,
        doors: this.doors,
        shell: this.shell,
        mount: this.mount,
        tour: this.tour,
        globals: this.globals,
        messages: () => this.messages,
        furnitureVisible: () => this.furnitureVisible,
        projectLibrary: () => this.project()?.manifest.library,
        reapplyFurniture: () => this.handle.setFurnitureVisible(this.furnitureVisible, true),
        emitScene: (info) => this.events.emit('scene', info),
      },
      model,
    );
  }

  // ------------------------------------------------------------ internals ---

  /**
   * The Retry button: tears this instance down and boots it again in the same
   * container. `disposed` is cleared first, because the error card the button
   * sits on is shown by a path that disposed the instance.
   */
  private async retry(): Promise<void> {
    // A released instance has no shell left to boot into: its Retry button is
    // gone with the rest of the markup, but a host may still hold the closure.
    if (this.released) return;
    this.disposed = false;
    this.ui.showLoading();
    await this.init().catch((error: unknown) => {
      this.log.error('retry-failed', 'viewer retry failed', error);
    });
  }

  /** The card and the `error` event together (`viewer-failure.ts`). */
  private fail(failure: ViewerError, title: string, retry: boolean): void {
    raiseFailure(
      {
        emitError: (error) => this.events.emit('error', error),
        teardown: () => this.teardown(),
        showError: (cardTitle, message, offerRetry) => this.ui.showError(cardTitle, message, offerRetry),
      },
      failure,
      title,
      retry,
    );
  }

  /**
   * Everything that exists once per BOOT: the stage, the doors, the animator, the mounted
   * document and the UI's timers. Idempotent, and it leaves the shell, the events and the page
   * globals alone — Retry runs `init()` again on exactly this state.
   */
  private teardown(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.booted = false;
    this.stage?.dispose();
    this.stage = undefined;
    this.doors.dispose();
    this.animator.dispose();
    this.mount.release();
    this.shell.dispose();
    this.ui.dispose();
  }

  /**
   * Idempotent teardown of everything this root allocated or subscribed to, ending with the
   * host's DOM exactly as the mount found it.
   *
   * `context.release()` is the last line on purpose and does the three things nothing else can:
   * it aborts the ONE `AbortController` every listener in this instance was bound with, gives the
   * adopted stylesheet claim back (the sheet goes when the last viewer in that root goes), and
   * removes the shell from the container. After this the container has no children, the page has
   * no listener of ours on it, and the GL context has been handed back (`RenderRuntime.dispose`).
   */
  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.teardown();
    this.telemetry.dispose();
    this.tourEvents.clear();
    this.events.clear();
    // `window.jeexViewer` is not ours at all — `main.ts` publishes it and owns
    // it; these three are, while this instance holds the claim.
    this.globals.release();
    this.context.release();
  }
}
