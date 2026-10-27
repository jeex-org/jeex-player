/**
 * Rooms merging when a batch removes the walls between them: which room
 * survives, what it keeps, what the absorbed rooms hand over and what they
 * leave behind, how the merge is reported — and the anchor errors a merge must
 * never hide. Everything goes through `SceneModel.apply`, because the merge is
 * a property of the COMMIT, not of any one operation.
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { draftOf, type Draft } from '../shared/committed.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { signedArea } from '../plan/plan-geometry.js';
import { SceneModel, isApplyOk, type ApplyOk, type ApplyResult } from './scene-model.js';
import { TOUCHED_SHELL, touchedAsset, touchedFace, touchedFloor, touchedOpening, touchedRoomWalls, type SceneOp } from './scene-ops.js';
import { touchedCamera, touchedCeiling, touchedTrim } from './ops/context.js';
import { faceKey, type Room, type SceneData } from './types.js';

const ROOM_A = L_SHAPE.room.a;
const ROOM_B = L_SHAPE.room.b;
const W = L_SHAPE.wall;

/** Ids the strip plan and these tests create, minted offline: fixed UUID v7 literals. */
const STRIP = {
  scene: '01a172f5-2a54-714f-9a92-b0955a3f5a31',
  top: [
    '01a172f5-2a54-7150-8879-e61ad397d2bc',
    '01a172f5-2a54-7151-83c7-dc42de0bc951',
    '01a172f5-2a54-7152-a0de-8d7b6520e164',
    '01a172f5-2a54-7153-b996-d4347ee805fa',
  ],
  bottom: [
    '01a172f5-2a54-7154-9ab6-60bc03787ee9',
    '01a172f5-2a54-7155-83ca-58a47f44381f',
    '01a172f5-2a54-7156-9f86-82b114716ffe',
    '01a172f5-2a54-7157-ad0e-0433fcedab03',
  ],
  south: ['01a172f5-2a54-7158-9511-a6e1699e85eb', '01a172f5-2a54-7159-8883-4c5d2714982a', '01a172f5-2a54-715a-b96c-f71b267ccfb2'],
  east: '01a172f5-2a54-715b-aa8b-e01831dbbc2f',
  north: ['01a172f5-2a54-715c-aa8b-fb829e919cd8', '01a172f5-2a54-715d-9108-d7b806b00d09', '01a172f5-2a54-715e-be60-08c38aa8bf91'],
  west: '01a172f5-2a54-715f-80fb-6a4b3eee7bb9',
  partition: ['01a172f5-2a54-7160-a5ae-767c323acbb0', '01a172f5-2a54-7161-9602-53abacf46727'],
  /** Ascending: `room[0] < room[1] < room[2]` by string comparison. */
  room: ['01a172f5-2a54-7162-b49b-e8d1bef68266', '01a172f5-2a54-7163-98bf-e76184f60633', '01a172f5-2a54-7164-93dd-e07f83167523'],
} as const;

const NEW = {
  addedRoom: '01a172f5-2a54-7167-9aa6-48546e9f0187',
  farA: '01a172f5-2a54-7168-a604-46a0b4a5e056',
  farB: '01a172f5-2a54-7169-a0f1-da15d5716579',
  farC: '01a172f5-2a54-716a-8bcf-5fb0735aba8d',
  farAB: '01a172f5-2a54-716b-ac6c-b9b95d2dbbb7',
  farBC: '01a172f5-2a54-716c-9bf0-d3641d6389b4',
  farCA: '01a172f5-2a54-716d-aab9-06bc29a916c1',
  detached: '01a172f5-2a54-716e-803f-30945f0c0e2b',
  preset: '01a172f5-2a54-7170-86d4-cc1da7f48c17',
  presetGone: '01a172f5-2a54-7171-a97f-05953ccded3d',
  mergedWall: '01a172f5-2a54-7172-afef-1a4a27065cf0',
} as const;

const POSE = { position: { x: 1, y: 1.6, z: 2 }, target: { x: 2, y: 1.4, z: 2 } } as const;

/**
 * A strip of rooms along x between z = 0 and z = 4, split by straight
 * partitions at the inner `xs`. Every wall is 0.25 m thick, so each solved
 * room is exactly representable: a strip of width w measures (w - 0.25) x 3.75.
 * `rooms[i]` fills the i-th bay; the document lists them in the order given.
 */
