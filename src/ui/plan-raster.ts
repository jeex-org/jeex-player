/**
 * Rasterises `plan-export.ts`'s SVG string into a PNG or JPEG: the bitmap a
 * portal's `Floor Plan` slot and a dependency-free PDF writer both take.
 *
 * Invariant: this module owns its own `<img>`, object URL and offscreen
 * `<canvas>` — it never touches the live viewer's own canvas, camera or frame
 * loop, and the object URL it creates is always revoked, load or fail alike.
 *
 * DOM layer: not pure (creates DOM elements), no `three`.
 */

import { ViewerLibError } from '../shared/errors.js';

export type RasteriseSvgOptions = {
  /** CSS-pixel size the SVG's own `viewBox`/`width`/`height` already describe. */
  width: number;
  height: number;
  /** Device pixels per CSS pixel; default `1`. */
  scale?: number;
  type?: 'image/png' | 'image/jpeg';
  /** JPEG quality in `[0, 1]`; ignored for PNG. */
  quality?: number;
};

/** Loads `src` as an `<img>`, resolving once it has decoded. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ViewerLibError('internal', 'rasteriseSvg: the SVG failed to load as an image'));
    image.src = src;
  });
}

/** `canvas.toBlob` as a promise, refusing silently rather than resolving `null`. */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number | undefined): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ViewerLibError('internal', 'rasteriseSvg: the canvas produced no blob'));
      },
      type,
      quality,
    );
  });
}

/**
 * Rasterises `svg` onto a canvas sized `width * scale` by `height * scale`
 * device pixels, through an `<img>` load — the browser's own SVG renderer
 * does the drawing, so this module never parses a path or a font itself.
 */
export async function rasteriseSvg(svg: string, options: RasteriseSvgOptions): Promise<Blob> {
  const scale = options.scale ?? 1;
  const type = options.type ?? 'image/png';
  const pixelWidth = Math.max(1, Math.round(options.width * scale));
  const pixelHeight = Math.max(1, Math.round(options.height * scale));

  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(blobUrl);
    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ViewerLibError('internal', 'rasteriseSvg: the canvas 2D context is unavailable');
    ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    return await canvasToBlob(canvas, type, options.quality);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
