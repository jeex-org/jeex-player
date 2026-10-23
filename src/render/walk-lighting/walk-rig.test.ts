import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { WalkRig } from './walk-rig.js';
import { createWalkUniforms } from './box-probe-patch.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';

function setup() {
  const scene = new THREE.Scene();
  const sky = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
  sky.name = 'jeex-lighting-sky';
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.name = 'jeex-lighting-fill';
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.name = 'jeex-lighting-sun';
  scene.add(sky, fill, sun);
  const renderer = { toneMappingExposure: 1 };
  const uniforms = createWalkUniforms();
  const rig = new WalkRig({ scene, renderer, uniforms });
  return { scene, sky, fill, sun, renderer, uniforms, rig };
}

describe('WalkRig', () => {
  test('starts in the editing state with an ambient light at zero and everything else untouched', () => {
    const { scene, sky, fill, renderer, rig } = setup();
    expect(rig.state).toBe('editing');
    const ambient = scene.children.find((child) => (child as THREE.AmbientLight).isAmbientLight) as THREE.AmbientLight;
    expect(ambient.intensity).toBe(0);
    expect([sky.intensity, fill.intensity, renderer.toneMappingExposure]).toEqual([0.9, 0.4, 1]);
  });

  test('capture: hemisphere and fill at zero, no ambient floor, standard exposure, diffuse off', () => {
    const { sky, fill, sun, renderer, uniforms, rig } = setup();
    rig.setState('capture');
    expect([sky.intensity, fill.intensity, sun.intensity]).toEqual([0, 0, 3]);
    expect(rig.ambient.intensity).toBe(0);
    expect(renderer.toneMappingExposure).toBe(1);
    expect([uniforms.jeexDiffuse.value, uniforms.jeexBoxProbes.value]).toEqual([0, 0]);
  });

  test('walk: the ambient floor and the walk exposure on, box probes on', () => {
    const { sky, renderer, uniforms, rig } = setup();
    rig.setState('walk');
    expect(sky.intensity).toBe(0);
    expect(rig.ambient.intensity).toBe(T.ambientFloor);
    expect(renderer.toneMappingExposure).toBe(T.walkExposure);
    expect(uniforms.jeexBoxProbes.value).toBe(1);
  });

  test('back to editing restores every value exactly, also through capture and walk', () => {
    const { sky, fill, renderer, uniforms, rig } = setup();
    rig.setState('capture');
    rig.setState('walk');
    rig.setState('capture');
    rig.setState('editing');
    expect([sky.intensity, fill.intensity, renderer.toneMappingExposure, rig.ambient.intensity]).toEqual([0.9, 0.4, 1, 0]);
    expect([uniforms.jeexDiffuse.value, uniforms.jeexBoxProbes.value]).toEqual([1, 0]);
  });

  test('re-applies the state to a rig the runtime replaced after a context restore', () => {
    const { scene, sky, fill, renderer, rig } = setup();
    rig.setState('walk');
    // The restore builds new lights at the standard's values and resets the exposure.
    scene.remove(sky, fill);
    const sky2 = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
    sky2.name = 'jeex-lighting-sky';
    scene.add(sky2);
    renderer.toneMappingExposure = 1;
    rig.reapply();
    expect(sky2.intensity).toBe(0);
    expect(renderer.toneMappingExposure).toBe(T.walkExposure);
    rig.setState('editing');
    expect(sky2.intensity).toBe(0.9);
    expect(renderer.toneMappingExposure).toBe(1);
  });

  test('dispose returns to the editing look and removes the ambient light', () => {
    const { scene, sky, rig } = setup();
    rig.setState('walk');
    rig.dispose();
    expect(sky.intensity).toBe(0.9);
    expect(scene.children.some((child) => (child as THREE.AmbientLight).isAmbientLight)).toBe(false);
  });
});
