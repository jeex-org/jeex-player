/**
 * What a shell edit leaves for the solver to answer: which room owns a painted
 * face, and which side of its wall a door with an authored swing opens to.
 *
 * Both are stored in the document against the topology of the moment (a face
 * by its owner room, a swing by «the room side»); after an edit that changes
 * who owns a wall side, the commit re-reads them on the new plan so the paint
 * stays on its face and the leaf on its side.
 */

import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { ZONED, zonedLivingPlan } from '../fixtures/plan-zoned-living.js';
import { FINISH } from '../materials/finish-ids.js';
import { resolveDoorSwing } from '../plan/door-swing.js';
import { solvePlan } from '../plan/plan-solver.js';
import { SceneModel, isApplyOk } from './scene-model.js';
import { faceFinishOf } from './scene-ops.js';
import type { SceneData, SceneOp } from './types.js';

/** Ids the tests mint, offline like every fixture id. */
const NEW = {
  east: '01a1f6d0-3c20-7b00-8f00-000000000001',
  eastN: '01a1f6d0-3c20-7b00-8f00-000000000002',
  eastS: '01a1f6d0-3c20-7b00-8f00-000000000003',
  west: '01a1f6d0-3c20-7b00-8f00-000000000004',
  westS: '01a1f6d0-3c20-7b00-8f00-000000000005',
  westN: '01a1f6d0-3c20-7b00-8f00-000000000006',
  partition: '01a1f6d0-3c20-7b00-8f00-000000000007',
  study: '01a1f6d0-3c20-7b00-8f00-000000000008',
  door: '01a1f6d0-3c20-7b00-8f00-000000000009',
  p: '01a1f6d0-3c20-7b00-8f00-00000000000a',
  q: '01a1f6d0-3c20-7b00-8f00-00000000000b',
  wAP: '01a1f6d0-3c20-7b00-8f00-00000000000c',
  wPQ: '01a1f6d0-3c20-7b00-8f00-00000000000d',
  wQB: '01a1f6d0-3c20-7b00-8f00-00000000000e',
  loggia: '01a1f6d0-3c20-7b00-8f00-00000000000f',
} as const;

const N = ZONED.node;
const LIVING = ZONED.room.living;

/** The zoned living room as a whole document: its tour needs two points. */
function livingRoom(): SceneData {
  const scene = zonedLivingPlan([]);
  return {
    ...scene,
    autotour: {
      ...scene.autotour,
      path: [
        { x: 5, y: 1.6, z: 4 },
        { x: 5, y: 1.6, z: 6 },
      ],
    },
  };
}

function commit(scene: SceneData, ops: readonly SceneOp[]): SceneModel {
  const model = SceneModel.load(scene, CATALOGUE_REGISTRIES);
  const result = model.apply({ baseRev: model.rev, ops });
  expect(result).toMatchObject({ rev: 1 });
  return model;
}

/** The living room cut in two by a partition at z = 4: the north half becomes the study, the living room moves south. */
const DIVIDE: readonly SceneOp[] = [
  { op: 'split_wall', wallId: ZONED.wall.east, at: 4, nodeId: NEW.east, ids: [NEW.eastN, NEW.eastS] },
  { op: 'split_wall', wallId: ZONED.wall.west, at: 4, nodeId: NEW.west, ids: [NEW.westS, NEW.westN] },
  { op: 'add_wall', id: NEW.partition, a: NEW.west, b: NEW.east, thickness: 0.1, role: 'partition' },
  { op: 'set_room', roomId: LIVING, anchor: { x: 5, z: 6 } },
  { op: 'add_room', id: NEW.study, name: 'Study', anchor: { x: 5, z: 2 } },
];

