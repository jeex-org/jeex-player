/**
 * Page bootstrap: the page's own stylesheet, the mount options off the URL, the
 * container to build in, and the published handle.
 *
 * Everything else lives in `viewer-api.ts` — this module exists so that the
 * demo page and an embedding page differ only in the options they pass and in
 * what they do with the handle. `ui/styles/page.css` is the DOCUMENT's palette and
 * scrolling and belongs to the page, never to the component; the demo
 * apartment is the PAGE's scene, not the library's default (`options.scene`).
 * `window.jeexViewer` is the external-script hook for the demo and for landing
 * pages that inline the bundle.
 */

import './ui/styles/page.css';
import { mountViewer, optionsFromQuery, type ViewerHandle } from './app/viewer-api.js';
import { LocalFixtureRepository } from './demo/fixture-repository.js';
import { isLocale } from './ui/messages.js';
import { ViewerLibError } from './shared/errors.js';

declare global {
  interface Window {
    /**
     * The public handle `main.ts` publishes after `mountViewer`: the hook an
     * external script (a landing page, the scroll demo) drives the viewer with.
     */
    jeexViewer?: ViewerHandle;
  }
}

const container = document.querySelector<HTMLElement>('#app');
if (!container) throw new ViewerLibError('internal', 'demo page: no #app container to mount the viewer in');

// Three decisions that belong to the PAGE, not to the component: the demo
// apartment as the scene, `<html lang>` as the locale, and the query string as
// a source of options at all. A library that carried any of them would be
// making them for every host.
const lang = document.documentElement.lang.slice(0, 2).toLowerCase();
const query = optionsFromQuery(location.search);
const handle = mountViewer(container, {
  ...query,
  settings: { show: true, ...query.settings }, // the demo offers its settings; `?settings=0` hides them
  scene: { repository: new LocalFixtureRepository() },
  ...(isLocale(lang) ? { locale: lang } : {}),
});
window.jeexViewer = handle;

// Vite swaps this module on every edit; without teardown the previous viewer
// keeps its renderer, its listeners and its frame loop alive behind the new one.
import.meta.hot?.dispose(() => handle.dispose());
