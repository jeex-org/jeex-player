/**
 * The walk and tour post-processing chain against a real WebGL context.
 *
 * Most claims are made on small scenes of the test's own drawn through the
 * chain and through the direct path on one renderer: corner darkening, the
 * open floor's tone, SMAA, what occludes, mirrors, shadow-only casters,
 * captures, resize and disposal. A `RenderRuntime` with a hand-driven frame
 * pump proves the runtime seam and the controller's real loads (editing
 * modes, context restore, stale completions, a failed decode). One mounted
 * viewer on `plan-l-shape` (the smallest scene with doors, furniture and a
 * tour route) proves the wiring: tour and walk attach the chain, the sun
 * shadow stays settled under it, and the captures in walk go through it.
 */

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createWalkPost, WalkPost, whiteBalancedOutput } from '../../src/render/walk-post.js';
import { whiteBalanceMatrix, type Mat3 } from '../../src/render/white-balance.js';
import { createRenderRuntime, type RenderRuntime } from '../../src/render/render-runtime.js';
import { loadWalkPost, WalkPostController } from '../../src/app/walk-post-controller.js';
import { mainPassOnly } from '../../src/assets/mirror-capture.js';
import { withScenePass } from '../../src/shared/scene-pass.js';
import { SHADOW_ONLY_LAYER } from '../../src/shared/render-layers.js';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { L_SHAPE } from '../../src/fixtures/plan-l-shape-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import type { SceneData, SceneOp } from '../../src/scene/types.js';
import type { SunShadowState } from '../../src/render/sun-shadow.js';
import { closeContainers, nextFrame, openContainer, until } from './support.js';

const WIDTH = 240;
const HEIGHT = 160;
/** 2 % of the 8-bit range, the spec's tolerance for a colour that must not change. */
const TWO_PERCENT = 0.02 * 255;
/** Mounting `plan-l-shape`, loading the chain and capturing, at SwiftShader speed. */
const MOUNT_TIMEOUT_MS = 180_000;

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
  closeContainers();
});

/** A renderer with the lighting standard's display transform on a canvas of its own. */
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

/** The white balance that changes nothing: what comparisons with the direct path use. */
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

async function chainOn(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  whiteBalance: Mat3 = IDENTITY,
): Promise<WalkPost> {
  const chain = await createWalkPost(gl, scene, camera, { whiteBalance });
  disposers.push(() => chain.dispose());
  return chain;
}

/** RGB of canvas pixel `(x, y)` from the top-left, read right after the draw. */
function pixel(gl: THREE.WebGLRenderer, x: number, y: number): [number, number, number] {
  const context = gl.getContext();
  const out = new Uint8Array(4);
  context.readPixels(Math.round(x), gl.domElement.height - 1 - Math.round(y), 1, 1, context.RGBA, context.UNSIGNED_BYTE, out);
  return [out[0]!, out[1]!, out[2]!];
}

const grey = (rgb: readonly number[]): number => (rgb[0]! + rgb[1]! + rgb[2]!) / 3;

/** Where a world point lands on the canvas, in pixels from the top-left. */
function screenOf(camera: THREE.Camera, point: THREE.Vector3, width = WIDTH, height = HEIGHT): { x: number; y: number } {
  const ndc = point.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}

/** The direct path as the runtime draws it: to the screen, inside the beauty-pass scope. */
function drawDirect(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  withScenePass(gl, { target: null, scene, camera }, () => gl.render(scene, camera));
}

/** The sRGB transfer, both ways, on 8-bit values. */
const toLinear = (value: number): number => {
  const c = value / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toDisplay = (linear: number): number => 255 * (linear <= 0.003_130_8 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);

const grey50 = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: '#b0b0b0', roughness: 1 });

/** A floor meeting a wall along z = -1, lit by sky light alone, and a camera looking at the joint. */
function room(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), grey50());
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 2.5, 0.1), grey50());
  wall.position.set(0, 1.25, -1.05);
  scene.add(floor, wall, new THREE.HemisphereLight('#ffffff', '#ffffff', 1.5));
  const camera = new THREE.PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 160);
  camera.position.set(0, 1.2, 1.6);
  camera.lookAt(0, 0.2, -0.8);
  camera.updateMatrixWorld();
  return { scene, camera };
}

