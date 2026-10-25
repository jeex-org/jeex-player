import { describe, expect, test } from 'bun:test';
import { hdriTarget } from './hdri-wiring.js';
import type { HdriEntry } from '../lighting/hdri-entry.js';

const entry = (name: string): HdriEntry => ({
  environmentUrl: `https://cdn.example.test/${name}.jpg`,
  skyUrl: `https://cdn.example.test/${name}.avif`,
  sun: { azimuthDeg: 54, elevationDeg: 43, colourLinear: [1, 0.94, 0.87], horizontalIrradianceShare: 0.78 },
});
const noon = entry('noon');
const evening = entry('evening');
const DEG = Math.PI / 180;

describe('hdriTarget', () => {
  test('a scene without a site has no preset: nothing to show', () => {
    expect(hdriTarget({ noon, evening }, undefined, 'off')).toBeNull();
  });

  test('a site without a sun reads as noon', () => {
    expect(hdriTarget({ noon }, {}, 'off')?.entry).toBe(noon);
  });

  test('a preset without an entry has nothing, and never borrows another preset’s', () => {
    expect(hdriTarget({ noon }, { sun: 'evening' }, 'off')).toBeNull();
    expect(hdriTarget({ noon, evening }, { sun: 'evening' }, 'off')?.entry).toBe(evening);
  });

  test('the view: rotation from north, preset and stored azimuth; the stored elevation and colour', () => {
    const target = hdriTarget({ noon }, { northDeg: 30, sun: 'noon' }, 'off')!;
    expect(target.view.rotationY).toBeCloseTo((30 + 180 - 54) * DEG, 12);
    expect(target.view.elevationDeg).toBe(43);
    expect(target.view.colourLinear).toEqual([1, 0.94, 0.87]);
    expect(target.preset).toBe('noon');
  });

  test('the light bake decides the mode: pending holds, applied shows the sky only, anything else lights in full', () => {
    expect(hdriTarget({ noon }, {}, 'waiting')?.mode).toBe('hold');
    expect(hdriTarget({ noon }, {}, 'loading')?.mode).toBe('hold');
    expect(hdriTarget({ noon }, {}, 'applied')?.mode).toBe('sky-only');
    for (const state of ['off', 'refused', 'dropped'] as const) expect(hdriTarget({ noon }, {}, state)?.mode).toBe('full');
  });
});
