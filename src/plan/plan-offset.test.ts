import { describe, expect, test } from 'bun:test';
import { ARC_TOL, add, arcFromChord, dist, mul } from './plan-geometry.js';
import { PlanError } from './plan-graph.js';
import { MITER_LIMIT_FACTOR, offsetEdges, offsetLoop } from './plan-offset.js';
import type { FaceEdgeInput } from './plan-offset.js';
import type { Vec2 } from '../scene/types.js';

const v = (x: number, z: number): Vec2 => ({ x, z });

/** Build a closed straight-edge loop from consecutive corner points. */
function loopOf(points: Vec2[], offsets: number[], ids?: string[]): FaceEdgeInput[] {
  return points.map((p, i) => ({
    wallId: ids?.[i] ?? `e${i}`,
    side: 'L' as const,
    p,
    q: points[(i + 1) % points.length]!,
    offset: offsets[i]!,
  }));
}

/**
 * Room A of the reference L-shape plan, walked so leftN points inside:
 * (0,0) -> (6,0) -> (6,5) -> (6,8) -> (0,8). The 6 -> 5 -> 8 run is split
 * because the 0.10 partition below z = 5 becomes a 0.30 outer wall above it.
 */
const ROOM_A: FaceEdgeInput[] = [
  { wallId: 'w-s-a', side: 'L', p: v(0, 0), q: v(6, 0), offset: 0.15 },
  { wallId: 'w-part', side: 'L', p: v(6, 0), q: v(6, 5), offset: 0.05 },
  { wallId: 'w-step', side: 'L', p: v(6, 5), q: v(6, 8), offset: 0.15 },
  { wallId: 'w-n-a', side: 'L', p: v(6, 8), q: v(0, 8), offset: 0.15 },
  { wallId: 'w-w', side: 'L', p: v(0, 8), q: v(0, 0), offset: 0.15 },
];

/** Room B of the same plan: (6,0) -> (10,0) -> (10,5) -> (6,5). */
const ROOM_B: FaceEdgeInput[] = [
  { wallId: 'w-s-b', side: 'L', p: v(6, 0), q: v(10, 0), offset: 0.15 },
  { wallId: 'w-e', side: 'L', p: v(10, 0), q: v(10, 5), offset: 0.15 },
  { wallId: 'w-n-b', side: 'L', p: v(10, 5), q: v(6, 5), offset: 0.15 },
  { wallId: 'w-part', side: 'R', p: v(6, 5), q: v(6, 0), offset: 0.05 },
];

describe('offsetLoop on a rectangle', () => {
  test('a 0.30 shell shrinks the room by 0.15 on every side', () => {
    const loop = offsetLoop(loopOf([v(0, 0), v(8, 0), v(8, 5), v(0, 5)], [0.15, 0.15, 0.15, 0.15]));
    expect(loop.length).toBe(4);
    expect(loop.every((p) => p.kind === 'miter')).toBe(true);
    const corners = loop.map((p) => [p.x, p.z]);
    expect(corners).toEqual([
      [8 - 0.15, 0.15],
      [8 - 0.15, 5 - 0.15],
      [0.15, 5 - 0.15],
      [0.15, 0.15],
    ]);
  });

  test('every vertex records the edge it follows', () => {
    const loop = offsetLoop(loopOf([v(0, 0), v(8, 0), v(8, 5), v(0, 5)], [0.15, 0.15, 0.15, 0.15]));
    expect(loop.map((p) => p.afterEdge)).toEqual([0, 1, 2, 3]);
  });
});

