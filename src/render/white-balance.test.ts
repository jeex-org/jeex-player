import { describe, expect, test } from 'bun:test';
import { whiteBalanceMatrix, type Mat3, type Rgb } from './white-balance.js';

const Y: Rgb = [0.2126, 0.7152, 0.0722];
const apply = (m: Mat3, c: Rgb): Rgb =>
  [0, 1, 2].map((r) => m[r * 3]! * c[0] + m[r * 3 + 1]! * c[1] + m[r * 3 + 2]! * c[2]) as unknown as Rgb;
const luminance = (c: Rgb): number => Y[0] * c[0] + Y[1] * c[1] + Y[2] * c[2];
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * An independent reference: Bradford von Kries adaptation in XYZ (published
 * matrices), partial degree, then the luminance row restored by adding the
 * same amount to every channel.
 */
function reference(source: Rgb, degree: number): number[] {
  const toXyz = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
  const toRgb = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];
  const bradford = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  const bradfordInv = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];
  const mul = (a: number[], b: number[]) =>
    Array.from({ length: 9 }, (_, i) => [0, 1, 2].reduce((sum, k) => sum + a[Math.floor(i / 3) * 3 + k]! * b[k * 3 + (i % 3)]!, 0));
  const vec = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r * 3]! * v[0]! + m[r * 3 + 1]! * v[1]! + m[r * 3 + 2]! * v[2]!);
  const y = luminance(source);
  const src = vec(bradford, vec(toXyz, source as unknown as number[]));
  const dst = vec(bradford, vec(toXyz, [y, y, y]));
  const gains = [0, 1, 2].map((i) => (degree * dst[i]!) / src[i]! + 1 - degree);
  const diag = [gains[0]!, 0, 0, 0, gains[1]!, 0, 0, 0, gains[2]!];
  const m = mul(toRgb, mul(bradfordInv, mul(diag, mul(bradford, toXyz))));
  const row = [0, 1, 2].map((c) => Y[c]! - (Y[0] * m[c]! + Y[1] * m[3 + c]! + Y[2] * m[6 + c]!));
  return m.map((value, i) => value + row[i % 3]!);
}

describe('whiteBalanceMatrix', () => {
  test('is the identity at degree 0, and for a source that is already the display white', () => {
    whiteBalanceMatrix([1, 0.7, 0.4], 0).forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]!, 9));
    whiteBalanceMatrix([0.5, 0.5, 0.5], 0.8).forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]!, 6));
  });

  test('maps the source white to the display white at its own luminance at full degree', () => {
    const source: Rgb = [1, 0.69, 0.48];
    const out = apply(whiteBalanceMatrix(source, 1), source);
    const y = luminance(source);
    out.forEach((v) => expect(v).toBeCloseTo(y, 4));
  });

  test('keeps the luminance of every colour before clipping, at any degree', () => {
    const colours: Rgb[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.3, 0.6, 0.9],
      [2, 1.5, 1],
    ];
    for (const degree of [0.25, 0.5, 1]) {
      const m = whiteBalanceMatrix([2, 1.5, 1], degree);
      for (const c of colours) expect(luminance(apply(m, c))).toBeCloseTo(luminance(c), 9);
    }
  });

  test('matches an independent reference computation', () => {
    const m = whiteBalanceMatrix([1, 0.62, 0.46], 0.55);
    reference([1, 0.62, 0.46], 0.55).forEach((v, i) => expect(m[i]!).toBeCloseTo(v, 5));
  });
});
