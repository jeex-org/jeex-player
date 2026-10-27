/**
 * The kelvin-to-colour function of the lighting standard: Helland's
 * approximation, decoded from sRGB and normalised to unit luminance, over the
 * standard's temperature range.
 */

import { describe, expect, test } from 'bun:test';
import { colourTemperatureRgb, isLightTemperature } from './colour-temperature.js';
import { LIGHTING_STANDARD } from './lighting-standard.js';
import { LightingError } from './lighting-error.js';

const luminance = ([r, g, b]: readonly [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('colourTemperatureRgb', () => {
  test('matches the reference values at 2700, 4000 and 6500 K', () => {
    const cases: [number, [number, number, number]][] = [
      [2700, [2.021, 0.778, 0.194]],
      [4000, [1.469, 0.905, 0.561]],
      [6500, [1.009, 1.001, 0.965]],
    ];
    for (const [kelvin, expected] of cases) {
      const rgb = colourTemperatureRgb(kelvin);
      for (let channel = 0; channel < 3; channel += 1) expect(rgb[channel]!).toBeCloseTo(expected[channel]!, 2);
    }
  });

  test('has unit luminance at every step of the range', () => {
    const { min, max, step } = LIGHTING_STANDARD.temperature;
    for (let kelvin = min; kelvin <= max; kelvin += step) expect(luminance(colourTemperatureRgb(kelvin))).toBeCloseTo(1, 9);
  });

  test('goes from warm to cold monotonically', () => {
    const { min, max, step } = LIGHTING_STANDARD.temperature;
    let previous = colourTemperatureRgb(min);
    for (let kelvin = min + step; kelvin <= max; kelvin += step) {
      const next = colourTemperatureRgb(kelvin);
      expect(next[0]).toBeLessThan(previous[0]);
      expect(next[2]).toBeGreaterThan(previous[2]);
      previous = next;
    }
  });

  test('clamps a temperature outside the range to its nearest end', () => {
    expect(colourTemperatureRgb(1000)).toEqual(colourTemperatureRgb(2700));
    expect(colourTemperatureRgb(12_000)).toEqual(colourTemperatureRgb(6500));
  });

  test('refuses a value that is not a finite number', () => {
    expect(() => colourTemperatureRgb(Number.NaN)).toThrow(expect.objectContaining({ code: 'bad-options' }));
    expect(() => colourTemperatureRgb(Number.POSITIVE_INFINITY)).toThrow(LightingError);
  });
});

describe('isLightTemperature', () => {
  test('accepts the whole kelvin steps of the range and nothing else', () => {
    for (const ok of [2700, 2800, 4000, 6500]) expect(isLightTemperature(ok)).toBe(true);
    for (const bad of [2600, 6600, 3050, 2700.5, Number.NaN, '3000', null, undefined]) expect(isLightTemperature(bad)).toBe(false);
  });
});

test('the standard publishes the range with a neutral 5000 K as the default', () => {
  expect(LIGHTING_STANDARD.temperature).toEqual({ min: 2700, max: 6500, step: 100, default: 5000 });
});
