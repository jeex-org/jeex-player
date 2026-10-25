/**
 * What stayed in `scene-ops.ts` when the appliers moved into `scene/ops/*`:
 * the finish projections, `set_material`, and the dispatcher itself.
 *
 * Plus the one test that spans all of them — the vocabulary snapshot at the
 * bottom, recorded on the undivided file and asserted unchanged ever since.
 * The moved operations are tested next to their modules
 * (`ops/shell.test.ts`, `ops/openings.test.ts`, `ops/assets.test.ts`);
 * `scene-model.test.ts` covers what the model does around them (revisions,
 * validation of the candidate, rollback).
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { OPENING_VARIANT, VARIANT, ARCHETYPE } from '../assets/catalogue-ids.js';
import { describe, expect, test } from 'bun:test';
import { draftOf } from '../shared/committed.js';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { opDraft as draft, rejectsOp as rejects } from '../fixtures/op-drafts.js';
import { FINISH } from '../materials/finish-ids.js';
import { faceKey, type SetMaterialTargetOp } from './types.js';
import {
  DEFAULT_WALL_FINISH,
  TOUCHED_FACADE,
  TOUCHED_SHELL,
  applyOp,
  facadeFinishOf,
  faceFinishOf,
  floorFinishOf,
  roomWallFinishOf,
  touchedAsset,
  touchedFace,
  touchedFloor,
  touchedOpening,
  touchedRoomWalls,
  type SceneOp,
  type TouchedEntity,
} from './scene-ops.js';
import { TOUCHED_AUTOTOUR, TOUCHED_NAVIGATION, OpError, touchedCamera, touchedCeiling, touchedTrim } from './ops/context.js';
import { LIBRARY_FINISH as LIB, LIBRARY_REGISTRIES } from '../fixtures/library-finishes.js';
import type { Draft } from '../shared/committed.js';
import type { SceneData } from './types.js';

const { a: ROOM_A, b: ROOM_B } = L_SHAPE.room;
const W = L_SHAPE.wall;

/** Ids the snapshot's creating operations take, and a room nobody has, minted offline. */
const NEW = {
  room: '01a12ff3-0a3f-7500-a4d0-f2ff986c807b',
  wall: '01a12ff3-0a40-7d74-9e8f-0182b9e30b33',
  node: '01a12ff3-0a41-70a5-8b63-d7209288462b',
  spare: '01a12ff3-0a42-7c69-a9b5-e117cc01f211',
  window: '01a12ff3-0a43-71e7-9c3e-178e68d26816',
  sofa: '01a12ff3-0a44-7c17-8926-581fea369a9c',
  splitNode: '01a12ff3-0a45-7eee-86ca-dfa3e2f35764',
  splitWest: '01a12ff3-0a46-7510-8c73-701787d26562',
  splitEast: '01a12ff3-0a47-7230-b346-4866d8f47959',
  ghost: '01a12ff3-0a48-7769-9a2a-3edd0a720c9b',
} as const;

describe('finish projections', () => {
  test('defaults come from the catalogue and the authored floor material', () => {
    const scene = draft();
    expect(floorFinishOf(scene, ROOM_A)).toBe(FINISH.oak);
    expect(roomWallFinishOf(scene, ROOM_A)).toBe(DEFAULT_WALL_FINISH);
    expect(facadeFinishOf(scene)).toBe(DEFAULT_WALL_FINISH);
    expect(faceFinishOf(scene, faceKey(ROOM_A, W.wPart, 'L'))).toBe(DEFAULT_WALL_FINISH);
  });

  test('the default wall finish is a wall finish the bundled bank knows', () => {
    expect(CATALOGUE_REGISTRIES.isSurfaceFinish(DEFAULT_WALL_FINISH)).toBe(true);
    expect(CATALOGUE_REGISTRIES.finishKind(DEFAULT_WALL_FINISH)).toBe('wall');
  });

  test('a face falls back to its owner: the room it names, or the facade when it names none', () => {
    const scene = draft();
    applyOp(scene, { op: 'set_material', target: ROOM_A, material: FINISH.sage }, CATALOGUE_REGISTRIES);
    applyOp(scene, { op: 'set_material', target: 'facade', material: FINISH.terra }, CATALOGUE_REGISTRIES);
    expect(faceFinishOf(scene, faceKey(ROOM_A, W.wW, 'L'))).toBe(FINISH.sage);
    expect(faceFinishOf(scene, faceKey(null, W.wW, 'R'))).toBe(FINISH.terra);
  });
});

