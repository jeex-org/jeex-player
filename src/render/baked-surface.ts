/**
 * The seam between a light bake and the lighting: which materials carry baked
 * light, which lamps are in the bake, and how a shader transform is composed
 * onto a material.
 *
 * A baked surface is a shell material whose diffuse indirect light, and the
 * direct light of every baked lamp, come from its lightmap. The lighting reads
 * the marks to keep only what the bake left out on such a surface (the live
 * direct sun, specular reflections and live lamps) and to skip the live
 * diffuse of a baked lamp there; a lamp left unmarked counts as live.
 *
 * `addShaderTransform` is the one way code outside the lighting changes a
 * material's shader: each transform is named by an id and a version, which
 * together enter the material's program key. Here it composes by plain
 * chaining (the previous hook runs first, the previous key is kept); the
 * lighting's half of the seam replaces it with a composer that applies the
 * transforms in its fixed order over chunks it expands once.
 *
 * Today the marks are plain flags in `userData` and nothing reads them yet.
 */

import type * as THREE from 'three';

/** A shader transform: rewrites the program parameters three hands to `onBeforeCompile`. */
export type ShaderTransform = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/** Marks a material whose diffuse light comes from a light bake. */
export function markBakedSurface(material: THREE.MeshStandardMaterial): void {
  material.userData['jeexBakedSurface'] = true;
}

/** Whether a material is marked as a baked surface. */
export function isBakedSurface(material: THREE.Material): boolean {
  return material.userData['jeexBakedSurface'] === true;
}

/** Marks a lamp as baked (its light is in the bake) or live. */
export function setLampBaked(light: THREE.PointLight | THREE.SpotLight, baked: boolean): void {
  light.userData['jeexBaked'] = baked;
}

/**
 * Adds `transform` to `material`'s shader, after every transform and hook it
 * already has (each still called with the material as `this`), and
 * `id@version` to its program key. Marks the material for recompiling.
 */
export function addShaderTransform(material: THREE.Material, id: string, version: number, transform: ShaderTransform): void {
  // A key never assigned is three's default, which reads the hook in place at call time: capture it now.
  const defaultKey = !Object.hasOwn(material, 'customProgramCacheKey');
  const previousIdentity = defaultKey ? material.onBeforeCompile.toString() : '';
  const previousHook = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousHook(shader, renderer);
    transform(shader);
  };
  material.customProgramCacheKey = () => `${defaultKey ? previousIdentity : previousKey()}|${id}@${String(version)}`;
  material.needsUpdate = true;
}
