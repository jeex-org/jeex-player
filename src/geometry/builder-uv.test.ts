import { describe, expect, test } from 'bun:test';
import { faceUV, placeFaceLocal, quadPrism } from './builder-uv.js';
import { faceQuads, type FaceOpening } from '../plan/plan-openings.js';
import type { Vec2 } from '../scene/types.js';

/** A door this file invents; only its span matters, its id is any UUID. */
const DOOR: FaceOpening = { id: '01a12ffa-e52d-7898-b0a1-ebb604eb84b6', type: 'door', t0: 0.6, t1: 1.6, sill: 0, head: 2.1, shape: 'flat' };

describe('faceUV', () => {
  test('returns metres, not tile counts', () => {
    expect(faceUV(1.2, 0.4, 2)).toEqual({ u: 1.6, v: 2 });
  });

  test('u stays continuous across a door split of one face', () => {
    const faceT0 = 0.15;
    const quads = faceQuads(4, 3.15, [DOOR]);
    const pierBefore = quads.find((q) => q.kind === 'pier' && q.t0 === 0)!;
    const pierAfter = quads.find((q) => q.kind === 'pier' && q.t0 > 1)!;
    // The pier after the door starts at t = 1.6, so its u continues the face.
    expect(pierAfter.t0).toBeCloseTo(1.6, 9);
    expect(faceUV(faceT0, pierBefore.t1, 0).u).toBeCloseTo(0.6 + faceT0, 9);
    expect(faceUV(faceT0, pierAfter.t0, 0).u).toBeCloseTo(1.6 + faceT0, 9);
    // The lintel over the door bridges the two piers with no UV jump.
    const lintel = quads.find((q) => q.kind === 'lintel')!;
    expect(faceUV(faceT0, lintel.t0, 0).u).toBeCloseTo(faceUV(faceT0, pierBefore.t1, 0).u, 9);
    expect(faceUV(faceT0, lintel.t1, 0).u).toBeCloseTo(faceUV(faceT0, pierAfter.t0, 0).u, 9);
  });
});

describe('quadPrism', () => {
  const quad = { t0: 1.6, t1: 4, y0: 0, y1: 3.15, kind: 'pier' as const };
  const prism = quadPrism(quad, 0.15, 0.153);

  test('is a closed box: 8 vertices, 12 triangles', () => {
    expect(prism.positions.length).toBe(8 * 3);
    expect(prism.uvs.length).toBe(8 * 2);
    expect(prism.indices.length).toBe(12 * 3);
  });

  test('uses face UVs in metres offset by the face t0', () => {
    // Vertex 0 is the bottom-left of the front plane.
    expect(prism.uvs[0]).toBeCloseTo(0.15 + 1.6, 9);
    expect(prism.uvs[1]).toBeCloseTo(0, 9);
    // Vertex 2 is the top-right of the front plane.
    expect(prism.uvs[4]).toBeCloseTo(0.15 + 4, 9);
    expect(prism.uvs[5]).toBeCloseTo(3.15, 9);
  });

  test('extrudes from the face plane (z = 0) into the wall (z = +depth)', () => {
    const zs = [];
    for (let i = 2; i < prism.positions.length; i += 3) zs.push(prism.positions[i]!);
    expect(zs.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(zs.slice(4)).toEqual([0.153, 0.153, 0.153, 0.153]);
  });

  test('local x spans the quad and local y its height', () => {
    expect(prism.positions[0]).toBeCloseTo(1.6, 9);
    expect(prism.positions[1]).toBeCloseTo(0, 9);
    expect(prism.positions[3]).toBeCloseTo(4, 9);
    expect(prism.positions[7]).toBeCloseTo(3.15, 9);
  });
});

describe('placeFaceLocal', () => {
  const start: Vec2 = { x: 2, z: 5 };
  // Face running along +z with its room on the -x side.
  const tangent: Vec2 = { x: 0, z: 1 };
  const normal: Vec2 = { x: -1, z: 0 };

  test('maps the local origin to the face start point at floor level', () => {
    expect(placeFaceLocal({ x: 0, y: 0, z: 0 }, start, tangent, normal)).toEqual({ x: 2, y: 0, z: 5 });
  });

  test('local x runs along the face tangent, local y is world up', () => {
    expect(placeFaceLocal({ x: 1.5, y: 2, z: 0 }, start, tangent, normal)).toEqual({ x: 2, y: 2, z: 6.5 });
  });

  test('local +z leaves the face plane on the side away from the room', () => {
    const depth = 0.153;
    const world = placeFaceLocal({ x: 0, y: 0, z: depth }, start, tangent, normal);
    const away = (world.x - start.x) * normal.x + (world.z - start.z) * normal.z;
    expect(away).toBeCloseTo(-depth, 9);
    expect(world).toEqual({ x: 2.153, y: 0, z: 5 });
  });

  test('front triangles wind so their world normal is the face normal', () => {
    const prism = quadPrism({ t0: 0, t1: 2, y0: 0, y1: 3, kind: 'pier' }, 0, 0.153);
    const corner = (index: number) => {
      const i = prism.indices[index]!;
      return placeFaceLocal(
        { x: prism.positions[i * 3]!, y: prism.positions[i * 3 + 1]!, z: prism.positions[i * 3 + 2]! },
        start,
        tangent,
        normal,
      );
    };
    const [a, b, c] = [corner(0), corner(1), corner(2)];
    const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const e2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const cross = {
      x: e1.y * e2.z - e1.z * e2.y,
      y: e1.z * e2.x - e1.x * e2.z,
      z: e1.x * e2.y - e1.y * e2.x,
    };
    const length = Math.hypot(cross.x, cross.y, cross.z);
    expect(cross.x / length).toBeCloseTo(normal.x, 9);
    expect(cross.y / length).toBeCloseTo(0, 9);
    expect(cross.z / length).toBeCloseTo(normal.z, 9);
  });
});