describe('offsetLoop on the L-shape plan', () => {
  test('room A has six vertices with a jog at the thickness change', () => {
    const loop = offsetLoop(ROOM_A);
    expect(loop.length).toBe(6);
    const jog = loop.filter((p) => p.kind === 'jog');
    expect(jog.length).toBe(2);
    expect(jog.map((p) => [p.x, p.z])).toEqual([
      [5.95, 5],
      [5.85, 5],
    ]);
    expect(jog.every((p) => p.afterEdge === 1)).toBe(true);
  });

  test('room A outline is the expected hexagon', () => {
    const loop = offsetLoop(ROOM_A).map((p) => [p.x, p.z]);
    expect(loop).toEqual([
      [5.95, 0.15],
      [5.95, 5],
      [5.85, 5],
      [5.85, 7.85],
      [0.15, 7.85],
      [0.15, 0.15],
    ]);
  });

  test('the partition leaves exactly 0.10 between the two room faces', () => {
    const faceA = offsetEdges(ROOM_A).find((e) => e.wallId === 'w-part')!;
    const faceB = offsetEdges(ROOM_B).find((e) => e.wallId === 'w-part')!;
    for (const p of faceA.polyline) expect(p.x).toBeCloseTo(5.95, 12);
    for (const p of faceB.polyline) expect(p.x).toBeCloseTo(6.05, 12);
    expect(faceB.polyline[0]!.x - faceA.polyline[0]!.x).toBeCloseTo(0.1, 12);
  });

  test('face lengths shrink by the mitre on both ends', () => {
    const edges = offsetEdges(ROOM_A);
    const partition = edges.find((e) => e.wallId === 'w-part')!;
    // 5.00 centreline minus 0.15 taken by the south wall, full length at the jog.
    expect(partition.length).toBeCloseTo(5 - 0.15, 12);
    const west = edges.find((e) => e.wallId === 'w-w')!;
    expect(west.length).toBeCloseTo(8 - 0.15 - 0.15, 12);
  });

  test('consecutive offset edges join end to start except across the jog', () => {
    const edges = offsetEdges(ROOM_A);
    for (let i = 0; i < edges.length; i += 1) {
      const end = edges[i]!.polyline.at(-1)!;
      const start = edges[(i + 1) % edges.length]!.polyline[0]!;
      const gap = dist(end, start);
      if (i === 1) expect(gap).toBeCloseTo(0.1, 12);
      else expect(gap).toBeCloseTo(0, 12);
    }
  });
});

describe('miter limit', () => {
  test('MITER_LIMIT_FACTOR is 4', () => {
    expect(MITER_LIMIT_FACTOR).toBe(4);
  });

  test('a 20 degree corner bevels instead of spiking', () => {
    const apex = (20 * Math.PI) / 180;
    const points = [v(0, 0), v(10, 0), v(10 * Math.cos(apex), 10 * Math.sin(apex))];
    const loop = offsetLoop(loopOf(points, [0.15, 0.15, 0.15]));
    const bevel = loop.filter((p) => p.kind === 'bevel');
    expect(bevel.length).toBe(2);
    expect(bevel.every((p) => p.afterEdge === 2)).toBe(true);
    // The unclipped mitre would sit 0.15 / sin(10 deg) away from the apex.
    expect(0.15 / Math.sin(apex / 2)).toBeGreaterThan(MITER_LIMIT_FACTOR * 0.15);
    for (const p of bevel) expect(dist(p, v(0, 0))).toBeLessThanOrEqual(MITER_LIMIT_FACTOR * 0.15 + 1e-9);
    expect(loop.filter((p) => p.kind === 'miter').length).toBe(2);
  });

  test('a 90 degree corner still mitres', () => {
    const loop = offsetLoop(loopOf([v(0, 0), v(4, 0), v(4, 4), v(0, 4)], [0.15, 0.15, 0.15, 0.15]));
    expect(loop.every((p) => p.kind === 'miter')).toBe(true);
  });
});