describe('set_material', () => {
  test('a room target routes by finish family: floor finish paints the floor', () => {
    const scene = draft();
    const outcome = applyOp(scene, { op: 'set_material', target: ROOM_A, material: FINISH.walnut }, CATALOGUE_REGISTRIES);
    expect(floorFinishOf(scene, ROOM_A)).toBe(FINISH.walnut);
    expect(roomWallFinishOf(scene, ROOM_A)).toBe(DEFAULT_WALL_FINISH);
    expect(outcome.touched).toEqual([touchedFloor(ROOM_A)]);
    // The authored default is untouched, so the export stays a diff.
    expect(scene.rooms.find((room) => room.id === ROOM_A)!.floorMaterial).toBe(FINISH.oak);
  });

  test('a room target with a wall finish paints the room walls and drops its face overrides', () => {
    const scene = draft();
    const face = faceKey(ROOM_A, W.wPart, 'L');
    applyOp(scene, { op: 'set_material', target: face, material: FINISH.graphite }, CATALOGUE_REGISTRIES);
    expect(faceFinishOf(scene, face)).toBe(FINISH.graphite);
    const outcome = applyOp(scene, { op: 'set_material', target: ROOM_A, material: FINISH.sage }, CATALOGUE_REGISTRIES);
    expect(roomWallFinishOf(scene, ROOM_A)).toBe(FINISH.sage);
    expect(faceFinishOf(scene, face)).toBe(FINISH.sage);
    expect(scene.finishes!.faces).toEqual([]);
    expect(outcome.touched).toEqual([touchedRoomWalls(ROOM_A)]);
  });

  test('a face target paints exactly one face and leaves the room and its neighbour alone', () => {
    const scene = draft();
    const face = faceKey(ROOM_A, W.wPart, 'L');
    const outcome = applyOp(scene, { op: 'set_material', target: face, material: FINISH.terra, scope: 'face' }, CATALOGUE_REGISTRIES);
    expect(faceFinishOf(scene, face)).toBe(FINISH.terra);
    expect(faceFinishOf(scene, faceKey(ROOM_B, W.wPart, 'R'))).toBe(DEFAULT_WALL_FINISH);
    expect(roomWallFinishOf(scene, ROOM_A)).toBe(DEFAULT_WALL_FINISH);
    expect(outcome.summary).toBe(`Wall face ${ROOM_A}/${W.wPart}/L set to ${FINISH.terra}`);
    expect(outcome.touched).toEqual([touchedFace(face)]);
  });

  test('repainting a face replaces its entry in place; a new face is appended', () => {
    const scene = draft();
    const first = faceKey(ROOM_A, W.wPart, 'L');
    const second = faceKey(null, W.wW, 'R');
    applyOp(scene, { op: 'set_material', target: first, material: FINISH.terra }, CATALOGUE_REGISTRIES);
    applyOp(scene, { op: 'set_material', target: second, material: FINISH.sage }, CATALOGUE_REGISTRIES);
    applyOp(scene, { op: 'set_material', target: first, material: FINISH.graphite }, CATALOGUE_REGISTRIES);
    expect(scene.finishes!.faces).toEqual([
      { room: ROOM_A, wallId: W.wPart, side: 'L', finish: FINISH.graphite },
      { wallId: W.wW, side: 'R', finish: FINISH.sage },
    ]);
  });

  test("scope 'room' widens a face to its owner, and to the facade for an outer face", () => {
    const scene = draft();
    applyOp(scene, { op: 'set_material', target: faceKey(ROOM_A, W.wW, 'L'), material: FINISH.sage, scope: 'room' }, CATALOGUE_REGISTRIES);
    expect(roomWallFinishOf(scene, ROOM_A)).toBe(FINISH.sage);
    const facade = applyOp(
      scene,
      { op: 'set_material', target: faceKey(null, W.wW, 'R'), material: FINISH.terra, scope: 'room' },
      CATALOGUE_REGISTRIES,
    );
    expect(facade.touched).toEqual([TOUCHED_FACADE]);
    expect(facadeFinishOf(scene)).toBe(FINISH.terra);
    expect(roomWallFinishOf(scene, ROOM_A)).toBe(FINISH.sage);
  });

  test("the 'floors' and 'walls' aliases cover every room, and 'facade' stays separate", () => {
    const scene = draft();
    const floors = applyOp(scene, { op: 'set_material', target: 'floors', material: FINISH.ash }, CATALOGUE_REGISTRIES);
    expect(floors.touched).toEqual([touchedFloor(ROOM_A), touchedFloor(ROOM_B)]);
    for (const room of scene.rooms) expect(floorFinishOf(scene, room.id)).toBe(FINISH.ash);
    const walls = applyOp(scene, { op: 'set_material', target: 'walls', material: FINISH.white }, CATALOGUE_REGISTRIES);
    expect(walls.touched).toEqual([touchedRoomWalls(ROOM_A), touchedRoomWalls(ROOM_B)]);
    expect(facadeFinishOf(scene)).toBe(DEFAULT_WALL_FINISH);
    const facade = applyOp(scene, { op: 'set_material', target: 'facade', material: FINISH.graphite }, CATALOGUE_REGISTRIES);
    expect(facade.touched).toEqual([TOUCHED_FACADE]);
    expect(roomWallFinishOf(scene, ROOM_A)).toBe(FINISH.white);
  });

  test('rejects an unknown finish, an unknown target and a family mismatch', () => {
    const scene = draft();
    expect(rejects(scene, { op: 'set_material', target: ROOM_A, material: NEW.ghost })).toContain('Unknown finish');
    expect(rejects(scene, { op: 'set_material', target: NEW.ghost, material: FINISH.sage })).toContain('Unknown set_material target');
    expect(rejects(scene, { op: 'set_material', target: 'floors', material: FINISH.sage })).toContain('not a floor finish');
    expect(rejects(scene, { op: 'set_material', target: 'facade', material: FINISH.oak })).toContain('not a wall finish');
    expect(rejects(scene, { op: 'set_material', target: faceKey(ROOM_A, W.wW, 'L'), material: FINISH.oak })).toContain('not a wall finish');
    expect(scene.finishes).toBeUndefined();
  });

  test('rejects a face target that is not a face key, or names a wall or room the scene lacks', () => {
    const scene = draft();
    const malformed = { wallId: W.wW } as unknown as SetMaterialTargetOp['target'];
    expect(rejects(scene, { op: 'set_material', target: malformed, material: FINISH.sand })).toContain('not a wall face');
    expect(rejects(scene, { op: 'set_material', target: faceKey(ROOM_A, NEW.ghost, 'L'), material: FINISH.sand })).toContain(
      `unknown wall ${NEW.ghost}`,
    );
    expect(rejects(scene, { op: 'set_material', target: faceKey(NEW.ghost, W.wW, 'L'), material: FINISH.sand })).toContain(
      `unknown room ${NEW.ghost}`,
    );
    expect(scene.finishes).toBeUndefined();
  });
});

