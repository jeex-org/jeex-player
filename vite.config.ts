import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { CSS_TARGET } from './vite.css-target.ts';

/** The two pages the demo build ships; `embed.html` is what an iframe host points at. */
const PAGES = {
  main: fileURLToPath(new URL('index.html', import.meta.url)),
  embed: fileURLToPath(new URL('embed.html', import.meta.url)),
};

/** `package.json#version`, read the same way `vite.lib.config.ts` reads its CSS source. */
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', import.meta.url)), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  // The viewer owns the 3700–3709 port block: 3700 dev, 3701 e2e
  // (`playwright.config.ts`), 3702 component tests (`vitest.config.ts`), 3703
  // the browser-check server. `strictPort` because a dev
  // server that quietly moved to the next port is not the one an open tab, or
  // a check's `VIEWER_URL`, points at.
  server: { port: 3700, strictPort: true },
  // Feeds `src/shared/version.ts`'s `__JEEX_VIEWER_VERSION__` (declared in
  // `src/assets.d.ts`). The demo pages import the same embed entry the
  // library ships, so they need the real substitution too, not just the
  // library build.
  define: { __JEEX_VIEWER_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    // The stylesheet's own floor, not the JavaScript one (`vite.css-target.ts`).
    cssTarget: [...CSS_TARGET],
    // No source map in the published bundle. `'hidden'` only drops the
    // reference comment: the `.js.map` is still written next to the bundle and
    // a deploy that uploads all of `dist/` publishes the whole source.
    sourcemap: false,
    rolldownOptions: {
      input: PAGES,
      // A dynamic-import chunk (a lazy import/export module) is authoring, loaded by an action rather than by opening the
      // page, so it gets the `lazy-` prefix `scripts/budget-check.ts` reads
      // to hold it to its own, smaller budget instead of folding it into the
      // boot sum.
      // `assets/` matches Vite's own default for this option, unset: without
      // it a chunk (this function replaces the WHOLE default, not just the
      // dynamic-import case) would land at the root of `dist/`, outside the
      // directory `scripts/budget-check.ts` measures.
      output: {
        chunkFileNames: (chunk) => (chunk.isDynamicEntry ? 'assets/lazy-[name]-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
