/**
 * A library material as a THREE material: flat in its first-frame colour the
 * moment it is created, its maps attached as they arrive.
 *
 * The physical model is used only when a field needs it (three honours sheen,
 * clearcoat, transmission, a configurable IOR, thickness and attenuation on
 * `MeshPhysicalMaterial` alone); every other material is the standard one.
 * The defaults the format names — metalness 0, roughness 1, alpha `opaque`,
 * normal strength 1 — are applied HERE, never written into the manifest.
 * Colours are parsed through three's sRGB-aware colour class, so every product
 * below is taken in linear light.
 */

import * as THREE from 'three';
import type { LibraryMapRole, LibraryMaterial, LibraryPbr, LibraryTint } from './finish-types.js';
import type { LibraryDraw } from './room-finish.js';
import { debugFlags } from '../shared/debug-flags.js';

/** A library material's THREE material: standard, or physical when a field needs it. */
export type LibraryThreeMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

/** The glTF mask cutoff. */
const MASK_CUTOFF = 0.5;

/** How far a sheen without a stated colour or lift is lifted from its tint toward white: the grazing sheen of dyed fibre is lighter than its body. */
const SHEEN_LIFT = 0.2;

const WHITE = new THREE.Color('#ffffff');

/** The fields only the physical model draws. */
const PHYSICAL_FIELDS: readonly (keyof LibraryPbr)[] = [
  'sheen',
  'sheenColour',
  'sheenRoughness',
  'clearcoat',
  'clearcoatRoughness',
  'transmission',
  'ior',
  'thicknessM',
  'attenuationDistanceM',
  'attenuationColour',
];

/**
 * How much a tint recipe darkened the map it wrote, so the tint can win it
 * back: the map's colour factor is `tint × gain`. `luma-mid@1` normalises the
 * scan's linear luminance to the linear value of sRGB 0.5 (about 0.214),
 * so a tint in the scan's own colour reproduces the scan only when it is
 * scaled by the inverse of that mean. A future recipe declares its own gain
 * here; the map data is never rewritten to hold a mean of 1 (8-bit maps
 * would clip).
 */
const TINT_RECIPE_GAIN: { readonly [recipe in LibraryTint['recipe']]: number } = {
  'luma-mid@1': 1 / new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace).r,
};

/** The gain of a tintable scan's recipe, else 1 (natural materials and tintable parameters carry no tint map). */
function tintGainOf(draw: LibraryDraw): number {
  const { facts, kind } = draw.material;
  if (kind !== 'scan' || facts.colourMode !== 'tintable' || facts.tint === undefined) return 1;
  return TINT_RECIPE_GAIN[facts.tint.recipe];
}

/** The tint a tintable draw is drawn in: its finish colour, else the first suggested colour. */
export function tintOf(draw: LibraryDraw): string | undefined {
  const { facts } = draw.material;
  if (facts.colourMode !== 'tintable') return undefined;
  return draw.colour ?? facts.tint?.suggestedColours[0]?.hex;
}

/**
 * The colour a surface shows before any map arrives: `averageColour` for a
 * natural material, `averageColour × tint × gain` for a tintable scan (the
 * gain of its tint recipe, see `TINT_RECIPE_GAIN`), and the tint itself for a
 * tintable parameters material, which has no map to arrive.
 */
export function firstFrameColour(draw: LibraryDraw): THREE.Color {
  const { facts, kind } = draw.material;
  const tint = tintOf(draw);
  if (tint === undefined) return new THREE.Color(facts.averageColour);
  if (kind === 'parameters') return new THREE.Color(tint);
  return new THREE.Color(facts.averageColour).multiply(new THREE.Color(tint)).multiplyScalar(tintGainOf(draw));
}

/** The material of one library draw, flat in its first-frame colour. */
export function createLibraryMaterial(draw: LibraryDraw): LibraryThreeMaterial {
  const { pbr } = draw.material.facts;
  const physical = PHYSICAL_FIELDS.some((field) => pbr[field] !== undefined);
  const material = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  material.name = draw.id;
  material.color.copy(firstFrameColour(draw));
  material.roughness = pbr.roughness ?? 1;
  material.metalness = pbr.metalness ?? 0;
  if (pbr.emissive !== undefined) material.emissive.set(pbr.emissive);
  if (pbr.emissiveIntensity !== undefined) material.emissiveIntensity = pbr.emissiveIntensity;
  if (pbr.alphaMode === 'blend') {
    material.transparent = true;
    material.opacity = pbr.opacity ?? 1;
  } else if (pbr.alphaMode === 'mask') {
    material.alphaTest = MASK_CUTOFF;
  }
  if (material instanceof THREE.MeshPhysicalMaterial) applyPhysical(material, draw);
  return material;
}

