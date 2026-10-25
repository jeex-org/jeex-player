/**
 * The per-light uniforms every patched material shares, resolved per render
 * and camera in three's own light order (`render/light-order.ts`): the baked
 * masks (`render/baked-surface.ts`) and each drawn point light's source room
 * (the walk lighting's lamp gate, `render/walk-lighting/box-probe-patch.ts`).
 *
 * They are written by a draw hook on each material that reads them, cached
 * per (render, scene, camera): a capture, or a render nested in another one
 * (a mirror), has another camera and so its own values; on return the outer
 * render's frame counter differs again and its values are recomputed. The
 * arrays take three's light counts of that render, so a change in the number
 * of lights needs no call.
 *
 * Copies: three's `clone()` does not copy `onBeforeRender`, so whoever made a
 * copy installs the hook again (`installLightDrawHook` is idempotent).
 */

import type * as THREE from 'three';
import { lightMasks } from './light-order.js';

/** The shared per-light arrays: one object for every material, values per render. */
export const LIGHT_UNIFORMS = {
  jeexPointDiffuse: { value: [] as number[] },
  jeexSpotDiffuse: { value: [] as number[] },
  jeexDirDirect: { value: [] as number[] },
  jeexPointRoom: { value: [] as number[] },
};

/** The (render, scene, camera) the arrays were last computed for, by id: no reference keeps a released scene alive. */
const computed = { frame: -1, scene: -1, camera: -1 };

/** Writes the arrays for `scene` drawn from `camera` in this render, unless they already are. */
export function updateLightUniforms(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera): void {
  const frame = renderer.info.render.frame;
  if (computed.frame === frame && computed.scene === scene.id && computed.camera === camera.id) return;
  Object.assign(computed, { frame, scene: scene.id, camera: camera.id });
  const masks = lightMasks(scene, camera);
  LIGHT_UNIFORMS.jeexPointDiffuse.value = masks.point;
  LIGHT_UNIFORMS.jeexSpotDiffuse.value = masks.spot;
  LIGHT_UNIFORMS.jeexDirDirect.value = masks.directional;
  LIGHT_UNIFORMS.jeexPointRoom.value = masks.pointRoom;
}

type DrawHook = (
  this: THREE.Material,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  object: THREE.Object3D,
  group: THREE.Group,
) => void;

/** Materials whose light hook this module installed: the runtime state idempotence checks, not a copyable flag. */
const HOOKED = new WeakSet<THREE.Material>();

/** Makes `material` update the shared arrays before it is drawn, then run its earlier hook. Idempotent. */
export function installLightDrawHook(material: THREE.Material): void {
  if (HOOKED.has(material)) return;
  // The hook as the function-valued property it is (three declares it as a method).
  const hooks = material as unknown as { onBeforeRender: DrawHook };
  const previous = hooks.onBeforeRender;
  hooks.onBeforeRender = function lightUniforms(renderer, scene, camera, geometry, object, group) {
    updateLightUniforms(renderer, scene, camera);
    previous.call(this, renderer, scene, camera, geometry, object, group);
  };
  HOOKED.add(material);
}
