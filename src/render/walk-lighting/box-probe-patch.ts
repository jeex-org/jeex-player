/**
 * The walk lighting's shader patch: one `onBeforeCompile` on every standard
 * and physical material, with one constant program key, driven by uniforms
 * every patched material shares.
 *
 * What it changes in three r186's lighting chunks:
 * - the environment's diffuse term is scaled by `jeexDiffuse` inside the room
 *   boxes (1 in the editing modes, 0 while baking and in walk and tour) and
 *   left on outside them, so facades and the ground keep the editing look;
 * - inside a room with the environment's diffuse off, the room grid's
 *   irradiance takes the environment's place in three's image-based path, so
 *   rough metals keep their multiple-scattering energy and nothing is counted
 *   twice;
 * - with `jeexBoxProbes` on (walk and tour), specular and clearcoat
 *   reflections come from the room probes in one shared atlas, box-projected
 *   onto the room box chosen per fragment (lookup point pushed along the
 *   normal), blended across `blendM` at a shared box face; a fragment outside
 *   every room reflects the studio environment. The anisotropy and
 *   retroreflection branches keep the studio environment.
 *
 * Invariant: with `jeexDiffuse` 1 and `jeexBoxProbes` 0 the output equals the
 * unpatched shader's (pinned in `tests/component/walk-lighting.test.ts`), and
 * switching the uniforms never recompiles: the program key is constant.
 *
 * The chunk texts it rewrites are pinned by `ENGINE_CHUNK_ANCHORS`; the
 * lighting standard already refuses any other three.js revision.
 */

import * as THREE from 'three';
import type { RoomBox, RoomProbe } from './room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';

/** The program key every patched material shares: the patch is one program variant, whatever the state. */
export const PROGRAM_KEY = 'jeex-walk-lighting-1';
/** Edge of an atlas tile: the PMREM layout of a 128 px cube (and of the studio environment). */
export const TILE = Object.freeze({ width: 384, height: 512 });
/** Tiles per atlas column. */
const ROWS_MAX = 8;

/** The exact r186 lines the patch replaces, per chunk. */
export const ENGINE_CHUNK_ANCHORS = Object.freeze({
  lights_fragment_begin: ['irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );'],
  lights_fragment_maps: [
    'iblIrradiance += getIBLIrradiance( geometryNormal );',
    'vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
    'clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );',
  ],
  cube_uv_reflection_fragment: ['highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;', 'uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );'],
});

/** The uniforms every patched material shares. */
export type WalkUniforms = {
  jeexDiffuse: { value: number };
  jeexBoxProbes: { value: number };
  jeexBoxCount: { value: number };
  jeexSelMin: { value: THREE.Vector3[] };
  jeexSelMax: { value: THREE.Vector3[] };
  jeexBoxMin: { value: THREE.Vector3[] };
  jeexBoxMax: { value: THREE.Vector3[] };
  jeexProbe: { value: THREE.Vector3[] };
  jeexTile: { value: THREE.Vector2[] };
  jeexAtlas: { value: THREE.Texture };
  jeexAtlasTexel: { value: THREE.Vector2 };
  jeexBlend: { value: number };
  jeexPush: { value: number };
};

/** The rig's three uniform states: editing look, bake capture, walk look. */
export type UniformState = 'editing' | 'capture' | 'walk';

const vectors = (): THREE.Vector3[] => Array.from({ length: T.maxBoxes }, () => new THREE.Vector3());

