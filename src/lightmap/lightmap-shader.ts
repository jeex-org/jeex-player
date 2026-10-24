/**
 * The RGBM decode of a lightmap, as a shader transform of a standard or
 * physical material.
 *
 * three r186 adds `lightMapTexel.rgb * lightMapIntensity` to the diffuse
 * irradiance and ignores the texel's alpha. An RGBM texel stores linear light
 * as `rgb × M × range`, so the transform defines `lightMapIntensity` as
 * `( lightMapIntensity * lightMapTexel.a * range )` right after the uniform's
 * declaration: the decode happens before the one application of the
 * intensity, with no second π. GLSL's preprocessor follows the C++ rules, so
 * the macro never expands inside itself; the uniform keeps its name, and
 * `lightMapIntensity` is only read beside `lightMapTexel` (the maps chunk and
 * the basic material), so the decode holds whether the maps chunk is still
 * an include or a lighting patch has expanded or rewritten it.
 *
 * Anchor: the `#include <lightmap_pars_fragment>` token when it is still
 * there (left in place), otherwise the expanded declaration
 * `uniform float lightMapIntensity;`. The transform is composed through
 * `addShaderTransform`, the lighting's seam, never by touching the
 * material's hooks directly.
 *
 * Invariant: decorating twice with the same range changes nothing; another
 * range on a decorated material is refused.
 */

import type * as THREE from 'three';
import { addShaderTransform } from '../render/baked-surface.js';
import { LightBakeError } from './light-bake-error.js';

/** The include the decode is placed after; in every lit material's fragment shader of r186. */
const PARS_TOKEN = '#include <lightmap_pars_fragment>';
/** The same place once the include is expanded. */
const PARS_DECLARATION = 'uniform float lightMapIntensity;';
/** The transform's id and version in the program key. */
export const RGBM_TRANSFORM_ID = 'jeex-lightmap-rgbm';
export const RGBM_TRANSFORM_VERSION = 1;
const RANGE = Symbol('jeex-rgbm-range');

type Decorated = THREE.MeshStandardMaterial & { [RANGE]?: number };

/** The GLSL inserted after the pars include, for an RGBM range. */
export function rgbmDecodeGlsl(range: number): string {
  if (!(Number.isFinite(range) && range > 0)) throw new LightBakeError('shader', `RGBM range must be positive, got ${String(range)}`);
  return `
#ifdef USE_LIGHTMAP
#define JEEX_RGBM_RANGE ${range.toFixed(6)}
#define lightMapIntensity ( lightMapIntensity * lightMapTexel.a * JEEX_RGBM_RANGE )
#endif`;
}

/** The fragment shader with the decode placed after its lightmap pars; throws when there is none. */
export function withRgbmDecode(fragmentShader: string, range: number): string {
  const anchor = fragmentShader.includes(PARS_TOKEN)
    ? PARS_TOKEN
    : fragmentShader.includes(PARS_DECLARATION)
      ? PARS_DECLARATION
      : undefined;
  if (anchor === undefined)
    throw new LightBakeError('shader', 'lightmap decode: the fragment shader has no lightmap pars include or declaration');
  return fragmentShader.replace(anchor, `${anchor}${rgbmDecodeGlsl(range)}`);
}

/**
 * Decorates `material` so its lightmap is decoded as RGBM with `range`,
 * through the lighting's shader-transform seam.
 */
export function decorateRgbm(material: THREE.MeshStandardMaterial, range: number): void {
  const target = material as Decorated;
  if (target[RANGE] !== undefined) {
    if (target[RANGE] === range) return;
    throw new LightBakeError('shader', `lightmap decode: the material already decodes RGBM with range ${String(target[RANGE])}`);
  }
  rgbmDecodeGlsl(range);
  // The range is part of the shader text, so it is part of the transform's id.
  addShaderTransform(material, `${RGBM_TRANSFORM_ID}-r${String(range)}`, RGBM_TRANSFORM_VERSION, (shader) => {
    shader.fragmentShader = withRgbmDecode(shader.fragmentShader, range);
  });
  target[RANGE] = range;
}

/** The RGBM range a material decodes with, if it is decorated. */
export function rgbmRangeOf(material: THREE.Material): number | undefined {
  return (material as Decorated)[RANGE];
}
