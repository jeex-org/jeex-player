/**
 * The public mount API: what a host imports, and the one function it calls.
 *
 * This file is deliberately thin. It resolves the options, builds the
 * composition root (`viewer-app.ts`) and projects it onto the `ViewerHandle`
 * contract (`viewer-handle.ts`) — the surface the ES module, the custom
 * element and the postMessage bridge all speak. Everything else is a collaborator's
 * job, and the re-exports below are the whole public vocabulary.
 */

import { ViewerApp } from './viewer-app.js';
import { ViewerDisposedError } from './viewer-context.js';
import { resolveViewerOptions, type ViewerOptionsInput } from './viewer-options.js';
import { prefersReducedMotion } from './motion-wiring.js';
import { createLogger } from '../shared/logger.js';
import type { ViewerHandle } from './viewer-handle.js';
import type { Embedding } from './telemetry-wiring.js';
import type { ExportGlbOptions } from './export-gltf.js';
import type { ExportUsdzOptions } from './export-usdz.js';

export { VIEWER_VERSION } from '../shared/version.js';

export type { TourControls, TourDebugControls, TourProgress, TourState } from '../camera/tour-controls.js';
export type { DeepPartial, ViewerOptions, ViewerOptionsInput, TourStartMode } from './viewer-options.js';
export type { HdriEntry, HdriOption } from '../lighting/hdri-entry.js';
export type { AnchorPoint, AnchorTarget, NewCheckpoint, ViewerHandle, ViewerSlots, ViewerState } from './viewer-handle.js';
export type { SelectionDescription, SelectionDescriptionKind, SelectionOption, SelectionScope } from '../ui/selection-options.js';
export type { ViewerError, ViewerErrorCode, ViewerEventMap, ViewerEventName } from './viewer-events.js';
export { SceneValidationError, ViewerLibError, isViewerLibError } from '../shared/errors.js';
export type { ErrorDetail, ViewerLibErrorOptions } from '../shared/errors.js';
export { MESSAGE_KEYS, isLocale, locales, primarySubtag, registerLocale } from '../ui/messages.js';
export type { MessageKey } from '../ui/messages.js';
export type { LogEntry, LogLevel, LogSink, Logger } from '../shared/logger.js';
export type { SceneSource, SceneRepository } from '../scene/scene-repository.js';
export type { ProjectInfo } from './project-wiring.js';
export type {
  BakedProjectManifest,
  ProjectLibraryManifest,
  ProjectMedia,
  ProjectObject,
  ProjectRights,
  ProjectRightsAsset,
  ProjectVariant,
} from '../assets/project-manifest.js';
export type { Locale } from '../ui/messages.js';
export type { ViewerMode } from '../scene/types.js';

/**
 * Mounts the viewer INSIDE `container`, building its own markup there, and
 * hands back the handle.
 *
 * `options` is a deep partial over `DEFAULT_VIEWER_OPTIONS`; anything invalid
 * falls back with a warning rather than failing the mount. The container keeps
 * its own identity: the viewer adds one `.jeex-viewer` child and never touches
 * anything above it.
 *
 * `options.scene` is required — there is no bundled default apartment
 * (`scene-repository.resolveSceneSource`).
 */
export function mountViewer(container: HTMLElement, options?: ViewerOptionsInput): ViewerHandle {
  return mountViewerAs({ embed: 'script' }, container, options);
}

