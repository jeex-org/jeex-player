import { describe, expect, test } from 'bun:test';
import { findFinish } from '../materials/finishes.js';
import { FINISH } from '../materials/finish-ids.js';
import { frameFinish } from '../materials/frame-finishes.js';
import {
  DOOR_VARIANTS,
  ENTRY_DOOR_VARIANTS,
  WINDOW_VARIANTS,
  defaultOpeningVariant,
  findOpeningVariant,
  openingVariantSwatchDataURL,
  variantsForOpening,
} from './opening-variants.js';

const ALL_SETS = [WINDOW_VARIANTS, DOOR_VARIANTS, ENTRY_DOOR_VARIANTS];

describe('opening variant catalogue', () => {
  test('exactly four window variants', () => {
    expect(WINDOW_VARIANTS.length).toBe(4);
  });

  test('exactly four interior door variants', () => {
    expect(DOOR_VARIANTS.length).toBe(4);
  });

  test('exactly four entrance door variants', () => {
    expect(ENTRY_DOOR_VARIANTS.length).toBe(4);
  });

  test('ids are unique across every set', () => {
    const ids = ALL_SETS.flat().map((variant) => variant.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every window variant is tagged for windows', () => {
    for (const variant of WINDOW_VARIANTS) expect(variant.for).toBe('window');
  });

  test('every door and entrance variant is tagged for doors', () => {
    for (const variant of [...DOOR_VARIANTS, ...ENTRY_DOOR_VARIANTS]) expect(variant.for).toBe('door');
  });

  test('entrance door variants carry the entrance tag; interior doors do not', () => {
    for (const variant of ENTRY_DOOR_VARIANTS) expect(variant.entrance).toBe(true);
    for (const variant of DOOR_VARIANTS) expect(variant.entrance).toBeFalsy();
  });

  test('every frame.material and leaf.material resolves against the finish catalogue', () => {
    for (const variant of ALL_SETS.flat()) {
      expect(findFinish(variant.frame.material) ?? frameFinish(variant.frame.material) ?? null).not.toBeNull();
      if (variant.leaf) expect(findFinish(variant.leaf.material) ?? frameFinish(variant.leaf.material) ?? null).not.toBeNull();
    }
  });

  test('window variants declare glazing and no leaf; door variants declare a leaf and no glazing', () => {
    for (const variant of WINDOW_VARIANTS) {
      expect(variant.glazing).toBeDefined();
      expect(variant.leaf).toBeUndefined();
    }
    for (const variant of [...DOOR_VARIANTS, ...ENTRY_DOOR_VARIANTS]) {
      expect(variant.leaf).toBeDefined();
      expect(variant.glazing).toBeUndefined();
    }
  });

  test('variantsForOpening returns the window set for windows', () => {
    expect(variantsForOpening('window')).toBe(WINDOW_VARIANTS);
  });

  test('variantsForOpening returns interior doors by default and entrance doors when asked', () => {
    expect(variantsForOpening('door')).toBe(DOOR_VARIANTS);
    expect(variantsForOpening('door', { entrance: false })).toBe(DOOR_VARIANTS);
    expect(variantsForOpening('door', { entrance: true })).toBe(ENTRY_DOOR_VARIANTS);
  });

  test('variantsForOpening ordering is deterministic across repeated calls', () => {
    const first = variantsForOpening('window').map((v) => v.id);
    const second = variantsForOpening('window').map((v) => v.id);
    expect(second).toEqual(first);
    const doorsFirst = variantsForOpening('door', { entrance: true }).map((v) => v.id);
    const doorsSecond = variantsForOpening('door', { entrance: true }).map((v) => v.id);
    expect(doorsSecond).toEqual(doorsFirst);
  });

  // The three sets are fixed-length literals in `opening-variants.ts`; their
  // lengths are asserted at the top of this file, so these indexes resolve.
  test('defaultOpeningVariant is always the first entry of the matching set', () => {
    expect(defaultOpeningVariant('window')).toBe(WINDOW_VARIANTS[0]!);
    expect(defaultOpeningVariant('door')).toBe(DOOR_VARIANTS[0]!);
    expect(defaultOpeningVariant('door', true)).toBe(ENTRY_DOOR_VARIANTS[0]!);
    expect(defaultOpeningVariant('door', false)).toBe(DOOR_VARIANTS[0]!);
  });

  test('findOpeningVariant looks up an id in any of the three sets', () => {
    expect(findOpeningVariant(WINDOW_VARIANTS[2]!.id)).toBe(WINDOW_VARIANTS[2]);
    expect(findOpeningVariant(DOOR_VARIANTS[1]!.id)).toBe(DOOR_VARIANTS[1]);
    expect(findOpeningVariant(ENTRY_DOOR_VARIANTS[3]!.id)).toBe(ENTRY_DOOR_VARIANTS[3]);
  });

  test('findOpeningVariant returns undefined for an unknown id', () => {
    expect(findOpeningVariant('does-not-exist')).toBeUndefined();
  });

  test('openingVariantSwatchDataURL returns null without a DOM (Bun has no document)', () => {
    expect(typeof document).toBe('undefined');
    for (const variant of ALL_SETS.flat()) {
      expect(openingVariantSwatchDataURL(variant)).toBeNull();
    }
  });
});

describe('graphite metal frames', () => {
  /** The graphite powder-coat frame finish (`FINISH.frame_graphite`). */
  const FRAME_GRAPHITE = '01a16f65-52cd-7066-8e5f-4ffbd54a7290';

  test('the four graphite frames and leaves take the powder-coat frame finish, never a room paint', () => {
    const all = [...WINDOW_VARIANTS, ...DOOR_VARIANTS, ...ENTRY_DOOR_VARIANTS];
    const framed = all.filter((variant) => variant.frame.material === FRAME_GRAPHITE);
    expect(framed.length).toBe(4);
    for (const variant of all) {
      expect(variant.frame.material).not.toBe(FINISH.graphite);
      if (variant.leaf) expect(variant.leaf.material).not.toBe(FINISH.graphite);
    }
  });
});
