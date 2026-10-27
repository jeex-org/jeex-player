/**
 * The LIBRARY build (`dist-lib/`), next to the demo build (`vite.config.ts`).
 *
 * Vite 8's library mode cannot do this in one pass: `build.lib` refuses to mix
 * several entries with `umd`/`iife` ("Multiple entry points are not supported
 * when output formats include \"umd\" or \"iife\""), and every `iife` needs a
 * global `name` of its own. So `npm run build:lib` runs this config once per
 * SHAPE, selected with `--mode`, and only the first pass empties the directory:
 *
 * | mode   | entry               | formats | output |
 * |--------|---------------------|---------|--------|
 * | `es`      | `index` + `element` + `frame` | `es` | `jeex-viewer.js`, `jeex-viewer-element.js`, `jeex-viewer-frame.js`, `embed.html`, `jeex-viewer.css` |
 * | `iife`    | `iife-entry`        | `iife`  | `jeex-viewer.iife.js` (global `JeexViewer`; registers `<jeex-viewer>` on load) |
 * | `host`    | `host`              | `es`+`iife` | `jeex-viewer-host.js`, `jeex-viewer-host.iife.js` (global `JeexViewerHost`) |
 * | `ops`     | `ops`               | `es`    | `jeex-viewer-ops.js` (the `jeex-viewer/ops` entry, `src/embed/ops.ts`) |
 * | `lighting` | `lighting`         | `es`    | `jeex-viewer-lighting.js` (the `jeex-viewer/lighting` entry, `src/lighting/index.ts`) |
 * | `schema`   | `schema`           | `es`    | `jeex-viewer-schema.js` (the `jeex-viewer/schema` entry, `src/embed/schema.ts`) |
 * | `lightmap` | `lightmap`         | `es`    | `jeex-viewer-lightmap.js` (the `jeex-viewer/lightmap` entry, `src/embed/lightmap.ts`) |
 *
 * `three` is BUNDLED, deliberately (the `lighting` and `lightmap` passes excepted, see below): the point of the `<script>` and custom
 * element forms is a drop-in tag, an external `three` would force every host
 * into an import map, and the three `three/addons/*` subpath imports
 * have no matching CDN globals to map an `iife` onto.
 *
 * The `lighting` entry carries NO three.js at all: the lighting standard is
 * built with the namespace the consumer passes in, and its modules import
 * three only as types. `three` is still marked external in that pass, as a
 * safety net — a runtime import that slipped in would stay an import of the
 * consumer's own three rather than a second engine bundled into the entry —
 * and `scripts/lighting-entry-check.ts` fails the build on either.
 *
 * The `schema` and `lightmap` entries serve a TOOL (a catalogue service, a
 * light bake), never a page, so they leave `zod` to the tool, a peer
 * dependency: the tool's schemas and the player's are built by one Zod. The
 * `lightmap` entry builds geometry with the tool's own three.js the same way.
 * The page entries keep bundling Zod: a drop-in tag has no package manager
 * behind it. `scripts/package-entry-check.ts` fails the build that bundles a
 * peer into either entry.
 *
 * The ES output keeps its whitespace and the `iife` does not, and that is
 * Vite's decision, not an oversight: an ES library is minified by the host's
 * own bundler, so Vite pins `minifyWhitespace` to `false` for every ES lib
 * build and ignores an override. A `<script>` tag has no bundler behind it, so
 * the `iife` is minified in full — by Oxc since Vite 8, not esbuild.
 *
 * The stylesheet is delivered twice on purpose. It travels INSIDE the JS as
 * text (`ui/styles/viewer.css?inline` → `ensureViewerStyles`), so no host has to
 * remember a second tag and a shadow root can adopt it; `emitViewerCss` also
 * writes it out as `jeex-viewer.css` for a host that wants to override it
 * (`exports['./style.css']`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CSS_TARGET } from './vite.css-target.ts';
import { readPackageVersion } from './scripts/config-input.ts';
import { basisTranscoder } from './scripts/basis-transcoder-plugin.ts';
import { finishMaps } from './scripts/finish-maps-plugin.ts';
import { defineConfig, type LibraryFormats, type Plugin, type UserConfig } from 'vite';

/** Global the `iife` bundle of the whole viewer publishes itself as. */
const VIEWER_GLOBAL = 'JeexViewer';
/** Global the `iife` bundle of the iframe host helper publishes itself as. */
const HOST_GLOBAL = 'JeexViewerHost';
/** Where the library build writes; `package.json#files` ships exactly this. */
const OUT_DIR = 'dist-lib';
/** The component stylesheet, emitted for hosts that want to override it. */
const CSS_SOURCE = 'src/ui/styles/viewer.css';
const CSS_FILE = 'jeex-viewer.css';
/** The frame page's own box (`ui/styles/frame.css`), inlined into `embed.html`. */
const FRAME_CSS_SOURCE = 'src/ui/styles/frame.css';
/** The public frame page and the module it loads. */
const FRAME_PAGE = 'embed.html';
const FRAME_ENTRY = 'jeex-viewer-frame';

