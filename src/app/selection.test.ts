/**
 * The click recogniser and the `ViewerSelection` it builds — the two halves of
 * `selection.ts` that need neither a document nor a GPU. The DOM half lives in
 * `tests/component/selection.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { faceKey } from '../scene/types.js';
import { SELECT_MAX_DURATION_MS, SELECT_MAX_MOVE_PX, SELECT_MODES, isSelectClick, selectionFrom } from './selection.js';

const DOWN = { x: 100, y: 100, at: 1000, pointerId: 1 };

/** The ids the picks carry: fixed UUID v7 literals, named for what they stand for. */
const ID = {
  kitchen: '01a12ffd-0e9a-7779-bc0e-b01202ace5e1',
  living: '01a12ffd-0e9b-79f6-bddd-6620eb9fa5ff',
  w1: '01a12ffd-0e9c-7f03-a8c3-5f4d7dedc510',
  door1: '01a12ffd-0e9d-7637-80a6-0f5e8b35dc29',
  sofa1: '01a12ffd-0e9e-7476-a694-027fd79ebb67',
} as const;
const KITCHEN_W1 = faceKey(ID.kitchen, ID.w1, 'L');

describe('isSelectClick', () => {
  test('a still, short press is a click', () => {
    expect(isSelectClick(DOWN, { x: 102, y: 101, at: 1080 })).toBe(true);
  });

  test('a press that travelled 5 px or more is a drag', () => {
    expect(isSelectClick(DOWN, { x: 100 + SELECT_MAX_MOVE_PX, y: 100, at: 1080 })).toBe(false);
  });

  test('a press held 300 ms or longer is not a click', () => {
    expect(isSelectClick(DOWN, { x: 100, y: 100, at: 1000 + SELECT_MAX_DURATION_MS })).toBe(false);
  });
});

describe('selectionFrom', () => {
  test('a wall carries its id, wall id, room and face', () => {
    expect(selectionFrom({ surface: 'wall', roomId: ID.kitchen, face: KITCHEN_W1, wallId: ID.w1 }, { x: 1.5, z: 2.5 }, 'plan2d')).toEqual({
      kind: 'wall',
      id: ID.w1,
      wallId: ID.w1,
      roomId: ID.kitchen,
      face: KITCHEN_W1,
      point: { x: 1.5, z: 2.5 },
      mode: 'plan2d',
    });
  });

  test('an opening names itself and the wall it hangs on', () => {
    expect(selectionFrom({ surface: 'opening', openingId: ID.door1, wallId: ID.w1 }, { x: 0, z: 0 }, 'orbit')).toEqual({
      kind: 'opening',
      id: ID.door1,
      wallId: ID.w1,
      point: { x: 0, z: 0 },
      mode: 'orbit',
    });
  });

  test('a floor is a room selection', () => {
    expect(selectionFrom({ surface: 'floor', roomId: ID.living }, { x: 3, z: 4 }, 'plan3d')).toEqual({
      kind: 'room',
      id: ID.living,
      roomId: ID.living,
      point: { x: 3, z: 4 },
      mode: 'plan3d',
    });
  });

  test('furniture names its placement id', () => {
    expect(selectionFrom({ surface: 'furniture', assetId: ID.sofa1 }, { x: 1, z: 1 }, 'orbit')).toEqual({
      kind: 'furniture',
      id: ID.sofa1,
      point: { x: 1, z: 1 },
      mode: 'orbit',
    });
  });

  test('a wall whose mesh carries no id is still a wall, without one', () => {
    expect(selectionFrom({ surface: 'wall' }, { x: 0, z: 0 }, 'orbit').id).toBeUndefined();
  });
});

describe('SELECT_MODES', () => {
  test('is exactly the three selectable modes', () => {
    expect([...SELECT_MODES].sort()).toEqual(['orbit', 'plan2d', 'plan3d']);
  });
});