function strip(xs: readonly number[], rooms: readonly Partial<Room>[]): SceneData {
  const bays = xs.length - 1;
  const top = STRIP.top.slice(0, xs.length);
  const bottom = STRIP.bottom.slice(0, xs.length);
  const t = 0.25;
  return {
    schemaVersion: '2.4',
    units: 'm',
    id: STRIP.scene,
    name: 'Strip',
    ceilingHeight: 2.7,
    nodes: [...xs.map((x, i) => ({ id: top[i]!, p: { x, z: 0 } })), ...xs.map((x, i) => ({ id: bottom[i]!, p: { x, z: 4 } }))],
    walls: [
      ...STRIP.south.slice(0, bays).map((id, i) => ({ id, a: top[i]!, b: top[i + 1]!, thickness: t, role: 'facade' as const })),
      { id: STRIP.east, a: top[bays]!, b: bottom[bays]!, thickness: t, role: 'facade' },
      ...STRIP.north
        .slice(0, bays)
        .map((id, i) => ({ id, a: bottom[bays - i]!, b: bottom[bays - i - 1]!, thickness: t, role: 'facade' as const })),
      { id: STRIP.west, a: bottom[0]!, b: top[0]!, thickness: t, role: 'facade' },
      ...STRIP.partition
        .slice(0, bays - 1)
        .map((id, i) => ({ id, a: top[i + 1]!, b: bottom[i + 1]!, thickness: t, role: 'partition' as const })),
    ],
    rooms: rooms.map((room, i) => ({
      id: room.id ?? STRIP.room[i]!,
      name: room.name ?? `Bay ${i + 1}`,
      anchor: room.anchor ?? { x: (xs[i]! + xs[i + 1]!) / 2, z: 2 },
      floorMaterial: room.floorMaterial ?? FINISH.oak,
      ...(room.kind !== undefined && { kind: room.kind }),
      ...(room.accent !== undefined && { accent: room.accent }),
      ...(room.purpose !== undefined && { purpose: room.purpose }),
    })),
    assets: [],
    presentationCamera: { position: { x: 4, y: 8, z: 12 }, target: { x: 4, y: 1, z: 2 } },
    roomCameras: {},
    navigation: { points: [{ x: 1, y: 0, z: 2 }] },
    autotour: {
      speed: 1.2,
      path: [
        { x: 1, y: 1.6, z: 2 },
        { x: 2, y: 1.6, z: 2 },
      ],
      gaze: [],
    },
  };
}

function ok(result: ApplyResult): ApplyOk {
  if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
  return result;
}

/** Commits `ops` on `model`, which must take them. */
function commit(model: SceneModel, ops: readonly SceneOp[]): ApplyOk {
  return ok(model.apply({ baseRev: model.rev, ops }));
}

/** The L-shape with Room A called the living room and Room B the kitchen, the table bound to the kitchen. */
function kitchenAndLiving(): Draft<SceneData> {
  const scene = draftOf(lShapePlan);
  scene.rooms[0]!.name = 'Living room';
  scene.rooms[1]!.name = 'Kitchen';
  scene.assets.find((asset) => asset.id === L_SHAPE.asset.table)!.room = ROOM_B;
  return scene;
}

/** A batch the model must refuse, with the revision and the committed document left as they were. */
function expectRefused(model: SceneModel, ops: readonly SceneOp[], message: RegExp): void {
  const rev = model.rev;
  const scene = model.scene;
  const result = model.apply({ baseRev: rev, ops });
  if (isApplyOk(result)) throw new Error('expected the batch to be refused');
  expect(result.error).toBe('validation_failed');
  expect(result.message).toMatch(message);
  expect(model.rev).toBe(rev);
  expect(model.scene).toBe(scene);
}

const REMOVE_PARTITION: SceneOp = { op: 'remove_wall', wallId: W.wPart };

