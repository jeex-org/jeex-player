/**
 * The mark every invisible pick proxy carries.
 *
 * An opening owns a few raycast-only meshes (`opening-builder.ts`): its jamb
 * and head bands, a window's pane and its share of the wall top. They exist so
 * a click can name the opening, never to be drawn or measured, so everything
 * that reads an opening's meshes as its shape — the selection anchor, the
 * selection aura, the export graph and the light-bake shell — skips them by
 * this one flag.
 */

import * as THREE from 'three';

const PICK_PROXY_KEY = 'pickProxy';

/** Marks `mesh` as a pick proxy. */
export function markPickProxy(mesh: THREE.Mesh): void {
  mesh.userData[PICK_PROXY_KEY] = true;
}

/** Whether `object` is a pick proxy, a raycast helper that is never part of a shape. */
export function isPickProxy(object: THREE.Object3D): boolean {
  return object.userData[PICK_PROXY_KEY] === true;
}

const PART_BOX = new THREE.Box3();

/**
 * `box` grown by `object` and its descendants as `Box3.expandByObject` grows
 * it, with every pick proxy left out; answers `box`.
 */
export function expandByShape(box: THREE.Box3, object: THREE.Object3D): THREE.Box3 {
  if (isPickProxy(object)) return box;
  if (!containsPickProxy(object)) return box.expandByObject(object);
  if (object instanceof THREE.Mesh) {
    object.updateWorldMatrix(false, false);
    const geometry = object.geometry;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(PART_BOX.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld));
  }
  for (const child of object.children) expandByShape(box, child);
  return box;
}

function containsPickProxy(object: THREE.Object3D): boolean {
  return object.children.some((child) => isPickProxy(child) || containsPickProxy(child));
}
