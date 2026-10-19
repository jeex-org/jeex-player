/**
 * The disclosure caption, in a real browser.
 *
 * `provenanceFor` is pure and is tested beside its module (`src/app/provenance.test.ts`);
 * this is the half that needs a rasteriser — `stampCaption` decodes a PNG,
 * paints a band and re-encodes, and the only honest way to check that the
 * band is really there is to read the pixels back.
 */

import { describe, expect, test } from 'vitest';
import { stampCaption } from '../../src/app/provenance.js';

const TEXT = 'Rendered from a 3D model, not a photograph';

/** A flat mid-grey PNG of the given size: something a dark band shows up against. */
async function greyPng(width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#808080';
  context.fillRect(0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function decode(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Mean luminance of one image row, 0…255. */
function rowMean(image: ImageData, y: number): number {
  let total = 0;
  for (let x = 0; x < image.width; x += 1) {
    const at = (y * image.width + x) * 4;
    total += (image.data[at]! + image.data[at + 1]! + image.data[at + 2]!) / 3;
  }
  return total / image.width;
}

describe('stampCaption', () => {
  test('answers a PNG of exactly the same size', async () => {
    const stamped = await stampCaption(await greyPng(320, 180), TEXT, 1);
    expect(stamped.type).toBe('image/png');
    const image = await decode(stamped);
    expect(image.width).toBe(320);
    expect(image.height).toBe(180);
  });

  test('the bottom band is darker than the picture it sits on', async () => {
    const image = await decode(await stampCaption(await greyPng(320, 180), TEXT, 1));
    expect(rowMean(image, 4)).toBeGreaterThan(120);
    expect(rowMean(image, image.height - 8)).toBeLessThan(110);
  });

  test('the band grows with the pixel ratio, so a large export is not captioned in 14 pixels', async () => {
    const small = await decode(await stampCaption(await greyPng(400, 400), TEXT, 1));
    const large = await decode(await stampCaption(await greyPng(400, 400), TEXT, 3));
    // A row that the 1x band does not reach, and the 3x one does.
    expect(rowMean(small, 340)).toBeGreaterThan(120);
    expect(rowMean(large, 340)).toBeLessThan(110);
  });

  test('the picture under the band is untouched', async () => {
    const image = await decode(await stampCaption(await greyPng(200, 200), TEXT, 1));
    const middle = image.data[(100 * 200 + 100) * 4]!;
    expect(middle).toBeGreaterThan(120);
    expect(middle).toBeLessThan(140);
  });
});
