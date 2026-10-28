/** The demo's interior presets dress the flat in current finishes only, named after their palettes. */

import { describe, expect, test } from 'bun:test';
import { demoInteriors } from './demo-interiors.js';
import { RETIRED_FINISHES } from '../materials/finish-catalogue.js';
import { FINISH } from '../materials/finish-ids.js';

describe('demo interior presets', () => {
  test('name no retired finish, in their swatches or their operations', () => {
    const retired = new Set(RETIRED_FINISHES.map((finish) => finish.id));
    const named = demoInteriors.flatMap((preset) => [
      ...preset.swatch,
      ...preset.ops.flatMap((op) => ('material' in op && typeof op.material === 'string' ? [op.material] : [])),
    ]);
    expect(named.filter((id) => retired.has(id))).toEqual([]);
  });

  test('are named after their palettes', () => {
    expect(demoInteriors.map((preset) => preset.name)).toEqual([
      'Oak and white',
      'Chalk and herringbone',
      'Walnut and terracotta',
      'Sage and mocha',
    ]);
    expect(demoInteriors[1]?.swatch).toEqual([FINISH.herringbone, FINISH.white]);
  });
});