describe('removing the wall between two rooms merges them', () => {
  test("a survivor renamed in the same batch, after the removal, is still reported by both rooms' names before the batch", () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    const result = commit(model, [REMOVE_PARTITION, { op: 'set_room', roomId: ROOM_A, name: 'Kitchen-living' }]);

    expect(result.roomMerges).toEqual([{ from: ROOM_B, to: ROOM_A, summary: 'Kitchen merged into Living room' }]);
    expect(model.scene.rooms.map((room) => room.name)).toEqual(['Kitchen-living']);
  });

  test('two rooms become one in one revision, the larger keeping its id and the plan solving to one room', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    const result = commit(model, [REMOVE_PARTITION]);

    expect(result.rev).toBe(1);
    expect(model.scene.rooms.map((room) => room.id)).toEqual([ROOM_A]);
    expect(model.plan.rooms.map((room) => room.roomId)).toEqual([ROOM_A]);
    expect(result.roomMerges).toEqual([{ from: ROOM_B, to: ROOM_A, summary: 'Kitchen merged into Living room' }]);
  });

  test('three rooms merge in one batch, and the result does not depend on the order of the rooms or the ops', () => {
    const rooms = [{ name: 'Living room' }, { name: 'Kitchen' }, { name: 'Pantry' }];
    const run = (reversed: boolean) => {
      const document = strip([0, 5, 8, 11], rooms);
      const scene = draftOf(document);
      if (reversed) scene.rooms.reverse();
      const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
      const ops: SceneOp[] = STRIP.partition.map((wallId) => ({ op: 'remove_wall', wallId }));
      if (reversed) ops.reverse();
      const result = commit(model, ops);
      return { rooms: model.scene.rooms, merges: result.roomMerges, rev: result.rev };
    };

    const straight = run(false);
    expect(straight.rev).toBe(1);
    expect(straight.rooms.map((room) => room.id)).toEqual([STRIP.room[0]]);
    // Sorted by `from`; both map straight to the survivor.
    expect(straight.merges).toEqual([
      { from: STRIP.room[1], to: STRIP.room[0], summary: 'Kitchen merged into Living room' },
      { from: STRIP.room[2], to: STRIP.room[0], summary: 'Pantry merged into Living room' },
    ]);
    expect(run(true)).toEqual(straight);
  });

  test('the largest room survives even when it is listed last and its id is not the smallest', () => {
    const scene = strip(
      [0, 3, 9],
      [
        { id: STRIP.room[0], name: 'Hall' },
        { id: STRIP.room[1], name: 'Living room' },
      ],
    );
    const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
    const result = commit(model, [{ op: 'remove_wall', wallId: STRIP.partition[0] }]);
    expect(model.scene.rooms.map((room) => room.id)).toEqual([STRIP.room[1]]);
    expect(result.roomMerges).toEqual([{ from: STRIP.room[0], to: STRIP.room[1], summary: 'Hall merged into Living room' }]);
  });

  test('a tie in area goes to the smaller id, wherever the rooms are listed', () => {
    // The west bay carries the LARGER id and is listed first.
    const model = new SceneModel(
      strip(
        [0, 4, 8],
        [
          { id: STRIP.room[1], name: 'West' },
          { id: STRIP.room[0], name: 'East' },
        ],
      ),
      CATALOGUE_REGISTRIES,
    );
    const [west, east] = model.plan.rooms.map((room) => Math.abs(signedArea(room.polygon)));
    expect(west).toBe(east);

    const result = commit(model, [{ op: 'remove_wall', wallId: STRIP.partition[0] }]);
    expect(model.scene.rooms.map((room) => room.id)).toEqual([STRIP.room[0]]);
    expect(result.roomMerges).toEqual([{ from: STRIP.room[1], to: STRIP.room[0], summary: 'West merged into East' }]);
  });

  test('the survivor keeps its id, anchor, name, kind, purpose, accent, floor, room finishes and camera', () => {
    const scene = draftOf(
      strip(
        [0, 6, 9],
        [
          { name: 'Living room', purpose: 'living', accent: '#c8a46e', floorMaterial: FINISH.walnut },
          // No purpose of its own: a kitchen with one would stay as a zone (below).
          { name: 'Kitchen', accent: '#7a9e7e' },
        ],
      ),
    );
    scene.roomCameras = { [STRIP.room[0]]: POSE, [STRIP.room[1]]: { ...POSE, position: { x: 7, y: 1.6, z: 2 } } };
    scene.finishes = { rooms: { [STRIP.room[0]]: { walls: FINISH.sage }, [STRIP.room[1]]: { walls: FINISH.terra } } };
    const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
    const survivor = model.scene.rooms[0]!;

    commit(model, [{ op: 'remove_wall', wallId: STRIP.partition[0] }]);

    expect(model.scene.rooms).toEqual([survivor]);
    expect(model.scene.roomCameras).toEqual({ [STRIP.room[0]]: POSE });
    expect(model.scene.finishes?.rooms).toEqual({ [STRIP.room[0]]: { walls: FINISH.sage } });
  });

  test('a room merged with a smaller loggia stays a room', () => {
    const model = new SceneModel(strip([0, 6, 9], [{ name: 'Living room' }, { name: 'Loggia', kind: 'loggia' }]), CATALOGUE_REGISTRIES);
    commit(model, [{ op: 'remove_wall', wallId: STRIP.partition[0] }]);
    expect(model.scene.rooms).toHaveLength(1);
    expect(model.scene.rooms[0]!.kind).toBeUndefined();
  });

  test('a detached room takes no part, even with its anchor inside the joined space', () => {
    const scene = draftOf(strip([0, 6, 9], [{ name: 'Living room' }, { name: 'Kitchen' }]));
    scene.rooms.push({
      id: NEW.detached,
      name: 'Terrace',
      anchor: { x: 5, z: 2 },
      floorMaterial: FINISH.oak,
      polygon: [
        { x: 12, z: 0 },
        { x: 14, z: 0 },
        { x: 14, z: 4 },
        { x: 12, z: 4 },
      ],
    });
    const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
    const result = commit(model, [{ op: 'remove_wall', wallId: STRIP.partition[0] }]);
    expect(model.scene.rooms.map((room) => room.id)).toEqual([STRIP.room[0], NEW.detached]);
    expect(result.roomMerges).toEqual([{ from: STRIP.room[1], to: STRIP.room[0], summary: 'Kitchen merged into Living room' }]);
  });
});

