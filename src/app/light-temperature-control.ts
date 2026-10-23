/**
 * The viewer's one light temperature: what a host sets (`setLightTemperature`,
 * the `light-temperature` attribute, the iframe command) and what the settings
 * panel sets, applied to the scene and reported once per change.
 *
 * Invariant: the value is valid by construction. A host value outside the
 * standard's range or off its step throws `bad-params` naming
 * `lightTemperature` and changes nothing; an unchanged value does nothing at
 * all, no event included. The panel only ever offers valid values.
 */

import type * as THREE from 'three';
import { ViewerLibError } from '../shared/errors.js';
import { isLightTemperature } from '../lighting/colour-temperature.js';
import { LIGHTING_STANDARD } from '../lighting/lighting-standard.js';
import { LightTemperature, type LightTemperatureValue } from '../render/light-temperature.js';

/** Who changed the temperature: the host (any of its doors) or the viewer's settings panel. */
export type LightTemperatureSource = 'host' | 'panel';

/** The `lightTemperature` event's payload. */
export type LightTemperatureChange = { readonly temperature: number | null; readonly source: LightTemperatureSource };

export type LightTemperatureControlDeps = {
  /** The mount option `lighting.temperature`. */
  initial: LightTemperatureValue;
  /** The live scene, `undefined` before the stage exists. */
  scene: () => THREE.Object3D | undefined;
  /** Walk and tour draw the next tick. */
  invalidate: () => void;
  /** The walk's probes are re-captured once the value rests. */
  relit: () => void;
  emit: (change: LightTemperatureChange) => void;
  /** Mirrors the value into the settings panel. */
  reflect: (value: LightTemperatureValue) => void;
};

/** A refused value, as the refusal names it. */
function describe(value: unknown): string {
  return typeof value === 'number' ? String(value) : (JSON.stringify(value) ?? typeof value);
}

export class LightTemperatureControl {
  private readonly deps: LightTemperatureControlDeps;
  private readonly lights: LightTemperature;

  constructor(deps: LightTemperatureControlDeps) {
    this.deps = deps;
    this.lights = new LightTemperature({ scene: deps.scene, invalidate: deps.invalidate }, deps.initial);
  }

  get value(): LightTemperatureValue {
    return this.lights.value;
  }

  /** Sets the temperature; throws `bad-params` for a value the standard does not allow. */
  set(value: unknown, source: LightTemperatureSource): void {
    if (value !== null && !isLightTemperature(value)) {
      const { min, max, step } = LIGHTING_STANDARD.temperature;
      throw new ViewerLibError(
        'bad-params',
        `setLightTemperature: lightTemperature must be null or a whole multiple of ${step} K from ${min} to ${max}, got ${describe(value)}`,
        { path: 'lightTemperature', detail: { value: describe(value) } },
      );
    }
    if (!this.lights.set(value)) return;
    this.deps.relit();
    this.deps.reflect(value);
    this.deps.emit({ temperature: value, source });
  }

  /** Tints a root built after the last change: a new document, a swapped lamp, the walk lighting, a capture's own scene. */
  apply(root: THREE.Object3D): void {
    this.lights.apply(root);
  }
}
