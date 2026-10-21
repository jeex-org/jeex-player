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
 * is the string the query held. The ratio is READ once, by `parseRatio` (the
 * one reader both embed surfaces share), and this schema judges what it read.
 * The ratio has to be read before it can be judged, so the schema cannot
 * check the raw string.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import type { Ratio } from './ratio.js';

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

/** A side of a ratio: a positive, finite number. */
const ratioSide = z
  .number()
  .check(z.positive({ error: 'must be a positive number' }), z.refine(Number.isFinite, { error: 'must be finite' }));

/** `?ratio=` once `parseRatio` has read it: width and height, both positive and finite. */
const ratioParamSchema = z.object({ width: ratioSide, height: ratioSide });

/** Whether a `?host=` value is an origin the bridge may answer to. */
export function isHostOriginParam(raw: string): boolean {
  return z.safeParse(hostOriginParamSchema, raw).success;
}

/** Whether the ratio `parseRatio` read off `?ratio=` is one the frame may apply. */
export function isRatioParam(ratio: Ratio): boolean {
  return z.safeParse(ratioParamSchema, ratio).success;
}