describe('what the absorbed room hands over and what it leaves behind', () => {
  test('objects are rebound without moving, painted faces re-keyed, its camera and room finishes dropped', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    commit(model, [
      { op: 'set_material', target: ROOM_A, material: FINISH.sage },
      { op: 'set_material', target: ROOM_B, material: FINISH.terra },
      { op: 'set_material', target: faceKey(ROOM_B, W.wE, 'L'), material: FINISH.graphite },
    ]);
    const table = model.scene.assets.find((asset) => asset.id === L_SHAPE.asset.table)!;

    commit(model, [REMOVE_PARTITION]);

    const after = model.scene.assets.find((asset) => asset.id === L_SHAPE.asset.table)!;
    expect(after.room).toBe(ROOM_A);
    expect(after.position).toEqual(table.position);
    expect(model.scene.finishes?.faces).toEqual([{ room: ROOM_A, wallId: W.wE, side: 'L', finish: FINISH.graphite }]);
    expect(Object.keys(model.scene.finishes?.rooms ?? {})).toEqual([ROOM_A]);
    expect(Object.keys(model.scene.roomCameras)).toEqual([ROOM_A]);
    // The face keeps its paint under its new owner, in the solved plan too.
    expect(model.plan.faces.has(faceKey(ROOM_A, W.wE, 'L'))).toBe(true);
  });

  test('preset instructions naming the absorbed room in any form, or the removed wall, are forgotten; an emptied preset goes', () => {
    const scene = kitchenAndLiving();
    (scene as { schemaVersion: string }).schemaVersion = '2.3';
    const keep: SceneOp = { op: 'set_material', target: ROOM_A, material: FINISH.walnut };
    scene.interiors = [
      {
        id: NEW.preset,
        name: 'Warm walnut',
        swatch: [FINISH.walnut, FINISH.terra],
        ops: [
          keep,
          { op: 'set_material', surface: 'wall', room: ROOM_B, material: FINISH.terra },
          { op: 'set_material', target: faceKey(ROOM_B, W.wE, 'L'), material: FINISH.graphite },
          { op: 'set_material', surface: 'wall', face: faceKey(ROOM_A, W.wPart, 'L'), material: FINISH.sand },
        ],
      },
      {
        id: NEW.presetGone,
        name: 'Kitchen only',
        swatch: [FINISH.walnut, FINISH.terra],
        ops: [
          { op: 'set_material', target: ROOM_B, material: FINISH.terra },
          { op: 'set_camera', target: { room: ROOM_B }, pose: { position: { x: 8, y: 1.6, z: 2.5 }, target: { x: 9, y: 1.4, z: 2.5 } } },
        ],
      },
    ];
    const model = new SceneModel(scene, CATALOGUE_REGISTRIES);

    commit(model, [REMOVE_PARTITION]);

    expect(model.scene.interiors).toEqual([{ id: NEW.preset, name: 'Warm walnut', swatch: [FINISH.walnut, FINISH.terra], ops: [keep] }]);
  });

  test('the merge is reported: roomMerges by the names before the batch, touched with everything that moved', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    commit(model, [{ op: 'set_material', target: faceKey(ROOM_B, W.wE, 'L'), material: FINISH.graphite }]);

    // The merge happens at commit, after every op: a rename in the same batch
    // is not what the rooms were called when the person asked for the edit.
    const result = commit(model, [{ op: 'set_room', roomId: ROOM_B, name: 'Galley' }, REMOVE_PARTITION]);

    expect(result.roomMerges).toEqual([{ from: ROOM_B, to: ROOM_A, summary: 'Kitchen merged into Living room' }]);
    expect(result.touched).toEqual([
      TOUCHED_SHELL,
      touchedOpening(L_SHAPE.opening.doorAb),
      touchedAsset(L_SHAPE.asset.table),
      touchedCamera({ room: ROOM_B }),
      touchedFloor(ROOM_B),
      touchedRoomWalls(ROOM_B),
      touchedCeiling(ROOM_B),
      touchedTrim(ROOM_B),
      touchedFace(faceKey(ROOM_B, W.wE, 'L')),
      touchedFace(faceKey(ROOM_A, W.wE, 'L')),
    ]);
  });
});

