/**
 * The walk lighting's shader patch: one shader transform (`WALK_TRANSFORM`,
 * registered through `render/shader-compose.ts`) on every standard and
 * physical material, with one program key, driven by uniforms every patched
 * material shares. It rewrites the composer's expanded lighting chunks.
 *
 * What it changes in three r186's lighting chunks:
 * - the environment's diffuse term is scaled by `jeexDiffuse` inside the room
 *   boxes (1 in the editing modes, 0 while baking and in walk and tour) and
 *   left on outside them, so facades and the ground keep the editing look;
 * - inside a room with the environment's diffuse off, the room grid's
 *   irradiance takes the environment's place in three's image-based path, so
 *   rough metals keep their multiple-scattering energy and nothing is counted
 *   twice;
 * - direct light from the directional lights (the sun; the fill is off in
 *   walk) is scaled by `jeexSun` inside the room boxes: 1 in the editing and
 *   capture states, the walk sun factor in walk and tour, so a sunlit floor
 *   keeps its texture under the walk exposure while facades keep their sun;
 * - with `jeexBoxProbes` on (walk and tour), specular and clearcoat
 *   reflections come from the room probes in one shared atlas, box-projected
 *   onto the room box chosen per fragment (lookup point pushed along the
 *   normal), blended across `blendM` at a shared box face; a fragment of the
 *   band that lies beyond a box never ends a ray on the face it stands
 *   outside when the ray leaves through it (at an open boundary that face is
 *   no surface, and projecting onto it put a bright ridge along the
 *   boundary), while a ray heading back into the box still ends on the far
 *   wall; a fragment outside
 *   every room reflects the studio environment. The anisotropy and
 *   retroreflection branches keep the studio environment;
 * - on a baked surface (`JEEX_BAKED_SURFACE`, `render/baked-surface.ts`)
 *   the grid is not sampled, the grid hand-over is off and the environment
 *   diffuse scale is 1; its lightmap is indirect light and never takes the
 *   interior sun factor. The baked policy reads `jeexInRoom` where the
 *   room is located (`JEEX_MAX_BOXES` defined) to pick its gain.
 *
 * Invariant: with `jeexDiffuse` 1, `jeexSun` 1 and `jeexBoxProbes` 0 the output of a
 * material that is not baked equals the unpatched shader's (pinned in `tests/component/walk-lighting.test.ts`), and
 * switching the uniforms never recompiles: the program key is constant.
 *
 * The chunk texts it rewrites are pinned by `ENGINE_CHUNK_ANCHORS`; the
 * lighting standard already refuses any other three.js revision.
 */

import * as THREE from 'three';
import { addShaderTransform, chunkMarker, expandOwnedChunks, replaceAnchor, WALK_TRANSFORM_ID } from '../shader-compose.js';
import type { RoomBox, RoomProbe } from './room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';

/** The patch's transform: one program variant, whatever the state; the version changes with the shader text. */
export const WALK_TRANSFORM = Object.freeze({ id: WALK_TRANSFORM_ID, version: 4 });
/** Edge of an atlas tile: the PMREM layout of a 128 px cube (and of the studio environment). */
export const TILE = Object.freeze({ width: 384, height: 512 });
/** The largest mip of a probe's cube-UV layout: `log2(TILE.height) - 2`, as three derives `CUBEUV_MAX_MIP`. */
const PROBE_MAX_MIP = Math.log2(TILE.height) - 2;
/** Tiles per atlas column. */
const ROWS_MAX = 8;

/** The exact r186 lines the patch replaces, per chunk. */
export const ENGINE_CHUNK_ANCHORS = Object.freeze({
  lights_fragment_begin: [
    'irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );',
    'DirectionalLight directionalLight;',
    'getDirectionalLightInfo( directionalLight, directLight );',
  ],
  lights_fragment_maps: [
    'iblIrradiance += getIBLIrradiance( geometryNormal );',
    'vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
    'clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );',
  ],
  cube_uv_reflection_fragment: [
    'highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;',
    'uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );',
  ],
} as const);

