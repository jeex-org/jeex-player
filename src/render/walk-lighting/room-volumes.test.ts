import { describe, expect, test } from 'bun:test';
import { probePoint, rectilinearBoxes, roomOrder, roomVolumes, type VolumeInput } from './room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';
import { searchLattice } from '../../plan/search-lattice.js';

type Box3D = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

/** Euclidean distance from a point to a box, zero inside it. */
const boxDistance = (p: { x: number; y: number; z: number }, b: Box3D): number =>
  Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minY - p.y, 0, p.y - b.maxY), Math.max(b.minZ - p.z, 0, p.z - b.maxZ));

/** Distance from a plan point to the nearest edge of an axis-aligned rectangular room. */
const rectEdge = (p: { x: number; z: number }, x0: number, z0: number, x1: number, z1: number): number =>
  Math.min(p.x - x0, x1 - p.x, p.z - z0, z1 - p.z);

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
    const polygon = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 3 },
      { x: 0, z: 3 },
    ];
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
    // To half a lattice step (0.05 m) of the true centre.
    expect(Math.abs(point.x - 2)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(point.z - 1)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  test('stays inside an L-shaped room, in its widest part', () => {
    const point = probePoint(L_ROOM, []);
    // The deepest points of the L sit around its corner square (0..3, 0..3).
    expect(point.x).toBeGreaterThan(0.5);
    expect(point.x).toBeLessThan(3);
    expect(point.z).toBeGreaterThan(0.5);
    expect(point.z).toBeLessThan(3);
  });

  test('steps off a tall furniture footprint', () => {
    const table = { minX: 1.5, maxX: 2.5, minY: 0, maxY: 2, minZ: 0.5, maxZ: 1.5 };
    const point = probePoint(square(0, 0, 4, 2), [table]);
    const inside = point.x > table.minX && point.x < table.maxX && point.z > table.minZ && point.z < table.maxZ;
    expect(inside).toBe(false);
  });
});

describe('probePoint keeps a 3D clearance from furniture', () => {
  test('a floor lamp whose shade reaches the probe height pushes the probe at least the clearance away', () => {
    const lamp: Box3D = { minX: 1.8, maxX: 2.2, minY: 0, maxY: 1.7, minZ: 1.8, maxZ: 2.2 };
    const point = probePoint(square(0, 0, 4, 4), [lamp]);
    expect(boxDistance(point, lamp)).toBeGreaterThanOrEqual(T.probeClearanceM);
  });

  test("a sofa 0.8 m high does not move the probe off the empty room's point", () => {
    const sofa: Box3D = { minX: 1, maxX: 3, minY: 0, maxY: 0.8, minZ: 0.5, maxZ: 1.5 };
    expect(probePoint(square(0, 0, 4, 2), [sofa])).toEqual(probePoint(square(0, 0, 4, 2), []));
  });

  test('without a qualifying point, the largest min(furniture clearance, edge distance) wins', () => {
    const column: Box3D = { minX: 0.3, maxX: 0.9, minY: 0, maxY: 2.6, minZ: 0.3, maxZ: 0.9 };
    const point = probePoint(square(0, 0, 1.2, 1.2), [column]);
    const key = (p: { x: number; z: number }) =>
      Math.min(boxDistance({ x: p.x, y: T.probeHeightM, z: p.z }, column), rectEdge(p, 0, 0, 1.2, 1.2));
    expect(key(point)).toBeLessThan(T.probeClearanceM);
    const best = Math.max(...searchLattice(0, 1.2, 0, 1.2, 0.1).map((p) => key(p)));
    expect(key(point)).toBeCloseTo(best, 9);
  });

  test('answers the same point on every run', () => {
    const lamp: Box3D = { minX: 1.8, maxX: 2.2, minY: 0, maxY: 1.7, minZ: 1.8, maxZ: 2.2 };
    expect(probePoint(square(0, 0, 4, 4), [lamp])).toEqual(probePoint(square(0, 0, 4, 4), [lamp]));
  });
});

