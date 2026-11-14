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
import { QUALITY_TIERS } from '../../src/render/quality-tier.js';
import { RenderDemand } from '../../src/render/render-demand.js';
import { gpuResources } from '../../src/render/settle-window.js';
import { closeContainers, openContainer } from './support.js';

const WIDTH = 160;
/**
 * How far a 32-frame mean on half-float targets may sit from the exact one,
 * linear: each blend rounds to half precision (a step of 2^-11 just under 1),
 * and 31 roundings add up to about 0.006 at worst for values around 1.
 */
const HALF_FLOAT_MEAN = 0.01;
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
    pass.allocate(gl, 4, 4);
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
    const mean = accumulate(
      gl,
      Array.from({ length: 32 }, () => [0.4, 2.5, 0.05] as const),
    );
    // Constant input: every blend reads back the value it mixes in, so no rounding builds up.
    expect(Math.abs(mean[0] - 0.4)).toBeLessThan(0.001);
    expect(Math.abs(mean[1] - 2.5)).toBeLessThan(0.002);
    expect(Math.abs(mean[2] - 0.05)).toBeLessThan(0.0001);
  });

  test('two alternating inputs converge to their average', () => {
    const gl = renderer();
    const mean = accumulate(
      gl,
      Array.from({ length: 32 }, (_, frame) => (frame % 2 === 0 ? ([0.2, 1, 0] as const) : ([1.4, 0, 0.6] as const))),
    );
    expect(Math.abs(mean[0] - 0.8)).toBeLessThan(HALF_FLOAT_MEAN);
    expect(Math.abs(mean[1] - 0.5)).toBeLessThan(HALF_FLOAT_MEAN);
    expect(Math.abs(mean[2] - 0.3)).toBeLessThan(HALF_FLOAT_MEAN);
  });

  test('frame 0 starts the mean again: what came before it is forgotten', () => {
    const gl = renderer();
    const pass = new RestAccumulatePass();
    disposers.push(() => pass.dispose());
    pass.allocate(gl, 4, 4);
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

async function chainOn(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, restFrames = 8): Promise<WalkPost> {
  const tier = {
    aoResolutionScale: 1,
    denoise: { depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 },
    gtaoSamples: 16,
    restFrames,
  };
  const chain = await createWalkPost(gl, scene, camera, { tier });
  disposers.push(() => chain.dispose());
  return chain;
}

/** The canvas's pixels now: read in the same task as the draw, before the page presents it. */
function canvasPixels(gl: THREE.WebGLRenderer): Uint8Array {
  const context = gl.getContext();
  const out = new Uint8Array(WIDTH * HEIGHT * 4);
  context.readPixels(0, 0, WIDTH, HEIGHT, context.RGBA, context.UNSIGNED_BYTE, out);
  return out;
}

describe('rest frames through the chain', () => {
  test('a chain on the low tier (no rest frames), drawn as the gate draws a resting walk, shows render(…, null) byte for byte', async () => {
    const gl = renderer();
    const { scene, camera } = mirrorRoom(gl);
    const chain = await chainOn(gl, scene, camera, QUALITY_TIERS.low.restFrames);
    const demand = new RenderDemand();
    const rests: Array<number | null> = [];
    let resting: Uint8Array | null = null;
    // Forty ticks of a walk that rests: the first picture, its steady draw, then nothing.
    for (let tick = 0; tick < 40; tick += 1) {
      if (!demand.shouldDraw(camera, 'walk', chain.restFrames)) continue;
      rests.push(demand.restFrame());
      chain.render(scene, camera, 0, demand.restFrame());
      demand.commit(camera);
      resting = canvasPixels(gl);
    }
    expect(rests).toEqual([null, null]);
    // Nothing was set up for a mean either: its targets keep the size they were made with.
    expect([chain.accumulate.mean.width, chain.accumulate.mean.height]).toEqual([1, 1]);
    chain.render(scene, camera, 0, null);
    const plain = canvasPixels(gl);
    expect(resting!.length).toBe(plain.length);
    expect(resting!.every((value, index) => value === plain[index])).toBe(true);
  });

  test('rest frames bring no GPU resource the settle window counts: the mean comes with the first draw and with a live resize', async () => {
    const gl = renderer();
    const { scene, camera } = mirrorRoom(gl);
    const chain = await chainOn(gl, scene, camera);
    // As the viewer attaches a chain: its programs compiled first.
    await chain.compile(scene, camera);
    /** The settle window's resource count over a draw that answers a change, then over each rest frame. */
    const burst = (): number[] => {
      chain.render(scene, camera, 0);
      const counts = [gpuResources(gl.info)];
      for (let frame = 0; frame < 8; frame += 1) {
        chain.render(scene, camera, 0, frame);
        counts.push(gpuResources(gl.info));
      }
      return counts;
    };
    const first = burst();
    expect(first, 'the first rest after construction').toEqual(first.map(() => first[0]));
    gl.setSize(WIDTH / 2, HEIGHT / 2, false);
    chain.setSize(WIDTH / 2, HEIGHT / 2, 1);
    const resized = burst();
    expect(resized, 'the first rest after a resize').toEqual(resized.map(() => resized[0]));
    expect([chain.accumulate.mean.width, chain.accumulate.mean.height]).toEqual([WIDTH / 2, HEIGHT / 2]);
  });

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
