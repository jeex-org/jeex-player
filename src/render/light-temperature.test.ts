/**
 * The colour temperature on the interior's artificial lights, with the real
 * bank builders: every bank lamp carries its original colour, a temperature
 * keeps each light's luminance, «Original» puts the exact colour back, and
 * nothing but tagged lights changes.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { buildCeilingLight, buildLamp, buildPendant } from '../assets/asset-builders-lighting-decor.js';
import { GeometryCache, makeBuildKit } from '../assets/asset-kit.js';
import { FinishRegistry } from '../assets/asset-finishes.js';
import type { ResolvedAsset } from '../assets/asset-resolver.js';
import type { Builder } from '../assets/asset-kit.js';
import { ARCHETYPE, VARIANT } from '../assets/catalogue-ids.js';
import { ARTIFICIAL_LIGHT_KEY, isArtificialLight, tagArtificialLight } from '../assets/artificial-light.js';
import { colourTemperatureRgb } from '../lighting/colour-temperature.js';
import { LightTemperature, tintArtificialLights } from './light-temperature.js';

function asset(builder: string, dims: [number, number, number]): ResolvedAsset {
  return {
    placementId: '01a12ff0-fecf-7faf-9a83-b97dba8a9328',
    library: 'starter',
    archetypeId: ARCHETYPE.lamp_floor,
    variantId: VARIANT.lamp_floor_brass,
    variantName: 'Test lamp',
    version: '1.0.0',
    category: 'lighting/lamps',
    tags: [],
    dims,
    anchor: 'floor',
    wallSnap: false,
    clearance: 0,
    mountY: 0,
    scale: 1,
    yaw: 0,
    builder,
    options: {},
    finishes: {},
    pricing: { model: 'free' },
  } as ResolvedAsset;
}

const kit = makeBuildKit(new GeometryCache(), new FinishRegistry([]), {}, () => undefined);

/** One group per bank light builder, as the bank builds it. */
function bankLamps(): THREE.Group {
  const root = new THREE.Group();
  const builders: [Builder, string, [number, number, number]][] = [
    [buildLamp, 'lamp', [0.4, 1.6, 0.4]],
    [buildPendant, 'pendant', [0.4, 0.8, 0.4]],
    [buildCeilingLight, 'ceiling_light', [0.5, 0.12, 0.5]],
  ];
  for (const [build, name, dims] of builders) root.add(build(asset(name, dims), kit));
  return root;
}

function lightsOf(root: THREE.Object3D): THREE.Light[] {
  const out: THREE.Light[] = [];
  root.traverse((object) => {
    if ((object as THREE.Light).isLight) out.push(object as THREE.Light);
  });
  return out;
}

const luminance = (colour: THREE.Color): number => 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;

describe('the bank lamps', () => {
  test('every point light of the three light builders is tagged with its original colour', () => {
    const lights = lightsOf(bankLamps());
    expect(lights).toHaveLength(3);
    for (const light of lights) {
      expect(isArtificialLight(light)).toBe(true);
      expect(light.userData[ARTIFICIAL_LIGHT_KEY]).toEqual({ colour: light.color.toArray() });
    }
  });
});

describe('tintArtificialLights', () => {
  test('a temperature keeps each light luminance and takes the hue of the temperature', () => {
    const root = bankLamps();
    const before = lightsOf(root).map((light) => light.color.clone());
    tintArtificialLights(root, 2700);
    const unit = colourTemperatureRgb(2700);
    lightsOf(root).forEach((light, i) => {
      expect(luminance(light.color)).toBeCloseTo(luminance(before[i]!), 9);
      expect(light.color.r / light.color.g).toBeCloseTo(unit[0] / unit[1], 9);
      expect(light.color.b / light.color.g).toBeCloseTo(unit[2] / unit[1], 9);
    });
  });

  test('«Original» restores every colour exactly, also after several temperatures', () => {
    const root = bankLamps();
    const before = lightsOf(root).map((light) => light.color.toArray());
    tintArtificialLights(root, 6500);
    tintArtificialLights(root, 3100);
    tintArtificialLights(root, null);
    expect(lightsOf(root).map((light) => light.color.toArray())).toEqual(before);
  });

  test('leaves untagged lights alone and answers how many it tinted', () => {
    const root = bankLamps();
    const sun = new THREE.DirectionalLight('#fff4e6', 3);
    const ambient = new THREE.AmbientLight(0xffffff, 0.05);
    tagArtificialLight(ambient);
    root.add(sun, ambient);
    const sunBefore = sun.color.toArray();
    expect(tintArtificialLights(root, 4000)).toBe(4);
    expect(sun.color.toArray()).toEqual(sunBefore);
    const unit = colourTemperatureRgb(4000);
    expect(ambient.color.toArray()).toEqual([...unit]);
  });
});

describe('LightTemperature', () => {
  function setup() {
    const scene = new THREE.Scene();
    scene.add(bankLamps());
    let draws = 0;
    const temperature = new LightTemperature({ scene: () => scene, invalidate: () => (draws += 1) });
    return { scene, temperature, draws: () => draws };
  }

  test('starts at «Original» and changes nothing until set', () => {
    const { scene, temperature, draws } = setup();
    const before = lightsOf(scene).map((light) => light.color.toArray());
    expect(temperature.value).toBeNull();
    expect(temperature.set(null)).toBe(false);
    expect(lightsOf(scene).map((light) => light.color.toArray())).toEqual(before);
    expect(draws()).toBe(0);
  });

  test('a change tints the scene and asks for a draw; the same value again does nothing', () => {
    const { scene, temperature, draws } = setup();
    expect(temperature.set(3000)).toBe(true);
    expect(temperature.value).toBe(3000);
    expect(draws()).toBe(1);
    const tinted = lightsOf(scene)[0]!.color.clone();
    expect(tinted.r).toBeGreaterThan(tinted.b);
    expect(temperature.set(3000)).toBe(false);
    expect(draws()).toBe(1);
  });

  test('a root built later, or a swapped lamp, takes the current value', () => {
    const { temperature } = setup();
    temperature.set(2700);
    const later = bankLamps();
    temperature.apply(later);
    const unit = colourTemperatureRgb(2700);
    for (const light of lightsOf(later)) expect(light.color.r / light.color.g).toBeCloseTo(unit[0] / unit[1], 9);
  });

  test('an offscreen scene of its own (a default-state capture) is tinted too', () => {
    const { temperature } = setup();
    temperature.set(6500);
    const offscreen = new THREE.Scene();
    offscreen.add(bankLamps());
    temperature.apply(offscreen);
    const unit = colourTemperatureRgb(6500);
    for (const light of lightsOf(offscreen)) expect(light.color.b / light.color.g).toBeCloseTo(unit[2] / unit[1], 9);
  });
});
