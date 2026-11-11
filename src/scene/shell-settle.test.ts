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
import { SceneModel } from './scene-model.js';
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
  });
});

describe('a zone kept by a merge is a room again once a wall closes round it', () => {
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
  const REBUILD: SceneOp = { op: 'add_wall', id: NEW.partition, a: L_SHAPE.node.n2, b: L_SHAPE.node.n5, thickness: 0.1, role: 'partition' };

  test('building the partition back commits, and the kitchen is an attached room under the same id', () => {
    const model = openPlan();
    expect(model.apply({ baseRev: 1, ops: [REBUILD] })).toMatchObject({ rev: 2 });
    const kitchen = model.scene.rooms.find((room) => room.id === L_SHAPE.room.b)!;
    expect(kitchen.polygon).toBeUndefined();
    expect(model.plan.rooms.find((room) => room.roomId === L_SHAPE.room.b)?.loop.length).toBeGreaterThan(0);
  });

  test('set_room with polygon: null re-attaches a zone explicitly', () => {
    const model = openPlan();
    expect(model.apply({ baseRev: 1, ops: [REBUILD, { op: 'set_room', roomId: L_SHAPE.room.b, polygon: null }] })).toMatchObject({ rev: 2 });
    expect(model.scene.rooms.find((room) => room.id === L_SHAPE.room.b)!.polygon).toBeUndefined();
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