const from = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/**
 * `package.json#version`, feeding `src/shared/version.ts`'s
 * `__JEEX_VIEWER_VERSION__` (declared in `src/assets.d.ts`) in every pass —
 * a host reading `VIEWER_VERSION` off any of the three shapes gets the same
 * answer.
 */
const VERSION = readPackageVersion(new URL('package.json', import.meta.url));

/**
 * Writes the component stylesheet next to the bundles.
 *
 * It is a copy, not an extraction: the CSS reaches the viewer as an inlined
 * string, so Vite's own CSS pipeline has no asset to emit and `cssFileName`
 * has nothing to name. Reading the one file and emitting it is the whole of it
 * — a plugin dependency would buy nothing.
 */
function emitViewerCss(): Plugin {
  return {
    name: 'jeex-emit-viewer-css',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: CSS_FILE, source: readFileSync(from(CSS_SOURCE), 'utf8') });
    },
  };
}

/**
 * Writes the library's public frame page, `embed.html`: the page an
 * `<iframe>` snippet points at, loading `jeex-viewer-frame.js` next to it.
 *
 * Library mode builds no HTML, and this page is four tags, so it is written
 * here rather than given a second Vite app. Every URL in it is RELATIVE, so
 * the whole `dist-lib` works from any path a host serves it under
 * (for example `/embed/v1/` on a delivery host). The style is inline because
 * the frame's own CSS must apply before the module runs, and it is the shared
 * `frame.css`, so the demo's `embed.html` and this one cannot drift apart.
 */
function emitFramePage(): Plugin {
  return {
    name: 'jeex-emit-frame-page',
    generateBundle() {
      const css = readFileSync(from(FRAME_CSS_SOURCE), 'utf8')
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .replaceAll(/\s+/g, ' ')
        .trim();
      const html = [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        '<meta name="responsive-embedded-sizing" content="allow-origins=*">',
        '<meta name="robots" content="noindex">',
        '<title>JEEX apartment viewer</title>',
        `<style>${css}</style>`,
        `<script type="module" src="./${FRAME_ENTRY}.js"></script>`,
        '</head>',
        '<body><div id="app"></div><div id="jeex-size" aria-hidden="true"></div></body>',
        '</html>',
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: FRAME_PAGE, source: html });
    },
  };
}

/** One library pass: its entries, its formats, and the global an `iife` takes. */
type Pass = {
  entry: Record<string, string>;
  formats: LibraryFormats[];
  name?: string;
  /** Only the first pass may empty `dist-lib`; the others add to it. */
  empty: boolean;
  plugins: Plugin[];
  /** Packages left as imports instead of bundled; only the tool entries (`lighting`, `schema`, `lightmap`) name any. */
  external?: (string | RegExp)[];
};

