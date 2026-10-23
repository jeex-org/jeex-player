/**
 * Contract tests for `Picker`.
 *
 * Raycasting needs no WebGL, so the picks here are real: a camera looks down
 * `-z` at quads carrying the same `userData` the scene builder writes, and the
 * assertions pin what the application reads back — the face key of a wall, the
 * asset of a furniture mesh, the opening id of a door proxy — plus the two
 * rules that keep picks honest: hidden objects never swallow a pick, and a
 * selection aura is never registered at all.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Picker, visibleThroughHierarchy } from './picker.js';
import { SHADOW_ONLY_LAYER } from '../shared/render-layers.js';
import { GLOW_GROUP_NAME } from './selection-glow.js';
import { faceKey, type FaceKey } from '../scene/types.js';

const RECT = { left: 0, top: 0, width: 100, height: 100 };
const CENTRE = { x: 50, y: 50 };

function canvas() {
  return { getBoundingClientRect: () => RECT };
}

function camera(): THREE.PerspectiveCamera {
  const perspective = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  perspective.position.set(0, 0, 10);
  perspective.lookAt(0, 0, 0);
  perspective.updateMatrixWorld(true);
  return perspective;
}

/** A quad facing the camera at `z`, carrying the given `userData`. */
function quad(z: number, userData: Record<string, unknown>): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  Object.assign(mesh.userData, userData);
  return mesh;
}

/** A scene whose world matrices are up to date, as the raycaster requires. */
function scene(...objects: THREE.Object3D[]): THREE.Scene {
  const root = new THREE.Scene();
  root.add(...objects);
  root.updateMatrixWorld(true);
  return root;
}

/** The ids the quads carry: fixed UUID v7 literals, named for what they stand for. */
const ROOM = {
  kitchen: '01a12ffc-4897-7e72-b180-504f39abfbbe',
  living: '01a12ffc-4898-7883-88a0-fb20e2465a2b',
  bathroom: '01a12ffc-4899-7e1b-b892-2badd2ece8dd',
} as const;
const WALL = {
  w1: '01a12ffc-489a-7eed-9370-4c001acc9310',
  w2: '01a12ffc-489b-792b-ab3a-693f5ff9c8b5',
  curvedFacade: '01a12ffc-489c-757c-a3bd-b037afe8e14e',
  bearing: '01a12ffc-489d-7e55-8fd0-d3ad5eaa3d63',
} as const;
const DOOR = '01a12ffc-489e-7ace-b6a9-022b15e9c7f3';
const ASSET = { sofa: '01a12ffc-489f-7934-b9ae-6450e559d1c9', bedroomBed: '01a12ffc-48a0-7886-af50-8692f69f6fc6' } as const;

const KITCHEN_W1 = faceKey(ROOM.kitchen, WALL.w1, 'L');
const LIVING_W2 = faceKey(ROOM.living, WALL.w2, 'R');

/** A wall face quad tagged the way `shell-builder.ts` tags one. */
function wallQuad(z: number, face: FaceKey): THREE.Mesh {
  return quad(z, {
    surface: 'wall',
    face,
    wallId: face.wallId,
    roomId: face.room,
    resolveRoomId: () => face.room ?? null,
    resolveFace: () => face,
  });
}

