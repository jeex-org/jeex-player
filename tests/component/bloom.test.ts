/**
 * The walk chain's glow stage (`src/render/glow-pass.ts`, `src/render/walk-post.ts`)
 * on a real WebGL context, over small scenes of the test's own: off is the
 * picture without the stage byte for byte, the glow of a resting view is the
 * glow of the rest mean (not the mean of glows), a still at the live size
 * carries the glow the live view shows and one of another size a halo of the
 * same extent in pixels, the glow stays near its source, it is aimed per draw
 * through the exposure and the balance (live and per capture camera) with its
 * soft knee, it draws the scene no more often, and its targets follow a resize
 * and a context restore. A mirror under the stage is `rest-accumulation.test.ts`'s.
 *
 * The bright source is an unlit quad far over the stage's threshold (the
 * lighting standard's numbers, `WALK_POST_TUNING.bloom`) in a dim grey room;
 * unless a case says otherwise the renderer's exposure is 1 and the white
 * balance the identity, so the threshold in the linear picture is the display one.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createWalkPost, WALK_POST_TUNING, WalkPost, type WalkPostTierInputs } from '../../src/render/walk-post.js';
import { QUALITY_TIERS } from '../../src/render/quality-tier.js';
import { createRenderRuntime } from '../../src/render/render-runtime.js';
import { loadWalkPost, WalkPostController } from '../../src/app/walk-post-controller.js';
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

function renderer(width = WIDTH, height = HEIGHT): THREE.WebGLRenderer {
  const container = openContainer(width, height);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
  gl.setPixelRatio(1);
  gl.setSize(width, height, false);
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
function canvasPixels(gl: THREE.WebGLRenderer, width = WIDTH, height = HEIGHT): Uint8Array {
  const context = gl.getContext();
  const out = new Uint8Array(width * height * 4);
  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, out);
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
const red = (pixels: Uint8Array, x: number, y: number, width = WIDTH): number => pixels[(y * width + x) * 4]!;
/** Beside the source, inside its halo: the source covers about 8 pixels across the middle. */
const HALO = { x: WIDTH / 2 + 10, y: HEIGHT / 2 };

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

describe('off is the picture without the stage', () => {
  test('a low-tier chain draws, and captures, byte for byte what the chain draws with the stage taken out; high glows', async () => {
    const gl = renderer();
    const { scene, camera } = glowRoom();
    const low = await chainOn(gl, scene, camera, tier('low', 0));
    low.render(scene, camera, 0);
    const live = canvasPixels(gl);
    const shot = still(gl, low, scene, camera);
    // The chain as it was before the stage existed: the same passes without it.
    low.composer.passes.splice(low.composer.passes.indexOf(low.bloom), 1);
    disposers.push(() => low.bloom.dispose());
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

  test('a still of another size gets a halo of the same extent in pixels, not the same share of the frame', async () => {
    const gl = renderer();
    const { scene, camera } = edgeRoom(4 * WALK_POST_TUNING.bloom.threshold);
    const chain = await chainOn(gl, scene, camera, tier('high'));
    const [w, h] = [2 * WIDTH, 2 * HEIGHT];
    const small = glowRow(gl, chain, scene, camera, w, h);
    const large = glowRow(gl, chain, scene, camera, 2 * w, 2 * h);
    /** What the stage adds `d` pixels right of the half-plane's edge (the middle column) in a row of `row.length`. */
    const beside = (row: number[], d: number): number => row[row.length / 2 + d]!;
    expect(beside(small, 8)).toBeGreaterThan(1.5 * beside(small, 16));
    for (const d of [8, 16]) expect(Math.abs(beside(large, d) - beside(small, d))).toBeLessThan(0.2 * beside(small, d));
  });
});

/**
 * A dim grey room with an unlit half-plane of linear `value` filling the left
 * half of the view (its right edge on the view's centre line), so the glow's
 * profile across that edge depends on the blur alone, not on a source's size.
 */
function edgeRoom(value: number): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  source: THREE.MeshBasicMaterial;
  room: THREE.Mesh;
} {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(6, 4, 6),
    new THREE.MeshStandardMaterial({ color: '#808080', roughness: 1, side: THREE.BackSide }),
  );
  const source = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(value, value, value, THREE.LinearSRGBColorSpace) });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), source);
  plane.position.set(-2, 0, -2.9);
  scene.add(room, plane, new THREE.HemisphereLight('#ffffff', '#ffffff', 0.3));
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 50);
  camera.position.set(0, 0, 1);
  camera.updateMatrixWorld();
  return { scene, camera, source, room };
}

