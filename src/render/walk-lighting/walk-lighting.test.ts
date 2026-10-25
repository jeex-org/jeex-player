/**
 * The parts of the room lighting that need no GPU: the uniforms a scene keeps
 * across lightings, and a plan without a closed room. The bake itself is
 * proved in the browser (`tests/component/walk-lighting.test.ts`).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { bakeExclusions, furnitureRenderables, WalkLighting } from './walk-lighting.js';
import { installWalkPatch } from './box-probe-patch.js';

const renderer = () => ({ toneMappingExposure: 1 }) as unknown as THREE.WebGLRenderer;

describe('WalkLighting', () => {
  test('a lighting built after a context restore drives the materials the first one patched', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    const first = new WalkLighting(renderer(), scene);
    installWalkPatch(scene, first.uniforms);
    first.dispose();
    const second = new WalkLighting(renderer(), scene);
    // Already marked, so not patched again: it must be driven by the same uniforms.
    expect(installWalkPatch(scene, second.uniforms)).toBe(0);
    expect(second.uniforms).toBe(first.uniforms);
    second.rig.setState('walk');
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      vertexShader: '',
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms['jeexBoxProbes']!.value).toBe(1);
    second.dispose();
  });

  test('a plan without a closed room bakes nothing and keeps the editing look', () => {
    const scene = new THREE.Scene();
    const lighting = new WalkLighting(renderer(), scene);
    lighting.load({ volumes: { rooms: [], ceilingHeight: 2.6, doors: [], furniture: [] }, furniture: null });
    expect(lighting.phase).toBe('empty');
    lighting.frame(true);
    expect(lighting.rig.state).toBe('editing');
    expect(scene.getObjectByName('walk-lighting-grids')!.children).toHaveLength(0);
    lighting.dispose();
  });

  test('an HDRI over a plan without a closed room shows on eligible frames only, and goes on removal', () => {
    const scene = new THREE.Scene();
    const gradient = new THREE.Texture();
    scene.background = gradient;
    const lighting = new WalkLighting(renderer(), scene);
    lighting.load({ volumes: { rooms: [], ceilingHeight: 2.6, doors: [], furniture: [] }, furniture: null });
    const display = new THREE.Texture();
    lighting.setHdri({
      environment: { texture: new THREE.Texture(), gain: 1, sunIntensity: 2 },
      sky: { texture: display },
      view: { rotationY: 0, elevationDeg: 40, colourLinear: [1, 1, 1] },
    });
    expect(lighting.hdriState).toBe('off');
    lighting.frame(true);
    expect(lighting.hdriState).toBe('display');
    expect(scene.background).toBe(display);
    lighting.frame(false);
    expect(lighting.hdriState).toBe('off');
    expect(scene.background).toBe(gradient);
    lighting.frame(true);
    lighting.setHdri(null);
    expect(lighting.hdriState).toBe('off');
    expect(scene.background).toBe(gradient);
    lighting.dispose();
  });
});

describe('grid bake exclusions', () => {
  /** A scene with a furniture group holding an opaque body, a transmissive body and a mirror-like reflector, each over a lamp, plus a glass pane and a reflector outside it. */
  function scene() {
    const root = new THREE.Scene();
    const furniture = new THREE.Group();
    root.add(furniture);
    const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    body.add(new THREE.PointLight());
    const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial({ transmission: 1 }));
    glass.add(new THREE.PointLight());
    const reflector = Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()), { isReflector: true });
    const group = new THREE.Group();
    group.add(body, glass, reflector);
    furniture.add(group);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshPhysicalMaterial({ transmission: 1 }));
    const wallMirror = Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()), { isReflector: true });
    root.add(pane, wallMirror);
    return { root, furniture, body, glass, reflector, pane, wallMirror };
  }

  test('nothing under the furniture group is hidden by visibility; mirrors and glass outside it are', () => {
    const { root, furniture, pane, wallMirror } = scene();
    const hidden = bakeExclusions(root, furniture);
    expect(hidden).toContain(pane);
    expect(hidden).toContain(wallMirror);
    for (const object of hidden) {
      let inFurniture = false;
      object.traverseAncestors((ancestor) => (inFurniture ||= ancestor === furniture));
      expect(object === furniture || inFurniture).toBe(false);
    }
  });

  test('every renderable under the furniture group leaves the capture by its layers, transmissive and mirror included', () => {
    const { furniture, body, glass, reflector } = scene();
    expect(new Set(furnitureRenderables(furniture))).toEqual(new Set([body, glass, reflector]));
    expect(furnitureRenderables(null)).toEqual([]);
  });
});