test('an unknown operation is rejected by name', () => {
  const scene = draft();
  // Deliberately not a name the vocabulary is growing towards: `set_wall` used
  // to stand here and became a real operation.
  expect(rejects(scene, { op: 'demolish_everything' } as unknown as SceneOp)).toContain('Unknown operation demolish_everything');
});

/* ------------------------------------------------- the vocabulary snapshot --- */

/**
 * Every operation of the vocabulary against the DEMO apartment, with the exact
 * `summary` and `touched` it produced, written out.
 *
 * It was taken on `main` BEFORE `scene-ops.ts` was split into `scene/ops/*`
 * and asserted unchanged after: a refactor that moves an applier into another
 * file is a refactor only if a host editor's journal line and the geometry
 * layer's repaint keys come out byte for byte the same. Schema 2.0 changed the
 * ids in every line on purpose — entities are UUIDs, touched entities are
 * structures — and the sentences around them stayed as they were. The other
 * tests in this file say what each rule MEANS; this one says that nothing
 * moved.
 *
 * A deliberate change to a summary updates a line here and says so in its
 * commit; that is the point of writing them out rather than generating them.
 *
 * An operation ADDED to the vocabulary gets its row at the bottom, recorded
 * the day it landed: the table is what the coverage test below spans against
 * the union, so a new operation with no row here is a failure, not an
 * omission.
 */
type VocabularyCase = {
  name: string;
  /**
   * Operations applied before the measured one, for a case the demo apartment
   * cannot present on its own: every node of the demo carries walls, so
   * `remove_node` has nothing to remove until one is added. Their own summaries
   * are not asserted — the row that adds them does that.
   */
  before?: readonly SceneOp[];
  op: SceneOp;
  summary: string;
  touched: TouchedEntity[];
};

const R = DEMO.room;
const ROOMS_IN_ORDER = [R.kitchen, R.bathroom, R.wc, R.guestRoom, R.hall, R.living, R.bedroom, R.study, R.loggia];
const PLANT = DEMO.asset.livingPlant;
// The corridor's south wall runs east, so the hall (north of it) is its right side.
const HALL_FACE = faceKey(R.hall, DEMO.wall.wallLivingHall, 'R');