/** A black 1 x 1 texture the atlas sampler holds until the probes exist. */
function placeholder(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

export function createWalkUniforms(): WalkUniforms {
  return {
    jeexDiffuse: { value: 1 },
    jeexBoxProbes: { value: 0 },
    jeexBoxCount: { value: 0 },
    jeexSelMin: { value: vectors() },
    jeexSelMax: { value: vectors() },
    jeexBoxMin: { value: vectors() },
    jeexBoxMax: { value: vectors() },
    jeexProbe: { value: vectors() },
    jeexTile: { value: Array.from({ length: T.maxBoxes }, () => new THREE.Vector2()) },
    jeexAtlas: { value: placeholder() },
    jeexAtlasTexel: { value: new THREE.Vector2(1, 1) },
    jeexBlend: { value: T.blendM / 2 },
    jeexPush: { value: T.normalPushM },
  };
}

/** Puts the uniforms in one of the rig's states. */
export function setUniformState(uniforms: WalkUniforms, state: UniformState): void {
  uniforms.jeexDiffuse.value = state === 'editing' ? 1 : 0;
  uniforms.jeexBoxProbes.value = state === 'walk' ? 1 : 0;
}

/** Where each room's tile sits in the atlas, and the atlas size. */
export type AtlasLayout = { columns: number; rows: number; width: number; height: number; tiles: { x: number; y: number }[] };

/** One column of up to eight tiles, more columns beyond: at most 4096 texels high. */
export function atlasLayout(rooms: number): AtlasLayout {
  const count = Math.max(1, rooms);
  const columns = Math.ceil(count / ROWS_MAX);
  const rows = Math.ceil(count / columns);
  const tiles = Array.from({ length: count }, (_, i) => ({ x: Math.floor(i / rows) * TILE.width, y: (i % rows) * TILE.height }));
  return { columns, rows, width: columns * TILE.width, height: rows * TILE.height, tiles };
}

const put = (target: THREE.Vector3, p: { x: number; y: number; z: number }): THREE.Vector3 => target.set(p.x, p.y, p.z);

/** Fills the box arrays: each box with its room's probe point and tile. */
export function setRoomBoxes(uniforms: WalkUniforms, boxes: readonly RoomBox[], probes: readonly RoomProbe[], layout: AtlasLayout): void {
  const index = new Map(probes.map((probe, i) => [probe.roomId, i]));
  boxes.forEach((box, i) => {
    const probe = index.get(box.roomId) ?? 0;
    put(uniforms.jeexSelMin.value[i]!, box.selection.min);
    put(uniforms.jeexSelMax.value[i]!, box.selection.max);
    put(uniforms.jeexBoxMin.value[i]!, box.projection.min);
    put(uniforms.jeexBoxMax.value[i]!, box.projection.max);
    put(uniforms.jeexProbe.value[i]!, probes[probe]!.position);
    uniforms.jeexTile.value[i]!.set(layout.tiles[probe]!.x, layout.tiles[probe]!.y);
  });
  uniforms.jeexBoxCount.value = boxes.length;
  uniforms.jeexAtlasTexel.value.set(1 / layout.width, 1 / layout.height);
}

const PARS = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
#define JEEX_MAX_BOXES ${T.maxBoxes}
uniform float jeexDiffuse;
uniform float jeexBoxProbes;
uniform int jeexBoxCount;
uniform vec3 jeexSelMin[ JEEX_MAX_BOXES ];
uniform vec3 jeexSelMax[ JEEX_MAX_BOXES ];
uniform vec3 jeexBoxMin[ JEEX_MAX_BOXES ];
uniform vec3 jeexBoxMax[ JEEX_MAX_BOXES ];
uniform vec3 jeexProbe[ JEEX_MAX_BOXES ];
uniform vec2 jeexTile[ JEEX_MAX_BOXES ];
uniform sampler2D jeexAtlas;
uniform vec2 jeexAtlasTexel;
uniform float jeexBlend;
uniform float jeexPush;
vec3 jeexWorldPos = vec3( 0.0 );
vec3 jeexLookup = vec3( 0.0 );
float jeexInRoom = 0.0;

float jeexInside( const in vec3 p, const in int i ) {
	vec3 d = min( p - jeexSelMin[ i ], jeexSelMax[ i ] - p );
	return min( min( d.x, d.y ), d.z );
}

void jeexLocate( const in vec3 viewPosition, const in vec3 viewNormal ) {
	jeexWorldPos = ( ( vec4( viewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
	jeexLookup = jeexWorldPos + transformNormalByInverseViewMatrix( viewNormal, viewMatrix ) * jeexPush;
	jeexInRoom = 0.0;
	for ( int i = 0; i < JEEX_MAX_BOXES; i ++ ) {
		if ( i >= jeexBoxCount ) break;
		if ( jeexInside( jeexLookup, i ) > 0.0 ) jeexInRoom = 1.0;
	}
}

vec3 jeexBilinear( vec3 direction, float mipInt, vec2 tile ) {
	float face = getFace( direction );
	float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
	mipInt = max( mipInt, cubeUV_minMipLevel );
	float faceSize = exp2( mipInt );
	highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
	if ( face > 2.0 ) {
		uv.y += faceSize;
		face -= 3.0;
	}
	uv.x += face * faceSize;
	uv.x += filterInt * 3.0 * cubeUV_minTileSize;
	uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
	uv = ( uv + tile ) * jeexAtlasTexel;
	#ifdef texture2DGradEXT
		return texture2DGradEXT( jeexAtlas, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
	#else
		return texture2D( jeexAtlas, uv ).rgb;
	#endif
}

vec3 jeexProbeSample( vec3 direction, float roughness, vec2 tile ) {
	float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
	float mipF = fract( mip );
	float mipInt = floor( mip );
	vec3 color0 = jeexBilinear( direction, mipInt, tile );
	if ( mipF == 0.0 ) return color0;
	return mix( color0, jeexBilinear( direction, mipInt + 1.0, tile ), mipF );
}

vec3 jeexRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
	vec3 studio = getIBLRadiance( viewDir, normal, roughness );
	if ( jeexBoxProbes < 0.5 || jeexInRoom < 0.5 ) return studio;
	vec3 reflectVec = reflect( - viewDir, normal );
	reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
	reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
	vec3 sum = vec3( 0.0 );
	float total = 0.0;
	for ( int i = 0; i < JEEX_MAX_BOXES; i ++ ) {
		if ( i >= jeexBoxCount ) break;
		float weight = smoothstep( - jeexBlend, jeexBlend, jeexInside( jeexLookup, i ) );
		if ( weight <= 0.0 ) continue;
		vec3 from = clamp( jeexWorldPos, jeexBoxMin[ i ], jeexBoxMax[ i ] );
		vec3 far = max( ( jeexBoxMax[ i ] - from ) / reflectVec, ( jeexBoxMin[ i ] - from ) / reflectVec );
		float distance = max( min( min( far.x, far.y ), far.z ), 0.0 );
		vec3 direction = from + reflectVec * distance - jeexProbe[ i ];
		sum += weight * jeexProbeSample( direction, roughness, jeexTile[ i ] );
		total += weight;
	}
	return total > 0.0 ? sum / total : studio;
}
#endif
`;

/** The begin chunk with the grid's irradiance kept apart in `jeexGridIrradiance`. */
function beginChunk(): string {
  const [line] = ENGINE_CHUNK_ANCHORS.lights_fragment_begin;
  return (
    'vec3 jeexGridIrradiance = vec3( 0.0 );\n' +
    THREE.ShaderChunk.lights_fragment_begin.replace(line, 'jeexGridIrradiance = getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );\n\t\tirradiance += jeexGridIrradiance;')
  );
}

/** The maps chunk with the switches, preceded by the room lookup and followed by the grid hand-over. */
function mapsChunk(): string {
  const [diffuse, specular, clearcoat] = ENGINE_CHUNK_ANCHORS.lights_fragment_maps;
  const maps = THREE.ShaderChunk.lights_fragment_maps.replace(diffuse, 'iblIrradiance += getIBLIrradiance( geometryNormal ) * jeexDiffuseScale;')
    .replace(specular, 'vec3 iblRadiance = jeexRadiance( geometryViewDir, geometryNormal, material.roughness );')
    .replace(clearcoat, 'clearcoatRadiance += jeexRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );');
  return /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	jeexLocate( geometryPosition, geometryNormal );
	float jeexDiffuseScale = mix( 1.0, jeexDiffuse, jeexInRoom );
${maps}
	#if defined( RE_IndirectDiffuse ) && defined( USE_LIGHT_PROBES_GRID ) && defined( STANDARD )
		float jeexMove = jeexInRoom * ( 1.0 - jeexDiffuse );
		iblIrradiance += jeexGridIrradiance * jeexMove;
		irradiance -= jeexGridIrradiance * jeexMove;
	#endif
#else
	#include <lights_fragment_maps>
#endif
`;
}

/** The fragment shader of a standard or physical material with the walk patch in place of its lighting includes. */
export function patchFragmentShader(source: string): string {
  return source
    .replace('#include <envmap_physical_pars_fragment>', `#include <envmap_physical_pars_fragment>\n${PARS}`)
    .replace('#include <lights_fragment_begin>', beginChunk())
    .replace('#include <lights_fragment_maps>', mapsChunk());
}

const PATCHED = Symbol('jeex-walk-patch');
type Patchable = THREE.MeshStandardMaterial & { [PATCHED]?: true };

/**
 * Patches every standard and physical material under `root` that is not
 * patched yet; answers how many it patched. A patched material gets a new
 * version, so one compiled before is compiled again with the patch.
 */
export function installWalkPatch(root: THREE.Object3D, uniforms: WalkUniforms): number {
  let count = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const target = material as Patchable;
      if (!target.isMeshStandardMaterial || target[PATCHED]) continue;
      target[PATCHED] = true;
      target.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = patchFragmentShader(shader.fragmentShader);
      };
      target.customProgramCacheKey = () => PROGRAM_KEY;
      target.needsUpdate = true;
      count += 1;
    }
  });
  return count;
}