/** Sets an unlit material to the linear grey `value`. */
const setGrey = (material: THREE.MeshBasicMaterial, value: number): void => {
  material.color.setRGB(value, value, value, THREE.LinearSRGBColorSpace);
};

/** The red channel of the middle row of a still of `width` x `height`, linear, read where the glow leaves it (before the output pass). */
function linearRow(
  gl: THREE.WebGLRenderer,
  chain: WalkPost,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): number[] {
  const target = new THREE.WebGLRenderTarget(width, height);
  try {
    chain.renderTo(target, scene, camera, width, height);
    const half = new Uint16Array(width * 4);
    gl.readRenderTargetPixels(chain.composer.readBuffer, 0, height / 2, width, 1, half);
    return Array.from({ length: width }, (_, x) => THREE.DataUtils.fromHalfFloat(half[x * 4]!));
  } finally {
    target.dispose();
  }
}

/** What the stage adds along the middle row of a still: the row with it on less the row with it off. */
function glowRow(
  gl: THREE.WebGLRenderer,
  chain: WalkPost,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): number[] {
  chain.bloom.enabled = true;
  const on = linearRow(gl, chain, scene, camera, width, height);
  chain.bloom.enabled = false;
  const off = linearRow(gl, chain, scene, camera, width, height);
  chain.bloom.enabled = true;
  return on.map((value, x) => value - off[x]!);
}

describe('the glow stays near its source', () => {
  test('a dark thin object 200 px from a bright source keeps its value; the halo round the source stays', async () => {
    const [width, height] = [640, 400];
    const gl = renderer(width, height);
    const scene = new THREE.Scene();
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(6, 4, 6),
      new THREE.MeshStandardMaterial({ color: '#808080', roughness: 1, side: THREE.BackSide }),
    );
    const bulb = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(SOURCE, SOURCE, SOURCE, THREE.LinearSRGBColorSpace) }),
    );
    bulb.position.set(0, 0, -2.9);
    // A cord-like black bar: at 3.9 m and a vertical field of 50 degrees, half the view's height is 200 px,
    // so `3.9 tan 25°` to the right is 200 px from the source's centre.
    const offset = 3.9 * Math.tan(THREE.MathUtils.degToRad(25));
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.5, 0.02), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    cord.position.set(offset, 0, -2.9 + 0.05);
    scene.add(room, bulb, cord, new THREE.HemisphereLight('#ffffff', '#ffffff', 0.3));
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 50);
    camera.position.set(0, 0, 1);
    camera.updateMatrixWorld();
    const chain = await chainOn(gl, scene, camera, tier('high'));
    const draw = (on: boolean): Uint8Array => {
      chain.bloom.enabled = on;
      chain.render(scene, camera, 0);
      return canvasPixels(gl, width, height);
    };
    const off = draw(false);
    const on = draw(true);
    const y = height / 2;
    const columns = Array.from({ length: 21 }, (_, k) => width / 2 + 190 + k);
    const x = columns.reduce((darkest, column) => (red(off, column, y, width) < red(off, darkest, y, width) ? column : darkest));
    expect(red(off, x, y, width)).toBeLessThan(10);
    expect(Math.abs(red(on, x, y, width) - red(off, x, y, width))).toBeLessThanOrEqual(2);
    // Six pixels off the source's edge (a 0.5 m quad is 55 px across here), the halo is there.
    const rim = width / 2 + 28 + 6;
    expect(red(on, rim, y, width) - red(off, rim, y, width)).toBeGreaterThan(10);
  });
});

