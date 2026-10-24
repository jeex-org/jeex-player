/**
 * The standard as data and its environment recipe: frozen at every depth,
 * colourless, deterministic, and calibrated by integration — the cosine-weighted
 * irradiance of the recipe on the key-facing normal, scaled by the frozen
 * normalisation, plus the white key, brings a 0.18 Lambert patch to the
 * calibration target through PBR Neutral.
 *
 * The browser half of the calibration is
 * `tests/component/lighting-calibration.test.ts`: three's prefiltered
 * environment is an approximation of the cosine integral, and the frozen
 * constant is the one the rendered patch confirms. This test pins how far the
 * analytic figure may sit from it.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { environmentIrradiance, environmentRadiance, generateEnvironment, toHalfFloats } from './environment-recipe.js';
import { LIGHTING_STANDARD, LIGHTING_STANDARD_VERSION } from './lighting-standard.js';

const RECIPE = LIGHTING_STANDARD.environment.recipe;

/** PBR Neutral of a grey value, as three's `NeutralToneMapping` computes it below its compression knee. */
function neutral(value: number): number {
  const offset = value < 0.08 ? value - 6.25 * value * value : 0.04;
  return value - offset;
}

describe('LIGHTING_STANDARD', () => {
  test('is version 1 and frozen at every depth', () => {
    // The sun presets, the fit tuning and the sun API change no existing rig value.
    expect(LIGHTING_STANDARD_VERSION).toBe(1);
    const walk = (value: unknown, path: string): void => {
      if (typeof value !== 'object' || value === null) return;
      expect({ path, frozen: Object.isFrozen(value) }).toEqual({ path, frozen: true });
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    };
    walk(LIGHTING_STANDARD, 'LIGHTING_STANDARD');
  });

  test('the baked-interior gains are positive numbers, one per mode', () => {
    const { editing, walk } = LIGHTING_STANDARD.baked.exposure;
    expect(Object.keys(LIGHTING_STANDARD.baked.exposure).sort()).toEqual(['editing', 'walk']);
    for (const gain of [editing, walk]) expect(Number.isFinite(gain) && gain > 0).toBe(true);
  });

  test('publishes the HDRI calibration values as positive numbers, with the recipe untouched', () => {
    const hdri = LIGHTING_STANDARD.hdri;
    expect(Object.keys(hdri).sort()).toEqual(['environmentGain', 'loaderCompensation', 'skyBrightness', 'sunConeDeg']);
    for (const value of Object.values(hdri)) expect(Number.isFinite(value) && value > 0).toBe(true);
    expect(Object.isFrozen(hdri)).toBe(true);
    // The recipe's own values are those the standard was frozen with.
    expect(LIGHTING_STANDARD.environment.normalisation).toBe(0.543);
    expect(LIGHTING_STANDARD.apartment.environmentScale).toBe(1.8);
    expect(LIGHTING_STANDARD.apartment.sun.intensity).toBe(3);
    expect(LIGHTING_STANDARD_VERSION).toBe(1);
  });

  test('a write at any depth changes nothing', () => {
    const before = JSON.stringify(LIGHTING_STANDARD);
    const write = (run: () => void): void => {
      try {
        run();
      } catch {
        // Strict mode throws on a frozen object; either way the value stays.
      }
    };
    write(() => ((LIGHTING_STANDARD as { engineRevision: string }).engineRevision = '185'));
    write(() => ((LIGHTING_STANDARD.apartment.sun as { intensity: number }).intensity = 99));
    write(() => ((LIGHTING_STANDARD.apartment.sun.position as unknown as number[])[0] = 99));
    write(() => ((RECIPE.panels[0] as { radiance: number }).radiance = 99));
    write(() => ((LIGHTING_STANDARD.apartment.sun.presets.noon as { elevation: number }).elevation = 99));
    write(() => ((LIGHTING_STANDARD.apartment.sun.fit as { depthPadding: number }).depthPadding = 99));
    expect(JSON.stringify(LIGHTING_STANDARD)).toBe(before);
  });

  test('publishes the three sun presets with exactly their angles', () => {
    expect(LIGHTING_STANDARD.apartment.sun.presets).toEqual({
      morning: { azimuth: 90, elevation: 20 },
      noon: { azimuth: 180, elevation: 55 },
      evening: { azimuth: 270, elevation: 20 },
    });
  });

  test('publishes the shadow fit tuning', () => {
    expect(LIGHTING_STANDARD.apartment.sun.fit).toEqual({
      lateralPadding: 0.25,
      depthPadding: 0.5,
      minNear: 0.1,
      depthOffset: 0.002,
      normalBiasTexels: 0.5,
      normalBiasMin: 0.002,
      normalBiasMax: 0.02,
    });
  });

  test('the engine revision is the one this repository builds with', () => {
    expect(LIGHTING_STANDARD.engineRevision).toBe(THREE.REVISION);
  });
});

