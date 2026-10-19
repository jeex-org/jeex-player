import { describe, expect, test } from 'bun:test';
import { clamp, clamp01, inverseSmoothstep, lerp, smootherstep, smoothstep } from './math.js';

describe('clamp', () => {
  test('passes a value already inside the range through', () => {
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(clamp(-3, -5, 5)).toBe(-3);
  });

  test('holds the value at the bounds', () => {
    expect(clamp(9, 0, 1)).toBe(1);
    expect(clamp(-9, 0, 1)).toBe(0);
  });

  test('collapses a non-finite value to the low bound instead of propagating NaN', () => {
    expect(clamp(Number.NaN, 2, 7)).toBe(2);
    expect(clamp(Number.POSITIVE_INFINITY, 2, 7)).toBe(2);
    expect(clamp(Number.NEGATIVE_INFINITY, 2, 7)).toBe(2);
  });

  test('collapses an inverted range to the low bound', () => {
    expect(clamp(5, 10, 1)).toBe(10);
  });
});

describe('clamp01', () => {
  test('is clamp over the unit range', () => {
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });

  test('answers 0 for a non-finite progress, so a stale clock cannot poison a tween', () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('lerp', () => {
  test('pins the endpoints', () => {
    expect(lerp(2, 6, 0)).toBe(2);
    expect(lerp(2, 6, 1)).toBe(6);
  });

  test('is linear at the midpoint', () => {
    expect(lerp(2, 6, 0.5)).toBe(4);
  });

  test('extrapolates outside 0..1 rather than clamping', () => {
    expect(lerp(0, 10, 1.5)).toBe(15);
    expect(lerp(0, 10, -0.5)).toBe(-5);
  });
});

describe('smoothstep', () => {
  test('pins the endpoints and the midpoint', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(1)).toBe(1);
  });

  test('clamps outside 0..1', () => {
    expect(smoothstep(-3)).toBe(0);
    expect(smoothstep(4)).toBe(1);
  });

  test('has zero slope at both ends: the first step is smaller than the linear one', () => {
    expect(smoothstep(0.1)).toBeLessThan(0.1);
    expect(smoothstep(0.9)).toBeGreaterThan(0.9);
  });

  test('is monotonic', () => {
    let previous = -1;
    for (let i = 0; i <= 20; i += 1) {
      const value = smoothstep(i / 20);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

describe('inverseSmoothstep', () => {
  test('undoes smoothstep across the unit range and clamps outside it', () => {
    for (let t = 0; t <= 1 + 1e-9; t += 0.05) expect(inverseSmoothstep(smoothstep(t))).toBeCloseTo(t, 9);
    expect(inverseSmoothstep(-1)).toBeCloseTo(0, 12);
    expect(inverseSmoothstep(2)).toBeCloseTo(1, 12);
  });
});

describe('smootherstep', () => {
  test('pins the endpoints and the midpoint, and clamps outside 0..1', () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(0.5)).toBe(0.5);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(-1)).toBe(0);
    expect(smootherstep(2)).toBe(1);
  });

  test('leaves both ends flatter than smoothstep: zero slope and zero curvature there', () => {
    const h = 1e-3;
    expect(smootherstep(h) / h).toBeLessThan(1e-5);
    expect((1 - smootherstep(1 - h)) / h).toBeLessThan(1e-5);
    expect(smootherstep(0.1)).toBeLessThan(smoothstep(0.1));
  });
});
