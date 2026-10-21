import { describe, expect, test } from 'bun:test';
import { roomOf } from './plan-rooms.js';
import { solvePlan } from './plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';

describe('roomOf', () => {
  const plan = solvePlan(lShapePlan);

  test('a point inside a room names it, a point outside every room names none', () => {
    for (const room of plan.rooms) {
      const box = room.bbox;
      const inside = roomOf(plan, {
        x: room.polygon.reduce((sum, p) => sum + p.x, 0) / room.polygon.length,
        z: room.polygon.reduce((sum, p) => sum + p.z, 0) / room.polygon.length,
      });
      expect({ room: room.roomId, inside }).toEqual({ room: room.roomId, inside: room.roomId });
      expect(roomOf(plan, { x: box.maxX + 100, z: box.maxZ + 100 })).toBeNull();
    }
  });
});
