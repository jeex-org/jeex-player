import { describe, expect, test } from 'bun:test';
import { blenderPower, lampCandela } from './lamp-units.js';
import { LIGHTING_STANDARD, LIGHTING_STANDARD_VERSION } from './lighting-standard.js';

describe('lamp units', () => {
  test('400 lm read as the bank table lamp: 1.2 cd', () => {
    expect(Math.abs(lampCandela(400) - 1.2)).toBeLessThan(1e-9);
  });

  test('600 lm read as the bank pendant: 1.8 cd', () => {
    expect(Math.abs(lampCandela(600) - 1.8)).toBeLessThan(1e-9);
  });

  test('candela scale linearly with lumens through lamp.exposure', () => {
    expect(lampCandela(4 * Math.PI)).toBeCloseTo(LIGHTING_STANDARD.lamp.exposure, 12);
    expect(lampCandela(0)).toBe(0);
  });

  test('the bake power is 4π candela', () => {
    expect(Math.abs(blenderPower(1) - 4 * Math.PI)).toBeLessThan(1e-9);
    expect(Math.abs(blenderPower(1.2) - 4 * Math.PI * 1.2)).toBeLessThan(1e-9);
  });

  test('adding lamp.exposure leaves the standard at version 1', () => {
    expect(LIGHTING_STANDARD_VERSION).toBe(1);
    expect(LIGHTING_STANDARD.lamp.exposure).toBeCloseTo((1.2 * 4 * Math.PI) / 400, 12);
    expect(Object.isFrozen(LIGHTING_STANDARD.lamp)).toBe(true);
  });
});
