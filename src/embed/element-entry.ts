/**
 * The `jeex-viewer/element` bundle: importing it registers `<jeex-viewer>`.
 *
 * That side effect is the whole reason this file is separate from
 * `element.ts`. A `<script type="module" src="jeex-viewer-element.js">` has
 * nowhere to call anything from, so the entry has to register on load — and
 * the library entry (`embed/index.ts`) must NOT, because a bundler user who
 * imports `mountViewer` has not asked for a custom element in their page.
 * Both re-export the same names; only this one runs `defineJeexViewer`.
 */

import { defineJeexViewer } from './element.js';

defineJeexViewer();

export { DEFAULT_TAG, defineJeexViewer } from './element.js';
export type { JeexViewerElement } from './element.js';
