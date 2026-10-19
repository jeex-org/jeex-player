/**
 * Selection highlight for furniture: a drifting iridescent **haze** around the object — mist, not
 * a shell. Nothing about it may read as a surface: no crisp outline, no uniform film, no bands.
 *
 * The maths — the gradient, the breathing and fade curves, and the envelope geometry (padding,
 * merging, rounding) — lives in `selection-glow-math.ts`, pure and unit-tested on its own; this
 * file is the Three.js SHELL: it turns that maths into a shader material and a group of meshes,
 * and owns their lifetime. Public surface: `GLOW_GROUP_NAME`, `createSelectionGlow`,
 * `beginSelectionGlowFadeOut`, `updateSelectionGlow`, `disposeSelectionGlow`, `SelectionGlow`.
 *
 * Rendering. Each envelope is one proxy box (12 triangles) grown to cover the feathered field. The
 * fragment shader takes the view ray, intersects the proxy analytically, and marches `HAZE_STEPS`
 * samples through the rounded-box density field, accumulating optical depth and turning it into
 * alpha with Beer-Lambert. Because the marched field is smooth, the alpha falls off continuously in
 * every direction — this is what removes the hard silhouette a Fresnel shell always leaves on a
 * box. A ray that runs through the object's own merged boxes is dimmed to `HAZE_VEIL` — by how far
 * it travels inside them, never by a hit test, so the aura thins to a light veil over the furniture
 * and piles up into a halo around its silhouette without the bounding box ever showing as an edge.
 * Nothing about the aura depends on the depth of its own back face, which is what stops a wall
 * behind the object from slicing the haze along a straight line. The proxy is double-sided and the
 * shader keeps exactly one of its two surfaces, so the aura survives the camera walking inside it.
 *
 * Density. Every march sample is modulated by hash-based value noise in world space, drifting
 * upwards with time (`HAZE_NOISE_SCALE`, `HAZE_NOISE_SPEED`, `HAZE_DENSITY`), so the mist thins and
 * thickens through its own depth like smoke instead of wearing a pattern on one surface. A second,
 * far slower noise field (`DRIFT_GAIN`, `DRIFT_SPEED`) wanders over it as a soft brightening, with
 * no visible stripe. A screen-space dither jitters
 * the march so ten steps never band.
 *
 * On top of that: a cyclic blue -> cyan -> violet gradient, a slow breath on intensity and
 * envelope scale, and an eased fade in on select / fade out on deselect (`FADE_IN_SECONDS`,
 * `FADE_OUT_SECONDS`).
 *
 * Invariant: the glow material is only ever applied to meshes owned by the glow group
 * (`GLOW_GROUP_NAME`); furniture meshes and their materials are never touched.
 */

import * as THREE from 'three';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './selection-glow-shader.js';
import {
  AURA_MAX_PARTS,
  AURA_MIN_EXTENT,
  AURA_PADDING,
  AXES,
  BREATH_DEPTH,
  BREATH_SPEED,
  DRIFT_GAIN,
  GLOW_COLORS,
  HAZE_ABSORPTION,
  HAZE_DENSITY,
  HAZE_EDGE_SOFTNESS,
  HAZE_NOISE_SCALE,
  HAZE_NOISE_SPEED,
  HAZE_PEAK_OPACITY,
  HAZE_STEPS,
  MIN_SWEEP_LENGTH,
  auraCornerRadiusFor,
  auraEnvelopeFor,
  breathScaleAt,
  fadeEase,
  fadeProgress,
  fadeScaleAt,
  hazeProxySize,
  reduceAuraBoxes,
  sweepLengthFor,
  type AuraBox,
  type AuraEnvelope,
  type Vec3Tuple,
} from './selection-glow-math.js';

/** Fraction of the mist that survives on a view ray that runs through the furniture. Well under 1:
 * a halo around the silhouette reads as an aura, the same density over the object reads as fog. */
const HAZE_VEIL = 0.1;
/**
 * Metres of furniture a ray must cross before it is fully veiled. It has to be generous: a sharp
 * hand-over would trace the object's *bounding box* across empty space, which is the one straight
 * line this effect must never draw.
 */