describe('a painted face keeps its paint when another room comes to own it', () => {
  test('dividing a room with an accent wall commits, and the accent is on the half that now owns the wall', () => {
    const scene: SceneData = {
      ...livingRoom(),
      finishes: { faces: [{ room: LIVING, wallId: ZONED.wall.north, side: 'L', finish: FINISH.graphite }] },
    };
    const model = commit(scene, DIVIDE);
    expect(faceFinishOf(model.scene, { room: NEW.study, wallId: ZONED.wall.north, side: 'L' })).toBe(FINISH.graphite);
  });

  test('a preset painting that face follows it the same way', () => {
    const scene: SceneData = {
      ...livingRoom(),
      interiors: [
        {
          id: '01a1f6d0-3c20-7b00-8f00-0000000000a1',
          name: 'Accent',
          swatch: [FINISH.oak, FINISH.graphite],
          ops: [{ op: 'set_material', target: { room: LIVING, wallId: ZONED.wall.north, side: 'L' }, material: FINISH.graphite }],
        },
      ],
    };
    const model = commit(scene, DIVIDE);
    expect(model.scene.interiors?.[0]?.ops).toEqual([
      { op: 'set_material', target: { room: NEW.study, wallId: ZONED.wall.north, side: 'L' }, material: FINISH.graphite },
    ]);
  });

  test('moving the anchors across the partition, in a batch of set_room alone, re-keys the accent to the room that now owns the face', () => {
    // The divided plan as a document of its own: the living room in the north half, owning the accent wall.
    const divided = commit(livingRoom(), DIVIDE).scene;
    const scene: SceneData = {
      ...divided,
      rooms: divided.rooms.map((room) =>
        room.id === LIVING ? { ...room, anchor: { x: 5, z: 2 } } : room.id === NEW.study ? { ...room, anchor: { x: 5, z: 6 } } : room,
      ),
      finishes: { faces: [{ room: LIVING, wallId: ZONED.wall.north, side: 'L', finish: FINISH.graphite }] },
    };
    const model = commit(scene, [
      { op: 'set_room', roomId: LIVING, anchor: { x: 5, z: 6 } },
      { op: 'set_room', roomId: NEW.study, anchor: { x: 5, z: 2 } },
    ]);
    expect(faceFinishOf(model.scene, { room: NEW.study, wallId: ZONED.wall.north, side: 'L' })).toBe(FINISH.graphite);
  });
});

describe('a preset painting a facade face follows it when a room is built against the wall', () => {
  /** The north wall's outside (side R of A -> B) gets a loggia: the facade face becomes the loggia's wall. */
  const LOGGIA: readonly SceneOp[] = [
    { op: 'add_node', id: NEW.p, p: { x: 0, z: -1.5 } },
    { op: 'add_node', id: NEW.q, p: { x: 10, z: -1.5 } },
    { op: 'add_wall', id: NEW.wAP, a: N.a, b: NEW.p, thickness: 0.2, role: 'facade' },
    { op: 'add_wall', id: NEW.wPQ, a: NEW.p, b: NEW.q, thickness: 0.2, role: 'facade' },
    { op: 'add_wall', id: NEW.wQB, a: NEW.q, b: N.b, thickness: 0.2, role: 'facade' },
    { op: 'add_room', id: NEW.loggia, name: 'Loggia', anchor: { x: 5, z: -0.75 } },
  ];
  const preset = (op: SceneOp): SceneData => ({
    ...livingRoom(),
    interiors: [{ id: '01a1f6d0-3c20-7b00-8f00-0000000000a2', name: 'Facade', swatch: [FINISH.oak, FINISH.graphite], ops: [op] }],
  });

  test('the explicit form turns from a facade paint into a wall paint of the new room, and the room commits', () => {
    const model = commit(
      preset({ op: 'set_material', surface: 'facade', face: { wallId: ZONED.wall.north, side: 'R' }, material: FINISH.graphite }),
      LOGGIA,
    );
    expect(model.scene.interiors?.[0]?.ops).toEqual([
      { op: 'set_material', surface: 'wall', face: { room: NEW.loggia, wallId: ZONED.wall.north, side: 'R' }, material: FINISH.graphite },
    ]);
  });

  test('the face-target form takes the new owner, and the room commits', () => {
    const model = commit(
      preset({ op: 'set_material', target: { wallId: ZONED.wall.north, side: 'R' }, material: FINISH.graphite }),
      LOGGIA,
    );
    expect(model.scene.interiors?.[0]?.ops).toEqual([
      { op: 'set_material', target: { room: NEW.loggia, wallId: ZONED.wall.north, side: 'R' }, material: FINISH.graphite },
    ]);
  });
});

