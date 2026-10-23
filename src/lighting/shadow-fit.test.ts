/**
 * The shadow frustum fit: every box inside with its padding, texels that follow
 * the plan and the map, the camera basis three uses, the bias rule, every
 * refusal, and agreement with a real three.js shadow camera.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { LightingError } from './lighting-error.js';
import { LIGHTING_STANDARD, type Triple } from './lighting-standard.js';
import { fitShadowFrustum, type ShadowBox, type ShadowFit } from './shadow-fit.js';
import { sunDirection } from './sun-direction.js';

const FIT = LIGHTING_STANDARD.apartment.sun.fit;
const EPS = 1e-9;

function square(side: number, height = 2.7): ShadowBox {
  return { min: [0, 0, 0], max: [side, height, side] };
}

function corners(box: ShadowBox): Triple[] {
  const out: Triple[] = [];
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
  return out;
}

/** A seeded PRNG: tests that render nothing still never use `Math.random`. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fit's camera as three builds it: `lookAt` from the light to the target with the fit's up. */
function viewOf(fit: ShadowFit): THREE.Matrix4 {
  const camera = new THREE.OrthographicCamera(fit.left, fit.right, fit.top, fit.bottom, fit.near, fit.far);
  camera.up.set(...fit.up);
  camera.position.set(...fit.position);
  camera.lookAt(new THREE.Vector3(...fit.target));
  camera.updateMatrixWorld(true);
  return camera.matrixWorldInverse;
}

/** Every corner, in the view space of the fit's camera, with the margin to each of the six planes. */
function margins(fit: ShadowFit, boxes: readonly ShadowBox[]): { lateral: number; depth: number } {
  const view = viewOf(fit);
  let lateral = Number.POSITIVE_INFINITY;
  let depth = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    for (const corner of corners(box)) {
      const v = new THREE.Vector3(...corner).applyMatrix4(view);
      const distance = -v.z;
      lateral = Math.min(lateral, v.x - fit.left, fit.right - v.x, v.y - fit.bottom, fit.top - v.y);
      depth = Math.min(depth, distance - fit.near, fit.far - distance);
    }
  }
  return { lateral, depth };
}