const VOCABULARY_SNAPSHOT: readonly VocabularyCase[] = [
  {
    name: 'set_material floors',
    op: { op: 'set_material', target: 'floors', material: FINISH.oak },
    summary: `Floor finish ${FINISH.oak} applied to every room`,
    touched: ROOMS_IN_ORDER.map((room) => touchedFloor(room)),
  },
  {
    name: 'set_material walls',
    op: { op: 'set_material', target: 'walls', material: FINISH.sand },
    summary: `Wall finish ${FINISH.sand} applied to every room`,
    touched: ROOMS_IN_ORDER.map((room) => touchedRoomWalls(room)),
  },
  {
    name: 'set_material facade',
    op: { op: 'set_material', target: 'facade', material: FINISH.sand },
    summary: `Facade finish set to ${FINISH.sand}`,
    touched: [TOUCHED_FACADE],
  },
  {
    name: 'set_material room',
    op: { op: 'set_material', target: R.living, material: FINISH.walnut },
    summary: `Floor of Living and dining room set to ${FINISH.walnut}`,
    touched: [touchedFloor(R.living)],
  },
  {
    name: 'set_material face',
    op: { op: 'set_material', target: HALL_FACE, material: FINISH.sand },
    summary: `Wall face ${R.hall}/${DEMO.wall.wallLivingHall}/R set to ${FINISH.sand}`,
    touched: [touchedFace(HALL_FACE)],
  },
  {
    name: 'set_material face scope room',
    op: { op: 'set_material', target: HALL_FACE, material: FINISH.sand, scope: 'room' },
    summary: `Walls of Entrance hall set to ${FINISH.sand}`,
    touched: [touchedRoomWalls(R.hall)],
  },
  {
    name: 'replace_asset_variant',
    op: { op: 'replace_asset_variant', assetId: PLANT, variant: VARIANT.plant_strelitzia_clay },
    summary: `Asset ${PLANT} replaced with variant ${VARIANT.plant_strelitzia_clay}`,
    touched: [touchedAsset(PLANT)],
  },
  {
    name: 'replace_opening_variant',
    op: { op: 'replace_opening_variant', openingId: DEMO.opening.windowLivingBay, variant: OPENING_VARIANT.window_graphite_grid },
    summary: `Opening ${DEMO.opening.windowLivingBay} replaced with variant ${OPENING_VARIANT.window_graphite_grid}`,
    touched: [touchedOpening(DEMO.opening.windowLivingBay)],
  },
  {
    name: 'set_ceiling',
    op: { op: 'set_ceiling', height: 2.8 },
    summary: 'Ceiling height set to 2.8 m',
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'set_opening absolute',
    op: { op: 'set_opening', openingId: DEMO.opening.windowStudy, center: 1.4, width: 1.1 },
    summary: `Opening ${DEMO.opening.windowStudy} set to centre 1.4 m, width 1.1 m, sill 0.85 m, head 2.3 m`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'set_opening delta',
    op: { op: 'set_opening', openingId: DEMO.opening.windowStudy, dcenter: 0.2, dwidth: -0.1 },
    summary: `Opening ${DEMO.opening.windowStudy} set to centre 1.3 m, width 1.1 m, sill 0.85 m, head 2.3 m`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'add_opening',
    // The study's corridor wall is 2.20 m long and its door already occupies
    // 0.20..1.00, so the window goes east of it: a window at 0.60 x 0.80 would
    // sit right on top of the door, and `add_opening` refuses that itself
    // through its fit check (`ops/openings.fitOntoWall`) rather than leaving a
    // document `validateScene` refuses with `openings-overlap`. Neither the
    // summary nor the touched entities depend on the geometry.
    op: { op: 'add_opening', id: NEW.window, wallId: DEMO.wall.wallStudyHall, type: 'window', center: 1.6, width: 0.6 },
    summary: `Added window ${NEW.window} to wall ${DEMO.wall.wallStudyHall}`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'remove_opening',
    op: { op: 'remove_opening', openingId: DEMO.opening.windowStudy },
    summary: `Removed opening ${DEMO.opening.windowStudy} from wall ${DEMO.wall.facSouthStudy}`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'set_camera presentation',
    op: {
      op: 'set_camera',
      target: 'presentation',
      pose: { position: { x: 6.6, y: 14.5, z: 21.5 }, target: { x: 6.6, y: 0.6, z: 5.2 } },
    },
    summary: 'Camera presentation set to (6.6, 14.5, 21.5)',
    touched: [touchedCamera('presentation')],
  },
  {
    name: 'set_camera walkSpawn',
    op: {
      op: 'set_camera',
      target: 'walkSpawn',
      pose: { position: { x: 4.0, y: 1.6, z: 8.3 }, target: { x: 0.5, y: 1.3, z: 5.6 } },
    },
    summary: 'Camera walkSpawn set to (4, 1.6, 8.3)',
    touched: [touchedCamera('walkSpawn')],
  },
  {
    name: 'set_camera room',
    op: {
      op: 'set_camera',
      target: { room: R.kitchen },
      pose: { position: { x: 3.6, y: 1.6, z: 2.9 }, target: { x: 1.6, y: 1.2, z: 0.5 } },
    },
    summary: `Camera room:${R.kitchen} set to (3.6, 1.6, 2.9)`,
    touched: [touchedCamera({ room: R.kitchen })],
  },
  {
    name: 'set_camera remove walkSpawn',
    op: { op: 'set_camera', target: 'walkSpawn', remove: true },
    summary: 'Camera walkSpawn removed',
    touched: [touchedCamera('walkSpawn')],
  },
  {
    name: 'set_camera remove room',
    op: { op: 'set_camera', target: { room: R.kitchen }, remove: true },
    summary: `Camera room:${R.kitchen} removed`,
    touched: [touchedCamera({ room: R.kitchen })],
  },
  {
    name: 'set_navigation',
    op: {
      op: 'set_navigation',
      points: [
        { x: 1, y: 1.6, z: 2 },
        { x: 3, y: 1.6, z: 4 },
      ],
    },
    summary: 'Navigation set to 2 points',
    touched: [TOUCHED_NAVIGATION],
  },
  {
    name: 'set_autotour speed',
    op: { op: 'set_autotour', speed: 1.5 },
    summary: 'Autotour updated: speed 1.5 m/s',
    touched: [TOUCHED_AUTOTOUR],
  },
  {
    name: 'add_room',
    op: { op: 'add_room', id: NEW.room, name: 'Pantry', anchor: { x: 1.2, z: 1.2 } },
    summary: `Room ${NEW.room}: added Pantry at (1.20, 1.20)`,
    touched: [TOUCHED_SHELL, touchedFloor(NEW.room)],
  },
  {
    name: 'set_room',
    op: { op: 'set_room', roomId: R.kitchen, name: 'Cookhouse' },
    summary: `Room ${R.kitchen}: name Kitchen → Cookhouse`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'remove_room',
    op: { op: 'remove_room', roomId: R.wc },
    // The demo binds the WC's three pieces to it (`DemoAsset.room`), so the
    // removal unbinds them and names each one.
    summary: `Room ${R.wc}: removed WC, 3 objects unbound, room camera dropped`,
    touched: [TOUCHED_SHELL, touchedAsset(DEMO.asset.wcToilet), touchedAsset(DEMO.asset.wcVanity), touchedAsset(DEMO.asset.wcMirror)],
  },
  {
    name: 'place_object',
    op: {
      op: 'place_object',
      id: NEW.sofa,
      asset: ARCHETYPE.sofa_3s,
      variant: VARIANT.sofa_3s_linen,
      room: R.living,
      position: { x: 2.0, y: 0, z: 8.4 },
    },
    summary: `Object ${NEW.sofa}: placed ${ARCHETYPE.sofa_3s}@${VARIANT.sofa_3s_linen} in ${R.living} at (2.00, 0.00, 8.40)`,
    touched: [touchedAsset(NEW.sofa)],
  },
  {
    name: 'move_object',
    op: { op: 'move_object', assetId: PLANT, position: { x: 1.0, y: 0, z: 8.6 } },
    summary: `Object ${PLANT}: moved to (1.00, 0.00, 8.60)`,
    touched: [touchedAsset(PLANT)],
  },
  {
    name: 'rotate_object',
    op: { op: 'rotate_object', assetId: PLANT, rotationY: Math.PI / 2 },
    summary: `Object ${PLANT}: rotated to 1.57 rad`,
    touched: [touchedAsset(PLANT)],
  },
  {
    name: 'set_object',
    op: { op: 'set_object', assetId: PLANT, scale: 0.8 },
    summary: `Object ${PLANT}: set scale 0.8`,
    touched: [touchedAsset(PLANT)],
  },
  {
    name: 'remove_object',
    op: { op: 'remove_object', assetId: PLANT },
    summary: `Object ${PLANT}: removed`,
    touched: [touchedAsset(PLANT)],
  },
  {
    name: 'set_opening onto another wall',
    op: { op: 'set_opening', openingId: DEMO.opening.windowStudy, wallId: DEMO.wall.facEastStudy, center: 1.5 },
    summary: `Opening ${DEMO.opening.windowStudy} moved to wall ${DEMO.wall.facEastStudy} and set to centre 1.5 m, width 1.2 m, sill 0.85 m, head 2.3 m`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'add_node',
    op: { op: 'add_node', id: NEW.node, p: { x: 12, z: 9 } },
    summary: `Node ${NEW.node}: added at (12, 9)`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'move_node',
    op: { op: 'move_node', nodeId: DEMO.node.southEast, dp: { x: 0.2, z: 0 } },
    summary: `Node ${DEMO.node.southEast}: moved to (13.4, 9.2)`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'remove_node',
    before: [{ op: 'add_node', id: NEW.spare, p: { x: 12, z: 9 } }],
    op: { op: 'remove_node', nodeId: NEW.spare },
    summary: `Node ${NEW.spare}: removed`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'add_wall',
    op: { op: 'add_wall', id: NEW.wall, a: DEMO.node.corridorBedroom, b: DEMO.node.studyBedroomS, thickness: 0.12 },
    summary: `Wall ${NEW.wall}: added between ${DEMO.node.corridorBedroom} and ${DEMO.node.studyBedroomS}, thickness 0.12 m`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'set_wall',
    op: { op: 'set_wall', wallId: DEMO.wall.wallBathWc, thickness: 0.15 },
    summary: `Wall ${DEMO.wall.wallBathWc}: thickness 0.15 m`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'remove_wall',
    op: { op: 'remove_wall', wallId: DEMO.wall.wallStudyHall },
    summary: `Wall ${DEMO.wall.wallStudyHall}: removed with opening ${DEMO.opening.doorStudy}`,
    touched: [TOUCHED_SHELL, touchedOpening(DEMO.opening.doorStudy)],
  },
  {
    name: 'split_wall',
    // The bedroom's corridor wall runs 4.00 m east from x 7.00; its door
    // (0.30..1.10) stays on the first half.
    op: { op: 'split_wall', wallId: DEMO.wall.wallBedroomHall, at: 2.5, nodeId: NEW.splitNode, ids: [NEW.splitWest, NEW.splitEast] },
    summary: `Wall ${DEMO.wall.wallBedroomHall}: split at 2.5 m into ${NEW.splitWest} (2.5 m) and ${NEW.splitEast} (1.5 m)`,
    touched: [TOUCHED_SHELL],
  },
  {
    name: 'merge_wall',
    // The split above, undone under the wall's own id: the halves are unpainted, so only the shell moves.
    before: [{ op: 'split_wall', wallId: DEMO.wall.wallBedroomHall, at: 2.5, nodeId: NEW.splitNode, ids: [NEW.splitWest, NEW.splitEast] }],
    op: { op: 'merge_wall', wallIds: [NEW.splitWest, NEW.splitEast], id: DEMO.wall.wallBedroomHall },
    summary: `Wall ${DEMO.wall.wallBedroomHall}: merged from ${NEW.splitWest} and ${NEW.splitEast} (4 m)`,
    touched: [TOUCHED_SHELL],
  },
];

