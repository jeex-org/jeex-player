/**
 * A resting walk or tour converges (`src/render/rest-accumulate-pass.ts`,
 * `src/render/walk-post.ts`), on a real WebGL context: the accumulation keeps
 * a running mean of the linear frames on half-float targets, a mirror still
 * captures once per frame inside the beauty pass, and a still taken between
 * rest frames is neither averaged nor allowed to disturb the mean.
 */

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { afterEach, describe, expect, test } from 'vitest';
import { RestAccumulatePass } from '../../src/render/rest-accumulate-pass.js';
import { createWalkPost, type WalkPost } from '../../src/render/walk-post.js';
import { mainPassOnly } from '../../src/assets/mirror-capture.js';
import { scenePassOf } from '../../src/shared/scene-pass.js';
import { closeContainers, openContainer } from './support.js';

const WIDTH = 160;
const HEIGHT = 120;

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  closeContainers();
});

function renderer(): THREE.WebGLRenderer {
  const container = openContainer(WIDTH, HEIGHT);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
  gl.setPixelRatio(1);
  gl.setSize(WIDTH, HEIGHT, false);
  gl.toneMapping = THREE.NeutralToneMapping;
  disposers.push(() => {
    gl.dispose();
    gl.forceContextLoss();
  });
  return gl;
}

function halfFloatTarget(): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  disposers.push(() => target.dispose());
  return target;
}

/** The linear RGB of the centre texel of a half-float target. */
function texel(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): [number, number, number] {
  const out = new Uint16Array(4);
  gl.readRenderTargetPixels(target, 2, 2, 1, 1, out);
  return [THREE.DataUtils.fromHalfFloat(out[0]!), THREE.DataUtils.fromHalfFloat(out[1]!), THREE.DataUtils.fromHalfFloat(out[2]!)];
}

/** Fills `target` with one linear colour. */
function fill(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, rgb: readonly [number, number, number]): void {
  gl.setRenderTarget(target);
  gl.setClearColor(new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace), 1);
  gl.clear();
  gl.setRenderTarget(null);
}

describe('the running mean on the GPU', () => {
  /** Feeds `inputs` as rest frames 0, 1, … and answers the mean the pass hands on after the last. */
  function accumulate(gl: THREE.WebGLRenderer, inputs: ReadonlyArray<readonly [number, number, number]>): [number, number, number] {
    const pass = new RestAccumulatePass();
    disposers.push(() => pass.dispose());
    pass.setSize(4, 4);
    const read = halfFloatTarget();
    const write = halfFloatTarget();
    inputs.forEach((rgb, frame) => {
      fill(gl, read, rgb);
      pass.frame = frame;
      pass.render(gl, write, read);
    });
    return texel(gl, write);
  }

  test('a constant input converges to itself, highlights above 1 included', () => {
    const gl = renderer();
    const mean = accumulate(gl, Array.from({ length: 32 }, () => [0.4, 2.5, 0.05] as const));
    expect(mean[0]).toBeCloseTo(0.4, 2);
    expect(mean[1]).toBeCloseTo(2.5, 1);
    expect(mean[2]).toBeCloseTo(0.05, 3);
  });

  test('two alternating inputs converge to their average', () => {
    const gl = renderer();
    const mean = accumulate(
      gl,
      Array.from({ length: 32 }, (_, frame) => (frame % 2 === 0 ? ([0.2, 1, 0] as const) : ([1.4, 0, 0.6] as const))),
    );
    expect(mean[0]).toBeCloseTo(0.8, 2);
    expect(mean[1]).toBeCloseTo(0.5, 2);
    expect(mean[2]).toBeCloseTo(0.3, 2);
  });

  test('frame 0 starts the mean again: what came before it is forgotten', () => {
    const gl = renderer();
    const pass = new RestAccumulatePass();
    disposers.push(() => pass.dispose());
    pass.setSize(4, 4);
    const read = halfFloatTarget();
    const write = halfFloatTarget();
    for (const [frame, rgb] of [
      [0, [5, 5, 5]],
      [1, [5, 5, 5]],
      [0, [0.25, 0.5, 0.75]],
    ] as const) {
      fill(gl, read, rgb);
      pass.frame = frame;
      pass.render(gl, write, read);
    }
    const mean = texel(gl, write);
    expect(mean[0]).toBeCloseTo(0.25, 3);
    expect(mean[1]).toBeCloseTo(0.5, 3);
    expect(mean[2]).toBeCloseTo(0.75, 3);
  });
});

