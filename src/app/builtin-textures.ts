/**
 * The texture source of the bundled room finishes: ONE per viewer, resolving
 * against the `finish-maps/` folder that ships next to the player file (as
 * the Basis transcoder does), never through the host's `resolveTexture`.
 *
 * It outlives every document: the encoded bytes it fetched stay for the
 * viewer's lifetime, so a second scene on the same finishes, a remount and a
 * context restore draw them again without the network. A player copied
 * without its folder draws every bundled surface flat in its library colour
 * and says so ONCE, not once per file.
 */

import { TextureSource } from '../materials/texture-source.js';
import type { Logger } from '../shared/logger.js';
import type { LibraryTextures } from '../geometry/library-surface.js';
import type { TextureEnv } from './project-textures.js';

/** `log` that lets its first warning through and drops every later one; errors always pass. */
export function onceLogger(log: Logger): Logger {
  let warned = false;
  return {
    warn(code, message, detail) {
      if (warned) return;
      warned = true;
      log.warn(code, message, detail);
    },
    error(code, message, detail) {
      log.error(code, message, detail);
    },
  };
}

/** A deferred source for the bundled finishes in `folder` (absolute, with its trailing slash). */
export function createBuiltinTextures(env: TextureEnv, folder: string): LibraryTextures {
  const source = new TextureSource({
    baseUrl: folder,
    log: onceLogger(env.log),
    maxAnisotropy: env.maxAnisotropy,
    deferred: true,
    ...(env.fetch !== undefined && { fetch: env.fetch }),
    ...(env.decode !== undefined && { decode: env.decode }),
  });
  return { source, device: env.device };
}
