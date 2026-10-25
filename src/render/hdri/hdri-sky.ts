/**
 * The scene state of an installed host sky (`lighting.hdri`), in four states
 * the walk rig picks (`walk-rig.ts`):
 *
 * - `off`: everything as it was before, exactly (the editing look, or the
 *   walk look without a sky);
 * - `capture`: grid and probe captures of the room lighting: the HDRI
 *   environment, its PMREM as background at the environment gain (never the
 *   display sky, whose brightness is artistic), no fog, the HDRI sun, the
 *   exterior grid silent;
 * - `display`: the same lighting with the display sky as background at
 *   `skyBrightness` over the renderer exposure in force;
 * - `sky-only`: a baked apartment: the display sky and no fog, nothing else.
 *
 * Invariant: every value is saved on the first departure from `off` and put
 * back on the return, so `off` is a restore, not a reset. The sun's direction
 * and frustum belong to `SunShadow` (`render/sun-shadow.ts`): this only sets
 * and clears its elevation override, then the light's colour and intensity
 * (cleared in that order). The sun light and the exterior grid are looked up
 * on every apply, because a context restore or a document load replaces them.
 */

import * as THREE from 'three';
import type { Triple } from '../../lighting/lighting-standard.js';
import { LIGHTING_STANDARD } from '../../lighting/lighting-standard.js';

/** What the walk rig asks of the sky. */
export type HdriSkyState = 'off' | 'capture' | 'display' | 'sky-only';

/** Where the sky stands: its rotation and the analytic sun's elevation and colour. */
export type HdriView = { readonly rotationY: number; readonly elevationDeg: number; readonly colourLinear: Triple };

/** What an installed sky is made of; without `environment` only `sky-only` shows anything. */
export type HdriContent = {
  readonly environment?: { readonly texture: THREE.Texture; readonly gain: number; readonly sunIntensity: number } | undefined;
  readonly sky: { readonly texture: THREE.Texture };
  readonly view: HdriView;
};

export type HdriSkyDeps = {
  scene: THREE.Scene;
  renderer: { toneMappingExposure: number };
  /** The exterior grid on the scene now, if any. */
  exterior: () => { texture: THREE.Data3DTexture | null } | null;
  /** The live sun's direction authority, if any. */
  sun: () => { override(elevationDeg: number | null): void } | null | undefined;
};

/** The name the lighting context gives the apartment rig's sun. */
const SUN_LIGHT_NAME = 'jeex-lighting-sun';

type Saved = {
  background: THREE.Scene['background'];
  backgroundIntensity: number;
  backgroundBlurriness: number;
  backgroundRotation: THREE.Euler;
  environment: THREE.Texture | null;
  environmentIntensity: number;
  environmentRotation: THREE.Euler;
  fog: THREE.Scene['fog'];
  sun: { light: THREE.DirectionalLight; colour: THREE.Color; intensity: number } | null;
  exterior: { grid: { texture: THREE.Data3DTexture | null }; texture: THREE.Data3DTexture | null } | null;
  overridden: boolean;
};

export class HdriSky {
  private readonly deps: HdriSkyDeps;
  private content: HdriContent | null = null;
  private current: HdriSkyState = 'off';
  private saved: Saved | null = null;
  private zero: THREE.Data3DTexture | null = null;

  constructor(deps: HdriSkyDeps) {
    this.deps = deps;
  }

  get state(): HdriSkyState {
    return this.current;
  }

  /** Whether the background's intensity is the sky's own now (the walk rig leaves it alone). */
  get ownsBackground(): boolean {
    return this.current === 'display' || this.current === 'sky-only';
  }

  /** Whether full HDRI lighting is installed (an environment, not only a sky). */
  get lighting(): boolean {
    return this.content?.environment !== undefined;
  }

  /** Installs `content`, or removes it; a removal while shown restores first. */
  install(content: HdriContent | null): void {
    this.apply('off');
    this.content = content;
  }

  /** A new rotation or sun (the site's north changed); applied at once while shown. */
  setView(view: HdriView): void {
    if (!this.content) return;
    this.content = { ...this.content, view };
    if (this.current !== 'off') this.put(this.current);
  }

  /** Moves to `state`; a state the content cannot show is `off`. */
  apply(state: HdriSkyState): void {
    const content = this.content;
    let next = state;
    if (!content || ((next === 'capture' || next === 'display') && content.environment === undefined)) next = 'off';
    if (next === 'off') {
      this.restore();
      this.current = 'off';
      return;
    }
    this.saved ??= this.save();
    // From a full state to sky-only, the lighting goes back first.
    if (next === 'sky-only' && (this.current === 'capture' || this.current === 'display')) this.restoreLighting(this.saved);
    this.current = next;
    this.put(next);
  }