const PASSES: Record<string, Pass> = {
  es: {
    entry: {
      'jeex-viewer': from('src/embed/index.ts'),
      'jeex-viewer-element': from('src/embed/element-entry.ts'),
      [FRAME_ENTRY]: from('src/embed/frame-entry.ts'),
    },
    formats: ['es'],
    empty: true,
    plugins: [emitViewerCss(), emitFramePage(), basisTranscoder(), finishMaps()],
  },
  iife: {
    entry: { 'jeex-viewer': from('src/embed/iife-entry.ts') },
    formats: ['iife'],
    name: VIEWER_GLOBAL,
    empty: false,
    // The same files the `es` pass wrote (same bytes, same names): the IIFE finds them beside itself.
    plugins: [basisTranscoder(), finishMaps()],
  },
  host: {
    entry: { 'jeex-viewer-host': from('src/embed/host.ts') },
    formats: ['es', 'iife'],
    name: HOST_GLOBAL,
    empty: false,
    plugins: [],
  },
  ops: {
    entry: { 'jeex-viewer-ops': from('src/embed/ops.ts') },
    formats: ['es'],
    empty: false,
    plugins: [],
  },
  lighting: {
    entry: { 'jeex-viewer-lighting': from('src/lighting/index.ts') },
    formats: ['es'],
    empty: false,
    plugins: [],
    external: ['three', /^three\//],
  },
  schema: {
    entry: { 'jeex-viewer-schema': from('src/embed/schema.ts') },
    formats: ['es'],
    empty: false,
    plugins: [],
    external: ['zod', /^zod\//],
  },
  lightmap: {
    entry: { 'jeex-viewer-lightmap': from('src/embed/lightmap.ts') },
    formats: ['es'],
    empty: false,
    plugins: [],
    external: ['zod', /^zod\//, 'three', /^three\//],
  },
};

export default defineConfig(({ mode }): UserConfig => {
  const pass = PASSES[mode];
  // A typo in `--mode` would otherwise build the default pass under the wrong
  // name and quietly overwrite the previous one.
  if (!pass) throw new Error(`vite.lib.config: unknown mode ${mode}; expected one of ${Object.keys(PASSES).join(', ')}`);
  return {
    plugins: pass.plugins,
    define: {
      __JEEX_VIEWER_VERSION__: JSON.stringify(VERSION),
      // A classic script has no `import.meta`: say so instead of letting the
      // bundler empty it with a warning. `src/telemetry/own-files.ts` then reads
      // `document.currentScript`, which a classic script does have.
      ...(pass.formats.length === 1 && pass.formats[0] === 'iife' ? { 'import.meta.url': 'undefined' } : {}),
    },
    build: {
      target: 'es2022',
      // The stylesheet's own floor, not the JavaScript one (`vite.css-target.ts`).
      cssTarget: [...CSS_TARGET],
      sourcemap: false,
      outDir: OUT_DIR,
      emptyOutDir: pass.empty,
      // Library mode emits at most one stylesheet anyway, and this one has
      // none: the CSS is inlined into the JS.
      cssCodeSplit: false,
      // Every shared chunk keeps the `jeex-viewer-` prefix — without it a
      // chunk split off the ES entry (`layout-lint` today) lands as
      // `index-<hash>.js`, a name that says nothing about whose package it is
      // once a host has copied it next to their own files. A DYNAMIC-import
      // chunk additionally gets the `lazy-` prefix `scripts/budget-check.ts`
      // reads to hold it to its own, smaller budget instead of folding it
      // into the boot sum: it is authoring code,
      // loaded by an action, never by opening the page.
      rolldownOptions: {
        ...(pass.external !== undefined && { external: pass.external }),
        output: {
          chunkFileNames: (chunk) => (chunk.isDynamicEntry ? 'lazy-jeex-viewer-[name]-[hash].js' : 'jeex-viewer-[name]-[hash].js'),
        },
      },
      lib: {
        entry: pass.entry,
        // Spread, not `name: pass.name`: only an `iife` pass has a global, and
        // under `exactOptionalPropertyTypes` a present `undefined` is not the
        // same as an absent key.
        ...(pass.name !== undefined && { name: pass.name }),
        formats: pass.formats,
        // The entry NAME is the file name, so `jeex-viewer-element` cannot
        // collide with `jeex-viewer` in a multi-entry pass. `iife` keeps the
        // `.iife` infix Vite would have added on its own.
        fileName: (format, entryName) => (format === 'iife' ? `${entryName}.iife.js` : `${entryName}.js`),
      },
    },
  };
});
