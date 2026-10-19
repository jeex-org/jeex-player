/**
 * Executable acceptance test of the CUSTOM ELEMENT form: `<jeex-viewer>` in a
 * host page's shadow DOM, driven by attributes and listened to by events.
 *
 * What this page exists to prove (`scripts/browser-check/embed.ts` asserts it):
 *
 * - `jeex-ready` reaches the HOST PAGE. The event is `composed`, so it crosses
 *   the shadow boundary; without that a listener on `document` would see
 *   nothing at all.
 * - The viewer really is in a SHADOW ROOT: `document.querySelector` finds no
 *   `[data-jeex="viewer"]`, `element.shadowRoot.querySelector` finds one.
 * - `view` and `src` stay LIVE after the mount — one switches the mode, the
 *   other loads a scene and raises `jeex-scene` — and every other attribute
 *   warns instead of pretending.
 * - Taking the element out of the DOM disposes the viewer, page globals
 *   included (this element is the page's only viewer, so it owns them).
 *
 * The scene arrives as a BLOB URL of the demo document rather than a file on
 * disk: the element takes a `src`, `FetchSceneRepository` fetches it, and the
 * page therefore exercises the same path a real host's `/scenes/flat-a.json`
 * would — without the library carrying an apartment (`embed/index.ts`).
 *
 * It is a dev page (`npm run dev`, `/dev/embed-element.html`), never part of
 * the production bundle.
 */

import { defineJeexViewer, type JeexViewerElement } from '../src/embed/element.js';
import { apartmentScene } from '../src/demo/scene-data.js';

/** Serves one scene document over a URL the viewer can fetch. */
function sceneUrl(document_: unknown): string {
  return URL.createObjectURL(new Blob([JSON.stringify(document_)], { type: 'application/json' }));
}

const element = document.querySelector<HTMLElement>('#viewer');
if (!element) throw new Error('embed-element: no #viewer element');

const first = sceneUrl(apartmentScene);
// A second document that differs where the chrome shows it, so a swap is
// visible on screen as well as in the `jeex-scene` event.
const second = sceneUrl({ ...apartmentScene, name: 'Flat B · swapped through src' });

// The scene has to be in place BEFORE the element upgrades: `mountViewer`
// refuses a viewer with no scene source, and the upgrade is what runs
// `connectedCallback`. Registering last is what puts them in that order.
element.setAttribute('src', first);
defineJeexViewer();

const viewer = element as JeexViewerElement;
const seen: string[] = [];
const log = document.querySelector<HTMLElement>('#events');
for (const type of ['jeex-ready', 'jeex-error', 'jeex-scene', 'jeex-mode', 'jeex-tour-state']) {
  // On DOCUMENT, not on the element: that is what proves the events are
  // `composed` and leave the shadow root.
  document.addEventListener(type, () => {
    seen.push(type);
    if (log) log.textContent = seen.join(' · ');
  });
}

document.querySelector<HTMLElement>('#to-walk')?.addEventListener('click', () => element.setAttribute('view', 'walk'));
document.querySelector<HTMLElement>('#to-orbit')?.addEventListener('click', () => element.setAttribute('view', 'orbit'));
document.querySelector<HTMLElement>('#swap-scene')?.addEventListener('click', () => element.setAttribute('src', second));
document.querySelector<HTMLElement>('#remove')?.addEventListener('click', () => element.remove());

window.jeexElement = {
  element: viewer,
  events: seen,
  secondScene: second,
};

declare global {
  interface Window {
    /** The element and what the page has heard from it, for the browser check. */
    jeexElement?: { element: JeexViewerElement; events: string[]; secondScene: string };
  }
}
