/**
 * The handle `<jeex-viewer>.viewer` returns from the moment the element is
 * connected, whether or not its viewer has started yet.
 *
 * The element starts its viewer only when it nears the viewport or is
 * interacted with (`element-start.ts`), so for a while there is no real
 * `ViewerHandle` to give a host. This object stands in for it and keeps the
 * contract a handle already has before its first scene exists
 * (`viewer-handle.ts`: "everything is safe to call the moment `mountViewer`
 * returns"), so a host script cannot tell a deferred start from a slow boot:
 *
 * - every command that returns nothing (`setMode`, `setLocale`, the tour's
 *   transport, `setSelection`, ...) and `loadScene` is QUEUED and replayed on
 *   the real handle, in call order, when it exists; `loadScene`'s promise
 *   settles with the replayed call;
 * - every query answers as a viewer before its first scene does: the mode,
 *   locale and furniture switch from the options (or from a queued setter),
 *   `null` for the scene, the project, the selection description and the tour
 *   progress, `false` for every command that answers whether it did anything;
 * - `capture.*`, `exportGlb` and `exportUsdz` reject `not-ready`, exactly as
 *   they do before the first frame;
 * - `on(...)` subscribes now and is carried over to the real handle;
 * - `ready` is one promise for the element's whole connection: it settles
 *   with the real handle's own `ready`, and rejects `disposed` if the element
 *   is disconnected (or the handle disposed) before the viewer started.
 *
 * Nothing here starts the viewer: a call on a below-the-fold element must not
 * cost the download the deferral exists to avoid.
 *
 * Once the real handle exists every member forwards to it, so a host that
 * kept this object keeps driving the running viewer.
 */

import type { AnchorPoint, AnchorTarget, NewCheckpoint, ViewerHandle, ViewerSlots, ViewerState } from '../app/viewer-handle.js';
import type { ViewerOptions } from '../app/viewer-options.js';
import type { ViewerEventMap, ViewerEventName } from '../app/viewer-events.js';
import type { CaptureCommands } from '../app/capture-commands.js';
import type { ViewerSelection, ViewerSelectionTarget } from '../app/selection.js';
import type { SelectionDescription } from '../ui/selection-options.js';
import type { SlotName } from '../ui/host-slots.js';
import type { TourControls, TourProgress } from '../camera/tour-controls.js';
import type { TourSpeed } from '../camera/tour-player.js';
import type { MirrorAxis, SceneData, ViewerMode } from '../scene/types.js';
import type { Locale } from '../ui/messages.js';
import type { SceneSource } from '../scene/scene-repository.js';
import type { ProjectInfo } from '../app/project-wiring.js';
import { ViewerLibError } from '../shared/errors.js';
import { requireLightTemperature } from '../app/light-temperature-check.js';

/** What the stand-in needs from the element that owns it. */
export type PendingViewerHost = {
  /** The options as the viewer will resolve them, read now (no warnings: the mount reports those). */
  options(): Readonly<ViewerOptions>;
  /** The box the viewer will be built in; `element` answers it until the viewer's own root exists. */
  container(): HTMLElement;
  /** A replayed call threw on the real handle; the element logs it. */
  report(error: unknown): void;
};

type Listener = { event: ViewerEventName; callback: (payload: never) => void; off: (() => void) | null };
type TourListener = { event: 'progress' | 'state' | 'ended'; callback: (payload: never) => void; off: (() => void) | null };

/**
 * The tour speeds the real controls accept (`TOUR_SPEEDS` in `tour-player.ts`,
 * which this eager module cannot import: it pulls three.js in). A unit test
 * keeps the two equal.
 */
export const PENDING_TOUR_SPEEDS = [1, 2, 0.5] as const;

const notReady = (what: string): ViewerLibError => new ViewerLibError('not-ready', `viewer: ${what} needs the viewer to have started`);
const disposed = (): ViewerLibError => new ViewerLibError('disposed', 'viewer: disposed before the scene was on screen');

export class PendingViewer implements ViewerHandle {
  readonly ready: Promise<void>;
  readonly tour: TourControls;
  readonly capture: CaptureCommands;
  readonly slots: ViewerSlots;
  readonly [Symbol.dispose]?: () => void;

