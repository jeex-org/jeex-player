/**
 * The paint state of the shell and the API over it.
 *
 * Painting is a PROJECTION of the document, so most of this is tested end to
 * end through `SceneBuilder` and a committed `SceneModel`: commit an
 * operation, read the public getters back. What `ShellPaint` adds on its own —
 * that it hands its materials over instead of freeing them, and that it
 * answers from the bound document rather than from a copy — is asserted
 * directly.
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { describe, expect, spyOn, test } from 'bun:test';
import { draftOf } from '../shared/committed.js';
import * as THREE from 'three';
import { SceneBuilder } from './scene-builder.js';
import { ShellPaint } from './shell-paint.js';
import { createBuilderContext } from './builder-context.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import { SceneModel, isApplyOk } from '../scene/scene-model.js';
import type { SceneOp } from '../scene/scene-ops.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { faceKey, sameFace, type FaceKey, type SceneData } from '../scene/types.js';

type Built = { scene: SceneData; plan: SolvedPlan; builder: SceneBuilder; root: THREE.Group };

function build(scene: SceneData): Built {
  const plan = solvePlan(scene);
  const builder = new SceneBuilder(scene, plan);
  const { root } = builder.build();
  return { scene, plan, builder, root };
}

type Bound = Built & { model: SceneModel; paint: (...ops: SceneOp[]) => void };

/**
 * A builder wired to a model, the way the composition root wires it.
 *
 * Painting is a PROJECTION of the document, so the only honest way to test it
 * is end to end: commit an operation and read the public getters back.
 */
function bound(scene: SceneData = lShapePlan): Bound {
  const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
  const builder = new SceneBuilder(model.scene, model.plan);
  const { root } = builder.build();
  builder.bindModel(model);
  const paint = (...ops: SceneOp[]): void => {
    const result = model.apply({ baseRev: model.rev, ops });
    if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
  };
  return { scene: model.scene, plan: model.plan, builder, root, model, paint };
}

const ROOM = L_SHAPE.room;
const WALL = L_SHAPE.wall;
/** A room face of the fixture. */
const face = (room: string, wallId: string, side: 'L' | 'R'): FaceKey => faceKey(room, wallId, side);
const A_PART = face(ROOM.a, WALL.wPart, 'L');
const A_WEST = face(ROOM.a, WALL.wW, 'L');
const FACADE_WEST = faceKey(null, WALL.wW, 'R');
/** Neither a room of the fixture nor a finish of the catalogue: fixed literals nothing uses. */
const UNKNOWN_ROOM = '01a12ffd-3869-7bb1-a37a-bb4e880143fd';
const UNKNOWN_FINISH = '01a12ffd-386a-7651-9d07-4b0703e8aac3';

function objectNamed(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? null;
}

/** The built mesh of one face, found by the `userData.face` the picker reads. */
function faceMeshOf(root: THREE.Object3D, key: FaceKey): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((object) => {
    const data = object.userData;
    if (object instanceof THREE.Mesh && data['surface'] === 'wall' && sameFace(data['face'] as FaceKey, key)) found = object;
  });
  if (!found) throw new Error('no mesh for that face');
  return found;
}

