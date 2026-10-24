import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { FILL_LIGHT_NAME, lightMasks } from './light-order.js';

const baked = <T extends THREE.Light>(light: T, value = true): T => {
  light.userData['jeexBaked'] = value;
  return light;
};

describe('lightMasks (three r186.1 WebGLLights order)', () => {
  test('points and spots: 0 baked, 1 live or unmarked, in traversal order', () => {
    const scene = new THREE.Scene();
    scene.add(baked(new THREE.PointLight()), new THREE.PointLight(), baked(new THREE.PointLight(), false));
    scene.add(new THREE.SpotLight(), baked(new THREE.SpotLight()));
    const masks = lightMasks(scene, new THREE.PerspectiveCamera());
    expect(masks.point).toEqual([0, 1, 1]);
    expect(masks.spot).toEqual([1, 0]);
    expect(masks.directional).toEqual([]);
  });

  test('a stable sort: shadow casters with a projected texture, casters, textured, the rest', () => {
    const scene = new THREE.Scene();
    const plain = baked(new THREE.SpotLight());
    const textured = new THREE.SpotLight();
    textured.map = new THREE.Texture();
    const caster = baked(new THREE.SpotLight());
    caster.castShadow = true;
    const both = new THREE.SpotLight();
    both.castShadow = true;
    both.map = new THREE.Texture();
    const second = baked(new THREE.SpotLight());
    second.castShadow = true;
    scene.add(plain, textured, caster, both, second);
    // both (live), caster (baked), second (baked), textured (live), plain (baked)
    expect(lightMasks(scene, new THREE.PerspectiveCamera()).spot).toEqual([1, 0, 0, 1, 0]);
  });

  test('a hidden ancestor drops its subtree; a layer the camera does not see drops only that light', () => {
    const scene = new THREE.Scene();
    const hidden = new THREE.Group();
    hidden.visible = false;
    hidden.add(new THREE.PointLight());
    const layered = new THREE.PointLight();
    layered.layers.set(3);
    const childOfLayered = baked(new THREE.PointLight());
    layered.add(childOfLayered);
    scene.add(hidden, layered, new THREE.PointLight());
    // The layered light is not pushed, its child (layer 0) is.
    expect(lightMasks(scene, new THREE.PerspectiveCamera()).point).toEqual([0, 1]);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.enable(3);
    expect(lightMasks(scene, camera).point).toEqual([1, 0, 1]);
  });

  test('directional: the fill is 0, the sun and the rest 1, whatever casts shadows', () => {
    const scene = new THREE.Scene();
    const fill = new THREE.DirectionalLight();
    fill.name = FILL_LIGHT_NAME;
    fill.castShadow = true;
    const sun = new THREE.DirectionalLight();
    sun.name = 'jeex-lighting-sun';
    scene.add(sun, fill, new THREE.AmbientLight(), new THREE.HemisphereLight());
    expect(lightMasks(scene, new THREE.PerspectiveCamera()).directional).toEqual([0, 1]);
  });
});
