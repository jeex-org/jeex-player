/**
 * The sun's direction from a scene's orientation: the preset angles, the north
 * rotation, the legacy default, and the world azimuth and elevation later
 * lighting reads.
 */

import { describe, expect, test } from 'bun:test';
import { LightingError } from './lighting-error.js';
import { LIGHTING_STANDARD } from './lighting-standard.js';
import { LEGACY_SUN_DIRECTION, sunDirection } from './sun-direction.js';

const DEG = Math.PI / 180;

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
}

describe('sunDirection', () => {
  test('noon with north along +Z points to world azimuth 180 (towards -Z) at 55 degrees', () => {
    const sun = sunDirection({ northDeg: 0, sun: 'noon' });
    expect(sun.azimuth).toBeCloseTo(180, 9);
    expect(sun.elevation).toBeCloseTo(55, 9);
    expectClose(sun.direction, [0, Math.sin(55 * DEG), -Math.cos(55 * DEG)]);
  });

  test('north 90 rotates a morning sun to world azimuth 180 at 20 degrees', () => {
    const sun = sunDirection({ northDeg: 90, sun: 'morning' });
    expect(sun.azimuth).toBeCloseTo(180, 9);
    expect(sun.elevation).toBeCloseTo(20, 9);
  });

  test('an evening sun with north 0 shines from world azimuth 270 at 20 degrees', () => {
    const sun = sunDirection({ northDeg: 0, sun: 'evening' });
    expect(sun.azimuth).toBeCloseTo(270, 9);
    expect(sun.elevation).toBeCloseTo(20, 9);
    expectClose(sun.direction, [-Math.cos(20 * DEG), Math.sin(20 * DEG), 0]);
  });

  test('the direction is [sin W cos E, sin E, cos W cos E] for W = north + azimuth', () => {
    for (const northDeg of [0, 30, 145.5, -60]) {
      for (const name of ['morning', 'noon', 'evening'] as const) {
        const preset = LIGHTING_STANDARD.apartment.sun.presets[name];
        const w = (northDeg + preset.azimuth) * DEG;
        const e = preset.elevation * DEG;
        expectClose(sunDirection({ northDeg, sun: name }).direction, [Math.sin(w) * Math.cos(e), Math.sin(e), Math.cos(w) * Math.cos(e)]);
      }
    }
  });

  test('north is read modulo 360, and the world azimuth is in [0, 360)', () => {
    const a = sunDirection({ northDeg: 30, sun: 'evening' });
    const b = sunDirection({ northDeg: 390, sun: 'evening' });
    const c = sunDirection({ northDeg: -330, sun: 'evening' });
    expectClose(b.direction, a.direction);
    expectClose(c.direction, a.direction);
    for (const sun of [a, b, c]) {
      expect(sun.azimuth).toBeGreaterThanOrEqual(0);
      expect(sun.azimuth).toBeLessThan(360);
      expect(sun.azimuth).toBeCloseTo(300, 9);
    }
  });

  test('a site without north reads north 0, and without a preset reads noon', () => {
    expectClose(sunDirection({}).direction, sunDirection({ northDeg: 0, sun: 'noon' }).direction);
    expectClose(sunDirection({ sun: 'morning' }).direction, sunDirection({ northDeg: 0, sun: 'morning' }).direction);
    expectClose(sunDirection({ northDeg: 45 }).direction, sunDirection({ northDeg: 45, sun: 'noon' }).direction);
  });

  test('no orientation is the normalised legacy direction [4.5, 15.5, -11.5]', () => {
    const length = Math.hypot(4.5, 15.5, -11.5);
    expectClose(LEGACY_SUN_DIRECTION, [4.5 / length, 15.5 / length, -11.5 / length]);
    for (const site of [undefined, null]) {
      const sun = sunDirection(site);
      expectClose(sun.direction, LEGACY_SUN_DIRECTION);
      expect(sun.elevation).toBeCloseTo(Math.asin(15.5 / length) / DEG, 9);
      expect(sun.azimuth).toBeCloseTo((Math.atan2(4.5, -11.5) / DEG + 360) % 360, 9);
    }
  });

  test('the legacy direction is the one the standard position and target spell', () => {
    const { position, target } = LIGHTING_STANDARD.apartment.sun;
    const raw = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
    const length = Math.hypot(...raw);
    expectClose(
      LEGACY_SUN_DIRECTION,
      raw.map((value) => value / length),
    );
  });

  test('every direction is a unit vector pointing up', () => {
    for (const northDeg of [0, 77, 200, 359]) {
      for (const name of ['morning', 'noon', 'evening'] as const) {
        const { direction } = sunDirection({ northDeg, sun: name });
        expect(Math.hypot(...direction)).toBeCloseTo(1, 12);
        expect(direction[1]).toBeGreaterThan(0);
      }
    }
  });

  test('a non-finite north or an unknown preset is refused as bad-options', () => {
    for (const site of [{ northDeg: Number.NaN }, { northDeg: Number.POSITIVE_INFINITY }, { sun: 'night' }]) {
      let caught: unknown;
      try {
        sunDirection(site as never);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LightingError);
      expect((caught as LightingError).code).toBe('bad-options');
    }
  });
});
