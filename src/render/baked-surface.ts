/**
 * The seam between a light bake and the lighting: which materials carry baked
 * light, which lamps are in the bake, and how a shader transform is composed
 * onto a material.
 *
 * A baked surface is a shell material whose diffuse indirect light, and the
 * diffuse light of every baked lamp, come from its lightmap. On it the
 * lighting keeps only what the bake left out: the direct sun with its
 * shadows, specular reflections and live lamps (`render/baked-surface-glsl.ts`
 * says what changes in the shader). A lamp left unmarked counts as live.
 *
 * Gain: the lightmap is multiplied by the baked-interior gain of the drawn
 * scene's mode (`LIGHTING_STANDARD.baked.exposure`) inside the walk's room
 * boxes, and by the editing gain outside every box, recorded per scene by
 * `setBakedLightMode` (the walk rig sets `walk`; a scene nobody set is
 * `editing`) and put into a shared uniform by the same draw hook as the
 * masks, so two viewers in different modes keep their own gains and no
 * program changes with the mode.
 *
 * Masks: which drawn light is baked is resolved per render and camera by
 * `render/light-order.ts`, in the material's draw hook, into uniforms every
 * baked material shares. A capture, or a render nested in another one, has
 * another camera and so its own masks; on return the outer camera differs
 * again and its masks are recomputed. Marking a lamp changes only these
 * values, never a program.
 *
 * A copy of a baked material (its compile hooks assigned from the source)
 * keeps the transforms but not the draw hook: its maker marks it baked again,
 * and marking completes what is missing even though the copied flag already
 * says baked.
 */

import type * as THREE from 'three';
import { LIGHTING_STANDARD } from '../lighting/lighting-standard.js';
import { bakeFragmentShader } from './baked-surface-glsl.js';
import { lightMasks, LAMP_BAKED_KEY } from './light-order.js';
import { addShaderTransform, BAKED_TRANSFORM_ID, hasShaderTransform } from './shader-compose.js';

export { addShaderTransform, type ShaderTransform } from './shader-compose.js';

/** The material `userData` key a baked surface is marked by. */
const SURFACE_KEY = 'jeexBakedSurface';
/** The baked transform's version: changes with its shader text. */
const BAKED_VERSION = 2;

/** The uniforms every baked material shares: the light masks, resized to three's light counts per render, and the gains. */
const SHARED = {
  jeexPointDiffuse: { value: [] as number[] },
  jeexSpotDiffuse: { value: [] as number[] },
  jeexDirDirect: { value: [] as number[] },
  jeexBakedGain: { value: LIGHTING_STANDARD.baked.exposure.editing },
  /** Outside every room box, in every mode: such a surface keeps the editing look, like a facade. */
  jeexBakedEditingGain: { value: LIGHTING_STANDARD.baked.exposure.editing },
};

/** The mode that picks the baked-interior gain: the editing modes, or walk and tour with their captures. */
export type BakedLightMode = 'editing' | 'walk';

/** The mode of each scene that left the editing default, by scene object. */
const SCENE_MODES = new WeakMap<object, BakedLightMode>();

/** Records the mode whose baked-interior gain the baked surfaces drawn in `scene` take. */
export function setBakedLightMode(scene: object, mode: BakedLightMode): void {
  if (mode === 'editing') SCENE_MODES.delete(scene);
  else SCENE_MODES.set(scene, mode);
}

/** The gain on the lightmap of a baked surface drawn in `scene`. */
export function bakedLightGain(scene: object): number {
  return LIGHTING_STANDARD.baked.exposure[SCENE_MODES.get(scene) ?? 'editing'];
}

/** The (render, scene, camera) the masks were last computed for, by id: no reference keeps a released scene alive. */
const computed = { frame: -1, scene: -1, camera: -1 };

function updateMasks(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera): void {
  SHARED.jeexBakedGain.value = bakedLightGain(scene);
  const frame = renderer.info.render.frame;
  if (computed.frame === frame && computed.scene === scene.id && computed.camera === camera.id) return;
  Object.assign(computed, { frame, scene: scene.id, camera: camera.id });
  const masks = lightMasks(scene, camera);
  SHARED.jeexPointDiffuse.value = masks.point;
  SHARED.jeexSpotDiffuse.value = masks.spot;
  SHARED.jeexDirDirect.value = masks.directional;
}

/** Materials whose draw hook this module installed: the runtime state idempotence checks, not the copyable flag. */
const DRAW_HOOKED = new WeakSet<THREE.Material>();

type DrawHook = (
  this: THREE.Material,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  object: THREE.Object3D,
  group: THREE.Group,
) => void;

function installDrawHook(material: THREE.Material): void {
  // The hook as the function-valued property it is (three declares it as a method).
  const hooks = material as unknown as { onBeforeRender: DrawHook };
  const previous = hooks.onBeforeRender;
  hooks.onBeforeRender = function bakedSurfaceMasks(renderer, scene, camera, geometry, object, group) {
    updateMasks(renderer, scene, camera);
    previous.call(this, renderer, scene, camera, geometry, object, group);
  };
  DRAW_HOOKED.add(material);
}

/** Marks a material whose diffuse light comes from a light bake. Idempotent. */
export function markBakedSurface(material: THREE.MeshStandardMaterial): void {
  material.userData[SURFACE_KEY] = true;
  if (!hasShaderTransform(material, BAKED_TRANSFORM_ID, BAKED_VERSION)) {
    addShaderTransform(material, BAKED_TRANSFORM_ID, BAKED_VERSION, (shader) => {
      Object.assign(shader.uniforms, SHARED);
      shader.fragmentShader = bakeFragmentShader(shader.fragmentShader);
    });
  }
  if (!DRAW_HOOKED.has(material)) installDrawHook(material);
}

/** Whether a material is marked as a baked surface. */
export function isBakedSurface(material: THREE.Material): boolean {
  return material.userData[SURFACE_KEY] === true;
}

/** Marks a lamp as baked (its light is in the bake) or live; live removes the mark, so an unbound lamp is exactly as before. */
export function setLampBaked(light: THREE.PointLight | THREE.SpotLight, baked: boolean): void {
  if (baked) light.userData[LAMP_BAKED_KEY] = true;
  else delete light.userData[LAMP_BAKED_KEY];
}