/** `mountViewer` for the element and the iframe page, which say how they embed it. */
export function mountViewerAs(embedding: Embedding, container: HTMLElement, options?: ViewerOptionsInput): ViewerHandle {
  const app = new ViewerApp(container, resolveViewerOptions(options, { reducedMotion: prefersReducedMotion() }), embedding);
  // One microtask later, not inside this call: a failure `init()` reports
  // before its first await (no WebGL) must reach the `error` listeners a host
  // subscribes on the line after `mountViewer`. A host that disposed in between
  // gets the same `disposed` rejection a dispose during the boot gives.
  let disposed = false;
  const ready = Promise.resolve().then(() => (disposed ? Promise.reject(new ViewerDisposedError()) : app.init()));
  // The error card is the user-facing report and the `error` event is the
  // machine-readable one; `ready` still rejects for a host that awaits it, so
  // this handler exists only to keep that rejection from becoming an unhandled
  // one — it does not swallow the failure.
  ready.catch((error: unknown) => {
    // A host that disposed the viewer before its first frame ended the mount on
    // purpose; `ready` still rejects for anyone awaiting it, but that is not a
    // failure to report.
    if (error instanceof ViewerDisposedError) return;
    createLogger(app.options.onLog).error('mount-failed', 'viewer mount failed', error);
  });
  // What both exports read: the two public reads, plus the room-surface context
  // of the mounted document (its project materials and texture sources), which
  // stays internal (`export-surfaces.ts`).
  const exportDeps = {
    getScene: () => app.handle.getScene(),
    getState: () => app.handle.getState(),
    getSurfaces: () => app.handle.exportSurfaces(),
  };
  const handle: ViewerHandle = {
    element: app.element,
    options: app.options,
    tour: app.tour,
    capture: app.capture,
    slots: app.handle.slots,
    ready,
    loadScene: (source) => app.loadScene(source),
    setMode: (mode) => app.handle.setMode(mode),
    getMode: () => app.handle.getMode(),
    getState: () => app.handle.getState(),
    getScene: () => app.handle.getScene(),
    project: () => app.project(),
    // `export-gltf.ts` (and the `GLTFExporter` it imports in turn) is reached
    // only through this dynamic import, never a static one: a host that never
    // calls `exportGlb` never downloads the exporter or its own orchestration
    // code (`scripts/budget-check.ts`'s boot-vs-lazy split). `exportDeps` is the two ALREADY-PUBLIC reads plus the
    // internal room-surface context — nothing about the composition root leaks out because of this.
    exportGlb: (exportOptions?: ExportGlbOptions) =>
      import('./export-gltf.js').then((module) => module.exportGlb(exportDeps, exportOptions)),
    // Same lazy-import shape as `exportGlb`, and the same reason: a host that
    // never calls `exportUsdz` never downloads `USDZExporter` or its own chunk.
    exportUsdz: (exportOptions?: ExportUsdzOptions) =>
      import('./export-usdz.js').then((module) => module.exportUsdz(exportDeps, exportOptions)),
    getFurnitureVisible: () => app.handle.getFurnitureVisible(),
    getLocale: () => app.handle.getLocale(),
    focusRoom: (roomId) => app.handle.focusRoom(roomId),
    stepCamera: (to) => app.handle.stepCamera(to),
    setFurnitureVisible: (visible) => app.handle.setFurnitureVisible(visible),
    setLightTemperature: (temperature) => app.handle.lightTemperature.set(temperature, 'host'),
    setQuality: (quality) => app.handle.quality.set(quality),
    refreshTheme: () => app.handle.refreshTheme(),
    setLocale: (locale) => app.handle.setLocale(locale),
    setSelection: (target) => app.handle.setSelection(target),
    describeSelection: (target) => app.handle.describeSelection(target),
    setCheckpointOverlay: (visible) => app.handle.setCheckpointOverlay(visible),
    isCheckpointOverlayVisible: () => app.handle.isCheckpointOverlayVisible(),
    addCheckpoint: (request) => app.handle.addCheckpoint(request),
    startCheckpointPlacement: (request) => app.handle.startCheckpointPlacement(request),
    cancelCheckpointPlacement: () => app.handle.cancelCheckpointPlacement(),
    setCheckpointFromView: (id) => app.handle.setCheckpointFromView(id),
    frameCheckpoint: (id) => app.handle.frameCheckpoint(id),
    lookThroughCheckpoint: (id) => app.handle.lookThroughCheckpoint(id),
    endLookThrough: (commit) => app.handle.endLookThrough(commit),
    focusCheckpoint: (id) => app.handle.focusCheckpoint(id),
    revertCheckpointEdit: () => app.handle.revertCheckpointEdit(),
    setAssetMoveTool: (enabled) => app.handle.setAssetMoveTool(enabled),
    armAssetMove: () => app.handle.armAssetMove(),
    revertAssetEdit: () => app.handle.revertAssetEdit(),
    mirrorAsset: (assetId, axis) => app.handle.mirrorAsset(assetId, axis),
    turnAsset: (assetId, steps) => app.handle.turnAsset(assetId, steps),
    resize: () => app.handle.resize(),
    on: (event, callback) => app.on(event, callback),
    dispose: () => {
      disposed = true;
      app.dispose();
    },
  };
  // Behind an existence check, not a version check: Explicit Resource
  // Management is Baseline LIMITED and Safari ships none of it, so
  // `Symbol.dispose` may simply not be there. On an
  // engine that has it, `using viewer = mountViewer(...)` disposes the viewer
  // when the block ends; everywhere else the member is absent and `dispose()`
  // is what a host calls, as it always was.
  if (typeof Symbol.dispose === 'symbol') handle[Symbol.dispose] = () => handle.dispose();
  return handle;
}

export { DEFAULT_VIEWER_OPTIONS, resolveViewerOptions } from './viewer-options.js';
export { optionsFromDataset, optionsFromQuery } from './option-adapters.js';
export { FetchSceneRepository, InlineSceneRepository } from '../scene/scene-repository.js';
