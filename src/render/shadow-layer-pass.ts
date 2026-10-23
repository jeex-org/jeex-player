/**
 * Lets the sun's shadow pass see the casters nobody may see: objects that
 * live on `SHADOW_ONLY_LAYER` and nowhere else (the closed ceiling slabs, the
 * walls the dollhouse cuts away).
 *
 * The engine detail it rests on (three r186, `WebGLShadowMap.renderObject`):
 * the shadow pass skips `visible === false` and tests `object.layers` against
 * the VIEW camera handed to `shadowMap.render`, not against the shadow camera.
 * So a caster off layer 0 casts only if the view camera has its layer, and the
 * view camera must not have it while the scene itself is drawn. This wraps
 * `renderer.shadowMap.render`, enables the shadow-only layer on the incoming
 * camera for the duration of the call and restores the exact mask in
 * `finally`. Nothing else calls the shadow pass: three does, inside
 * `renderer.render`, through the property, which is why replacing the method
 * on the object is enough. `tests/component/sun-shadow.test.ts` pins the
 * behaviour, so an engine upgrade that changes it fails loudly.
 *
 * A context restore makes three build a NEW `WebGLShadowMap`; the runtime
 * installs again then. Installing is idempotent per shadow map.
 */

import type * as THREE from 'three';
import { SHADOW_ONLY_LAYER } from '../shared/render-layers.js';

type ShadowPass = (lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => void;

/** The renderer's shadow map as this module touches it. */
type ShadowMapLike = { render: ShadowPass };

/** Marks a pass this module made, and keeps the one it wraps. */
const WRAPPED = new WeakMap<ShadowPass, ShadowPass>();

/**
 * Wraps `renderer.shadowMap.render` once; a second call on the same shadow map
 * does nothing. Returns the uninstall, which puts the original back if the
 * wrapper is still in place.
 */
export function installShadowLayerPass(renderer: { shadowMap: ShadowMapLike }): () => void {
  const shadowMap = renderer.shadowMap;
  const current = shadowMap.render;
  // A unit harness's renderer has no shadow pass to wrap.
  if (typeof current !== 'function') return () => undefined;
  if (WRAPPED.has(current)) return () => uninstall(shadowMap, current);
  const original = current;
  const wrapped: ShadowPass = function shadowLayerPass(this: unknown, lights, scene, camera) {
    const mask = camera.layers.mask;
    camera.layers.enable(SHADOW_ONLY_LAYER);
    try {
      original.call(this, lights, scene, camera);
    } finally {
      camera.layers.mask = mask;
    }
  };
  WRAPPED.set(wrapped, original);
  shadowMap.render = wrapped;
  return () => uninstall(shadowMap, wrapped);
}

function uninstall(shadowMap: ShadowMapLike, wrapped: ShadowPass): void {
  const original = WRAPPED.get(wrapped);
  if (original !== undefined && shadowMap.render === wrapped) shadowMap.render = original;
}
