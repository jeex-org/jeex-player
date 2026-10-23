/**
 * The library's public entry: everything `import … from 'jeex-viewer'` gets,
 * and nothing else.
 *
 * It is a façade over `viewer-api.ts` (the mount API) and `scene-repository.ts`
 * (the two repositories a host can use without writing one). Its whole job is
 * to draw the line between what the package promises and what happens to be
 * exported inside `src/`: a name that is not re-exported here is not public,
 * whatever module it lives in.
 *
 * Invariant: NO DEMO APARTMENT. `LocalFixtureRepository` and the fixture it
 * carries (`scene-data.ts`) are the demo PAGE's scene, so they are absent from
 * this list and dropped from the bundle — a host that names no scene gets
 * `viewer: no scene source`, never someone else's flat (`index.test.ts`).
 *
 * Second invariant: this module REGISTERS nothing. `defineJeexViewer` is
 * exported for a host that wants its own tag name or its own moment;
 * `embed/element.ts` is the entry that calls it on import.
 */

export { mountViewer } from '../app/viewer-api.js';
export { VIEWER_VERSION } from '../shared/version.js';
export { DEFAULT_TAG, defineJeexViewer } from './element.js';
export { FetchSceneRepository, InlineSceneRepository } from '../scene/scene-repository.js';
export { SceneValidationError, ViewerLibError, isViewerLibError } from '../shared/errors.js';
export { checkCompleteness } from '../scene/completeness.js';
export type { CompletenessRule } from '../scene/completeness.js';
export type { SceneReport, SceneReportEntry, SceneReportSeverity } from '../scene/scene-report.js';
export { SHELL_PARTS, THEME_PROPERTIES } from '../ui/viewer-shell.js';
// `MissingSlotError` alongside the names: `ViewerSlots.get` is documented to
// throw it, and a host cannot key on a class this barrel does not publish —
// the same reason `SceneValidationError` is exported below.
export { MissingSlotError, SLOT_NAMES } from '../ui/host-slots.js';
export { MESSAGE_KEYS, isLocale, locales, primarySubtag, registerLocale } from '../ui/messages.js';
export type { MessageKey } from '../ui/messages.js';

export type { ErrorDetail, ViewerLibErrorOptions } from '../shared/errors.js';
export type { LogEntry, LogLevel, LogSink, Logger } from '../shared/logger.js';

export type { JeexViewerElement } from './element.js';
export type { AnchorPoint, AnchorTarget, NewCheckpoint, ViewerHandle, ViewerSlots, ViewerState } from '../app/viewer-handle.js';
export type { SlotName } from '../ui/host-slots.js';
export type { DeepPartial, TourStartMode, ViewerOptions } from '../app/viewer-options.js';
export type { TourControls, TourProgress, TourState } from '../camera/tour-controls.js';
export type {
  CheckpointLookThrough,
  CheckpointPlacing,
  ViewerEditRequest,
  ViewerError,
  ViewerErrorCode,
  ViewerEventMap,
  ViewerEventName,
  ViewerWalkCamera,
} from '../app/viewer-events.js';
// The payload of `edit`, typed without pulling in the `jeex-viewer/ops`
// subpath: a TYPE export is erased, so this costs a host nothing at runtime.
// The tour-camera placement: the entity type a host editor's panel binds to,
// the op it commits, and the payloads of the two overlay events a host
// subscribes to.
export type { SceneOp, TourCheckpoint, SetTourCheckpointsOp } from '../scene/types.js';
export type { CheckpointEdit, CheckpointSelect } from '../camera/checkpoint-overlay.js';
export type { ViewerSelection, ViewerSelectionKind, ViewerSelectionTarget } from '../app/selection.js';
// The answer of `ViewerHandle.describeSelection`, next to the selection it
// describes. Types only: a host reads them, and nothing here
// reaches the bundle.
export type {
  SelectionDescription,
  SelectionDescriptionKind,
  SelectionMirror,
  SelectionOption,
  SelectionScope,
} from '../ui/selection-options.js';
// `SelectionOption.access`'s own type: a host that switches on it needs the
// name, the same reason `SlotName` is published beside `SLOT_NAMES`.
export type { VariantAccess } from '../assets/asset-types.js';
export type { SceneRepository, SceneSource } from '../scene/scene-repository.js';
export type { Locale } from '../ui/messages.js';
export type { ViewerMode } from '../scene/types.js';
export type { Mirror, MirrorAxis } from '../scene/types.js';
export type { CommandMethod, EmbedEventMap, ErrorCode, EventName } from './protocol.js';
