/**
 * Which objects the walk chain's ambient-occlusion input sees.
 *
 * three's `GTAOPass` renders the scene a second time with one normal material
 * for its depth and normals, and on its own it leaves out only lines and
 * points: window glass, the invisible pick proxies of doorways and the walk
 * floor ring would all darken what is around them. Occlusion comes only from
 * what the beauty pass draws as a solid surface, so an object occludes when it
 * is a visible mesh on layer 0 (an object only on custom layers is an overlay
 * or a shadow-only caster, `shared/render-layers.ts`) whose every material is
 * opaque: not transparent, fully opaque, visible, writing colour and not
 * transmissive. Pick proxies are caught by their invisible material, not by
 * any metadata.
 *
 * Invariant: `withOccludersOnly` restores every visibility it changed, in
 * `finally`, also when the draw throws.
 */

import type * as THREE from 'three';

type Renderable = THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };

/** Whether one material draws a solid surface. */
function opaque(material: THREE.Material): boolean {
  const transmission = (material as Partial<THREE.MeshPhysicalMaterial>).transmission ?? 0;
  return material.visible && !material.transparent && material.opacity >= 1 && material.colorWrite && transmission <= 0;
}

/** Whether `object` takes part in the occlusion input. */
export function occludes(object: THREE.Object3D): boolean {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh || !mesh.visible || !mesh.layers.isEnabled(0)) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.every((material) => opaque(material));
}

/** Whether `object` would be drawn at all: a mesh, a line, points or a sprite. */
function renderable(object: Renderable): boolean {
  return object.isMesh === true || object.isLine === true || object.isPoints === true || object.isSprite === true;
}

/** Runs `draw` with every visible renderable under `root` that does not occlude hidden, then shows them again. */
export function withOccludersOnly<T>(root: THREE.Object3D, draw: () => T): T {
  const hidden: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.visible && renderable(object) && !occludes(object)) hidden.push(object);
  });
  for (const object of hidden) object.visible = false;
  try {
    return draw();
  } finally {
    for (const object of hidden) object.visible = true;
  }
}
