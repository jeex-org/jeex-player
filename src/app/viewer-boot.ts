/**
 * The boot sequence's own three pieces, taken out of the composition root: the
 * cancellable frame wait, the loading-card step, and the opening view.
 *
 * They belong together because they are all POLICY about starting up, and none
 * of them is wiring: `nextFrame` decides what a frame wait means when the host
 * disposes mid-boot, `showBootStep` turns a named step into a progress reading,
 * and `applyStartView` reads `options.view` and `options.tour` and decides what
 * the first frame shows. `viewer-app.ts` keeps the object graph and calls these.
 *
 * Invariant: nothing here holds state. Each function is handed exactly the
 * collaborators it speaks to, so the composition root stays the only thing that
 * knows the whole graph.
 */

import { BOOT_STEPS } from './boot-steps.js';
import { ViewerDisposedError } from './viewer-context.js';
import type { Messages } from '../ui/messages.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerMode } from '../scene/types.js';

/** The part of `ViewerUI` a boot step writes to. */
type BootUI = {
  setLoading: (percent: number, label: string) => void;
  setModeButtons: (mode: ViewerMode) => void;
  setHintForMode: (mode: ViewerMode) => void;
};

/**
 * The first picture a started loop owes (`RenderRuntime.firstDraw.next`; it
 * waits for the scene's shaders, `render/first-draw.ts`), then the frame after
 * it; just that frame when no picture is owed. A rejection when the viewer is
 * disposed first. `ready`, the app-ready flag and the reveal wait on it.
 */
export async function firstPicture(signal: AbortSignal, picture: Promise<void> | undefined): Promise<void> {
  if (picture !== undefined) {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new ViewerDisposedError());
        return;
      }
      const own = new AbortController();
      signal.addEventListener('abort', () => reject(new ViewerDisposedError()), { once: true, signal: own.signal });
      void picture.then(() => {
        own.abort();
        resolve();
      });
    });
  }
  await nextFrame(signal);
}

/**
 * One painted frame, or a rejection when the viewer is disposed first.
 *
 * A bare `requestAnimationFrame` promise never settles in a tab that is never
 * painted, and `dispose()` could not break the await — so `handle.ready` hung
 * for the life of the page. The abort listener is
 * registered with a controller of its own, so the resolved case leaves nothing
 * behind on a signal the host may hold for a long time.
 */
export function nextFrame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ViewerDisposedError());
      return;
    }
    const own = new AbortController();
    const handle = requestAnimationFrame(() => {
      own.abort();
      resolve();
    });
    signal.addEventListener(
      'abort',
      () => {
        cancelAnimationFrame(handle);
        reject(new ViewerDisposedError());
      },
      { once: true, signal: own.signal },
    );
  });
}

/** The loading card's reading for one named boot step. */
export function showBootStep(ui: BootUI, messages: Messages, name: keyof typeof BOOT_STEPS): void {
  const { percent, label } = BOOT_STEPS[name];
  ui.setLoading(percent, messages.t(label));
}

/** What `applyStartView` needs of the running viewer. */
type StartViewDeps = {
  options: ViewerOptions;
  ui: BootUI;
  tour: TourControls;
  /** Switches the camera mode; the composition root's own `setMode`. */
  setMode: (mode: ViewerMode) => void;
  /** Puts the camera into tour mode without starting the clip. */
  engageTour: () => void;
};

/**
 * The mode the page opens in, `options.view` as authored.
 *
 * It runs after `ViewerUI.bind()` on purpose. The tour engages at start ONLY in
 * `view.mode: 'tour'`: a page that opens on 360, the 2D drawing or
 * the top view must not have the clip running behind it. `tour.mode` then
 * decides whether that engaged tour plays, waits on the route, or stays off
 * until the button is pressed.
 */
export function applyStartView(deps: StartViewDeps): void {
  const mode = deps.options.view.mode;
  deps.ui.setModeButtons(mode);
  deps.ui.setHintForMode(mode);
  if (mode !== 'tour') {
    if (mode !== 'orbit') deps.setMode(mode);
    return;
  }
  const { mode: tourMode, start } = deps.options.tour;
  if (tourMode === 'off') {
    // `view.mode: 'tour'` with `tour.mode: 'off'`: the tour mode is engaged,
    // the clip is not, and the button starts it.
    deps.engageTour();
    return;
  }
  // A seek, not a play with a fly-in: on first load the camera is PLACED on the
  // route, so a scroll-driven host and a plain autoplay open on the same frame
  // instead of on a presentation dive.
  deps.tour.seek(start);
  if (tourMode === 'play') deps.tour.play();
}
