/**
 * `add_room`, `set_room`, `remove_room`.
 *
 * What the applier owns and what the VALIDATOR owns is the theme of the last
 * test: an anchor that lands outside any free face of the wall graph is a legal
 * operation on a draft and an illegal DOCUMENT, so it is `SceneModel.apply`
 * that refuses it, one layer up, with the whole batch.
 */

import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { lShapePlan } from '../../fixtures/plan-l-shape.js';
import { L_SHAPE, PLAN_MATERIAL } from '../../fixtures/plan-l-shape-ids.js';
import { opDraft, rejectsOp } from '../../fixtures/op-drafts.js';
import { FINISH } from '../../materials/finish-ids.js';
import { SceneModel, isApplyOk } from '../scene-model.js';
import { OpError, applyOp, TOUCHED_SHELL, touchedAsset, touchedFace, touchedFloor, touchedRoomWalls } from '../scene-ops.js';
import { faceKey } from '../types.js';
import { ROOM_NAME_MAX } from './limits.js';
import { draftOf, type Draft } from '../../shared/committed.js';
import type { SceneData, SceneOp } from '../types.js';

const { a: ROOM_A, b: ROOM_B } = L_SHAPE.room;

/** Interior presets the dependents fixture declares. */
const PRESET = {
  warm: '01a12ff3-0a45-7eee-86ca-dfa3e2f35764',
  mixed: '01a12ff3-0a46-7510-8c73-701787d26562',
} as const;

/** Ids of the rooms these tests create, minted offline like every fixture id. */
const NEW = {
  kitchen: '01a12ff3-0a42-7c69-a9b5-e117cc01f211',
  terrace: '01a12ff3-0a43-71e7-9c3e-178e68d26816',
  ghost: '01a12ff3-0a44-7c17-8926-581fea369a9c',
} as const;

/** A tour checkpoint a test adds to the fixture. */
const CHECKPOINT_ID = '01a12ff9-b266-7911-bbec-1f5799f653ad';

/** A well-formed UUID of version 4: the right shape, the wrong version. */
const UUID_V4 = '3b241101-e2bb-4255-8caf-4136c566a962';

function apply(scene: Draft<SceneData>, op: Parameters<typeof applyOp>[1]): ReturnType<typeof applyOp> {
  return applyOp(scene, op, CATALOGUE_REGISTRIES);
}