const HAZE_OCCLUSION_SOFTNESS = 0.18;
/** Speed of the slow wandering brightening, in noise-space units per second. */
const DRIFT_SPEED = 0.14;
/** Gradient rotations per second. */
const HUE_SPEED = 0.1;
/** Gradient cycles per sweep length. */
const HUE_SCALE = 0.35;
/** Extra brightness applied to the premultiplied colour so the haze blooms rather than greys. */
const BLOOM_BOOST = 1.15;
/** Seconds the aura takes to grow in after a selection. */
const FADE_IN_SECONDS = 0.42;
/** Seconds the aura takes to dissolve after a deselection, before the envelopes are disposed. */
const FADE_OUT_SECONDS = 0.34;
/**
 * How close to its own pivot plane an object must sit to count as standing on the floor. A
 * floor-standing object's core is clamped to that plane, so the haze pools around its base
 * instead of sinking under the floor where nothing would ever see it.
 */
const AURA_GROUND_EPSILON = 0.06;
/** Direction the hue gradient runs in, in world space (mostly up, slightly skewed). */
const SWEEP_AXIS: readonly [number, number, number] = [0.22, 1, 0.12];

/** Name given to the group that carries the aura envelopes. */
export const GLOW_GROUP_NAME = 'selection-aura';

/** One merged bounding box of the selected object, in the furniture group's local units. */
type AuraSolid = { centre: Vec3Tuple; half: Vec3Tuple };

type SelectionGlowOptions = {
  /** World-space anchor the hue gradient is measured from — usually the object's lowest corner. */
  origin: THREE.Vector3;
  /** Gradient period in world units. */
  sweepLength: number;
  /** The object's merged boxes; the mist stops where a view ray enters one of them. */
  solids: readonly AuraSolid[];
};

/** Builds the shared aura material for one selection. */
function createSelectionGlowMaterial(options: SelectionGlowOptions): THREE.ShaderMaterial {
  const slots = Math.max(1, Math.floor(AURA_MAX_PARTS));
  const centres: THREE.Vector3[] = [];
  const halves: THREE.Vector3[] = [];
  for (let i = 0; i < slots; i += 1) {
    const solid = options.solids[i];
    centres.push(solid ? new THREE.Vector3(...solid.centre) : new THREE.Vector3());
    halves.push(solid ? new THREE.Vector3(...solid.half) : new THREE.Vector3());
  }
  return new THREE.ShaderMaterial({
    // Both have to be compile-time constants: GLSL ES 1.00 only takes constant loop bounds and
    // constant array sizes.
    defines: { HAZE_STEPS: Math.max(2, Math.round(HAZE_STEPS)), SOLID_MAX: slots },
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uOrigin: { value: options.origin.clone() },
      uSweepLength: { value: Math.max(MIN_SWEEP_LENGTH, options.sweepLength) },
      uSweepAxis: { value: new THREE.Vector3(...SWEEP_AXIS) },
      uColorA: { value: new THREE.Color(GLOW_COLORS[0]) },
      uColorB: { value: new THREE.Color(GLOW_COLORS[1]) },
      uColorC: { value: new THREE.Color(GLOW_COLORS[2]) },
      uFeather: { value: HAZE_EDGE_SOFTNESS },
      uAbsorption: { value: HAZE_ABSORPTION },
      uPeakOpacity: { value: HAZE_PEAK_OPACITY },
      uNoiseScale: { value: HAZE_NOISE_SCALE },
      uNoiseSpeed: { value: HAZE_NOISE_SPEED },
      uHazeDensity: { value: HAZE_DENSITY },
      uDriftGain: { value: DRIFT_GAIN },
      uDriftSpeed: { value: DRIFT_SPEED },
      uHueSpeed: { value: HUE_SPEED },
      uHueScale: { value: HUE_SCALE },
      uBreathSpeed: { value: BREATH_SPEED },
      uBreathDepth: { value: BREATH_DEPTH },
      uBloom: { value: BLOOM_BOOST },
      uVeil: { value: HAZE_VEIL },
      uOcclusionSoftness: { value: HAZE_OCCLUSION_SOFTNESS },
      uSolidCount: { value: Math.min(slots, options.solids.length) },
      uSolidCenter: { value: centres },
      uSolidHalf: { value: halves },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    premultipliedAlpha: true,
    // Double-sided so the proxy still covers the screen when the camera walks inside it; the
    // shader keeps exactly one of the two surfaces per ray.
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
}

/** Not exported: only `SelectionGlow.fade` (in this file) needs the shape. */
type SelectionGlowFade = {
  phase: 'in' | 'out';
  /** Clock reading the current phase started at; `NaN` until the first update. */
  startedAt: number;
  /** Intensity the current phase starts from, so an interrupted fade never jumps. */
  from: number;
};

export type SelectionGlow = {
  /** Group to add to the selected furniture. */
  group: THREE.Group;
  /** The one material shared by every shell mesh. */
  material: THREE.ShaderMaterial;
  /** Every shell geometry built for this selection. Owned here, disposed here. */
  geometries: THREE.BufferGeometry[];
  envelopes: Array<{ mesh: THREE.Mesh; baseScale: THREE.Vector3 }>;
  fade: SelectionGlowFade;
};

/** Collects the local-space bounding box of every furniture mesh under `group`. */
function collectMeshBoxes(group: THREE.Group): AuraBox[] {
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const relative = new THREE.Matrix4();
  const boxes: AuraBox[] = [];
  const box = new THREE.Box3();
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // Never wrap an aura envelope in another aura envelope.
    for (let node: THREE.Object3D | null = child; node; node = node.parent) {
      if (node.name === GLOW_GROUP_NAME) return;
    }
    const geometry = child.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) return;
    relative.multiplyMatrices(toLocal, child.matrixWorld);
    box.copy(bounds).applyMatrix4(relative);
    if (box.isEmpty()) return;
    boxes.push({ min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] });
  });
  return boxes;
}

