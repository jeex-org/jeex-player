/**
 * The walk chain's glow stage (`src/render/glow-pass.ts`, `src/render/walk-post.ts`)
 * on a real WebGL context, over small scenes of the test's own: off is the
 * picture without the stage byte for byte, the glow of a resting view is the
 * glow of the rest mean (not the mean of glows), a still carries the glow the
 * live view shows, the stage adds no draw and no mirror capture, and its
 * targets follow a resize and a context restore.
 *
 * The bright source is an unlit quad far over the stage's threshold (the
 * lighting standard's numbers, `WALK_POST_TUNING.bloom`) in a dim grey room;
 * the renderer's exposure is 1 and the white balance the identity, so the
 * threshold in the linear picture is the display one.
 */

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createWalkPost, WALK_POST_TUNING, WalkPost, type WalkPostTierInputs } from '../../src/render/walk-post.js';
import { QUALITY_TIERS } from '../../src/render/quality-tier.js';
import { RenderDemand } from '../../src/render/render-demand.js';
import { createRenderRuntime } from '../../src/render/render-runtime.js';
import { loadWalkPost, WalkPostController } from '../../src/app/walk-post-controller.js';
import { mainPassOnly } from '../../src/assets/mirror-capture.js';
import { scenePassOf } from '../../src/shared/scene-pass.js';
import type { Mat3 } from '../../src/render/white-balance.js';
import { closeContainers, openContainer, until } from './support.js';

const WIDTH = 160;
const HEIGHT = 120;
/** A 32-frame mean on half-float targets sits this close to the exact one (`rest-accumulation.test.ts`). */
const HALF_FLOAT_MEAN = 0.01;
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
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

/** The tier's post inputs as the quality control hands them, with `restFrames` rest frames. */
function tier(name: 'high' | 'low', restFrames = 8): WalkPostTierInputs {
  return { ...QUALITY_TIERS[name], denoise: { ...QUALITY_TIERS[name].denoise }, restFrames };
}

async function chainOn(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, inputs: WalkPostTierInputs): Promise<WalkPost> {
  const chain = await createWalkPost(gl, scene, camera, { whiteBalance: IDENTITY, tier: inputs });
  disposers.push(() => chain.dispose());
  return chain;
}

/** Twenty times the threshold: a bulb seen bare. */
const SOURCE = 20 * WALK_POST_TUNING.bloom.threshold;

/** A dim grey room with a small unlit quad of `SOURCE` linear in the middle of the view. */
function glowRoom(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(6, 4, 6),
    new THREE.MeshStandardMaterial({ color: '#808080', roughness: 1, side: THREE.BackSide }),
  );
  const bulb = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(SOURCE, SOURCE, SOURCE, THREE.LinearSRGBColorSpace) }),
  );
  bulb.position.set(0, 0, -2.9);
  scene.add(room, bulb, new THREE.HemisphereLight('#ffffff', '#ffffff', 0.3));
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 50);
  camera.position.set(0, 0, 1);
  camera.updateMatrixWorld();
  return { scene, camera };
}

/** The canvas's pixels now: read in the same task as the draw, before the page presents it. */
function canvasPixels(gl: THREE.WebGLRenderer): Uint8Array {
  const context = gl.getContext();
  const out = new Uint8Array(WIDTH * HEIGHT * 4);
  context.readPixels(0, 0, WIDTH, HEIGHT, context.RGBA, context.UNSIGNED_BYTE, out);
  return out;
}

/** A still through the chain at the canvas's size, rows from the bottom like the canvas read. */
function still(gl: THREE.WebGLRenderer, chain: WalkPost, scene: THREE.Scene, camera: THREE.Camera): Uint8Array {
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT);
  try {
    chain.renderTo(target, scene, camera, WIDTH, HEIGHT);
    const out = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, out);
    return out;
  } finally {
    target.dispose();
  }
}

/** The red channel at `(x, y)` from the bottom-left of a picture read as above. */
const red = (pixels: Uint8Array, x: number, y: number): number => pixels[(y * WIDTH + x) * 4]!;
/** Beside the source, inside its halo: the source covers about 8 pixels across the middle. */
const HALO = { x: WIDTH / 2 + 10, y: HEIGHT / 2 };

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

describe('off is the picture without the stage', () => {
  test('a low-tier chain draws, and captures, byte for byte what the chain draws with the stage taken out; high glows', async () => {
    const gl = renderer();
    const { scene, camera } = glowRoom();
    const low = await chainOn(gl, scene, camera, tier('low'));
    low.render(scene, camera, 0);
    const live = canvasPixels(gl);
    const shot = still(gl, low, scene, camera);
    // The chain as it was before the stage existed: the same passes without it.
    low.composer.passes.splice(low.composer.passes.indexOf(low.bloom), 1);
    low.render(scene, camera, 0);
    expect(same(canvasPixels(gl), live)).toBe(true);
    expect(same(still(gl, low, scene, camera), shot)).toBe(true);

    const high = await chainOn(gl, scene, camera, tier('high'));
    high.render(scene, camera, 0);
    expect(red(canvasPixels(gl), HALO.x, HALO.y) - red(live, HALO.x, HALO.y)).toBeGreaterThan(10);
  });
});

