import { describe, expect, test } from 'bun:test';
import { directionalSH, evaluateSH, exteriorSH, hemisphereSH, packAtlas, srgbToLinear, type Rgb } from './exterior-sh.js';
import { LIGHTING_STANDARD } from '../../lighting/lighting-standard.js';

/** Unit normals spread over the sphere (a Fibonacci lattice). */
const NORMALS = Array.from({ length: 200 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 200;
  const r = Math.sqrt(1 - y * y);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
});

describe('hemisphereSH', () => {
  test("reproduces three's hemisphere light exactly at every normal", () => {
    const sky: Rgb = [1, 0.9, 0.8];
    const ground: Rgb = [0.2, 0.3, 0.1];
    const coefficients = hemisphereSH(sky, ground);
    for (const n of NORMALS) {
      const weight = 0.5 * n.y + 0.5;
      const value = evaluateSH(coefficients, n);
      for (let c = 0; c < 3; c += 1) expect(value[c]!).toBeCloseTo(ground[c]! + (sky[c]! - ground[c]!) * weight, 5);
    }
  });
});

describe('directionalSH', () => {
  test('approximates a clamped cosine within the error of an L2 expansion', () => {
    const d = { x: -0.7, y: 0.4, z: 0.6 };
    const length = Math.hypot(d.x, d.y, d.z);
    const coefficients = directionalSH([1, 1, 1], d);
    let worst = 0;
    for (const n of NORMALS) {
      const exact = Math.max(0, (n.x * d.x + n.y * d.y + n.z * d.z) / length);
      worst = Math.max(worst, Math.abs(evaluateSH(coefficients, n)[0]! - exact));
    }
    // The L2 truncation of a clamped cosine is off by at most about a tenth of its peak.
    expect(worst).toBeLessThan(0.11);
  });
});

describe('exteriorSH', () => {
  test("is the standard's hemisphere plus its fill, in linear light", () => {
    const { hemisphere, fill } = LIGHTING_STANDARD.apartment;
    const coefficients = exteriorSH(LIGHTING_STANDARD.apartment);
    const up = evaluateSH(coefficients, { x: 0, y: 1, z: 0 });
    const skyRed = srgbToLinear(parseInt(hemisphere.sky.slice(1, 3), 16) / 255) * hemisphere.intensity;
    const [fx, fy, fz] = fill.position;
    const cosUp = fy / Math.hypot(fx, fy, fz);
    const fillRed = srgbToLinear(parseInt(fill.colour.slice(1, 3), 16) / 255) * fill.intensity;
    expect(up[0]!).toBeCloseTo(skyRed + fillRed * cosUp, 1);
  });
});

describe('packAtlas', () => {
  test("lays the nine coefficients out in three's seven sub-volumes, padding slices included", () => {
    const coefficients = Array.from({ length: 9 }, (_, i) => [i * 3 + 1, i * 3 + 2, i * 3 + 3] as Rgb);
    const { data, width, height, depth } = packAtlas(coefficients, 2);
    expect([width, height, depth]).toEqual([2, 2, 7 * 4]);
    const texel = (x: number, y: number, z: number) =>
      Array.from(data.slice(((z * height + y) * width + x) * 4, ((z * height + y) * width + x) * 4 + 4));
    expect(texel(0, 0, 0)).toEqual([1, 2, 3, 4]);
    expect(texel(1, 1, 3)).toEqual([1, 2, 3, 4]);
    expect(texel(0, 1, 4)).toEqual([5, 6, 7, 8]);
    expect(texel(1, 0, 6 * 4 + 2)).toEqual([25, 26, 27, 0]);
  });
});
