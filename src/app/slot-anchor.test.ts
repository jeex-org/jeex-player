/**
 * The anchor's arithmetic, with `three` but no document.
 *
 * Everything here is the part a browser cannot make truer: which world point a
 * target resolves to, what `projectToViewport` says about it, and how often the
 * scene graph is walked. The DOM half — the two custom properties and
 * `data-visible` — belongs to `HostSlots` and is proved in
 * `tests/component/host-slots.test.ts`.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SlotAnchor, viewerSlots, type AnchorScene } from './slot-anchor.js';
import type { AnchorPoint } from './viewer-handle.js';
import { projectToViewport } from '../render/viewport-projection.js';

const VIEWPORT = { width: 900, height: 600 };

/** Placement ids this file invents for its furniture meshes. */
const ASSET = {
  sofa: '01a12ffa-e534-7ea9-abce-98830274d105',
  table: '01a12ffa-e535-72da-9f91-f31a2dc6e798',
  lamp: '01a12ffa-e536-7850-a38f-4f2910fbc1f9',
} as const;

/** A camera at the origin looking down `-z`, the pose every case below reasons about. */
function camera(): THREE.PerspectiveCamera {
  const perspective = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 100);
  perspective.position.set(0, 0, 0);
  perspective.lookAt(0, 0, -1);
  perspective.updateMatrixWorld(true);
  return perspective;
}

/** A mesh carrying the `userData` the picker and the highlight both read. */
function furnitureMesh(assetId: string, at: { x: number; y: number; z: number }): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(at.x, at.y, at.z);
  mesh.userData['surface'] = 'furniture';
  mesh.userData['assetId'] = assetId;
  return mesh;
}

function sceneWith(...objects: readonly THREE.Object3D[]): AnchorScene {
  const root = new THREE.Group();
  for (const object of objects) root.add(object);
  root.updateMatrixWorld(true);
  return { camera: camera(), root, viewport: VIEWPORT };
}

let published: (AnchorPoint | null)[];
let anchor: SlotAnchor;

beforeEach(() => {
  published = [];
  anchor = new SlotAnchor((point) => published.push(point));
});

describe('no target', () => {
  test('`point()` is null and the sink is parked exactly once, however many frames run', () => {
    const scene = sceneWith();
    anchor.update(scene);
    anchor.update(scene);
    anchor.update(scene);
    expect(anchor.point()).toBeNull();
    expect(published).toEqual([null]);
  });

  test('a frame with no stage yet is not a crash and publishes nothing beyond the park', () => {
    anchor.update(null);
    expect(anchor.point()).toBeNull();
    expect(published).toEqual([null]);
  });
});

describe('a point target', () => {
  test('is projected exactly as `projectToViewport` would, and the sink gets those numbers', () => {
    const scene = sceneWith();
    anchor.target({ x: 0.5, y: 0.25, z: -4 });
    anchor.update(scene);
    const expected = projectToViewport(scene.camera, new THREE.Vector3(0.5, 0.25, -4), VIEWPORT);
    expect(expected).not.toBeNull();
    const point = anchor.point();
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(expected!.x, 6);
    expect(point!.y).toBeCloseTo(expected!.y, 6);
    expect(point!.visible).toBe(true);
    expect(published.at(-1)).toEqual(point);
  });

  test('behind the camera it keeps its last numbers and goes invisible', () => {
    const scene = sceneWith();
    anchor.target({ x: 0, y: 0, z: -4 });
    anchor.update(scene);
    const onScreen = anchor.point()!;
    anchor.target({ x: 0, y: 0, z: 4 }); // behind a camera looking down -z
    anchor.update(scene);
    const parked = anchor.point()!;
    expect(parked.visible).toBe(false);
    expect(parked.x).toBeCloseTo(onScreen.x, 6);
    expect(parked.y).toBeCloseTo(onScreen.y, 6);
    expect(published.at(-1)!.visible).toBe(false);
  });

  test('in front of the camera but outside the viewport rectangle it is invisible', () => {
    const scene = sceneWith();
    // Far off to the side: still in front, nowhere near the 900x600 box.
    anchor.target({ x: 40, y: 0, z: -4 });
    anchor.update(scene);
    expect(anchor.point()!.visible).toBe(false);
  });

  test('`target(null)` parks it again', () => {
    const scene = sceneWith();
    anchor.target({ x: 0, y: 0, z: -4 });
    anchor.update(scene);
    expect(anchor.point()).not.toBeNull();
    anchor.target(null);
    expect(anchor.point()).toBeNull();
    expect(published.at(-1)).toBeNull();
  });
});

