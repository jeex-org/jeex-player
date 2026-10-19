/**
 * The classic-script bundle, `jeex-viewer.iife.js` (global `JeexViewer`):
 * everything the library entry exports, AND `<jeex-viewer>` registered on load.
 *
 * A site builder or a CMS block often strips inline scripts and does not
 * always allow `type="module"`, so the one-tag install has to be a plain
 * `<script src=".../jeex-viewer.iife.js"></script>` followed by
 * `<jeex-viewer src=…>` — no inline code to call `defineJeexViewer` from.
 * The ES library entry (`embed/index.ts`) still registers nothing: a bundler
 * user who imports `mountViewer` has not asked for a custom element.
 *
 * Idempotent with the element bundle: `defineJeexViewer` leaves an existing
 * registration alone, so a page that loads both gets one `<jeex-viewer>`, the
 * first one defined.
 */

import { defineJeexViewer } from './element.js';

export * from './index.js';

// Guarded so the bundle still loads where there is no registry at all (a
// worker, a DOM-less test): the library half is useful without the tag.
if (typeof customElements !== 'undefined') defineJeexViewer();