describe('a door with an authored swing keeps the side its leaf opens to', () => {
  test('a room built outside a balcony door that opens in leaves the leaf in the living room', () => {
    const base = livingRoom();
    // The north wall drawn B -> A, so the living room lies on its RIGHT; the
    // door opens in, into the living room.
    const scene: SceneData = {
      ...base,
      walls: base.walls.map((wall) =>
        wall.id === ZONED.wall.north
          ? { ...wall, a: N.b, b: N.a, openings: [{ id: NEW.door, type: 'door', center: 5, width: 0.9, swing: 'in' }] }
          : wall,
      ),
    };
    const before = solvePlan(scene);
    const wallOf = (data: SceneData) => data.walls.find((wall) => wall.id === ZONED.wall.north)!;
    const opening = wallOf(scene).openings![0]!;
    expect(resolveDoorSwing(scene, before, wallOf(scene), opening, () => 0).roomId).toBe(LIVING);

    const model = commit(scene, [
      { op: 'add_node', id: NEW.p, p: { x: 0, z: -1.5 } },
      { op: 'add_node', id: NEW.q, p: { x: 10, z: -1.5 } },
      { op: 'add_wall', id: NEW.wAP, a: N.a, b: NEW.p, thickness: 0.2, role: 'facade' },
      { op: 'add_wall', id: NEW.wPQ, a: NEW.p, b: NEW.q, thickness: 0.2, role: 'facade' },
      { op: 'add_wall', id: NEW.wQB, a: NEW.q, b: N.b, thickness: 0.2, role: 'facade' },
      { op: 'add_room', id: NEW.loggia, name: 'Loggia', anchor: { x: 5, z: -0.75 } },
    ]);
    const after = model.scene;
    const door = wallOf(after).openings![0]!;
    expect(resolveDoorSwing(after, model.plan, wallOf(after), door, () => 0).roomId).toBe(LIVING);

    // The loggia removed again, its walls and nodes with it: the leaf still opens into the living room.
    expect(
      model.apply({
        baseRev: 1,
        ops: [
          { op: 'remove_room', roomId: NEW.loggia },
          { op: 'remove_wall', wallId: NEW.wAP },
          { op: 'remove_wall', wallId: NEW.wPQ },
          { op: 'remove_wall', wallId: NEW.wQB },
          { op: 'remove_node', nodeId: NEW.p },
          { op: 'remove_node', nodeId: NEW.q },
        ],
      }),
    ).toMatchObject({ rev: 2 });
    const reopened = model.scene;
    expect(resolveDoorSwing(reopened, model.plan, wallOf(reopened), wallOf(reopened).openings![0]!, () => 0).roomId).toBe(LIVING);
  });
});

describe('a door moved to another wall keeps the swing its move names', () => {
  test('set_opening carries an inward door onto a perpendicular wall in a batch with an unrelated add_node: it still opens in', () => {
    const base = livingRoom();
    const scene: SceneData = {
      ...base,
      walls: base.walls.map((wall) =>
        wall.id === ZONED.wall.north ? { ...wall, openings: [{ id: NEW.door, type: 'door', center: 5, width: 0.9, swing: 'in' }] } : wall,
      ),
    };
    const model = commit(scene, [
      { op: 'set_opening', openingId: NEW.door, wallId: ZONED.wall.east, center: 4 },
      // A node added and removed again: a shell edit that changes no wall side.
      { op: 'add_node', id: NEW.p, p: { x: 20, z: 20 } },
      { op: 'remove_node', nodeId: NEW.p },
    ]);
    const east = model.scene.walls.find((wall) => wall.id === ZONED.wall.east)!;
    expect(east.openings?.[0]).toMatchObject({ id: NEW.door, swing: 'in' });
  });
});

