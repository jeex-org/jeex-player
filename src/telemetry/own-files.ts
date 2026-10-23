/**
 * Which script files are the player's own, for the error reports.
 *
 * Invariant: ownership is decided by the URL of the file this module runs in
 * and by the published file names, never by a guess. A frame is own when it
 * is in the same directory as this module's file AND its name has the shape
 * of a published player file (`jeex-viewer*.js`, `lazy-jeex-viewer*.js`).
 * When this module's own file does not have that shape — the player was
 * bundled into a site's own script, or into a build with other names — no
 * frame is own at all: the site's code may share that file, so the check
 * fails closed.
 *
 * The player file's own URL is read once, when the bundle evaluates
 * (`shared/own-url.ts`).
 */

import { OWN_FILE_URL } from '../shared/own-url.js';

/** The shape of a published player file name. */
export const PUBLISHED_FILE = /^(?:lazy-)?jeex-viewer[\w.-]*\.js$/;

/** The directory and the file name of `url`, without query and fragment; `null` when it is no URL. */
function split(url: string): { dir: string; name: string } | null {
  const cut = url.search(/[?#]/);
  const bare = cut === -1 ? url : url.slice(0, cut);
  const slash = bare.lastIndexOf('/');
  if (slash === -1 || !/^[a-z][a-z0-9+.-]*:\/\//i.test(bare)) return null;
  return { dir: bare.slice(0, slash + 1), name: bare.slice(slash + 1) };
}

/** The own-frame predicate for a player running from `ownUrl`. */
export function ownFilePredicate(ownUrl: string): (url: string) => boolean {
  const self = split(ownUrl);
  if (self === null || !PUBLISHED_FILE.test(self.name)) return () => false;
  return (url) => {
    const frame = split(url);
    return frame !== null && frame.dir === self.dir && PUBLISHED_FILE.test(frame.name);
  };
}

/** The predicate for the file this module was loaded from, decided once, when the bundle evaluates. */
export const isOwnFile: (url: string) => boolean = ownFilePredicate(OWN_FILE_URL);
