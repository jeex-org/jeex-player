/**
 * The two decisions `embed.html` makes about its own query string, taken out
 * of the page entry so they can be tested.
 *
 * Both are TRUST decisions, which is why they are not in `viewer-options.ts`
 * with the rest of the query parsing. The query is written by the embedding
 * page (it wrote the frame's `src`), but "written by the host" is not the same
 * as "safe to act on": a host that copies a URL from a visitor, or a page that
 * frames `embed.html` itself, controls it just as well.
 *
 * - `hostOriginFrom` decides whether the postMessage bridge is installed at
 *   all. It refuses `?host=*`, which would make the frame broadcast every
 *   event to whatever framed it — an origin check the party it constrains could
 *   switch off — and `?host=notanorigin`, which would make `postMessage` throw
 *   inside a tour listener on every frame.
 * - `embedPageOptions` takes `debug` away. An embed page has no legitimate
 *   authoring capability, and with `allow-same-origin` the parent page reads
 *   `frame.contentWindow.__viewerDebug` straight out of the frame — past the
 *   protocol, its origin checks and its method allowlist.
 */

import { optionsFromQuery, type DeepPartial, type ViewerOptions } from '../app/viewer-api.js';
import { DEFAULT_RATIO, parseRatio, type Ratio } from './ratio.js';

/** The frame page's own parameter for the aspect ratio of its content box. */
export const RATIO_PARAM = 'ratio';

/** The two schemes a browser can postMessage between; nothing else is an origin. */
const ORIGIN_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * True when `raw` is EXACTLY an origin: `new URL(raw).origin === raw` rejects a
 * trailing slash, a path, a query, credentials and the literal `null`, and the
 * scheme check rejects `file:`, `data:` and every opaque one — those serialise
 * their origin as `"null"`, which is not a target any two pages can agree on.
 * `*` is rejected by both.
 */
export function isExactOrigin(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === raw && ORIGIN_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

/**
 * The origin the frame will answer to, or `null` when it must answer nobody.
 *
 * `onInvalid` is called with the value that was refused: the page logs it, so a
 * host that mistyped its own origin sees why the bridge is not there instead of
 * a silent frame.
 */
export function hostOriginFrom(query: URLSearchParams, param: string, onInvalid?: (raw: string) => void): string | null {
  const raw = query.get(param);
  if (raw === null || raw === '') return null;
  if (isExactOrigin(raw)) return raw;
  onInvalid?.(raw);
  return null;
}

/**
 * The mount options of the embed page: everything the query names, minus the
 * authoring capability. The rest is validated by `resolveViewerOptions` like
 * any other source — there is one options validator and it is not here.
 *
 * Read-only unless the query says `readonly=0`: a frame is what a
 * site shows its visitors, and a visitor gets no finish or variant panels.
 * The option's own default stays `false` for `mountViewer`, the authoring API.
 */
export function embedPageOptions(search: string): DeepPartial<ViewerOptions> {
  const { debug: _authoring, ...safe } = optionsFromQuery(search);
  safe.readonly ??= true;
  return safe;
}

/**
 * The aspect ratio of the frame page's content box: `?ratio=` (`16:9`, `4:3`,
 * `1`, …) or 16:9. A value that is no ratio is handed to `onInvalid` — the
 * page logs it — and the default stands.
 */
export function framePageRatio(query: URLSearchParams, onInvalid?: (raw: string) => void): Ratio {
  const raw = query.get(RATIO_PARAM);
  if (raw === null || raw === '') return DEFAULT_RATIO;
  const ratio = parseRatio(raw);
  if (ratio !== null) return ratio;
  onInvalid?.(raw);
  return DEFAULT_RATIO;
}
