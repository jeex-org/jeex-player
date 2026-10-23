/**
 * Where the apartment's sun shines from: a scene's orientation and sun preset
 * turned into a unit direction in world axes.
 *
 * Conventions: `northDeg` is the world azimuth of true north, degrees
 * clockwise seen from above, from `+z` towards `+x`, read modulo 360. A preset
 * names an azimuth from north (same sense) and an elevation above the horizon.
 * For `W = northDeg + azimuth` and elevation `E` the direction TOWARDS the sun
 * is `[sin W cos E, sin E, cos W cos E]`. The world azimuth returned is `W` in
 * `[0, 360)`; three's equirectangular environment measures azimuth as
 * `atan2(z, x)`, which for the same direction is `90 - W`.
 *
 * With no orientation at all the sun keeps the direction the standard's
 * position and target have always spelt (the legacy direction), so a scene
 * that says nothing about its site looks as it did.
 *
 * Pure module: no `three`, no DOM.
 */

import { LightingError } from './lighting-error.js';
import { LIGHTING_STANDARD, type Triple } from './lighting-standard.js';

const DEG = Math.PI / 180;

/** The sun presets the standard publishes. */
export type SunPresetName = keyof typeof LIGHTING_STANDARD.apartment.sun.presets;

/** A scene's orientation: true north's world azimuth and the sun preset, both optional. */
export type SunOrientation = { readonly northDeg?: number | undefined; readonly sun?: SunPresetName | undefined };

/** A sun direction and its angles in world axes. */
export type SunDirection = {
  /** Unit vector from the scene towards the sun. */
  readonly direction: Triple;
  /** World azimuth, degrees clockwise from `+z` towards `+x`, in `[0, 360)`. */
  readonly azimuth: number;
  /** Elevation above the horizon, degrees. */
  readonly elevation: number;
};

function legacyDirection(): Triple {
  const { position, target } = LIGHTING_STANDARD.apartment.sun;
  const x = position[0] - target[0];
  const y = position[1] - target[1];
  const z = position[2] - target[2];
  const length = Math.hypot(x, y, z);
  return Object.freeze([x / length, y / length, z / length]) as Triple;
}

/** The direction of a scene without orientation: the standard's position minus its target, normalised. */
export const LEGACY_SUN_DIRECTION: Triple = legacyDirection();

function wrapDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Angles of a unit direction: world azimuth in `[0, 360)` and elevation, degrees. */
function anglesOf(direction: Triple): { azimuth: number; elevation: number } {
  return {
    azimuth: wrapDegrees(Math.atan2(direction[0], direction[2]) / DEG),
    elevation: Math.asin(Math.min(1, Math.max(-1, direction[1]))) / DEG,
  };
}

/**
 * The sun for `orientation`: the legacy direction when it is absent, otherwise
 * the preset (default `noon`) rotated by its north (default 0).
 *
 * Throws `LightingError` `bad-options` for a non-finite north or a preset the
 * standard does not publish.
 */
export function sunDirection(orientation?: SunOrientation | null): SunDirection {
  if (orientation === undefined || orientation === null) return { direction: LEGACY_SUN_DIRECTION, ...anglesOf(LEGACY_SUN_DIRECTION) };
  const northDeg = orientation.northDeg ?? 0;
  if (typeof northDeg !== 'number' || !Number.isFinite(northDeg)) {
    throw new LightingError('bad-options', `sun direction refused: northDeg must be a finite number, got ${String(northDeg)}`);
  }
  const name = orientation.sun ?? 'noon';
  const presets: Readonly<Record<string, { azimuth: number; elevation: number }>> = LIGHTING_STANDARD.apartment.sun.presets;
  const preset = Object.hasOwn(presets, name) ? presets[name] : undefined;
  if (preset === undefined) {
    throw new LightingError('bad-options', `sun direction refused: ${JSON.stringify(name)} is not a sun preset`);
  }
  const azimuth = wrapDegrees(northDeg + preset.azimuth);
  const w = azimuth * DEG;
  const e = preset.elevation * DEG;
  const direction = Object.freeze([Math.sin(w) * Math.cos(e), Math.sin(e), Math.cos(w) * Math.cos(e)]) as Triple;
  return { direction, azimuth, elevation: preset.elevation };
}
