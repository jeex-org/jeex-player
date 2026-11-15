/**
 * Drawing a mirrored placement: reflected about the body bounds centre, so the object stays where it
 * stands, with a negative determinant three's renderer turns into flipped
 * winding.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { bodyMirrorOf, mirrorBody, setBodyMirror } from './asset-mirror.js';
import { GLOW_GROUP_NAME } from './selection-glow.js';

/** A floor-standing body: a seat block at the left end of a 2 m wide, 0.8 m tall piece, turned like a procedural body. */
function placement(): { group: THREE.Group; marker: THREE.Mesh } {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.rotation.y = Math.PI;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 0.9));
  frame.position.y = 0.4;
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
  marker.position.set(0.7, 0.7, 0);
  body.add(frame, marker);
  group.add(body);
  group.position.set(3, 0, 4);
  group.rotation.y = 0.6;
  return { group, marker };
}

/** Where the marker's centre is, in the placement group's frame. */
function markerAt(group: THREE.Group, marker: THREE.Mesh): THREE.Vector3 {
  group.updateMatrixWorld(true);
  const local = new THREE.Matrix4().copy(group.matrixWorld).invert().multiply(marker.matrixWorld);
  return new THREE.Vector3().setFromMatrixPosition(local);
}

function boundsOf(group: THREE.Group): THREE.Box3 {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const box = new THREE.Box3();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.computeBoundingBox();
    box.union(object.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)));
  });
  return box;
}

describe('setBodyMirror', () => {
  test('x moves the marker to the other side about the bounds centre; the bounds stay', () => {
    const { group, marker } = placement();
    const before = markerAt(group, marker);
    const bounds = boundsOf(group);
    setBodyMirror(group, { x: true });
    const after = markerAt(group, marker);
    expect(after.x).toBeCloseTo(-before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(boundsOf(group).min.distanceTo(bounds.min)).toBeLessThan(1e-9);
    expect(boundsOf(group).max.distanceTo(bounds.max)).toBeLessThan(1e-9);
    expect(bodyMirrorOf(group)).toEqual({ x: true });
    group.updateMatrixWorld(true);
    // A reflection: the renderer flips this mesh's winding, so it stays lit from the right side.
    expect(marker.matrixWorld.determinant()).toBeLessThan(0);
  });

  test('y reflects about the body centre height, so the object does not sink under the floor', () => {
    const { group, marker } = placement();
    setBodyMirror(group, { y: true });
    expect(markerAt(group, marker).y).toBeCloseTo(0.1);
    expect(boundsOf(group).min.y).toBeCloseTo(0);
  });

  test('setting the same state twice, or toggling back, is the identity', () => {
    const { group, marker } = placement();
    const before = markerAt(group, marker);
    setBodyMirror(group, { x: true, z: true });
    setBodyMirror(group, { x: true, z: true });
    setBodyMirror(group, {});
    const after = markerAt(group, marker);
    expect(after.distanceTo(before)).toBeLessThan(1e-9);
    expect(bodyMirrorOf(group)).toEqual({});
    group.updateMatrixWorld(true);
    expect(marker.matrixWorld.determinant()).toBeGreaterThan(0);
  });

  test('the group keeps its own pose and scale, and the selection aura is not a body', () => {
    const { group } = placement();
    const aura = new THREE.Group();
    aura.name = GLOW_GROUP_NAME;
    group.add(aura);
    setBodyMirror(group, { x: true });
    expect(group.scale.toArray()).toEqual([1, 1, 1]);
    expect(group.position.toArray()).toEqual([3, 0, 4]);
    expect(aura.matrix.determinant()).toBeGreaterThan(0);
  });

  test('a turned node holding an asymmetric mesh is reflected about its exact centre: the bounds stay', () => {
    // A triangle turned 45° about z: its own box, turned, is centred at x = 0,
    // while the turned triangle spans x 0..0.707 (a frond on a turned node).
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0], 3));
    const node = new THREE.Group();
    node.rotation.z = Math.PI / 4;
    node.add(new THREE.Mesh(geometry));
    const body = new THREE.Group();
    body.add(node);
    const group = new THREE.Group();
    group.add(body);
    const exact = (): THREE.Box3 => {
      group.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(group, true);
    };
    const bounds = exact();
    setBodyMirror(group, { x: true });
    expect(exact().min.distanceTo(bounds.min)).toBeLessThan(1e-6);
    expect(exact().max.distanceTo(bounds.max)).toBeLessThan(1e-6);
  });

  test('an instanced mesh is reflected about the centre of all its instances, as three measures it', () => {
    // Instances at x = 0 and x = 2 of a 0.2 m box: the instances span x -0.1..2.1,
    // while the prototype geometry alone spans -0.1..0.1.
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial(), 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
    const body = new THREE.Group();
    body.add(mesh);
    const group = new THREE.Group();
    group.add(body);
    const exact = (): THREE.Box3 => {
      group.updateMatrixWorld(true);
      mesh.computeBoundingBox();
      return new THREE.Box3().setFromObject(group, true);
    };
    const bounds = exact();
    setBodyMirror(group, { x: true });
    expect(exact().min.distanceTo(bounds.min)).toBeLessThan(1e-6);
    expect(exact().max.distanceTo(bounds.max)).toBeLessThan(1e-6);
  });

  test('a body joining later (a model upgrade) is reflected the same way', () => {
    const first = placement();
    setBodyMirror(first.group, { x: true });
    const second = placement();
    mirrorBody(second.group.children[0]!, bodyMirrorOf(first.group));
    expect(markerAt(second.group, second.marker).x).toBeCloseTo(markerAt(first.group, first.marker).x);
  });
});
