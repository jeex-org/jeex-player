/**
 * The walk lighting's shader patch: one shader transform (`WALK_TRANSFORM`,
 * registered through `render/shader-compose.ts`) on every standard and
 * physical material, with one program key, driven by uniforms every patched
 * material shares. It rewrites the composer's expanded lighting chunks.
 *
 * What it changes in three r187's lighting chunks:
 * - the environment's diffuse term is scaled by `jeexDiffuse` inside the room
 *   boxes (1 in the editing modes, 0 while baking and in walk and tour) and
 *   left on outside them, so facades and the ground keep the editing look;
 * - with the grids on (`jeexGridOn`: walk, tour and the bake's captures), the
 *   fragment's irradiance gains the light-probe grid of the room box its
 *   lookup point lies in, read from the packed grid atlas (`room-grid.ts`),
 *   or the exterior block outside every box; inside a room with the
 *   environment's diffuse off, that irradiance takes the environment's place
 *   in three's image-based path, so rough metals keep their
 *   multiple-scattering energy and nothing is counted twice;
 * - direct light from the directional lights (the sun; the fill is off in
 *   walk) is scaled by `jeexSun` inside the room boxes: 1 in the editing and
 *   capture states, the walk sun factor in walk and tour, so a sunlit floor
 *   keeps its texture under the walk exposure while facades keep their sun;
 * - with `jeexBoxProbes` on (walk and tour), specular and clearcoat
 *   reflections come from the room probes in one 2D array (six faces a
 *   room, each with a one-texel border, `room-probes.ts`), box-projected
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
 * lighting standard already refuses any other three.js revision. The patch
 * runs where three r187 samples a PMREM (`ENVMAP_TYPE_PMREM`), and defines
 * `JEEX_GRIDS` there for its own grid lookup.
 */

import * as THREE from 'three';
import { addShaderTransform, chunkMarker, expandOwnedChunks, replaceAnchor, WALK_TRANSFORM_ID } from '../shader-compose.js';
import type { RoomBox, RoomProbe } from './room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';
import { installLightDrawHook, LIGHT_UNIFORMS } from '../light-uniforms.js';

/** The patch's transform: one program variant, whatever the state; the version changes with the shader text. */
export const WALK_TRANSFORM = Object.freeze({ id: WALK_TRANSFORM_ID, version: 8 });
/**
 * The last level of a room probe's PMREM: three r187 prefilters a probe into a
 * cube of at least 256 texels a face with mips down to 8 texels, and the probe
 * array holds its levels 0 to 5 at half their size (`room-probes.ts`).
 */
export const PROBE_PMREM_MAX_LOD = 5;
/** Levels of the probe array. */
const PROBE_LEVELS = PROBE_PMREM_MAX_LOD + 1;
/**
 * The mirror end of the probe's roughness-to-level mapping: at and below this
 * roughness a reflection reads the probe's mirror level alone. It is r186's
 * minimum roughness, the higher of the two engines' floors (r187's is 0.045),
 * so a mirror finish keeps the sharp window image three r186 gave it.
 */
export const PROBE_MIRROR_ROUGHNESS = 0.0525;
/** Where the mirror end hands over to three r187's own mapping, which holds unchanged above it. */
export const PROBE_HANDOVER_ROUGHNESS = 0.1;

/**
 * The probe's roughness-to-level mapping, `jeexProbeMip`: three r187's
 * `roughnessToMip` over the probe's own levels, whatever size the scene's
 * environment is (an HDRI is larger than the studio's), except at the mirror
 * end. Three's mapping turns its minimum roughness into level 0.44, a blend
 * of the mirror level with the next (roughness 0.106), which softens a
 * mirror's window image; below `PROBE_HANDOVER_ROUGHNESS` three's level is
 * scaled by a smoothstep from 0 at `PROBE_MIRROR_ROUGHNESS` to 1 at the
 * hand-over, so the read reaches level 0 without a step in value or slope.
 */
