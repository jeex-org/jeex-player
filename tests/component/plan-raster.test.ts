/**
 * `rasteriseSvg`, against a real `<img>`/`<canvas>` in a real browser
 * (Vitest browser mode) — the one thing a `bun test` environment cannot do.
 */

import { describe, expect, test } from 'vitest';
import { rasteriseSvg } from '../../src/ui/plan-raster.js';

/** A tiny, self-contained SVG: a red square on white, easy to eyeball if this ever needs a screenshot. */
function smallSvg(width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>` +
    `<rect x="${width / 4}" y="${height / 4}" width="${width / 2}" height="${height / 2}" fill="#c0392b"/>` +
    `</svg>`
  );
}

describe('rasteriseSvg', () => {
  test('rasterises at scale 1 by default: a PNG blob sized width x height, non-empty and decodable', async () => {
    const blob = await rasteriseSvg(smallSvg(64, 48), { width: 64, height: 48 });
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
    const bitmap = await createImageBitmap(blob);
    expect(bitmap.width).toBe(64);
    expect(bitmap.height).toBe(48);
    bitmap.close();
  });

  test('scale multiplies both dimensions into device pixels', async () => {
    const blob = await rasteriseSvg(smallSvg(64, 48), { width: 64, height: 48, scale: 2 });
    const bitmap = await createImageBitmap(blob);
    expect(bitmap.width).toBe(128);
    expect(bitmap.height).toBe(96);
    bitmap.close();
  });

  test('type: "image/jpeg" produces a JPEG blob', async () => {
    const blob = await rasteriseSvg(smallSvg(32, 32), { width: 32, height: 32, type: 'image/jpeg', quality: 0.8 });
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBeGreaterThan(0);
  });

  test('the rasterised image actually carries the drawing, not a blank canvas', async () => {
    const blob = await rasteriseSvg(smallSvg(40, 40), { width: 40, height: 40 });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    // Centre pixel sits inside the red square: it must not be white.
    const { data } = ctx.getImageData(20, 20, 1, 1);
    expect([data[0], data[1], data[2]]).not.toEqual([255, 255, 255]);
  });
});
