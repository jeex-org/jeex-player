import { describe, expect, test } from 'bun:test';
import { probePoint, rectilinearBoxes, roomOrder, roomVolumes, type VolumeInput } from './room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';

const square = (x0: number, z0: number, x1: number, z1: number) => [
  { x: x0, z: z0 },
  { x: x1, z: z0 },
  { x: x1, z: z1 },
  { x: x0, z: z1 },
];

/** An L: 6 x 3 along the bottom, 3 x 3 on top of its left half. */
const L_ROOM = [
  { x: 0, z: 0 },
  { x: 6, z: 0 },
  { x: 6, z: 3 },
  { x: 3, z: 3 },
  { x: 3, z: 6 },
  { x: 0, z: 6 },
];

describe('rectilinearBoxes', () => {
  test('a rectangle with a collinear vertex is one box', () => {
    const polygon = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];
    expect(rectilinearBoxes(polygon)).toEqual([{ minX: 0, maxX: 4, minZ: 0, maxZ: 3 }]);
  });

  test('an L splits into two boxes that cover it exactly', () => {
    const boxes = rectilinearBoxes(L_ROOM);
    expect(boxes).toHaveLength(2);
    const area = boxes.reduce((sum, b) => sum + (b.maxX - b.minX) * (b.maxZ - b.minZ), 0);
    expect(area).toBeCloseTo(27, 6);
  });

  test('a curved bay is covered by the bounding rectangle of its arc', () => {
    // A 4 x 3 room with a half-disc bay of radius 1 on its far side, chorded.
    const arc = Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI - (i * Math.PI) / 8;
      return { x: 2 + Math.cos(a) * 1, z: 3 + Math.sin(a) * 1 };
    });
    const polygon = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, ...arc.reverse(), { x: 0, z: 3 }];
    const boxes = rectilinearBoxes(polygon);
    expect(boxes).toContainEqual({ minX: 0, maxX: 4, minZ: 0, maxZ: 3 });
    const bay = boxes.find((b) => b.minZ >= 3 - 1e-9)!;
    expect(bay.minX).toBeCloseTo(1, 6);
    expect(bay.maxX).toBeCloseTo(3, 6);
    expect(bay.maxZ).toBeCloseTo(4, 6);
  });
});

describe('probePoint', () => {
  test('lies at the probe height, inside the room, farthest from its edges', () => {
    const point = probePoint(square(0, 0, 4, 2), []);
    expect(point.y).toBe(T.probeHeightM);
    expect(point.x).toBeCloseTo(2, 1);
    expect(point.z).toBeCloseTo(1, 1);
  });

  test('stays inside an L-shaped room, in its widest part', () => {
    const point = probePoint(L_ROOM, []);
    // The deepest points of the L sit around its corner square (0..3, 0..3).
    expect(point.x).toBeGreaterThan(0.5);
    expect(point.x).toBeLessThan(3);
    expect(point.z).toBeGreaterThan(0.5);
    expect(point.z).toBeLessThan(3);
  });

  test('steps off a furniture footprint', () => {
    const table = { minX: 1.5, maxX: 2.5, minZ: 0.5, maxZ: 1.5 };
    const point = probePoint(square(0, 0, 4, 2), [table]);
    const inside = point.x > table.minX && point.x < table.maxX && point.z > table.minZ && point.z < table.maxZ;
    expect(inside).toBe(false);
  });
});

describe('roomOrder', () => {
  test('puts the room a door leaf swings into before the room on the other side', () => {
    expect(roomOrder(['hall', 'bath', 'bed'], [{ into: 'bath', other: 'hall' }, { into: 'bed', other: 'hall' }])).toEqual(['bath', 'bed', 'hall']);
  });

  test('keeps the input order where no door decides, and survives a cycle', () => {
    expect(roomOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
    const cyclic = roomOrder(['a', 'b'], [{ into: 'a', other: 'b' }, { into: 'b', other: 'a' }]);
    expect([...cyclic].sort()).toEqual(['a', 'b']);
  });
});

describe('roomVolumes', () => {
  const input: VolumeInput = {
    ceilingHeight: 2.6,
    rooms: [
      { roomId: 'hall', polygon: square(0, 3.1, 6, 5), halfWall: 0.05 },
      { roomId: 'bath', polygon: square(0, 0, 3, 3), halfWall: 0.05 },
    ],
    doors: [{ into: 'bath', other: 'hall' }],
    furniture: [],
  };

  test('builds sampling, selection and projection boxes per room box, leaf side first', () => {
    const result = roomVolumes(input);
    if (!result.ok) throw new Error(result.error);
    const [bath, hall] = result.volumes.boxes;
    expect(bath!.roomId).toBe('bath');
    expect(hall!.roomId).toBe('hall');
    expect(bath!.projection).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 2.6, z: 3 } });
    expect(bath!.sampling.min.x).toBeCloseTo(T.samplingInsetM, 9);
    expect(bath!.sampling.max.y).toBeCloseTo(2.6 - T.samplingInsetM, 9);
    expect(bath!.selection.min).toEqual({ x: -0.05, y: -T.selectionPadM, z: -0.05 });
    expect(bath!.selection.max.x).toBeCloseTo(3.05, 9);
    expect(bath!.selection.max.y).toBeCloseTo(2.6 + T.selectionPadM, 9);
    // About one probe per metre in plan, two layers in height.
    expect(bath!.resolution).toEqual({ x: 4, y: T.gridLayers, z: 4 });
  });

  test('gives every room one probe point and the apartment its bounds', () => {
    const result = roomVolumes(input);
    if (!result.ok) throw new Error(result.error);
    expect(result.volumes.probes.map((probe) => probe.roomId)).toEqual(['bath', 'hall']);
    expect(result.volumes.bounds).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 6, y: 2.6, z: 5 } });
  });

  test(`refuses more than ${T.maxBoxes} room boxes`, () => {
    const rooms = Array.from({ length: T.maxBoxes + 1 }, (_, i) => ({ roomId: `r${i}`, polygon: square(i * 2, 0, i * 2 + 1.9, 2), halfWall: 0.05 }));
    const result = roomVolumes({ ...input, rooms, doors: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(T.maxBoxes));
  });
});
