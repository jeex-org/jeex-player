/**
 * The public contract of a mounted viewer: what a host holds after
 * `mountViewer(container, options)`.
 *
 * It lives apart from `viewer-api.ts` on purpose. This file is the CONTRACT —
 * no imports but types, nothing to run — and the composition root is what
 * satisfies it. The three embed forms (the ES module, the custom
 * element and the postMessage bridge) all speak exactly this, so a change here
 * is a change to every one of them.
 *
 * Everything is safe to call the moment `mountViewer` returns, before the first
 * scene exists: the tour remembers the last command and replays it
 * (`tour-controls.ts`), and the other commands are no-ops until there is a
 * camera to move.
 */

import type { MirrorAxis, SceneData, ViewerMode } from '../scene/types.js';
import type { Locale } from '../ui/messages.js';
import type { SceneSource } from '../scene/scene-repository.js';
import type { TourControls, TourProgress } from '../camera/tour-controls.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ProjectInfo } from './project-wiring.js';
import type { ViewerEventMap, ViewerEventName } from './viewer-events.js';
import type { CaptureCommands } from './capture-commands.js';
import type { ViewerSelection, ViewerSelectionTarget } from './selection.js';
import type { SelectionDescription } from '../ui/selection-options.js';
import type { SlotName } from '../ui/host-slots.js';
// From the leaf `export-types.ts`, never from `export-gltf.ts`/`export-usdz.ts`
// themselves: either of those modules importing anything from THIS file (they
// need none) plus this file importing from them would be a type-only import
// cycle, which dependency-cruiser's `no-circular` gate refuses
// (`export-types.ts`'s header).
import type { ExportGlbOptions, ExportUsdzOptions } from './export-types.js';

/**
 * Everything a host can ask about a running viewer, in one read.
 *
 * It exists because the alternative is five round trips that can disagree: a
 * host rendering its own chrome wants the mode, the tour position and the
 * furniture switch as they were at ONE moment, and across a frame boundary
 * (`embed/host.ts`) five commands are five messages. `sceneId` and `rev`
 * identify the document the rest of the answer is about.
 */
export type ViewerState = {
  mode: ViewerMode;
  /** The tour's position, or `null` when the scene carries no clip. */
  tour: TourProgress | null;
  furnitureVisible: boolean;
  locale: Locale;
  /** The document on screen, or `null` before the first one is built. */
  sceneId: string | null;
  /** Its committed revision; `0` before the first document. */
  rev: number;
  /**
   * The walk: the tour camera the walker last stood on or stepped to
   * (0-based `index`, `null` when none yet) and how many cameras there are.
   * The `walkCamera` event announces each change.
   */
  walk: { camera: { index: number | null; count: number } };
  /**
   * The tour-camera tool: the camera being looked through (`null` outside a
   * look-through) and whether click-to-place is waiting for a click. The
   * `checkpointLookThrough` and `checkpointPlacing` events announce each change.
   */
  checkpoints: { lookThrough: string | null; placing: boolean };
  /**
   * The colour temperature of the interior's artificial light, kelvin, or
   * `null` for «Original». The `lightTemperature` event announces each change.
   */
  lightTemperature: number | null;
};

/**
 * What the `selection-anchor` box follows: a bare scene point, or an entity the
 * viewer can find in the document (the same `{ kind, id }` `setSelection`
 * takes). An entity is resolved to the centre of its meshes' bounding box.
 */
export type AnchorTarget = { x: number; y: number; z: number } | ViewerSelectionTarget;

/**
 * A tour camera the host asks the viewer to create: the host mints its UUID v7
 * (the viewer mints no id), the viewer supplies the pose.
 */
export type NewCheckpoint = { readonly id: string };

/**
 * Where the anchor is, in CSS pixels of the viewport, and whether that place is
 * on screen at all. A point behind the camera or outside the viewport keeps its
 * last numbers and reports `visible: false` — the box is hidden rather than
 * dragged to an edge.
 */
export type AnchorPoint = { x: number; y: number; visible: boolean };

/**
 * The boxes a host renders its own chrome into, and the one of them the viewer
 * moves for it. The vocabulary is `SLOT_NAMES`
 * (`ui/host-slots.ts`); which boxes exist is `options.slots`.
 */
export type ViewerSlots = {
  /**
   * The slot's box, for the host to render into. The node lives for the whole
   * mount; the viewer never reads or empties its content. Throws
   * `MissingSlotError` when `options.slots` did not name the slot.
   */
  get(name: SlotName): HTMLElement;
  /**
   * What `'selection-anchor'` follows; `null` parks it. The projection runs
   * once a frame and writes `--jeex-anchor-x`/`-y` and `data-visible` — there
   * is deliberately no 60 Hz event to subscribe to.
   */
  anchorTo(target: AnchorTarget | null): void;
  /** The last published position, or `null` while the anchor is parked. */
  anchorPoint(): AnchorPoint | null;
};

