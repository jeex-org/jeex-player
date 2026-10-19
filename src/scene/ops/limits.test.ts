/**
 * The clamps of the operation vocabulary, pinned to their documented numbers.
 *
 * A constant table is only worth having if changing a number is a deliberate
 * act, so each one is asserted against its literal here and against the
 * document schema where the schema already owns it. The rest of the vocabulary
 * reads these rather than spelling a number into an applier.
 */

import { describe, expect, test } from 'bun:test';
import { WALL_LIMITS } from '../types.js';
import {
  MAX_CEILING_HEIGHT,
  MIN_CEILING_HEIGHT,
  MIN_WALL_LENGTH,
  OBJECT_SCALE,
  ROOM_NAME_MAX,
  TOUR_SPEED,
  WALL_THICKNESS,
} from './limits.js';

describe('op limits', () => {
  test('are the documented numbers', () => {
    expect([MIN_CEILING_HEIGHT, MAX_CEILING_HEIGHT]).toEqual([2.2, 4.5]);
    expect(MIN_WALL_LENGTH).toBe(0.5);
    expect(WALL_THICKNESS).toEqual([0.05, 0.6]);
    expect(ROOM_NAME_MAX).toBe(60);
    expect(OBJECT_SCALE).toEqual([0.5, 2]);
    expect(TOUR_SPEED).toEqual([0.3, 3]);
  });

  test('the wall thickness clamp IS the document schema, not a copy of it', () => {
    expect(WALL_THICKNESS).toEqual([WALL_LIMITS.minThickness, WALL_LIMITS.maxThickness]);
  });

  test('the minimum wall length IS the document schema, not a second number', () => {
    // `move_node` refuses at exactly the length `validateScene` refuses at, so
    // no edit can apply and then lose its batch at commit.
    expect(MIN_WALL_LENGTH).toBe(WALL_LIMITS.minCentrelineLength);
  });
});