/** The uniforms every patched material shares. */
export type WalkUniforms = {
  jeexDiffuse: { value: number };
  /** What light outside the rooms is scaled by: the inverse of the walk exposure in walk, so facades keep the editing look. */
  jeexOutside: { value: number };
  /** What direct sunlight inside the rooms is scaled by: the walk sun factor in walk, 1 otherwise. */
  jeexSun: { value: number };
  /** The brightest channel an emissive term may reach, in shader units: the walk cap over the walk exposure in walk and capture, unbounded otherwise. */
  jeexEmissiveCap: { value: number };
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
    jeexOutside: { value: 1 },
    jeexSun: { value: 1 },
    jeexEmissiveCap: { value: UNCAPPED },
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

const SCENE_UNIFORMS = new WeakMap<object, WalkUniforms>();

/**
 * The uniforms of one scene, the same object for every room lighting built on
 * it. A patched material keeps the uniforms it was compiled with, and a
 * material may outlive a lighting (a context restore builds a new lighting
 * over materials a host's model source kept), so the uniforms must outlive it
 * too.
 */
export function walkUniformsFor(scene: object): WalkUniforms {
  let uniforms = SCENE_UNIFORMS.get(scene);
  if (!uniforms) {
    uniforms = createWalkUniforms();
    SCENE_UNIFORMS.set(scene, uniforms);
  }
  return uniforms;
}

/** Puts the uniforms in one of the rig's states. */
export function setUniformState(uniforms: WalkUniforms, state: UniformState): void {
  uniforms.jeexDiffuse.value = state === 'editing' ? 1 : 0;
  uniforms.jeexBoxProbes.value = state === 'walk' ? 1 : 0;
  uniforms.jeexOutside.value = state === 'walk' ? 1 / T.walkExposure : 1;
  uniforms.jeexSun.value = state === 'walk' ? T.walkSunScale : 1;
  // Captures record what walk shows: a probe sees the capped shade too.
  uniforms.jeexEmissiveCap.value = state === 'editing' ? UNCAPPED : T.walkEmissiveCap / T.walkExposure;
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
// The atlas's own largest mip, whatever size the scene's environment is (an HDRI is larger than the studio's).
#define JEEX_PROBE_MAX_MIP ${PROBE_MAX_MIP}.0
uniform float jeexDiffuse;
uniform float jeexOutside;
uniform float jeexSun;
uniform float jeexEmissiveCap;
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
	uv.y += 4.0 * ( exp2( JEEX_PROBE_MAX_MIP ) - faceSize );
	uv = ( uv + tile ) * jeexAtlasTexel;
	#ifdef texture2DGradEXT
		return texture2DGradEXT( jeexAtlas, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
	#else
		return texture2D( jeexAtlas, uv ).rgb;
	#endif
}

vec3 jeexProbeSample( vec3 direction, float roughness, vec2 tile ) {
	float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, JEEX_PROBE_MAX_MIP );
	float mipF = fract( mip );
	float mipInt = floor( mip );
	vec3 lower = jeexBilinear( direction, mipInt, tile );
	if ( mipF == 0.0 ) return lower;
	return mix( lower, jeexBilinear( direction, mipInt + 1.0, tile ), mipF );
}

vec3 jeexRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
	vec3 studio = getIBLRadiance( viewDir, normal, roughness );
	if ( jeexBoxProbes < 0.5 || jeexInRoom < 0.5 ) return studio;
	vec3 reflectVec = reflect( - viewDir, normal );
	reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
	reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
	// A hair off zero, so a ray along an axis never divides zero by zero.
	vec3 reciprocal = 1.0 / ( reflectVec + vec3( 1e-6 ) );
	vec3 sum = vec3( 0.0 );
	float total = 0.0;
	for ( int i = 0; i < JEEX_MAX_BOXES; i ++ ) {
		if ( i >= jeexBoxCount ) break;
		float weight = smoothstep( - jeexBlend, jeexBlend, jeexInside( jeexLookup, i ) );
		if ( weight <= 0.0 ) continue;
		vec3 from = clamp( jeexWorldPos, jeexBoxMin[ i ], jeexBoxMax[ i ] );
		vec3 exits = max( ( jeexBoxMax[ i ] - from ) * reciprocal, ( jeexBoxMin[ i ] - from ) * reciprocal );
		// A fragment in the blend band beyond this box (an open boundary) is clamped onto the box's face. A ray
		// that leaves through that face at once (exit ~0) sees no surface there and exits through the others;
		// a ray heading back into the box keeps its real exit, the far wall.
		exits += step( 1e-4, abs( jeexWorldPos - from ) ) * step( exits, vec3( 1e-4 ) ) * 1e4;
		float travel = max( min( min( exits.x, exits.y ), exits.z ), 0.0 );
		vec3 direction = from + reflectVec * travel - jeexProbe[ i ];
		sum += weight * jeexProbeSample( direction, roughness, jeexTile[ i ] );
		total += weight;
	}
	return total > 0.0 ? sum / total : studio;
}
#endif
`;

/**
 * Locates the fragment's room once, ahead of the begin chunk, for the sun
 * factor, the baked policy and the maps chunk alike. The begin chunk's
 * `geometryPosition` and `geometryNormal` are these same two values,
 * declared inside it.
 */
const LOCATE = /* glsl */ `vec3 jeexGridIrradiance = vec3( 0.0 );
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	jeexLocate( - vViewPosition, normal );
#endif
`;

/** The sun factor inside the rooms, declared where the directional loop needs it; 1 without a room lookup. */
const SUN_SCALE = /* glsl */ `DirectionalLight directionalLight;
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	float jeexSunScale = mix( 1.0, jeexSun, jeexInRoom );
	#else
	float jeexSunScale = 1.0;
	#endif`;

