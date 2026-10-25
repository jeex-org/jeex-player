import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { HdriSky, type HdriContent } from './hdri-sky.js';
import { LIGHTING_STANDARD } from '../../lighting/lighting-standard.js';

type Sun = { overrides: Array<number | null>; override(elevation: number | null): void };

function world() {
  const scene = new THREE.Scene();
  const gradient = new THREE.Texture();
  scene.background = gradient;
  scene.backgroundIntensity = 0.8;
  scene.backgroundBlurriness = 0.1;
  scene.backgroundRotation.set(0, 0.3, 0);
  const recipe = new THREE.Texture();
  scene.environment = recipe;
  scene.environmentIntensity = 0.977;
  scene.environmentRotation.set(0, 0.2, 0);
  const fog = new THREE.Fog(0xc6b8a3, 34, 72);
  scene.fog = fog;
  const sunLight = new THREE.DirectionalLight(0xfff4e6, 3);
  sunLight.name = 'jeex-lighting-sun';
  scene.add(sunLight);
  const exterior: { texture: THREE.Data3DTexture } = { texture: new THREE.Data3DTexture(new Uint16Array(2 * 2 * 2 * 4 * 9), 2, 2 * 9, 2) };
  exterior.texture.type = THREE.HalfFloatType;
  const renderer = { toneMappingExposure: 1 };
  const sun: Sun = {
    overrides: [],
    override(elevation) {
      this.overrides.push(elevation);
    },
  };
  const sky = new HdriSky({ scene, renderer, exterior: () => exterior, sun: () => sun });
  const environment = new THREE.Texture();
  environment.mapping = THREE.CubeUVReflectionMapping;
  const display = new THREE.Texture();
  const content: HdriContent = {
    environment: { texture: environment, gain: 1.4, sunIntensity: 7 },
    sky: { texture: display },
    view: { rotationY: 1.2, elevationDeg: 43, colourLinear: [1, 0.9, 0.8] },
  };
  return { scene, gradient, recipe, fog, sunLight, exterior, renderer, sun, sky, environment, display, content };
}

function snapshot(w: ReturnType<typeof world>) {
  const { scene } = w;
  return {
    background: scene.background,
    backgroundIntensity: scene.backgroundIntensity,
    backgroundBlurriness: scene.backgroundBlurriness,
    backgroundRotation: scene.backgroundRotation.toArray(),
    environment: scene.environment,
    environmentIntensity: scene.environmentIntensity,
    environmentRotation: scene.environmentRotation.toArray(),
    fog: scene.fog,
    sunColour: w.sunLight.color.getHex(),
    sunIntensity: w.sunLight.intensity,
    exterior: w.exterior.texture,
  };
}

describe('HdriSky', () => {
  test('off, display, off restores every value it touched, exactly', () => {
    const w = world();
    const before = snapshot(w);
    w.sky.install(w.content);
    w.sky.apply('display');
    expect(snapshot(w)).not.toEqual(before);
    w.sky.apply('off');
    expect(snapshot(w)).toEqual(before);
    expect(w.sun.overrides).toEqual([43, null]);
  });

  test('display: the sky at skyBrightness over the exposure, both rotations, the HDRI environment and gain, no fog, the HDRI sun', () => {
    const w = world();
    w.renderer.toneMappingExposure = 3.5;
    w.sky.install(w.content);
    w.sky.apply('display');
    const { scene } = w;
    expect(scene.background).toBe(w.display);
    expect(scene.backgroundIntensity).toBeCloseTo(LIGHTING_STANDARD.hdri.skyBrightness / 3.5, 12);
    expect(scene.backgroundRotation.y).toBe(1.2);
    expect(scene.backgroundBlurriness).toBe(0);
    expect(scene.environment).toBe(w.environment);
    expect(scene.environmentIntensity).toBe(1.4);
    expect(scene.environmentRotation.y).toBe(1.2);
    expect(scene.fog).toBeNull();
    expect(w.sunLight.intensity).toBe(7);
    expect(w.sunLight.color.toArray()).toEqual([1, 0.9, 0.8]);
    expect(w.exterior.texture).not.toBe(snapshot(world()).exterior);
    expect(Array.from(w.exterior.texture.image.data as Uint16Array).every((v) => v === 0)).toBe(true);
    expect(w.sky.ownsBackground).toBe(true);
  });

  test('capture: the PMREM as background at the environment gain, never the display sky', () => {
    const w = world();
    w.sky.install(w.content);
    w.sky.apply('capture');
    expect(w.scene.background).toBe(w.environment);
    expect(w.scene.backgroundIntensity).toBe(1.4);
    expect(w.scene.backgroundRotation.y).toBe(1.2);
    expect(w.scene.fog).toBeNull();
    expect(w.sky.ownsBackground).toBe(false);
  });

  test('sky-only: the display sky and no fog; environment, sun and exterior untouched', () => {
    const w = world();
    const before = snapshot(w);
    w.sky.install({ sky: w.content.sky, view: w.content.view });
    w.sky.apply('sky-only');
    const now = snapshot(w);
    expect(now.background).toBe(w.display);
    expect(now.fog).toBeNull();
    expect(now.environment).toBe(before.environment);
    expect(now.environmentIntensity).toBe(before.environmentIntensity);
    expect(now.sunIntensity).toBe(before.sunIntensity);
    expect(now.exterior).toBe(before.exterior);
    expect(w.sun.overrides).toEqual([]);
    w.sky.apply('off');
    expect(snapshot(w)).toEqual(before);
  });

  test('capture and display alternate without losing the editing values', () => {
    const w = world();
    const before = snapshot(w);
    w.sky.install(w.content);
    for (const state of ['capture', 'off', 'capture', 'display', 'capture', 'display'] as const) w.sky.apply(state);
    w.sky.apply('off');
    expect(snapshot(w)).toEqual(before);
  });

  test('a new view turns sky and environment while shown', () => {
    const w = world();
    w.sky.install(w.content);
    w.sky.apply('display');
    w.sky.setView({ rotationY: -0.5, elevationDeg: 40, colourLinear: [1, 1, 1] });
    expect(w.scene.backgroundRotation.y).toBe(-0.5);
    expect(w.scene.environmentRotation.y).toBe(-0.5);
    expect(w.sun.overrides.at(-1)).toBe(40);
  });

  test('install(null) while shown restores first', () => {
    const w = world();
    const before = snapshot(w);
    w.sky.install(w.content);
    w.sky.apply('display');
    w.sky.install(null);
    expect(snapshot(w)).toEqual(before);
    expect(w.sky.state).toBe('off');
  });

  test('without content every state is off', () => {
    const w = world();
    const before = snapshot(w);
    w.sky.apply('display');
    expect(snapshot(w)).toEqual(before);
    expect(w.sky.state).toBe('off');
  });
});
