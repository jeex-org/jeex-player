/**
 * The RGBM reference decode: rgb × M × range over bytes, linear, alpha
 * straight.
 */

import { describe, expect, test } from 'bun:test';
import { rgbmDecode } from './rgbm.js';

describe('rgbmDecode', () => {
  test('scales the colour bytes by M and the range', () => {
    expect(rgbmDecode([255, 255, 255, 255], 8)).toEqual([8, 8, 8]);
    expect(rgbmDecode([0, 0, 0, 255], 8)).toEqual([0, 0, 0]);
    const [r, g, b] = rgbmDecode([128, 64, 255, 32], 8);
    expect(r).toBeCloseTo((128 / 255) * (32 / 255) * 8, 12);
    expect(g).toBeCloseTo((64 / 255) * (32 / 255) * 8, 12);
    expect(b).toBeCloseTo((32 / 255) * 8, 12);
  });

  test('is linear: no sRGB curve on either the colour or M', () => {
    const half = rgbmDecode([255, 255, 255, 128], 8)[0];
    const quarter = rgbmDecode([128, 128, 128, 128], 8)[0];
    expect(quarter / half).toBeCloseTo(128 / 255, 12);
  });
});
