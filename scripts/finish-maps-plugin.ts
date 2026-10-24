/**
 * The bundled finishes' maps, served BESIDE the player's bundles the way the
 * Basis transcoder is (`basis-transcoder-plugin.ts`). Used by both build
 * configs and by the dev server the component and e2e tiers run against.
 *
 * 1. **Emits** every file `finish-maps/index.json` lists, and `SOURCES.md`,
 *    under `<prefix>finish-maps/`, next to the chunks: the player looks for
 *    them in the folder of the file it runs from (`src/app/builtin-textures.ts`).
 * 2. **Serves them in development** for any request path that contains
 *    `/finish-maps/` followed by a listed file, wherever the module that asks
 *    lives (in development the player file is a module under `src/`). Any
 *    other path under that folder answers 404 instead of falling through to
 *    the page fallback, and nothing outside the index is ever read.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { FINISH_MAPS_DIR, listedMaps } from './finish-maps-fetch.ts';
import { finishMapsIndexSchema } from './finish-maps-index.schema.ts';

/** The folder's name next to the player file. */
const FOLDER = '/finish-maps/';

/** Every map path `index.json` in `dir` lists (`tex/<version>/<role>.<px>.webp`). */
export function indexedFiles(dir: string): Set<string> {
  const index = finishMapsIndexSchema.parse(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')));
  const out = new Set<string>();
  for (const version of index.versions) {
    for (const [, map] of listedMaps(version)) for (const file of Object.values(map.files)) out.add(file.path);
  }
  return out;
}

/** What a request path asks of the folder: a listed file, a miss inside the folder, or `null` for anything else. */
export function servedFinishMap(url: string, listed: ReadonlySet<string>): { kind: 'file'; path: string } | { kind: 'missing' } | null {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  const at = path.lastIndexOf(FOLDER);
  if (at === -1) return null;
  const rest = path.slice(at + FOLDER.length);
  return listed.has(rest) ? { kind: 'file', path: rest } : { kind: 'missing' };
}

/**
 * The plugin. `prefix` is the folder the chunks are written to, relative to
 * the output directory: `''` for the library, `'assets/'` for the demo build.
 */
export function finishMaps(prefix = '', dir = FINISH_MAPS_DIR): Plugin {
  const listed = indexedFiles(dir);
  return {
    name: 'jeex-finish-maps',
    generateBundle() {
      for (const path of listed)
        this.emitFile({ type: 'asset', fileName: `${prefix}finish-maps/${path}`, source: readFileSync(join(dir, path)) });
      this.emitFile({ type: 'asset', fileName: `${prefix}finish-maps/SOURCES.md`, source: readFileSync(join(dir, 'SOURCES.md')) });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const served = servedFinishMap(request.url ?? '', listed);
        if (served === null || (request.method !== 'GET' && request.method !== 'HEAD')) {
          next();
          return;
        }
        if (served.kind === 'missing') {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader('Content-Type', 'image/webp');
        response.end(request.method === 'HEAD' ? undefined : readFileSync(join(dir, served.path)));
      });
    },
  };
}
