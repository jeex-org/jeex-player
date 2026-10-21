/**
 * The real `TelemetryHost`: what telemetry reads and listens to on the page
 * the player runs on.
 *
 * Invariant: it reads nothing from any storage and nothing that identifies the
 * visitor. `navigator.globalPrivacyControl` is read on every call, the browser
 * family comes out already bucketed, and every listener and timer is bound to
 * the signal or the stop function it was handed.
 */

import { browserBucket, type ClientHints } from './stack-frames.js';
import type { TelemetryHost } from './telemetry.js';

/** Where `site` and `page` come from: the document itself, or the iframe bridge. */
export type SiteSource = {
  site(): string | null;
  page(): string | null;
  /** The iframe page only: calls `listener` once the host's `context` has arrived. */
  settled?: ((listener: () => void) => void) | undefined;
};

/** The executing document's own origin and path: the element and script forms. */
export function documentSite(win: Window): SiteSource {
  return { site: () => win.location.origin, page: () => win.location.pathname };
}

type PrivacyNavigator = Navigator & { globalPrivacyControl?: unknown; userAgentData?: ClientHints };

export function browserHost(win: Window, doc: Document, source: SiteSource): TelemetryHost {
  const nav = win.navigator as PrivacyNavigator;
  return {
    gpc: () => nav.globalPrivacyControl === true,
    site: () => source.site(),
    page: () => source.page(),
    browser: () => browserBucket(nav.userAgentData, nav.userAgent),
    onLeave(listener, signal) {
      doc.addEventListener(
        'visibilitychange',
        () => {
          if (doc.visibilityState === 'hidden') listener();
        },
        { signal },
      );
      win.addEventListener('pagehide', () => listener(), { signal });
    },
    onPageError(listener, signal) {
      win.addEventListener('error', (event) => listener('exception', event.error), { signal });
      win.addEventListener('unhandledrejection', (event) => listener('rejection', event.reason), { signal });
    },
    every(ms, run) {
      const handle = win.setInterval(run, ms);
      return () => win.clearInterval(handle);
    },
    after(ms, run) {
      const handle = win.setTimeout(run, ms);
      return () => win.clearTimeout(handle);
    },
  };
}