describe('the white balance in the output pass', () => {
  /** A flat unlit patch of linear colour `rgb` filling the view. */
  function patch(rgb: readonly number[]): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
    const scene = new THREE.Scene();
    const colour = new THREE.Color().setRGB(rgb[0]!, rgb[1]!, rgb[2]!, THREE.LinearSRGBColorSpace);
    scene.background = colour;
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: colour })));
    const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.1, 50);
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld();
    return { scene, camera };
  }

  test('applies the matrix once, before the display transform, clamped at zero; adds no pass', async () => {
    const matrix = whiteBalanceMatrix([1, 0.6, 0.35], 0.8);
    const colour = [0.6, 0.3, 0.05];
    const balanced = [0, 1, 2].map((r) =>
      Math.max(0, matrix[r * 3]! * colour[0]! + matrix[r * 3 + 1]! * colour[1]! + matrix[r * 3 + 2]! * colour[2]!),
    );
    const gl = renderer();
    const a = patch(colour);
    const chain = await chainOn(gl, a.scene, a.camera, matrix);
    chain.render(a.scene, a.camera, 0);
    const got = pixel(gl, WIDTH / 2, HEIGHT / 2);
    const b = patch(balanced);
    const plain = await chainOn(gl, b.scene, b.camera);
    plain.render(b.scene, b.camera, 0);
    const want = pixel(gl, WIDTH / 2, HEIGHT / 2);
    for (let channel = 0; channel < 3; channel += 1) expect(Math.abs(got[channel]! - want[channel]!)).toBeLessThanOrEqual(1);
    expect(chain.whiteBalance).toEqual(matrix);
    expect(chain.composer.passes).toHaveLength(plain.composer.passes.length);
    expect(chain.composer.passes).toHaveLength(4);
  });

  test("a balance source drives it: the live frame takes the live balance, a capture its own camera's, and none keeps the chain's", async () => {
    const live = whiteBalanceMatrix([1, 0.6, 0.35], 1);
    const there = whiteBalanceMatrix([0.5, 0.8, 1.2], 1);
    const colour = [0.4, 0.4, 0.4];
    const gl = renderer();
    const { scene, camera } = patch(colour);
    const asked: THREE.Vector3[] = [];
    let source: { live: Mat3 | null; at: Mat3 | null } = { live, at: there };
    const chain = await createWalkPost(gl, scene, camera, {
      whiteBalance: IDENTITY,
      balance: {
        live: () => source.live,
        at: (position) => {
          asked.push(new THREE.Vector3(position.x, position.y, position.z));
          return source.at;
        },
      },
    });
    disposers.push(() => chain.dispose());
    const uniform = (): number[] =>
      (chain.output.material.uniforms['jeexWhiteBalance']!.value as THREE.Matrix3).clone().transpose().toArray();
    chain.render(scene, camera, 0);
    uniform().forEach((v, i) => expect(v).toBeCloseTo(live[i]!, 6));
    const shot = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    shot.position.set(3, 1.5, -2);
    shot.updateMatrixWorld();
    const target = new THREE.WebGLRenderTarget(16, 16);
    disposers.push(() => target.dispose());
    chain.renderTo(target, scene, shot, 16, 16);
    uniform().forEach((v, i) => expect(v).toBeCloseTo(there[i]!, 6));
    expect(asked.at(-1)!.toArray()).toEqual([3, 1.5, -2]);
    expect(chain.whiteBalanceAt({ x: 3, y: 1.5, z: -2 })).toBe(there);
    source = { live: null, at: null };
    chain.render(scene, camera, 0);
    uniform().forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]!, 6));
    expect(chain.whiteBalanceAt({ x: 0, y: 0, z: 0 })).toBe(IDENTITY);
  });

  test('a shader without the anchor the white balance follows is refused', () => {
    expect(() => whiteBalancedOutput('void main() { gl_FragColor = vec4(1.0); }')).toThrow();
  });
});

