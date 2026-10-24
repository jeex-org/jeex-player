/**
 * Reading a running viewer back: what `handle.getState()` answers.
 *
 * It is its own module because it is a QUERY over the whole object graph, not
 * wiring — the mode comes from the camera stack, the tour position from the
 * player, the furniture switch from the composition root, the locale from the
 * catalogue, and the document's identity from the mounted model.
 *
 * Consistency invariant: the nine fields are read in one synchronous pass, so
 * they describe ONE moment. That is the whole point of the call — a host
 * rendering its own chrome from five separate getters can catch them
 * disagreeing, and across a frame boundary five getters are five messages.
 */

import type { Locale } from '../ui/messages.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { TourProgress } from '../camera/tour-controls.js';
import type { ViewerMode } from '../scene/types.js';
import type { ViewerState } from './viewer-handle.js';

/** Where each field of the reading comes from. */
type ViewerStateDeps = {
  mode: () => ViewerMode;
  tour: () => TourProgress | null;
  furnitureVisible: () => boolean;
  locale: () => Locale;
  /** The mounted document, or `undefined` before the first one is built. */
  model: () => SceneModel | undefined;
  /** The walk's current tour camera and the camera count (`CameraDirector.walkCamera`). */
  walkCamera: () => { index: number | null; count: number };
  /** The tour-camera tool: the camera looked through, and whether click-to-place is waiting. */
  checkpoints: () => { lookThrough: string | null; placing: boolean };
  /** The colour temperature of the artificial light, `null` for «Original». */
  lightTemperature: () => number | null;
};

export function readViewerState(deps: ViewerStateDeps): ViewerState {
  const model = deps.model();
  return {
    mode: deps.mode(),
    tour: deps.tour(),
    furnitureVisible: deps.furnitureVisible(),
    locale: deps.locale(),
    sceneId: model?.scene.id ?? null,
    rev: model?.rev ?? 0,
    walk: { camera: deps.walkCamera() },
    checkpoints: deps.checkpoints(),
    lightTemperature: deps.lightTemperature(),
  };
}