describe('a swing set_opening writes in a shell batch is the author’s latest word', () => {
  test('a door that opened in, set to open out in a batch with a shell edit, ends out', () => {
    const base = livingRoom();
    const scene: SceneData = {
      ...base,
      walls: base.walls.map((wall) =>
        wall.id === ZONED.wall.north ? { ...wall, openings: [{ id: NEW.door, type: 'door', center: 5, width: 0.9, swing: 'in' }] } : wall,
      ),
    };
    const model = commit(scene, [
      { op: 'set_opening', openingId: NEW.door, swing: 'out' },
      // A node added and removed again: a shell edit that changes no wall side.
      { op: 'add_node', id: NEW.p, p: { x: 20, z: 20 } },
      { op: 'remove_node', nodeId: NEW.p },
    ]);
    const north = model.scene.walls.find((wall) => wall.id === ZONED.wall.north)!;
    expect(north.openings?.[0]).toMatchObject({ id: NEW.door, swing: 'out' });
  });
});

/** The north wall drawn B -> A (the living room on its RIGHT), with a door that opens `swing`. */
function balconyDoor(swing: 'in' | 'out'): SceneData {
  const base = livingRoom();
  return {
    ...base,
    walls: base.walls.map((wall) =>
      wall.id === ZONED.wall.north
        ? { ...wall, a: N.b, b: N.a, openings: [{ id: NEW.door, type: 'door', center: 5, width: 0.9, swing }] }
        : wall,
    ),
  };
}

/** A loggia built outside the north wall: the wall's interior side turns from the living room to the left of B -> A. */
const LOGGIA: readonly SceneOp[] = [
  { op: 'add_node', id: NEW.p, p: { x: 0, z: -1.5 } },
  { op: 'add_node', id: NEW.q, p: { x: 10, z: -1.5 } },
  { op: 'add_wall', id: NEW.wAP, a: N.a, b: NEW.p, thickness: 0.2, role: 'facade' },
  { op: 'add_wall', id: NEW.wPQ, a: NEW.p, b: NEW.q, thickness: 0.2, role: 'facade' },
  { op: 'add_wall', id: NEW.wQB, a: NEW.q, b: N.b, thickness: 0.2, role: 'facade' },
  { op: 'add_room', id: NEW.loggia, name: 'Loggia', anchor: { x: 5, z: -0.75 } },
];

describe('a swing set_opening writes is read on the wall as it stands when the op applies', () => {
  const northOf = (data: SceneData) => data.walls.find((wall) => wall.id === ZONED.wall.north)!;

  test('written before a room is built outside the wall, the leaf keeps the side it was set to: the stored word turns', () => {
    const model = commit(balconyDoor('out'), [{ op: 'set_opening', openingId: NEW.door, swing: 'in' }, ...LOGGIA]);
    const door = northOf(model.scene).openings![0]!;
    expect(door.swing).toBe('out');
    expect(resolveDoorSwing(model.scene, model.plan, northOf(model.scene), door, () => 0).roomId).toBe(LIVING);
  });

  test('written after the room is built, the word is kept as written and read on the new wall', () => {
    const model = commit(balconyDoor('out'), [...LOGGIA, { op: 'set_opening', openingId: NEW.door, swing: 'in' }]);
    const door = northOf(model.scene).openings![0]!;
    expect(door.swing).toBe('in');
    expect(resolveDoorSwing(model.scene, model.plan, northOf(model.scene), door, () => 0).roomId).toBe(NEW.loggia);
  });
});