export type ViewerHandle = {
  /**
   * The viewer's own root inside the host's container — for measuring,
   * styling, or putting something of the host's own on top of it. The container
   * itself stays the host's: the viewer adds one child and touches nothing
   * above it.
   */
  readonly element: HTMLElement;
  /** The options as RESOLVED — every default filled in, every bad value replaced. */
  readonly options: Readonly<ViewerOptions>;
  readonly tour: TourControls;
  /**
   * Stills, panoramas and the «as is» pair, each with a `Provenance` sidecar
   * and — unless the host says otherwise — the disclosure caption burnt in
   * (`capture-commands.ts`). Nothing here touches the
   * camera on screen: every capture renders beside the live view, into a
   * target of its own. A command before the first frame rejects `not-ready`.
   */
  readonly capture: CaptureCommands;
  /**
   * The host's own boxes inside the viewport, and the anchor that follows a
   * scene point. Present the moment `mountViewer` returns, before
   * any scene exists: the boxes are built with the shell, not with the
   * document.
   */
  readonly slots: ViewerSlots;
  /**
   * Resolves when the FIRST scene is built and its first frame rendered, and
   * rejects when that boot failed — the viewer shows its own error card either
   * way. Later scenes report through the `ready` EVENT: a promise can only
   * settle once.
   */
  ready: Promise<void>;
  /**
   * Replaces the scene. A failure leaves the current one on screen untouched —
   * the document is validated before anything is torn down — and rejects with
   * a `ViewerError` whose code says whether the source or the document was the
   * problem.
   *
   * Calls race by START order, not completion order: when a call is still
   * loading its document while a LATER call starts, the older call is
   * superseded — its document, even a perfectly valid one, is discarded
   * without being mounted, it never fires `scene` or `ready`, and (win or
   * lose) it never fires `error` either, because nothing about that call's own
   * source or document was wrong. Its promise resolves quietly instead, so a
   * host awaiting it sees the call finish rather than hang. Only the call that
   * is still the latest when its document finishes loading reaches the
   * screen. `dispose()` while a call is in flight supersedes it the same way.
   */
  loadScene(source: SceneSource): Promise<void>;
  /**
   * Switches the mode, exactly as the mode buttons do. Choosing `'orbit'` (360)
   * ends on the Reset camera pose, from any mode and from 360 itself; the embed protocol's `setMode` and the
   * element's `mode` attribute go through here too.
   */
  setMode(mode: ViewerMode): void;
  /** The mode on screen; the option's value until the camera stack exists. */
  getMode(): ViewerMode;
  /** Everything above in one consistent read (`ViewerState`). */
  getState(): ViewerState;
  /**
   * A deep, mutable copy of the committed document (`SceneModel.toJSON`), or `null` before the
   * first scene is built. Re-loadable through `loadScene({ document })`; `window.__viewerDebug`'s
   * `exportScene` is an alias for it, kept for `scripts/browser-check/*`.
   */
  getScene(): SceneData | null;
  /**
   * The BAKED PROJECT on screen — its manifest and the folder it was served
   * from — or `null` when the document is a bare scene.
   *
   * The manifest is the whole one, `media` and `rights` included: the viewer
   * plays no video and enforces no licence, and a host's own
   * chrome — a listing card, a downloads menu, a rights notice — is what those
   * two fields exist for. It is the manifest as VALIDATED, so a host may read
   * it without judging it again.
   */
  project(): ProjectInfo | null;
  /**
   * Exports the committed document as a GLB, with the element metadata table
   * (`scene/metadata-table.ts`) riding along as `EXT_structural_metadata` /
   * `EXT_mesh_features` and `extras.jeex` (`app/export-gltf.ts`). Rejects with
   * a `not-ready` `ViewerError` before the first scene. `GLTFExporter` is
   * imported lazily, so the call costs nothing until it is made.
   */
  exportGlb(options?: ExportGlbOptions): Promise<Blob>;
  /**
   * Exports the committed document as a USDZ, for iOS Quick Look
   * (`app/export-usdz.ts`). Rejects with a `not-ready` `ViewerError` before
   * the first scene. `USDZExporter` is imported lazily, like `exportGlb`.
   */
  exportUsdz(options?: ExportUsdzOptions): Promise<Blob>;
  /** Whether the demo furniture is on screen. */
  getFurnitureVisible(): boolean;
  /** The locale the chrome is speaking now, which `setLocale` changes. */
  getLocale(): Locale;
  /** Flies the camera to a room by its UUID; `false` when the id is not a UUID v7 or the scene has no such room. */
  focusRoom(roomId: string): boolean;
  /**
   * Steps the walk to a tour camera: the walker walks
   * the leg through the openings and stops on the camera's pose; a manual
   * input cancels the step. `'next'`/`'previous'` go from the current camera
   * (both go to camera 1 while there is none), `'first'`/`'last'` to the ends,
   * a number to that 0-based camera. From `tour` the run pauses and the viewer
   * switches to `walk` first. `false` when nothing started: another mode, no
   * such camera, or an end of the list.
   */
  stepCamera(to: 'next' | 'previous' | 'first' | 'last' | number): boolean;
  setFurnitureVisible(visible: boolean): void;
  /**
   * The colour temperature of the interior's artificial light (the lamps and
   * the walk's ambient floor): kelvin from 2700 to 6500 in steps of 100, or
   * `null` for «Original». Daylight never changes. Throws a `ViewerLibError`
   * with code `bad-params` (path `lightTemperature`) for any other value and
   * keeps the current one; an unchanged value raises no event.
   */
  setLightTemperature(temperature: number | null): void;
  /** Re-translates the chrome in place; the scene is not rebuilt. */
  setLocale(locale: Locale): void;
  /**
   * Highlights one wall, opening, room or furniture placement, or clears the
   * highlight with `null`. The viewer never changes the selection by itself: a
   * host usually calls this from its own `select` handler (`options.select`).
   * A target whose id is not a UUID v7, or that the current document does not
   * carry, highlights nothing, silently.
   * The highlight survives a `loadScene`/rebuild when the target is still
   * there. Visible in `plan3d` and `orbit`; `plan2d` draws a 2D plan with the
   * renderer off, so nothing shows there.
   */
  setSelection(target: ViewerSelectionTarget | null): void;
  /**
   * Shows or hides the tour-camera placement overlay — the small camera
   * markers, the smooth trajectory through them, the click-to-focus gizmo and
   * the camera-preview card. OFF by default: a published tour and a plain
   * viewer never see any of it, and the host that wants it turns it on
   * (an editor host's header does, from its own toggle). While visible,
   * `checkpointSelect`/`checkpointEdit` report the author's gestures and the
   * HOST commits each edit as one `set_tour_checkpoints` op.
   */
  setCheckpointOverlay(visible: boolean): void;
  /** The overlay switch as it stands now. */
  isCheckpointOverlayVisible(): boolean;
  /**
   * «Add from current view»: a new tour camera `request.id` from the view on screen — the
   * exact eye in `walk` (and in a look-through), and in `orbit` the floor
   * point at the screen centre (else the orbit target) stood on navigable
   * floor and stepped back toward the author — always at eye height with a
   * level pitch. The new camera is selected, framed when off-screen, and
   * reported through `checkpointEdit`. The id is the host's: the viewer mints
   * none, so `false` (and nothing created) for an id that is not a UUID v7 or
   * that a camera already carries; `false` too with the overlay off, in a
   * plan mode, or before the first scene. A viewer command rather than a host
   * calculation because only the viewer knows where its camera looks (a
   * camera pose is deliberately not part of any public state).
   */
  addCheckpoint(request: NewCheckpoint): boolean;
  /**
   * «Add camera»: click-to-place. The next click on the floor drops camera
   * `request.id` there (a click-and-drag aims it toward the release point); a ghost follows
   * the pointer meanwhile, green over navigable floor and red elsewhere. Ends
   * after one drop, on Esc, on `cancelCheckpointPlacement` and on a mode
   * change; `checkpointPlacing` reports both edges. A call while placing only
   * changes the id the drop will take. `false` for an id that is not a fresh
   * UUID v7 (the `addCheckpoint` rule), outside `orbit` and `plan3d` or with
   * the overlay off.
   */
  startCheckpointPlacement(request: NewCheckpoint): boolean;
  cancelCheckpointPlacement(): void;
  /** «Set from current view»: replaces one camera's pose by the `addCheckpoint` rules, keeping its id and name. */
  setCheckpointFromView(id: string): boolean;
  /** «Frame»: flies the orbit to show one camera, and focuses it; `false` for an unknown id or with the overlay off. */
  frameCheckpoint(id: string): boolean;
  /**
   * «Look through»: the author pilots one camera from inside it with the walk
   * controls (drag, WASD, E/Q for height) until `endLookThrough`, Enter/Esc or
   * the viewer's own «Done»/«Cancel». The mode reads `walk` meanwhile;
   * `checkpointLookThrough` reports the start and the end.
   */
  lookThroughCheckpoint(id: string): boolean;
  /**
   * Ends a look-through: `commit: true` reports the new pose as ONE
   * `checkpointEdit` (none when it did not change), `false` drops it; either
   * way the view returns to where the orbit stood. `false` when none was running.
   */
  endLookThrough(commit: boolean): boolean;
  /**
   * Focuses a tour checkpoint exactly as a click on its marker does — the
   * gizmo appears on it and the camera-preview card shows its view — and
   * reports it through `checkpointSelect`. For a host's own list of the
   * cameras. `false` while the overlay is off or when the document carries no
   * checkpoint with that id; `null` clears the focus.
   */
  focusCheckpoint(id: string | null): boolean;
  /**
   * Drops the overlay's uncommitted working copy and redraws the committed
   * checkpoints. For a host that REFUSED to commit a `checkpointEdit` (a batch
   * already in flight, a validation error): without it the overlay keeps
   * drawing the drag the document never took.
   */
  revertCheckpointEdit(): void;
  /**
   * Arms (`true`) or disarms the asset move tool: with it armed, a press on the furniture `setSelection` highlighted
   * and a drag past 4 px moves it on its anchor surface in `orbit` and
   * `plan3d`, judged by the layout rules, with the legal and illegal places
   * drawn on the surface. A legal release emits `assetEdit` for the host to
   * commit; an illegal one reverts and emits `assetEditRefused`;
   * `assetMoveState` reports each edge of a drag or a key burst. The first
   * arming loads the tool as its own chunk. Default off; a published tour
   * never arms it.
   */
  setAssetMoveTool(enabled: boolean): void;
  /**
   * The next press on the scene canvas moves the selected object there (the
   * editor's «Move» toggle); armed tool only. Presses on the chrome or on host
   * slot content pass through and leave it armed.
   */
  armAssetMove(): void;
  /** The host refused the last `assetEdit` (a 409, a 422): the object goes back to where the move started. */
  revertAssetEdit(): void;
  /**
   * Toggles one mirror axis of a placement: judged like a move, it emits `assetEdit` with `mirror_object`
   * (plus a `move_object` when the mirrored object had to settle within
   * 0.25 m) or `assetEditRefused`. `false`, with no event, when the asset's
   * facts do not allow the axis (`describeSelection(...).mirror.allowed`), the
   * asset is unknown, the move tool is not armed (or not loaded yet) in
   * `orbit`/`plan3d`, or a drag is running.
   */
  mirrorAsset(assetId: string, axis: MirrorAxis): boolean;
  /**
   * Turns the placement `assetId` by `steps` × 15° (positive counter-clockwise
   * seen from above, as Q),
   * judged like a move: settled within 0.25 m when the turned pose is not
   * legal, refused when nothing within reach is. Emits `assetEdit` or
   * `assetEditRefused` and answers `true`; answers `false` with no event when
   * the asset move tool is not armed (or not loaded yet) in `orbit`/`plan3d`,
   * a drag is running, the id is unknown, or the object hangs on a wall.
   */
  turnAsset(assetId: string, steps: number): boolean;
  /**
   * Everything the viewer's OWN selection panel would show for a selection,
   * as data: the title, the subject, the option in force, and one entry per
   * swatch carrying a ready `preview` image URL and the exact `SceneOp` that
   * applies it. A host renders its own card from this and
   * commits the op itself; it never learns about the viewer's catalogues.
   *
   * Takes the `select` event's payload verbatim. `null` when there is nothing
   * to offer — a click that landed on nothing, a room or wall the document
   * does not carry, an id that names no placement or opening — and `null`
   * before the first scene is built.
   *
   * Independent of `options.edits`: it opens nothing and commits nothing, so
   * the answer is the same with `edits: 'off'`, where the built-in panel never
   * appears at all. Previews are rendered on demand, with the viewer's own
   * renderer, at the moment of the call.
   */
  describeSelection(target: ViewerSelection): SelectionDescription | null;
  /**
   * Re-measures the container. Normally unnecessary — the viewer observes its
   * own box — and here for the host that resizes it inside a transition the
   * observer cannot see.
   */
  resize(): void;
  on<K extends ViewerEventName>(event: K, callback: (payload: ViewerEventMap[K]) => void): () => void;
  /** Idempotent teardown: the frame loop, the WebGL context, every listener. */
  dispose(): void;
  /**
   * `using viewer = mountViewer(...)` — the same teardown, run by the language.
   *
   * Present only where the engine HAS `Symbol.dispose`: Explicit Resource
   * Management is Baseline limited and Safari has none of it, so the member is optional and a host that wants it
   * checks for it. `dispose()` is the contract; this is a convenience over it.
   */
  [Symbol.dispose]?: () => void;
};