describe('the environment recipe', () => {
  test('is colourless: every texel has equal red, green and blue, and alpha 1', () => {
    const data = generateEnvironment(RECIPE);
    expect(data.length).toBe(RECIPE.width * RECIPE.height * 4);
    let coloured = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] !== data[at + 1] || data[at] !== data[at + 2] || data[at + 3] !== 1) coloured += 1;
    }
    expect(coloured).toBe(0);
  });

  test('is deterministic', () => {
    expect(generateEnvironment(RECIPE)).toEqual(generateEnvironment(RECIPE));
  });

  test('is brighter above the horizon than below, with the panels brightest', () => {
    expect(environmentRadiance(RECIPE, 0, 89)).toBeGreaterThan(environmentRadiance(RECIPE, 0, -89));
    const panel = RECIPE.panels[0]!;
    expect(environmentRadiance(RECIPE, panel.azimuth, panel.elevation)).toBeGreaterThan(RECIPE.zenith);
  });

  test('row 0 is the bottom of the sphere, as three samples an unflipped DataTexture', () => {
    const data = generateEnvironment(RECIPE);
    const top = (RECIPE.height - 1) * RECIPE.width * 4;
    expect(data[0]).toBeLessThan(data[top]!);
  });

  test('half floats round to nearest: never further from the value than three.js DataUtils, which truncates', () => {
    const samples = new Float32Array([0, 0.18, 0.62, 1, 4.6, 6.1e-5, 1e-8, 65_504, 1e6, -2.5]);
    const ours = toHalfFloats(samples);
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index]!;
      const mine = Math.abs(THREE.DataUtils.fromHalfFloat(ours[index]!) - value);
      const theirs = Math.abs(THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(value)) - value);
      expect({ value, closer: mine <= theirs }).toEqual({ value, closer: true });
      // And within one unit in the last place of each other.
      expect(Math.abs(ours[index]! - THREE.DataUtils.toHalfFloat(value))).toBeLessThanOrEqual(1);
    }
  });
});

describe('calibration by integration', () => {
  const { albedo, target } = LIGHTING_STANDARD.calibration;
  const { key } = LIGHTING_STANDARD.reference;

  /** The linear value a Lambert patch of `albedo` facing the key reads after PBR Neutral. */
  function patchReading(normalisation: number): number {
    const environment = normalisation * environmentIrradiance(RECIPE, key.position);
    const radiance = (albedo * (environment + key.intensity)) / Math.PI;
    return neutral(radiance * LIGHTING_STANDARD.display.exposure);
  }

  test('the frozen normalisation stays within 15 % of the analytic figure', () => {
    // The rendered patch decides the frozen constant, and it sits below the
    // cosine integral's figure: three adds the specular of a rough dielectric
    // (F0 0.04) on top of the Lambert term and prefilters the environment with
    // a GGX lobe rather than a cosine one. Measured when the standard was
    // frozen: analytic normalisation 0.620, rendered 0.543, so the analytic
    // reading at the frozen constant is 0.160 against the rendered 0.181. The
    // browser test holds ±2 %; this keeps the two halves from drifting apart.
    const reading = patchReading(LIGHTING_STANDARD.environment.normalisation);
    expect(Math.abs(reading - target) / target).toBeLessThan(0.15);
  });
});
