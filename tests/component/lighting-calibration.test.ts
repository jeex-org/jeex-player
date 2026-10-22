/**
 * The calibration of the lighting standard, against a REAL WebGL context.
 *
 * The fixture is the one the standard defines: a flat square of a standard
 * physically based material, linear base colour 0.18, roughness 1, metalness
 * 0, whose normal points at the reference key, seen by a camera along the same
 * normal. Rendered straight to the canvas — PBR Neutral and the sRGB encoding
 * applied by three — the mean of the central 4 × 4 pixels, decoded from sRGB,
 * must be 0.18 within ±0.0036. This is the test that decides
 * `LIGHTING_STANDARD.environment.normalisation`; the analytic integral in
 * `src/lighting/lighting-standard.test.ts` only keeps it in the neighbourhood.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { createLightingContext, type LightingContext } from '../../src/lighting/lighting-context.js';
import { LIGHTING_STANDARD } from '../../src/lighting/lighting-standard.js';

const SIZE = 64;

const opened: Array<{ renderer: THREE.WebGLRenderer; lighting: LightingContext }> = [];

afterEach(() => {
  for (const { renderer, lighting } of opened.splice(0)) {
    lighting.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
});

/** sRGB-encoded 8-bit value to linear. */
function decode(byte: number): number {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Renders the calibration fixture to the canvas and answers the mean linear value of the central square. */
function renderFixture(): number {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const lighting = createLightingContext(THREE, renderer);
  opened.push({ renderer, lighting });

  const scene = new THREE.Scene();
  lighting.createReferenceRig().attach(scene);
  const { albedo, sample } = LIGHTING_STANDARD.calibration;
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.color.setRGB(albedo, albedo, albedo, THREE.LinearSRGBColorSpace);
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const key = new THREE.Vector3(...LIGHTING_STANDARD.reference.key.position).normalize();
  patch.lookAt(key);
  scene.add(patch);

  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 20);
  camera.position.copy(key).multiplyScalar(4);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);

  // Read in the same task as the render: the canvas keeps no drawing buffer.
  const gl = renderer.getContext();
  const pixels = new Uint8Array(sample * sample * 4);
  const from = SIZE / 2 - sample / 2;
  gl.readPixels(from, from, sample, sample, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let sum = 0;
  for (let at = 0; at < pixels.length; at += 4) sum += (decode(pixels[at]!) + decode(pixels[at + 1]!) + decode(pixels[at + 2]!)) / 3;
  patch.geometry.dispose();
  material.dispose();
  return sum / (sample * sample);
}

describe('lighting calibration', () => {
  test('the grey patch under the reference rig reads 0.18 ± 0.0036', () => {
    const reading = renderFixture();
    const { target, tolerance } = LIGHTING_STANDARD.calibration;
    // Printed so a recalibration can read the measured figure off the run.
    console.info(`lighting calibration: patch reads ${reading.toFixed(5)} (target ${String(target)})`);
    expect(Math.abs(reading - target)).toBeLessThanOrEqual(tolerance);
  });
});
