import { describe, expect, test } from 'bun:test';
import { assignLampRoom, lampSignature, type LampEntry } from './lamp-rooms.js';
import type { VolumeRoom } from './room-volumes.js';

const rect = (roomId: string, x0: number, z0: number, x1: number, z1: number): VolumeRoom => ({
  roomId,
  halfWall: 0.05,
  polygon: [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ],
});

// An L-shaped room: a 4 x 2 bar and a 2 x 2 arm below its left half.
const L: VolumeRoom = {
  roomId: 'l',
  halfWall: 0.05,
  polygon: [
    { x: 8, z: 0 },
    { x: 12, z: 0 },
    { x: 12, z: 2 },
    { x: 10, z: 2 },
    { x: 10, z: 4 },
    { x: 8, z: 4 },
  ],
};
const ROOMS = [rect('a', 0, 0, 4, 4), rect('b', 4, 0, 8, 4), L];

describe('assignLampRoom', () => {
  test('a point inside one polygon answers that room’s index in the order', () => {
    expect(assignLampRoom({ x: 1, z: 1 }, ROOMS, ['b', 'a', 'l'])).toBe(1);
    expect(assignLampRoom({ x: 5, z: 1 }, ROOMS, ['b', 'a', 'l'])).toBe(0);
  });

  test('a point on a shared edge answers the room listed first, every time', () => {
    expect(assignLampRoom({ x: 4, z: 2 }, ROOMS, ['b', 'a', 'l'])).toBe(0);
    expect(assignLampRoom({ x: 4, z: 2 }, ROOMS, ['b', 'a', 'l'])).toBe(0);
    expect(assignLampRoom({ x: 4, z: 2 }, ROOMS, ['a', 'b', 'l'])).toBe(0);
  });

  test('a point in the arm of an L-shaped room answers that room', () => {
    expect(assignLampRoom({ x: 9, z: 3.5 }, ROOMS, ['a', 'b', 'l'])).toBe(2);
  });

  test('a point inside the polygon within the wall margin answers the room', () => {
    expect(assignLampRoom({ x: 0.03, z: 2 }, ROOMS, ['a', 'b', 'l'])).toBe(0);
  });

  test('a point 5 mm outside every polygon answers -1: no nearest room', () => {
    expect(assignLampRoom({ x: -0.005, z: 2 }, ROOMS, ['a', 'b', 'l'])).toBe(-1);
    expect(assignLampRoom({ x: 11, z: 3 }, ROOMS, ['a', 'b', 'l'])).toBe(-1);
  });

  test('a room missing from the order is skipped', () => {
    expect(assignLampRoom({ x: 1, z: 1 }, ROOMS, ['b'])).toBe(-1);
  });
});

describe('lampSignature', () => {
  const lamp = (over: Partial<LampEntry> = {}): LampEntry => ({
    id: 'one',
    position: [1, 1.2, 1],
    colour: [1, 0.8, 0.6],
    intensity: 1.2,
    distance: 3,
    decay: 2,
    ...over,
  });
  const base = lampSignature([lamp(), lamp({ id: 'two', position: [2, 1, 2] })]);

  test('changes on a 2 mm move, a colour or an intensity change, a removal and an addition', () => {
    expect(lampSignature([lamp({ position: [1.002, 1.2, 1] }), lamp({ id: 'two', position: [2, 1, 2] })])).not.toBe(base);
    expect(lampSignature([lamp({ colour: [1, 0.79, 0.6] }), lamp({ id: 'two', position: [2, 1, 2] })])).not.toBe(base);
    expect(lampSignature([lamp({ intensity: 1.3 }), lamp({ id: 'two', position: [2, 1, 2] })])).not.toBe(base);
    expect(lampSignature([lamp()])).not.toBe(base);
    expect(lampSignature([lamp(), lamp({ id: 'two', position: [2, 1, 2] }), lamp({ id: 'three' })])).not.toBe(base);
    expect(lampSignature([])).not.toBe(base);
  });

  test('does not change on a 0.4 mm move', () => {
    expect(lampSignature([lamp({ position: [1.0004, 1.2, 1] }), lamp({ id: 'two', position: [2, 1, 2] })])).toBe(base);
  });
});
