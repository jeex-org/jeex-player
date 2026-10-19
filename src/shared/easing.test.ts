import { describe, expect, test } from 'bun:test';
import { easeInOutCubic, easeOutBack } from './easing.js';

describe('easeOutBack', () => {
  test('pins the endpoints and overshoots at the midpoint', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 12);
    expect(easeOutBack(0.5)).toBeCloseTo(1.0125, 12);
    expect(easeOutBack(1)).toBe(1);
  });

  test('clamps outside 0..1', () => {
    expect(easeOutBack(-2)).toBeCloseTo(0, 12);
    expect(easeOutBack(2)).toBe(1);
  });

  test('overshoots past 1 before settling', () => {
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
    expect(easeOutBack(1)).toBe(1);
  });
});

describe('easeInOutCubic', () => {
  test('pins the endpoints and the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
  });

  test('clamps outside 0..1', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(9)).toBe(1);
  });

  test('is slow at both ends and symmetric about the midpoint', () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 12);
  });
});
