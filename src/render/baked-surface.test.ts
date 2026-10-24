/**
 * The baked-surface marks: a material is a baked surface only once marked, a
 * lamp is live until it is marked baked, and marking touches nothing else.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { addShaderTransform, isBakedSurface, markBakedSurface, setLampBaked } from './baked-surface.js';

describe('baked surface marks', () => {
  test('a material is a baked surface only after it is marked', () => {
    const material = new THREE.MeshStandardMaterial();
    const before = material.version;
    expect(isBakedSurface(material)).toBe(false);
    markBakedSurface(material);
    expect(isBakedSurface(material)).toBe(true);
    expect(material.userData).toEqual({ jeexBakedSurface: true });
    expect(material.version).toBe(before);
    expect(isBakedSurface(new THREE.MeshBasicMaterial())).toBe(false);
  });

  test('a lamp is marked baked or live, and nothing else changes', () => {
    const lamp = new THREE.PointLight(0xffffff, 2);
    setLampBaked(lamp, true);
    expect(lamp.userData).toEqual({ jeexBaked: true });
    setLampBaked(lamp, false);
    expect(lamp.userData).toEqual({ jeexBaked: false });
    expect(lamp.intensity).toBe(2);
  });

  test('two transforms on one material both apply, in order, and the key names both', () => {
    const material = new THREE.MeshStandardMaterial();
    const defaultKey = material.customProgramCacheKey();
    const order: string[] = [];
    addShaderTransform(material, 'first', 2, (shader) => {
      order.push('first');
      shader.fragmentShader += '//first';
    });
    addShaderTransform(material, 'second', 1, (shader) => {
      order.push('second');
      shader.fragmentShader += '//second';
    });
    const shader = { fragmentShader: '', vertexShader: '', uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, undefined as never);
    expect(order).toEqual(['first', 'second']);
    expect(shader.fragmentShader).toBe('//first//second');
    expect(material.customProgramCacheKey()).toBe(`${defaultKey}|first@2|second@1`);
  });

  test('a transform runs after a hook the material already had and keeps its key', () => {
    const material = new THREE.MeshStandardMaterial();
    const order: string[] = [];
    material.onBeforeCompile = () => void order.push('own');
    material.customProgramCacheKey = () => 'own-key';
    addShaderTransform(material, 'next', 1, () => void order.push('next'));
    material.onBeforeCompile({} as never, undefined as never);
    expect(order).toEqual(['own', 'next']);
    expect(material.customProgramCacheKey()).toBe('own-key|next@1');
  });
});