/** The `OpError` an `add_room` with this id raises on a fresh draft, or a test failure. */
function idRefusal(id: unknown, scene: Draft<SceneData> = opDraft()): OpError {
  const op = { op: 'add_room', id, name: 'Kitchen', anchor: { x: 8, z: 6.5 } } as unknown as SceneOp;
  try {
    apply(scene, op);
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error('add_room was expected to refuse its id');
}

describe('add_room', () => {
  test("takes the caller's id, starts on the default floor finish and reports the anchor", () => {
    const scene = opDraft();

    const outcome = apply(scene, { op: 'add_room', id: NEW.kitchen, name: 'Kitchen', anchor: { x: 8, z: 6.5 } });

    const added = scene.rooms.at(-1)!;
    expect(added).toEqual({ id: NEW.kitchen, name: 'Kitchen', anchor: { x: 8, z: 6.5 }, floorMaterial: FINISH.oak });
    expect(outcome.summary).toBe(`Room ${NEW.kitchen}: added Kitchen at (8.00, 6.50)`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL, touchedFloor(NEW.kitchen)]);
  });

  test('takes a kind, an accent and a floor finish', () => {
    const scene = opDraft();

    apply(scene, {
      op: 'add_room',
      id: NEW.terrace,
      name: 'Terrace',
      anchor: { x: 8, z: 6.5 },
      floorMaterial: FINISH.walnut,
      kind: 'loggia',
      accent: '#a8b5a4',
    });

    expect(scene.rooms.at(-1)).toEqual({
      id: NEW.terrace,
      name: 'Terrace',
      anchor: { x: 8, z: 6.5 },
      floorMaterial: FINISH.walnut,
      kind: 'loggia',
      accent: '#a8b5a4',
    });
  });

  test('a missing id or one that is not a UUID v7 is invalid_id: the viewer mints none', () => {
    expect(idRefusal(undefined).detail).toEqual({ reason: 'invalid_id', field: 'id', id: null, op: 'add_room' });
    expect(idRefusal(UUID_V4).detail).toEqual({ reason: 'invalid_id', field: 'id', id: UUID_V4, op: 'add_room' });
    expect(idRefusal('kitchen').detail).toEqual({ reason: 'invalid_id', field: 'id', id: 'kitchen', op: 'add_room' });
  });

  test('every id the document has claimed is duplicate_id, not just the room ids', () => {
    // One claimed set across every kind — rooms, walls, placements and the
    // document's own materials alike — because that is what the validator
    // keeps: a room created onto any of them would lose its batch at commit.
    for (const taken of [ROOM_A, L_SHAPE.wall.wPart, L_SHAPE.asset.sofa, PLAN_MATERIAL.oak]) {
      expect(idRefusal(taken).detail).toEqual({ reason: 'duplicate_id', field: 'id', id: taken, op: 'add_room' });
    }
  });

  test("the scene's own id, a preset's and a tour checkpoint's are claimed too", () => {
    const scene = opDraft();
    scene.interiors = [
      {
        id: PRESET.warm,
        name: 'Warm',
        swatch: [FINISH.oak, FINISH.sand],
        ops: [{ op: 'set_material', target: 'walls', material: FINISH.sand }],
      },
    ];
    scene.tourCheckpoints = [{ id: CHECKPOINT_ID, position: { x: 2, y: 1.6, z: 3 }, yaw: 0, pitch: 0 }];
    for (const taken of [scene.id, PRESET.warm, CHECKPOINT_ID]) {
      expect(idRefusal(taken, draftOf(scene)).detail).toEqual({ reason: 'duplicate_id', field: 'id', id: taken, op: 'add_room' });
    }
  });

  test('rejects an empty or over-long name, a non-finite anchor and a finish that is not a floor', () => {
    const scene = opDraft();
    const anchor = { x: 8, z: 6.5 };
    const id = NEW.kitchen;
    expect(rejectsOp(scene, { op: 'add_room', id, name: '  ', anchor })).toContain('needs a name');
    expect(rejectsOp(scene, { op: 'add_room', id, name: 'x'.repeat(ROOM_NAME_MAX + 1), anchor })).toContain(String(ROOM_NAME_MAX));
    expect(rejectsOp(scene, { op: 'add_room', id, name: 'Kitchen', anchor: { x: Number.NaN, z: 1 } })).toContain('anchor');
    expect(rejectsOp(scene, { op: 'add_room', id, name: 'Kitchen', anchor, floorMaterial: NEW.ghost })).toContain('Unknown finish');
    expect(rejectsOp(scene, { op: 'add_room', id, name: 'Kitchen', anchor, floorMaterial: FINISH.sand })).toContain('not a floor finish');
    expect(scene.rooms).toHaveLength(2);
  });
});

describe('set_room', () => {
  test('renames a room and says what it was', () => {
    const scene = opDraft();

    const outcome = apply(scene, { op: 'set_room', roomId: ROOM_A, name: 'Kitchen' });

    expect(scene.rooms[0]!.name).toBe('Kitchen');
    expect(outcome.summary).toBe(`Room ${ROOM_A}: name Room A → Kitchen`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
  });

  test('moves the anchor, changes the kind and the accent, and lists every change it made', () => {
    const scene = opDraft();

    const outcome = apply(scene, { op: 'set_room', roomId: ROOM_B, anchor: { x: 8.5, z: 2 }, kind: 'loggia', accent: '#123456' });

    expect(scene.rooms[1]!.anchor).toEqual({ x: 8.5, z: 2 });
    expect(scene.rooms[1]!.kind).toBe('loggia');
    expect(outcome.summary).toBe(`Room ${ROOM_B}: kind room → loggia, anchor (8.00, 2.50) → (8.50, 2.00), accent → #123456`);
  });

  test('rejects an unknown room, a batch that changes nothing and a name outside the limits', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'set_room', roomId: NEW.ghost, name: 'Kitchen' })).toContain(`Unknown room ${NEW.ghost}`);
    expect(rejectsOp(scene, { op: 'set_room', roomId: ROOM_A })).toContain('needs at least one field');
    expect(rejectsOp(scene, { op: 'set_room', roomId: ROOM_A, name: '' })).toContain('needs a name');
    expect(rejectsOp(scene, { op: 'set_room', roomId: ROOM_A, name: 'x'.repeat(ROOM_NAME_MAX + 1) })).toContain(String(ROOM_NAME_MAX));
    expect(rejectsOp(scene, { op: 'set_room', roomId: ROOM_A, anchor: { x: 1, z: Number.POSITIVE_INFINITY } })).toContain('anchor');
    expect(scene.rooms[0]!.name).toBe('Room A');
  });
});