function randomUpward(next: () => number): Triple {
  const azimuth = next() * 2 * Math.PI;
  const elevation = (2 + next() * 88) * (Math.PI / 180);
  return [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
}

function randomBoxes(next: () => number): ShadowBox[] {
  const boxes: ShadowBox[] = [];
  const count = 1 + Math.floor(next() * 6);
  for (let index = 0; index < count; index += 1) {
    const min: Triple = [next() * 20 - 10, next() * 2 - 0.5, next() * 20 - 10];
    boxes.push({ min, max: [min[0] + next() * 8, min[1] + next() * 3, min[2] + next() * 8] });
  }
  return boxes;
}

function refused(run: () => unknown): LightingError {
  try {
    run();
  } catch (error) {
    if (error instanceof LightingError) return error;
    throw error;
  }
  throw new Error('expected a LightingError');
}

describe('fitShadowFrustum', () => {
  test('every corner of every box lies inside the six planes with the padding to spare, for random upward suns', () => {
    const next = mulberry32(7);
    for (let run = 0; run < 200; run += 1) {
      const boxes = randomBoxes(next);
      const fit = fitShadowFrustum(boxes, randomUpward(next), 2048);
      const { lateral, depth } = margins(fit, boxes);
      expect(lateral).toBeGreaterThanOrEqual(FIT.lateralPadding - 1e-6);
      expect(depth).toBeGreaterThanOrEqual(FIT.depthPadding - 1e-6);
    }
  });

  test('the light is upstream of every box and the near plane at least the minimum', () => {
    const next = mulberry32(11);
    for (let run = 0; run < 50; run += 1) {
      const boxes = randomBoxes(next);
      const direction = randomUpward(next);
      const fit = fitShadowFrustum(boxes, direction, 2048);
      expect(fit.near).toBeGreaterThanOrEqual(FIT.minNear);
      const along = (point: Triple): number => point[0] * direction[0] + point[1] * direction[1] + point[2] * direction[2];
      const lightAlong = along(fit.position);
      for (const box of boxes) for (const corner of corners(box)) expect(lightAlong).toBeGreaterThan(along(corner));
    }
  });

  test('the direction is kept: the light minus its target points along it', () => {
    const direction = sunDirection({ northDeg: 30, sun: 'evening' }).direction;
    const fit = fitShadowFrustum([square(10)], direction, 2048);
    const raw = [0, 1, 2].map((axis) => fit.position[axis]! - fit.target[axis]!);
    const length = Math.hypot(...raw);
    raw.forEach((value, axis) => expect(value / length).toBeCloseTo(direction[axis]!, 9));
  });

  test('a smaller plan gets finer texels', () => {
    const direction = sunDirection({ northDeg: 0, sun: 'noon' }).direction;
    const small = fitShadowFrustum([square(6)], direction, 2048);
    const large = fitShadowFrustum([square(24)], direction, 2048);
    expect(small.texel).toBeLessThan(large.texel);
  });

  test('the world texel is the larger frustum side over the map size', () => {
    const fit = fitShadowFrustum([square(12)], sunDirection({ sun: 'morning' }).direction, 1024);
    expect(fit.texel).toBeCloseTo(Math.max(fit.right - fit.left, fit.top - fit.bottom) / 1024, 12);
  });

  test('a bigger map never raises the normal bias, and both stay within the clamp', () => {
    const direction = sunDirection({ sun: 'evening' }).direction;
    for (const side of [3, 12, 30, 80]) {
      const coarse = fitShadowFrustum([square(side)], direction, 1024);
      const fine = fitShadowFrustum([square(side)], direction, 4096);
      expect(coarse.normalBias).toBeGreaterThanOrEqual(fine.normalBias);
      for (const fit of [coarse, fine]) {
        expect(fit.normalBias).toBeGreaterThanOrEqual(FIT.normalBiasMin);
        expect(fit.normalBias).toBeLessThanOrEqual(FIT.normalBiasMax);
      }
    }
  });

  test('normal bias is half a world texel inside the clamp', () => {
    const fit = fitShadowFrustum([square(20)], sunDirection({ sun: 'noon' }).direction, 1024);
    const expected = Math.min(FIT.normalBiasMax, Math.max(FIT.normalBiasMin, FIT.normalBiasTexels * fit.texel));
    expect(fit.normalBias).toBeCloseTo(expected, 12);
  });

  test('the depth bias is the standard depth offset over the frustum depth, negative', () => {
    const fit = fitShadowFrustum([square(15)], sunDirection({ sun: 'noon' }).direction, 2048);
    expect(fit.bias).toBeCloseTo(-FIT.depthOffset / (fit.far - fit.near), 15);
    expect(fit.bias).toBeLessThan(0);
  });

  test('the camera up is +Y for an ordinary sun', () => {
    const fit = fitShadowFrustum([square(8)], sunDirection({ sun: 'noon' }).direction, 2048);
    expect(fit.up).toEqual([0, 1, 0]);
  });

  test('a sun within one degree of the zenith uses -Z as up, and every box is still inside', () => {
    const boxes = [square(9), { min: [-3, 0, 2], max: [1, 1, 4] } satisfies ShadowBox];
    const tilt = 0.5 * (Math.PI / 180);
    for (const direction of [
      [0, 1, 0],
      [Math.sin(tilt), Math.cos(tilt), 0],
    ] as Triple[]) {
      const fit = fitShadowFrustum(boxes, direction, 2048);
      expect(fit.up).toEqual([0, 0, -1]);
      const { lateral, depth } = margins(fit, boxes);
      expect(lateral).toBeGreaterThanOrEqual(FIT.lateralPadding - 1e-6);
      expect(depth).toBeGreaterThanOrEqual(FIT.depthPadding - 1e-6);
    }
    const twoDegrees = 2 * (Math.PI / 180);
    expect(fitShadowFrustum(boxes, [Math.sin(twoDegrees), Math.cos(twoDegrees), 0], 2048).up).toEqual([0, 1, 0]);
  });

  test('an unnormalised direction is fitted as its unit vector', () => {
    const a = fitShadowFrustum([square(10)], [4.5, 15.5, -11.5], 2048);
    const length = Math.hypot(4.5, 15.5, -11.5);
    const b = fitShadowFrustum([square(10)], [4.5 / length, 15.5 / length, -11.5 / length], 2048);
    for (const key of ['left', 'right', 'top', 'bottom', 'near', 'far'] as const) expect(a[key]).toBeCloseTo(b[key], 9);
  });

  test('a fit applied to a real three.js DirectionalLight projects every corner inside its clip volume', () => {
    const next = mulberry32(23);
    for (let run = 0; run < 40; run += 1) {
      const boxes = randomBoxes(next);
      const direction = run === 0 ? ([0, 1, 0] as Triple) : randomUpward(next);
      const fit = fitShadowFrustum(boxes, direction, 2048);
      const light = new THREE.DirectionalLight();
      light.position.set(...fit.position);
      light.target.position.set(...fit.target);
      const camera = light.shadow.camera;
      camera.up.set(...fit.up);
      Object.assign(camera, { left: fit.left, right: fit.right, top: fit.top, bottom: fit.bottom, near: fit.near, far: fit.far });
      camera.updateProjectionMatrix();
      light.updateMatrixWorld(true);
      light.target.updateMatrixWorld(true);
      light.shadow.updateMatrices(light);
      const clip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      for (const box of boxes) {
        for (const corner of corners(box)) {
          const ndc = new THREE.Vector3(...corner).applyMatrix4(clip);
          for (const axis of [ndc.x, ndc.y, ndc.z]) {
            expect(axis).toBeGreaterThanOrEqual(-1 - EPS);
            expect(axis).toBeLessThanOrEqual(1 + EPS);
          }
        }
      }
    }
  });

  test('every invalid input is refused as bad-options', () => {
    const good = [square(5)];
    const up: Triple = [0, 1, 0];
    const cases: Array<() => unknown> = [
      () => fitShadowFrustum([], up, 2048),
      () => fitShadowFrustum([{ min: [0, 0, Number.NaN], max: [1, 1, 1] }], up, 2048),
      () => fitShadowFrustum([{ min: [0, 0, 0], max: [1, Number.POSITIVE_INFINITY, 1] }], up, 2048),
      () => fitShadowFrustum([{ min: [2, 0, 0], max: [1, 1, 1] }], up, 2048),
      () => fitShadowFrustum(good, [0, 0, 0], 2048),
      () => fitShadowFrustum(good, [Number.NaN, 1, 0], 2048),
      () => fitShadowFrustum(good, [1, 0, 0], 2048),
      () => fitShadowFrustum(good, [0, -1, 0], 2048),
      () => fitShadowFrustum(good, up, 0),
      () => fitShadowFrustum(good, up, 1000.5),
      () => fitShadowFrustum(good, up, -2048),
      () => fitShadowFrustum(good, up, Number.NaN),
    ];
    for (const run of cases) expect(refused(run).code).toBe('bad-options');
  });
});