describe('an entity target', () => {
  test('resolves to the centre of the meshes that carry its id', () => {
    const scene = sceneWith(furnitureMesh(ASSET.sofa, { x: 2, y: 0, z: -6 }));
    anchor.target({ kind: 'furniture', id: ASSET.sofa });
    anchor.update(scene);
    const expected = projectToViewport(scene.camera, new THREE.Vector3(2, 0, -6), VIEWPORT)!;
    const point = anchor.point()!;
    expect(point.x).toBeCloseTo(expected.x, 6);
    expect(point.y).toBeCloseTo(expected.y, 6);
    expect(point.visible).toBe(true);
  });

  test('two meshes of one entity give the centre of the union of their boxes', () => {
    const scene = sceneWith(furnitureMesh(ASSET.table, { x: -1, y: 0, z: -6 }), furnitureMesh(ASSET.table, { x: 3, y: 0, z: -6 }));
    anchor.target({ kind: 'furniture', id: ASSET.table });
    anchor.update(scene);
    const expected = projectToViewport(scene.camera, new THREE.Vector3(1, 0, -6), VIEWPORT)!;
    expect(anchor.point()!.x).toBeCloseTo(expected.x, 6);
  });

  test('a mesh of ANOTHER entity is not part of the box', () => {
    const scene = sceneWith(furnitureMesh(ASSET.sofa, { x: 2, y: 0, z: -6 }), furnitureMesh(ASSET.lamp, { x: -8, y: 0, z: -6 }));
    anchor.target({ kind: 'furniture', id: ASSET.sofa });
    anchor.update(scene);
    const expected = projectToViewport(scene.camera, new THREE.Vector3(2, 0, -6), VIEWPORT)!;
    expect(anchor.point()!.x).toBeCloseTo(expected.x, 6);
  });

  test('a target the document does not carry is invisible, not an exception', () => {
    const scene = sceneWith(furnitureMesh(ASSET.sofa, { x: 2, y: 0, z: -6 }));
    anchor.target({ kind: 'furniture', id: 'nowhere' });
    expect(() => anchor.update(scene)).not.toThrow();
    expect(anchor.point()!.visible).toBe(false);
  });

  test('a frame with no document root yet is invisible, not an exception', () => {
    anchor.target({ kind: 'furniture', id: ASSET.sofa });
    expect(() => anchor.update({ camera: camera(), root: undefined, viewport: VIEWPORT })).not.toThrow();
    expect(anchor.point()!.visible).toBe(false);
  });
});

/**
 * The walk is the expensive part and the scene does not move without a
 * commit — and a commit hands out a NEW root (`geometry/scene-builder.ts`
 * builds a fresh `THREE.Group` per document). So the walk is cached by root
 * identity, and walking the graph sixty times a second is forbidden.
 */
describe('the cache', () => {
  /** Counts `traverse` calls on a root without changing what it does. */
  function counting(root: THREE.Object3D): { root: THREE.Object3D; walks: () => number } {
    let walks = 0;
    const original = root.traverse.bind(root);
    root.traverse = (callback: (object: THREE.Object3D) => void) => {
      walks += 1;
      original(callback);
    };
    return { root, walks: () => walks };
  }

  test('sixty frames on one root walk the graph once', () => {
    const scene = sceneWith(furnitureMesh(ASSET.sofa, { x: 0, y: 0, z: -6 }));
    const counted = counting(scene.root!);
    anchor.target({ kind: 'furniture', id: ASSET.sofa });
    for (let frame = 0; frame < 60; frame += 1) anchor.update(scene);
    expect(counted.walks()).toBe(1);
  });

  test('a new root — which is what a commit hands out — walks again', () => {
    const first = sceneWith(furnitureMesh(ASSET.sofa, { x: 0, y: 0, z: -6 }));
    const firstCount = counting(first.root!);
    anchor.target({ kind: 'furniture', id: ASSET.sofa });
    anchor.update(first);
    anchor.update(first);
    expect(firstCount.walks()).toBe(1);

    const second = sceneWith(furnitureMesh(ASSET.sofa, { x: 4, y: 0, z: -6 }));
    const secondCount = counting(second.root!);
    anchor.update({ ...second, camera: first.camera });
    expect(secondCount.walks()).toBe(1);
    const expected = projectToViewport(first.camera, new THREE.Vector3(4, 0, -6), VIEWPORT)!;
    expect(anchor.point()!.x).toBeCloseTo(expected.x, 6);
  });

  test('a new target walks again on the same root', () => {
    const scene = sceneWith(furnitureMesh(ASSET.sofa, { x: 0, y: 0, z: -6 }), furnitureMesh(ASSET.lamp, { x: 3, y: 0, z: -6 }));
    const counted = counting(scene.root!);
    anchor.target({ kind: 'furniture', id: ASSET.sofa });
    anchor.update(scene);
    anchor.target({ kind: 'furniture', id: ASSET.lamp });
    anchor.update(scene);
    expect(counted.walks()).toBe(2);
    const expected = projectToViewport(scene.camera, new THREE.Vector3(3, 0, -6), VIEWPORT)!;
    expect(anchor.point()!.x).toBeCloseTo(expected.x, 6);
  });

  test('a point target never walks at all', () => {
    const scene = sceneWith(furnitureMesh(ASSET.sofa, { x: 0, y: 0, z: -6 }));
    const counted = counting(scene.root!);
    anchor.target({ x: 0, y: 0, z: -4 });
    for (let frame = 0; frame < 10; frame += 1) anchor.update(scene);
    expect(counted.walks()).toBe(0);
  });
});

