/**
 * The player's own three.js, handed to the lighting standard.
 *
 * `src/lighting/` imports no three.js at runtime: every consumer passes its
 * engine in. The player passes this small object rather than the whole
 * namespace, so the bundler still sees named member accesses and keeps tree
 * shaking — a spread of `THREE` would pull in every export.
 */

import * as THREE from 'three';
import { createLightingContext, type LightingContext } from '../lighting/lighting-context.js';
import type { LightingThree } from '../lighting/lighting-three.js';

/** Exactly the members `LightingThree` names, from the bundled three.js. */
export const PLAYER_THREE: LightingThree = {
  REVISION: THREE.REVISION,
  ColorManagement: THREE.ColorManagement,
  NeutralToneMapping: THREE.NeutralToneMapping,
  SRGBColorSpace: THREE.SRGBColorSpace,
  LinearSRGBColorSpace: THREE.LinearSRGBColorSpace,
  PCFShadowMap: THREE.PCFShadowMap,
  HalfFloatType: THREE.HalfFloatType,
  RGBAFormat: THREE.RGBAFormat,
  LinearFilter: THREE.LinearFilter,
  EquirectangularReflectionMapping: THREE.EquirectangularReflectionMapping,
  DataTexture: THREE.DataTexture,
  PMREMGenerator: THREE.PMREMGenerator,
  Group: THREE.Group,
  DirectionalLight: THREE.DirectionalLight,
  HemisphereLight: THREE.HemisphereLight,
};

/** The lighting standard bound to one of the player's renderers. */
export function playerLighting(renderer: THREE.WebGLRenderer): LightingContext {
  return createLightingContext(PLAYER_THREE, renderer);
}
