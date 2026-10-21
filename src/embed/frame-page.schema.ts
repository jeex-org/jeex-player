/**
 * The two query parameters `embed.html` judges on its own, as `zod/mini`
 * schemas: the host origin the postMessage bridge answers to (`?host=`) and
 * the aspect ratio of the frame's content box (`?ratio=`).
 *
 * Both reach the frame as strings written by the embedding page, and both are
 * refused rather than repaired: `frame-page.ts` reads a refusal as "no bridge"
 * or "the default ratio" and logs the value it refused.
 *
 * Judging invariant: these schemas never transform. The origin that flows on
 * is the string the query held, and the ratio is read by `parseRatio`, the one
 * reader both embed surfaces share.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { parseRatio } from './ratio.js';

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

/** `?host=`: an exact `http(s)` origin, never `*`, never a URL with a path. */
const hostOriginParamSchema = z.string().check(z.refine(isExactOrigin, { error: 'must be an exact http(s) origin' }));

/** `?ratio=`: `16:9`, `16/9`, `4:3`, `1` or `1.5`, two positive numbers or one. */
const ratioParamSchema = z.string().check(z.refine((raw) => parseRatio(raw) !== null, { error: 'must be a ratio such as 16:9' }));

/** Whether a `?host=` value is an origin the bridge may answer to. */
export function isHostOriginParam(raw: string): boolean {
  return z.safeParse(hostOriginParamSchema, raw).success;
}

/** Whether a `?ratio=` value is a ratio. */
export function isRatioParam(raw: string): boolean {
  return z.safeParse(ratioParamSchema, raw).success;
}
