/**
 * The lights of walk and tour over the lighting standard's apartment rig,
 * in three states: `editing` (the standard's look, untouched), `capture`
 * (while grids are baked and probes captured) and `walk` (the room lighting
 * on screen).
 *
 * In `capture` and `walk` the hemisphere and the fill, which reach through
 * walls, are dimmed to zero rather than removed, so no program changes; the
 * environment's diffuse goes off inside the rooms through the patch's
 * uniforms. `walk` adds a small ambient floor and the walk exposure, and
 * divides the sky background's intensity by that exposure. Baked surfaces
 * take the walk's baked-interior gain in `capture` and `walk`.
 *
 * Invariant: `editing` puts back exactly the values it found, the light
 * intensities and the renderer's exposure. The lights are looked up by name
 * on every switch, because a context restore replaces the runtime's rig
 * (`render-runtime.ts`); `reapply` puts the current state on the new rig.
 */

import * as THREE from 'three';
import { setUniformState, type UniformState, type WalkUniforms } from './box-probe-patch.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';
import { tagArtificialLight } from '../../assets/artificial-light.js';
import { APARTMENT_FILL_LIGHT_NAME } from '../../lighting/lighting-context.js';
import { setBakedLightMode } from '../baked-surface.js';
import type { HdriSky, HdriSkyState } from '../hdri/hdri-sky.js';

/** The apartment rig's lights that ignore walls, by the names the lighting context gives them. */
const WALL_BLIND_LIGHTS = ['jeex-lighting-sky', APARTMENT_FILL_LIGHT_NAME] as const;

export type WalkRigDeps = {
  scene: THREE.Scene;
  renderer: { toneMappingExposure: number };
  uniforms: WalkUniforms;
};

export class WalkRig {
  /**
   * The walk's ambient floor: on the scene for good, at zero outside `walk`, so adding it changes no program once.
   * Artificial light: a colour temperature tints it (`render/light-temperature.ts`).
   */
  readonly ambient = tagArtificialLight(new THREE.AmbientLight(0xffffff, 0));
  private readonly deps: WalkRigDeps;
  private current: UniformState = 'editing';
  /** What `editing` puts back, per light: read when the light first leaves the editing look. */
  private readonly saved = new WeakMap<THREE.Light, number>();
  private savedExposure: number | null = null;
  private savedBackground: number | null = null;
  /** A host sky, shown in the states it can show (`hdri/hdri-sky.ts`). */
  private hdri: HdriSky | null = null;
  /** Show the sky in the editing state too: walk or tour over a plan with no closed room. */
  private daylight = false;

  constructor(deps: WalkRigDeps) {
    this.deps = deps;
    this.ambient.name = 'jeex-walk-ambient';
    deps.scene.add(this.ambient);
  }

  get state(): UniformState {
    return this.current;
  }

  setState(state: UniformState): void {
    this.current = state;
    this.reapply();
  }

  /** Installs a host sky (or removes it, `null`); applied at once. */
  setHdri(sky: HdriSky | null): void {
    if (this.hdri && this.hdri !== sky) this.hdri.apply('off');
    this.hdri = sky;
    this.reapply();
  }

  /**
   * Walk or tour over a plan with no closed room: the sky shows in the
   * editing state, with no walk exposure, and its lighting replaces the
   * hemisphere and fill as in walk. Without a sky this changes nothing.
   */
  setHdriDaylight(on: boolean): void {
    if (this.daylight === on) return;
    this.daylight = on;
    this.reapply();
  }

  /** What the sky shows in the current state. */
  private hdriState(): HdriSkyState {
    const sky = this.hdri;
    if (!sky) return 'off';
    if (this.current === 'capture') return sky.lighting ? 'capture' : 'off';
    if (this.current === 'walk' || this.daylight) return sky.lighting ? 'display' : 'sky-only';
    return 'off';
  }

  /** Puts the current state on whatever lights the scene holds now (after a context restore). */
  reapply(): void {
    const { scene, renderer, uniforms } = this.deps;
    const editing = this.current === 'editing';
    const hdri = this.hdriState();
    // The sky's lighting replaces the light that ignores walls in the editing state too.
    const lightsOn = editing && hdri !== 'display';
    for (const name of WALL_BLIND_LIGHTS) {
      const light = scene.getObjectByName(name) as THREE.Light | undefined;
      if (!light) continue;
      if (lightsOn) {
        const intensity = this.saved.get(light);
        if (intensity !== undefined) light.intensity = intensity;
        this.saved.delete(light);
        continue;
      }
      if (!this.saved.has(light)) this.saved.set(light, light.intensity);
      light.intensity = 0;
    }
    // A sky that owns the background gives it back before the gradient's own handling below.
    if (hdri !== 'display' && hdri !== 'sky-only') this.hdri?.apply(hdri);
    if (this.current === 'walk') {
      this.savedExposure ??= renderer.toneMappingExposure;
      renderer.toneMappingExposure = T.walkExposure;
      const owned = hdri === 'display' || hdri === 'sky-only';
      if (owned && this.savedBackground !== null) {
        // The gradient's compensation is undone before the sky saves the background.
        scene.backgroundIntensity = this.savedBackground;
        this.savedBackground = null;
      } else if (!owned) {
        this.savedBackground ??= scene.backgroundIntensity;
        // The sky through a window keeps the editing look under the walk exposure, as the facades do.
        scene.backgroundIntensity = this.savedBackground / T.walkExposure;
      }
    } else if (this.savedExposure !== null) {
      renderer.toneMappingExposure = this.savedExposure;
      if (this.savedBackground !== null) scene.backgroundIntensity = this.savedBackground;
      this.savedExposure = null;
      this.savedBackground = null;
    }
    // The sky after the exposure: its brightness is set against the exposure in force.
    if (hdri === 'display' || hdri === 'sky-only') this.hdri!.apply(hdri);
    this.ambient.intensity = this.current === 'walk' ? T.ambientFloor : 0;
    setUniformState(uniforms, this.current);
    // Grid and probe captures record what walk shows, so they take the walk gain too.
    setBakedLightMode(scene, editing ? 'editing' : 'walk');
  }

  dispose(): void {
    this.hdri?.apply('off');
    this.hdri = null;
    this.daylight = false;
    this.setState('editing');
    this.ambient.removeFromParent();
    this.ambient.dispose();
  }
}