/**
 * Regression cases for the selection anchor, each one a claim no earlier case
 * makes.
 */
describe('selection anchor regressions', () => {
  test('the camera pose is the CURRENT one: hooks run before `render()` refreshes it', () => {
    const scene = sceneWith();
    anchor.target({ x: 0, y: 0, z: -4 });
    anchor.update(scene);
    const before = anchor.point()!;
    // Move the camera the way a frame hook upstream does — WITHOUT touching
    // `matrixWorld`, which is what `renderer.render()` would have done later.
    scene.camera.position.set(3, 0, 0);
    anchor.update(scene);
    expect(anchor.point()!.x).not.toBeCloseTo(before.x, 3);
  });

  test('an entity that MOVES under the same root is followed without a new walk', () => {
    const sofa = furnitureMesh(ASSET.sofa, { x: 0, y: 0, z: -6 });
    const scene = sceneWith(sofa);
    let walks = 0;
    const original = scene.root!.traverse.bind(scene.root!);
    scene.root!.traverse = (callback: (object: THREE.Object3D) => void) => {
      walks += 1;
      original(callback);
    };
    anchor.target({ kind: 'furniture', id: ASSET.sofa });
    anchor.update(scene);
    const before = anchor.point()!;
    // A commit that only moves one thing does NOT hand out a new root.
    sofa.position.set(4, 0, -6);
    sofa.updateMatrixWorld(true);
    anchor.update(scene);
    expect(anchor.point()!.x).not.toBeCloseTo(before.x, 3);
    const expected = projectToViewport(scene.camera, new THREE.Vector3(4, 0, -6), VIEWPORT)!;
    expect(anchor.point()!.x).toBeCloseTo(expected.x, 6);
    expect(walks).toBe(1);
  });

  test('a matched object that leaves the graph — the old half of a variant swap — is walked again', () => {
    const oldSofa = furnitureMesh(ASSET.sofa, { x: 0, y: 0, z: -6 });
    const scene = sceneWith(oldSofa);
    anchor.target({ kind: 'furniture', id: ASSET.sofa });
    anchor.update(scene);
    // What `viewer-editor.swapFurniture` does: the new group joins, the old
    // one is retired — both under the SAME root.
    const newSofa = furnitureMesh(ASSET.sofa, { x: 5, y: 0, z: -6 });
    scene.root!.add(newSofa);
    oldSofa.removeFromParent();
    scene.root!.updateMatrixWorld(true);
    anchor.update(scene);
    const expected = projectToViewport(scene.camera, new THREE.Vector3(5, 0, -6), VIEWPORT)!;
    expect(anchor.point()!.x).toBeCloseTo(expected.x, 6);
  });

  test('a degenerate camera never leaks NaN into the read-back', () => {
    const broken = camera();
    broken.projectionMatrix.set(Number.NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    anchor.target({ x: 0, y: 0, z: -4 });
    anchor.update({ camera: broken, root: undefined, viewport: VIEWPORT });
    const point = anchor.point()!;
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(point.visible).toBe(false);
    // And it is published once, not once a frame: guards against `NaN !== NaN`
    // defeating the dedupe.
    const before = published.length;
    anchor.update({ camera: broken, root: undefined, viewport: VIEWPORT });
    anchor.update({ camera: broken, root: undefined, viewport: VIEWPORT });
    expect(published.length).toBe(before);
  });

  test('`hasTarget` is what lets the frame hook skip measuring the viewport', () => {
    expect(anchor.hasTarget()).toBe(false);
    anchor.target({ x: 0, y: 0, z: -4 });
    expect(anchor.hasTarget()).toBe(true);
    anchor.target(null);
    expect(anchor.hasTarget()).toBe(false);
  });
});

describe('viewerSlots', () => {
  test('is the boxes from `ui` and the anchor from here, and nothing of its own', () => {
    const boxes = { get: (name: string) => name } as unknown as Parameters<typeof viewerSlots>[0];
    const slots = viewerSlots(boxes, anchor);
    expect(slots.anchorPoint()).toBeNull();
    slots.anchorTo({ x: 0, y: 0, z: -4 });
    anchor.update(sceneWith());
    expect(slots.anchorPoint()).toEqual(anchor.point());
    slots.anchorTo(null);
    expect(slots.anchorPoint()).toBeNull();
  });

  test('`get` is the boxes’ own answer, passed straight through', () => {
    const box = { id: 'a-box' } as unknown as HTMLElement;
    const boxes = { get: () => box } as unknown as Parameters<typeof viewerSlots>[0];
    expect(viewerSlots(boxes, anchor).get('bottom-center')).toBe(box);
  });
});
