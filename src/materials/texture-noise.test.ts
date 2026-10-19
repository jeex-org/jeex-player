import { describe, expect, test } from 'bun:test';
import {
  adjustHsl,
  chevronRowCount,
  chevronRowShift,
  hash1,
  hash2,
  makeRandom,
  mixHex,
  parseHex,
  periodicFbm,
  periodicNoise2D,
  periodicRidge,
  plankRowOffset,
  plankRowSpans,
  rgba,
  shadeHex,
  terrazzoPalette,
  tileGrid,
  toHex,
  woodPlankColor,
  wrapIndex,
  wrapOffsets,
  type PlankSpan,
} from './texture-noise.js';

const SIZE = 1024;

/** Index of the span covering `t` on the circle of circumference `size`, or -1. */
function spanAt(spans: PlankSpan[], t: number, size: number): number {
  const point = wrapIndex(t, size);
  for (let index = 0; index < spans.length; index += 1) {
    // `index` is bounded by the array's own length.
    const { start, length } = spans[index]!;
    const local = wrapIndex(point - start, size);
    if (local < length) return index;
  }
  return -1;
}

describe('seeded randomness', () => {
  test('the PRNG is deterministic and stays in [0, 1)', () => {
    const first = Array.from({ length: 64 }, makeRandom(1234));
    const again = Array.from({ length: 64 }, makeRandom(1234));
    expect(first).toEqual(again);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test('different seeds produce different streams', () => {
    const a = makeRandom(1)();
    const b = makeRandom(2)();
    expect(a).not.toBe(b);
  });

  test('lattice hashes are stable and bounded', () => {
    expect(hash2(3, 7, 11)).toBe(hash2(3, 7, 11));
    expect(hash1(5, 2)).toBe(hash1(5, 2));
    for (let x = -4; x < 4; x += 1) {
      for (let y = -4; y < 4; y += 1) {
        const value = hash2(x, y, 5);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});

describe('periodic noise', () => {
  test('value noise repeats exactly at the tile border', () => {
    for (const y of [0, 0.13, 0.5, 0.87]) {
      expect(periodicNoise2D(0, y, 8, 3)).toBe(periodicNoise2D(1, y, 8, 3));
      expect(periodicNoise2D(y, 0, 8, 3)).toBe(periodicNoise2D(y, 1, 8, 3));
    }
  });

  test('value noise is periodic with period 1 in both axes', () => {
    const points: ReadonlyArray<readonly [number, number]> = [
      [0.21, 0.34],
      [0.5, 0.5],
      [0.77, 0.02],
      [0.99, 0.99],
    ];
    for (const [x, y] of points) {
      const reference = periodicNoise2D(x, y, 6, 17);
      expect(periodicNoise2D(x + 1, y, 6, 17)).toBeCloseTo(reference, 9);
      expect(periodicNoise2D(x, y + 1, 6, 17)).toBeCloseTo(reference, 9);
      expect(periodicNoise2D(x + 1, y + 1, 6, 17)).toBeCloseTo(reference, 9);
      expect(periodicNoise2D(x - 1, y, 6, 17)).toBeCloseTo(reference, 9);
    }
  });

  test('non-integer frequencies are rounded, keeping the field periodic', () => {
    expect(periodicNoise2D(0.4, 0.6, 5.4, 1)).toBe(periodicNoise2D(0.4, 0.6, 5, 1));
    expect(periodicNoise2D(0, 0.6, 5.4, 1)).toBe(periodicNoise2D(1, 0.6, 5.4, 1));
  });

  test('fractal noise stays in [0, 1] and remains periodic across octaves', () => {
    for (let step = 0; step < 40; step += 1) {
      const x = step / 40;
      const y = ((step * 7) % 40) / 40;
      const value = periodicFbm(x, y, { octaves: 5, freq: 3, seed: 9 });
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(periodicFbm(x + 1, y, { octaves: 5, freq: 3, seed: 9 })).toBeCloseTo(value, 9);
      expect(periodicFbm(x, y + 1, { octaves: 5, freq: 3, seed: 9 })).toBeCloseTo(value, 9);
    }
  });

  // The furniture generators lean on these two shapes: the wood grain traces a
  // line as a function of `t` alone, and the pore relief stretches the field
  // along one axis by an integer factor. Both must still close at the border.
  test('a one-axis sweep closes on itself, which is what makes a grain line seamless', () => {
    for (const phase of [0, 0.17, 0.63]) {
      for (const freq of [2, 4, 6]) {
        expect(periodicNoise2D(1, phase, freq, 31)).toBeCloseTo(periodicNoise2D(0, phase, freq, 31), 9);
      }
    }
  });

  test('stretching a field by an integer factor keeps it periodic', () => {
    for (const stretch of [2, 3, 6]) {
      for (let step = 0; step < 12; step += 1) {
        const x = step / 12;
        const y = ((step * 5) % 12) / 12;
        const value = periodicFbm(x, y * stretch, { octaves: 3, freq: 4, seed: 613 });
        expect(periodicFbm(x + 1, y * stretch, { octaves: 3, freq: 4, seed: 613 })).toBeCloseTo(value, 9);
        expect(periodicFbm(x, (y + 1) * stretch, { octaves: 3, freq: 4, seed: 613 })).toBeCloseTo(value, 9);
      }
    }
  });

  test('ridged noise is periodic and bounded', () => {
    const value = periodicRidge(0.33, 0.66, { octaves: 3, freq: 2, seed: 4 });
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
    expect(periodicRidge(1.33, 0.66, { octaves: 3, freq: 2, seed: 4 })).toBeCloseTo(value, 9);
  });
});

describe('plank layout', () => {
  test('the spans of a course tile the circle exactly once', () => {
    for (let row = 0; row < 12; row += 1) {
      const spans = plankRowSpans(row, SIZE, SIZE / 3, 42);
      const total = spans.reduce((sum, span) => sum + span.length, 0);
      expect(total).toBeCloseTo(SIZE, 6);
      for (let sample = 0; sample < 200; sample += 1) {
        const t = (sample / 200) * SIZE;
        const covering = spans.filter((span) => wrapIndex(t - span.start, SIZE) < span.length);
        expect(covering.length).toBe(1);
      }
    }
  });

  test('the course is continuous across the tile border: t=0 and t=size are the same board', () => {
    for (let row = 0; row < 12; row += 1) {
      const spans = plankRowSpans(row, SIZE, SIZE / 3, 42);
      const before = spanAt(spans, SIZE - 0.001, SIZE);
      const after = spanAt(spans, 0.001, SIZE);
      expect(before).toBeGreaterThanOrEqual(0);
      expect(before).toBe(after);
      // Exactly one board owns the border, and it is drawn twice by the canvas code.
      const wrapping = spans.filter((span) => span.start + span.length > SIZE);
      expect(wrapping.length).toBe(1);
    }
  });

  test('starts stay inside the tile and lengths are positive', () => {
    const spans = plankRowSpans(4, SIZE, SIZE / 3, 7);
    for (const span of spans) {
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.start).toBeLessThan(SIZE);
      expect(span.length).toBeGreaterThan(0);
    }
  });

  test('layout is deterministic per seed and different between seeds', () => {
    expect(plankRowSpans(2, SIZE, SIZE / 3, 1)).toEqual(plankRowSpans(2, SIZE, SIZE / 3, 1));
    expect(plankRowSpans(2, SIZE, SIZE / 3, 1)).not.toEqual(plankRowSpans(2, SIZE, SIZE / 3, 2));
  });

  test('neighbouring courses are staggered, including the pair that meets at the border', () => {
    const rows = 12;
    const step = SIZE / 3;
    const offsets = Array.from({ length: rows }, (_, row) => plankRowOffset(row, SIZE, step, 42));
    for (let row = 0; row < rows; row += 1) {
      // `offsets` has exactly `rows` entries and both indexes are taken modulo it.
      const next = offsets[(row + 1) % rows]!;
      const gap = Math.abs(wrapIndex(next - offsets[row]! + SIZE / 2, SIZE) - SIZE / 2);
      expect(gap).toBeGreaterThan(step * 0.08);
    }
  });

  test('per-board variation seeds are in range and stable', () => {
    for (const span of plankRowSpans(3, SIZE, SIZE / 3, 5)) {
      for (const value of [span.tone, span.hue, span.grain]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});

describe('tile grid and chevron layout', () => {
  test('the grid covers the tile with exact cell steps', () => {
    const cells = tileGrid(512, 4, 3);
    expect(cells.length).toBe(16);
    const area = cells.reduce((sum, cell) => sum + cell.width * cell.height, 0);
    expect(area).toBeCloseTo(512 * 512, 6);
    for (const cell of cells) {
      expect(cell.x % 128).toBeCloseTo(0, 9);
      expect(cell.y % 128).toBeCloseTo(0, 9);
      expect(cell.tone).toBeGreaterThanOrEqual(0);
      expect(cell.tone).toBeLessThan(1);
    }
    // The first column starts on the border, so the joint there is shared with the wrapped copy.
    expect(cells.some((cell) => cell.x === 0)).toBe(true);
    expect(cells.some((cell) => cell.y === 0)).toBe(true);
  });

  test('the grid is deterministic for a seed', () => {
    expect(tileGrid(512, 2, 1)).toEqual(tileGrid(512, 2, 1));
    expect(tileGrid(512, 2, 1)).not.toEqual(tileGrid(512, 2, 2));
  });

  test('chevron courses re-enter the tile after exactly one period', () => {
    const size = 1024;
    const pitch = size / 12;
    const rows = chevronRowCount(size, pitch);
    expect(rows).toBe(12);
    for (let row = -3; row < 6; row += 1) {
      expect(chevronRowShift(row + rows, pitch) - chevronRowShift(row, pitch)).toBeCloseTo(size, 9);
    }
  });

  test('wrap offsets add the mirrored copy only for shapes crossing a border', () => {
    expect(wrapOffsets(100, 50, 512)).toEqual([0]);
    expect(wrapOffsets(500, 50, 512)).toEqual([0, -512]);
    expect(wrapOffsets(-10, 50, 512)).toEqual([0, 512]);
    expect(wrapOffsets(0, 512, 512)).toEqual([0]);
  });
});

describe('colour helpers', () => {
  test('hex parsing round-trips', () => {
    expect(toHex(parseHex('#b5855a'))).toBe('#b5855a');
    expect(toHex(parseHex('#abc'))).toBe('#aabbcc');
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  test('shading clamps at both ends', () => {
    expect(shadeHex('#ffffff', 40)).toBe('#ffffff');
    expect(shadeHex('#000000', -40)).toBe('#000000');
    expect(shadeHex('#808080', 16)).toBe('#909090');
  });

  test('mixing hits both endpoints', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  test('HSL adjustment is deterministic and stays a valid colour', () => {
    const shifted = adjustHsl('#b5855a', 0.02, -0.1, 0.05);
    expect(shifted).toBe(adjustHsl('#b5855a', 0.02, -0.1, 0.05));
    expect(shifted).toMatch(/^#[0-9a-f]{6}$/);
    expect(adjustHsl('#b5855a', 0, 0, 0)).toBe('#b5855a');
  });

  test('board colours are deterministic and follow the tone seed', () => {
    const dark = woodPlankColor('#b5855a', { tone: 0.05, hue: 0.5 });
    const light = woodPlankColor('#b5855a', { tone: 0.95, hue: 0.5 });
    expect(dark).toBe(woodPlankColor('#b5855a', { tone: 0.05, hue: 0.5 }));
    expect(parseHex(light).r).toBeGreaterThan(parseHex(dark).r);
  });

  test('the terrazzo palette is deterministic and derived from the slab colour', () => {
    const palette = terrazzoPalette('#a7b5a6');
    expect(palette).toEqual(terrazzoPalette('#a7b5a6'));
    expect(palette.length).toBe(7);
    expect(new Set(palette).size).toBe(palette.length);
    for (const colour of palette) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('rgba renders a css colour', () => {
    expect(rgba('#b5855a', 0.5)).toBe('rgba(181, 133, 90, 0.5)');
  });
});
