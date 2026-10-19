/**
 * What the control bar and the progress bar may ask of the application.
 *
 * The third table of the composition root, next to `director-wiring.ts` and
 * `debug-parts.ts`, and the same shape: one hop per entry and no behaviour.
 * The UI decides nothing — every button calls one of these,
 * and this is the map from "a control was pressed" to the collaborator that
 * answers for it.
 *
 * Every dependency is read LAZILY: the camera director does not exist until the
 * first document is committed, and a bar bound before then must still work
 * afterwards.
 */

import type { ViewerCommands } from '../ui/viewer-ui.js';
import type { CameraDirector } from '../camera/camera-director.js';
import type { Messages } from '../ui/messages.js';
import type { SceneMount } from './scene-mount.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { ViewerMode } from '../scene/types.js';
import type { FullscreenController } from '../ui/fullscreen-controller.js';

type UiCommandDeps = {
  /** Read lazily, like everything else: the field is assigned in the body. */
  mount: () => SceneMount;
  shell: () => FullscreenController;
  tour: TourControls;
  messages: () => Messages;
  director: () => CameraDirector | undefined;
  /** The composition root's own mode switch: it also re-hints and re-labels. */
  setMode: (mode: ViewerMode) => void;
  setFurnitureVisible: (visible: boolean) => void;
  furnitureVisible: () => boolean;
  /** Fullscreen was asked for and the browser has no API for it. */
  onFullscreenUnavailable: (message: string) => void;
};

/** The command bag `ViewerUI` is built with. */
export function uiCommands(deps: UiCommandDeps): ViewerCommands {
  return {
    setMode: (mode) => deps.setMode(mode),
    toggleTour: () => deps.director()?.toggleTour(),
    resetCamera: () => deps.director()?.reset(),
    toggleFullscreen: async () => {
      if (!(await deps.shell().toggle())) deps.onFullscreenUnavailable(deps.messages().t('hint.fullscreenUnavailable'));
    },
    toggleFurniture: () => deps.setFurnitureVisible(!deps.furnitureVisible()),
    tourSeek: (fraction) => deps.tour.seek(fraction),
    tourPlay: () => deps.tour.play(),
    tourPause: () => deps.tour.pause(),
    tourSpeed: (speed) => deps.tour.setSpeed(speed),
    openInteriors: (anchor) => deps.mount().editor?.openInteriorPanel(anchor),
  };
}