describe('arc offsets', () => {
  /**
   * Semicircular bay of radius 2.0 replacing the north wall of a 4 x 4 room:
   * (0,0) -> arc bulging to -z -> (4,0) -> (4,4) -> (0,4). The straight walls
   * are tangent to the arc at its ends, so the joints land on the offset arc.
   */
  const chordA = v(0, 0);
  const chordB = v(4, 0);
  const bayArc = arcFromChord(chordA, chordB, 2, false);
  const bayRoom: FaceEdgeInput[] = [
    { wallId: 'bay', side: 'L', p: chordA, q: chordB, offset: 0.15, arc: bayArc },
    { wallId: 'bay-e', side: 'L', p: chordB, q: v(4, 4), offset: 0.15 },
    { wallId: 'bay-n', side: 'L', p: v(4, 4), q: v(0, 4), offset: 0.15 },
    { wallId: 'bay-w', side: 'L', p: v(0, 4), q: chordA, offset: 0.15 },
  ];
  const bayFacade: FaceEdgeInput[] = [
    { wallId: 'bay-w', side: 'R', p: chordA, q: v(0, 4), offset: 0.15 },
    { wallId: 'bay-n', side: 'R', p: v(0, 4), q: v(4, 4), offset: 0.15 },
    { wallId: 'bay-e', side: 'R', p: v(4, 4), q: chordB, offset: 0.15 },
    { wallId: 'bay', side: 'R', p: chordB, q: chordA, offset: 0.15, arc: arcFromChord(chordB, chordA, 2, true) },
  ];

  test('the inner face is a concentric arc of radius R - 0.15', () => {
    const inner = offsetEdges(bayRoom).find((e) => e.wallId === 'bay')!;
    expect(inner.arc).toBeDefined();
    expect(inner.arc!.radius).toBeCloseTo(1.85, 12);
    for (const p of inner.polyline) expect(dist(p, bayArc.centre)).toBeCloseTo(1.85, 9);
  });

  test('the outer face is a concentric arc of radius R + 0.15', () => {
    const outer = offsetEdges(bayFacade).find((e) => e.wallId === 'bay')!;
    expect(outer.arc!.radius).toBeCloseTo(2.15, 12);
    for (const p of outer.polyline) expect(dist(p, bayArc.centre)).toBeCloseTo(2.15, 9);
  });

  test('the wall keeps a constant 0.30 thickness all along the arc', () => {
    const inner = offsetEdges(bayRoom).find((e) => e.wallId === 'bay')!;
    const outer = offsetEdges(bayFacade).find((e) => e.wallId === 'bay')!;
    for (const p of inner.polyline) {
      const radial = dist(p, bayArc.centre);
      expect(Math.abs(2.15 - radial) - 0.3).toBeLessThan(1e-6);
    }
    for (const p of outer.polyline) {
      expect(Math.abs(dist(p, bayArc.centre) - 1.85) - 0.3).toBeLessThan(1e-6);
    }
  });

  test('the discretised arc keeps its sagitta inside ARC_TOL', () => {
    const inner = offsetEdges(bayRoom).find((e) => e.wallId === 'bay')!;
    for (let i = 0; i + 1 < inner.polyline.length; i += 1) {
      const mid = mul(add(inner.polyline[i]!, inner.polyline[i + 1]!), 0.5);
      expect(1.85 - dist(mid, bayArc.centre)).toBeLessThanOrEqual(ARC_TOL + 1e-12);
    }
    expect(inner.length).toBeLessThan(Math.PI * 1.85);
    expect(inner.length).toBeGreaterThan(Math.PI * 1.85 - 0.01);
  });

  test('tangent straight walls continue the arc without a jog', () => {
    const loop = offsetLoop(bayRoom);
    expect(loop.length).toBe(4);
    expect(loop.filter((p) => p.kind === 'jog' || p.kind === 'bevel').length).toBe(0);
    const arcJoints = loop.filter((p) => p.kind === 'arc');
    expect(arcJoints.length).toBe(2);
    for (const p of arcJoints) expect(dist(p, bayArc.centre)).toBeCloseTo(1.85, 9);
  });

  test('an impossible inner offset raises BAD_ARC instead of collapsing to EPS', () => {
    // Radius 0.30 offset inward by 0.26 would leave an inner radius of 0.04.
    const tightArc = arcFromChord(v(0, 0), v(0.6, 0), 0.3, false);
    const edges: FaceEdgeInput[] = [
      { wallId: 'tight', side: 'L', p: v(0, 0), q: v(0.6, 0), offset: 0.26, arc: tightArc },
      { wallId: 'tight-e', side: 'L', p: v(0.6, 0), q: v(0.6, 1), offset: 0.15 },
      { wallId: 'tight-n', side: 'L', p: v(0.6, 1), q: v(0, 1), offset: 0.15 },
      { wallId: 'tight-w', side: 'L', p: v(0, 1), q: v(0, 0), offset: 0.15 },
    ];
    try {
      offsetEdges(edges);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).name).toBe('PlanError');
      expect((error as PlanError).planCode).toBe('BAD_ARC');
      expect((error as PlanError).message).toContain('tight');
    }
  });

  test('the outward offset of the same arc is always allowed', () => {
    const tightArc = arcFromChord(v(0.6, 0), v(0, 0), 0.3, true);
    const edges: FaceEdgeInput[] = [
      { wallId: 'tight', side: 'R', p: v(0.6, 0), q: v(0, 0), offset: 0.26, arc: tightArc },
      { wallId: 'tight-w', side: 'R', p: v(0, 0), q: v(0, 1), offset: 0.15 },
      { wallId: 'tight-n', side: 'R', p: v(0, 1), q: v(0.6, 1), offset: 0.15 },
      { wallId: 'tight-e', side: 'R', p: v(0.6, 1), q: v(0.6, 0), offset: 0.15 },
    ];
    const outer = offsetEdges(edges).find((e) => e.wallId === 'tight')!;
    expect(outer.arc!.radius).toBeCloseTo(0.56, 12);
  });
});
