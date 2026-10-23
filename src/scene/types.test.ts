import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ASSET_ROTATION_Y,
  SCHEMA_VERSIONS,
  UUID_V7_PATTERN,
  WALL_LIMITS,
  DEFAULT_ASSET_SCALE,
  DEFAULT_OPENING_SHAPE,
  DEFAULT_ROOM_KIND,
  FaceMap,
  effectiveAsset,
  effectiveOpeningShape,
  effectiveRoom,
  faceKey,
  footprintScaleOf,
  isDoorLike,
  isFaceKey,
  isPlanMode,
  isUuidV7,
  sameFace,
  schemaVersionBefore,
} from './types.js';
import type { DemoAsset, Opening, Room, SchemaVersion } from './types.js';

/**
 * The schema's vocabularies with behaviour: the door-like predicate, the UUID
 * v7 id grammar and the `FaceKey` helpers with the one keyed collection over
 * faces. Everything else in `types.ts` is a declaration and is checked by the
 * compiler.
 */

/** Fixed ids for these tests, generated once offline. */
const ID = {
  room: '01a12ff3-14a3-7e7b-b6a0-fa6399a2403b',
  otherRoom: '01a12ff3-14a4-7c71-a5cc-157eebf7c3c0',
  wall: '01a12ff3-14a5-784e-9a69-bf2689d9e12f',
  otherWall: '01a12ff3-14a6-7252-8285-6516b68cc215',
  opening: '01a12ff3-14a7-75e7-ab0f-08d0117c6d1d',
  asset: '01a12ff3-14a8-72db-bd89-e079fcf7231b',
  floor: '01a12ff3-14a9-723c-b8bc-eb965a2fda6b',
} as const;

describe('isDoorLike', () => {
  test('a door and a passage reach the floor, a window does not', () => {
    expect(isDoorLike('door')).toBe(true);
    expect(isDoorLike('passage')).toBe(true);
    expect(isDoorLike('window')).toBe(false);
  });
});

describe('isPlanMode', () => {
  test('the two display-only modes, and nothing else', () => {
    expect(isPlanMode('plan2d')).toBe(true);
    expect(isPlanMode('plan3d')).toBe(true);
    for (const mode of ['orbit', 'walk', 'tour'] as const) expect(isPlanMode(mode)).toBe(false);
  });
});

describe('the UUID v7 id grammar', () => {
  test('accepts a lowercase canonical v7', () => {
    expect(isUuidV7(ID.room)).toBe(true);
    expect(UUID_V7_PATTERN.test(ID.wall)).toBe(true);
  });

  test('refuses another version, uppercase, braces, a bad variant, a word and a non-string', () => {
    for (const bad of [
      '0b9e3f5c-1d2a-4c3b-9e8f-7a6b5c4d3e2f', // v4
      ID.room.toUpperCase(),
      `{${ID.room}}`,
      '01a12ff3-14a3-7e7b-76a0-fa6399a2403b', // variant nibble 7
      'kitchen',
      '',
    ]) {
      expect({ bad, accepted: isUuidV7(bad) }).toEqual({ bad, accepted: false });
    }
    for (const value of [3, null, undefined, {}]) expect(isUuidV7(value)).toBe(false);
  });

  test('the pattern is stateless — a global flag would make every second call lie', () => {
    expect(UUID_V7_PATTERN.test(ID.room)).toBe(true);
    expect(UUID_V7_PATTERN.test(ID.room)).toBe(true);
    expect(UUID_V7_PATTERN.global).toBe(false);
  });
});