describe('the chain over a small room', () => {
  test('darkens the floor-to-wall corner relative to open floor, and leaves the open floor within 2 %', async () => {
    const gl = renderer();
    const { scene, camera } = room();
    const corner = screenOf(camera, new THREE.Vector3(0, 0.02, -0.97));
    const open = screenOf(camera, new THREE.Vector3(0, 0, -0.3));
    drawDirect(gl, scene, camera);
    const direct = { corner: grey(pixel(gl, corner.x, corner.y)), open: pixel(gl, open.x, open.y) };
    const chain = await chainOn(gl, scene, camera);
    chain.render(scene, camera, 0);
    const processed = { corner: grey(pixel(gl, corner.x, corner.y)), open: pixel(gl, open.x, open.y) };
    // A black frame here once read as 0/0 when three browser files ran together: name the context's state if it recurs.
    expect({ contextLost: gl.getContext().isContextLost(), open: grey(processed.open) > 0 }).toEqual({ contextLost: false, open: true });

    expect(processed.corner / grey(processed.open)).toBeLessThan(direct.corner / grey(direct.open) - 0.05);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs(processed.open[channel]! - direct.open[channel]!)).toBeLessThanOrEqual(TWO_PERCENT);
    }
  });

  test('window glass and an invisible pick proxy cause no occlusion on the floor beside them', async () => {
    const gl = renderer();
    const { scene, camera } = room();
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 0.02),
      new THREE.MeshPhysicalMaterial({ transmission: 0.92, roughness: 0 }),
    );
    glass.position.set(-0.8, 0.6, 0);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.set(0.9, 1, 0);
    const besideGlass = screenOf(camera, new THREE.Vector3(-0.8, 0, 0.08));
    const besideProxy = screenOf(camera, new THREE.Vector3(0.9, 0, 0.28));
    const chain = await chainOn(gl, scene, camera);
    chain.render(scene, camera, 0);
    const bare = [grey(pixel(gl, besideGlass.x, besideGlass.y)), grey(pixel(gl, besideProxy.x, besideProxy.y))];
    scene.add(glass, proxy);
    chain.render(scene, camera, 0);
    const withBoth = [grey(pixel(gl, besideGlass.x, besideGlass.y)), grey(pixel(gl, besideProxy.x, besideProxy.y))];

    expect(Math.abs(withBoth[1]! - bare[1]!)).toBeLessThanOrEqual(TWO_PERCENT);
    // The pane itself may tint what is seen THROUGH it; the floor in front of it is not darkened.
    expect(withBoth[0]!).toBeGreaterThanOrEqual(bare[0]! - TWO_PERCENT);
  });

  test('SMAA brings a diagonal edge closer to a supersampled reference', async () => {
    const gl = renderer();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    plane.rotation.z = 0.3;
    scene.add(plane);
    const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.1, 10);
    camera.position.set(0.2, 0.1, 2);
    const chain = await chainOn(gl, scene, camera);
    chain.occlusion.enabled = false;
    const picture = (scale: number, smaa: boolean): Uint8Array => {
      chain.smaa.enabled = smaa;
      const target = new THREE.WebGLRenderTarget(WIDTH * scale, HEIGHT * scale);
      try {
        chain.renderTo(target, scene, camera, WIDTH * scale, HEIGHT * scale);
        const out = new Uint8Array(WIDTH * scale * HEIGHT * scale * 4);
        gl.readRenderTargetPixels(target, 0, 0, WIDTH * scale, HEIGHT * scale, out);
        return out;
      } finally {
        target.dispose();
      }
    };
    const SS = 4;
    const big = picture(SS, false);
    const reference = new Float32Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        // Coverage mixes light, so the samples are averaged in linear light.
        let sum = 0;
        for (let dy = 0; dy < SS; dy += 1)
          for (let dx = 0; dx < SS; dx += 1) sum += toLinear(big[((y * SS + dy) * WIDTH * SS + (x * SS + dx)) * 4]!);
        reference[y * WIDTH + x] = toDisplay(sum / (SS * SS));
      }
    }
    const error = (image: Uint8Array): number => {
      let sum = 0;
      for (let index = 0; index < WIDTH * HEIGHT; index += 1) sum += Math.abs(image[index * 4]! - reference[index]!);
      return sum;
    };
    const aliased = error(picture(1, false));
    const smoothed = error(picture(1, true));
    expect(smoothed).toBeLessThan(aliased * 0.9);
  });
});

