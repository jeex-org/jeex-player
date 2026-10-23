/**
 * The dollhouse cutaway by layers: a wall between the camera and the interior
 * leaves layer 0 (never drawn, never picked) but stays on the shadow-only
 * layer, so the sun's shadows do not change with the cutaway.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { solvePlan } from '../plan/plan-solver.js';
import { SHADOW_ONLY_LAYER } from '../shared/render-layers.js';
import { Dollhouse } from './dollhouse.js';

const plan = solvePlan(lShapePlan);
const face = plan.facade[0]!;

/** A wall group with a pane that must keep not casting, as an opening group has. */
function exteriorWall(wallId: string): { group: THREE.Group; wall: THREE.Mesh; pane: THREE.Mesh } {
  const group = new THREE.Group();
  group.userData['wallId'] = wallId;
  const wall = new THREE.Mesh(new THREE.BoxGeometry());
  wall.castShadow = true;
  const pane = new THREE.Mesh(new THREE.BoxGeometry());
  pane.castShadow = false;
  group.add(wall, pane);
  return { group, wall, pane };
}

/** A camera standing outside `face`, two metres along its outward normal. */
function outside(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  const mid = face.polyline[Math.floor(face.polyline.length / 2)]!;
  camera.position.set(mid.x + face.normal.x * 50, 10, mid.z + face.normal.z * 50);
  return camera;
}

function drawn(object: THREE.Object3D): boolean {
  return object.layers.isEnabled(0);
}

describe('Dollhouse cutaway', () => {
  test('a wall between the camera and the interior leaves layer 0 everywhere in its subtree and keeps the shadow-only layer', () => {
    const { group, wall, pane } = exteriorWall(face.wallId);
    const root = new THREE.Group();
    root.add(group);
    const dollhouse = new Dollhouse(() => [group]);
    dollhouse.prepare(plan, root);
    dollhouse.setState('dollhouse', outside());
    for (const object of [group, wall, pane]) {
      expect(drawn(object)).toBe(false);
      expect(object.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(true);
      expect(object.visible).toBe(true);
    }
    expect(wall.castShadow).toBe(true);
    expect(pane.castShadow).toBe(false);
  });

  test('the full shell and the top view draw the wall again', () => {
    const { group, wall } = exteriorWall(face.wallId);
    const root = new THREE.Group();
    root.add(group);
    const dollhouse = new Dollhouse(() => [group]);
    dollhouse.prepare(plan, root);
    const camera = outside();
    dollhouse.setState('dollhouse', camera);
    dollhouse.setState('full', camera);
    expect(drawn(wall)).toBe(true);
    dollhouse.setState('dollhouse', camera);
    dollhouse.setKeepExteriors(true, camera);
    expect(drawn(wall)).toBe(true);
  });

  test('a wall the camera does not stand outside stays drawn', () => {
    const { group, wall } = exteriorWall(face.wallId);
    const dollhouse = new Dollhouse(() => [group]);
    dollhouse.prepare(plan, group);
    const inside = new THREE.PerspectiveCamera();
    const mid = face.polyline[Math.floor(face.polyline.length / 2)]!;
    inside.position.set(mid.x - face.normal.x * 0.5, 1.6, mid.z - face.normal.z * 0.5);
    dollhouse.setState('dollhouse', inside);
    expect(drawn(wall)).toBe(true);
  });

  test('a junction core goes only when every wall meeting there goes', () => {
    const core = new THREE.Mesh(new THREE.BoxGeometry());
    const other = plan.facade.find(
      (candidate) => candidate.wallId !== face.wallId && candidate.normal.x * face.normal.x + candidate.normal.z * face.normal.z < 0.5,
    )!;
    core.userData['wallIds'] = [face.wallId, other.wallId];
    const dollhouse = new Dollhouse(() => [core]);
    dollhouse.prepare(plan, core);
    dollhouse.setState('dollhouse', outside());
    expect(drawn(core)).toBe(true);
  });

  test('the ceiling cap is seen only in the full shell', () => {
    const root = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.PlaneGeometry());
    cap.userData['isCeiling'] = true;
    root.add(cap);
    const dollhouse = new Dollhouse(() => []);
    dollhouse.prepare(plan, root);
    dollhouse.setState('dollhouse');
    expect(cap.visible).toBe(false);
    dollhouse.setState('full');
    expect(cap.visible).toBe(true);
  });

  test('an update that changes nothing walks no subtree', () => {
    const { group } = exteriorWall(face.wallId);
    const dollhouse = new Dollhouse(() => [group]);
    dollhouse.prepare(plan, group);
    const camera = outside();
    dollhouse.setState('dollhouse', camera);
    let walks = 0;
    const traverse = group.traverse.bind(group);
    group.traverse = (callback) => {
      walks += 1;
      traverse(callback);
    };
    dollhouse.update(camera);
    dollhouse.update(camera);
    expect(walks).toBe(0);
  });

  test('takeChanged reports a shell switch and a cutaway change once, and a still camera never', () => {
    const { group } = exteriorWall(face.wallId);
    const dollhouse = new Dollhouse(() => [group]);
    dollhouse.prepare(plan, group);
    const camera = outside();
    dollhouse.setState('dollhouse', camera);
    expect(dollhouse.takeChanged()).toBe(true);
    expect(dollhouse.takeChanged()).toBe(false);
    dollhouse.update(camera);
    expect(dollhouse.takeChanged()).toBe(false);
    // The same switch at the same pose: the walls and ceilings were written again.
    dollhouse.setState('full', camera);
    expect(dollhouse.takeChanged()).toBe(true);
    dollhouse.setState('dollhouse', camera);
    dollhouse.takeChanged();
    // The cutaway follows the camera inside: a wall comes back.
    const mid = face.polyline[Math.floor(face.polyline.length / 2)]!;
    camera.position.set(mid.x - face.normal.x * 0.5, 1.6, mid.z - face.normal.z * 0.5);
    dollhouse.update(camera);
    expect(dollhouse.takeChanged()).toBe(true);
    dollhouse.setKeepExteriors(true, camera);
    dollhouse.setKeepExteriors(true, camera);
    dollhouse.update(camera);
    expect(dollhouse.takeChanged()).toBe(false);
  });
});
