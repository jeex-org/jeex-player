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

import type { UsageSink } from '../shared/usage.js';
import type { ViewerCommands } from '../ui/viewer-ui.js';
import type { CameraDirector } from '../camera/camera-director.js';
import type { Messages } from '../ui/messages.js';
import type { SceneMount } from './scene-mount.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { FullscreenController } from '../ui/fullscreen-controller.js';
import type { HandleCommands } from './handle-commands.js';

type UiCommandDeps = {
  /** Read lazily, like everything else: the field is assigned in the body. */
  mount: () => SceneMount;
  shell: () => FullscreenController;
  tour: TourControls;
  messages: () => Messages;
  director: () => CameraDirector | undefined;
  /**
   * The host commands, read lazily: the mode switch (which also re-hints and
   * re-labels), the furniture switch and the light temperature are the same
   * ones a host drives, so the bar and the panel go through them too.
   */
  handle: () => HandleCommands;
  /** Fullscreen was asked for and the browser has no API for it. */
  onFullscreenUnavailable: (message: string) => void;
  /** Hears the visitor entering fullscreen (`shared/usage.ts`). */
  usage?: UsageSink | undefined;
};

/** The command bag `ViewerUI` is built with. */
export function uiCommands(deps: UiCommandDeps): ViewerCommands {
  return {
    setMode: (mode) => deps.handle().setMode(mode),
    toggleTour: () => deps.director()?.toggleTour(),
    resetCamera: () => deps.director()?.reset(),
    toggleFullscreen: async () => {
      const shell = deps.shell();
      if (!(await shell.toggle())) deps.onFullscreenUnavailable(deps.messages().t('hint.fullscreenUnavailable'));
      else if (shell.isFullscreen()) deps.usage?.('fullscreen');
    },
    toggleFurniture: () => deps.handle().setFurnitureVisible(!deps.handle().getFurnitureVisible()),
    setLightTemperature: (temperature) => deps.handle().lightTemperature.set(temperature, 'panel'),
    tourSeek: (fraction) => deps.tour.seek(fraction),
    tourPlay: () => deps.tour.play(),
    tourPause: () => deps.tour.pause(),
    tourSpeed: (speed) => deps.tour.setSpeed(speed),
    openInteriors: (anchor) => deps.mount().editor?.openInteriorPanel(anchor),
  };
}
