/**
 * Mirroring: the canonical state, the facts of the bundled bank, and `frontOf`,
 * the one reader of the `z` axis.
 */

import { describe, expect, test } from 'bun:test';
import { listCatalogueObjects } from '../assets/asset-catalogue.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { lintItemOf, shippedFacts } from '../layout/layout-lint.js';
import { solvePlan } from '../plan/plan-solver.js';
import {
  allowedMirrorAxes,
  disallowedMirrorAxes,
  frontOf,
  mirroredAxes,
  mirroredSide,
  mirrorOf,
  sameMirror,
  toggleMirror,
} from './mirror.js';

describe('mirror state', () => {
  test('is canonical: axes in x, y, z order, never a false key, {} for none', () => {
    expect(mirrorOf(['z', 'x'])).toEqual({ x: true, z: true });
    expect(toggleMirror({ x: true }, 'x')).toEqual({});
    expect(toggleMirror(undefined, 'y')).toEqual({ y: true });
    expect(mirroredAxes({ z: true, x: true })).toEqual(['x', 'z']);
    expect(sameMirror(undefined, {})).toBe(true);
    expect(sameMirror({ x: true }, { z: true })).toBe(false);
  });

  test('absent facts allow nothing; a state is judged axis by axis', () => {
    expect(allowedMirrorAxes(undefined)).toEqual([]);
    expect(allowedMirrorAxes({ x: true, y: false, z: true })).toEqual(['x', 'z']);
    expect(disallowedMirrorAxes({ x: true, y: true }, { x: true, y: false, z: false })).toEqual(['y']);
    expect(disallowedMirrorAxes({}, undefined)).toEqual([]);
  });

  test('frontOf: a z mirror turns the front round, x and y do not', () => {
    const plain = frontOf(0, undefined);
    expect(plain.x).toBeCloseTo(0);
    expect(plain.z).toBeCloseTo(-1);
    expect(frontOf(0, { z: true }).z).toBeCloseTo(1);
    expect(frontOf(0, { x: true, y: true }).z).toBeCloseTo(-1);
  });

  test('a mirror swaps kneeSpace sides: x left and right, z front and back', () => {
    expect(mirroredSide('left', { x: true })).toBe('right');
    expect(mirroredSide('front', { x: true })).toBe('front');
    expect(mirroredSide('front', { z: true })).toBe('back');
    expect(mirroredSide('right', { y: true })).toBe('right');
  });
});

describe('the bundled bank states its mirror facts', () => {
  const objects = listCatalogueObjects();

  test('every archetype carries all three axes', () => {
    for (const object of objects)
      expect({ slug: object.slug, keys: Object.keys(object.mirror ?? {}).sort() }).toEqual({ slug: object.slug, keys: ['x', 'y', 'z'] });
  });

  test('wall pieces never allow z: they would face the wall', () => {
    for (const object of objects.filter((candidate) => candidate.anchor === 'wall'))
      expect({ slug: object.slug, z: object.mirror?.z }).toEqual({ slug: object.slug, z: false });
  });

  test('screens and appliances with a visible front allow nothing', () => {
    for (const slug of ['tv_unit', 'cooker', 'hood_extractor', 'fridge_tall']) {
      expect({ slug, axes: allowedMirrorAxes(objects.find((object) => object.slug === slug)?.mirror) }).toEqual({ slug, axes: [] });
    }
  });
});

describe('the linter reads the front through frontOf', () => {
  test('a z-mirrored placement faces the other way, its footprint unchanged', () => {
    const plan = solvePlan(lShapePlan);
    const placement = lShapePlan.assets.find((asset) => asset.id === L_SHAPE.asset.table)!;
    const facts = shippedFacts(placement)!;
    const plain = lintItemOf(placement, facts, plan, lShapePlan.ceilingHeight);
    const turned = lintItemOf({ ...placement, mirror: { z: true } }, facts, plan, lShapePlan.ceilingHeight);
    expect(turned.front.x).toBeCloseTo(-plain.front.x);
    expect(turned.front.z).toBeCloseTo(-plain.front.z);
    expect(turned.box).toEqual(plain.box);
    expect(facts.mirror).toEqual({ x: true, y: false, z: true });
  });
});