/* ------------------------------------------- set_material, explicit form --- */

/** A fresh L-shape draft declared as 2.3 (or 2.2), so finish objects, ceilings and trims may be written. */
function draft23(version: '2.2' | '2.3' = '2.3'): Draft<SceneData> {
  const scene = draft();
  (scene as { schemaVersion: string }).schemaVersion = version;
  return scene;
}

/** Applies `op` against the library registries and answers with the outcome. */
function paint(scene: Draft<SceneData>, op: SceneOp) {
  return applyOp(scene, op, LIBRARY_REGISTRIES);
}

/** Applies `op` against the library registries expecting a refusal; answers with the message, and proves the draft unchanged. */
function refuses(scene: Draft<SceneData>, op: SceneOp): string {
  const before = JSON.stringify(scene);
  try {
    applyOp(scene, op, LIBRARY_REGISTRIES);
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    expect(JSON.stringify(scene)).toBe(before);
    return error.message;
  }
  throw new Error(`set_material ${JSON.stringify(op)} was expected to be refused`);
}

const ROOM_FACE = faceKey(ROOM_A, W.wPart, 'L');
const FACADE_FACE = faceKey(null, W.wSA, 'R');

describe('set_material, explicit form: addressing', () => {
  test('floor of one room, and of every room', () => {
    const scene = draft23();
    expect(paint(scene, { op: 'set_material', surface: 'floor', room: ROOM_A, material: LIB.floorScan }).touched).toEqual([
      touchedFloor(ROOM_A),
    ]);
    expect(scene.finishes?.rooms?.[ROOM_A]?.floor).toBe(LIB.floorScan);
    expect(scene.finishes?.rooms?.[ROOM_B]?.floor).toBeUndefined();
    expect(paint(scene, { op: 'set_material', surface: 'floor', material: LIB.floorAndWall }).touched).toEqual([
      touchedFloor(ROOM_A),
      touchedFloor(ROOM_B),
    ]);
    expect(scene.finishes?.rooms?.[ROOM_B]?.floor).toBe(LIB.floorAndWall);
  });

  test('ceiling and trim of one room, and of every room, each touched as itself', () => {
    const scene = draft23();
    expect(paint(scene, { op: 'set_material', surface: 'ceiling', room: ROOM_A, material: LIB.paint }).touched).toEqual([
      touchedCeiling(ROOM_A),
    ]);
    expect(paint(scene, { op: 'set_material', surface: 'trim', room: ROOM_B, material: FINISH.sand }).touched).toEqual([
      touchedTrim(ROOM_B),
    ]);
    expect(scene.finishes?.rooms?.[ROOM_A]).toEqual({ ceiling: LIB.paint });
    expect(scene.finishes?.rooms?.[ROOM_B]).toEqual({ trim: FINISH.sand });
    expect(paint(scene, { op: 'set_material', surface: 'ceiling', material: LIB.paint, colour: '#c9d6df' }).touched).toEqual([
      touchedCeiling(ROOM_A),
      touchedCeiling(ROOM_B),
    ]);
    expect(paint(scene, { op: 'set_material', surface: 'trim', material: LIB.paint }).touched).toEqual([
      touchedTrim(ROOM_A),
      touchedTrim(ROOM_B),
    ]);
  });

  test('walls of one room clear its face overrides, as the legacy room target does', () => {
    const scene = draft23();
    paint(scene, { op: 'set_material', surface: 'wall', face: ROOM_FACE, material: FINISH.terra });
    paint(scene, { op: 'set_material', surface: 'facade', face: FACADE_FACE, material: FINISH.terra });
    expect(paint(scene, { op: 'set_material', surface: 'wall', room: ROOM_A, material: LIB.paint }).touched).toEqual([
      touchedRoomWalls(ROOM_A),
    ]);
    expect(scene.finishes?.rooms?.[ROOM_A]?.walls).toBe(LIB.paint);
    expect(scene.finishes?.faces).toEqual([{ ...FACADE_FACE, finish: FINISH.terra }]);
  });

  test('walls of every room clear every room face override and keep the facade’s', () => {
    const scene = draft23();
    paint(scene, { op: 'set_material', surface: 'wall', face: ROOM_FACE, material: FINISH.terra });
    paint(scene, { op: 'set_material', surface: 'facade', face: FACADE_FACE, material: FINISH.terra });
    expect(paint(scene, { op: 'set_material', surface: 'wall', material: LIB.paint }).touched).toEqual([
      touchedRoomWalls(ROOM_A),
      touchedRoomWalls(ROOM_B),
    ]);
    expect(scene.finishes?.faces).toEqual([{ ...FACADE_FACE, finish: FINISH.terra }]);
  });

  test('one room face for wall, one facade face for facade', () => {
    const scene = draft23();
    expect(paint(scene, { op: 'set_material', surface: 'wall', face: ROOM_FACE, material: LIB.wallOnly, rotation: 90 }).touched).toEqual([
      touchedFace(ROOM_FACE),
    ]);
    expect(paint(scene, { op: 'set_material', surface: 'facade', face: FACADE_FACE, material: LIB.facadeOnly }).touched).toEqual([
      touchedFace(FACADE_FACE),
    ]);
    expect(scene.finishes?.faces).toEqual([
      { ...ROOM_FACE, finish: { material: LIB.wallOnly, rotation: 90 } },
      { ...FACADE_FACE, finish: LIB.facadeOnly },
    ]);
  });

  test('the facade itself, clearing the facade’s face overrides', () => {
    const scene = draft23();
    paint(scene, { op: 'set_material', surface: 'facade', face: FACADE_FACE, material: FINISH.terra });
    expect(paint(scene, { op: 'set_material', surface: 'facade', material: LIB.facadeOnly }).touched).toEqual([TOUCHED_FACADE]);
    expect(scene.finishes?.facade).toBe(LIB.facadeOnly);
    expect(scene.finishes?.faces).toEqual([]);
  });

  test('refused combinations leave the document unchanged', () => {
    const scene = draft23();
    for (const surface of ['floor', 'ceiling', 'trim'] as const) {
      expect(refuses(scene, { op: 'set_material', surface, face: ROOM_FACE, material: LIB.paint })).toContain('face is allowed only');
    }
    expect(refuses(scene, { op: 'set_material', surface: 'wall', room: ROOM_A, face: ROOM_FACE, material: LIB.paint })).toContain(
      'room or face',
    );
    expect(refuses(scene, { op: 'set_material', surface: 'facade', room: ROOM_A, material: LIB.paint })).toContain('room is not allowed');
    expect(refuses(scene, { op: 'set_material', surface: 'wall', face: FACADE_FACE, material: LIB.paint })).toContain('needs the room');
    expect(refuses(scene, { op: 'set_material', surface: 'facade', face: ROOM_FACE, material: LIB.paint })).toContain('owned by no room');
    expect(refuses(scene, { op: 'set_material', surface: 'floor', room: NEW.ghost, material: LIB.floorScan })).toContain(
      `Unknown set_material room ${NEW.ghost}`,
    );
    expect(refuses(scene, { op: 'set_material', surface: 'wall', face: faceKey(ROOM_A, NEW.ghost, 'L'), material: LIB.paint })).toContain(
      `unknown wall ${NEW.ghost}`,
    );
    expect(refuses(scene, { op: 'set_material', surface: 'roof' as never, material: LIB.paint })).toContain(
      'is not floor, wall, ceiling, trim or facade',
    );
  });
});