describe('aiming', () => {
  const scaled = (gain: number): Mat3 => IDENTITY.map((value) => value * gain) as unknown as Mat3;
  /** Beside the half-plane's edge, inside its halo. */
  const BESIDE = { x: WIDTH / 2 + 6, y: HEIGHT / 2 };

  test('through a balance and an exposure, 1.2 times the aimed threshold glows and 0.8 times does not, live and in a still from a room of another balance', async () => {
    const gl = renderer();
    gl.toneMappingExposure = 1.5;
    const { scene, camera, source } = edgeRoom(0);
    // The live room opens the picture up twofold, the still's room closes it to half.
    const chain = await createWalkPost(gl, scene, camera, {
      whiteBalance: IDENTITY,
      balance: { live: () => scaled(2), at: () => scaled(0.5) },
      tier: tier('high'),
    });
    disposers.push(() => chain.dispose());
    const T = WALK_POST_TUNING.bloom.threshold;
    /** The red the stage adds beside the edge with the half-plane at `value`, live or in a still. */
    const added = (value: number, capture: boolean): number => {
      setGrey(source, value);
      const read = (on: boolean): number => {
        chain.bloom.enabled = on;
        if (capture) return red(still(gl, chain, scene, camera), BESIDE.x, BESIDE.y);
        chain.render(scene, camera, 0);
        return red(canvasPixels(gl), BESIDE.x, BESIDE.y);
      };
      const off = read(false);
      return read(true) - off;
    };
    const live = T / (1.5 * 2);
    expect(added(1.2 * live, false)).toBeGreaterThan(5);
    expect(Math.abs(added(0.8 * live, false))).toBeLessThanOrEqual(1);
    const there = T / (1.5 * 0.5);
    expect(added(1.2 * there, true)).toBeGreaterThan(5);
    expect(Math.abs(added(0.8 * there, true))).toBeLessThanOrEqual(1);
  });

  test('the soft knee: a source at 1.25 times the threshold adds 1.25 x 0.5 / 1.5 of what one at 1.5 times adds', async () => {
    const gl = renderer();
    const { scene, camera, source } = edgeRoom(0);
    const chain = await chainOn(gl, scene, camera, tier('high'));
    const T = WALK_POST_TUNING.bloom.threshold;
    const at = (value: number): number => {
      setGrey(source, value);
      return glowRow(gl, chain, scene, camera, WIDTH, HEIGHT)[BESIDE.x]!;
    };
    const full = at(1.5 * T);
    expect(full).toBeGreaterThan(20 * HALF_FLOAT_MEAN);
    // Half way up the knee the high pass passes half the value; without the knee it would pass all of it (0.83).
    expect(at(1.25 * T) / full).toBeCloseTo((1.25 * 0.5) / 1.5, 1);
  });
});

describe('draws', () => {
  test('a draw through the chain, a change or a rest frame, draws the scene as often with the stage on as off', async () => {
    const gl = renderer();
    const { scene, camera, room } = edgeRoom(4 * WALK_POST_TUNING.bloom.threshold);
    let drawn = 0;
    room.onBeforeRender = () => {
      drawn += 1;
    };
    const chain = await chainOn(gl, scene, camera, tier('high'));
    const count = (on: boolean, rest: number | null): number => {
      chain.bloom.enabled = on;
      drawn = 0;
      chain.render(scene, camera, 0, rest);
      return drawn;
    };
    chain.render(scene, camera, 0);
    for (const rest of [null, 0, 1, 5]) {
      expect(count(true, rest)).toBe(count(false, rest));
      expect(count(true, rest)).toBeGreaterThan(0);
    }
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
