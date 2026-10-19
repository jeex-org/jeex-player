import { describe, expect, test } from 'bun:test';
import { canonicalRing } from '../shared/quantise.js';
import { faceKey } from '../scene/types.js';
import type { FaceKey, Vec2 } from '../scene/types.js';
import { bayPlan, lShapePlan } from '../fixtures/plan-l-shape.js';
import { BAY, L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { apartmentScene } from '../demo/scene-data.js';
import { dist } from './plan-geometry.js';
import { PlanError } from './plan-graph.js';
import { quadsArea } from './plan-openings.js';
import { solvePlan } from './plan-solver.js';
import type { SolvedPlan, WallFace } from './plan-solver.js';

/** The arc spliced into a straight facade run, drawn below. */
const SPLICED = {
  node: {
    p1: '01a12ff3-8b1d-7aaa-9aa1-617ce6449dce',
    p2: '01a12ff3-8b1e-732b-a4ca-526a58402b36',
    p3: '01a12ff3-8b1f-7414-b112-a3d54ba46f09',
    p4: '01a12ff3-8b20-785b-a925-004adf79d3cf',
    p5: '01a12ff3-8b21-75a2-b51a-6e3b6b257d20',
    p6: '01a12ff3-8b22-760b-803f-bbd8878d76c1',
  },
  wall: {
    nW: '01a12ff3-8b23-7cea-85cd-6252fb76ca08',
    bay: '01a12ff3-8b24-7d6f-8730-7aef4da57d7a',
    nE: '01a12ff3-8b25-7a50-a114-c08476c64dc2',
    east: '01a12ff3-8b26-7864-b95b-a01646216feb',
    south: '01a12ff3-8b27-7e1f-aef2-63ab5eb626c5',
    west: '01a12ff3-8b28-7334-871a-0137f8295438',
  },
  opening: { windowBay: '01a12ff3-8b29-775f-96ce-46be319992d7' },
  room: { hall: '01a12ff3-8b2a-7f4e-ba11-1d77c2e65e88' },
} as const;

/** The dangling wall added to the L-shape plan. */
const STUB = {
  node: { nx: '01a12ff3-8b2b-7755-8587-db0e819fd564' },
  wall: { wStub: '01a12ff3-8b2c-75f1-bb8e-0165d939ef5b' },
} as const;

/** The wall crossing the L-shape plan without a node. */
const CROSSING = {
  node: { x1: '01a12ff3-8b2d-7904-9edb-cdf5c463df16', x2: '01a12ff3-e14d-7768-a007-43992f563508' },
  wall: { wCross: '01a12ff3-e14e-7064-9fb2-9834ee8b9b71' },
} as const;

const solved: SolvedPlan = solvePlan(lShapePlan);
const bay: SolvedPlan = solvePlan(bayPlan);

const roomOf = (plan: SolvedPlan, id: string) => plan.rooms.find((r) => r.roomId === id)!;
const faceOf = (plan: SolvedPlan, face: FaceKey): WallFace => plan.faces.get(face)!;

describe('plan.faces', () => {
  test('is keyed by value: a FaceKey built separately finds the same face', () => {
    const stored = [...solved.faces.keys()].find((key) => key.wallId === L_SHAPE.wall.wPart && key.side === 'L')!;
    const rebuilt = faceKey(L_SHAPE.room.a, L_SHAPE.wall.wPart, 'L');
    expect(rebuilt).not.toBe(stored);
    expect(solved.faces.get(stored)).toBeDefined();
    expect(solved.faces.get(rebuilt)).toBe(solved.faces.get(stored));
    expect(solved.faces.has(faceKey(L_SHAPE.room.b, L_SHAPE.wall.wPart, 'L'))).toBe(false);
  });
});

describe('solvePlan topology', () => {
  test('solves both rooms of the L-shape plan', () => {
    expect(solved.rooms.map((r) => r.roomId).sort()).toEqual([L_SHAPE.room.a, L_SHAPE.room.b]);
    expect(roomOf(solved, L_SHAPE.room.a).loop.length).toBe(5);
    expect(roomOf(solved, L_SHAPE.room.b).loop.length).toBe(4);
  });

  test('every wall side becomes exactly one face', () => {
    // 8 walls x 2 sides: 5 room A + 4 room B + 7 facade.
    expect(solved.faces.size).toBe(16);
    expect(solved.facade.length).toBe(7);
    const counted = new Set<string>();
    for (const face of solved.faces.values()) counted.add(`${face.wallId}:${face.side}`);
    expect(counted.size).toBe(16);
  });

  test('each interior side belongs to exactly one room and the facade to none', () => {
    for (const room of solved.rooms) {
      for (const face of room.loop) {
        expect(face.roomId).toBe(room.roomId);
        expect(solved.faces.get(face.key)).toBe(face);
        expect(face.key).toEqual(faceKey(room.roomId, face.wallId, face.side));
      }
    }
    for (const face of solved.facade) {
      expect(face.roomId).toBeNull();
      expect(face.key).toEqual(faceKey(null, face.wallId, face.side));
    }
  });

  test('the partition is interior on both sides', () => {
    expect(faceOf(solved, faceKey(L_SHAPE.room.a, L_SHAPE.wall.wPart, 'L')).roomId).toBe(L_SHAPE.room.a);
    expect(faceOf(solved, faceKey(L_SHAPE.room.b, L_SHAPE.wall.wPart, 'R')).roomId).toBe(L_SHAPE.room.b);
    expect(solved.facade.some((f) => f.wallId === L_SHAPE.wall.wPart)).toBe(false);
  });

  test('a plan with a dangling wall throws a PlanError', () => {
    const broken = {
      ...lShapePlan,
      nodes: [...lShapePlan.nodes, { id: STUB.node.nx, p: { x: 3, z: 3 } }],
      walls: [...lShapePlan.walls, { id: STUB.wall.wStub, a: L_SHAPE.node.n1, b: STUB.node.nx, thickness: 0.1 }],
    };
    expect(() => solvePlan(broken)).toThrow(PlanError);
  });
});

describe('solvePlan geometry', () => {
  /**
   * The two room rings, written from the vertex `canonicalRing` picks rather
   * than from the vertex the solver starts at.
   *
   * The SHAPE and the START are two different promises, and only the shape
   * belongs in a geometry test: an assertion written straight against the
   * solver's array quietly re-asserts the start on every line, so a change to
   * the traversal reads as six wrong coordinates instead of one rotated ring.
   * The start has its own test in `solvePlan determinism` below, and
   * `plan-invariance.test.ts` proves it does not move with the document.
   */
  const ring = (points: readonly Vec2[]): number[][] => canonicalRing(points).map((p) => [p.x, p.z]);

  test('room A is the expected hexagon with the 0.10 jog', () => {
    expect(ring(roomOf(solved, L_SHAPE.room.a).polygon)).toEqual(
      ring([
        { x: 0.15, z: 0.15 },
        { x: 5.95, z: 0.15 },
        { x: 5.95, z: 5 },
        { x: 5.85, z: 5 },
        { x: 5.85, z: 7.85 },
        { x: 0.15, z: 7.85 },
      ]),
    );
  });

  test('room B is the expected rectangle', () => {
    expect(ring(roomOf(solved, L_SHAPE.room.b).polygon)).toEqual(
      ring([
        { x: 6.05, z: 0.15 },
        { x: 9.85, z: 0.15 },
        { x: 9.85, z: 4.85 },
        { x: 6.05, z: 4.85 },
      ]),
    );
    expect(roomOf(solved, L_SHAPE.room.b).bbox).toEqual({ minX: 6.05, maxX: 9.85, minZ: 0.15, maxZ: 4.85 });
  });

  test('the partition keeps the two room faces 0.10 apart', () => {
    for (const p of faceOf(solved, faceKey(L_SHAPE.room.a, L_SHAPE.wall.wPart, 'L')).polyline) expect(p.x).toBeCloseTo(5.95, 12);
    for (const p of faceOf(solved, faceKey(L_SHAPE.room.b, L_SHAPE.wall.wPart, 'R')).polyline) expect(p.x).toBeCloseTo(6.05, 12);
  });

  test('face normals point into the room', () => {
    const south = faceOf(solved, faceKey(L_SHAPE.room.a, L_SHAPE.wall.wSA, 'L'));
    expect(south.normal.x).toBeCloseTo(0, 12);
    expect(south.normal.z).toBeCloseTo(1, 12);
    const outside = faceOf(solved, faceKey(null, L_SHAPE.wall.wSA, 'R'));
    expect(outside.normal.z).toBeCloseTo(-1, 12);
  });

  test('bounds cover every plan node', () => {
    for (const n of lShapePlan.nodes) {
      expect(solved.bounds.minX).toBeLessThanOrEqual(n.p.x);
      expect(solved.bounds.maxX).toBeGreaterThanOrEqual(n.p.x);
      expect(solved.bounds.minZ).toBeLessThanOrEqual(n.p.z);
      expect(solved.bounds.maxZ).toBeGreaterThanOrEqual(n.p.z);
    }
    expect(solved.bounds.minX).toBeCloseTo(-0.15, 12);
    expect(solved.bounds.maxX).toBeCloseTo(10.15, 12);
  });
});

describe('solvePlan determinism', () => {
  test('the rooms come back ordered by their canonical first half-edge', () => {
    // Room A starts at n1/w-s-a/L, room B at n2/w-s-b/L: an id order, not the
    // order `lShapePlan` happens to list its walls in.
    expect(solved.rooms.map((r) => r.roomId)).toEqual([L_SHAPE.room.a, L_SHAPE.room.b]);
  });

  test('each room ring starts at the wall its canonical half-edge leaves', () => {
    // Room A: w-s-a leaving n1 (0, 0), offset to (0.15, 0.15).
    expect(roomOf(solved, L_SHAPE.room.a).loop[0]!.wallId).toBe(L_SHAPE.wall.wSA);
    expect(roomOf(solved, L_SHAPE.room.a).polygon[0]).toEqual({ x: 0.15, z: 0.15 });
    // Room B: w-s-b leaving n2 (6, 0), offset to (6.05, 0.15).
    expect(roomOf(solved, L_SHAPE.room.b).loop[0]!.wallId).toBe(L_SHAPE.wall.wSB);
    expect(roomOf(solved, L_SHAPE.room.b).polygon[0]).toEqual({ x: 6.05, z: 0.15 });
  });

  test('the facade loop starts at n1 and walks the outside once', () => {
    // n1/w-w/R is the smallest half-edge of the outer cycle; before ring
    // determinism the loop started wherever `walls[0]` happened to put it.
    expect(solved.facade.map((f) => f.wallId)).toEqual([
      L_SHAPE.wall.wW,
      L_SHAPE.wall.wNA,
      L_SHAPE.wall.wStep,
      L_SHAPE.wall.wNB,
      L_SHAPE.wall.wE,
      L_SHAPE.wall.wSB,
      L_SHAPE.wall.wSA,
    ]);
    for (const face of solved.facade) expect(face.side).toBe('R');
  });
});

describe('solvePlan faces, openings and quads', () => {
  test('room A south face reproduces the reference 5.80 x 3.15 example', () => {
    const face = faceOf(solved, faceKey(L_SHAPE.room.a, L_SHAPE.wall.wSA, 'L'));
    expect(face.t0).toBeCloseTo(0.15, 12);
    expect(face.length).toBeCloseTo(5.8, 12);
    expect(face.openings.map((o) => o.id)).toEqual([L_SHAPE.opening.doorEntry, L_SHAPE.opening.windowASouth]);
    expect(face.openings[0]!.t0).toBeCloseTo(0.6, 12);
    expect(face.openings[0]!.t1).toBeCloseTo(1.6, 12);
    expect(face.openings[1]!.t0).toBeCloseTo(3.0, 12);
    expect(face.openings[1]!.t1).toBeCloseTo(5.0, 12);
    expect(face.quads.length).toBe(6);
    expect(quadsArea(face.quads)).toBeCloseTo(13.06, 9);
  });

  test('quad area equals face area minus openings on every face', () => {
    for (const face of solved.faces.values()) {
      const holes = face.openings.reduce((sum, o) => sum + (o.t1 - o.t0) * (o.head - o.sill), 0);
      expect(quadsArea(face.quads)).toBeCloseTo(face.length * lShapePlan.ceilingHeight - holes, 9);
    }
  });

  test('the facade side of the same wall mirrors the opening positions', () => {
    const face = faceOf(solved, faceKey(null, L_SHAPE.wall.wSA, 'R'));
    expect(face.length).toBeCloseTo(6.15, 12);
    expect(face.openings.map((o) => o.id)).toEqual([L_SHAPE.opening.windowASouth, L_SHAPE.opening.doorEntry]);
    const door = face.openings.find((o) => o.id === L_SHAPE.opening.doorEntry)!;
    expect(door.t0).toBeCloseTo(4.25, 12);
    expect(door.t1).toBeCloseTo(5.25, 12);
  });

  test('the partition door lands on both of its faces', () => {
    const a = faceOf(solved, faceKey(L_SHAPE.room.a, L_SHAPE.wall.wPart, 'L')).openings;
    const b = faceOf(solved, faceKey(L_SHAPE.room.b, L_SHAPE.wall.wPart, 'R')).openings;
    expect(a.map((o) => o.id)).toEqual([L_SHAPE.opening.doorAb]);
    expect(b.map((o) => o.id)).toEqual([L_SHAPE.opening.doorAb]);
    expect(a[0]!.t0).toBeCloseTo(2.05 - 0.15, 12);
    expect(b[0]!.t0).toBeCloseTo(5 - 2.95 - 0.15, 12);
  });
});

describe('centrelines', () => {
  test('carry thickness, geometry and door intervals', () => {
    expect(solved.centrelines.length).toBe(lShapePlan.walls.length);
    const partition = solved.centrelines.find((c) => c.wallId === L_SHAPE.wall.wPart)!;
    expect(partition.thickness).toBe(0.1);
    expect(partition.length).toBeCloseTo(5, 12);
    expect(partition.polyline).toEqual([
      { x: 6, z: 0 },
      { x: 6, z: 5 },
    ]);
    expect(partition.doors.length).toBe(1);
    expect(partition.doors[0]!.t0).toBeCloseTo(2.05, 12);
    expect(partition.doors[0]!.t1).toBeCloseTo(2.95, 12);
    // Each interval names the opening it came from, so a consumer (the floor
    // outline, the mini-map) can correlate it with `Wall.openings`.
    expect(partition.doors[0]!.openingId).toBe(L_SHAPE.opening.doorAb);
  });

  test('windows are not doorways', () => {
    const east = solved.centrelines.find((c) => c.wallId === L_SHAPE.wall.wE)!;
    expect(east.doors).toEqual([]);
    const south = solved.centrelines.find((c) => c.wallId === L_SHAPE.wall.wSA)!;
    expect(south.doors.map((d) => [d.t0, d.t1, d.openingId])).toEqual([[0.75, 1.75, L_SHAPE.opening.doorEntry]]);
  });
});

describe('semicircular bay', () => {
  const centre = { x: 2, z: 0 };

  test('the room polygon follows the concentric arc of radius R - 0.15', () => {
    const room = roomOf(bay, BAY.room.bayRoom);
    const onArc = room.polygon.filter((p) => Math.abs(dist(p, centre) - 1.85) < 1e-6);
    expect(onArc.length).toBeGreaterThan(20);
    const face = faceOf(bay, faceKey(BAY.room.bayRoom, BAY.wall.bay, 'L'));
    expect(face.arc!.radius).toBeCloseTo(1.85, 12);
    for (const p of face.polyline) expect(dist(p, centre)).toBeCloseTo(1.85, 9);
  });

  test('the facade side runs on R + 0.15, keeping the wall 0.30 thick', () => {
    const face = faceOf(bay, faceKey(null, BAY.wall.bay, 'R'));
    expect(face.arc!.radius).toBeCloseTo(2.15, 12);
    for (const p of face.polyline) expect(dist(p, centre)).toBeCloseTo(2.15, 9);
    expect(2.15 - 1.85).toBeCloseTo(0.3, 12);
  });

  test('the bay face carries its window and a matching quad area', () => {
    const face = faceOf(bay, faceKey(BAY.room.bayRoom, BAY.wall.bay, 'L'));
    expect(face.openings.map((o) => o.id)).toEqual([BAY.opening.windowBay]);
    // The centreline window is scaled into the shorter inner face.
    expect(face.openings[0]!.t1 - face.openings[0]!.t0).toBeCloseTo(1.6 * (face.length / (Math.PI * 2)), 6);
    const holes = face.openings.reduce((sum, o) => sum + (o.t1 - o.t0) * (o.head - o.sill), 0);
    expect(quadsArea(face.quads)).toBeCloseTo(face.length * bayPlan.ceilingHeight - holes, 9);
  });

  test('the arc centreline is discretised for navigation', () => {
    const line = bay.centrelines.find((c) => c.wallId === BAY.wall.bay)!;
    expect(line.polyline.length).toBeGreaterThan(20);
    expect(line.length).toBeCloseTo(Math.PI * 2, 9);
    for (const p of line.polyline) expect(dist(p, centre)).toBeCloseTo(2, 9);
  });

  test('tangent straight walls join the arc without a step', () => {
    const room = roomOf(bay, BAY.room.bayRoom);
    expect(room.polygon.some((p) => Math.abs(p.x - 0.15) < 1e-9 && Math.abs(p.z) < 1e-9)).toBe(true);
    expect(room.polygon.some((p) => Math.abs(p.x - 3.85) < 1e-9 && Math.abs(p.z) < 1e-9)).toBe(true);
    expect(room.bbox.minZ).toBeCloseTo(-1.85, 9);
  });
});

/**
 * A semicircular bay spliced DIRECTLY into a straight facade run: the straight
 * walls leave the bay nodes along the chord, i.e. at 90 degrees to the arc
 * tangent, so the mitred face endpoints do NOT sit on the offset circle. This
 * guards the non-tangential junction against wrapping `arcProgress` around a
 * full turn, which would blow `t0` up to ~5e7 and lose the window.
 *
 *        p1(0,0)   p2(1.4,0)          p3(4.6,0)   p4(6,0)
 *          +---------+~~~ bay R=1.60 ~~~+-----------+
 *          |            (bulges to -z)              |
 *          +---------------------------------------+
 *        p6(0,4)                                  p5(6,4)
 */
describe('arc spliced into a straight wall without a tangent return', () => {
  type PlanInput = Parameters<typeof solvePlan>[0];

  const RADIUS = 1.6;
  const THICKNESS = 0.3;
  const ARC_LENGTH = Math.PI * RADIUS;
  const WINDOW_WIDTH = 1.2;
  /** Chord tolerance of the 5 mm sagitta budget, plus room for the mitres. */
  const CHORD_TOL = 0.01;

  const splicedBay = (ccw: boolean, windowCentre: number): PlanInput => ({
    ceilingHeight: 3.15,
    nodes: [
      { id: SPLICED.node.p1, p: { x: 0, z: 0 } },
      { id: SPLICED.node.p2, p: { x: 1.4, z: 0 } },
      { id: SPLICED.node.p3, p: { x: 4.6, z: 0 } },
      { id: SPLICED.node.p4, p: { x: 6, z: 0 } },
      { id: SPLICED.node.p5, p: { x: 6, z: 4 } },
      { id: SPLICED.node.p6, p: { x: 0, z: 4 } },
    ],
    walls: [
      { id: SPLICED.wall.nW, a: SPLICED.node.p1, b: SPLICED.node.p2, thickness: THICKNESS, role: 'facade' },
      {
        id: SPLICED.wall.bay,
        a: SPLICED.node.p2,
        b: SPLICED.node.p3,
        thickness: THICKNESS,
        role: 'facade',
        arc: { radius: RADIUS, ccw },
        openings: [{ id: SPLICED.opening.windowBay, type: 'window', center: windowCentre, width: WINDOW_WIDTH, sill: 0.85, head: 2.3 }],
      },
      { id: SPLICED.wall.nE, a: SPLICED.node.p3, b: SPLICED.node.p4, thickness: THICKNESS, role: 'facade' },
      { id: SPLICED.wall.east, a: SPLICED.node.p4, b: SPLICED.node.p5, thickness: THICKNESS, role: 'facade' },
      { id: SPLICED.wall.south, a: SPLICED.node.p5, b: SPLICED.node.p6, thickness: THICKNESS, role: 'facade' },
      { id: SPLICED.wall.west, a: SPLICED.node.p6, b: SPLICED.node.p1, thickness: THICKNESS, role: 'facade' },
    ],
    rooms: [{ id: SPLICED.room.hall, name: 'Hall', anchor: { x: 3, z: 2 }, floorMaterial: FINISH.oak }],
  });

  const bayFace = (plan: SolvedPlan, side: 'L' | 'R'): WallFace =>
    [...plan.faces.values()].find((f) => f.wallId === SPLICED.wall.bay && f.side === side)!;

  const outward = solvePlan(splicedBay(false, ARC_LENGTH / 2));

  test('both faces of the arc keep their window', () => {
    for (const side of ['L', 'R'] as const) {
      const face = bayFace(outward, side);
      expect(face.openings.map((o) => o.id)).toEqual([SPLICED.opening.windowBay]);
    }
  });

  test('t0 stays finite and inside the face', () => {
    for (const side of ['L', 'R'] as const) {
      const face = bayFace(outward, side);
      expect(Number.isFinite(face.t0)).toBe(true);
      expect(Math.abs(face.t0)).toBeLessThanOrEqual(face.length);
      // The mitre moves the face start by at most half a wall thickness.
      expect(Math.abs(face.t0)).toBeLessThanOrEqual(THICKNESS);
    }
  });

  test('each face is as long as its own offset arc, mitres included', () => {
    // Room side: the bay bulges away from the room, so both mitres LENGTHEN it.
    const inner = bayFace(outward, 'L');
    expect(inner.arc!.radius).toBeCloseTo(RADIUS - THICKNESS / 2, 12);
    expect(Math.abs(inner.length - (Math.PI * (RADIUS - THICKNESS / 2) + THICKNESS))).toBeLessThan(CHORD_TOL);
    // Facade side: the same corners are convex, so both mitres SHORTEN it.
    const outer = bayFace(outward, 'R');
    expect(outer.arc!.radius).toBeCloseTo(RADIUS + THICKNESS / 2, 12);
    expect(Math.abs(outer.length - (Math.PI * (RADIUS + THICKNESS / 2) - THICKNESS))).toBeLessThan(CHORD_TOL);
    expect(outer.arc!.radius - inner.arc!.radius).toBeCloseTo(THICKNESS, 12);
  });

  test('the opening lands on the same angles of the arc from both sides', () => {
    const centre = ARC_LENGTH / 2;
    const check = (plan: SolvedPlan, windowCentre: number) => {
      const from = windowCentre - WINDOW_WIDTH / 2;
      const to = windowCentre + WINDOW_WIDTH / 2;
      for (const side of ['L', 'R'] as const) {
        const face = bayFace(plan, side);
        const opening = face.openings[0]!;
        // (t0 + t) / radius is the angle travelled from the wall's own start;
        // an 'R' face travels the other way, so its angles mirror.
        const a0 = (face.t0 + opening.t0) / face.arc!.radius;
        const a1 = (face.t0 + opening.t1) / face.arc!.radius;
        const expected0 = (side === 'L' ? from : ARC_LENGTH - to) / RADIUS;
        const expected1 = (side === 'L' ? to : ARC_LENGTH - from) / RADIUS;
        expect(a0).toBeCloseTo(expected0, 2);
        expect(a1).toBeCloseTo(expected1, 2);
      }
    };
    check(outward, centre);
    // Off-centre, so the mirroring cannot pass by symmetry alone.
    check(solvePlan(splicedBay(false, centre - 0.8)), centre - 0.8);
  });

  test('an arc bulging into the room is solved the same way', () => {
    const inward = solvePlan(splicedBay(true, ARC_LENGTH / 2 + 0.4));
    for (const side of ['L', 'R'] as const) {
      const face = bayFace(inward, side);
      expect(face.openings.map((o) => o.id)).toEqual([SPLICED.opening.windowBay]);
      expect(Number.isFinite(face.t0)).toBe(true);
      expect(Math.abs(face.t0)).toBeLessThanOrEqual(THICKNESS);
      expect(Math.abs(face.length - Math.PI * face.arc!.radius)).toBeLessThanOrEqual(THICKNESS + CHORD_TOL);
      const holes = face.openings.reduce((sum, o) => sum + (o.t1 - o.t0) * (o.head - o.sill), 0);
      expect(quadsArea(face.quads)).toBeCloseTo(face.length * 3.15 - holes, 9);
    }
    const radii = (['L', 'R'] as const).map((s) => bayFace(inward, s).arc!.radius).sort((a, b) => a - b);
    expect(radii[1]! - radii[0]!).toBeCloseTo(THICKNESS, 12);
  });
});

describe('planar embedding', () => {
  test('the demo apartment solves', () => {
    const plan = solvePlan(apartmentScene);
    expect(plan.rooms.length).toBe(apartmentScene.rooms.length);
    expect(plan.centrelines.length).toBe(apartmentScene.walls.length);
    expect(plan.facade.length).toBeGreaterThan(0);
  });

  test('the bay keeps a constant thickness on both sides of its arc', () => {
    const inner = [...bay.faces.values()].find((f) => f.wallId === BAY.wall.bay && f.side === 'L')!;
    const outer = [...bay.faces.values()].find((f) => f.wallId === BAY.wall.bay && f.side === 'R')!;
    expect(outer.arc!.radius - inner.arc!.radius).toBeCloseTo(0.3, 12);
    for (const p of inner.polyline) expect(dist(p, inner.arc!.centre)).toBeCloseTo(1.85, 9);
    for (const p of outer.polyline) expect(dist(p, outer.arc!.centre)).toBeCloseTo(2.15, 9);
  });

  test('a wall crossing another one without a node fails with NON_PLANAR', () => {
    const scene = {
      ceilingHeight: lShapePlan.ceilingHeight,
      nodes: [...lShapePlan.nodes, { id: CROSSING.node.x1, p: { x: 3, z: -1 } }, { id: CROSSING.node.x2, p: { x: 3, z: 3 } }],
      walls: [...lShapePlan.walls, { id: CROSSING.wall.wCross, a: CROSSING.node.x1, b: CROSSING.node.x2, thickness: 0.1 }],
      rooms: lShapePlan.rooms,
    };
    try {
      solvePlan(scene);
      throw new Error('expected PlanError');
    } catch (error) {
      expect((error as PlanError).planCode).toBe('NON_PLANAR');
      expect((error as PlanError).message).toContain(L_SHAPE.wall.wSA);
    }
  });
});
