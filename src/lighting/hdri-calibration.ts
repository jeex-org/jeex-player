/**
 * How a host's sky (`lighting.hdri`) is turned and how strong its analytic
 * sun is: the arithmetic of the lighting standard's HDRI calibration.
 *
 * Conventions: azimuths are degrees clockwise seen from above, from +Z
 * towards +X, as `sun-direction.ts` measures them; a stored HDRI azimuth is
 * measured the same way in the panorama's own frame. A panorama's texels are
 * in three's equirectangular layout as the HDRI loader returns them: row 0 is
 * straight up, column `i` has `atan2(z, x) = ((i + 0.5) / width - 0.5) · 2π`.
 *
 * The sun: the stored share `s` is the part of the sky's horizontal
 * irradiance that came from the cone around the sun before the import step
 * clamped it. With `A` the decoded sky's horizontal irradiance outside the
 * cone and `R` what the clamp left inside it, the analytic sun carries
 * `A · s / (1 − s) − R` on a horizontal plane, so its normal irradiance is
 * that over `sin(elevation)`, never below zero.
 *
 * Pure module: no `three`, no DOM.
 */

import { LightingError } from './lighting-error.js';
import type { Triple } from './lighting-standard.js';

const DEG = Math.PI / 180;

const wrap = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** The Y rotation of sky and environment that takes the stored sun to the preset's world azimuth, radians. */
export function hdriRotationY(northDeg: number, presetAzimuthDeg: number, storedAzimuthDeg: number): number {
  return (northDeg + presetAzimuthDeg - storedAzimuthDeg) * DEG;
}

/** A three.js equirectangular azimuth `atan2(z, x)`, degrees, as a stored azimuth: `90 − a` in [0, 360). */
export function storedAzimuthFromEquirect(equirectDeg: number): number {
  return wrap(90 - equirectDeg);
}

function direction(azimuthDeg: number, elevationDeg: number): Triple {
  const a = azimuthDeg * DEG;
  const e = elevationDeg * DEG;
  return Object.freeze([Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]) as Triple;
}

/** The analytic sun's direction in world axes: the preset's world azimuth (north plus preset), the stored elevation. */
export function hdriSunDirection(northDeg: number, presetAzimuthDeg: number, elevationDeg: number): Triple {
  return direction(northDeg + presetAzimuthDeg, elevationDeg);
}

/** The stored sun as a unit vector in the panorama's own frame. */
export function panoramaSunDirection(storedAzimuthDeg: number, elevationDeg: number): Triple {
  return direction(storedAzimuthDeg, elevationDeg);
}

/** A decoded panorama: RGBA, float or half float (three's `HalfFloatType` bits). */
export type PanoramaTexels = {
  readonly data: Float32Array | Uint16Array;
  readonly width: number;
  readonly height: number;
  /** The stored sun in the panorama's frame (`panoramaSunDirection`). */
  readonly sun: Triple;
  /** Half angle of the cone around the sun, degrees. */
  readonly coneDeg: number;
  /** Every `step`-th row and column is read; default 2. */
  readonly step?: number;
};

/** Horizontal irradiance of the sky outside the sun cone, and inside it. Luminance, in the texels' units. */
export type SkyIrradiance = { readonly horizontal: number; readonly residual: number };

/** IEEE 754 half-float bits to a number (no `Float16Array`: not every supported browser has it). */
function fromHalf(bits: number): number {
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  const sign = bits & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

function reader(data: Float32Array | Uint16Array): (index: number) => number {
  if (data instanceof Float32Array) return (index) => data[index]!;
  return (index) => fromHalf(data[index]!);
}

/**
 * Integrates the upper hemisphere of `texels` against `cos θ dω`, Rec. 709
 * luminance, split at the sun cone. One pass, every `step`-th texel each way.
 */
export function measureSkyIrradiance(texels: PanoramaTexels): SkyIrradiance {
  const { data, width, height, sun, coneDeg } = texels;
  const step = texels.step ?? 2;
  const read = reader(data);
  const cosCone = Math.cos(coneDeg * DEG);
  const dPhi = ((2 * Math.PI) / width) * step;
  const dTheta = (Math.PI / height) * step;
  let horizontal = 0;
  let residual = 0;
  for (let j = 0; j < height / 2; j += step) {
    // Centre of the block of `step` rows starting at `j`.
    const elevation = (0.5 - (j + step / 2) / height) * Math.PI;
    if (elevation <= 0) continue;
    const y = Math.sin(elevation);
    const ring = Math.cos(elevation);
    const weight = y * ring * dPhi * dTheta;
    const row = Math.min(height - 1, j + Math.floor(step / 2));
    for (let i = 0; i < width; i += step) {
      const column = Math.min(width - 1, i + Math.floor(step / 2));
      const phi = ((column + 0.5) / width - 0.5) * 2 * Math.PI;
      const x = ring * Math.cos(phi);
      const z = ring * Math.sin(phi);
      const at = (row * width + column) * 4;
      const luminance = 0.2126 * read(at) + 0.7152 * read(at + 1) + 0.0722 * read(at + 2);
      if (x * sun[0] + y * sun[1] + z * sun[2] >= cosCone) residual += luminance * weight;
      else horizontal += luminance * weight;
    }
  }
  return { horizontal, residual };
}

/** The analytic sun's normal irradiance; throws for a share of 1 or more. */
export function hdriSunNormalIrradiance(sky: SkyIrradiance, share: number, elevationDeg: number): number {
  if (!(share >= 0 && share < 1)) throw new LightingError('bad-options', `HDRI sun refused: share must be in [0, 1), got ${String(share)}`);
  const onHorizontal = (sky.horizontal * share) / (1 - share) - sky.residual;
  return Math.max(0, onHorizontal) / Math.sin(elevationDeg * DEG);
}

/** The `DirectionalLight` intensity for `colourLinear`: irradiance times gain over the colour's luminance. */
export function hdriSunIntensity(normalIrradiance: number, gain: number, colourLinear: Triple): number {
  const luminance = 0.2126 * colourLinear[0] + 0.7152 * colourLinear[1] + 0.0722 * colourLinear[2];
  return (normalIrradiance * gain) / luminance;
}