/** A mirror facing the camera with a lit coloured box behind the camera, counted at every capture. */
function mirrorRoom(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; mirror: Reflector; captures: () => number; box: THREE.Mesh } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const mirror = new Reflector(new THREE.PlaneGeometry(2, 2), { textureWidth: 128, textureHeight: 128, color: 0xffffff });
  mirror.position.set(0, 0, -1);
  disposers.push(() => mirror.dispose());
  let captures = 0;
  const original = mirror.onBeforeRender.bind(mirror);
  mirror.onBeforeRender = mainPassOnly((...args: Parameters<typeof original>) => {
    captures += 1;
    original(...args);
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 0.5), new THREE.MeshStandardMaterial({ color: '#c04040', roughness: 1 }));
  box.position.set(0, 0, 3);
  scene.add(mirror, box, new THREE.HemisphereLight('#ffffff', '#ffffff', 2));
  const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 160);
  camera.position.set(0, 0, 1);
  return { scene, camera, mirror, captures: () => captures, box };
}

describe('mirrors under the chain', () => {
  test('capture once per frame, show the room, match the direct path within 2 %; an inset preview captures nothing', async () => {
    const gl = renderer();
    const { scene, camera, captures } = mirrorRoom();
    drawDirect(gl, scene, camera);
    drawDirect(gl, scene, camera);
    const direct = pixel(gl, WIDTH / 2, HEIGHT / 2);
    expect(captures()).toBe(2);

    const chain = await chainOn(gl, scene, camera);
    for (let frame = 0; frame < 3; frame += 1) chain.render(scene, camera, 0);
    const processed = pixel(gl, WIDTH / 2, HEIGHT / 2);
    expect(captures()).toBe(5);
    // The room: the red box, not black.
    expect(processed[0]).toBeGreaterThan(processed[2] + 20);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs(processed[channel]! - direct[channel]!)).toBeLessThanOrEqual(TWO_PERCENT);
    }

    // A checkpoint inset preview: the screen, another camera, no scope.
    const preview = camera.clone();
    preview.position.x = 0.2;
    gl.render(scene, preview);
    expect(captures()).toBe(5);
  });

  test('shadow-only casters stay invisible in the processed view, in a mirror under the chain and in a processed still', async () => {
    const gl = renderer();
    const { scene, camera, box } = mirrorRoom();
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: '#00ff00' }));
    front.position.set(0.5, 0.3, 0);
    scene.add(front);
    box.layers.set(SHADOW_ONLY_LAYER);
    front.layers.set(SHADOW_ONLY_LAYER);
    const at = screenOf(camera, front.position);
    const chain = await chainOn(gl, scene, camera);
    chain.render(scene, camera, 0);
    const mirrorPixel = pixel(gl, WIDTH / 2, HEIGHT / 2);
    const frontPixel = pixel(gl, at.x, at.y);
    const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT);
    disposers.push(() => target.dispose());
    chain.renderTo(target, scene, camera, WIDTH, HEIGHT);
    const still = new Uint8Array(4);
    gl.readRenderTargetPixels(target, Math.round(at.x), HEIGHT - 1 - Math.round(at.y), 1, 1, still);

    expect(mirrorPixel[0]).toBeLessThan(20);
    expect(frontPixel[1]).toBeLessThan(20);
    expect(still[1]).toBeLessThan(20);
    // Teeth: on layer 0 the same box shows in the mirror.
    box.layers.set(0);
    chain.render(scene, camera, 0);
    expect(pixel(gl, WIDTH / 2, HEIGHT / 2)[0]).toBeGreaterThan(40);
  });
});

