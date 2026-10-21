/**
 * The page path a telemetry send names: the path of the page the player is on,
 * with everything that could name a person taken out.
 *
 * Invariant: what comes out is a rooted path of at most `PAGE_PATH_LIMIT`
 * characters with no query, no fragment and no segment that looks like an
 * email, a handle, a UUID (anywhere in it), a long token or a long number. The query and the fragment are
 * dropped ALWAYS, not filtered: that is where sign-in tokens, search terms and
 * campaign tags live. A segment is judged after percent-decoding, so
 * `someone%40example.org` is an email like `someone@example.org`.
 *
 * Pure module: no `three`, no DOM.
 */

/** The longest path a send carries, in characters. */
export const PAGE_PATH_LIMIT = 200;

/** What a removed segment is replaced with. */
export const PATH_ID = ':id';

const EMAIL = /[^@\s]+@[^@\s]+/;
/** A handle (`@someone`) names a person as surely as an email does. */
const HANDLE = /^@/;
/** A UUID anywhere in the segment (`/flat-<uuid>-sea-view` too). */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Six or more digits in a row anywhere in the segment: an order, a listing, a phone number. */
const LONG_NUMBER = /\d{6,}/;
/** A run of twenty or more letters and digits: a sign-in link, a session or a share token. A hyphenated slug is not one. */
const LONG_TOKEN = /[A-Za-z0-9]{20,}/;
/**
 * A run of twenty or more URL-safe token characters (base64url, a share link)
 * with a digit or an underscore in it. A long hyphenated slug of words has
 * neither and stays a page name.
 */
const URL_SAFE_TOKEN = /[A-Za-z0-9_-]{20,}/g;
const TOKEN_MARK = /[0-9_]/;

function hasUrlSafeToken(value: string): boolean {
  return (value.match(URL_SAFE_TOKEN) ?? []).some((run) => TOKEN_MARK.test(run));
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function looksPersonal(segment: string): boolean {
  const value = decoded(segment);
  return (
    EMAIL.test(value) ||
    HANDLE.test(value) ||
    UUID.test(value) ||
    LONG_NUMBER.test(value) ||
    LONG_TOKEN.test(value) ||
    hasUrlSafeToken(value)
  );
}

/** Only the path of `raw`, whether it is a full URL, a rooted path or a bare one. */
function pathOf(raw: string): string {
  const cut = raw.search(/[?#]/);
  const head = cut === -1 ? raw : raw.slice(0, cut);
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(head);
  const path = scheme ? head.slice(scheme[0].length) : head;
  return path.startsWith('/') ? path : `/${path}`;
}

/** Encodes what a URL path may not carry raw (controls, spaces), leaving `%XX` and `/` alone. */
function encoded(path: string): string {
  let out = '';
  for (const char of path) {
    const code = char.codePointAt(0)!;
    out += code <= 0x20 || (code >= 0x7f && code <= 0x9f) ? `%${code.toString(16).toUpperCase().padStart(2, '0')}` : char;
  }
  return out;
}

/** The sanitised path of `raw` (a `location.pathname`, a URL, or what a host page handed over). */
export function sanitisePagePath(raw: string): string {
  const segments = pathOf(raw)
    .split('/')
    .map((segment) => (segment !== '' && looksPersonal(segment) ? PATH_ID : segment));
  return encoded(segments.join('/')).slice(0, PAGE_PATH_LIMIT);
}
