/**
 * The shadow-pass adapter with a stub renderer: what it does to the view
 * camera's layer mask around the shadow pass, that it restores it whatever
 * happens, and that installing is idempotent and survives a replaced shadow
 * map. The engine behaviour it exists for is pinned in the browser
 * (`tests/component/sun-shadow.test.ts`).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SHADOW_ONLY_LAYER } from '../shared/render-layers.js';
import { installShadowLayerPass } from './shadow-layer-pass.js';

type Pass = (lights: unknown, scene: unknown, camera: THREE.Camera) => void;

function stubRenderer(pass: Pass): { shadowMap: { render: Pass } } {
  return { shadowMap: { render: pass } };
}

describe('installShadowLayerPass', () => {
  test('the shadow pass sees the shadow-only layer on the view camera, and the mask is back afterwards', () => {
    const seen: boolean[] = [];
    const renderer = stubRenderer((_lights, _scene, camera) => seen.push(camera.layers.isEnabled(SHADOW_ONLY_LAYER)));
    installShadowLayerPass(renderer);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.enable(1);
    const before = camera.layers.mask;
    renderer.shadowMap.render([], new THREE.Scene(), camera);
    expect(seen).toEqual([true]);
    expect(camera.layers.mask).toBe(before);
  });

  test('a camera that already has the layer keeps it', () => {
    const renderer = stubRenderer(() => undefined);
    installShadowLayerPass(renderer);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.enable(SHADOW_ONLY_LAYER);
    renderer.shadowMap.render([], new THREE.Scene(), camera);
    expect(camera.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(true);
  });

  test('the mask is restored when the shadow pass throws, and the error goes on', () => {
    const renderer = stubRenderer(() => {
      throw new Error('lost');
    });
    installShadowLayerPass(renderer);
    const camera = new THREE.PerspectiveCamera();
    const before = camera.layers.mask;
    expect(() => renderer.shadowMap.render([], new THREE.Scene(), camera)).toThrow('lost');
    expect(camera.layers.mask).toBe(before);
  });

  test('installing twice wraps once', () => {
    let calls = 0;
    const renderer = stubRenderer(() => {
      calls += 1;
    });
    installShadowLayerPass(renderer);
    const first = renderer.shadowMap.render;
    installShadowLayerPass(renderer);
    expect(renderer.shadowMap.render).toBe(first);
    renderer.shadowMap.render([], new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(calls).toBe(1);
  });

  test('a replaced shadow map (a context restore) is wrapped exactly once again', () => {
    const renderer: { shadowMap: { render: Pass } } = stubRenderer(() => undefined);
    installShadowLayerPass(renderer);
    const seen: boolean[] = [];
    const raw: Pass = (_lights, _scene, camera) => {
      seen.push(camera.layers.isEnabled(SHADOW_ONLY_LAYER));
    };
    renderer.shadowMap = { render: raw };
    installShadowLayerPass(renderer);
    const installed = renderer.shadowMap.render;
    installShadowLayerPass(renderer);
    expect(installed).not.toBe(raw);
    expect(renderer.shadowMap.render).toBe(installed);
    const camera = new THREE.PerspectiveCamera();
    renderer.shadowMap.render([], new THREE.Scene(), camera);
    // Inside the pass the layer is on, exactly once; outside it is off again.
    expect(seen).toEqual([true]);
    expect(camera.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false);
  });

  test('uninstalling puts the original pass back', () => {
    const original: Pass = () => undefined;
    const renderer = stubRenderer(original);
    const uninstall = installShadowLayerPass(renderer);
    expect(renderer.shadowMap.render).not.toBe(original);
    uninstall();
    expect(renderer.shadowMap.render).toBe(original);
    uninstall();
    expect(renderer.shadowMap.render).toBe(original);
  });
});