/**
 * The proxy box the ray march runs on: a plain box grown by the feather so the whole soft field
 * fits inside it. The *shape* of the aura lives in the shader's signed-distance field, not here, so
 * twelve triangles are enough; the core half-extents and corner radius ride along as attributes
 * (constant per envelope) to keep one material shared by every envelope.
 */
function buildProxyGeometry(envelope: AuraEnvelope, feather: number): THREE.BufferGeometry {
  const coreSize = envelope.size;
  const proxy = hazeProxySize(coreSize, feather);
  const radius = auraCornerRadiusFor(coreSize);
  const geometry = new THREE.BoxGeometry(proxy[0], proxy[1], proxy[2]);
  const count = geometry.getAttribute('position').count;
  const proxyHalf = new Float32Array(count * 3);
  const coreHalf = new Float32Array(count * 3);
  const centres = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    for (const axis of AXES) {
      proxyHalf[i * 3 + axis] = proxy[axis] / 2;
      coreHalf[i * 3 + axis] = coreSize[axis] / 2;
      centres[i * 3 + axis] = envelope.centre[axis];
    }
    radii[i] = radius;
  }
  geometry.setAttribute('aProxyHalf', new THREE.BufferAttribute(proxyHalf, 3));
  geometry.setAttribute('aCoreHalf', new THREE.BufferAttribute(coreHalf, 3));
  // Attribute NAME stays American: it must match the shader's own
  // `attribute vec3 aCenterLocal;` verbatim (`selection-glow-shader.ts`,
  // GLSL-forced — `scripts/spelling-check.ts`'s `aCenter` allowlist entry).
  geometry.setAttribute('aCenterLocal', new THREE.BufferAttribute(centres, 3));
  geometry.setAttribute('aCoreRadius', new THREE.BufferAttribute(radii, 1));
  return geometry;
}

/** The furniture group's own merged boxes, as the shader wants them: centre plus half-extents. */
function auraSolidsOf(boxes: readonly AuraBox[]): AuraSolid[] {
  return boxes.map((box) => ({
    centre: [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2] as Vec3Tuple,
    half: [
      Math.max(0, (box.max[0] - box.min[0]) / 2),
      Math.max(0, (box.max[1] - box.min[1]) / 2),
      Math.max(0, (box.max[2] - box.min[2]) / 2),
    ] as Vec3Tuple,
  }));
}

/**
 * Builds the aura of `group`: a few slightly rounded core envelopes around merged bounding boxes,
 * each wrapped in one ray-marched haze proxy, all sharing one material. Furniture geometry and
 * materials are never read into the aura and never modified.
 */