describe('an open-plan merge keeps the absorbed room as a zone', () => {
  /** A living room (bays 0..6) and a kitchen (6..9), each with a camera and its own wall paint. */
  function livingAndKitchen(kitchenPurpose: Room['purpose']): Draft<SceneData> {
    const scene = draftOf(
      strip(
        [0, 6, 9],
        [
          { name: 'Living room', purpose: 'living' },
          { name: 'Kitchen', ...(kitchenPurpose === undefined ? {} : { purpose: kitchenPurpose }) },
        ],
      ),
    );
    scene.roomCameras = { [STRIP.room[0]]: POSE, [STRIP.room[1]]: { ...POSE, position: { x: 7, y: 1.6, z: 2 } } };
    scene.finishes = { rooms: { [STRIP.room[0]]: { walls: FINISH.sage }, [STRIP.room[1]]: { walls: FINISH.terra } } };
    return scene;
  }

  test('a kitchen merged into a living room stays a room of its own, outlined where its floor was', () => {
    const model = new SceneModel(livingAndKitchen('kitchen'), CATALOGUE_REGISTRIES);
    const outline = model.plan.rooms.find((room) => room.roomId === STRIP.room[1])!.polygon;

    const result = commit(model, [{ op: 'remove_wall', wallId: STRIP.partition[0] }]);

    expect(result.roomMerges).toEqual([
      { from: STRIP.room[1], to: STRIP.room[0], summary: 'Kitchen kept as a zone of Living room', kept: 'zone' },
    ]);
    const kitchen = model.scene.rooms.find((room) => room.id === STRIP.room[1])!;
    expect(kitchen).toMatchObject({ name: 'Kitchen', purpose: 'kitchen', polygon: outline });
    expect(model.scene.roomCameras[STRIP.room[1]]).toBeDefined();
    expect(model.scene.finishes?.rooms?.[STRIP.room[1]]).toEqual({ walls: FINISH.terra });
    // One floor each: the living room's face gives up the kitchen's (the floor ownership of `solvePlan`).
    const living = model.plan.rooms.find((room) => room.roomId === STRIP.room[0])!;
    // The merged face, 8.75 x 3.75, less the kitchen's 2.75 x 3.75: the old living room and the partition's strip.
    expect(Math.abs(signedArea(living.polygon))).toBeCloseTo(8.75 * 3.75 - 2.75 * 3.75, 6);
    expect(model.plan.caveats).toEqual([]);
  });

  test('two rooms of the same purpose still merge into one', () => {
    const model = new SceneModel(livingAndKitchen('living'), CATALOGUE_REGISTRIES);
    const result = commit(model, [{ op: 'remove_wall', wallId: STRIP.partition[0] }]);
    expect(result.roomMerges).toEqual([{ from: STRIP.room[1], to: STRIP.room[0], summary: 'Kitchen merged into Living room' }]);
    expect(model.scene.rooms.map((room) => room.id)).toEqual([STRIP.room[0]]);
  });

  test('a room without a purpose still merges into one: nothing says what it was', () => {
    const model = new SceneModel(livingAndKitchen(undefined), CATALOGUE_REGISTRIES);
    commit(model, [{ op: 'remove_wall', wallId: STRIP.partition[0] }]);
    expect(model.scene.rooms.map((room) => room.id)).toEqual([STRIP.room[0]]);
  });
});