/** A small room seen across a mirror, with the mirror's captures counted and the scope each ran in recorded. */
function mirrorRoom(gl: THREE.WebGLRenderer): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; scopes: unknown[] } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const mirror = new Reflector(new THREE.PlaneGeometry(2, 2), { textureWidth: 64, textureHeight: 64, color: 0xffffff });
  mirror.position.set(0, 0, -1);
  disposers.push(() => mirror.dispose());
  const scopes: unknown[] = [];
  const original = mirror.onBeforeRender.bind(mirror);
  mirror.onBeforeRender = mainPassOnly((...args: Parameters<typeof original>) => {
    scopes.push(scenePassOf(gl));
    original(...args);
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 0.5), new THREE.MeshStandardMaterial({ color: '#c04040', roughness: 1 }));
  box.position.set(0, 0, 3);
  scene.add(mirror, box, new THREE.HemisphereLight('#ffffff', '#ffffff', 2));
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 160);
  camera.position.set(0, 0, 1);
  camera.updateMatrixWorld();
  return { scene, camera, scopes };
}

async function chainOn(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<WalkPost> {
  const tier = { aoResolutionScale: 1, denoise: { depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 }, gtaoSamples: 16, restFrames: 8 };
  const chain = await createWalkPost(gl, scene, camera, { tier });
  disposers.push(() => chain.dispose());
  return chain;
}

describe('rest frames through the chain', () => {
  test('a mirror captures once per rest frame, inside the beauty pass and nowhere else', async () => {
    const gl = renderer();
    const { scene, camera, scopes } = mirrorRoom(gl);
    const chain = await chainOn(gl, scene, camera);
    chain.render(scene, camera, 0);
    for (let frame = 0; frame < 8; frame += 1) chain.render(scene, camera, 0, frame);
    expect(scopes).toHaveLength(9);
    for (const scope of scopes) expect(scope).toEqual({ target: expect.any(THREE.WebGLRenderTarget), scene, camera });
  });

  test('a still between rest frames is the still of today, and the mean goes on as if it had not been taken', async () => {
    const gl = renderer();
    const { scene, camera } = mirrorRoom(gl);
    const chain = await chainOn(gl, scene, camera);
    const still = (): Uint8Array => {
      const target = new THREE.WebGLRenderTarget(96, 64);
      try {
        chain.renderTo(target, scene, camera, 96, 64);
        const out = new Uint8Array(96 * 64 * 4);
        gl.readRenderTargetPixels(target, 0, 0, 96, 64, out);
        return out;
      } finally {
        target.dispose();
      }
    };
    /** The accumulated mean after rest frames 0 to 7, the linear picture the output pass reads. */
    const mean = (interrupt: boolean): Uint16Array => {
      chain.render(scene, camera, 0);
      for (let frame = 0; frame < 8; frame += 1) {
        chain.render(scene, camera, 0, frame);
        if (interrupt && frame === 3) stills.push(still());
      }
      const out = new Uint16Array(WIDTH * HEIGHT * 4);
      gl.readRenderTargetPixels(chain.accumulate.mean, 0, 0, WIDTH, HEIGHT, out);
      return out;
    };
    const stills: Uint8Array[] = [];
    chain.render(scene, camera, 0);
    stills.push(still());
    const uninterrupted = mean(false);
    const interrupted = mean(true);
    expect(stills[1]!.every((value, index) => value === stills[0]![index])).toBe(true);
    expect(interrupted.every((value, index) => value === uninterrupted[index])).toBe(true);
  });
});
