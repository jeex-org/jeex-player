/**
 * A viewer embedded in a page that scrolls: the acceptance page of the
 * cooperative wheel and touch (`tests/e2e/embed-scroll.spec.ts` and
 * `tests/e2e/embed-scroll-touch.spec.ts` drive it).
 *
 * - A plain wheel over the viewer before it is engaged scrolls the PAGE and
 *   shows «Ctrl + scroll to zoom».
 * - Ctrl/⌘ + wheel zooms (360) or steps (walk) and the page stays put.
 * - A vertical swipe that starts on the viewer before it is engaged scrolls
 *   the page; a sideways drag still turns the camera.
 * - A click or tap on the scene engages the viewer: the wheel, Space and the
 *   finger are its own until focus leaves.
 *
 * It is a dev page, never part of the production bundle.
 */

import { mountViewer, type ViewerHandle } from '../src/app/viewer-api.js';
import { LocalFixtureRepository } from '../src/demo/fixture-repository.js';

async function main(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('embed-scroll: no #stage container');
  const handle = mountViewer(stage, {
    // Development pages never send telemetry; `/dev/telemetry.html` is the one that tests it.
    analytics: 'off',
    scene: { repository: new LocalFixtureRepository() },
    view: { mode: 'orbit' },
    tour: { mode: 'off' },
  });
  window.jeexScroll = { handle };
  await handle.ready;
  window.__embedScrollReady = true;
}

declare global {
  interface Window {
    /** The one handle, so a check can switch modes and read the camera. */
    jeexScroll?: { handle: ViewerHandle };
    /** Set once the viewer has rendered its first frame. */
    __embedScrollReady?: boolean;
  }
}

void main();
