/**
 * The apartment rig's option boundary: every refused size and unknown key is a
 * verdict that names the option, and the accepted shapes pass unchanged.
 */

import { describe, expect, test } from 'bun:test';
import { judgeApartmentRigOptions } from './lighting-options.schema.js';

describe('judgeApartmentRigOptions', () => {
  test('accepts no options, an empty object and every power of two from 256 to 4096', () => {
    expect(judgeApartmentRigOptions(undefined)).toEqual({ ok: true, value: {} });
    expect(judgeApartmentRigOptions({})).toEqual({ ok: true, value: {} });
    for (const size of [256, 512, 1024, 2048, 4096]) {
      expect(judgeApartmentRigOptions({ shadowMapSize: size })).toEqual({ ok: true, value: { shadowMapSize: size } });
    }
  });

  test('refuses every other size, naming the option', () => {
    for (const size of [0, 128, 1000, 8192, 2048.5, Number.NaN, Number.POSITIVE_INFINITY, -2048, '2048', null]) {
      const verdict = judgeApartmentRigOptions({ shadowMapSize: size });
      expect({ size, ok: verdict.ok }).toEqual({ size, ok: false });
      if (!verdict.ok) expect(verdict.message).toContain('shadowMapSize');
    }
  });

  test('refuses an unknown key, naming it, and anything that is not an object', () => {
    const verdict = judgeApartmentRigOptions({ shadowMapSize: 2048, sunIntensity: 9 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain('sunIntensity');
    for (const input of [null, 5, 'big', [2048]]) expect(judgeApartmentRigOptions(input).ok).toBe(false);
  });
});
