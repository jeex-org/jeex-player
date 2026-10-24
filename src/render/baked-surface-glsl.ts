/**
 * The baked-surface policy's shader rewrite, over the composer's expanded
 * lighting chunks (`render/shader-compose.ts`), applied after the walk
 * lighting's.
 *
 * On a baked surface:
 * - `irradiance` is cleared right after the begin chunk: no ambient light
 *   (the walk's ambient floor included), hemisphere, light probes or grid;
 *   the lightmap, added by the maps chunk, is then its only diffuse
 *   indirect light;
 * - the physical indirect specular keeps `iblIrradiance` for its multiple
 *   scattering but no longer adds the environment's diffuse share;
 * - in the point and spot loops, after the shadow and projected-texture
 *   factors, each `RE_Direct` call is braced (the loops are unrolled) and its
 *   diffuse mixed back to the value before the call by the light's mask
 *   (`jeexPointDiffuse[ i ]`, `jeexSpotDiffuse[ i ]`: 0 baked, 1 live);
 *   specular is kept;
 * - each directional light's direct light is scaled by `jeexDirDirect[ i ]`
 *   (0 for the fill, 1 for the sun);
 * - after the maps chunk `irradiance` (the lightmap alone by then) is scaled
 *   by `jeexBakedGain`, the baked-interior gain of the scene's mode
 *   (`render/baked-surface.ts`), never by redefining `lightMapIntensity`,
 *   which a lightmap decode owns. The lightmap is indirect light, like the
 *   room grid: the walk's interior sun factor never touches it.
 *
 * The anchors are pinned by `BAKED_CHUNK_ANCHORS` against the installed
 * three (r186.1).
 */

import { BAKED_TRANSFORM_ID, chunkMarker, replaceAnchor } from './shader-compose.js';

/** The exact r186 lines the rewrite relies on, per chunk. */
export const BAKED_CHUNK_ANCHORS = Object.freeze({
  lights_fragment_begin: [
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
    'getSpotLightInfo( spotLight, geometryPosition, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );',
    'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
  ],
  lights_physical_pars_fragment: ['reflectedLight.indirectDiffuse += indirectDiffuse;'],
} as const);

const [POINT_INFO, SPOT_INFO, DIRECTIONAL_INFO, RE_DIRECT] = BAKED_CHUNK_ANCHORS.lights_fragment_begin;
const [ENV_DIFFUSE] = BAKED_CHUNK_ANCHORS.lights_physical_pars_fragment;

const DECLARATIONS = /* glsl */ `#define JEEX_BAKED_SURFACE
#if NUM_POINT_LIGHTS > 0
uniform float jeexPointDiffuse[ NUM_POINT_LIGHTS ];
#endif
#if NUM_SPOT_LIGHTS > 0
uniform float jeexSpotDiffuse[ NUM_SPOT_LIGHTS ];
#endif
#if NUM_DIR_LIGHTS > 0
uniform float jeexDirDirect[ NUM_DIR_LIGHTS ];
#endif
uniform float jeexBakedGain;
`;

/** The `RE_Direct` call with its diffuse kept only as far as the light's mask says. */
const masked = (mask: string): string => /* glsl */ `{
			vec3 jeexDiffuseBefore = reflectedLight.directDiffuse;
			${RE_DIRECT}
			reflectedLight.directDiffuse = mix( jeexDiffuseBefore, reflectedLight.directDiffuse, ${mask}[ i ] );
		}`;

/** `text` with the first `anchor` after `landmark` replaced. */
function replaceAfter(text: string, landmark: string, anchor: string, replacement: string): string {
  const at = text.indexOf(landmark);
  if (at < 0) return replaceAnchor(text, landmark, landmark, BAKED_TRANSFORM_ID);
  const head = text.slice(0, at + landmark.length);
  return head + replaceAnchor(text.slice(at + landmark.length), anchor, replacement, BAKED_TRANSFORM_ID);
}

const CLEAR = /* glsl */ `
#if defined( RE_IndirectDiffuse )
	irradiance = vec3( 0.0 );
#endif`;

const GAIN = /* glsl */ `
#if defined( RE_IndirectDiffuse )
	irradiance *= jeexBakedGain;
#endif`;

/** The fragment shader of a standard or physical material with the baked policy applied to its expanded chunks. */
export function bakeFragmentShader(source: string): string {
  const parsBegin = chunkMarker('lights_physical_pars_fragment', 'begin');
  let out = replaceAnchor(source, parsBegin, DECLARATIONS + parsBegin, BAKED_TRANSFORM_ID);
  out = replaceAfter(out, parsBegin, ENV_DIFFUSE, '// jeex: no environment diffuse on a baked surface');
  out = replaceAfter(out, POINT_INFO, RE_DIRECT, masked('jeexPointDiffuse'));
  out = replaceAfter(out, SPOT_INFO, RE_DIRECT, masked('jeexSpotDiffuse'));
  out = replaceAnchor(out, DIRECTIONAL_INFO, `${DIRECTIONAL_INFO}\n\t\tdirectLight.color *= jeexDirDirect[ i ];`, BAKED_TRANSFORM_ID);
  const beginEnd = chunkMarker('lights_fragment_begin', 'end');
  out = replaceAnchor(out, beginEnd, beginEnd + CLEAR, BAKED_TRANSFORM_ID);
  const mapsEnd = chunkMarker('lights_fragment_maps', 'end');
  return replaceAnchor(out, mapsEnd, mapsEnd + GAIN, BAKED_TRANSFORM_ID);
}
