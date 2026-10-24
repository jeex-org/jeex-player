/**
 * `bakeLights`: the lights an offline light bake takes for a scene, in the
 * units the player's live lighting uses, so that the bake reproduces the live
 * light it replaces (`bake-lights.schema.ts` is the contract).
 *
 * Every number is read from the player's own sources, never restated:
 * - the sun from the lighting standard's apartment sun (colour linearised as
 *   three linearises it, intensity as the irradiance in W/m²) and its
 *   direction from the scene's `site` by `sunDirection`, the function the
 *   live rig is aimed with. The walk's interior factor is applied to a
 *   lightmap at run time and is not part of the bake.
 * - the sky from the standard's hemisphere light: radiance = irradiance / π.
 *   The environment's diffuse, the walk's ambient floor and the editing fill
 *   light are not baked: they stand in for the indirect light a bake computes.
 * - the lamps through one seam, `collectLampLights` (`render/lamp-lights.ts`),
 *   over the scene built by the player's own `SceneBuilder` as a live view
 *   builds it: the lights the placements declare, never a bank builder's
 *   procedural bulb (those stay live). three's cut-off distance is not baked.
 *
 * The bank is a required argument: the caller names the bank the live view of
 * the same scene resolves against (`SHIPPED_BANK`, or a project's
 * `projectBank(manifest, baseUrl)` catalogue and library), so the bake never
 * falls back to a bank the live view does not use.
 *
 * Internal module: the bake tool imports it from source (Bun, no DOM). It is
 * not part of the package's exports.
 */

import * as THREE from 'three';
import type { CatalogueLookup } from '../assets/asset-resolver.js';
import { SceneBuilder } from '../geometry/scene-builder.js';
import { LIGHTING_STANDARD, LIGHTING_STANDARD_VERSION } from '../lighting/lighting-standard.js';
import { sunDirection } from '../lighting/sun-direction.js';
import { solvePlan } from '../plan/plan-solver.js';
import { collectLampLights, type CollectedLampLight } from '../render/lamp-lights.js';
import type { SceneData } from '../scene/types.js';
import { ViewerLibError } from '../shared/errors.js';
import {
  BAKE_LAMP_WATTS_PER_CANDELA,
  BAKE_LIGHTS_RECIPE,
  BAKE_SKY_HEMISPHERE_RECIPE,
  judgeBakeLights,
  type BakeLamp,
  type BakeLights,
} from './bake-lights.schema.js';

/** The shipped bank, for a scene the live view draws without a project. */
export const SHIPPED_BANK = Object.freeze({ shipped: true } as const);

/** The bank the live view of the scene resolves placements against. */
export type BakeBank =
  | typeof SHIPPED_BANK
  | {
      readonly catalogue: CatalogueLookup;
      /** The library the catalogue answers for (`projectBank(...).defaultLibrary`), as the live view is given it. */
      readonly catalogueLibrary: string;
    };

/** Collects the lamp lights of a built scene; `collectLampLights` unless a test stands in for it. */
export type LampCollector = (root: THREE.Object3D) => readonly CollectedLampLight[];

type Rgb = readonly [number, number, number];

/**
 * Blender watts of a three point light of `candela`. Local until the lighting
 * module publishes its own conversion, which then replaces this one.
 */
function blenderPower(candela: number): number {
  return BAKE_LAMP_WATTS_PER_CANDELA * candela;
}

/** A standard hex as three reads it: sRGB, linearised into the working space. */
function linear(hex: string, scale = 1): Rgb {
  const colour = new THREE.Color(hex);
  return [colour.r * scale, colour.g * scale, colour.b * scale];
}

/** The scene builder's bank options for `bank`; refuses a missing or malformed bank. */
function bankOptions(bank: BakeBank | undefined): { catalogue?: CatalogueLookup; catalogueLibrary?: string } {
  if (bank === SHIPPED_BANK) return {};
  if (
    bank !== null &&
    typeof bank === 'object' &&
    'catalogue' in bank &&
    typeof bank.catalogue === 'function' &&
    typeof bank.catalogueLibrary === 'string'
  ) {
    return { catalogue: bank.catalogue, catalogueLibrary: bank.catalogueLibrary };
  }
  throw new ViewerLibError(
    'bad-params',
    'bake lights: name the bank the live view uses (SHIPPED_BANK, or a project catalogue with its library)',
  );
}

function bakeLamp(light: CollectedLampLight): BakeLamp {
  return {
    id: light.placementId,
    index: light.index,
    position: [...light.position],
    color: [...light.colour],
    intensity: light.intensity,
    power: blenderPower(light.intensity),
  };
}

/** Builds `scene` as a live view does and collects its lamp lights. */
function lampsOf(scene: SceneData, bank: BakeBank, collect: LampCollector): BakeLamp[] {
  const builder = new SceneBuilder(scene, solvePlan(scene), bankOptions(bank));
  try {
    const root = builder.build().root;
    root.updateMatrixWorld(true);
    return collect(root).map((light) => bakeLamp(light));
  } finally {
    builder.dispose();
  }
}

/**
 * The lights a bake of `scene` takes, its placements resolved against `bank`.
 * Throws `ViewerLibError` without a bank, while three's colour management is
 * off, or when the answer breaks the contract.
 */
export function bakeLights(scene: SceneData, bank: BakeBank, collect: LampCollector = collectLampLights): BakeLights {
  bankOptions(bank);
  // The rig refuses to light without it too: a hex would then stay sRGB.
  if (!THREE.ColorManagement.enabled)
    throw new ViewerLibError('bad-params', 'bake lights: three.js colour management must be on to linearise the standard’s colours');
  const { sun, hemisphere } = LIGHTING_STANDARD.apartment;
  const towards = sunDirection(scene.site).direction;
  const lights: BakeLights = {
    recipe: BAKE_LIGHTS_RECIPE,
    standardVersion: LIGHTING_STANDARD_VERSION,
    sun: { direction: [-towards[0], -towards[1], -towards[2]], color: linear(sun.colour), strength: sun.intensity },
    sky: {
      recipe: BAKE_SKY_HEMISPHERE_RECIPE,
      upper: linear(hemisphere.sky, hemisphere.intensity / Math.PI),
      lower: linear(hemisphere.ground, hemisphere.intensity / Math.PI),
    },
    lamps: lampsOf(scene, bank, collect),
  };
  const verdict = judgeBakeLights(lights);
  if (!verdict.ok) throw new ViewerLibError('bad-params', verdict.message);
  return verdict.value;
}
