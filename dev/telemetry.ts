/**
 * The page `tests/e2e/telemetry.spec.ts` checks the player's anonymous
 * telemetry on, in all three embed forms, chosen by this page's own query:
 *
 * - `?form=element` (default): one `<jeex-viewer>`; `?analytics=` and
 *   `?endpoint=` become its `analytics` and `analytics-endpoint` attributes
 *   verbatim, any spelling included.
 * - `?form=script`: `mountViewer` with `analytics` taken from `?analytics=`,
 *   where `false`, `null` and `object-off` stand for those JS values
 *   (`false`, `null`, `{ mode: 'off' }`).
 * - `?form=iframe`: `embedViewer` on `/embed.html`, `analytics` read the same way.
 *
 * Every other development page sends no telemetry; this one sends unless told not to.
 * It is a dev page (`npm run dev`, `/dev/telemetry.html`), never part of the
 * production bundle.
 */

import { defineJeexViewer } from '../src/embed/element.js';
import { mountViewer } from '../src/app/viewer-api.js';
import { embedViewer } from '../src/embed/host.js';
import { apartmentScene } from '../src/demo/scene-data.js';

const query = new URLSearchParams(window.location.search);
const form = query.get('form') ?? 'element';
const raw = query.get('analytics');
const endpoint = query.get('endpoint');
const sceneUrl = URL.createObjectURL(new Blob([JSON.stringify(apartmentScene)], { type: 'application/json' }));

/** `?analytics=` as the JS value a host would pass. */
function analyticsValue(): unknown {
  if (raw === null) return undefined;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === 'object-off') return { mode: 'off' };
  return raw;
}

const element = document.querySelector<HTMLElement>('#viewer');
const stage = document.querySelector<HTMLElement>('#stage');
if (!element || !stage) throw new Error('telemetry page: no #viewer or #stage');

if (form === 'element') {
  if (raw !== null) element.setAttribute('analytics', raw);
  if (endpoint !== null) element.setAttribute('analytics-endpoint', endpoint);
  element.setAttribute('src', sceneUrl);
  defineJeexViewer();
} else if (form === 'script') {
  element.remove();
  const handle = mountViewer(stage, { scene: { url: sceneUrl }, analytics: analyticsValue() as 'off' });
  void handle.ready.then(() => {
    window.jeexTelemetryReady = true;
  });
} else {
  element.remove();
  const analytics = analyticsValue();
  const embed = embedViewer(stage, { src: '/embed.html', viewerId: 'telemetry-frame', ...(analytics === undefined ? {} : { analytics }) });
  void embed.ready.then(() => {
    window.jeexTelemetryReady = true;
  });
}

declare global {
  interface Window {
    /** Set once the script or iframe form is on screen. */
    jeexTelemetryReady?: boolean;
  }
}