describe('remove_room', () => {
  /** The L-shape plan with everything that can possibly point at room A pointing at it. */
  function withDependents(): Draft<SceneData> {
    const scene = opDraft();
    scene.assets[0]!.room = ROOM_A;
    scene.finishes = {
      rooms: { [ROOM_A]: { floor: FINISH.walnut }, [ROOM_B]: { walls: FINISH.sage } },
      faces: [
        { ...faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L'), finish: FINISH.terra },
        { ...faceKey(ROOM_B, L_SHAPE.wall.wPart, 'R'), finish: FINISH.sage },
      ],
    };
    scene.interiors = [
      {
        id: PRESET.warm,
        name: 'Warm',
        swatch: [FINISH.oak, FINISH.sand],
        ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.walnut }],
      },
      {
        id: PRESET.mixed,
        name: 'Mixed',
        swatch: [FINISH.oak, FINISH.sand],
        ops: [
          { op: 'set_material', target: faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L'), material: FINISH.graphite },
          { op: 'set_material', target: ROOM_B, material: FINISH.ash },
        ],
      },
    ];
    return scene;
  }

  test('drops the room and everything that only made sense with it', () => {
    const scene = withDependents();

    apply(scene, { op: 'remove_room', roomId: ROOM_A });

    expect(scene.rooms.map((room) => room.id)).toEqual([ROOM_B]);
    expect(scene.assets[0]!.room).toBeUndefined();
    expect(scene.roomCameras[ROOM_A]).toBeUndefined();
    expect(scene.roomCameras[ROOM_B]).toBeDefined();
    expect(scene.finishes!.rooms).toEqual({ [ROOM_B]: { walls: FINISH.sage } });
    expect(scene.finishes!.faces).toEqual([{ room: ROOM_B, wallId: L_SHAPE.wall.wPart, side: 'R', finish: FINISH.sage }]);
    // The preset that only painted room A is gone; the one that also painted
    // room B keeps its other operation.
    expect(scene.interiors!.map((preset) => preset.id)).toEqual([PRESET.mixed]);
    expect(scene.interiors![0]!.ops).toEqual([{ op: 'set_material', target: ROOM_B, material: FINISH.ash }]);
  });

  test('names the side effects in the summary and lists the unbound furniture in touched', () => {
    const scene = withDependents();

    const outcome = apply(scene, { op: 'remove_room', roomId: ROOM_A });

    expect(outcome.summary).toBe(`Room ${ROOM_A}: removed Room A, 1 object unbound, room camera dropped, finishes dropped`);
    expect(outcome.touched).toEqual([
      TOUCHED_SHELL,
      touchedFloor(ROOM_A),
      touchedRoomWalls(ROOM_A),
      touchedFace(faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L')),
      touchedAsset(L_SHAPE.asset.sofa),
    ]);
  });

  test('a room nothing depends on goes quietly', () => {
    const scene = opDraft();
    delete scene.roomCameras[ROOM_B];

    const outcome = apply(scene, { op: 'remove_room', roomId: ROOM_B });

    expect(outcome.summary).toBe(`Room ${ROOM_B}: removed Room B`);
    expect(outcome.touched).toEqual([TOUCHED_SHELL]);
  });

  test('rejects an unknown room', () => {
    expect(rejectsOp(opDraft(), { op: 'remove_room', roomId: NEW.ghost })).toContain(`Unknown room ${NEW.ghost}`);
  });
});

describe('what the applier does NOT decide', () => {
  test('an anchor outside every free face of the graph applies, and the batch loses at commit', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);

    const result = model.apply({ baseRev: 0, ops: [{ op: 'add_room', id: NEW.kitchen, name: 'Nowhere', anchor: { x: 50, z: 50 } }] });

    expect(isApplyOk(result)).toBe(false);
    expect(model.rev).toBe(0);
    expect(model.scene.rooms).toHaveLength(2);
  });

  test('a room whose anchor lands in a free face commits', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);

    const result = model.apply({ baseRev: 0, ops: [{ op: 'set_room', roomId: ROOM_A, name: 'Kitchen' }] });

    expect(isApplyOk(result)).toBe(true);
    expect(model.scene.rooms[0]!.name).toBe('Kitchen');
  });
});
