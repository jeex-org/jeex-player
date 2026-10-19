/**
 * Floor outlines: the notch geometry of floor continuity through doorways.
 *
 * The invariant the visible bug came from: two rooms sharing a doorway must
 * meet AT the wall centreline, edge to edge — no gap that shows the site slab,
 * no overlap that would z-fight. Both halves are asserted here on the demo
 * apartment: the centreline midpoint of every interior door sits on the
 * boundary of both outlines, and no two outlines share any area at all.
 */

import { describe, expect, test } from 'bun:test';
import { floorNotches, floorOutline } from './floor-outline.js';
import { cross, dist, distanceToPolygon, pointInPolygon, signedArea, sub } from './plan-geometry.js';
import { solvePlan, type SolvedPlan } from './plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { faceKey, isDoorLike, type Opening, type SceneData, type Vec2, type Wall } from '../scene/types.js';

const demoPlan: SolvedPlan = solvePlan(apartmentScene);
const lShapeSolved: SolvedPlan = solvePlan(lShapePlan);

/** A room UUID the demo does not have. */
const NO_SUCH_ROOM = '01a12ff3-e14f-7f53-abb2-582bdc21007f';

/** Millimetre: the tolerance for "on the boundary". */
const MM = 1e-3;

/** Point at centreline distance `s` from node `a`, by fraction of the length. */
function centrelinePoint(plan: SolvedPlan, wallId: string, s: number): { point: Vec2; tangent: Vec2 } {
  const line = plan.centrelines.find((candidate) => candidate.wallId === wallId)!;
  let total = 0;
  for (let i = 0; i + 1 < line.polyline.length; i += 1) total += dist(line.polyline[i]!, line.polyline[i + 1]!);
  let target = (s / line.length) * total;
  for (let i = 0; i + 1 < line.polyline.length; i += 1) {
    const a = line.polyline[i]!;
    const b = line.polyline[i + 1]!;
    const step = dist(a, b);
    if (step <= 0) continue;
    if (target <= step || i + 2 === line.polyline.length) {
      const k = Math.min(1, Math.max(0, target / step));
      return {
        point: { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k },
        tangent: { x: (b.x - a.x) / step, z: (b.z - a.z) / step },
      };
    }
    target -= step;
  }
  const last = line.polyline.at(-1)!;
  return { point: { x: last.x, z: last.z }, tangent: { x: 1, z: 0 } };
}

type DoorSite = { opening: Opening; wall: Wall; rooms: string[]; exterior: boolean };

/** Every door-like opening of `scene` with the rooms its two wall sides serve. */
function doorSites(scene: SceneData, plan: SolvedPlan): DoorSite[] {
  const sites: DoorSite[] = [];
  for (const wall of scene.walls) {
    for (const opening of wall.openings ?? []) {
      if (!isDoorLike(opening.type)) continue;
      const rooms: string[] = [];
      let exterior = false;
      for (const side of ['L', 'R'] as const) {
        const room = plan.faces.get(faceKey(null, wall.id, side))
          ? null
          : plan.rooms.find((candidate) => candidate.loop.some((face) => face.wallId === wall.id && face.side === side));
        if (room) rooms.push(room.roomId);
        else exterior = true;
      }
      sites.push({ opening, wall, rooms, exterior });
    }
  }
  return sites;
}

// ------------------------------------------------- polygon overlap helper ----

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const s1 = cross(sub(b, a), sub(p, a));
  const s2 = cross(sub(c, b), sub(p, b));
  const s3 = cross(sub(a, c), sub(p, c));
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