describe('set_material, explicit form: which material, and the value written', () => {
  test('the surface must be in the material’s apply, strictly: no facade allowance for a wall material', () => {
    const scene = draft23();
    expect(refuses(scene, { op: 'set_material', surface: 'ceiling', room: ROOM_A, material: LIB.wallOnly })).toContain(
      'does not dress the ceiling',
    );
    expect(refuses(scene, { op: 'set_material', surface: 'facade', material: LIB.wallOnly })).toContain('does not dress the facade');
    expect(refuses(scene, { op: 'set_material', surface: 'wall', material: LIB.floorScan })).toContain('does not dress the wall');
    expect(refuses(scene, { op: 'set_material', surface: 'floor', material: FINISH.sand })).toContain('does not dress the floor');
    expect(refuses(scene, { op: 'set_material', surface: 'floor', material: NEW.ghost })).toContain(`Unknown finish ${NEW.ghost}`);
  });

  test('a floor-and-wall material paints exactly the surface named', () => {
    const scene = draft23();
    paint(scene, { op: 'set_material', surface: 'wall', room: ROOM_A, material: LIB.floorAndWall });
    expect(scene.finishes?.rooms?.[ROOM_A]).toEqual({ walls: LIB.floorAndWall });
  });

  test('colour and rotation are refused with a bundled, a pbr or a generator finish', () => {
    const scene = draft23();
    expect(refuses(scene, { op: 'set_material', surface: 'wall', material: FINISH.sand, colour: '#c9d6df' })).toContain(
      'need a library material',
    );
    expect(refuses(scene, { op: 'set_material', surface: 'wall', material: LIB.pbrWall, rotation: 90 })).toContain(
      'need a library material',
    );
    expect(refuses(scene, { op: 'set_material', surface: 'floor', material: LIB.generatorFloor, rotation: 90 })).toContain(
      'need a library material',
    );
  });

  test('a malformed colour or rotation is refused, the document unchanged', () => {
    const scene = draft23();
    expect(refuses(scene, { op: 'set_material', surface: 'wall', material: LIB.paint, colour: '#abc' })).toContain('#rrggbb');
    expect(refuses(scene, { op: 'set_material', surface: 'wall', material: LIB.paint, rotation: Number.POSITIVE_INFINITY })).toContain(
      'finite',
    );
  });

  test('without modifiers the bare UUID is written, with them the finish object', () => {
    const scene = draft23();
    paint(scene, { op: 'set_material', surface: 'wall', room: ROOM_A, material: LIB.paint });
    expect(scene.finishes?.rooms?.[ROOM_A]?.walls).toBe(LIB.paint);
    paint(scene, { op: 'set_material', surface: 'wall', room: ROOM_A, material: LIB.paint, colour: '#c9d6df' });
    expect(scene.finishes?.rooms?.[ROOM_A]?.walls).toEqual({ material: LIB.paint, colour: '#c9d6df' });
    paint(scene, { op: 'set_material', surface: 'floor', room: ROOM_A, material: LIB.floorScan, rotation: 90 });
    expect(scene.finishes?.rooms?.[ROOM_A]?.floor).toEqual({ material: LIB.floorScan, rotation: 90 });
  });

  test('a finish object, a ceiling or a trim into a 2.2 document is refused, naming 2.3', () => {
    const scene = draft23('2.2');
    expect(refuses(scene, { op: 'set_material', surface: 'wall', room: ROOM_A, material: LIB.paint, colour: '#c9d6df' })).toContain('2.3');
    expect(refuses(scene, { op: 'set_material', surface: 'ceiling', room: ROOM_A, material: LIB.paint })).toContain('2.3');
    expect(refuses(scene, { op: 'set_material', surface: 'trim', material: FINISH.sand })).toContain('2.3');
    // A bare paint of a 2.2 surface is still fine there.
    paint(scene, { op: 'set_material', surface: 'wall', room: ROOM_A, material: LIB.paint });
    expect(scene.finishes?.rooms?.[ROOM_A]?.walls).toBe(LIB.paint);
  });

  test('an operation carrying both surface and target is refused', () => {
    const both = { op: 'set_material', surface: 'wall', target: 'walls', material: LIB.paint } as unknown as SceneOp;
    expect(refuses(draft23(), both)).toContain('either target or surface');
  });
});