export function createSelectionGlow(group: THREE.Group): SelectionGlow {
  group.updateMatrixWorld(true);
  const worldBox = new THREE.Box3().setFromObject(group);
  const height = worldBox.isEmpty() ? 0 : worldBox.max.y - worldBox.min.y;
  const origin = worldBox.isEmpty() ? group.getWorldPosition(new THREE.Vector3()) : worldBox.min.clone();

  // Envelopes live in the furniture's local space; padding is quoted in world metres, so undo
  // the object's own scale before applying it.
  const worldScale = group.getWorldScale(new THREE.Vector3());
  const scaleFactor = Math.max(1e-3, (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3);
  const padding = AURA_PADDING / scaleFactor;
  const minExtent = AURA_MIN_EXTENT / scaleFactor;
  const feather = HAZE_EDGE_SOFTNESS / scaleFactor;

  const boxes = collectMeshBoxes(group);
  const merged = reduceAuraBoxes(boxes);

  const material = createSelectionGlowMaterial({
    origin,
    sweepLength: sweepLengthFor(Number.isFinite(height) ? height : 0),
    solids: auraSolidsOf(merged),
  });

  const glowGroup = new THREE.Group();
  glowGroup.name = GLOW_GROUP_NAME;

  const geometries: THREE.BufferGeometry[] = [];
  const envelopes: SelectionGlow['envelopes'] = [];

  // Furniture pivots sit on the floor, so a part resting on local y = 0 is standing on it.
  const lowest = boxes.reduce((low, box) => Math.min(low, box.min[1]), Number.POSITIVE_INFINITY);
  const groundY = lowest <= AURA_GROUND_EPSILON / scaleFactor ? lowest : Number.NEGATIVE_INFINITY;

  for (const box of merged) {
    const envelope = auraEnvelopeFor(box, padding, minExtent, groundY);
    const { centre } = envelope;
    const geometry = buildProxyGeometry(envelope, feather);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centre[0], centre[1], centre[2]);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    glowGroup.add(mesh);
    envelopes.push({ mesh, baseScale: mesh.scale.clone() });
  }

  return { group: glowGroup, material, geometries, envelopes, fade: { phase: 'in', startedAt: Number.NaN, from: 0 } };
}

/** Eased intensity of the aura at `timeSeconds`, in 0..1. */
function selectionGlowIntensityAt(glow: SelectionGlow, timeSeconds: number): number {
  const { phase, startedAt, from } = glow.fade;
  const elapsed = Number.isFinite(startedAt) ? timeSeconds - startedAt : 0;
  if (phase === 'in') {
    return from + (1 - from) * fadeEase(fadeProgress(elapsed, FADE_IN_SECONDS));
  }
  return from * (1 - fadeEase(fadeProgress(elapsed, FADE_OUT_SECONDS)));
}

/**
 * Starts the dissolve. The envelopes stay alive and keep animating until `updateSelectionGlow`
 * reports the fade is over; only then may the caller dispose them.
 */
export function beginSelectionGlowFadeOut(glow: SelectionGlow | null, timeSeconds: number): void {
  if (!glow || glow.fade.phase === 'out') return;
  glow.fade = { phase: 'out', startedAt: timeSeconds, from: selectionGlowIntensityAt(glow, timeSeconds) };
}

/**
 * Advances the animation. One uniform write plus a scale per shell — no allocations.
 * Returns `false` once a fade-out has finished, which is the caller's cue to dispose the glow.
 */
export function updateSelectionGlow(glow: SelectionGlow | null, timeSeconds: number): boolean {
  if (!glow) return false;
  if (!Number.isFinite(glow.fade.startedAt)) glow.fade.startedAt = timeSeconds;
  const intensity = selectionGlowIntensityAt(glow, timeSeconds);
  // `uniforms` is an index signature; both keys are declared by the material
  // this module builds, so a glow that exists has them.
  glow.material.uniforms['uTime']!.value = timeSeconds;
  glow.material.uniforms['uIntensity']!.value = intensity;
  const swell = breathScaleAt(timeSeconds) * fadeScaleAt(intensity);
  for (const envelope of glow.envelopes) {
    envelope.mesh.scale.copy(envelope.baseScale).multiplyScalar(swell);
  }
  glow.group.visible = intensity > 0.001;
  return glow.fade.phase === 'in' || intensity > 0.001;
}

/** Detaches the aura group and frees the material and every shell geometry. */
export function disposeSelectionGlow(glow: SelectionGlow | null): void {
  if (!glow) return;
  glow.group.parent?.remove(glow.group);
  glow.group.clear();
  glow.envelopes.length = 0;
  glow.material.dispose();
  for (const geometry of glow.geometries) geometry.dispose();
  glow.geometries.length = 0;
}