/**
 * The physical fields under their three.js names. three's sheen colour is
 * black until set, which hides a stated sheen, so a sheen stated without a
 * colour takes the draw's tint (the plain colour: the sheen lobe samples no
 * map, so the tint recipe's gain does not apply) lifted toward white by the
 * material's `sheenLift`, else `SHEEN_LIFT`, in linear light, or white without
 * a tint. An absent sheen roughness keeps three's default of 1.
 */
function applyPhysical(material: THREE.MeshPhysicalMaterial, draw: LibraryDraw): void {
  const { pbr } = draw.material.facts;
  if (pbr.sheen !== undefined) material.sheen = pbr.sheen;
  if (pbr.sheenColour !== undefined) material.sheenColor.set(pbr.sheenColour);
  else if (pbr.sheen !== undefined) material.sheenColor.set(tintOf(draw) ?? WHITE).lerp(WHITE, pbr.sheenLift ?? SHEEN_LIFT);
  if (pbr.sheenRoughness !== undefined) material.sheenRoughness = pbr.sheenRoughness;
  if (pbr.clearcoat !== undefined) material.clearcoat = pbr.clearcoat;
  if (pbr.clearcoatRoughness !== undefined) material.clearcoatRoughness = pbr.clearcoatRoughness;
  if (pbr.transmission !== undefined) material.transmission = debugFlags().noTransmission ? 0 : pbr.transmission;
  if (pbr.ior !== undefined) material.ior = pbr.ior;
  if (pbr.thicknessM !== undefined) material.thickness = pbr.thicknessM;
  if (pbr.attenuationDistanceM !== undefined) material.attenuationDistance = pbr.attenuationDistanceM;
  if (pbr.attenuationColour !== undefined) material.attenuationColor.set(pbr.attenuationColour);
}

/** The image format a library material's maps are shipped in. */
export type LibraryMapFormat = 'webp' | 'ktx2';

/** The format every file of `material` shares (one per material, by the manifest rules); WebP when it lists none. */
export function libraryMapFormat(material: Pick<LibraryMaterial, 'maps'>): LibraryMapFormat {
  for (const map of Object.values(material.maps)) {
    for (const path of Object.values(map?.files ?? {})) return path?.endsWith('.ktx2') ? 'ktx2' : 'webp';
  }
  return 'webp';
}

/** The views a material's maps arrived as, by role. */
export type LibraryMapViews = { readonly [role in LibraryMapRole]?: THREE.Texture };

/**
 * Attaches the views that arrived to `material`, by glTF rules.
 *
 * A colour map turns the colour into the factor the map is multiplied by: the
 * tint times its recipe gain for a tintable scan, else white, times a scan's own `baseColour` when
 * it has one. One ARM view feeds ambient occlusion (red), roughness (green)
 * and metalness (blue); the scalars stay the multipliers they are, so an
 * absent metalness (0) keeps the surface non-metallic whatever the blue
 * channel holds. Ambient occlusion reads the primary UV set. The material is
 * marked for recompilation whenever the set of maps it samples changes.
 */
export function attachLibraryMaps(material: LibraryThreeMaterial, draw: LibraryDraw, views: LibraryMapViews): void {
  const before = mapSignature(material);
  const { facts } = draw.material;
  const colourMap = views.albedo ?? views.albedoTint;
  if (colourMap !== undefined) {
    material.map = colourMap;
    const tint = tintOf(draw);
    material.color.set(tint ?? '#ffffff').multiplyScalar(tint === undefined ? 1 : tintGainOf(draw));
    if (facts.pbr.baseColour !== undefined) material.color.multiply(new THREE.Color(facts.pbr.baseColour));
  }
  // A diagnostic switch can leave the ARM view off; the roughness and occlusion scalars stay as they are.
  if (views.arm !== undefined && !debugFlags().noArm) {
    views.arm.channel = 0;
    material.aoMap = views.arm;
    material.roughnessMap = views.arm;
    material.metalnessMap = views.arm;
  }
  if (views.roughness !== undefined) material.roughnessMap = views.roughness;
  if (views.ao !== undefined) {
    views.ao.channel = 0;
    material.aoMap = views.ao;
  }
  if (views.normal !== undefined) {
    material.normalMap = views.normal;
    const strength = facts.normalStrength ?? 1;
    // A KTX2 material samples with its v axis reversed (`libraryTextureMatrix`),
    // and three builds the tangent frame from those coordinates: the green
    // channel then points down the picture unless its scale is negated, the
    // compensation three's own glTF loader applies to meshes without tangents.
    material.normalScale.set(strength, libraryMapFormat(draw.material) === 'ktx2' ? -strength : strength);
  }
  if (mapSignature(material) !== before) material.needsUpdate = true;
}

/** Which map slots of `material` are filled, as one comparable word. */
function mapSignature(material: LibraryThreeMaterial): string {
  return [material.map, material.aoMap, material.roughnessMap, material.metalnessMap, material.normalMap]
    .map((slot) => (slot === null ? '0' : '1'))
    .join('');
}