describe('a resting view glows on the mean', () => {
  /**
   * A view filled by one unlit plane whose brightness the test sets per rest
   * frame, drawn through a high-tier chain whose output pass is left out, so
   * the composer's read buffer holds the linear picture after the glow.
   */
  async function plane(gl: THREE.WebGLRenderer): Promise<{ chain: WalkPost; draw: (values: number[]) => [number, number] }> {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), material);
    mesh.position.set(0, 0, -2);
    scene.add(mesh);
    const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 50);
    camera.position.set(0, 0, 1);
    camera.updateMatrixWorld();
    const chain = await chainOn(gl, scene, camera, tier('high'));
    chain.output.enabled = false;
    chain.composer.renderToScreen = false;
    const centre = (target: THREE.WebGLRenderTarget): number => {
      const out = new Uint16Array(4);
      gl.readRenderTargetPixels(target, WIDTH / 2, HEIGHT / 2, 1, 1, out);
      return THREE.DataUtils.fromHalfFloat(out[0]!);
    };
    /** Rest frames 0, 1, … with the plane at `values`; answers the picture after the glow and the mean, at the centre. */
    const draw = (values: number[]): [number, number] => {
      chain.render(scene, camera, 0);
      values.forEach((value, frame) => {
        material.color.setRGB(value, value, value, THREE.LinearSRGBColorSpace);
        chain.render(scene, camera, 0, frame);
      });
      return [centre(chain.composer.readBuffer), centre(chain.accumulate.mean)];
    };
    return { chain, draw };
  }

  test('frames alternating over and under the threshold, whose mean is under it, show the mean without glow', async () => {
    const gl = renderer();
    const { draw } = await plane(gl);
    const T = WALK_POST_TUNING.bloom.threshold;
    // Every frame at 1.8 T: each glows, and the stage adds its glow to the picture.
    const [steady, steadyMean] = draw(Array.from({ length: 8 }, () => 1.8 * T));
    const glow = steady - steadyMean;
    expect(glow).toBeGreaterThan(20 * HALF_FLOAT_MEAN);
    // 1.8 T and 0 in turn: the mean is 0.9 T, under the threshold, so the glow of the mean is none.
    const [shown, mean] = draw(Array.from({ length: 8 }, (_, frame) => (frame % 2 === 0 ? 1.8 * T : 0)));
    expect(Math.abs(mean - 0.9 * T)).toBeLessThan(HALF_FLOAT_MEAN);
    expect(Math.abs(shown - mean)).toBeLessThan(HALF_FLOAT_MEAN);
    // The mean of the frames' glows would have been the mean plus half the steady glow.
    expect(Math.abs(shown - (mean + glow / 2))).toBeGreaterThan(10 * HALF_FLOAT_MEAN);
  });
});

describe('captures', () => {
  test('a still carries the glow the live view shows; with the stage off it carries none', async () => {
    const gl = renderer();
    const { scene, camera } = glowRoom();
    const chain = await chainOn(gl, scene, camera, tier('high'));
    chain.render(scene, camera, 0);
    const live = canvasPixels(gl);
    const shot = still(gl, chain, scene, camera);
    expect(Math.abs(red(shot, HALO.x, HALO.y) - red(live, HALO.x, HALO.y))).toBeLessThanOrEqual(1);
    chain.applyTier(tier('low'));
    const plain = still(gl, chain, scene, camera);
    expect(red(shot, HALO.x, HALO.y) - red(plain, HALO.x, HALO.y)).toBeGreaterThan(10);
  });
});