describe('set_material, legacy form on the surface table', () => {
  test('a room target with a floor-and-wall material paints the floor, as a floor finish always has', () => {
    const scene = draft23();
    paint(scene, { op: 'set_material', target: ROOM_A, material: LIB.floorAndWall });
    expect(scene.finishes?.rooms?.[ROOM_A]).toEqual({ floor: LIB.floorAndWall });
  });

  test('the facade alias takes a project wall material (the 2.2 rule) and a facade-only one', () => {
    const scene = draft23();
    paint(scene, { op: 'set_material', target: 'facade', material: LIB.wallOnly });
    expect(scene.finishes?.facade).toBe(LIB.wallOnly);
    paint(scene, { op: 'set_material', target: 'facade', material: LIB.facadeOnly });
    expect(scene.finishes?.facade).toBe(LIB.facadeOnly);
  });

  test('the legacy room target refuses a material that dresses neither floors nor walls', () => {
    const scene = draft23();
    expect(refuses(scene, { op: 'set_material', target: ROOM_A, material: LIB.facadeOnly })).toContain('not a wall finish');
    expect(scene.finishes?.rooms?.[ROOM_A]?.walls).toBeUndefined();
  });

  test('a facade-only material may paint a facade face but not a room’s', () => {
    const scene = draft23();
    paint(scene, { op: 'set_material', target: FACADE_FACE, material: LIB.facadeOnly });
    expect(refuses(scene, { op: 'set_material', target: ROOM_FACE, material: LIB.facadeOnly })).toContain('not a wall finish');
  });
});

