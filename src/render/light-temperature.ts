/**
 * The colour temperature of the interior's artificial light on the player's
 * scene graph.
 *
 * A temperature changes only lights tagged as artificial
 * (`assets/artificial-light.ts`): the asset bank's lamps and the walk's
 * ambient floor. Each light keeps its luminance and takes the hue of the
 * temperature (`lighting/colour-temperature.ts`); «Original» (`null`) puts
 * the colour it was built with back exactly. The sun, the sky, the fill, the
 * studio environment and the material previews have no tag and never change.
 *
 * `LightTemperature` holds the current value for one scene: `set` tints the
 * scene and asks for a draw, `apply` tints a root built later (a new document,
 * a swapped lamp, the walk lighting, the offscreen scene of a capture).
 */

import type * as THREE from 'three';
import { colourTemperatureRgb } from '../lighting/colour-temperature.js';
import { artificialColour } from '../assets/artificial-light.js';

/** «Original» or a temperature in kelvin. */
export type LightTemperatureValue = number | null;

/** Tints every tagged light under `root` for `temperature`; answers how many it touched. */
export function tintArtificialLights(root: THREE.Object3D, temperature: LightTemperatureValue): number {
  const unit = temperature === null ? null : colourTemperatureRgb(temperature);
  let count = 0;
  root.traverse((object) => {
    const light = object as THREE.Light;
    if (!(light as Partial<THREE.Light>).isLight) return;
    const original = artificialColour(light);
    if (original === null) return;
    count += 1;
    if (unit === null) {
      light.color.setRGB(original[0], original[1], original[2]);
      return;
    }
    const y = 0.2126 * original[0] + 0.7152 * original[1] + 0.0722 * original[2];
    light.color.setRGB(unit[0] * y, unit[1] * y, unit[2] * y);
  });
  return count;
}

export type LightTemperatureDeps = {
  /** The live scene, `undefined` before the renderer exists. */
  scene: () => THREE.Object3D | undefined;
  /** Something on screen changed: the next tick draws (`render-demand.ts`). */
  invalidate: () => void;
};

export class LightTemperature {
  private readonly deps: LightTemperatureDeps;
  private current: LightTemperatureValue;

  constructor(deps: LightTemperatureDeps, initial: LightTemperatureValue = null) {
    this.deps = deps;
    this.current = initial;
  }

  get value(): LightTemperatureValue {
    return this.current;
  }

  /** Sets the value and tints the live scene; answers whether it changed. */
  set(value: LightTemperatureValue): boolean {
    if (value === this.current) return false;
    this.current = value;
    const scene = this.deps.scene();
    if (scene) tintArtificialLights(scene, value);
    this.deps.invalidate();
    return true;
  }

  /** Tints the lights of a root built after the last change. */
  apply(root: THREE.Object3D): void {
    tintArtificialLights(root, this.current);
  }
}
