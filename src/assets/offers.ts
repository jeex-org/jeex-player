/**
 * The host's `offers`: an extra library, in the project-library format, that
 * the "Replace with another…" popup offers and that a document may name.
 *
 * Given by URL (the `offers` attribute) or inline with its folder. Either way
 * it is JUDGED by the library schema before anything reads it, and a library
 * that cannot be fetched or is not valid is a WARNING (`offers-invalid`), never
 * a failed mount: the scene still opens and the bundled bank is offered.
 *
 * It is loaded before the document is validated (`app/project-wiring.ts`),
 * because a document may already name the offers library.
 */

import { fetchJsonCapped } from '../scene/scene-source.js';
import { ViewerLibError } from '../shared/errors.js';
import { MAX_PROJECT_MANIFEST_BYTES } from '../shared/limits.js';
import type { Logger } from '../shared/logger.js';
import type { LibraryLayer } from './library-stack.js';
import { parseProjectLibrary } from './project-manifest.schema.js';

/**
 * How a host names its offers: `url` of a library file, or `library` (the
 * library object, unjudged) with `baseUrl`, the absolute folder URL its
 * relative paths resolve against. A HOST OBJECT in the inline form, like
 * `scene.library`.
 */
export type OffersSource = {
  readonly url?: string | undefined;
  readonly library?: unknown;
  readonly baseUrl?: string | undefined;
};

/** Where relative URLs resolve outside a page (`bun:test`, a worker). */
const PLACEHOLDER_BASE = 'http://localhost/';

/** The folder a file was served from, as an absolute URL ending in `/`. */
function folderOf(url: string): string {
  const here = (globalThis as { location?: { href?: string } }).location?.href;
  return new URL('.', new URL(url, here ?? PLACEHOLDER_BASE)).href;
}

/**
 * The offers a source names, judged; `null` when it names none, or with an
 * `offers-invalid` warning when they cannot be read.
 */
export async function loadOffers(source: OffersSource | undefined, log: Logger): Promise<LibraryLayer | null> {
  if (source === undefined || (source.url === undefined && source.library === undefined)) return null;
  try {
    if (source.library !== undefined) {
      if (typeof source.baseUrl !== 'string') throw new ViewerLibError('bad-params', 'an inline offers library needs its baseUrl');
      return { library: parseProjectLibrary(source.library), baseUrl: new URL(source.baseUrl).href };
    }
    const url = source.url!;
    // Same limits as a manifest: no credentials, no redirect, a timeout and a size cap.
    const fetched = await fetchJsonCapped(url, undefined, MAX_PROJECT_MANIFEST_BYTES);
    return { library: parseProjectLibrary(fetched.value), baseUrl: folderOf(url) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    log.warn('offers-invalid', `Offers are not a library this viewer reads; the bundled bank is offered instead: ${message}`, { cause });
    return null;
  }
}
