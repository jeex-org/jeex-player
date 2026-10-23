/**
 * Colour temperature to colour, for the interior's artificial light.
 *
 * Tanner Helland's fit of the black-body colour (sRGB, 0–255) over the
 * standard's range: with `t = K / 100`, red is 255, green
 * `99.4708025861·ln t − 161.1195681661` and blue
 * `138.5177312231·ln(t − 10) − 305.0447927307`, each clamped to 0–255. The
 * channels are decoded from sRGB into linear light and divided by their
 * luminance (`Y = 0.2126 R + 0.7152 G + 0.0722 B`), so the colour carries
 * hue only: a light keeps its brightness by multiplying the result with the
 * luminance of its original colour. Linear channels may exceed 1.
 *
 * Pure module: no `three`, no DOM.
 */

import type { Triple } from './lighting-standard.js';
import { TEMPERATURE_RANGE } from './temperature-range.js';
import { LightingError } from './lighting-error.js';

/** Linear value of one sRGB-encoded channel in 0–1. */
function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function channel(value: number): number {
  return srgbToLinear(Math.min(255, Math.max(0, value)) / 255);
}

/**
 * The linear RGB colour of `kelvin`, normalised to unit luminance. A
 * temperature outside the standard's range is clamped to its nearest end;
 * a value that is not a finite number throws a `LightingError` with code `bad-options`.
 */
export function colourTemperatureRgb(kelvin: number): Triple {
  if (!Number.isFinite(kelvin))
    throw new LightingError('bad-options', `colour temperature must be a finite number of kelvin, got ${String(kelvin)}`);
  const { min, max } = TEMPERATURE_RANGE;
  const t = Math.min(max, Math.max(min, kelvin)) / 100;
  const r = channel(255);
  const g = channel(99.470_802_586_1 * Math.log(t) - 161.119_568_166_1);
  const b = channel(138.517_731_223_1 * Math.log(t - 10) - 305.044_792_730_7);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / y, g / y, b / y];
}

/** Whether `value` is a temperature the standard allows: a whole step of kelvin inside the range. */
export function isLightTemperature(value: unknown): value is number {
  const { min, max, step } = TEMPERATURE_RANGE;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max && (value - min) % step === 0;
}