describe('a merge never hides a genuine anchor error', () => {
  test('a room added into the joined space is still refused with MULTI_ANCHOR', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    expectRefused(
      model,
      [REMOVE_PARTITION, { op: 'add_room', id: NEW.addedRoom, name: 'Nook', anchor: { x: 2, z: 2 }, floorMaterial: FINISH.oak }],
      /several room anchors/,
    );
  });

  test('a room added into an occupied face, without any removal, is refused as before', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    expectRefused(
      model,
      [{ op: 'add_room', id: NEW.addedRoom, name: 'Nook', anchor: { x: 2, z: 2 }, floorMaterial: FINISH.oak }],
      /several room anchors/,
    );
  });

  test('an anchor moved in a batch that also removes a wall is still refused with MULTI_ANCHOR', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    expectRefused(model, [REMOVE_PARTITION, { op: 'set_room', roomId: ROOM_B, anchor: { x: 8, z: 3 } }], /several room anchors/);
  });

  test('a batch without remove_wall never merges', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    expectRefused(model, [{ op: 'set_room', roomId: ROOM_B, anchor: { x: 2, z: 2 } }], /several room anchors/);
  });

  test('a removal that leaves a dangling node is refused, document and revision unchanged', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    expectRefused(model, [{ op: 'remove_wall', wallId: W.wE }], /degree 1/);
  });

  test('a removal in a batch that leaves the plan in two pieces is refused, document and revision unchanged', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    expectRefused(
      model,
      [
        REMOVE_PARTITION,
        { op: 'add_node', id: NEW.farA, p: { x: 30, z: 0 } },
        { op: 'add_node', id: NEW.farB, p: { x: 34, z: 0 } },
        { op: 'add_node', id: NEW.farC, p: { x: 32, z: 3 } },
        { op: 'add_wall', id: NEW.farAB, a: NEW.farA, b: NEW.farB, thickness: 0.2 },
        { op: 'add_wall', id: NEW.farBC, a: NEW.farB, b: NEW.farC, thickness: 0.2 },
        { op: 'add_wall', id: NEW.farCA, a: NEW.farC, b: NEW.farA, thickness: 0.2 },
      ],
      /disconnected/,
    );
  });
});

describe('removing a partition and merging the walls at its junction, in one batch', () => {
  test('commits; the rooms merge and each side of the merged wall keeps one paint', () => {
    const model = new SceneModel(kitchenAndLiving(), CATALOGUE_REGISTRIES);
    commit(model, [
      { op: 'set_material', target: faceKey(ROOM_A, W.wSA, 'L'), material: FINISH.graphite },
      { op: 'set_material', target: faceKey(ROOM_B, W.wSB, 'L'), material: FINISH.sage },
      { op: 'set_material', target: faceKey(null, W.wSA, 'R'), material: FINISH.terra },
      { op: 'set_material', target: faceKey(null, W.wSB, 'R'), material: FINISH.sand },
    ]);

    const result = commit(model, [REMOVE_PARTITION, { op: 'merge_wall', wallIds: [W.wSA, W.wSB], id: NEW.mergedWall }]);

    expect(result.roomMerges).toEqual([{ from: ROOM_B, to: ROOM_A, summary: 'Kitchen merged into Living room' }]);
    expect(model.scene.walls.some((wall) => wall.id === W.wSA || wall.id === W.wSB)).toBe(false);
    expect(model.scene.nodes.some((node) => node.id === L_SHAPE.node.n2)).toBe(false);
    // wSA is the longer of the two (6 m against 4 m), so its finishes win on both sides.
    expect(model.scene.finishes?.faces).toEqual([
      { room: ROOM_A, wallId: NEW.mergedWall, side: 'L', finish: FINISH.graphite },
      { wallId: NEW.mergedWall, side: 'R', finish: FINISH.terra },
    ]);
  });
});
