import { describe, expect, test } from 'bun:test';
import { boardUV, faceUV, placeFaceLocal, quadPrism } from './builder-uv.js';
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

  test('is a closed box of six faces, four vertices each, 12 triangles', () => {
    expect(prism.positions.length).toBe(24 * 3);
    expect(prism.uvs.length).toBe(24 * 2);
    expect(prism.indices.length).toBe(12 * 3);
  });

  /** The UVs and positions of one four-vertex face of the prism: front, back, start, end, bottom, top. */
  const faceOf = (index: number) => {
    const at = (vertex: number) => ({
      x: prism.positions[vertex * 3]!,
      y: prism.positions[vertex * 3 + 1]!,
      z: prism.positions[vertex * 3 + 2]!,
      u: prism.uvs[vertex * 2]!,
      v: prism.uvs[vertex * 2 + 1]!,
    });
    return [0, 1, 2, 3].map((corner) => at(index * 4 + corner));
  };
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);

  test('each reveal strip has its own metre UVs, as dense across its depth as the front is', () => {
    for (const index of [2, 3]) {
      // A side reveal: u runs across the depth, v up the height.
      const strip = faceOf(index);
      expect(span(strip.map((corner) => corner.u))).toBeCloseTo(0.153, 9);
      expect(span(strip.map((corner) => corner.v))).toBeCloseTo(3.15, 9);
    }
    for (const index of [4, 5]) {
      // A sill or a head: u along the face, v across the depth.
      const strip = faceOf(index);
      expect(span(strip.map((corner) => corner.u))).toBeCloseTo(2.4, 9);
      expect(span(strip.map((corner) => corner.v))).toBeCloseTo(0.153, 9);
    }
  });

  test('a reveal continues the front plane at the edge it shares with it', () => {
    const front = faceOf(0);
    for (const index of [2, 3, 4, 5]) {
      for (const corner of faceOf(index).filter((candidate) => candidate.z === 0)) {
        const twin = front.find((candidate) => candidate.x === corner.x && candidate.y === corner.y)!;
        expect({ index, u: corner.u, v: corner.v }).toEqual({ index, u: twin.u, v: twin.v });
      }
    }
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
    // The first four vertices are the front plane, the next four the back plane.
    expect(zs.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(zs.slice(4, 8)).toEqual([0.153, 0.153, 0.153, 0.153]);
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

describe('boardUV: baseboards in metres', () => {
  // A 3 m board, 0.08 m high and 0.015 m deep, whose centre sits at u = 2.5 of its face.
  const board = { centreU: 2.5, height: 0.08, depth: 0.015 };

  test('the front runs along the face in metres and up the height: three tiles of [1, 1] on a 3 m board', () => {
    const left = boardUV({ x: -1.5, y: -0.04, z: 0.0075 }, { x: 0, y: 0, z: 1 }, board);
    const right = boardUV({ x: 1.5, y: 0.04, z: 0.0075 }, { x: 0, y: 0, z: 1 }, board);
    expect(right[0] - left[0]).toBeCloseTo(3, 9);
    expect(left[0]).toBeCloseTo(1, 9);
    expect(right[1] - left[1]).toBeCloseTo(0.08, 9);
  });

  test('the top carries the length and the depth, an end the depth and the height', () => {
    const topA = boardUV({ x: -1.5, y: 0.04, z: -0.0075 }, { x: 0, y: 1, z: 0 }, board);
    const topB = boardUV({ x: 1.5, y: 0.04, z: 0.0075 }, { x: 0, y: 1, z: 0 }, board);
    expect([topB[0] - topA[0], topB[1] - topA[1]].map((value) => Number(value.toFixed(9)))).toEqual([3, 0.015]);
    const endA = boardUV({ x: 1.5, y: -0.04, z: -0.0075 }, { x: 1, y: 0, z: 0 }, board);
    const endB = boardUV({ x: 1.5, y: 0.04, z: 0.0075 }, { x: 1, y: 0, z: 0 }, board);
    expect([endB[0] - endA[0], endB[1] - endA[1]].map((value) => Number(value.toFixed(9)))).toEqual([0.015, 0.08]);
  });
});