describe('draws and mirrors', () => {
  test('a resting walk draws the same frames with the stage on as off', async () => {
    const gl = renderer();
    const { scene, camera } = glowRoom();
    /** The rest index of every draw over forty ticks of a walk that rests. */
    const draws = async (inputs: WalkPostTierInputs): Promise<Array<number | null>> => {
      const chain = await chainOn(gl, scene, camera, inputs);
      const demand = new RenderDemand();
      const rests: Array<number | null> = [];
      for (let tick = 0; tick < 40; tick += 1) {
        if (!demand.shouldDraw(camera, 'walk', chain.restFrames)) continue;
        rests.push(demand.restFrame());
        chain.render(scene, camera, 0, demand.restFrame());
        demand.commit(camera);
      }
      return rests;
    };
    const on = await draws(tier('high'));
    expect(on).toEqual(await draws({ ...tier('high'), bloom: false }));
    expect(on.length).toBeGreaterThan(8);
  });

  test('a mirror captures once per frame, inside the beauty pass, with the stage on', async () => {
    const gl = renderer();
    const { scene, camera } = glowRoom();
    const mirror = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 64, textureHeight: 64, color: 0xffffff });
    mirror.position.set(1, 0, -2.5);
    disposers.push(() => mirror.dispose());
    const scopes: unknown[] = [];
    const original = mirror.onBeforeRender.bind(mirror);
    mirror.onBeforeRender = mainPassOnly((...args: Parameters<typeof original>) => {
      scopes.push(scenePassOf(gl));
      original(...args);
    });
    scene.add(mirror);
    const chain = await chainOn(gl, scene, camera, tier('high'));
    chain.render(scene, camera, 0);
    for (let frame = 0; frame < 8; frame += 1) chain.render(scene, camera, 0, frame);
    expect(scopes).toHaveLength(9);
    for (const scope of scopes) expect(scope).toEqual({ target: expect.any(THREE.WebGLRenderTarget), scene, camera });
  });
});

describe('resize and context restore', () => {
  test('the stage`s targets follow a live resize at half resolution, and a capture`s size only until the next live frame', async () => {
    const gl = renderer();
    const { scene, camera } = glowRoom();
    const chain = await chainOn(gl, scene, camera, tier('high'));
    chain.render(scene, camera, 0);
    const bright = (): number[] => [chain.bloom.renderTargetBright.width, chain.bloom.renderTargetBright.height];
    expect(bright()).toEqual([WIDTH / 2, HEIGHT / 2]);
    gl.setSize(WIDTH / 2, HEIGHT / 2, false);
    chain.setSize(WIDTH / 2, HEIGHT / 2, 1);
    chain.render(scene, camera, 0);
    expect(bright()).toEqual([WIDTH / 4, HEIGHT / 4]);
    const target = new THREE.WebGLRenderTarget(96, 64);
    chain.renderTo(target, scene, camera, 96, 64);
    target.dispose();
    expect(bright()).toEqual([48, 32]);
    chain.render(scene, camera, 0);
    expect(bright()).toEqual([WIDTH / 4, HEIGHT / 4]);
  });

  test('after a context loss the chain built on the restored context glows on the high tier, at the live size', async () => {
    const container = openContainer(WIDTH, HEIGHT);
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    let pending = new Map<number, () => void>();
    let next = 0;
    const runtime = createRenderRuntime({
      canvas,
      viewport: { clientWidth: WIDTH, clientHeight: HEIGHT, element: container },
      scheduleFrame: (callback) => {
        next += 1;
        pending.set(next, callback);
        return next;
      },
      cancelFrame: (handle) => {
        pending.delete(handle);
      },
    });
    disposers.push(() => runtime.dispose());
    const frame = (): void => {
      const due = pending;
      pending = new Map();
      for (const callback of due.values()) callback();
    };
    const camera = new THREE.PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 160);
    camera.position.set(0, 1.6, 2);
    runtime.setCamera(camera);
    runtime.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const built: WalkPost[] = [];
    const controller = new WalkPostController({
      build: async () => {
        const chain = (await loadWalkPost(runtime.renderer, runtime.scene, camera, undefined, tier('high'))) as WalkPost;
        built.push(chain);
        return chain;
      },
      attach: (chain) => runtime.setPostProcessor(chain),
      report: () => undefined,
    });
    disposers.push(() => controller.dispose());
    runtime.start();
    controller.update('walk');
    await until(() => controller.state() === 'on', 'the first chain');
    const lose = runtime.renderer.getContext().getExtension('WEBGL_lose_context')!;
    runtime.renderer.domElement.addEventListener('webglcontextlost', () => controller.contextLost());
    runtime.renderer.domElement.addEventListener('webglcontextrestored', () => controller.contextRestored());
    lose.loseContext();
    await until(() => runtime.isContextLost(), 'the context to go');
    lose.restoreContext();
    await until(() => !runtime.isContextLost(), 'the context to come back');
    controller.update('walk');
    await until(() => controller.state() === 'on', 'the chain on the restored context');
    const restored = built.at(-1)!;
    expect(built).toHaveLength(2);
    expect(restored.bloom.enabled).toBe(true);
    restored.render(runtime.scene, camera, 0);
    frame();
    const size = runtime.renderer.getDrawingBufferSize(new THREE.Vector2());
    expect([restored.bloom.renderTargetBright.width, restored.bloom.renderTargetBright.height]).toEqual([
      Math.round(size.x / 2),
      Math.round(size.y / 2),
    ]);
  });
});
