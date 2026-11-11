/**
 * The page `tests/e2e/telemetry.spec.ts` checks the player's anonymous
 * telemetry on, in all three embed forms, chosen by this page's own query:
 *
 * - `?form=element` (default): one `<jeex-viewer>`; `?analytics=` and
 *   `?endpoint=` become its `analytics` and `analytics-endpoint` attributes
 *   verbatim, any spelling included.
 * - every form sends to `?endpoint=`, or to `DEV_ENDPOINT` when the query
 *   names none (the player itself has no default endpoint); `?endpoint=none`
 *   names no endpoint at all.
 * - `?form=script`: `mountViewer` with `analytics` taken from `?analytics=`,
 *   where `false`, `null` and `object-off` stand for those JS values
 *   (`false`, `null`, `{ mode: 'off' }`).
 * - `?form=iframe`: `embedViewer` on `/embed.html`, `analytics` read the same way.
 *
 * Every other development page names no endpoint and so sends no telemetry; this one sends unless told not to.
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
/** What the e2e suite intercepts; every test browser resolves the host to nothing. */
const DEV_ENDPOINT = 'https://telemetry.example/v1/player';
const named = query.get('endpoint') ?? DEV_ENDPOINT;
const endpoint = named === 'none' ? null : named;
const sceneUrl = URL.createObjectURL(new Blob([JSON.stringify(apartmentScene)], { type: 'application/json' }));

/** `?analytics=` as the JS value a host would pass. */
function analyticsValue(): unknown {
  if (raw === null) return undefined;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === 'object-off') return { mode: 'off' };
  return raw;
}

/** The `analytics` option with the page's endpoint, the way a host names one; `false` and `null` stay as given. */
function withEndpoint(analytics: unknown): unknown {
  if (endpoint === null) return analytics;
  if (analytics === undefined) return { endpoint };
  if (typeof analytics === 'string') return { mode: analytics, endpoint };
  if (typeof analytics === 'object' && analytics !== null) return { ...analytics, endpoint };
  return analytics;
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
  const handle = mountViewer(stage, { scene: { url: sceneUrl }, analytics: withEndpoint(analyticsValue()) as 'off' });
  window.jeexTelemetryHandle = handle;
  void handle.ready.then(() => {
    window.jeexTelemetryReady = true;
  });
} else {
  element.remove();
  const analytics = withEndpoint(analyticsValue());
  const embed = embedViewer(stage, { src: '/embed.html', viewerId: 'telemetry-frame', ...(analytics === undefined ? {} : { analytics }) });
  void embed.ready.then(() => {
    window.jeexTelemetryReady = true;
  });
}

declare global {
  interface Window {
    /** Set once the script or iframe form is on screen. */
    jeexTelemetryReady?: boolean;
    /** The script form's handle, so a check can end the visit the way a host does. */
    jeexTelemetryHandle?: { dispose(): void };
  }
}
