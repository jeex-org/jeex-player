/**
 * Bootstrap of `embed.html`: the page a host points an iframe at.
 *
 * It is `main.ts` with one addition. The options come off the QUERY STRING —
 * which is the host's, not a visitor's, because the host wrote the frame's
 * `src` — and when that query names `?host=<origin>` the postMessage bridge is
 * installed against it. Without a VALID `?host=` there is no bridge and the
 * page is an ordinary viewer, which is what makes `embed.html` openable by hand
 * while developing.
 *
 * Trust decisions belong to `embed/frame-page.ts` and are tested there: what
 * counts as an origin, and that `debug` never survives the trip off a URL.
 * The boot itself is `embed/frame-boot.ts`, shared with the library's public
 * `dist-lib/embed.html` (`embed/frame-entry.ts`), which differs only in having
 * no demo apartment to fall back on.
 *
 * Scene decision, and it belongs to this PAGE exactly as it does on
 * `index.html`: `?scene=<url>` is what a host names, and with no `?scene=` the
 * demo apartment stands in. The LIBRARY still ships none: its own
 * `dist-lib/embed.html` answers a missing `?scene=` with `no-scene-source`.
 */

import './ui/styles/page.css';
import './ui/styles/frame.css';
import { LocalFixtureRepository } from './demo/fixture-repository.js';
import { bootFramePage } from './embed/frame-boot.js';

const page = bootFramePage(document, window, new LocalFixtureRepository());

// Vite swaps this module on every edit; without teardown the previous viewer
// keeps its renderer, its listeners and its frame loop alive behind the new one.
import.meta.hot?.dispose(() => page.dispose());
