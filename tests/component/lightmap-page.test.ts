/**
 * The atlas page as the GPU holds it: the calibration page loads exactly the
 * levels up to its mip limit, every uploaded byte equals the independently
 * decoded file (small M values included), and an asymmetric image reads back
 * unflipped and untransposed, both fetched texel by texel and sampled through
 * UV1.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { decodeLevel, lightmapTexture } from '../../src/lightmap/lightmap-page.js';
import { GOLDEN_LEVELS } from '../fixtures/lightmap-calibration/calibration-facts.js';
import { FIXTURE, closeRenderers, hexDigest, loadCalibration, readLevel, renderLinear, renderer } from './lightmap-support.js';

afterEach(closeRenderers);

/** The asymmetric 4 × 2 fixture's RGBA, row 0 (top) first; the last texel has a straight alpha of 40. */
const ASYMMETRIC = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
  [255, 0, 255, 255],
  [0, 255, 255, 255],
  [128, 128, 128, 255],
  [10, 20, 30, 40],
];

describe('lightmap page', () => {
  test('the calibration page holds levels 0 to 3 at their sizes, linear, unflipped, on channel 1', async () => {
    const loaded = await loadCalibration();
    const [page] = loaded.pages;
    expect(page!.levels).toBe(4);
    const { texture } = page!;
    expect((texture.mipmaps as unknown as ImageBitmap[]).map((level) => [level.width, level.height])).toEqual([
      [512, 512],
      [256, 256],
      [128, 128],
      [64, 64],
    ]);
    expect(texture.image).toBe(texture.mipmaps[0]);
    expect([texture.colorSpace, texture.flipY, texture.premultiplyAlpha, texture.generateMipmaps, texture.channel]).toEqual([
      THREE.NoColorSpace,
      false,
      false,
      false,
      1,
    ]);
    loaded.dispose();
  });

  test('every uploaded byte of levels 0 to 3 equals the independently decoded file', async () => {
    const gl = renderer();
    const loaded = await loadCalibration();
    const { texture } = loaded.pages[0]!;
    for (const golden of GOLDEN_LEVELS) {
      const bytes = readLevel(gl, texture, golden.level, golden.width, golden.height);
      for (const [x, y, ...rgbm] of golden.texels) {
        const at = 4 * (y! * golden.width + x!);
        expect({ level: golden.level, x, y, bytes: [...bytes.subarray(at, at + 4)] }).toEqual({ level: golden.level, x, y, bytes: rgbm });
      }
      expect({ level: golden.level, sha256: await hexDigest(bytes) }).toEqual({ level: golden.level, sha256: golden.sha256 });
    }
    loaded.dispose();
  });

  test('an asymmetric image reads back in its own row and column order, and samples that way through UV1', async () => {
    const gl = renderer();
    const blob = await (await fetch(new URL('asymmetric-4x2.webp', FIXTURE))).blob();
    const image = await decodeLevel(blob);
    const texture = lightmapTexture([image]);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    const bytes = readLevel(gl, texture, 0, 4, 2);
    expect(Array.from({ length: 8 }, (_, i) => [...bytes.subarray(4 * i, 4 * i + 4)])).toEqual(ASYMMETRIC);

    // Sampled through UV1 the glTF way (v = 0 at the image's top), seen on screen with v growing downwards.
    const geometry = new THREE.PlaneGeometry(2, 2);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const uv1 = uv.clone();
    for (let i = 0; i < uv1.count; i++) uv1.setY(i, 1 - uv.getY(i));
    geometry.setAttribute('uv1', uv1);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { map: { value: texture } },
      vertexShader: 'in vec2 uv1; out vec2 vUv1; void main() { vUv1 = uv1; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: 'uniform sampler2D map; in vec2 vUv1; out vec4 sampled; void main() { sampled = texture( map, vUv1 ); }',
      toneMapped: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    const pixels = renderLinear(gl, scene, new THREE.Camera(), 4, 2);
    // Screen row 1 (the top) shows image row 0; screen column 0 shows image column 0.
    const screen = (col: number, row: number): number[] =>
      [...pixels.subarray(4 * (row * 4 + col), 4 * (row * 4 + col) + 4)].map((v) => Math.round(v * 255));
    expect(screen(0, 1)).toEqual(ASYMMETRIC[0]);
    expect(screen(3, 1)).toEqual(ASYMMETRIC[3]);
    expect(screen(0, 0)).toEqual(ASYMMETRIC[4]);
    expect(screen(3, 0)).toEqual(ASYMMETRIC[7]);
    image.close();
    texture.dispose();
    material.dispose();
    geometry.dispose();
  });

  test('a level file that cannot be fetched fails the load', async () => {
    const { loadLightBake } = await import('../../src/lightmap/light-bake-load.js');
    const missing = async (url: URL): Promise<Blob> => {
      if (url.pathname.endsWith('lightmap-level2.webp')) throw new Error('offline');
      return (await fetch(url)).blob();
    };
    await expect(loadLightBake(new URL('sidecar.json', FIXTURE), new URL('shell.glb', FIXTURE), missing)).rejects.toThrow('failed to load');
  });
});