describe('captures, resize and disposal', () => {
  test('a still through the chain is repeatable, darkens the corner and leaves the next live frame unchanged', async () => {
    const gl = renderer();
    const { scene, camera } = room();
    const chain = await chainOn(gl, scene, camera);
    const still = (): Uint8Array => {
      const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT);
      try {
        chain.renderTo(target, scene, camera, WIDTH, HEIGHT);
        const out = new Uint8Array(WIDTH * HEIGHT * 4);
        gl.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, out);
        return out;
      } finally {
        target.dispose();
      }
    };
    chain.render(scene, camera, 0);
    const corner = screenOf(camera, new THREE.Vector3(0, 0.02, -0.97));
    const liveBefore = pixel(gl, corner.x, corner.y);
    const first = still();
    const second = still();
    chain.render(scene, camera, 0);
    const liveAfter = pixel(gl, corner.x, corner.y);

    expect(first.every((value, index) => value === second[index])).toBe(true);
    expect(liveAfter).toEqual(liveBefore);
    const index = ((HEIGHT - 1 - Math.round(corner.y)) * WIDTH + Math.round(corner.x)) * 4;
    expect(Math.abs(first[index]! - liveBefore[0])).toBeLessThanOrEqual(TWO_PERCENT);
  });

  test('resize: targets follow the drawing buffer, the occlusion buffer follows it', async () => {
    const gl = renderer();
    const { scene, camera } = room();
    const chain = await chainOn(gl, scene, camera);
    chain.setSize(200, 100, 1.5);
    expect([chain.composer.renderTarget1.width, chain.composer.renderTarget1.height]).toEqual([300, 150]);
    expect([chain.composer.renderTarget2.width, chain.composer.renderTarget2.height]).toEqual([300, 150]);
    expect([chain.occlusion.gtaoRenderTarget.width, chain.occlusion.gtaoRenderTarget.height]).toEqual([300, 150]);
    expect([chain.occlusion.pdRenderTarget.width, chain.occlusion.pdRenderTarget.height]).toEqual([300, 150]);
  });

  test('dispose releases every pass, target and material, and the GPU memory returns to its level before', async () => {
    const gl = renderer();
    const { scene, camera } = room();
    drawDirect(gl, scene, camera);
    const before = { ...gl.info.memory };
    const chain = await createWalkPost(gl, scene, camera);
    chain.render(scene, camera, 0);
    const occlusion = chain.occlusion;
    const disposables: Array<{ dispose(): void }> = [
      chain.composer.renderTarget1,
      chain.composer.renderTarget2,
      ...chain.composer.passes,
      occlusion.gtaoRenderTarget,
      occlusion.pdRenderTarget,
      occlusion.gtaoMaterial,
      occlusion.blendMaterial,
      occlusion.pdMaterial,
      occlusion.normalMaterial,
      occlusion.copyMaterial,
      occlusion.depthRenderMaterial,
      occlusion.gtaoNoiseTexture,
      occlusion.pdNoiseTexture,
    ];
    const spies = disposables.map((item) => vi.spyOn(item, 'dispose'));
    chain.dispose();

    expect(spies.map((spy) => spy.mock.calls.length > 0)).toEqual(spies.map(() => true));
    expect(gl.info.memory).toEqual(before);
  });
});

/** A runtime on a canvas of its own whose frames the test pumps by hand. */
function pumpedRuntime(): { runtime: RenderRuntime; frame: () => void } {
  const container = openContainer(WIDTH, HEIGHT);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  // A queue, not one slot: the resize observer schedules its own callbacks beside the frame's.
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
  return {
    runtime,
    frame: () => {
      const due = pending;
      pending = new Map();
      for (const callback of due.values()) callback();
    },
  };
}

/** Lets a build's promise chain settle: the SMAA images decode off the main task. */
async function loaded(controller: WalkPostController): Promise<void> {
  await until(() => controller.state() !== 'loading', 'the chain to load', 30_000);
}