describe('a swing add_opening writes is read on the wall as it stands when the op applies', () => {
  const northOf = (data: SceneData) => data.walls.find((wall) => wall.id === ZONED.wall.north)!;
  /** The balcony wall with no door yet: the batch adds it. */
  const bareWall = (): SceneData => {
    const scene = balconyDoor('in');
    return { ...scene, walls: scene.walls.map((wall) => (wall.id === ZONED.wall.north ? { ...wall, openings: [] } : wall)) };
  };
  const addDoor = (swing: 'in' | 'out'): SceneOp => ({
    op: 'add_opening',
    wallId: ZONED.wall.north,
    id: NEW.door,
    type: 'door',
    center: 5,
    width: 0.9,
    swing,
  });

  test('added before a room is built outside the wall, the leaf keeps the side it was added to: the stored word turns', () => {
    const model = commit(bareWall(), [addDoor('in'), ...LOGGIA]);
    const door = northOf(model.scene).openings![0]!;
    expect(door.swing).toBe('out');
    expect(resolveDoorSwing(model.scene, model.plan, northOf(model.scene), door, () => 0).roomId).toBe(LIVING);
  });

  test('added after the room is built, the word is kept as written and read on the new wall', () => {
    const model = commit(bareWall(), [...LOGGIA, addDoor('in')]);
    const door = northOf(model.scene).openings![0]!;
    expect(door.swing).toBe('in');
    expect(resolveDoorSwing(model.scene, model.plan, northOf(model.scene), door, () => 0).roomId).toBe(NEW.loggia);
  });

  test('a door removed and added again under its id is read on its new word, not on the swing set before the removal', () => {
    const model = commit(balconyDoor('out'), [
      { op: 'set_opening', openingId: NEW.door, swing: 'in' },
      { op: 'remove_opening', openingId: NEW.door },
      addDoor('out'),
      ...LOGGIA,
    ]);
    const door = northOf(model.scene).openings![0]!;
    expect(door.swing).toBe('in');
    expect(resolveDoorSwing(model.scene, model.plan, northOf(model.scene), door, () => 0).roomId).toBe(NEW.loggia);
  });
});

describe('a door carried onto a split wall keeps its side too', () => {
  test('split the balcony wall and build a balcony against the half with the door, in one batch: the leaf stays in the living room', () => {
    const base = livingRoom();
    const scene: SceneData = {
      ...base,
      walls: base.walls.map((wall) =>
        wall.id === ZONED.wall.north
          ? { ...wall, a: N.b, b: N.a, openings: [{ id: NEW.door, type: 'door', center: 2.5, width: 0.9, swing: 'in' }] }
          : wall,
      ),
    };
    const model = commit(scene, [
      { op: 'split_wall', wallId: ZONED.wall.north, at: 5, nodeId: NEW.east, ids: [NEW.eastN, NEW.eastS] },
      { op: 'add_node', id: NEW.p, p: { x: 10, z: -1.5 } },
      { op: 'add_node', id: NEW.q, p: { x: 5, z: -1.5 } },
      { op: 'add_wall', id: NEW.wAP, a: N.b, b: NEW.p, thickness: 0.2, role: 'facade' },
      { op: 'add_wall', id: NEW.wPQ, a: NEW.p, b: NEW.q, thickness: 0.2, role: 'facade' },
      { op: 'add_wall', id: NEW.wQB, a: NEW.q, b: NEW.east, thickness: 0.2, role: 'facade' },
      { op: 'add_room', id: NEW.loggia, name: 'Balcony', anchor: { x: 7.5, z: -0.75 } },
    ]);
    const half = model.scene.walls.find((wall) => wall.id === NEW.eastN)!;
    const door = half.openings![0]!;
    expect(resolveDoorSwing(model.scene, model.plan, half, door, () => 0).roomId).toBe(LIVING);
  });
});

/** The L-shape at schema 2.4, room A the living room and room B the kitchen: removing the partition keeps B as a zone. */
function openPlan(): SceneModel {
  const scene: SceneData = {
    ...lShapePlan,
    schemaVersion: '2.4',
    rooms: lShapePlan.rooms.map((room) => ({ ...room, purpose: room.id === L_SHAPE.room.a ? 'living' : 'kitchen' })),
  };
  const model = SceneModel.load(scene, CATALOGUE_REGISTRIES);
  const merged = model.apply({ baseRev: 0, ops: [{ op: 'remove_wall', wallId: L_SHAPE.wall.wPart }] });
  expect(merged).toMatchObject({ rev: 1, roomMerges: [{ kept: 'zone' }] });
  expect(model.scene.rooms.find((room) => room.id === L_SHAPE.room.b)?.polygon).toBeDefined();
  return model;
}

