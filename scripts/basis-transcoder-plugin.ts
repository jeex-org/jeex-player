/**
 * The Basis Universal transcoder, served BESIDE the player's bundles instead
 * of inside them. Used by both build configs (`vite.config.ts`,
 * `vite.lib.config.ts`) and by the dev server the component and e2e tiers
 * run against.
 *
 * three ships the transcoder as two files (`examples/jsm/libs/basis/`:
 * `basis_transcoder.js`, about 15 KB gzip, and `basis_transcoder.wasm`, about
 * 245 KB gzip) that `KTX2Loader` fetches at run time, the first time it meets
 * a KTX2 texture. This plugin does three things with them:
 *
 * 1. **Neutralises KTX2Loader's default URLs.** The loader declares two
 *    top-level `new URL('../libs/basis/…', import.meta.url)` constants for the
 *    case where no transcoder path is set. Vite turns that pattern into an
 *    emitted asset, and in library mode into a base64 `data:` URL inlined into
 *    the chunk: the lazy loader chunk grows by 380 KB gzip and the IIFE, which
 *    inlines its dynamic imports, goes over its budget. The player always sets
 *    the path (`src/materials/ktx2.ts`), so the two constants are
 *    replaced with `''`. A three upgrade that changes the two lines fails the
 *    build here rather than quietly inlining the files again.
 * 2. **Emits the two files** next to the chunks, as
 *    `lazy-jeex-viewer-basis-transcoder-<hash>.js` and `.wasm`
 *    (`publishedTranscoderNames`): flat, so a host that serves the build from
 *    one directory serves them too; with the `lazy-` prefix, so
 *    `scripts/budget-check.ts` holds them to lazy budgets of their own; and
 *    named by ONE hash of both files, so a cached wrapper never meets a newer
 *    wasm. The hash reaches the bundle as `__JEEX_BASIS_TRANSCODER__`.
 * 3. **Serves them in development** for any request path that ends in a
 *    published name, whatever its hash, so a page on the dev server finds them wherever the module
 *    that asks for them lives.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/** The names three's loader asks for. */
type SourceName = 'basis_transcoder.js' | 'basis_transcoder.wasm';

/** The published name's stem; the viewer composes the same names (`src/materials/ktx2.ts`). */
const PUBLISHED_STEM = 'lazy-jeex-viewer-basis-transcoder-';

/** Eight base64url characters of SHA-256 over both files, so the pair always changes together. */
export function transcoderHash(js: Uint8Array, wasm: Uint8Array): string {
  return createHash('sha256').update(js).update(wasm).digest('base64url').slice(0, 8);
}

/** The published names of the two files, keyed by the names three's loader asks for. */
export function publishedTranscoderNames(hash: string): Record<SourceName, string> {
  return { 'basis_transcoder.js': `${PUBLISHED_STEM}${hash}.js`, 'basis_transcoder.wasm': `${PUBLISHED_STEM}${hash}.wasm` };
}

/** A request for either published name, whatever its hash. */
const SERVED = /\/lazy-jeex-viewer-basis-transcoder-[A-Za-z0-9_-]+\.(js|wasm)$/;

/** The module whose default transcoder URLs are replaced. */
const KTX2_LOADER = /[\\/]three[\\/]examples[\\/]jsm[\\/]loaders[\\/]KTX2Loader\.js$/;

/** The two default-URL declarations, as three 0.186 writes them. */
const DEFAULT_URLS = [
  /new URL\(\s*'\.\.\/libs\/basis\/basis_transcoder\.wasm',\s*import\.meta\.url\s*\)\.toString\(\)/,
  /new URL\(\s*'\.\.\/libs\/basis\/basis_transcoder\.js',\s*import\.meta\.url\s*\)\.toString\(\)/,
] as const;

/** `KTX2Loader.js` with its two default transcoder URLs replaced by `''`; throws when either is missing. */
export function neutraliseDefaultUrls(code: string): string {
  let out = code;
  for (const pattern of DEFAULT_URLS) {
    if (!pattern.test(out)) {
      throw new Error(`basis-transcoder: KTX2Loader.js no longer declares ${pattern.source}; review the plugin after the three upgrade`);
    }
    out = out.replace(pattern, "''");
  }
  return out;
}

/** The folder three keeps the transcoder in, resolved from the installed package. */
export function transcoderSourceDir(): string {
  const require = createRequire(import.meta.url);
  // Through the package's own `exports` (`./examples/jsm/*`): `three/package.json` is not exported to Node.
  return dirname(require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js'));
}

/** The source file a request path asks for, or `null`. */
export function servedTranscoderFile(path: string): SourceName | null {
  const match = SERVED.exec(path.split(/[?#]/, 1)[0] ?? '');
  return match === null ? null : match[1] === 'js' ? 'basis_transcoder.js' : 'basis_transcoder.wasm';
}

/**
 * The plugin. `prefix` is the folder the files are written to, relative to the
 * output directory: `''` for the library (the chunks sit at the root of
 * `dist-lib`), `'assets/'` for the demo build (its chunks sit under `assets/`).
 */
export function basisTranscoder(prefix = ''): Plugin {
  const dir = transcoderSourceDir();
  const js = readFileSync(join(dir, 'basis_transcoder.js'));
  const wasm = readFileSync(join(dir, 'basis_transcoder.wasm'));
  const hash = transcoderHash(js, wasm);
  return {
    name: 'jeex-basis-transcoder',
    // Before Vite's own `new URL(…, import.meta.url)` handling, which would otherwise inline the files.
    enforce: 'pre',
    config() {
      return { define: { __JEEX_BASIS_TRANSCODER__: JSON.stringify(hash) } };
    },
    transform(code, id) {
      if (!KTX2_LOADER.test(id.split('?', 1)[0] ?? id)) return null;
      return { code: neutraliseDefaultUrls(code), map: null };
    },
    generateBundle() {
      const names = publishedTranscoderNames(hash);
      this.emitFile({ type: 'asset', fileName: `${prefix}${names['basis_transcoder.js']}`, source: js });
      this.emitFile({ type: 'asset', fileName: `${prefix}${names['basis_transcoder.wasm']}`, source: wasm });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = servedTranscoderFile(request.url ?? '');
        if (file === null) {
          next();
          return;
        }
        response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        response.end(file === 'basis_transcoder.js' ? js : wasm);
      });
    },
  };
}
