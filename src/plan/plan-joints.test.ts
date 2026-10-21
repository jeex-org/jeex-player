import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import { bayPlan, lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import {
  ARC_TOL,
  EPS,
  add,
  arcFromChord,
  arcPointAt,
  arcTangent,
  boundsOf,
  cross,
  dist,
  distanceToPolygon,
  leftN,
  mul,
  norm,
  pointInPolygon,
  signedArea,
  sub,
} from './plan-geometry.js';
import { jointCores } from './plan-joints.js';
import { solvePlan } from './plan-solver.js';
import type { SceneData, Vec2, Wall } from '../scene/types.js';

/** The straight run whose thickness steps at j2, in the last test. */
const JOG = {
  node: {
    j1: '01a12ff4-cf2d-7dcb-8522-c06a9c55109c',
    j2: '01a12ff4-cf2e-7cb0-ba77-dab7c130352a',
    j3: '01a12ff4-cf2f-7c71-9122-9748ee62a1e5',
    j4: '01a12ff4-cf30-79a9-99ff-c2f44f58a81a',
    j5: '01a12ff4-cf31-703b-97ba-2dd5f86693b0',
  },
  wall: {
    sThick: '01a12ff4-cf32-72bb-bfdb-5933feef4bb0',
    sThin: '01a12ff4-cf33-7217-b5bd-41fd84f26035',
    e: '01a12ff4-cf34-7f07-be15-f1afef6e0b8f',
    n: '01a12ff4-cf35-7883-928b-6cca533c510b',
    w: '01a12ff4-cf36-7736-84d8-358fd4764978',
  },
  room: { only: '01a12ff4-cf37-7a25-8074-90ec887ae84d' },
} as const;

/** Face slab depth as a fraction of the wall thickness; `shell-builder.ts`. */
const FACE_DEPTH_RATIO = 0.51;

const PLANS: Array<[string, SceneData]> = [
  ['lShapePlan', lShapePlan],
  ['bayPlan', bayPlan],
  ['apartmentScene', apartmentScene],
];

/** Two segments cross away from their shared endpoints. */
function segmentsCross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d = sub(a2, a1);
  const e = sub(b2, b1);
  const denom = cross(d, e);
  if (Math.abs(denom) < 1e-12) return false;
  const w = sub(b1, a1);
  const t = cross(w, e) / denom;
  const s = cross(w, d) / denom;
  const inner = (v: number): boolean => v > 1e-9 && v < 1 - 1e-9;
  return inner(t) && inner(s);
}

