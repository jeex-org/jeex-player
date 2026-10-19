/**
 * Knee-space sides under a mirror:
 * sides are authored in the builder frame and move with the object, an `x`
 * mirror swapping left and right, a `z` mirror front and back.
 */

import { describe, expect, test } from 'bun:test';
import { DEMO } from '../../demo/demo-ids.js';
import { apartmentScene } from '../../demo/scene-data.js';
import { solvePlan } from '../../plan/plan-solver.js';
import { lintContext } from '../layout-lint.js';
import { sideNormal } from './surfaces.js';
import type { LintItem } from './context.js';
import type { Mirror } from '../../scene/types.js';

const table = lintContext(apartmentScene, solvePlan(apartmentScene)).items.find((item) => item.placement.id === DEMO.asset.livingTable)!;

function mirrored(mirror: Mirror): LintItem {
  const front = mirror.z ? { x: -table.front.x, z: -table.front.z } : table.front;
  return { ...table, front, placement: { ...table.placement, mirror } };
}

describe('sideNormal', () => {
  test('unmirrored: front is the way the object faces, right a quarter turn from it', () => {
    expect(sideNormal(table, 'front')).toEqual(table.front);
    expect(sideNormal(table, 'right')).toEqual({ x: -table.front.z, z: table.front.x });
  });

  test('an x mirror swaps left and right and keeps the front', () => {
    const item = mirrored({ x: true });
    expect(sideNormal(item, 'left')).toEqual(sideNormal(table, 'right'));
    expect(sideNormal(item, 'front')).toEqual(sideNormal(table, 'front'));
  });

  test('a z mirror sends the authored front to where the back was, which is where the mirrored object now faces', () => {
    const item = mirrored({ z: true });
    expect(sideNormal(item, 'front')).toEqual(sideNormal(table, 'back'));
    expect(sideNormal(item, 'front')).toEqual(item.front);
    expect(sideNormal(item, 'right')).toEqual(sideNormal(table, 'right'));
  });
});