describe('face keys', () => {
  test('faceKey carries the room, and omits it entirely for the facade', () => {
    expect(faceKey(ID.room, ID.wall, 'L')).toEqual({ room: ID.room, wallId: ID.wall, side: 'L' });
    const facade = faceKey(null, ID.wall, 'R');
    expect(facade).toEqual({ wallId: ID.wall, side: 'R' });
    expect('room' in facade).toBe(false);
  });

  test('sameFace compares owner, wall and side by value', () => {
    const face = faceKey(ID.room, ID.wall, 'L');
    expect(sameFace(face, { room: ID.room, wallId: ID.wall, side: 'L' })).toBe(true);
    expect(sameFace(face, faceKey(ID.room, ID.wall, 'R'))).toBe(false);
    expect(sameFace(face, faceKey(ID.otherRoom, ID.wall, 'L'))).toBe(false);
    expect(sameFace(face, faceKey(ID.room, ID.otherWall, 'L'))).toBe(false);
    expect(sameFace(face, faceKey(null, ID.wall, 'L'))).toBe(false);
  });

  test('isFaceKey accepts a room face and a facade face', () => {
    expect(isFaceKey(faceKey(ID.room, ID.wall, 'L'))).toBe(true);
    expect(isFaceKey(faceKey(null, ID.wall, 'R'))).toBe(true);
  });

  test('isFaceKey refuses extra keys, non-UUID ids, a bad side and non-objects', () => {
    for (const bad of [
      { room: ID.room, wallId: ID.wall, side: 'L', finish: ID.floor },
      { room: 'kitchen', wallId: ID.wall, side: 'L' },
      { wallId: 'w-1', side: 'L' },
      { wallId: ID.wall, side: 'l' },
      { wallId: ID.wall },
      { room: undefined, wallId: ID.wall, side: 'L' },
      [ID.wall, 'L'],
      `${ID.room}/${ID.wall}/L`,
      null,
    ]) {
      expect({ bad, accepted: isFaceKey(bad) }).toEqual({ bad, accepted: false });
    }
  });
});

describe('FaceMap', () => {
  test('get, has, set, delete and size by face key', () => {
    const map = new FaceMap<string>();
    const face = faceKey(ID.room, ID.wall, 'L');
    expect(map.size).toBe(0);
    expect(map.set(face, 'a')).toBe(map);
    expect(map.get(face)).toBe('a');
    expect(map.has(face)).toBe(true);
    expect(map.has(faceKey(ID.room, ID.wall, 'R'))).toBe(false);
    expect(map.size).toBe(1);
    expect(map.delete(face)).toBe(true);
    expect(map.delete(face)).toBe(false);
    expect(map.size).toBe(0);
  });

  test('two structurally equal keys address one entry', () => {
    const map = new FaceMap<number>();
    map.set(faceKey(ID.room, ID.wall, 'L'), 1);
    map.set({ room: ID.room, wallId: ID.wall, side: 'L' }, 2);
    expect(map.size).toBe(1);
    expect(map.get(faceKey(ID.room, ID.wall, 'L'))).toBe(2);
  });

  test('a facade face and a room face of one wall side are distinct entries', () => {
    const map = new FaceMap<number>();
    map.set(faceKey(null, ID.wall, 'L'), 1);
    map.set(faceKey(ID.room, ID.wall, 'L'), 2);
    expect(map.size).toBe(2);
    expect(map.get(faceKey(null, ID.wall, 'L'))).toBe(1);
  });

  test('iteration hands back the stored keys as structures, in insertion order', () => {
    const map = new FaceMap<number>();
    const first = faceKey(ID.room, ID.wall, 'L');
    const second = faceKey(null, ID.otherWall, 'R');
    map.set(first, 1).set(second, 2);
    expect([...map.keys()]).toEqual([first, second]);
    expect([...map.values()]).toEqual([1, 2]);
    expect([...map.entries()]).toEqual([
      [first, 1],
      [second, 2],
    ]);
    expect([...map]).toEqual([
      [first, 1],
      [second, 2],
    ]);
    map.clear();
    expect(map.size).toBe(0);
  });
});

