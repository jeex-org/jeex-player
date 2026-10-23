/**
 * Which size of a library material's maps a device draws: one size per
 * device class per document, never streamed up from a smaller one.
 *
 * The class arrives as a VALUE (the GPU class the app layer computed from the
 * WebGL context, whether or not telemetry is on), so `materials` reads nothing
 * above it. Pure module: no `three`, no DOM.
 */

import type { LibraryMapSize } from './finish-types.js';

/** The GPU capability class a texture size is chosen by; `none` without a WebGL context. */
export type TextureDeviceClass = 'low' | 'mid' | 'high' | 'none';

/** The size each class asks for, in pixels. */
const WANTED: Readonly<Record<Exclude<TextureDeviceClass, 'none'>, number>> = { low: 256, mid: 512, high: 768 };

/**
 * The listed size nearest the one `device` asks for, the smaller on a tie, or
 * `null` when there is no context or no size to draw.
 */
export function textureSizeFor(device: TextureDeviceClass, listed: readonly LibraryMapSize[]): LibraryMapSize | null {
  if (device === 'none') return null;
  const wanted = WANTED[device];
  let best: LibraryMapSize | null = null;
  for (const size of listed) {
    if (best === null) {
      best = size;
      continue;
    }
    const gap = Math.abs(Number(size) - wanted);
    const bestGap = Math.abs(Number(best) - wanted);
    if (gap < bestGap || (gap === bestGap && Number(size) < Number(best))) best = size;
  }
  return best;
}