describe('registration', () => {
  test('collects pickables, navigable floors and exterior-wall objects', () => {
    const wall = wallQuad(0, KITCHEN_W1);
    const floor = quad(-1, { surface: 'floor', roomId: ROOM.kitchen, navigable: true, wallId: undefined });
    const skirting = quad(-2, { wallId: WALL.w1 });
    const root = scene(wall, floor, skirting);
    const picker = new Picker(canvas());
    picker.register(root, (wallId) => wallId === WALL.w1);

    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())?.face).toEqual(KITCHEN_W1);
    expect(picker.floorPoint(CENTRE.x, CENTRE.y, camera())).not.toBeNull();
    // The wall face and the skirting share the wall id; the floor does not.
    expect(picker.exteriors()).toHaveLength(2);
  });

  test('never registers anything inside a selection aura', () => {
    const group = new THREE.Group();
    const body = quad(0, { surface: 'furniture' });
    const aura = new THREE.Group();
    aura.name = GLOW_GROUP_NAME;
    aura.add(quad(1, { surface: 'furniture', wallId: WALL.w1 }));
    group.add(body, aura);
    scene(group);
    const picker = new Picker(canvas());
    const tagged = picker.registerFurniture(group, ASSET.sofa);

    expect(tagged).toEqual([body]);
    expect(picker.exteriors()).toHaveLength(0);
    // The aura sits closer to the camera and would win the ray if registered.
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())?.assetId).toBe(ASSET.sofa);
  });

  test('registerFurniture tags every mesh with the surface and asset id', () => {
    const group = new THREE.Group();
    const body = quad(0, {});
    group.add(body);
    scene(group);
    const picker = new Picker(canvas());
    picker.registerFurniture(group, ASSET.bedroomBed);
    expect(body.userData['surface']).toBe('furniture');
    expect(body.userData['assetId']).toBe(ASSET.bedroomBed);
  });

  test('registerOpening skips the group itself but keeps it in the exterior list', () => {
    const group = new THREE.Group();
    group.userData['surface'] = 'opening';
    group.userData['wallId'] = WALL.w1;
    const leaf = quad(0, { surface: 'opening', openingId: DOOR, wallId: WALL.w1 });
    group.add(leaf);
    scene(group);
    const picker = new Picker(canvas());
    picker.registerOpening(group, (wallId) => wallId === WALL.w1);

    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())).toEqual({ surface: 'opening', openingId: DOOR, wallId: WALL.w1 });
    expect(picker.exteriors()).toEqual([group, leaf]);
  });

  test('unregister drops an object from every registry', () => {
    const floor = quad(0, { surface: 'floor', roomId: ROOM.kitchen, navigable: true, wallId: WALL.w1 });
    const root = scene(floor);
    const picker = new Picker(canvas());
    picker.register(root, () => true);
    picker.unregister(floor);
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())).toBeNull();
    expect(picker.floorPoint(CENTRE.x, CENTRE.y, camera())).toBeNull();
    expect(picker.exteriors()).toHaveLength(0);
  });
});

