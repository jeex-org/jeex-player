/**
 * Which index each light gets in three's per-type light arrays for one
 * render, and the baked-surface masks over those indices.
 *
 * Adapter pinned to three r186.1 (`WebGLRenderer.projectObject` and
 * `WebGLLights.setup`): a light is collected in scene traversal order when
 * every ancestor is visible and its own layers pass the camera's (a light
 * failing the layer test is skipped, its children are not); the collected
 * lights are sorted stably by `2 × castShadow + Boolean(map)`, descending;
 * then each type's array keeps that order. The component test
 * `tests/component/baked-surface.test.ts` reads every light's diffuse back
 * from pixels, so an upgrade that changes the order fails there.
 *
 * Masks: points and spots 0 when marked baked (`userData.jeexBaked === true`),
 * 1 otherwise; directional lights 0 for the apartment rig's fill, 1 otherwise
 * (the sun is never told apart by `castShadow`).
 */

import type * as THREE from 'three';

/** The apartment rig's fill light (`lighting/lighting-context.ts`): its light is in every bake. */
export const FILL_LIGHT_NAME = 'jeex-lighting-fill';
/** The light `userData` key a lamp is marked baked by (`render/baked-surface.ts`). */
export const LAMP_BAKED_KEY = 'jeexBaked';

export type LightMasks = { point: number[]; spot: number[]; directional: number[] };

type AnyLight = THREE.Light & {
  isPointLight?: boolean;
  isSpotLight?: boolean;
  isDirectionalLight?: boolean;
  isSunLight?: boolean;
  map?: unknown;
};

function collect(object: THREE.Object3D, camera: THREE.Camera, out: AnyLight[]): void {
  if (!object.visible) return;
  if ((object as AnyLight).isLight && object.layers.test(camera.layers)) out.push(object as AnyLight);
  for (const child of object.children) collect(child, camera, out);
}

const weight = (light: AnyLight): number => (light.castShadow ? 2 : 0) + (light.map ? 1 : 0);

/** The masks of `scene` drawn from `camera`, in three's array order. */
export function lightMasks(scene: THREE.Object3D, camera: THREE.Camera): LightMasks {
  const lights: AnyLight[] = [];
  collect(scene, camera, lights);
  lights.sort((a, b) => weight(b) - weight(a));
  const masks: LightMasks = { point: [], spot: [], directional: [] };
  for (const light of lights) {
    const live = light.userData[LAMP_BAKED_KEY] === true ? 0 : 1;
    // The same branch order as WebGLLights: a sun light is not a directional light there.
    if (light.isSunLight) continue;
    if (light.isDirectionalLight) masks.directional.push(light.name === FILL_LIGHT_NAME ? 0 : 1);
    else if (light.isSpotLight) masks.spot.push(live);
    else if (light.isPointLight) masks.point.push(live);
  }
  return masks;
}
