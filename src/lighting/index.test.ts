/**
 * The `jeex-viewer/lighting` entry's value exports, pinned: a name added or
 * dropped here is a change of the published surface, which also moves
 * `scripts/lighting-entry-check.ts`'s consumer fixture.
 */

import { expect, test } from 'bun:test';
import * as entry from './index.js';

test('the lighting entry exports exactly the documented values', () => {
  expect(Object.keys(entry).sort()).toEqual([
    'LEGACY_SUN_DIRECTION',
    'LIGHTING_ERROR_CODES',
    'LIGHTING_STANDARD',
    'LIGHTING_STANDARD_VERSION',
    'LightingError',
    'colourTemperatureRgb',
    'createLightingContext',
    'fitShadowFrustum',
    'isLightTemperature',
    'sunDirection',
  ]);
});