describe('pickSurface', () => {
  test('reads the face key and room id of a wall through the resolvers', () => {
    const wall = wallQuad(0, faceKey(null, WALL.curvedFacade, 'R'));
    const root = scene(wall);
    const picker = new Picker(canvas());
    picker.register(root);
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())).toEqual({
      surface: 'wall',
      roomId: undefined,
      face: faceKey(null, WALL.curvedFacade, 'R'),
      wallId: WALL.curvedFacade,
    });
  });

  test('the nearest visible surface wins', () => {
    const near = wallQuad(2, KITCHEN_W1);
    const far = wallQuad(0, LIVING_W2);
    const root = scene(near, far);
    const picker = new Picker(canvas());
    picker.register(root);
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())?.face).toEqual(KITCHEN_W1);
  });

  test('a hidden object does not swallow the pick', () => {
    const near = wallQuad(2, KITCHEN_W1);
    near.visible = false;
    const far = wallQuad(0, LIVING_W2);
    const root = scene(near, far);
    const picker = new Picker(canvas());
    picker.register(root);
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())?.face).toEqual(LIVING_W2);
  });

  test('a wall the dollhouse cut away (off layer 0, on the shadow-only layer) lets the pick through', () => {
    const near = wallQuad(2, KITCHEN_W1);
    near.layers.enable(SHADOW_ONLY_LAYER);
    near.layers.disable(0);
    const far = wallQuad(0, LIVING_W2);
    const root = scene(near, far);
    const picker = new Picker(canvas());
    picker.register(root);
    expect(near.visible).toBe(true);
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())?.face).toEqual(LIVING_W2);
  });

  test('a surface hidden by an ancestor is skipped too', () => {
    const hiddenBranch = new THREE.Group();
    hiddenBranch.visible = false;
    const near = wallQuad(2, KITCHEN_W1);
    hiddenBranch.add(near);
    const far = wallQuad(0, LIVING_W2);
    const root = scene(hiddenBranch, far);
    const picker = new Picker(canvas());
    picker.register(root);
    expect(visibleThroughHierarchy(near)).toBe(false);
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())?.face).toEqual(LIVING_W2);
  });

  test('a miss outside every surface returns null', () => {
    const root = scene(wallQuad(0, KITCHEN_W1));
    const picker = new Picker(canvas());
    picker.register(root);
    expect(picker.pickSurface(1, 1, camera())).toBeNull();
  });

  test('an explicit roomId on the mesh wins over the resolver', () => {
    const floor = quad(0, { surface: 'floor', roomId: ROOM.bathroom, navigable: true, resolveRoomId: () => ROOM.kitchen });
    const root = scene(floor);
    const picker = new Picker(canvas());
    picker.register(root);
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())?.roomId).toBe(ROOM.bathroom);
  });

  test('a resolver that answers anything but a face key leaves the face out', () => {
    const wall = quad(0, { surface: 'wall', wallId: WALL.w1, resolveFace: () => `${ROOM.kitchen}:${WALL.w1}:L` });
    const picker = new Picker(canvas());
    picker.register(scene(wall));
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())).toEqual({
      surface: 'wall',
      roomId: undefined,
      face: undefined,
      wallId: WALL.w1,
    });
  });

  test('a wall pick carries the wall id straight off userData', () => {
    const wall = wallQuad(0, faceKey(ROOM.kitchen, WALL.bearing, 'L'));
    const picker = new Picker(canvas());
    picker.register(scene(wall));
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())?.wallId).toBe(WALL.bearing);
  });

  test('an opening pick carries the wall it hangs on', () => {
    const group = new THREE.Group();
    group.userData['surface'] = 'opening';
    group.userData['wallId'] = WALL.w1;
    const leaf = quad(0, { surface: 'opening', openingId: DOOR, wallId: WALL.w1 });
    group.add(leaf);
    scene(group);
    const picker = new Picker(canvas());
    picker.registerOpening(group, () => false);
    expect(picker.pickSurface(CENTRE.x, CENTRE.y, camera())).toEqual({
      surface: 'opening',
      openingId: DOOR,
      wallId: WALL.w1,
    });
  });
});

describe('floorPoint', () => {
  test('returns the world hit on a navigable floor', () => {
    const floor = quad(0, { surface: 'floor', navigable: true });
    const root = scene(floor);
    const picker = new Picker(canvas());
    picker.register(root);
    const point = picker.floorPoint(CENTRE.x, CENTRE.y, camera());
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(0, 5);
    expect(point!.z).toBeCloseTo(0, 5);
  });

  test('a non-navigable surface is not a floor point', () => {
    const root = scene(quad(0, { surface: 'floor' }));
    const picker = new Picker(canvas());
    picker.register(root);
    expect(picker.floorPoint(CENTRE.x, CENTRE.y, camera())).toBeNull();
  });
});

describe('pickSelection', () => {
  test('answers the same pick as pickSurface plus the world hit point', () => {
    const wall = wallQuad(0, KITCHEN_W1);
    const picker = new Picker(canvas());
    picker.register(scene(wall));
    const selection = picker.pickSelection(CENTRE.x, CENTRE.y, camera());
    expect(selection).not.toBeNull();
    expect(selection!.pick).toEqual(picker.pickSurface(CENTRE.x, CENTRE.y, camera())!);
    expect(selection!.point.x).toBeCloseTo(0, 5);
    expect(selection!.point.z).toBeCloseTo(0, 5);
  });

  test('a miss outside every surface answers null', () => {
    const picker = new Picker(canvas());
    picker.register(scene(wallQuad(0, KITCHEN_W1)));
    expect(picker.pickSelection(1, 1, camera())).toBeNull();
  });

  test('a furniture pick answers the asset id and the point on its body', () => {
    const group = new THREE.Group();
    const body = quad(0, {});
    group.add(body);
    scene(group);
    const picker = new Picker(canvas());
    picker.registerFurniture(group, ASSET.sofa);
    const selection = picker.pickSelection(CENTRE.x, CENTRE.y, camera());
    expect(selection?.pick.assetId).toBe(ASSET.sofa);
    expect(selection?.point).toBeInstanceOf(THREE.Vector3);
  });
});