describe('a zone kept by a merge is a room again once a wall closes round it', () => {
  const REBUILD: SceneOp = { op: 'add_wall', id: NEW.partition, a: L_SHAPE.node.n2, b: L_SHAPE.node.n5, thickness: 0.1, role: 'partition' };

  test('building the partition back commits, and the kitchen is an attached room under the same id', () => {
    const model = openPlan();
    expect(model.apply({ baseRev: 1, ops: [REBUILD] })).toMatchObject({ rev: 2 });
    const kitchen = model.scene.rooms.find((room) => room.id === L_SHAPE.room.b)!;
    expect(kitchen.polygon).toBeUndefined();
    expect(model.plan.rooms.find((room) => room.roomId === L_SHAPE.room.b)?.loop.length).toBeGreaterThan(0);
  });

  test('set_room with polygon: null re-attaches a zone explicitly, and refuses a room that has no outline', () => {
    const model = openPlan();
    const result = model.apply({ baseRev: 1, ops: [{ op: 'set_room', roomId: L_SHAPE.room.b, polygon: null }, REBUILD] });
    expect(result).toMatchObject({ rev: 2 });
    expect(isApplyOk(result) && result.applied[0]!.summary).toBe(`Room ${L_SHAPE.room.b}: attached to its walls`);
    expect(model.scene.rooms.find((room) => room.id === L_SHAPE.room.b)!.polygon).toBeUndefined();
    expect(model.apply({ baseRev: 2, ops: [{ op: 'set_room', roomId: L_SHAPE.room.a, polygon: null }] })).toMatchObject({
      error: 'validation_failed',
      message: expect.stringContaining('already attached to its walls'),
    });
  });
});

describe('a zone may not be left outside the room it lies in', () => {
  test('pulling a facade corner of the open plan in through the kitchen zone is refused', () => {
    const model = openPlan();
    expect(model.apply({ baseRev: 1, ops: [{ op: 'move_node', nodeId: L_SHAPE.node.n4, p: { x: 8, z: 5 } }] })).toEqual({
      error: 'validation_failed',
      message: `Zone ${L_SHAPE.room.b} would stand outside room ${L_SHAPE.room.a}: move the wall back, or attach the zone with set_room { polygon: null } first`,
    });
  });

  test('moving the corner out, so the outline stays inside, commits', () => {
    const model = openPlan();
    expect(model.apply({ baseRev: 1, ops: [{ op: 'move_node', nodeId: L_SHAPE.node.n4, p: { x: 11, z: 5 } }] })).toMatchObject({ rev: 2 });
  });
});

describe('a placement moved without a room is bound to the room it now stands in', () => {
  const SOFA = L_SHAPE.asset.sofa;
  const bound: SceneData = {
    ...lShapePlan,
    assets: lShapePlan.assets.map((asset) => (asset.id === SOFA ? { ...asset, room: L_SHAPE.room.a } : asset)),
  };
  const roomOfSofa = (model: SceneModel) => model.scene.assets.find((asset) => asset.id === SOFA)!.room;

  test('dragged across the partition, a bound sofa belongs to the room it stands in', () => {
    const model = commit(bound, [{ op: 'move_object', assetId: SOFA, position: { x: 8, y: 0, z: 2.5 } }]);
    expect(roomOfSofa(model)).toBe(L_SHAPE.room.b);
  });

  test('a room the caller names is kept, and an unbound placement stays unbound', () => {
    const named = commit(bound, [{ op: 'move_object', assetId: SOFA, position: { x: 8, y: 0, z: 2.5 }, room: L_SHAPE.room.a }]);
    expect(roomOfSofa(named)).toBe(L_SHAPE.room.a);
    const unbound = commit(lShapePlan, [{ op: 'move_object', assetId: SOFA, position: { x: 8, y: 0, z: 2.5 } }]);
    expect(roomOfSofa(unbound)).toBeUndefined();
  });
});
