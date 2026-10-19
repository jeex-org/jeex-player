import { describe, expect, test } from 'bun:test';
import {
  CEILING_OPENING_MARGIN,
  DEFAULT_DOOR_HEAD,
  DEFAULT_WINDOW_HEAD,
  DEFAULT_WINDOW_SILL,
  faceQuads,
  openingsForFace,
  quadsArea,
} from './plan-openings.js';
import type { Opening, Wall } from '../scene/types.js';

/** Ids of the walls, nodes and openings below, keyed by the readable id each replaces. */
const ID = {
  w: '01a12ff5-b015-773b-9cd0-910f7a5dbcdc',
  a: '01a12ff5-b016-7df5-b581-17c1f36dc6ef',
  b: '01a12ff5-b017-75ed-8abb-f1450725cdb6',
  doorHall: '01a12ff5-b018-741b-b28d-e8974a15dca6',
  windowNorth: '01a12ff5-b019-7981-9ca6-3adbb3dbced6',
  d: '01a12ff5-b01a-7180-950e-be4d8869d2c2',
  w1: '01a12ff5-b01b-7f5b-b9e1-8e1bccea5695',
  o: '01a12ff5-b01c-77d6-9f37-135fbb3712b9',
  doorway: '01a12ff5-b01d-7598-976d-dbc8dc80b1c9',
  win: '01a12ff5-b01e-779c-8ada-a391022b0ddc',
  big: '01a12ff5-b01f-7719-97c3-0d9d7f3c95e8',
  small: '01a12ff5-b020-7179-8f06-998e464d4f9b',
  later: '01a12ff5-b021-796b-b429-828e85023a98',
  earlier: '01a12ff5-b022-7862-a64f-ed1d8f431953',
} as const;

const wallWith = (openings: Opening[], id = ID.w): Wall => ({ id, a: ID.a, b: ID.b, thickness: 0.3, openings });

/** Reference example: a 5.8 m face 3.15 m high with one door and one window. */
const REFERENCE_WALL = wallWith([
  { id: ID.doorHall, type: 'door', center: 1.1, width: 1.0, sill: 0, head: 2.15 },
  { id: ID.windowNorth, type: 'window', center: 4.0, width: 2.0, sill: 0.82, head: 2.35 },
]);

describe('openingsForFace', () => {
  test('maps L-side openings straight through', () => {
    const faces = openingsForFace(REFERENCE_WALL, 5.8, 'L', 0, 5.8, 3.15);
    expect(faces.map((o) => o.id)).toEqual([ID.doorHall, ID.windowNorth]);
    expect(faces[0]!.t0).toBeCloseTo(0.6, 12);
    expect(faces[0]!.t1).toBeCloseTo(1.6, 12);
    expect(faces[0]!.sill).toBe(0);
    expect(faces[0]!.head).toBeCloseTo(2.15, 12);
    expect(faces[0]!.shape).toBe('flat');
    expect(faces[1]!.t0).toBeCloseTo(3.0, 12);
    expect(faces[1]!.t1).toBeCloseTo(5.0, 12);
  });

  test('the R side reverses t along the wall', () => {
    const wall = wallWith([{ id: ID.d, type: 'door', center: 1.0, width: 0.8 }]);
    const [face] = openingsForFace(wall, 5, 'R', 0, 5, 3.15);
    expect((face!.t0 + face!.t1) / 2).toBeCloseTo(4.0, 12);
    expect(face!.t0).toBeCloseTo(3.6, 12);
    expect(face!.t1).toBeCloseTo(4.4, 12);
  });

  test('face t0 shifts openings into face-local coordinates', () => {
    const wall = wallWith([{ id: ID.d, type: 'door', center: 2.5, width: 1.0 }]);
    const [face] = openingsForFace(wall, 6, 'L', 0.15, 5.7, 3.15);
    expect(face!.t0).toBeCloseTo(2.0 - 0.15, 12);
    expect(face!.t1).toBeCloseTo(3.0 - 0.15, 12);
  });

  test('an opening straddling the face start is clipped', () => {
    const wall = wallWith([{ id: ID.d, type: 'door', center: 1.0, width: 1.0 }]);
    const [face] = openingsForFace(wall, 6, 'L', 1.0, 4.0, 3.15);
    expect(face!.t0).toBeCloseTo(0, 12);
    expect(face!.t1).toBeCloseTo(0.5, 12);
  });

  test('an opening straddling the face end is clipped', () => {
    const wall = wallWith([{ id: ID.w1, type: 'window', center: 4.5, width: 2.0 }]);
    const [face] = openingsForFace(wall, 6, 'L', 0, 4.0, 3.15);
    expect(face!.t0).toBeCloseTo(3.5, 12);
    expect(face!.t1).toBeCloseTo(4.0, 12);
  });

  test('an opening outside the face range is dropped', () => {
    const wall = wallWith([{ id: ID.d, type: 'door', center: 1.0, width: 1.0 }]);
    expect(openingsForFace(wall, 6, 'L', 2.0, 3.0, 3.15)).toEqual([]);
  });

  test('doors and windows take their documented defaults', () => {
    const wall = wallWith([
      { id: ID.d, type: 'door', center: 1.0, width: 0.9 },
      { id: ID.w1, type: 'window', center: 3.0, width: 1.2 },
    ]);
    const [door, window] = openingsForFace(wall, 6, 'L', 0, 6, 3.15);
    expect(door!.sill).toBe(0);
    expect(door!.head).toBe(DEFAULT_DOOR_HEAD);
    expect(DEFAULT_DOOR_HEAD).toBe(2.1);
    expect(window!.sill).toBe(DEFAULT_WINDOW_SILL);
    expect(window!.head).toBe(DEFAULT_WINDOW_HEAD);
    expect(DEFAULT_WINDOW_SILL).toBe(0.9);
    expect(DEFAULT_WINDOW_HEAD).toBe(2.2);
  });

  test('a head above the ceiling is clamped under the ceiling margin', () => {
    const wall = wallWith([{ id: ID.d, type: 'door', center: 1.0, width: 0.9, head: 4 }]);
    const [door] = openingsForFace(wall, 6, 'L', 0, 6, 2.65);
    expect(door!.head).toBeCloseTo(2.65 - CEILING_OPENING_MARGIN, 9);
  });

  test('a wall without openings yields nothing', () => {
    expect(openingsForFace({ id: ID.w, a: ID.a, b: ID.b, thickness: 0.3 }, 4, 'L', 0, 4, 3.15)).toEqual([]);
  });
});

