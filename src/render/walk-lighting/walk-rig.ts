/**
 * The lights of walk and tour over the lighting standard's apartment rig,
 * in three states: `editing` (the standard's look, untouched), `capture`
 * (while grids are baked and probes captured) and `walk` (the room lighting
 * on screen).
 *
 * In `capture` and `walk` the hemisphere and the fill, which reach through
 * walls, are dimmed to zero rather than removed, so no program changes; the
 * environment's diffuse goes off inside the rooms through the patch's
 * uniforms. `walk` adds a small ambient floor and the walk exposure.
 *
 * Invariant: `editing` puts back exactly the values it found, the light
 * intensities and the renderer's exposure. The lights are looked up by name
 * on every switch, because a context restore replaces the runtime's rig
 * (`render-runtime.ts`); `reapply` puts the current state on the new rig.
 */

import * as THREE from 'three';
import { setUniformState, type UniformState, type WalkUniforms } from './box-probe-patch.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';

/** The apartment rig's lights that ignore walls, by the names the lighting context gives them. */
const WALL_BLIND_LIGHTS = ['jeex-lighting-sky', 'jeex-lighting-fill'] as const;

export type WalkRigDeps = {
  scene: THREE.Scene;
  renderer: { toneMappingExposure: number };
  uniforms: WalkUniforms;
};

export class WalkRig {
  /** The walk's ambient floor: on the scene for good, at zero outside `walk`, so adding it changes no program once. */
  readonly ambient = new THREE.AmbientLight(0xffffff, 0);
  private readonly deps: WalkRigDeps;
  private current: UniformState = 'editing';
  /** What `editing` puts back, per light: read when the light first leaves the editing look. */
  private readonly saved = new WeakMap<THREE.Light, number>();
  private savedExposure: number | null = null;

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

  /** Puts the current state on whatever lights the scene holds now (after a context restore). */
  reapply(): void {
    const { scene, renderer, uniforms } = this.deps;
    const editing = this.current === 'editing';
    for (const name of WALL_BLIND_LIGHTS) {
      const light = scene.getObjectByName(name) as THREE.Light | undefined;
      if (!light) continue;
      if (editing) {
        const intensity = this.saved.get(light);
        if (intensity !== undefined) light.intensity = intensity;
        this.saved.delete(light);
        continue;
      }
      if (!this.saved.has(light)) this.saved.set(light, light.intensity);
      light.intensity = 0;
    }
    if (this.current === 'walk') {
      this.savedExposure ??= renderer.toneMappingExposure;
      renderer.toneMappingExposure = T.walkExposure;
    } else if (this.savedExposure !== null) {
      renderer.toneMappingExposure = this.savedExposure;
      this.savedExposure = null;
    }
    this.ambient.intensity = this.current === 'walk' ? T.ambientFloor : 0;
    setUniformState(uniforms, this.current);
  }

  dispose(): void {
    this.setState('editing');
    this.ambient.removeFromParent();
    this.ambient.dispose();
  }
}