export const PROBE_MIP_GLSL = /* glsl */ `
float jeexProbeMip( const in float roughness ) {
	float r = clamp( roughness, 0.0, 1.0 );
	float mip = ${PROBE_PMREM_MAX_LOD}.0 * r * ( 2.0 - r );
	if ( r < ${PROBE_HANDOVER_ROUGHNESS} ) mip *= smoothstep( ${PROBE_MIRROR_ROUGHNESS}, ${PROBE_HANDOVER_ROUGHNESS}, r );
	return clamp( mip, 0.0, ${PROBE_LEVELS - 1}.0 );
}
`;

/** The exact r187 lines the patch replaces or anchors on, per chunk. */
export const ENGINE_CHUNK_ANCHORS = Object.freeze({
  lights_fragment_begin: [
    '#if NUM_LIGHT_PROBE_GRIDS > 0',
    'DirectionalLight directionalLight;',
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
  ],
  lights_fragment_maps: [
    'iblIrradiance += getIBLIrradiance( geometryNormal );',
    'vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
    'clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );',
  ],
  envmap_common_pars_fragment: ['return ENVMAP_MAX_LOD * r * ( 2.0 - r );'],
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
  /** The room probes' array: six layers a room (`room-probes.ts`). */
  jeexProbes: { value: THREE.Texture };
  /** 1 while the grids light the scene (walk, tour, the bake's bounce and the probe captures), 0 otherwise. */
  jeexGridOn: { value: number };
  /** The packed grid atlas (`room-grid.ts`). */
  jeexGrids: { value: THREE.Texture };
  /** Per room box, then the exterior: the grid volume's minimum and its block's x origin in the atlas. */
  jeexGridMin: { value: THREE.Vector4[] };
  /** Per room box, then the exterior: the grid volume's maximum and its block's y origin in the atlas. */
  jeexGridMax: { value: THREE.Vector4[] };
  /** Per room box, then the exterior: probes along each axis. */
  jeexGridRes: { value: THREE.Vector3[] };
  /** The packed atlas's size, texels. */
  jeexGridSize: { value: THREE.Vector3 };
  jeexBlend: { value: number };
  jeexPush: { value: number };
  /** 1 while walk or tour shows the room lighting or bakes it (the lamp gate on), 0 in the editing modes. */
  jeexLampScope: { value: number };
  /** The room of each box: its index in the probe order, shared by every box of the room. */
  jeexBoxRoom: { value: number[] };
};

/** The rig's three uniform states: editing look, bake capture, walk look. */
export type UniformState = 'editing' | 'capture' | 'walk';

const vectors = (): THREE.Vector3[] => Array.from({ length: T.maxBoxes }, () => new THREE.Vector3());

/** A black one-texel array the probe sampler holds until the probes exist. */
function probePlaceholder(): THREE.Texture {
  const texture = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/** A black one-texel 3D texture the grid sampler holds until the grids exist. */
function gridPlaceholder(): THREE.Texture {
  const texture = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/** One entry per room box and one for the exterior block. */
const GRID_ENTRIES = T.maxBoxes + 1;

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
    jeexProbes: { value: probePlaceholder() },
    jeexGridOn: { value: 0 },
    jeexGrids: { value: gridPlaceholder() },
    jeexGridMin: { value: Array.from({ length: GRID_ENTRIES }, () => new THREE.Vector4()) },
    jeexGridMax: { value: Array.from({ length: GRID_ENTRIES }, () => new THREE.Vector4()) },
    jeexGridRes: { value: Array.from({ length: GRID_ENTRIES }, () => new THREE.Vector3(1, 1, 1)) },
    jeexGridSize: { value: new THREE.Vector3(1, 1, 1) },
    jeexBlend: { value: T.blendM / 2 },
    jeexPush: { value: T.normalPushM },
    jeexLampScope: { value: 0 },
    jeexBoxRoom: { value: Array.from({ length: T.maxBoxes }, () => -1) },
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

const put = (target: THREE.Vector3, p: { x: number; y: number; z: number }): THREE.Vector3 => target.set(p.x, p.y, p.z);

/** Fills the box arrays: each box with its room's probe point and room index (its probe layers start at six times it). */
export function setRoomBoxes(uniforms: WalkUniforms, boxes: readonly RoomBox[], probes: readonly RoomProbe[]): void {
  const index = new Map(probes.map((probe, i) => [probe.roomId, i]));
  boxes.forEach((box, i) => {
    const probe = index.get(box.roomId) ?? 0;
    put(uniforms.jeexSelMin.value[i]!, box.selection.min);
    put(uniforms.jeexSelMax.value[i]!, box.selection.max);
    put(uniforms.jeexBoxMin.value[i]!, box.projection.min);
    put(uniforms.jeexBoxMax.value[i]!, box.projection.max);
    put(uniforms.jeexProbe.value[i]!, probes[probe]!.position);
    uniforms.jeexBoxRoom.value[i] = probe;
  });
  uniforms.jeexBoxCount.value = boxes.length;
}

const PARS = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
#define JEEX_MAX_BOXES ${T.maxBoxes}
#define JEEX_GRIDS
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
uniform highp sampler2DArray jeexProbes;
uniform float jeexGridOn;
uniform highp sampler3D jeexGrids;
uniform vec4 jeexGridMin[ JEEX_MAX_BOXES + 1 ];
uniform vec4 jeexGridMax[ JEEX_MAX_BOXES + 1 ];
uniform vec3 jeexGridRes[ JEEX_MAX_BOXES + 1 ];
uniform vec3 jeexGridSize;
uniform float jeexBlend;
uniform float jeexPush;
uniform float jeexLampScope;
uniform float jeexBoxRoom[ JEEX_MAX_BOXES ];
#if NUM_POINT_LIGHTS > 0
uniform float jeexPointRoom[ NUM_POINT_LIGHTS ];
#endif
vec3 jeexWorldPos = vec3( 0.0 );
vec3 jeexLookup = vec3( 0.0 );
vec3 jeexPushDir = vec3( 0.0 );
float jeexInRoom = 0.0;
// The receiver's room (-1 outside every box) and how far inside it the point pushed once more lies.
float jeexRoom = -1.0;
float jeexAhead = 0.0;
// The room box that owns the receiver (-1 outside every box): its grid lights the fragment.
int jeexBox = -1;

float jeexInside( const in vec3 p, const in int i ) {
	vec3 d = min( p - jeexSelMin[ i ], jeexSelMax[ i ] - p );
	return min( min( d.x, d.y ), d.z );
}

void jeexLocate( const in vec3 viewPosition, const in vec3 viewNormal ) {
	jeexWorldPos = ( ( vec4( viewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
	jeexPushDir = transformNormalByInverseViewMatrix( viewNormal, viewMatrix );
	jeexLookup = jeexWorldPos + jeexPushDir * jeexPush;
	jeexInRoom = 0.0;
	jeexRoom = -1.0;
	jeexAhead = 0.0;
	jeexBox = -1;
	for ( int i = 0; i < JEEX_MAX_BOXES; i ++ ) {
		if ( i >= jeexBoxCount ) break;
		if ( jeexInside( jeexLookup, i ) > 0.0 ) jeexInRoom = 1.0;
		// The receiver's room: boundaries included; where boxes of several rooms hold the point, the room the
		// face points into (deeper inside once pushed again) owns it, and the lower room index on a tie.
		float d = jeexInside( jeexLookup, i );
		if ( d >= 0.0 ) {
			float ahead = jeexInside( jeexLookup + jeexPushDir * jeexPush, i );
			if ( jeexRoom < 0.0 || ahead > jeexAhead || ( ahead == jeexAhead && jeexBoxRoom[ i ] < jeexRoom ) ) {
				jeexRoom = jeexBoxRoom[ i ];
				jeexAhead = ahead;
				jeexBox = i;
			}
		}
	}
}

// A point light's direct term on this fragment: whole for a light that is not a lamp or outside walk and tour,
// otherwise only when the lamp's source room is the fragment's room (-2, a lamp in no room, lights nothing).
float jeexLampGate( const in float room ) {
	if ( jeexLampScope < 0.5 || ( room < -0.5 && room > -1.5 ) ) return 1.0;
	return ( room > -0.5 && abs( room - jeexRoom ) < 0.5 ) ? 1.0 : 0.0;
}

// A direction's cube face (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z) and its point on that face's plane, each
// coordinate in [-1, 1]; the probe array's copy pass writes the faces with the same parameterisation.
float jeexFace( const in vec3 d, out vec2 st ) {
	vec3 a = abs( d );
	if ( a.x >= a.y && a.x >= a.z ) {
		st = d.zy / a.x;
		return d.x > 0.0 ? 0.0 : 1.0;
	}
	if ( a.y >= a.z ) {
		st = d.xz / a.y;
		return d.y > 0.0 ? 2.0 : 3.0;
	}
	st = d.xy / a.z;
	return d.z > 0.0 ? 4.0 : 5.0;
}

// One level of a room's probe: the face's interior is its inner ( faceSize - 2 ) texels, so a bilinear read at a
// face edge takes the one-texel border, which holds the neighbouring face's light.
vec3 jeexProbeLevel( const in vec3 direction, const in float level, const in float layers ) {
	vec2 st;
	float face = jeexFace( direction, st );
	float faceSize = exp2( 7.0 - level );
	vec2 uv = ( ( st * 0.5 + 0.5 ) * ( faceSize - 2.0 ) + 1.0 ) / faceSize;
	return textureLod( jeexProbes, vec3( uv, layers + face ), level ).rgb;
}

${PROBE_MIP_GLSL}
// A probe reflection at the level its roughness maps to; array level k holds PMREM level k.
vec3 jeexProbeSample( const in vec3 direction, const in float roughness, const in float layers ) {
	float mip = jeexProbeMip( roughness );
	float mipF = fract( mip );
	float mipInt = floor( mip );
	vec3 lower = jeexProbeLevel( direction, mipInt, layers );
	if ( mipF == 0.0 ) return lower;
	return mix( lower, jeexProbeLevel( direction, mipInt + 1.0, layers ), mipF );
}

// The irradiance of grid entry g of the packed atlas, as three r187's getLightProbeGridIrradiance computes it:
// sampled half a cell along the normal, clamped to the outermost probes, the seven SH sub-volumes stacked
// along y in the grid's block, each with a one-texel border.
vec3 jeexGridIrradianceAt( const in int g, const in vec3 worldPos, const in vec3 worldNormal ) {
	vec3 lo = jeexGridMin[ g ].xyz;
	vec3 res = jeexGridRes[ g ];
	vec3 range = jeexGridMax[ g ].xyz - lo;
	vec3 samplePos = worldPos + worldNormal * ( range / res ) * 0.5;
	vec3 cell = clamp( ( samplePos - lo ) / range, 0.5 / res, 1.0 - 0.5 / res ) * res;
	vec3 base = vec3( jeexGridMin[ g ].w + 1.0, jeexGridMax[ g ].w + 1.0, 1.0 ) + cell;
	vec3 rowStep = vec3( 0.0, res.y + 2.0, 0.0 );
	vec4 s0 = texture( jeexGrids, base / jeexGridSize );
	vec4 s1 = texture( jeexGrids, ( base + rowStep ) / jeexGridSize );
	vec4 s2 = texture( jeexGrids, ( base + 2.0 * rowStep ) / jeexGridSize );
	vec4 s3 = texture( jeexGrids, ( base + 3.0 * rowStep ) / jeexGridSize );
	vec4 s4 = texture( jeexGrids, ( base + 4.0 * rowStep ) / jeexGridSize );
	vec4 s5 = texture( jeexGrids, ( base + 5.0 * rowStep ) / jeexGridSize );
	vec4 s6 = texture( jeexGrids, ( base + 6.0 * rowStep ) / jeexGridSize );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}

// The grids' irradiance on the receiver: its room box's grid, the exterior block outside every box.
vec3 jeexGridLight( ) {
	if ( jeexGridOn < 0.5 ) return vec3( 0.0 );
	return jeexGridIrradianceAt( jeexBox >= 0 ? jeexBox : JEEX_MAX_BOXES, jeexWorldPos, jeexPushDir );
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
		sum += weight * jeexProbeSample( direction, roughness, jeexBoxRoom[ i ] * 6.0 );
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
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
	jeexLocate( - vViewPosition, normal );
#endif
`;

/** The sun factor inside the rooms, declared where the directional loop needs it; 1 without a room lookup. */
const SUN_SCALE = /* glsl */ `DirectionalLight directionalLight;
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
	float jeexSunScale = mix( 1.0, jeexSun, jeexInRoom );
	#else
	float jeexSunScale = 1.0;
	#endif`;

/**
 * The grids' irradiance kept apart in `jeexGridIrradiance`, ahead of three's
 * own grid block (never compiled: no grid is in the scene); a baked surface
 * does not sample the grids.
 */
const GRID = /* glsl */ `#if defined( JEEX_GRIDS ) && ! defined( JEEX_BAKED_SURFACE )
	jeexGridIrradiance = jeexGridLight( );
	irradiance += jeexGridIrradiance;
	#endif
	`;

/** The environment's diffuse scale inside the rooms; 1 on a baked surface, whose specular multiple scattering needs it whole. */
const DIFFUSE_SCALE = /* glsl */ `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM ) && ! defined( JEEX_BAKED_SURFACE )
	float jeexDiffuseScale = mix( 1.0, jeexDiffuse, jeexInRoom );
#else
	float jeexDiffuseScale = 1.0;
#endif
`;

/** The grid hand-over after the maps chunk: inside a room with the environment's diffuse off, the grid takes its place. */
const HAND_OVER = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM ) && defined( RE_IndirectDiffuse ) && defined( JEEX_GRIDS ) && defined( STANDARD ) && ! defined( JEEX_BAKED_SURFACE )
	float jeexMove = jeexInRoom * ( 1.0 - jeexDiffuse );
	iblIrradiance += jeexGridIrradiance * jeexMove;
	irradiance -= jeexGridIrradiance * jeexMove;
#endif`;

/** A radiance line through the room probes where the atlas exists, three's own elsewhere. */
const viaProbes = (line: string, probes: string): string => `#if defined( ENVMAP_TYPE_PMREM )
		${probes}
		#else
		${line}
		#endif`;

/** The lamp gate, right after three computes a point light's term and before it is applied. */
const LAMP_GATE = /* glsl */ `
		#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
		directLight.color *= jeexLampGate( jeexPointRoom[ i ] );
		#endif`;

/** The begin chunk, expanded by the composer: the room located ahead of it, the grid kept apart, the sun scaled, lamps gated by room. */
function rewriteBegin(text: string): string {
  const [grid, declare, directional, point] = ENGINE_CHUNK_ANCHORS.lights_fragment_begin;
  const begin = chunkMarker('lights_fragment_begin', 'begin');
  let out = replaceAnchor(text, begin, LOCATE + begin, WALK_TRANSFORM_ID);
  out = replaceAnchor(out, grid, GRID + grid, WALK_TRANSFORM_ID);
  out = replaceAnchor(out, declare, SUN_SCALE, WALK_TRANSFORM_ID);
  out = replaceAnchor(out, point, point + LAMP_GATE, WALK_TRANSFORM_ID);
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
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
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

/** The line of three r187's bump perturbation that normalises the perturbed normal. */
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
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
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
        Object.assign(shader.uniforms, uniforms, { jeexPointRoom: LIGHT_UNIFORMS.jeexPointRoom });
        shader.fragmentShader = patchFragmentShader(shader.fragmentShader);
      });
      installLightDrawHook(target);
      count += 1;
    }
  });
  return count;
}
