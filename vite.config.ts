import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { CSS_TARGET } from './vite.css-target.ts';
import { readPackageVersion } from './scripts/config-input.ts';
import { basisTranscoder } from './scripts/basis-transcoder-plugin.ts';

/** The two pages the demo build ships; `embed.html` is what an iframe host points at. */
const PAGES = {
  main: fileURLToPath(new URL('index.html', import.meta.url)),
  embed: fileURLToPath(new URL('embed.html', import.meta.url)),
};

/** `package.json#version`, judged by `scripts/config-input.ts` like every other config input. */
const VERSION = readPackageVersion(new URL('package.json', import.meta.url));

/**
 * Set by `playwright.config.ts` for the e2e suite's own server: that server
 * runs without a file watcher. A watcher pushes a full page reload to every
 * open page when a watched file changes — any `tsconfig.json` in the tree
 * does it on its own, and `scripts/lighting-entry-check.ts` writes one under
 * `dist-lib/` during `bun run build:lib` — so a build, an edit or a sibling
 * check in the same checkout reloaded whichever specs were open at that
 * moment, which then failed with "Execution context was destroyed". The suite
 * edits nothing, so it has nothing to watch.
 */
const E2E_SERVER = process.env['JEEX_E2E_SERVER'] === '1';

export default defineConfig({
  base: './',
  // The Basis transcoder beside the chunks, under `assets/` (`scripts/basis-transcoder-plugin.ts`).
  plugins: [basisTranscoder('assets/')],
  // The dev server listens on 3700. The repository's other configs use 3701
  // for e2e (`playwright.config.ts`, override with `JEEX_E2E_PORT`) and 3702
  // for the component tests (`vitest.config.ts`, override with
  // `JEEX_COMPONENT_PORT`). `strictPort` because a dev server that quietly
  // moved to the next port is not the one an open tab, or a check's
  // `VIEWER_URL`, points at.
  server: { port: 3700, strictPort: true, ...(E2E_SERVER ? { watch: null } : {}) },
  // Feeds `src/shared/version.ts`'s `__JEEX_VIEWER_VERSION__` (declared in
  // `src/assets.d.ts`). The demo pages import the same embed entry the
  // library ships, so they need the real substitution too, not just the
  // library build.
  define: { __JEEX_VIEWER_VERSION__: JSON.stringify(VERSION) },
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
      // Every file is named `jeex-viewer-…` (`lazy-jeex-viewer-…`), the shape of
      // a published player file: the hosted frame page and the demo are the
      // player's own, and its telemetry reports exceptions only from files of
      // that shape (`src/telemetry/own-files.ts`).
      output: {
        entryFileNames: 'assets/jeex-viewer-[name]-[hash].js',
        chunkFileNames: (chunk) =>
          chunk.isDynamicEntry ? 'assets/lazy-jeex-viewer-[name]-[hash].js' : 'assets/jeex-viewer-[name]-[hash].js',
      },
    },
  },
});
