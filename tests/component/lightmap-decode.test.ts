/**
 * The RGBM decode in a real WebGL context: a known texel renders as its
 * decoded linear value (no sRGB anywhere, one application of the intensity),
 * and the decode holds when the walk lighting's chunk rewrite runs before or
 * after it.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { LIGHTING_STANDARD } from '../../src/lighting/lighting-standard.js';
import { rgbmDecode } from '../../src/lightmap/rgbm.js';
import { decorateRgbm } from '../../src/lightmap/lightmap-shader.js';
import { addShaderTransform, markBakedSurface } from '../../src/render/baked-surface.js';
import { createWalkUniforms, installWalkPatch, patchFragmentShader } from '../../src/render/walk-lighting/box-probe-patch.js';
import { closeRenderers, renderLinear, renderer } from './lightmap-support.js';

afterEach(closeRenderers);

// M = 96 scales by 3.01: a choice where a missing decode cannot pass by coincidence (M = 32 scales by 1.004).
const BYTES = [128, 64, 255, 96] as const;

/** A 1 × 1 RGBM lightmap of `BYTES`, uploaded the way a page is: linear, unflipped, straight alpha, channel 1. */
function knownTexel(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(BYTES), 1, 1);
  texture.colorSpace = THREE.NoColorSpace;
  texture.channel = 1;
  texture.needsUpdate = true;
  return texture;
}

/** A white zero-specular square lit only by `material`'s lightmap, read back linear at its centre. */
function readCentre(material: THREE.MeshPhysicalMaterial): [number, number, number] {
  const gl = renderer();
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 5);
  const pixels = renderLinear(gl, scene, camera, 8, 8);
  const at = 4 * (4 * 8 + 4);
  geometry.dispose();
  return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
}

function whiteLambert(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 1, specularIntensity: 0 });
  material.lightMap = knownTexel();
  material.lightMapIntensity = Math.PI;
  return material;
}

/** What a white Lambert surface shows for lightmap value E/π stored as RGBM: E/π itself. */
const expected = rgbmDecode(BYTES, 8);

describe('RGBM decode', () => {
  test('a known texel renders as its RGBM decode, not as RGB alone and not sRGB-decoded', () => {
    const material = whiteLambert();
    decorateRgbm(material, 8);
    const got = readCentre(material);
    for (let c = 0; c < 3; c++) expect(Math.abs(got[c]! / expected[c]! - 1)).toBeLessThan(0.005);
    // Without the decode the shader shows rgb alone.
    const plain = readCentre(whiteLambert());
    expect(plain[0]).toBeCloseTo(128 / 255, 2);
    // An sRGB decode of the colour bytes would read 0.216 instead of 0.502 for 128: more than half off.
    const srgb = (byte: number): number => ((byte / 255 + 0.055) / 1.055) ** 2.4;
    expect(Math.abs(got[0] - srgb(128) * (96 / 255) * 8)).toBeGreaterThan(0.1 * expected[0]);
  });

  test('the decode holds with the walk lighting chunk rewrite composed before it and after it', () => {
    for (const order of ['walk first', 'decode first'] as const) {
      const material = whiteLambert();
      const walk = (): void =>
        addShaderTransform(material, 'walk-test', 1, (shader) => void (shader.fragmentShader = patchFragmentShader(shader.fragmentShader)));
      if (order === 'walk first') walk();
      decorateRgbm(material, 8);
      if (order === 'decode first') walk();
      const got = readCentre(material);
      expect({ order, ok: Math.abs(got[0] / expected[0] - 1) < 0.005 }).toEqual({ order, ok: true });
    }
  });

  test('the decode holds when a composer has already expanded the lightmap pars and maps chunks', () => {
    const material = whiteLambert();
    addShaderTransform(material, 'expand-test', 1, (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lightmap_pars_fragment>', THREE.ShaderChunk.lightmap_pars_fragment)
        .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps);
    });
    decorateRgbm(material, 8);
    const got = readCentre(material);
    expect(Math.abs(got[0] / expected[0] - 1)).toBeLessThan(0.005);
  });

  test('the decode holds when the walk lighting installs its patch on a decoded, baked-marked material', () => {
    const material = whiteLambert();
    decorateRgbm(material, 8);
    markBakedSurface(material);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), material));
    expect(installWalkPatch(root, createWalkUniforms())).toBe(1);
    expect(material.customProgramCacheKey()).toMatch(/\|jeex-walk-lighting@4\|jeex-baked-surface@2\|jeex-lightmap-rgbm-r8@1$/);
    // Marked baked, the lightmap carries the editing gain on top of the decode.
    const gain = LIGHTING_STANDARD.baked.exposure.editing;
    const got = readCentre(material);
    for (let c = 0; c < 3; c++) expect(Math.abs(got[c]! / (gain * expected[c]!) - 1)).toBeLessThan(0.005);
  });
});