/** True when two non-adjacent edges of the polygon cross. */
function selfIntersects(polygon: Vec2[]): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCross(polygon[i]!, polygon[(i + 1) % n]!, polygon[j]!, polygon[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/**
 * Plan footprint of every face prism: each straight run of a face polyline
 * extruded `FACE_DEPTH_RATIO * thickness` from the face plane INTO the wall,
 * exactly as `shell-builder.buildFace` does. Every opening of the demo plans
 * has a lintel, so a face covers its whole length at some height.
 */
function facePrints(scene: SceneData): Vec2[][] {
  const plan = solvePlan(scene);
  const walls = new Map(scene.walls.map((wall) => [wall.id, wall]));
  const prints: Vec2[][] = [];
  for (const face of plan.faces.values()) {
    const depth = FACE_DEPTH_RATIO * walls.get(face.wallId)!.thickness;
    const runs: Array<{ a: Vec2; b: Vec2; normal: Vec2 }> = [];
    for (let i = 0; i + 1 < face.polyline.length; i += 1) {
      const a = face.polyline[i]!;
      const b = face.polyline[i + 1]!;
      if (dist(a, b) <= EPS) continue;
      runs.push({ a, b, normal: leftN(norm(sub(b, a))) });
    }
    runs.forEach((run, i) => {
      // `shell-builder.segmentNormals`: two runs sharing a vertex extrude along
      // the same bisector there, so their footprints share that edge exactly.
      const previous = runs[i - 1];
      const next = runs[i + 1];
      const atStart = previous ? norm(add(previous.normal, run.normal)) : run.normal;
      const atEnd = next ? norm(add(run.normal, next.normal)) : run.normal;
      prints.push([run.a, run.b, add(run.b, mul(atEnd, -depth)), add(run.a, mul(atStart, -depth))]);
    });
  }
  return prints;
}

/** Sample points across the body of `wall`: `count` stations, five per station. */
function bodySamples(scene: SceneData, wall: Wall, count: number): Vec2[] {
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const a = nodes.get(wall.a)!.p;
  const b = nodes.get(wall.b)!.p;
  const arc = wall.arc ? arcFromChord(a, b, wall.arc.radius, wall.arc.ccw) : null;
  // A curved wall is BUILT as chords, so its skin sits up to one sagitta inside
  // the ideal arc; sampling the ideal surface would report that as a hole.
  const half = wall.thickness / 2 - (arc ? ARC_TOL : 0);
  const out: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const k = (i + 0.5) / count;
    const centre = arc ? arcPointAt(arc, arc.a0 + arc.sweep * k) : add(a, mul(sub(b, a), k));
    const tangent = arc ? arcTangent(arc, arc.a0 + arc.sweep * k) : norm(sub(b, a));
    const normal = leftN(tangent);
    for (const fraction of [-0.97, -0.5, 0, 0.5, 0.97]) {
      out.push(add(centre, mul(normal, fraction * half)));
    }
  }
  return out;
}

function covers(polygons: Vec2[][], point: Vec2): boolean {
  for (const polygon of polygons) {
    const box = boundsOf(polygon);
    if (point.x < box.minX - EPS || point.x > box.maxX + EPS) continue;
    if (point.z < box.minZ - EPS || point.z > box.maxZ + EPS) continue;
    if (pointInPolygon(point, polygon)) return true;
  }
  return false;
}

describe('joint cores', () => {
  for (const [label, scene] of PLANS) {
    test(`${label}: every core is a simple, positively oriented polygon`, () => {
      const cores = jointCores(scene);
      expect(cores.length).toBeGreaterThan(0);
      for (const core of cores) {
        expect(core.polygon.length).toBeGreaterThanOrEqual(3);
        expect(signedArea(core.polygon)).toBeGreaterThan(0);
        expect(core.area).toBeGreaterThan(0);
        expect(selfIntersects(core.polygon)).toBe(false);
        expect(core.wallIds.length).toBeGreaterThanOrEqual(2);
      }
      expect(new Set(cores.map((core) => core.nodeId)).size).toBe(cores.length);
    });

    test(`${label}: a core needs one wall it belongs to and never floats`, () => {
      const cores = jointCores(scene);
      const wallIds = new Set(scene.walls.map((wall) => wall.id));
      for (const core of cores) {
        for (const id of core.wallIds) expect(wallIds.has(id)).toBe(true);
      }
    });

    /**
     * The invariant the bug was about: sample the body of every wall — 24
     * stations, five points across the thickness — and require each sample to
     * sit in a face-prism footprint or in a joint core. Before the cores, the
     * samples around every T-junction and mitred corner were uncovered, which
     * is the open slot seen from above.
     */
    test(`${label}: face prisms plus cores cover every wall body, no gap`, () => {
      const prints = facePrints(scene);
      const cores = jointCores(scene).map((core) => core.polygon);
      const uncovered: string[] = [];
      for (const wall of scene.walls) {
        for (const sample of bodySamples(scene, wall, 24)) {
          if (covers(prints, sample) || covers(cores, sample)) continue;
          uncovered.push(`${wall.id} (${sample.x.toFixed(3)}, ${sample.z.toFixed(3)})`);
        }
      }
      expect(uncovered).toEqual([]);
    });

    test(`${label}: no core reaches into a room`, () => {
      const plan = solvePlan(scene);
      const cores = jointCores(scene);
      // A core edge may lie ON a room face; only crossing it is a defect. Arc
      // faces are discretised, so a chord cuts up to `ARC_TOL` into the room.
      const tolerance = ARC_TOL + 1e-4;
      const inside: string[] = [];
      for (const core of cores) {
        for (let i = 0; i < core.polygon.length; i += 1) {
          const a = core.polygon[i]!;
          const b = core.polygon[(i + 1) % core.polygon.length]!;
          for (const k of [0, 0.25, 0.5, 0.75]) {
            const point = add(a, mul(sub(b, a), k));
            for (const room of plan.rooms) {
              if (!pointInPolygon(point, room.polygon)) continue;
              if (distanceToPolygon(point, room.polygon).distance <= tolerance) continue;
              inside.push(`${core.nodeId} -> ${room.roomId} at (${point.x.toFixed(3)}, ${point.z.toFixed(3)})`);
            }
          }
        }
      }
      expect(inside).toEqual([]);
    });
  }

  test('a T-junction core is the wall core the split face leaves open', () => {
    // lShapePlan n2 (6, 0): the 0.30 south facade runs through, the 0.10
    // partition meets it from the north. The partition splits the north face at
    // x = 5.95 and x = 6.05, so the core is exactly that slice of the wall.
    const core = jointCores(lShapePlan).find((candidate) => candidate.nodeId === L_SHAPE.node.n2);
    expect(core).toBeDefined();
    expect(core!.wallIds.slice().sort()).toEqual([L_SHAPE.wall.wPart, L_SHAPE.wall.wSA, L_SHAPE.wall.wSB].sort());
    expect(core!.area).toBeCloseTo(0.1 * 0.3, 9);
    const box = boundsOf(core!.polygon);
    expect(box.minX).toBeCloseTo(5.95, 9);
    expect(box.maxX).toBeCloseTo(6.05, 9);
    expect(box.minZ).toBeCloseTo(-0.15, 9);
    expect(box.maxZ).toBeCloseTo(0.15, 9);
  });

  test('a corner core fills the square between the two mitred ends', () => {
    // lShapePlan n1 (0, 0): two 0.30 facade walls at a right angle.
    const core = jointCores(lShapePlan).find((candidate) => candidate.nodeId === L_SHAPE.node.n1);
    expect(core).toBeDefined();
    expect(core!.area).toBeCloseTo(0.3 * 0.3, 9);
    const box = boundsOf(core!.polygon);
    expect(box.minX).toBeCloseTo(-0.15, 9);
    expect(box.maxX).toBeCloseTo(0.15, 9);
    expect(box.minZ).toBeCloseTo(-0.15, 9);
    expect(box.maxZ).toBeCloseTo(0.15, 9);
  });

  test('a thickness step on a straight run needs no core', () => {
    // A 0.38 wall continues straight on as 0.30 at j2, and both prisms
    // already cover their own cross-section up to the node.
    const jog: SceneData = {
      ...lShapePlan,
      nodes: [
        { id: JOG.node.j1, p: { x: 0, z: 0 } },
        { id: JOG.node.j2, p: { x: 4, z: 0 } },
        { id: JOG.node.j3, p: { x: 8, z: 0 } },
        { id: JOG.node.j4, p: { x: 8, z: 4 } },
        { id: JOG.node.j5, p: { x: 0, z: 4 } },
      ],
      walls: [
        { id: JOG.wall.sThick, a: JOG.node.j1, b: JOG.node.j2, thickness: 0.38 },
        { id: JOG.wall.sThin, a: JOG.node.j2, b: JOG.node.j3, thickness: 0.1 },
        { id: JOG.wall.e, a: JOG.node.j3, b: JOG.node.j4, thickness: 0.3 },
        { id: JOG.wall.n, a: JOG.node.j4, b: JOG.node.j5, thickness: 0.3 },
        { id: JOG.wall.w, a: JOG.node.j5, b: JOG.node.j1, thickness: 0.3 },
      ],
      rooms: [{ id: JOG.room.only, name: 'Only', kind: 'room', anchor: { x: 4, z: 2 }, floorMaterial: FINISH.oak }],
      assets: [],
    };
    const core = jointCores(jog).find((candidate) => candidate.nodeId === JOG.node.j2);
    expect(core).toBeUndefined();
  });
});