/** The grid's irradiance kept apart in `jeexGridIrradiance`; a baked surface does not sample the grid. */
const GRID = /* glsl */ `#ifndef JEEX_BAKED_SURFACE
		jeexGridIrradiance = getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
		irradiance += jeexGridIrradiance;
		#endif`;

/** The environment's diffuse scale inside the rooms; 1 on a baked surface, whose specular multiple scattering needs it whole. */
const DIFFUSE_SCALE = /* glsl */ `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && ! defined( JEEX_BAKED_SURFACE )
	float jeexDiffuseScale = mix( 1.0, jeexDiffuse, jeexInRoom );
#else
	float jeexDiffuseScale = 1.0;
#endif
`;

/** The grid hand-over after the maps chunk: inside a room with the environment's diffuse off, the grid takes its place. */
const HAND_OVER = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && defined( RE_IndirectDiffuse ) && defined( USE_LIGHT_PROBES_GRID ) && defined( STANDARD ) && ! defined( JEEX_BAKED_SURFACE )
	float jeexMove = jeexInRoom * ( 1.0 - jeexDiffuse );
	iblIrradiance += jeexGridIrradiance * jeexMove;
	irradiance -= jeexGridIrradiance * jeexMove;
#endif`;

/** A radiance line through the room probes where the atlas exists, three's own elsewhere. */
const viaProbes = (line: string, probes: string): string => `#if defined( ENVMAP_TYPE_CUBE_UV )
		${probes}
		#else
		${line}
		#endif`;

/** The begin chunk, expanded by the composer: the room located ahead of it, the grid kept apart, the sun scaled. */
function rewriteBegin(text: string): string {
  const [grid, declare, directional] = ENGINE_CHUNK_ANCHORS.lights_fragment_begin;
  const begin = chunkMarker('lights_fragment_begin', 'begin');
  let out = replaceAnchor(text, begin, LOCATE + begin, WALK_TRANSFORM_ID);
  out = replaceAnchor(out, grid, GRID, WALK_TRANSFORM_ID);
  out = replaceAnchor(out, declare, SUN_SCALE, WALK_TRANSFORM_ID);
  return replaceAnchor(out, directional, `${directional}\n\t\tdirectLight.color *= jeexSunScale;`, WALK_TRANSFORM_ID);
}

