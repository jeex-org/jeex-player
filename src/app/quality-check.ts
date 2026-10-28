/**
 * The one refusal of a quality tier a host hands the viewer: anything but
 * `auto`, `low` or `high` throws `bad-params` naming `quality`.
 *
 * Its own small module because two places judge the same call: the running
 * viewer (`quality-control.ts`) and the element's handle before its viewer
 * has started (`embed/pending-viewer.ts`), which must not pull the renderer
 * in to say no.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError } from '../shared/errors.js';
import type { QualityOption } from '../render/quality-tier.js';

/** A refused value, as the refusal names it. */
function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/** Answers whether `value` is one of the three quality modes, without throwing. */
export function isQualityMode(value: unknown): value is QualityOption {
  return value === 'auto' || value === 'low' || value === 'high';
}

/** Answers `value` as a quality tier, or throws `bad-params` (path `quality`). */
export function requireQuality(value: unknown): QualityOption {
  if (isQualityMode(value)) return value;
  throw new ViewerLibError('bad-params', `setQuality: quality must be auto, low or high, got ${describe(value)}`, {
    path: 'quality',
    detail: { value: describe(value) },
  });
}