describe('probePoint on rooms the search must not stall on', () => {
  const L = (o: number, k: number) => L_ROOM.map((p) => ({ x: o + p.x * k, z: o + p.z * k }));

  test('an L-shaped room around 1e16 ends and answers a point inside it', () => {
    const polygon = L(1e16, 1000);
    const point = probePoint(polygon, []);
    expect(point.x).toBeGreaterThanOrEqual(1e16);
    expect(point.x).toBeLessThanOrEqual(1e16 + 6000);
    expect(point.z).toBeLessThanOrEqual(1e16 + 6000);
    // Inside the L: not in its missing upper-right quarter.
    expect(point.x - 1e16 <= 3000 || point.z - 1e16 <= 3000).toBe(true);
  });

  test('a very large room ends quickly and answers a point inside it', () => {
    const started = performance.now();
    const point = probePoint(L(0, 1000), []);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(point.x <= 3000 || point.z <= 3000).toBe(true);
  });
});

describe('roomOrder', () => {
  test('puts the room a door leaf swings into before the room on the other side', () => {
    expect(
      roomOrder(
        ['hall', 'bath', 'bed'],
        [
          { into: 'bath', other: 'hall' },
          { into: 'bed', other: 'hall' },
        ],
      ),
    ).toEqual(['bath', 'bed', 'hall']);
  });

  test('keeps the input order where no door decides, and survives a cycle', () => {
    expect(roomOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
    const cyclic = roomOrder(
      ['a', 'b'],
      [
        { into: 'a', other: 'b' },
        { into: 'b', other: 'a' },
      ],
    );
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
    expect(T.gridLayers).toBe(3);
  });

  test('grows each selection side to its own wall: a thick facade and thin partitions', () => {
    // A 3 x 3 room: the facade on z = 0 is 0.3 m thick, the three partitions 0.1 m.
    const result = roomVolumes({
      ...input,
      rooms: [{ roomId: 'bath', polygon: square(0, 0, 3, 3), halfWall: 0.15, edgeHalfWalls: [0.15, 0.05, 0.05, 0.05] }],
      doors: [],
    });
    if (!result.ok) throw new Error(result.error);
    const { min, max } = result.volumes.boxes[0]!.selection;
    expect(min.z).toBeCloseTo(-0.15, 9);
    expect(min.x).toBeCloseTo(-0.05, 9);
    expect(max.x).toBeCloseTo(3.05, 9);
    expect(max.z).toBeCloseTo(3.05, 9);
  });

  test('gives every room one probe point and the apartment its bounds', () => {
    const result = roomVolumes(input);
    if (!result.ok) throw new Error(result.error);
    expect(result.volumes.probes.map((probe) => probe.roomId)).toEqual(['bath', 'hall']);
    expect(result.volumes.bounds).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 6, y: 2.6, z: 5 } });
  });

  test('a plan without a closed room has no boxes and finite bounds', () => {
    const result = roomVolumes({ ...input, rooms: [], doors: [] });
    if (!result.ok) throw new Error(result.error);
    expect(result.volumes.boxes).toEqual([]);
    expect(Number.isFinite(result.volumes.bounds.max.x)).toBe(true);
  });

  test('refuses a room box whose grid would exceed the probes per axis, before any grid exists', () => {
    const result = roomVolumes({ ...input, rooms: [{ roomId: 'hangar', polygon: square(0, 0, 3000, 3000), halfWall: 0.1 }], doors: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(T.maxProbesPerAxis));
  });

  test(`refuses more than ${T.maxBoxes} room boxes`, () => {
    const rooms = Array.from({ length: T.maxBoxes + 1 }, (_, i) => ({
      roomId: `r${i}`,
      polygon: square(i * 2, 0, i * 2 + 1.9, 2),
      halfWall: 0.05,
    }));
    const result = roomVolumes({ ...input, rooms, doors: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(T.maxBoxes));
  });
});
