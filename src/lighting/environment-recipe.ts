/**
 * The neutral environment of the lighting standard, generated on the CPU.
 *
 * An equirectangular grey studio: a vertical gradient (brighter above, darker
 * below the horizon) plus soft rectangular panels that give a metal something
 * to reflect. The recipe is a pure function of `LIGHTING_STANDARD`'s frozen
 * parameters, so every consumer gets the same pixels and a test can read them
 * without a GPU; the context uploads them as half floats and prefilters them
 * with the caller's own `PMREMGenerator`.
 *
 * Mapping invariant: texel `(i, j)` is the direction three's `equirectUv`
 * maps to `u = (i + 0.5) / width`, `v = (j + 0.5) / height`, row 0 at the
 * bottom (a `DataTexture` is not flipped). The irradiance integral below walks
 * the same texels with the same directions, so it measures what the GPU sees.
 *
 * Pure module: no `three`, no DOM.
 */

import type { EnvironmentPanel, EnvironmentRecipe, Triple } from './lighting-standard.js';

const DEG = Math.PI / 180;

/** Smooth fall-off from 1 inside `half` to 0 at `half + softness`. */
function edge(distance: number, half: number, softness: number): number {
  const outside = Math.abs(distance) - half;
  if (outside <= 0) return 1;
  if (outside >= softness) return 0;
  const t = 1 - outside / softness;
  return t * t * (3 - 2 * t);
}

/** Signed difference of two azimuths in degrees, wrapped to `[-180, 180)`. */
function azimuthDelta(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

function panelWeight(panel: EnvironmentPanel, azimuth: number, elevation: number): number {
  return (
    edge(azimuthDelta(azimuth, panel.azimuth), panel.width / 2, panel.softness) *
    edge(elevation - panel.elevation, panel.height / 2, panel.softness)
  );
}

/** Radiance of the recipe in the direction given by azimuth and elevation, degrees. */
export function environmentRadiance(recipe: EnvironmentRecipe, azimuth: number, elevation: number): number {
  const s = Math.sin(elevation * DEG);
  let radiance = s >= 0 ? recipe.horizon + (recipe.zenith - recipe.horizon) * s : recipe.horizon + (recipe.nadir - recipe.horizon) * -s;
  for (const panel of recipe.panels) radiance += panel.radiance * panelWeight(panel, azimuth, elevation);
  return radiance;
}

/** Azimuth and elevation, degrees, of the centre of texel `(i, j)`. */
function texelAngles(recipe: EnvironmentRecipe, i: number, j: number): { azimuth: number; elevation: number } {
  const u = (i + 0.5) / recipe.width;
  const v = (j + 0.5) / recipe.height;
  return { azimuth: (u - 0.5) * 360, elevation: (v - 0.5) * 180 };
}

/**
 * The environment as linear RGBA floats, row 0 at the bottom. Every texel has
 * equal red, green and blue and an alpha of 1.
 */
export function generateEnvironment(recipe: EnvironmentRecipe): Float32Array {
  const data = new Float32Array(recipe.width * recipe.height * 4);
  for (let j = 0; j < recipe.height; j += 1) {
    for (let i = 0; i < recipe.width; i += 1) {
      const { azimuth, elevation } = texelAngles(recipe, i, j);
      const value = environmentRadiance(recipe, azimuth, elevation);
      const at = (j * recipe.width + i) * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 1;
    }
  }
  return data;
}

/**
 * Cosine-weighted irradiance of the recipe on a surface facing `normal`, in
 * the recipe's units: the sum over texels of radiance × max(0, n·ω) × solid
 * angle. A Lambert surface of albedo `a` lit only by this environment at
 * intensity `k` sends back `a · k · E / π`.
 */
export function environmentIrradiance(recipe: EnvironmentRecipe, normal: Triple): number {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  const [nx, ny, nz] = [normal[0] / length, normal[1] / length, normal[2] / length];
  const cell = ((2 * Math.PI) / recipe.width) * (Math.PI / recipe.height);
  let sum = 0;
  for (let j = 0; j < recipe.height; j += 1) {
    for (let i = 0; i < recipe.width; i += 1) {
      const { azimuth, elevation } = texelAngles(recipe, i, j);
      const cosElevation = Math.cos(elevation * DEG);
      const x = cosElevation * Math.cos(azimuth * DEG);
      const y = Math.sin(elevation * DEG);
      const z = cosElevation * Math.sin(azimuth * DEG);
      const cosine = nx * x + ny * y + nz * z;
      if (cosine <= 0) continue;
      sum += environmentRadiance(recipe, azimuth, elevation) * cosine * cosElevation * cell;
    }
  }
  return sum;
}

const FLOAT_VIEW = new Float32Array(1);
const BITS_VIEW = new Uint32Array(FLOAT_VIEW.buffer);

/** The largest finite half float, `65504`: anything beyond it is clamped here, as three's own encoder does. */
const HALF_MAX = 0x7bff;

/** One float as IEEE 754 half-precision bits, rounded to nearest, clamped to the finite range. */
function toHalf(value: number): number {
  FLOAT_VIEW[0] = value;
  const bits = BITS_VIEW[0]!;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent >= 0x1f) return sign | HALF_MAX;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    const full = mantissa | 0x800000;
    return sign | ((full >> (14 - exponent)) + ((full >> (13 - exponent)) & 1));
  }
  const rounded = ((exponent << 10) | (mantissa >> 13)) + ((mantissa >> 12) & 1);
  return sign | Math.min(rounded, HALF_MAX);
}

/** `data` as half-float bits, for a `HalfFloatType` texture. */
export function toHalfFloats(data: Float32Array): Uint16Array {
  const out = new Uint16Array(data.length);
  for (let index = 0; index < data.length; index += 1) out[index] = toHalf(data[index]!);
  return out;
}