/** The maps chunk, expanded by the composer: the switches, then the grid hand-over. */
function rewriteMaps(text: string): string {
  const [diffuse, specular, clearcoat] = ENGINE_CHUNK_ANCHORS.lights_fragment_maps;
  const begin = chunkMarker('lights_fragment_maps', 'begin');
  const end = chunkMarker('lights_fragment_maps', 'end');
  let out = replaceAnchor(text, begin, DIFFUSE_SCALE + begin, WALK_TRANSFORM_ID);
  out = replaceAnchor(out, diffuse, 'iblIrradiance += getIBLIrradiance( geometryNormal ) * jeexDiffuseScale;', WALK_TRANSFORM_ID);
  out = replaceAnchor(
    out,
    specular,
    viaProbes(specular, 'vec3 iblRadiance = jeexRadiance( geometryViewDir, geometryNormal, material.roughness );'),
    WALK_TRANSFORM_ID,
  );
  out = replaceAnchor(
    out,
    clearcoat,
    viaProbes(clearcoat, 'clearcoatRadiance += jeexRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );'),
    WALK_TRANSFORM_ID,
  );
  return replaceAnchor(out, end, end + HAND_OVER, WALK_TRANSFORM_ID);
}

/** Light outside the rooms scaled against the walk exposure, just before three writes the fragment. */
const OUTSIDE = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	outgoingLight *= mix( jeexOutside, 1.0, jeexInRoom );
#endif
#include <opaque_fragment>`;

/**
 * The fragment shader of a standard or physical material with the walk patch
 * applied; owned chunks still included are expanded first, so the composer's
 * expanded text and a raw shader both work.
 */
export function patchFragmentShader(source: string): string {
  let out = guardBumpNormal(expandOwnedChunks(source));
  out = replaceAnchor(out, '#include <opaque_fragment>', OUTSIDE, WALK_TRANSFORM_ID);
  const emissive = '#include <emissivemap_fragment>';
  out = replaceAnchor(out, emissive, `${emissive}${EMISSIVE_CAP}`, WALK_TRANSFORM_ID);
  const pars = '#include <envmap_physical_pars_fragment>';
  out = replaceAnchor(out, pars, `${pars}\n${PARS}`, WALK_TRANSFORM_ID);
  return rewriteMaps(rewriteBegin(out));
}

/** The line of three r186's bump perturbation that normalises the perturbed normal. */
const BUMP_NORMALISE = 'return normalize( abs( fDet ) * surf_norm - vGrad );';

/**
 * `source` with three's bump-map perturbation guarded: where the screen
 * derivatives vanish (the edge pixels of a cube face on a software
 * rasteriser), the perturbed normal is the zero vector and three normalised
 * it into NaN, which a reflection probe's prefilter then spread over the
 * whole probe; the guard keeps the surface normal there instead. A shader
 * without a bump map is left alone; a three whose chunk lost the line fails
 * loudly.
 */
export function guardBumpNormal(source: string): string {
  const include = '#include <bumpmap_pars_fragment>';
  if (!source.includes(include)) return source;
  const chunk = THREE.ShaderChunk.bumpmap_pars_fragment;
  const guarded = replaceAnchor(
    chunk,
    BUMP_NORMALISE,
    'vec3 jeexBumped = abs( fDet ) * surf_norm - vGrad;\n\t\treturn dot( jeexBumped, jeexBumped ) > 1e-20 ? normalize( jeexBumped ) : surf_norm;',
    WALK_TRANSFORM_ID,
  );
  return source.replace(include, () => guarded);
}

/** The emissive cap outside walk and capture: no material reaches it. */
const UNCAPPED = 1e9;

/**
 * Caps the emissive term's brightest channel at `jeexEmissiveCap`, keeping its
 * chroma; a term under the cap passes as it is.
 */
const EMISSIVE_CAP = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	totalEmissiveRadiance *= min( 1.0, jeexEmissiveCap / max( max( totalEmissiveRadiance.r, totalEmissiveRadiance.g ), max( totalEmissiveRadiance.b, 1e-6 ) ) );
#endif`;

const PATCHED = Symbol('jeex-walk-patch');
type Patchable = THREE.MeshStandardMaterial & { [PATCHED]?: true };

/**
 * Patches every standard and physical material under `root` that is not
 * patched yet, through the shader composer; answers how many it patched. A
 * patched material gets a new version, so one compiled before is compiled
 * again with the patch. A copy whose copied hooks already carry the patch
 * counts as patched without a recompile.
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
      addShaderTransform(target, WALK_TRANSFORM.id, WALK_TRANSFORM.version, (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = patchFragmentShader(shader.fragmentShader);
      });
      count += 1;
    }
  });
  return count;
}