/** Ear-clipping triangulation of a simple polygon, positively oriented. */
function triangulate(polygon: Vec2[]): Vec2[][] {
  const verts = signedArea(polygon) < 0 ? [...polygon].reverse() : [...polygon];
  const out: Vec2[][] = [];
  let guard = verts.length * verts.length + 16;
  while (verts.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let i = 0; i < verts.length; i += 1) {
      const a = verts[(i + verts.length - 1) % verts.length]!;
      const b = verts[i]!;
      const c = verts[(i + 1) % verts.length]!;
      if (cross(sub(b, a), sub(c, b)) <= 0) continue;
      let blocked = false;
      for (const p of verts) {
        if (p === a || p === b || p === c) continue;
        if (inTriangle(p, a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      out.push([a, b, c]);
      verts.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (verts.length === 3) out.push([verts[0]!, verts[1]!, verts[2]!]);
  return out;
}

/** Sutherland–Hodgman clip of `subject` against the convex, CCW `clip`. */
function clipConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  let output = subject;
  for (let i = 0; i < clip.length && output.length > 0; i += 1) {
    const a = clip[i]!;
    const edge = sub(clip[(i + 1) % clip.length]!, a);
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j += 1) {
      const p = input[j]!;
      const q = input[(j + 1) % input.length]!;
      const sp = cross(edge, sub(p, a));
      const sq = cross(edge, sub(q, a));
      if (sp >= 0) output.push(p);
      if (sp >= 0 !== sq >= 0) {
        const k = sp / (sp - sq);
        output.push({ x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k });
      }
    }
  }
  return output;
}

function intersectionArea(a: Vec2[], b: Vec2[]): number {
  let total = 0;
  for (const triA of triangulate(a)) {
    for (const triB of triangulate(b)) {
      total += Math.abs(signedArea(clipConvex(triA, triB)));
    }
  }
  return total;
}

// ------------------------------------------------------------------ tests ----

describe('floorOutline', () => {
  test('the outline only ADDS to the solver polygon', () => {
    for (const room of [...demoPlan.rooms, ...lShapeSolved.rooms]) {
      const scene = demoPlan.rooms.includes(room) ? apartmentScene : lShapePlan;
      const plan = demoPlan.rooms.includes(room) ? demoPlan : lShapeSolved;
      const outline = floorOutline(plan, scene, room.roomId);
      for (const vertex of room.polygon) {
        expect({ room: room.roomId, kept: distanceToPolygon(vertex, outline).distance <= MM }).toEqual({ room: room.roomId, kept: true });
      }
    }
  });

  test('an unknown room has no outline', () => {
    expect(floorOutline(demoPlan, apartmentScene, NO_SUCH_ROOM)).toEqual([]);
    expect(floorNotches(demoPlan, apartmentScene, NO_SUCH_ROOM)).toEqual([]);
  });

  test('every outline stays positively oriented and grows by the notch area', () => {
    for (const room of demoPlan.rooms) {
      const outline = floorOutline(demoPlan, apartmentScene, room.roomId);
      const notches = floorNotches(demoPlan, apartmentScene, room.roomId);
      expect(signedArea(outline)).toBeGreaterThan(0);
      const added = notches.reduce((sum, notch) => sum + Math.abs(signedArea(notch.quad)), 0);
      expect(signedArea(outline)).toBeCloseTo(signedArea(room.polygon) + added, 9);
    }
  });

  test('the demo has one notch per door-like opening on a room face', () => {
    const built = new Map<string, string[]>();
    for (const room of demoPlan.rooms) {
      for (const notch of floorNotches(demoPlan, apartmentScene, room.roomId)) {
        built.set(notch.openingId, [...(built.get(notch.openingId) ?? []), room.roomId]);
      }
    }
    for (const site of doorSites(apartmentScene, demoPlan)) {
      expect({ id: site.opening.id, rooms: built.get(site.opening.id)?.length ?? 0 }).toEqual({
        id: site.opening.id,
        rooms: site.rooms.length,
      });
    }
  });

  test('a notch is as wide as its opening and reaches the centreline', () => {
    for (const room of demoPlan.rooms) {
      for (const notch of floorNotches(demoPlan, apartmentScene, room.roomId)) {
        const site = doorSites(apartmentScene, demoPlan).find((s) => s.opening.id === notch.openingId)!;
        const width = dist(notch.quad[0]!, notch.quad[3]!);
        const depth = dist(notch.quad[0]!, notch.quad[1]!);
        const expected = site.exterior ? site.wall.thickness : site.wall.thickness / 2;
        expect({ id: notch.openingId, width: Math.abs(width - site.opening.width) < MM }).toEqual({
          id: notch.openingId,
          width: true,
        });
        expect({ id: notch.openingId, depth: Math.abs(depth - expected) < MM }).toEqual({
          id: notch.openingId,
          depth: true,
        });
      }
    }
  });

  test('two rooms sharing a door meet ON the centreline, from both sides', () => {
    for (const site of doorSites(apartmentScene, demoPlan)) {
      if (site.rooms.length !== 2) continue;
      const { point } = centrelinePoint(demoPlan, site.wall.id, site.opening.center);
      for (const roomId of site.rooms) {
        const outline = floorOutline(demoPlan, apartmentScene, roomId);
        const gap = distanceToPolygon(point, outline).distance;
        expect({ door: site.opening.id, room: roomId, onBoundary: gap <= MM }).toEqual({
          door: site.opening.id,
          room: roomId,
          onBoundary: true,
        });
      }
    }
  });

  test('the entrance floor runs to the exterior face of the facade wall', () => {
    const site = doorSites(apartmentScene, demoPlan).find((candidate) => candidate.opening.entrance === true)!;
    expect(site.rooms).toEqual([DEMO.room.hall]);
    const { point, tangent } = centrelinePoint(demoPlan, site.wall.id, site.opening.center);
    const outline = floorOutline(demoPlan, apartmentScene, DEMO.room.hall);
    const half = site.wall.thickness / 2;
    const normal = { x: -tangent.z, z: tangent.x };
    const sides = [
      { x: point.x + normal.x * half, z: point.z + normal.z * half },
      { x: point.x - normal.x * half, z: point.z - normal.z * half },
    ];
    const hall = demoPlan.rooms.find((room) => room.roomId === DEMO.room.hall)!.polygon;
    const inner = sides.find((candidate) => pointInPolygon(candidate, hall))!;
    const outer = sides.find((candidate) => candidate !== inner)!;
    // The notch reaches the exterior plane, so the OUTER face point is on the
    // outline and the inner one is swallowed by the notch.
    expect(distanceToPolygon(outer, outline).distance).toBeLessThanOrEqual(MM);
    expect(pointInPolygon(inner, outline)).toBe(true);
    expect(distanceToPolygon(inner, outline).distance).toBeGreaterThan(0.1);
  });

  test('no two room floors overlap', () => {
    const outlines = demoPlan.rooms.map((room) => ({
      id: room.roomId,
      polygon: floorOutline(demoPlan, apartmentScene, room.roomId),
    }));
    for (let i = 0; i < outlines.length; i += 1) {
      for (let j = i + 1; j < outlines.length; j += 1) {
        const area = intersectionArea(outlines[i]!.polygon, outlines[j]!.polygon);
        expect({ pair: `${outlines[i]!.id}/${outlines[j]!.id}`, clear: area < 1e-6 }).toEqual({
          pair: `${outlines[i]!.id}/${outlines[j]!.id}`,
          clear: true,
        });
      }
    }
  });
});
