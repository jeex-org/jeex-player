/**
 * The library's public frame page: the module `dist-lib/embed.html`
 * loads. It is the demo's `src/main-embed.ts` without the demo apartment —
 * the library ships no scene of its own (`embed/index.ts`), so a frame with no
 * `?scene=` shows the viewer's `no-scene-source` card and tells its host so.
 *
 * Read-only for visitors unless the frame's URL says `readonly=0`
 * (`embed/frame-page.ts`); sized by `?ratio=` (`embed/frame-boot.ts`).
 */

import { bootFramePage } from './frame-boot.js';

bootFramePage(document, window);
