import { describe, expect, test } from 'bun:test';
import { canonicalRing, quantiseKey } from './quantise.js';
import { ViewerLibError } from './errors.js';

/** Two wall ids for the ride-along test; any UUIDs, the ring never reads them. */
const WALL = { first: '01a12ffa-e532-77cf-9701-f9fd65de213d', second: '01a12ffa-e533-700c-8078-87222e61588f' } as const;

/** Shoelace area of a ring in the plan's `(x, z)` plane; sign is the winding. */
const area = (ring: readonly { x: number; z: number }[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
};

describe('quantiseKey', () => {
  test('two points inside half a grid cell share a key', () => {
    expect(quantiseKey({ x: 0.0000004, z: 1 }, 1e-6)).toBe(quantiseKey({ x: 0, z: 1 }, 1e-6));
    expect(quantiseKey({ x: 3.0004, z: -2 }, 1e-3)).toBe(quantiseKey({ x: 3, z: -2 }, 1e-3));
  });

  test('two points further apart than a grid cell do not', () => {
    expect(quantiseKey({ x: 0.0000024, z: 1 }, 1e-6)).not.toBe(quantiseKey({ x: 0, z: 1 }, 1e-6));
    expect(quantiseKey({ x: 0, z: 0 }, 1e-3)).not.toBe(quantiseKey({ x: 0, z: 0.002 }, 1e-3));
  });

  test('negative zero and positive zero are one key', () => {
    // `Math.round` preserves the sign of a negative zero; this guards against a
    // stringified `-0` becoming its own bucket, which silently misses a weld.
    expect(quantiseKey({ x: -0, z: -0 }, 1e-6)).toBe(quantiseKey({ x: 0, z: 0 }, 1e-6));
    expect(quantiseKey({ x: -4e-7, z: -4e-7 }, 1e-6)).toBe(quantiseKey({ x: 0, z: 0 }, 1e-6));
    expect(quantiseKey({ x: 0, z: 0 }, 1e-6)).toBe('0,0');
  });

  test('the two axes are separated, so no pair of coordinates collides', () => {
    expect(quantiseKey({ x: 1, z: 23 }, 1e-3)).not.toBe(quantiseKey({ x: 12, z: 3 }, 1e-3));
  });

  test('the key is stable across calls and independent of the caller', () => {
    expect(quantiseKey({ x: 2.5, z: -0.125 }, 1e-6)).toBe(quantiseKey({ x: 2.5, z: -0.125 }, 1e-6));
    expect(quantiseKey({ x: 2.5, z: -0.125 }, 1e-6)).toBe('2500000,-125000');
  });

  test('a grid that is not a positive finite number is a caller error', () => {
    expect(() => quantiseKey({ x: 0, z: 0 }, 0)).toThrow(ViewerLibError);
    expect(() => quantiseKey({ x: 0, z: 0 }, -1e-6)).toThrow(ViewerLibError);
    expect(() => quantiseKey({ x: 0, z: 0 }, Number.POSITIVE_INFINITY)).toThrow(ViewerLibError);
  });

  test('a non-finite coordinate is a caller error too', () => {
    expect(() => quantiseKey({ x: Number.NaN, z: 0 }, 1e-6)).toThrow(ViewerLibError);
    expect(() => quantiseKey({ x: 0, z: Number.POSITIVE_INFINITY }, 1e-6)).toThrow(ViewerLibError);
  });
});

describe('canonicalRing', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 4 },
    { x: 0, z: 4 },
  ];

  test('a square started at any vertex gives one and the same array', () => {
    const expected = canonicalRing(square);
    for (let shift = 0; shift < square.length; shift += 1) {
      const rotated = [...square.slice(shift), ...square.slice(0, shift)];
      expect(canonicalRing(rotated)).toEqual(expected);
    }
    expect(expected).toEqual(square);
  });

  test('the start is the lexicographically smallest vertex, x before z', () => {
    const ring = [
      { x: 5, z: 1 },
      { x: 1, z: 9 },
      { x: 1, z: 2 },
      { x: 7, z: 0 },
    ];
    // x = 1 twice, so z decides: (1, 2) wins over (1, 9).
    expect(canonicalRing(ring)[0]).toEqual({ x: 1, z: 2 });
  });

  test('orientation is kept: the signed area is unchanged', () => {
    const reversed = [...square].reverse();
    expect(area(canonicalRing(square))).toBeCloseTo(area(square), 12);
    expect(area(canonicalRing(reversed))).toBeCloseTo(area(reversed), 12);
    expect(area(canonicalRing(reversed))).toBeLessThan(0);
  });

  test('every vertex survives exactly once, in cyclic order', () => {
    const rotated = [...square.slice(2), ...square.slice(0, 2)];
    const canonical = canonicalRing(rotated);
    expect(canonical.length).toBe(square.length);
    expect(new Set(canonical.map((p) => `${p.x},${p.z}`)).size).toBe(square.length);
    expect(canonical[1]).toEqual({ x: 4, z: 0 });
  });

  test('the elements belong to the caller, they are not copies', () => {
    const canonical = canonicalRing(square);
    expect(canonical[0]).toBe(square[0]);
    expect(canonical).not.toBe(square);
  });

  test('extra properties ride along', () => {
    const tagged = [
      { x: 2, z: 2, wallId: WALL.second },
      { x: 1, z: 1, wallId: WALL.first },
    ];
    expect(canonicalRing(tagged).map((p) => p.wallId)).toEqual([WALL.first, WALL.second]);
  });

  test('an empty ring stays empty and a single vertex stays put', () => {
    expect(canonicalRing([])).toEqual([]);
    expect(canonicalRing([{ x: 3, z: 3 }])).toEqual([{ x: 3, z: 3 }]);
  });
});