  private readonly host: PendingViewerHost;
  private real: ViewerHandle | null = null;
  /** True from the started viewer's first `ready` event: from then on every call goes straight to it. */
  private booted = false;
  /** True from its first `scene` event: queries are answered by it from then on. */
  private answering = false;
  /** True once the element let go of this stand-in, or a host disposed it. */
  private closed = false;
  private readonly queue: Array<(handle: ViewerHandle) => void> = [];
  /** This object's own listeners on the started viewer, undone when it lets go. */
  private ownOffs: Array<() => void> = [];
  /** The rejections of the queued `loadScene` calls, for a stand-in that will never start them. */
  private readonly waitingLoads = new Set<(error: unknown) => void>();
  private readonly listeners: Listener[] = [];
  private readonly tourListeners: TourListener[] = [];
  private settle: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  /** The values the queued setters will leave, for the queries asked before the start. */
  private mode: ViewerMode | null = null;
  private locale: Locale | null = null;
  private furniture: boolean | null = null;
  private overlay: boolean | null = null;
  /** A temperature set before the start; `undefined` while none was. */
  private temperature: number | null | undefined = undefined;

  constructor(host: PendingViewerHost) {
    this.host = host;
    this.ready = new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject };
    });
    // A rejection nobody awaits is the host's choice, not an unhandled one;
    // the real handle's `ready` is treated the same way (`viewer-api.ts`).
    this.ready.catch(() => undefined);
    if (typeof Symbol.dispose === 'symbol') this[Symbol.dispose] = () => this.dispose();
    this.tour = this.tourControls();
    this.capture = this.captureCommands();
    this.slots = this.viewerSlots();
  }

  /** Whether a viewer is running behind this stand-in. */
  get started(): boolean {
    return this.real !== null;
  }

  /** Whether the host disposed this handle before the start: the element must not start then. */
  get disposed(): boolean {
    return this.closed;
  }

  /**
   * The viewer started: carry the subscriptions over at once (the boot's own
   * `scene` and `ready` events must reach them) and follow its `ready`.
   *
   * Queries go to the running viewer from its first `scene` event on, when it
   * has a document to answer about. Commands wait for its first `ready`
   * EVENT, when the camera stack exists and the opening view is applied (a
   * real handle drops a `setMode` or a `setSelection` that arrives earlier,
   * and the opening view would overwrite one), and they are replayed inside
   * that event, before the element's own `jeex-ready`, so a host's
   * `jeex-ready` listener already sees them applied. Calls made while the boot
   * runs join the queue, so the order holds. A boot that fails replays
   * nothing: the queue waits for a Retry that reaches `ready`, or rejects its
   * `loadScene` calls as `disposed` when the element leaves.
   *
   * Registered before the element's own subscriptions (`element-controller.ts`
   * attaches first), so these run first for each event.
   */
  attach(handle: ViewerHandle): void {
    if (this.closed || this.real !== null) return;
    this.real = handle;
    const offScene = handle.on('scene', () => {
      this.answering = true;
      offScene();
    });
    const offReady = handle.on('ready', () => {
      offReady();
      offScene();
      this.answering = true;
      this.booted = true;
      for (const call of this.queue.splice(0)) {
        try {
          call(handle);
        } catch (error) {
          this.host.report(error);
        }
      }
    });
    for (const listener of this.listeners) listener.off = handle.on(listener.event, listener.callback as never);
    for (const listener of this.tourListeners)
      listener.off = (handle.tour.on as (event: string, callback: never) => () => void)(listener.event, listener.callback as never);
    this.ownOffs = [offScene, offReady];
    const settle = this.settle;
    this.settle = null;
    if (settle) handle.ready.then(settle.resolve, settle.reject);
  }

  /** The running viewer once it has a document to answer about; before that the answers are this object's own. */
  private live(): ViewerHandle | null {
    return this.answering ? this.real : null;
  }

  /** The running viewer once it takes commands; before that they are queued. */
  private direct(): ViewerHandle | null {
    return this.booted ? this.real : null;
  }

  /** The element let go (a disconnect): a stand-in that never started rejects `disposed`. */
  close(): void {
    this.fail(disposed());
  }

  /** The viewer will not start (its module could not be loaded): `ready` rejects with `error`. */
  fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    // A queued `loadScene` will never run: its caller hears why instead of waiting forever.
    for (const reject of this.waitingLoads) reject(error);
    this.waitingLoads.clear();
    for (const off of this.ownOffs) off();
    this.ownOffs = [];
    this.settle?.reject(error);
    this.settle = null;
  }

  get element(): HTMLElement {
    return this.real?.element ?? this.host.container();
  }

  get options(): Readonly<ViewerOptions> {
    return this.real?.options ?? this.host.options();
  }

  /** Runs `call` on the real handle now, or queues it for the start. */
  private command(call: (handle: ViewerHandle) => void): void {
    const live = this.direct();
    if (live) call(live);
    else if (!this.closed) this.queue.push(call);
  }

  loadScene(source: SceneSource): Promise<void> {
    const live = this.direct();
    if (live) return live.loadScene(source);
    if (this.closed) return Promise.reject(disposed());
    return new Promise<void>((resolve, reject) => {
      this.waitingLoads.add(reject);
      this.queue.push((handle) => {
        this.waitingLoads.delete(reject);
        handle.loadScene(source).then(resolve, reject);
      });
    });
  }

  setMode(mode: ViewerMode): void {
    if (!this.booted) this.mode = mode;
    this.command((handle) => handle.setMode(mode));
  }
  getMode(): ViewerMode {
    if (!this.booted && this.mode !== null) return this.mode;
    return this.live()?.getMode() ?? this.host.options().view.mode;
  }
  getState(): ViewerState {
    const live = this.live();
    if (live) return live.getState();
    return {
      mode: this.getMode(),
      tour: null,
      furnitureVisible: this.getFurnitureVisible(),
      locale: this.getLocale(),
      sceneId: null,
      rev: 0,
      walk: { camera: { index: null, count: 0 } },
      checkpoints: { lookThrough: null, placing: false },
      lightTemperature: this.temperature === undefined ? this.host.options().lighting.temperature : this.temperature,
    };
  }
  getScene(): SceneData | null {
    return this.live()?.getScene() ?? null;
  }
  project(): ProjectInfo | null {
    return this.live()?.project() ?? null;
  }
  exportGlb(...args: Parameters<ViewerHandle['exportGlb']>): Promise<Blob> {
    const live = this.live();
    return live ? live.exportGlb(...args) : Promise.reject(notReady('exportGlb'));
  }
  exportUsdz(...args: Parameters<ViewerHandle['exportUsdz']>): Promise<Blob> {
    const live = this.live();
    return live ? live.exportUsdz(...args) : Promise.reject(notReady('exportUsdz'));
  }
  getFurnitureVisible(): boolean {
    if (!this.booted && this.furniture !== null) return this.furniture;
    return this.live()?.getFurnitureVisible() ?? true;
  }
  getLocale(): Locale {
    if (!this.booted && this.locale !== null) return this.locale;
    return this.live()?.getLocale() ?? this.host.options().locale;
  }
  focusRoom(roomId: string): boolean {
    return this.live()?.focusRoom(roomId) ?? false;
  }
  stepCamera(to: 'next' | 'previous' | 'first' | 'last' | number): boolean {
    return this.live()?.stepCamera(to) ?? false;
  }
  setFurnitureVisible(visible: boolean): void {
    if (!this.booted) this.furniture = visible;
    this.command((handle) => handle.setFurnitureVisible(visible));
  }
  /** Refused at the call, before the start too; queued like every setter. */
  setLightTemperature(temperature: number | null): void {
    const value = requireLightTemperature(temperature);
    if (!this.booted) this.temperature = value;
    this.command((handle) => handle.setLightTemperature(value));
  }
  setLocale(locale: Locale): void {
    if (!this.booted) this.locale = locale;
    this.command((handle) => handle.setLocale(locale));
  }
  setSelection(target: ViewerSelectionTarget | null): void {
    this.command((handle) => handle.setSelection(target));
  }
  setCheckpointOverlay(visible: boolean): void {
    if (!this.booted) this.overlay = visible;
    this.command((handle) => handle.setCheckpointOverlay(visible));
  }
  isCheckpointOverlayVisible(): boolean {
    if (!this.booted && this.overlay !== null) return this.overlay;
    return this.live()?.isCheckpointOverlayVisible() ?? false;
  }
  addCheckpoint(request: NewCheckpoint): boolean {
    return this.live()?.addCheckpoint(request) ?? false;
  }
  startCheckpointPlacement(request: NewCheckpoint): boolean {
    return this.live()?.startCheckpointPlacement(request) ?? false;
  }
  cancelCheckpointPlacement(): void {
    this.command((handle) => handle.cancelCheckpointPlacement());
  }
  setCheckpointFromView(id: string): boolean {
    return this.live()?.setCheckpointFromView(id) ?? false;
  }
  frameCheckpoint(id: string): boolean {
    return this.live()?.frameCheckpoint(id) ?? false;
  }
  lookThroughCheckpoint(id: string): boolean {
    return this.live()?.lookThroughCheckpoint(id) ?? false;
  }
  endLookThrough(commit: boolean): boolean {
    return this.live()?.endLookThrough(commit) ?? false;
  }
  focusCheckpoint(id: string | null): boolean {
    return this.live()?.focusCheckpoint(id) ?? false;
  }
  revertCheckpointEdit(): void {
    this.command((handle) => handle.revertCheckpointEdit());
  }
  setAssetMoveTool(enabled: boolean): void {
    this.command((handle) => handle.setAssetMoveTool(enabled));
  }
  armAssetMove(): void {
    this.command((handle) => handle.armAssetMove());
  }
  revertAssetEdit(): void {
    this.command((handle) => handle.revertAssetEdit());
  }
  mirrorAsset(assetId: string, axis: MirrorAxis): boolean {
    return this.live()?.mirrorAsset(assetId, axis) ?? false;
  }
  turnAsset(assetId: string, steps: number): boolean {
    return this.live()?.turnAsset(assetId, steps) ?? false;
  }
  describeSelection(target: ViewerSelection): SelectionDescription | null {
    return this.live()?.describeSelection(target) ?? null;
  }
  resize(): void {
    this.command((handle) => handle.resize());
  }

  on<K extends ViewerEventName>(event: K, callback: (payload: ViewerEventMap[K]) => void): () => void {
    if (this.real) return this.real.on(event, callback);
    const listener: Listener = { event, callback, off: null };
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
      listener.off?.();
    };
  }

  /** A host's own `dispose()`: the running viewer's teardown, or, before the start, no start at all. */
  dispose(): void {
    this.real?.dispose();
    // Queued calls will never run on a disposed viewer: their callers hear it.
    this.close();
  }

  /** The tour's transport, queued like the handle's commands; `progress()` is `null` before the start. */
  private tourControls(): TourControls {
    const transport = (call: (tour: TourControls) => void): void => this.command((handle) => call(handle.tour));
    const on = (event: 'progress' | 'state' | 'ended', callback: (payload: never) => void): (() => void) => {
      if (this.real) return (this.real.tour.on as (name: string, listener: never) => () => void)(event, callback as never);
      const listener: TourListener = { event, callback, off: null };
      this.tourListeners.push(listener);
      return () => {
        const index = this.tourListeners.indexOf(listener);
        if (index >= 0) this.tourListeners.splice(index, 1);
        listener.off?.();
      };
    };
    return {
      play: () => transport((tour) => tour.play()),
      pause: () => transport((tour) => tour.pause()),
      toggle: () => transport((tour) => tour.toggle()),
      stop: () => transport((tour) => tour.stop()),
      seek: (fraction: number) => transport((tour) => tour.seek(fraction)),
      seekDistance: (metres: number) => transport((tour) => tour.seekDistance(metres)),
      seekTime: (seconds: number) => transport((tour) => tour.seekTime(seconds)),
      setSpeed: (speed: TourSpeed) => {
        // Refused at the call, as the real controls do, not later inside the replay.
        if (!(PENDING_TOUR_SPEEDS as readonly number[]).includes(speed)) {
          throw new ViewerLibError('bad-params', `tour speed must be one of ${PENDING_TOUR_SPEEDS.join(', ')}, got ${String(speed)}`);
        }
        transport((tour) => tour.setSpeed(speed));
      },
      progress: (): TourProgress | null => this.live()?.tour.progress() ?? null,
      on,
    };
  }

  /** Every capture rejects `not-ready` before the start, as it does before the first frame. */
  private captureCommands(): CaptureCommands {
    const real = (): CaptureCommands | null => this.live()?.capture ?? null;
    return {
      still: (request) => real()?.still(request) ?? Promise.reject(notReady('capture.still')),
      panorama: (request) => real()?.panorama(request) ?? Promise.reject(notReady('capture.panorama')),
      pair: (request) => real()?.pair(request) ?? Promise.reject(notReady('capture.pair')),
      frames: (request) => real()?.frames(request) ?? Promise.reject(notReady('capture.frames')),
    };
  }

  /** The host's boxes exist only with the viewer's shell; the anchor is queued like any command. */
  private viewerSlots(): ViewerSlots {
    return {
      get: (name: SlotName): HTMLElement => {
        const live = this.live();
        if (live) return live.slots.get(name);
        throw notReady(`slots.get("${name}")`);
      },
      anchorTo: (target: AnchorTarget | null) => this.command((handle) => handle.slots.anchorTo(target)),
      anchorPoint: (): AnchorPoint | null => this.live()?.slots.anchorPoint() ?? null,
    };
  }
}