describe('op vocabulary snapshot on the demo apartment', () => {
  test('every operation of the union is covered', () => {
    const covered = new Set(VOCABULARY_SNAPSHOT.map((entry) => entry.op.op));
    expect([...covered].sort()).toEqual([
      'add_node',
      'add_opening',
      'add_room',
      'add_wall',
      'merge_wall',
      'move_node',
      'move_object',
      'place_object',
      'remove_node',
      'remove_object',
      'remove_opening',
      'remove_room',
      'remove_wall',
      'replace_asset_variant',
      'replace_opening_variant',
      'rotate_object',
      'set_autotour',
      'set_camera',
      'set_ceiling',
      'set_material',
      'set_navigation',
      'set_object',
      'set_opening',
      'set_room',
      'set_wall',
      'split_wall',
    ]);
  });

  for (const entry of VOCABULARY_SNAPSHOT) {
    test(`${entry.name} reports exactly what it reported before the split`, () => {
      const scene = draftOf(apartmentScene);
      for (const setup of entry.before ?? []) applyOp(scene, setup, CATALOGUE_REGISTRIES);

      const outcome = applyOp(scene, entry.op, CATALOGUE_REGISTRIES);

      expect(outcome.summary).toBe(entry.summary);
      expect(outcome.touched).toEqual(entry.touched);
    });
  }

  test('a replay of the same creating batch on the same document is byte-identical: nothing is minted', () => {
    // `merge_wall` rejoins the halves `split_wall` cut, so the batch keeps the snapshot's order.
    const creating = new Set(['add_room', 'add_node', 'add_wall', 'add_opening', 'place_object', 'split_wall', 'merge_wall']);
    const batch = VOCABULARY_SNAPSHOT.filter((entry) => creating.has(entry.op.op)).map((entry) => entry.op);
    expect(batch).toHaveLength(creating.size);
    const replay = (): string => {
      const scene = draftOf(apartmentScene);
      for (const op of batch) applyOp(scene, op, CATALOGUE_REGISTRIES);
      return JSON.stringify(scene);
    };
    expect(replay()).toBe(replay());
  });
});