describe('painting API (end to end through the model)', () => {
  test('a room paint covers partition and shell faces and leaves the other room', () => {
    const { builder, paint } = bound();
    paint({ op: 'set_material', target: ROOM.a, material: FINISH.sage });
    expect(builder.getRoomWall(ROOM.a)).toBe(FINISH.sage);
    const roomA = builder.facesOfRoom(ROOM.a);
    // Both the 0.10 partition and the 0.30 shell belong to room a's loop.
    expect(roomA).toContainEqual(A_PART);
    expect(roomA).toContainEqual(face(ROOM.a, WALL.wSA, 'L'));
    for (const key of roomA) expect(builder.getFaceWall(key)).toBe(FINISH.sage);
    for (const key of builder.facesOfRoom(ROOM.b)) expect(builder.getFaceWall(key)).toBe(FINISH.sand);
    expect(builder.getRoomWall(ROOM.b)).toBe(FINISH.sand);
    expect(builder.getFacadeWall()).toBe(FINISH.sand);
  });

  test('a face-scoped paint changes exactly one face and keeps the room finish', () => {
    const { builder, plan, paint } = bound();
    paint({ op: 'set_material', target: ROOM.a, material: FINISH.sage });
    paint({ op: 'set_material', target: A_PART, material: FINISH.terra, scope: 'face' });
    expect(builder.getFaceWall(A_PART)).toBe(FINISH.terra);
    expect(builder.getRoomWall(ROOM.a)).toBe(FINISH.sage);
    const changed = [...plan.faces.keys()].filter((key) => builder.getFaceWall(key) === FINISH.terra);
    expect(changed).toEqual([A_PART]);
  });

  test('a room paint clears the per-face overrides of that room', () => {
    const { builder, paint } = bound();
    paint({ op: 'set_material', target: A_PART, material: FINISH.terra, scope: 'face' });
    paint({ op: 'set_material', target: ROOM.a, material: FINISH.sage });
    expect(builder.getFaceWall(A_PART)).toBe(FINISH.sage);
  });

  test('getFaceWall falls back override -> room -> facade', () => {
    const { builder, paint } = bound();
    expect(builder.getFaceWall(FACADE_WEST)).toBe(FINISH.sand);
    expect(builder.getFaceWall(A_WEST)).toBe(FINISH.sand);
    paint({ op: 'set_material', target: ROOM.a, material: FINISH.sage });
    expect(builder.getFaceWall(A_WEST)).toBe(FINISH.sage);
    paint({ op: 'set_material', target: A_WEST, material: FINISH.terra, scope: 'face' });
    expect(builder.getFaceWall(A_WEST)).toBe(FINISH.terra);
    paint({ op: 'set_material', target: 'facade', material: FINISH.graphite });
    expect(builder.getFaceWall(FACADE_WEST)).toBe(FINISH.graphite);
  });

  test('a facade paint repaints every facade face and no room face', () => {
    const { builder, plan, paint } = bound();
    paint({ op: 'set_material', target: 'facade', material: FINISH.graphite });
    expect(builder.getFacadeWall()).toBe(FINISH.graphite);
    for (const facadeFace of plan.facade) expect(builder.getFaceWall(facadeFace.key)).toBe(FINISH.graphite);
    for (const roomId of [ROOM.a, ROOM.b]) {
      for (const key of builder.facesOfRoom(roomId)) expect(builder.getFaceWall(key)).toBe(FINISH.sand);
    }
  });

  test('the walls alias repaints every room and leaves the facade alone', () => {
    const { builder, paint } = bound();
    paint({ op: 'set_material', target: 'facade', material: FINISH.graphite });
    paint({ op: 'set_material', target: 'walls', material: FINISH.white });
    expect(builder.getRoomWall(ROOM.a)).toBe(FINISH.white);
    expect(builder.getRoomWall(ROOM.b)).toBe(FINISH.white);
    expect(builder.getFacadeWall()).toBe(FINISH.graphite);
  });

  test('floor finishes are per room, with the floors alias covering every room', () => {
    const { builder, paint } = bound();
    expect(builder.getFloorFinish(ROOM.a)).toBe(FINISH.oak);
    expect(builder.getFloorFinish(ROOM.b)).toBe(FINISH.stone);
    paint({ op: 'set_material', target: ROOM.a, material: FINISH.chevron });
    expect(builder.getFloorFinish(ROOM.a)).toBe(FINISH.chevron);
    expect(builder.getFloorFinish(ROOM.b)).toBe(FINISH.stone);
    paint({ op: 'set_material', target: 'floors', material: FINISH.walnut });
    expect(builder.getFloorFinish(ROOM.a)).toBe(FINISH.walnut);
    expect(builder.getFloorFinish(ROOM.b)).toBe(FINISH.walnut);
  });

  test('the paint getters project the model, so an unbound builder shows the document', () => {
    const scene = draftOf(lShapePlan);
    scene.finishes = { rooms: { [ROOM.a]: { walls: FINISH.graphite } } };
    const { builder } = build(scene);
    // The setter moves the material; the getter still answers from the document.
    expect(builder.setRoomWall(ROOM.a, FINISH.sage)).toBe(true);
    expect(builder.getRoomWall(ROOM.a)).toBe(FINISH.graphite);
  });

  test('unknown room, face and finish ids are rejected without side effects', () => {
    const { builder } = build(lShapePlan);
    expect(builder.setRoomWall(UNKNOWN_ROOM, FINISH.sage)).toBe(false);
    expect(builder.setRoomWall(ROOM.a, UNKNOWN_FINISH)).toBe(false);
    expect(builder.setFaceWall(face(UNKNOWN_ROOM, WALL.wW, 'L'), FINISH.sage)).toBe(false);
    expect(builder.setFaceWall(A_WEST, UNKNOWN_FINISH)).toBe(false);
    expect(builder.setFacadeWall(UNKNOWN_FINISH)).toBe(false);
    expect(builder.setRoomFloor(UNKNOWN_ROOM, FINISH.oak)).toBe(false);
    expect(builder.setRoomFloor(ROOM.a, UNKNOWN_FINISH)).toBe(false);
    expect(builder.getRoomWall(UNKNOWN_ROOM)).toBeNull();
    expect(builder.getFaceWall(face(UNKNOWN_ROOM, WALL.wW, 'L'))).toBeNull();
    expect(builder.getFloorFinish(UNKNOWN_ROOM)).toBeNull();
    expect(builder.facesOfRoom(UNKNOWN_ROOM)).toEqual([]);
    expect(builder.getRoomWall(ROOM.a)).toBe(FINISH.sand);
    expect(builder.getFloorFinish(ROOM.a)).toBe(FINISH.oak);
  });
});

