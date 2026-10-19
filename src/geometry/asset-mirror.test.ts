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

  test('a body joining later (a model upgrade) is reflected the same way', () => {
    const first = placement();
    setBodyMirror(first.group, { x: true });
    const second = placement();
    mirrorBody(second.group.children[0]!, bodyMirrorOf(first.group));
    expect(markerAt(second.group, second.marker).x).toBeCloseTo(markerAt(first.group, first.marker).x);
  });
});