describe('the runtime and the controller with real loads', () => {
  function controlled(): {
    runtime: RenderRuntime;
    frame: () => void;
    controller: WalkPostController;
    camera: THREE.PerspectiveCamera;
    errors: unknown[];
  } {
    const { runtime, frame } = pumpedRuntime();
    const camera = new THREE.PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 160);
    camera.position.set(0, 1.6, 2);
    runtime.setCamera(camera);
    runtime.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), grey50()));
    const errors: unknown[] = [];
    const controller = new WalkPostController({
      build: () => loadWalkPost(runtime.renderer, runtime.scene, camera),
      attach: (chain) => runtime.setPostProcessor(chain),
      report: (error) => errors.push(error),
    });
    disposers.push(() => controller.dispose());
    runtime.start();
    return { runtime, frame, controller, camera, errors };
  }

  /** Pumps frames until the runtime's first picture, which waits for the scene's shaders (`render/first-draw.ts`). */
  async function firstPicture(runtime: RenderRuntime, frame: () => void): Promise<void> {
    await until(
      () => {
        frame();
        return Number.isFinite(runtime.lastDrawnAt);
      },
      'the first picture',
      30_000,
    );
  }

  test('editing modes draw to the screen with no pass; walk draws through the chain once loaded', async () => {
    const { runtime, frame, controller } = controlled();
    await firstPicture(runtime, frame);
    const renderSpy = vi.spyOn(WalkPost.prototype, 'render');
    const targets: unknown[] = [];
    const render = runtime.renderer.render.bind(runtime.renderer);
    vi.spyOn(runtime.renderer, 'render').mockImplementation((scene, camera) => {
      targets.push(runtime.renderer.getRenderTarget());
      render(scene, camera);
    });
    for (const mode of ['orbit', 'plan3d'] as const) {
      controller.update(mode);
      frame();
    }
    expect(targets).toEqual([null, null]);
    expect(renderSpy).not.toHaveBeenCalled();

    controller.update('walk');
    frame();
    expect(renderSpy).not.toHaveBeenCalled();
    await loaded(controller);
    expect(controller.state()).toBe('on');
    controller.update('walk');
    frame();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    controller.update('orbit');
    frame();
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  test('a context loss disposes the chain and the first walk frame after the restore builds a new one', async () => {
    const { runtime, frame, controller } = controlled();
    controller.update('walk');
    await loaded(controller);
    const disposeSpy = vi.spyOn(WalkPost.prototype, 'dispose');
    const lose = runtime.renderer.getContext().getExtension('WEBGL_lose_context')!;
    runtime.renderer.domElement.addEventListener('webglcontextlost', () => controller.contextLost());
    runtime.renderer.domElement.addEventListener('webglcontextrestored', () => controller.contextRestored());
    lose.loseContext();
    await until(() => runtime.isContextLost(), 'the context to go');
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(controller.state()).toBe('off');
    lose.restoreContext();
    await until(() => !runtime.isContextLost(), 'the context to come back');
    controller.update('walk');
    frame();
    await loaded(controller);
    expect(controller.state()).toBe('on');
  });

  test('disposal while loading attaches nothing and disposes what the load built; a failed decode disposes its chain and a later entry retries', async () => {
    const disposeSpy = vi.spyOn(WalkPost.prototype, 'dispose');
    const first = controlled();
    const attach = vi.spyOn(first.runtime, 'setPostProcessor');
    first.controller.update('walk');
    first.controller.dispose();
    await until(() => disposeSpy.mock.calls.length === 1, 'the stale chain to be disposed', 30_000);
    expect(attach.mock.calls.filter(([chain]) => chain !== null)).toEqual([]);

    const second = controlled();
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(new Error('decode'));
    second.controller.update('walk');
    await loaded(second.controller);
    expect(second.controller.state()).toBe('failed');
    expect(second.errors.length).toBe(1);
    expect(disposeSpy).toHaveBeenCalledTimes(2);
    decode.mockRestore();
    second.controller.update('orbit');
    second.controller.update('walk');
    await loaded(second.controller);
    expect(second.controller.state()).toBe('on');
  });
});

type Debug = {
  mode: () => string | undefined;
  walkPost: () => string;
  walkLighting: () => { state: string };
  sunShadow: () => SunShadowState | null;
  presets: () => Array<{ id: string; active: boolean }>;
  applyPreset: (id: string) => { error?: unknown };
  applyOps: (ops: SceneOp[]) => { rev?: number; error?: unknown };
};

function debug(): Debug {
  return (window as unknown as { __viewerDebug: Debug }).__viewerDebug;
}

async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await nextFrame();
}

