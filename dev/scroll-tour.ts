/**
 * Executable acceptance test of the embedded-player case: a tall host page with the viewer
 * fixed behind it, mounted with the tour engaged but paused, no progress bar
 * and input handling off, driven entirely from the page's scroll offset.
 *
 * It is a dev page — `npm run dev:scroll`, never part of the production bundle.
 * Note what it does NOT do any more: it does not fetch `index.html`, it does
 * not clone a shell out of it, and it does not undo the viewer's page styles.
 * `mountViewer(stage, …)` builds the viewer inside the page's own box, and the
 * component stylesheet leaves `html`/`body` alone — which is exactly the
 * property a scroll-driven host needs.
 */

import { mountViewer } from '../src/app/viewer-api.js';
import { LocalFixtureRepository } from '../src/demo/fixture-repository.js';

const READOUT_DIGITS = 3;

/** Scroll offset as a fraction of the page, `0` when the page does not scroll. */
function scrollFraction(): number {
  const range = document.documentElement.scrollHeight - window.innerHeight;
  return range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
}

async function main(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('scroll-tour: no #stage container');

  // `view.mode: 'tour'` is what engages the tour at start; `tour.mode` then
  // says it should wait on the route rather than play.
  const handle = mountViewer(stage, {
    scene: { repository: new LocalFixtureRepository() },
    view: { mode: 'tour' },
    tour: { mode: 'paused', progressBar: false, pauseOnInput: false },
  });
  window.jeexViewer = handle;

  const fractionOut = document.querySelector<HTMLElement>('#scroll-fraction');
  const stateOut = document.querySelector<HTMLElement>('#scroll-state');
  handle.tour.on('progress', (progress) => {
    if (fractionOut) fractionOut.textContent = progress.fraction.toFixed(READOUT_DIGITS);
    if (stateOut) stateOut.textContent = progress.state;
  });

  await handle.ready;
  addEventListener('scroll', () => handle.tour.seek(scrollFraction()), { passive: true });
  // The page may already be scrolled (a reload, a deep link): open where it is.
  handle.tour.seek(scrollFraction());
  window.__scrollTourReady = true;
}

declare global {
  interface Window {
    /** Set once the scroll listener is live; the browser check waits on it. */
    __scrollTourReady?: boolean;
  }
}

void main();