  dispose(): void {
    this.install(null);
    this.zero?.dispose();
    this.zero = null;
  }

  private sunLight(): THREE.DirectionalLight | null {
    const light = this.deps.scene.getObjectByName(SUN_LIGHT_NAME) as THREE.DirectionalLight | undefined;
    return light?.isDirectionalLight === true ? light : null;
  }

  private save(): Saved {
    const { scene } = this.deps;
    return {
      background: scene.background,
      backgroundIntensity: scene.backgroundIntensity,
      backgroundBlurriness: scene.backgroundBlurriness,
      backgroundRotation: scene.backgroundRotation.clone(),
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
      environmentRotation: scene.environmentRotation.clone(),
      fog: scene.fog,
      sun: null,
      exterior: null,
      overridden: false,
    };
  }

  private put(state: Exclude<HdriSkyState, 'off'>): void {
    const { scene, renderer } = this.deps;
    const content = this.content!;
    const saved = this.saved!;
    const rotation = content.view.rotationY;
    scene.fog = null;
    scene.backgroundBlurriness = 0;
    scene.backgroundRotation.set(0, rotation, 0);
    if (state === 'display' || state === 'sky-only') {
      scene.background = content.sky.texture;
      scene.backgroundIntensity = LIGHTING_STANDARD.hdri.skyBrightness / renderer.toneMappingExposure;
    }
    if (state === 'sky-only') return;
    const environment = content.environment!;
    if (state === 'capture') {
      scene.background = environment.texture;
      scene.backgroundIntensity = environment.gain;
    }
    scene.environment = environment.texture;
    scene.environmentIntensity = environment.gain;
    scene.environmentRotation.set(0, rotation, 0);
    // The sun: direction through its authority, then colour and strength on the light.
    this.deps.sun()?.override(content.view.elevationDeg);
    saved.overridden = true;
    const light = this.sunLight();
    if (light) {
      if (saved.sun === null || saved.sun.light !== light) saved.sun = { light, colour: light.color.clone(), intensity: light.intensity };
      light.color.setRGB(...content.view.colourLinear);
      light.intensity = environment.sunIntensity;
    }
    const grid = this.deps.exterior();
    if (grid?.texture) {
      if (saved.exterior === null || saved.exterior.grid !== grid) saved.exterior = { grid, texture: grid.texture };
      grid.texture = this.zeroLike(saved.exterior.texture!);
    }
  }

  /** A texture of the exterior grid's size and format holding no light. */
  private zeroLike(texture: THREE.Data3DTexture): THREE.Data3DTexture {
    const { width, height, depth } = texture.image;
    if (this.zero && this.zero.image.width === width && this.zero.image.height === height && this.zero.image.depth === depth)
      return this.zero;
    this.zero?.dispose();
    const source = texture.image.data;
    const length = source?.length ?? 0;
    const data = source instanceof Float32Array ? new Float32Array(length) : new Uint16Array(length);
    const zero = new THREE.Data3DTexture(data, width, height, depth);
    zero.type = texture.type;
    zero.format = texture.format;
    zero.minFilter = texture.minFilter;
    zero.magFilter = texture.magFilter;
    zero.unpackAlignment = texture.unpackAlignment;
    zero.needsUpdate = true;
    this.zero = zero;
    return zero;
  }

  private restoreLighting(saved: Saved): void {
    const { scene } = this.deps;
    scene.environment = saved.environment;
    scene.environmentIntensity = saved.environmentIntensity;
    scene.environmentRotation.copy(saved.environmentRotation);
    if (saved.overridden) this.deps.sun()?.override(null);
    saved.overridden = false;
    if (saved.sun) {
      saved.sun.light.color.copy(saved.sun.colour);
      saved.sun.light.intensity = saved.sun.intensity;
      saved.sun = null;
    }
    if (saved.exterior) {
      saved.exterior.grid.texture = saved.exterior.texture;
      saved.exterior = null;
    }
  }

  private restore(): void {
    const saved = this.saved;
    if (saved === null) return;
    const { scene } = this.deps;
    this.restoreLighting(saved);
    scene.background = saved.background;
    scene.backgroundIntensity = saved.backgroundIntensity;
    scene.backgroundBlurriness = saved.backgroundBlurriness;
    scene.backgroundRotation.copy(saved.backgroundRotation);
    scene.fog = saved.fog;
    this.saved = null;
  }
}