describe('a mounted viewer in walk and tour', { timeout: MOUNT_TIMEOUT_MS }, () => {
  async function mount(): Promise<ViewerHandle> {
    const handle = mountViewer(openContainer(WIDTH * 2, HEIGHT * 2), {
      scene: { repository: new InlineSceneRepository(withPreset()) },
      tour: { mode: 'off' },
      debug: true,
    });
    disposers.push(() => handle.dispose());
    await handle.ready;
    return handle;
  }

  /** `plan-l-shape` with one interior preset that moves the table: a preset swap that changes a caster. */
  function withPreset(): SceneData {
    const scene = structuredClone(lShapePlan);
    const preset = {
      id: '01a12ffa-de52-7ebf-9129-0a91479080cc',
      name: 'Table by the window',
      swatch: [FINISH.oak, FINISH.sand] as const,
      ops: [{ op: 'move_object', assetId: L_SHAPE.asset.table, position: { x: 2, y: 0, z: 1.5 } }] as const,
    };
    return { ...scene, interiors: [preset] };
  }

  const draws = (): number => debug().sunShadow()?.draws ?? -1;

  /** Waits until the shadow redraw count held still for 20 frames. */
  async function settle(): Promise<number> {
    let last = draws();
    let still = 0;
    for (let frame = 0; frame < 900 && still < 20; frame += 1) {
      await nextFrame();
      const now = draws();
      still = now === last ? still + 1 : 0;
      last = now;
    }
    return last;
  }

  test('a tour from its overview and a walk render through the chain; the sun shadow stays settled; captures go through it', async () => {
    const handle = await mount();
    expect(debug().walkPost()).toBe('off');
    handle.setMode('tour');
    await until(() => debug().mode() === 'tour', 'tour');
    await until(() => debug().walkPost() === 'on', 'the chain in the tour', 60_000);
    handle.setMode('orbit');
    await until(() => debug().walkPost() === 'off', 'detached in orbit', 60_000);
    handle.setMode('walk');
    await until(() => debug().walkPost() === 'on', 'the chain in walk', 60_000);
    // The room lighting bakes after the chain is attached; captures compared byte for byte wait for it.
    await until(() => debug().walkLighting().state === 'live', 'the room lighting in walk', 120_000);

    const settled = await settle();
    await frames(30);
    expect(draws()).toBe(settled);

    const renderTo = vi.spyOn(WalkPost.prototype, 'renderTo');
    const first = await handle.capture.still({ width: 160, height: 120, camera: 'live', caption: false });
    const second = await handle.capture.still({ width: 160, height: 120, camera: 'live', caption: false });
    expect(renderTo).toHaveBeenCalledTimes(2);
    const bytes = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());
    expect(await bytes(first.blob)).toEqual(await bytes(second.blob));
    expect(draws()).toBe(settled);

    await handle.capture.panorama({ width: 64, roomId: L_SHAPE.room.a, caption: false });
    expect(renderTo).toHaveBeenCalledTimes(2);

    const clip = async (): Promise<Uint8Array[]> => {
      const out: Blob[] = [];
      await handle.capture.frames({
        aspect: '1:1',
        height: 64,
        fps: 24,
        from: 0,
        to: 1 / 24,
        caption: false,
        onFrame: (frame) => {
          out.push(frame.blob);
        },
      });
      return Promise.all(out.map((blob) => bytes(blob)));
    };
    expect(await clip()).toEqual(await clip());
    expect(renderTo).toHaveBeenCalledTimes(6);

    const beforeHide = draws();
    handle.setFurnitureVisible(false);
    const hidden = await settle();
    expect(hidden).toBeGreaterThan(beforeHide);
    handle.setFurnitureVisible(true);
    await settle();

    const beforeEdit = draws();
    const moved = debug().applyOps([{ op: 'move_object', assetId: L_SHAPE.asset.table, position: { x: 8, y: 0, z: 2 } }]);
    expect(moved.error).toBeUndefined();
    expect(await settle()).toBeGreaterThan(beforeEdit);

    const beforeWall = draws();
    const wall = debug().applyOps([{ op: 'set_wall', wallId: L_SHAPE.wall.wPart, thickness: 0.15 }]);
    expect(wall.error).toBeUndefined();
    const afterWall = await settle();
    expect(afterWall).toBeGreaterThan(beforeWall);
    await frames(30);
    expect(draws()).toBe(afterWall);
    expect(debug().walkPost()).toBe('on');

    const preset = debug()
      .presets()
      .find((entry) => !entry.active)!;
    const beforePreset = draws();
    expect(debug().applyPreset(preset.id).error).toBeUndefined();
    const afterPreset = await settle();
    expect(afterPreset).toBeGreaterThan(beforePreset);
    await frames(30);
    expect(draws()).toBe(afterPreset);
    expect(debug().walkPost()).toBe('on');
  });
});