describe('material lifecycle', () => {
  test('repainting a floor swaps the material and disposes the replaced one', () => {
    const { builder, root } = build(lShapePlan);
    const floor = objectNamed(root, `floor-${ROOM.a}`) as THREE.Mesh;
    const before = floor.material as THREE.MeshStandardMaterial;
    const disposed = spyOn(before, 'dispose');
    builder.setRoomFloor(ROOM.a, FINISH.chevron);
    expect(floor.material).not.toBe(before);
    expect(disposed).toHaveBeenCalled();
  });

  test('clearing a face override disposes the override and puts the room material back on the face', () => {
    const { builder, root } = build(lShapePlan);
    const mesh = faceMeshOf(root, A_WEST);
    const roomMaterial = mesh.material as THREE.MeshStandardMaterial;
    builder.setFaceWall(A_WEST, FINISH.terra);
    const override = mesh.material as THREE.MeshStandardMaterial;
    expect(override).not.toBe(roomMaterial);
    const disposed = spyOn(override, 'dispose');
    builder.setRoomWall(ROOM.a, FINISH.sage);
    expect(disposed).toHaveBeenCalled();
    const other = builder.facesOfRoom(ROOM.a).find((key) => key !== A_WEST)!;
    expect(mesh.material).toBe(faceMeshOf(root, other).material);
  });

  test('a room repaint puts one material on every face of that room, leaves the other room alone and releases the old one', () => {
    const { builder, root } = build(lShapePlan);
    const faces = builder.facesOfRoom(ROOM.a).map((key) => faceMeshOf(root, key));
    const others = builder.facesOfRoom(ROOM.b).map((key) => faceMeshOf(root, key).material);
    const before = faces[0]!.material as THREE.Material;
    const disposed = spyOn(before, 'dispose');
    builder.setRoomWall(ROOM.a, FINISH.sage);
    const after = new Set(faces.map((mesh) => mesh.material));
    expect(after.size).toBe(1);
    expect(after.has(before)).toBe(false);
    expect(disposed).toHaveBeenCalled();
    expect(builder.facesOfRoom(ROOM.b).map((key) => faceMeshOf(root, key).material)).toEqual(others);
  });
});

describe('ShellPaint on its own', () => {
  /** A paint with nothing registered: no floors, no faces, only the materials. */
  function loose(scene: SceneData = lShapePlan): ShellPaint {
    return new ShellPaint(createBuilderContext(scene, solvePlan(scene)));
  }

  test('a surface the builder never handed over cannot be painted, and says so', () => {
    const paint = loose();
    expect(paint.setFaceWall(A_WEST, FINISH.sage)).toBe(false);
    expect(paint.setRoomFloor(ROOM.a, FINISH.chevron)).toBe(false);
    // The room material exists from the start, so a room wall paint still lands.
    expect(paint.setRoomWall(ROOM.a, FINISH.sage)).toBe(true);
    expect(paint.faceMesh(A_WEST)).toBeNull();
  });

  test('a registered face takes the override material and gives it back on reset', () => {
    const plan = solvePlan(lShapePlan);
    const paint = new ShellPaint(createBuilderContext(lShapePlan, plan));
    const wallFace = plan.faces.get(A_WEST)!;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint.materialForFace(wallFace));
    const roomMaterial = mesh.material;
    paint.registerFace(wallFace.key, mesh);
    expect(paint.faceMesh(wallFace.key)).toBe(mesh);

    expect(paint.setFaceWall(wallFace.key, FINISH.terra)).toBe(true);
    expect(mesh.material).not.toBe(roomMaterial);
    expect(paint.resetFaceWall(wallFace.key)).toBe(true);
    expect(mesh.material).toBe(roomMaterial);
  });

  test('collectMaterials hands over every material it made, and frees none of them', () => {
    const paint = loose();
    const materials = new Set<THREE.Material>();
    paint.collectMaterials(materials);
    // The facade material plus one per room of the fixture.
    expect(materials.size).toBe(1 + lShapePlan.rooms.length);
    const spies = [...materials].map((material) => spyOn(material, 'dispose'));
    paint.clear();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  test('the projection follows the bound source, not the document it was built with', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const paint = new ShellPaint(createBuilderContext(model.scene, model.plan));
    expect(paint.getRoomWall(ROOM.a)).toBe(FINISH.sand);
    paint.bindScene(() => model.scene);
    const result = model.apply({ baseRev: model.rev, ops: [{ op: 'set_material', target: ROOM.a, material: FINISH.sage }] });
    expect(isApplyOk(result)).toBe(true);
    expect(paint.getRoomWall(ROOM.a)).toBe(FINISH.sage);
  });
});
