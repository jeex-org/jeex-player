/**
 * The narrow view of three.js the lighting standard builds with.
 *
 * The standard never imports three.js at runtime: the caller hands in its own
 * namespace, and every light, texture and render target is constructed from
 * it, so the objects belong to the caller's engine and its renderer. This type
 * names exactly the members the standard uses, so a caller can pass a small
 * object built from `import * as THREE` (and keep its bundle tree-shaken)
 * rather than the whole namespace.
 *
 * Type-only imports of `three`, no DOM.
 */

import type * as THREE from 'three';

/** The members of the three.js namespace the lighting standard constructs or reads. */
export type LightingThree = Pick<
  typeof THREE,
  | 'REVISION'
  | 'ColorManagement'
  | 'NeutralToneMapping'
  | 'SRGBColorSpace'
  | 'LinearSRGBColorSpace'
  | 'PCFShadowMap'
  | 'HalfFloatType'
  | 'RGBAFormat'
  | 'LinearFilter'
  | 'EquirectangularReflectionMapping'
  | 'DataTexture'
  | 'PMREMGenerator'
  | 'Group'
  | 'DirectionalLight'
  | 'HemisphereLight'
>;

/** The renderer a lighting context configures and builds its environment with. */
export type LightingRenderer = THREE.WebGLRenderer;

/** The scene a rig lights. */
export type LightingScene = THREE.Scene;