describe('faceQuads', () => {
  test('the reference face decomposes into six quads of 13.06 m2', () => {
    const openings = openingsForFace(REFERENCE_WALL, 5.8, 'L', 0, 5.8, 3.15);
    const quads = faceQuads(5.8, 3.15, openings);
    expect(quads.length).toBe(6);
    expect(quads.map((q) => q.kind)).toEqual(['pier', 'lintel', 'pier', 'sill', 'lintel', 'pier']);
    expect(quadsArea(quads)).toBeCloseTo(13.06, 9);
  });

  test('quad areas equal the face minus the openings exactly', () => {
    const openings = openingsForFace(REFERENCE_WALL, 5.8, 'L', 0, 5.8, 3.15);
    const holes = openings.reduce((sum, o) => sum + (o.t1 - o.t0) * (o.head - o.sill), 0);
    expect(quadsArea(faceQuads(5.8, 3.15, openings))).toBeCloseTo(5.8 * 3.15 - holes, 12);
  });

  test('the quads tile the face without overlapping', () => {
    const openings = openingsForFace(REFERENCE_WALL, 5.8, 'L', 0, 5.8, 3.15);
    const quads = faceQuads(5.8, 3.15, openings);
    for (let i = 0; i < quads.length; i += 1) {
      for (let j = i + 1; j < quads.length; j += 1) {
        const a = quads[i]!;
        const b = quads[j]!;
        const tOverlap = Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0);
        const yOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        expect(tOverlap > 1e-9 && yOverlap > 1e-9).toBe(false);
      }
    }
  });

  test('a blank face is a single pier', () => {
    const quads = faceQuads(4, 3, []);
    expect(quads).toEqual([{ t0: 0, t1: 4, y0: 0, y1: 3, kind: 'pier' }]);
    expect(quadsArea(quads)).toBe(12);
  });

  test('a full-height opening at the face end leaves no trailing pier', () => {
    const quads = faceQuads(4, 3, [{ id: ID.o, type: 'door', t0: 2, t1: 4, sill: 0, head: 3, shape: 'flat' }]);
    expect(quads.length).toBe(1);
    expect(quads[0]).toEqual({ t0: 0, t1: 2, y0: 0, y1: 3, kind: 'pier' });
  });

  test('overlapping openings do not duplicate quads', () => {
    const quads = faceQuads(5, 3, [
      { id: ID.doorway, type: 'door', t0: 1, t1: 2, sill: 0, head: 2.1, shape: 'flat' },
      { id: ID.win, type: 'window', t0: 1.5, t1: 3, sill: 0.9, head: 2.2, shape: 'flat' },
    ]);
    expect(quads.length).toBe(5);
    expect(quads.map((q) => q.kind)).toEqual(['pier', 'lintel', 'sill', 'lintel', 'pier']);
    expect(quads[2]!.t0).toBeCloseTo(2, 12);
    expect(quadsArea(quads)).toBeCloseTo(15 - 2.1 - 1 * 1.3, 12);
  });

  test('an opening fully swallowed by an earlier one adds nothing', () => {
    const quads = faceQuads(5, 3, [
      { id: ID.big, type: 'door', t0: 1, t1: 4, sill: 0, head: 2.1, shape: 'flat' },
      { id: ID.small, type: 'window', t0: 2, t1: 3, sill: 0.9, head: 2.0, shape: 'flat' },
    ]);
    expect(quads.map((q) => q.kind)).toEqual(['pier', 'lintel', 'pier']);
    expect(quadsArea(quads)).toBeCloseTo(15 - 3 * 2.1, 12);
  });

  test('openings are processed in t order regardless of input order', () => {
    const later = { id: ID.later, type: 'window' as const, t0: 3, t1: 4, sill: 0.9, head: 2.2, shape: 'flat' as const };
    const earlier = { id: ID.earlier, type: 'door' as const, t0: 1, t1: 2, sill: 0, head: 2.1, shape: 'flat' as const };
    expect(faceQuads(5, 3, [later, earlier])).toEqual(faceQuads(5, 3, [earlier, later]));
  });
});