describe('optional fields with defaults', () => {
  /**
   * The property the policy exists for: a MINIMAL object and a FULLY SPECIFIED
   * one that spells out the same defaults project to the same thing. If a
   * consumer keeps its own `?? DEFAULT` and the default here moves, that
   * equality is what breaks.
   */
  test('effectiveOpeningShape agrees with a document that spells the default out', () => {
    const minimal: Opening = { id: ID.opening, type: 'window', center: 1, width: 1 };
    const spelled: Opening = { ...minimal, shape: DEFAULT_OPENING_SHAPE };
    expect(effectiveOpeningShape(minimal)).toBe(effectiveOpeningShape(spelled));
    expect(effectiveOpeningShape(minimal)).toBe('flat');
    expect(effectiveOpeningShape({ ...minimal, shape: 'arch' })).toBe('arch');
  });

  test('effectiveRoom agrees with a document that spells the default out', () => {
    const minimal: Room = { id: ID.room, name: 'Room', anchor: { x: 0, z: 0 }, floorMaterial: ID.floor };
    const spelled: Room = { ...minimal, kind: DEFAULT_ROOM_KIND };
    expect(effectiveRoom(minimal)).toEqual(effectiveRoom(spelled));
    expect(effectiveRoom(minimal).kind).toBe('room');
    expect(effectiveRoom({ ...minimal, kind: 'loggia' }).kind).toBe('loggia');
  });

  test('effectiveAsset agrees with a document that spells both defaults out', () => {
    const minimal: DemoAsset = { id: ID.asset, type: 'sofa', position: { x: 1, y: 0, z: 2 } };
    const spelled: DemoAsset = { ...minimal, scale: DEFAULT_ASSET_SCALE, rotationY: DEFAULT_ASSET_ROTATION_Y };
    expect(effectiveAsset(minimal)).toEqual(effectiveAsset(spelled));
    expect(effectiveAsset(minimal)).toEqual({ ...minimal, scale: 1, rotationY: 0 });
  });

  test('effectiveAsset keeps the sign of an authored scale; a footprint takes its magnitude', () => {
    const mirrored: DemoAsset = { id: ID.asset, type: 'art', position: { x: 0, y: 1, z: 0 }, scale: -2 };
    // The renderer mirrors the mesh with it...
    expect(effectiveAsset(mirrored).scale).toBe(-2);
    // ...while a collision box has no negative extent.
    expect(footprintScaleOf(mirrored)).toBe(2);
  });

  test('an authored value always wins over the default', () => {
    const placed: DemoAsset = { id: ID.asset, type: 'chair', position: { x: 0, y: 0, z: 0 }, scale: 1.5, rotationY: 0.25 };
    expect(effectiveAsset(placed)).toEqual({ ...placed, scale: 1.5, rotationY: 0.25 });
  });
});

describe('WALL_LIMITS', () => {
  test('carries the three numeric limits of the wall schema', () => {
    expect(WALL_LIMITS).toEqual({ minThickness: 0.05, maxThickness: 0.6, minCentrelineLength: 0.5 });
  });
});

describe('schemaVersionBefore', () => {
  test('the readable versions, oldest first, are 2.2, 2.3 and 2.4', () => {
    expect([...SCHEMA_VERSIONS]).toEqual(['2.2', '2.3', '2.4']);
  });

  test('an older version comes before its floor', () => {
    expect(schemaVersionBefore('2.2', '2.4')).toBe(true);
    expect(schemaVersionBefore('2.3', '2.4')).toBe(true);
    expect(schemaVersionBefore('2.2', '2.3')).toBe(true);
  });

  test('the floor itself and a newer version do not', () => {
    expect(schemaVersionBefore('2.4', '2.4')).toBe(false);
    expect(schemaVersionBefore('2.4', '2.3')).toBe(false);
    expect(schemaVersionBefore('2.3', '2.2')).toBe(false);
  });

  test('a version the list does not know is not before anything', () => {
    expect(schemaVersionBefore('2.5' as SchemaVersion, '2.4')).toBe(false);
    expect(schemaVersionBefore('1.0' as SchemaVersion, '2.2')).toBe(false);
  });
});
