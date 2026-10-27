/**
 * The light temperature and the walk's sun factor in a real browser.
 *
 * On a bare renderer: a grey card lit by a real bank lamp turns redder at
 * 2700 K and bluer at 6500 K than at 4000 K with its luminance kept, and the
 * sun factor scales direct sun inside a room box only, never a lamp.
 *
 * On the demo apartment: «Original» draws the editing frame of a viewer that
 * started on «Original» and never had another temperature, previews do not change, live and default-state
 * stills and a panorama show the temperature, a context restore keeps it, and
 * the sunlit living-room floor in walk keeps its texture (evening preset).
 *
 * Measurements go to `test-results/light-temperature.json` (git-ignored).
 */

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { buildLamp } from '../../src/assets/asset-builders-lighting-decor.js';
import { GeometryCache, makeBuildKit } from '../../src/assets/asset-kit.js';
import { FinishRegistry } from '../../src/assets/asset-finishes.js';
import type { ResolvedAsset } from '../../src/assets/asset-resolver.js';
import { ARCHETYPE, VARIANT } from '../../src/assets/catalogue-ids.js';
import { tintArtificialLights } from '../../src/render/light-temperature.js';
import {
  atlasLayout,
  createWalkUniforms,
  installWalkPatch,
  setRoomBoxes,
  setUniformState,
} from '../../src/render/walk-lighting/box-probe-patch.js';
import { walkUniformsFor } from '../../src/render/walk-lighting/box-probe-patch.js';
import type { RoomBox } from '../../src/render/walk-lighting/room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from '../../src/render/walk-lighting/walk-lighting-tuning.js';
import type { SceneData, SiteSun } from '../../src/scene/types.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

const MOUNT_TIMEOUT_MS = 300_000;
const results: Record<string, unknown> = {};
afterAll(async () => {
  await commands.writeFile('test-results/light-temperature.json', JSON.stringify(results, null, 2));
});

/* ------------------------------------------------------------ bare renderer */

function renderer(size = 64): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  openContainer(size, size).append(canvas);
  const gl = new THREE.WebGLRenderer({ canvas });
  gl.setPixelRatio(1);
  gl.setSize(size, size, false);
  return gl;
}

/** The linear RGB of the centre pixel, rendered into a float target (no tone mapping, no encoding). */
function centre(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): [number, number, number] {
  const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.FloatType });
  gl.setRenderTarget(target);
  gl.render(scene, camera);
  const pixel = new Float32Array(4);
  gl.readRenderTargetPixels(target, 32, 32, 1, 1, pixel);
  gl.setRenderTarget(null);
  target.dispose();
  return [pixel[0]!, pixel[1]!, pixel[2]!];
}

const lum = ([r, g, b]: readonly number[]): number => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;

function lampAsset(): ResolvedAsset {
  return {
    placementId: '01a12ff0-fecf-7faf-9a83-b97dba8a9328',
    library: 'starter',
    archetypeId: ARCHETYPE.lamp_floor,
    variantId: VARIANT.lamp_floor_brass,
    variantName: 'Test lamp',
    version: '1.0.0',
    category: 'lighting/lamps',
    tags: [],
    dims: [0.4, 1.6, 0.4],
    anchor: 'floor',
    wallSnap: false,
    clearance: 0,
    mountY: 0,
    scale: 1,
    yaw: 0,
    builder: 'lamp',
    options: {},
    finishes: {},
    pricing: { model: 'free' },
  };
}

/** A grey 0.18 matte card facing a bank lamp, and the camera in front of it. */
function lampLitCard(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  const kit = makeBuildKit(new GeometryCache(), new FinishRegistry([]), {}, () => undefined);
  const lamp = buildLamp(lampAsset(), kit);
  // Beside the camera's line of sight, so the card's centre is lit by the lamp and not hidden by it.
  lamp.position.set(0.9, -0.7, 1.2);
  scene.add(lamp);
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.18, 0.18, 0.18, THREE.LinearSRGBColorSpace), roughness: 1 }),
  );
  scene.add(card);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}

describe('on a bare renderer', () => {
  test('a lamp-lit grey card: redder at 2700 K, bluer at 6500 K than at 4000 K, luminance within 5 %', () => {
    const gl = renderer();
    const { scene, camera } = lampLitCard();
    const read = (kelvin: number | null): [number, number, number] => {
      tintArtificialLights(scene, kelvin);
      return centre(gl, scene, camera);
    };
    const original = read(null);
    const warm = read(2700);
    const neutral = read(4000);
    const cold = read(6500);
    const back = read(null);
    results['card'] = { original, warm, neutral, cold };
    expect(back).toEqual(original);
    const chroma = ([r, , b]: readonly number[]): number => r! / b!;
    expect(chroma(warm)).toBeGreaterThan(chroma(neutral));
    expect(chroma(cold)).toBeLessThan(chroma(neutral));
    for (const value of [warm, neutral, cold]) expect(Math.abs(lum(value) - lum(original)) / lum(original)).toBeLessThan(0.05);
    gl.dispose();
    gl.forceContextLoss();
  });

  test('the walk sun factor scales the sun inside a room box only, and never a lamp', () => {
    const gl = renderer();
    const material = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 1 });
    // A tiny environment so the patch (which needs a cube-UV environment) is compiled in.
    const pmrem = new THREE.PMREMGenerator(gl);
    const environment = pmrem.fromScene(new THREE.Scene(), 0, 0.1, 10).texture;
    // One set of uniforms: a patched material keeps the uniforms it was first compiled with.
    const uniforms = createWalkUniforms();
    const shoot = (light: THREE.Light, cardX: number, state: 'editing' | 'walk'): number => {
      const scene = new THREE.Scene();
      scene.environment = environment;
      scene.environmentIntensity = 0;
      const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      card.position.x = cardX;
      scene.add(card, light);
      installWalkPatch(scene, uniforms);
      const box: RoomBox = {
        roomId: 'r',
        projection: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
        sampling: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
        selection: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
        resolution: { x: 2, y: 2, z: 2 },
      };
      setRoomBoxes(uniforms, [box], [{ roomId: 'r', position: { x: 0, y: 0, z: 0 } }], atlasLayout(1));
      setUniformState(uniforms, state);
      // The outside scale is the walk exposure's, not this test's subject.
      uniforms.jeexOutside.value = 1;
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
      camera.position.set(cardX, 0, 2);
      camera.lookAt(cardX, 0, 0);
      const value = lum(centre(gl, scene, camera));
      card.removeFromParent();
      return value;
    };
    const sun = (): THREE.DirectionalLight => {
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(0.5, 0.5, 2);
      return light;
    };
    const lamp = (): THREE.PointLight => {
      const light = new THREE.PointLight(0xffffff, 2, 5, 2);
      light.position.set(0, 0, 1);
      return light;
    };
    const inside = { editing: shoot(sun(), 0, 'editing'), walk: shoot(sun(), 0, 'walk') };
    const outside = { editing: shoot(sun(), 4, 'editing'), walk: shoot(sun(), 4, 'walk') };
    const lamps = { editing: shoot(lamp(), 0, 'editing'), walk: shoot(lamp(), 0, 'walk') };
    results['sunFactor'] = { inside, outside, lamps };
    expect(inside.walk / inside.editing).toBeCloseTo(T.walkSunScale, 3);
    expect(outside.walk).toBe(outside.editing);
    expect(lamps.walk).toBe(lamps.editing);
    pmrem.dispose();
    gl.dispose();
    gl.forceContextLoss();
  });
});

/* ------------------------------------------------------- the demo apartment */

/** Mean linear R/B and luminance of a PNG, optionally of one region. */
async function stats(blob: Blob): Promise<{ rb: number; luminance: number }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const linear = (byte: number): number => {
    const v = byte / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  let r = 0;
  let b = 0;
  let y = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [lr, lg, lb] = [linear(data[i]!), linear(data[i + 1]!), linear(data[i + 2]!)];
    r += lr;
    b += lb;
    y += lum([lr, lg, lb]);
  }
  return { rb: r / Math.max(b, 1e-9), luminance: y / (data.length / 4) };
}

const LIVING_ROOM = '01a15f1b-dbbd-7634-b8b8-af9c8008284d';
/** In the living room, looking at its floor lamp and the wall behind it. */
const LAMP_VIEW = { position: { x: 4.6, y: 1.5, z: 6.2 }, target: { x: 2.86, y: 0.9, z: 7.45 } };

describe('on the demo apartment', { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  let live: THREE.Scene | null = null;

  beforeAll(async () => {
    const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
    const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
        live ??= this as THREE.Scene;
      return add.apply(this, objects);
    });
    handle = mountViewer(openContainer(480, 320), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      // «Original» from the start (the default is 5000 K): the frame of record below is the unconverted one.
      lighting: { temperature: null },
    });
    await handle.ready;
    await until(() => live !== null, 'the live scene', 60_000);
    caught.mockRestore();
  }, MOUNT_TIMEOUT_MS);

  afterAll(() => {
    handle.dispose();
    closeContainers();
  });

  const still = async (state: 'current' | 'default' = 'current'): Promise<Blob> =>
    (await handle.capture.still({ width: 160, height: 120, camera: LAMP_VIEW, state, caption: false })).blob;

  test('«Original» after temperatures draws exactly the frame of a viewer that started on it; previews do not change', async () => {
    const lamp = demoScene().assets.find((asset) => asset.type === 'lamp')!;
    const preview = (): unknown => handle.describeSelection({ kind: 'furniture', id: lamp.id, mode: 'orbit' });
    const before = new Uint8Array(await (await still()).arrayBuffer());
    const previewBefore = JSON.stringify(preview());
    handle.setLightTemperature(2700);
    handle.setLightTemperature(6500);
    expect(JSON.stringify(preview())).toBe(previewBefore);
    handle.setLightTemperature(null);
    const after = new Uint8Array(await (await still()).arrayBuffer());
    expect(after.length).toBe(before.length);
    expect(after.every((value, i) => value === before[i])).toBe(true);
  });

  test('live and default-state stills and a panorama show the temperature', async () => {
    const read = async (kelvin: number): Promise<Record<string, number>> => {
      handle.setLightTemperature(kelvin);
      const panorama = (await handle.capture.panorama({ width: 256, roomId: LIVING_ROOM, caption: false })).blob;
      return {
        current: (await stats(await still('current'))).rb,
        default: (await stats(await still('default'))).rb,
        panorama: (await stats(panorama)).rb,
      };
    };
    const warm = await read(2700);
    const cold = await read(6500);
    handle.setLightTemperature(null);
    results['captures'] = { warm, cold };
    for (const key of ['current', 'default', 'panorama']) expect(warm[key]!).toBeGreaterThan(cold[key]!);
  });

  test('a lost and restored context keeps the temperature', async () => {
    handle.setLightTemperature(2700);
    const tinted = (): number[] => {
      const out: number[] = [];
      live!.traverse((object) => {
        const light = object as THREE.PointLight;
        if (light.isPointLight) out.push(light.color.r / light.color.b);
      });
      return out;
    };
    const ratio = tinted()[0]!;
    const canvas = handle.element.querySelector('canvas')!;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))!;
    const extension = gl.getExtension('WEBGL_lose_context')!;
    const ready = new Promise<void>((resolve) => {
      const off = handle.on('ready', () => {
        off();
        resolve();
      });
    });
    extension.loseContext();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    extension.restoreContext();
    await ready;
    expect(handle.getState().lightTemperature).toBe(2700);
    const after = tinted();
    expect(after.length).toBeGreaterThan(0);
    for (const value of after) expect(value).toBeCloseTo(ratio, 6);
    handle.setLightTemperature(null);
  });
});

/* ----------------------------------------------- the sunlit floor in walk */

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

async function pixels(blob: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data, width, height };
}

const luma = (image: Pixels, x: number, y: number): number => {
  const k = (y * image.width + x) * 4;
  return 0.2126 * image.data[k]! + 0.7152 * image.data[k + 1]! + 0.0722 * image.data[k + 2]!;
};

/** The 64 x 64 block of the lower half where direct sun adds the most: what the factor takes away. */
function sunlitBlock(withSun: Pixels, withoutSun: Pixels): { x: number; y: number; gain: number } {
  let best = { x: 0, y: 0, gain: -Infinity };
  for (let y = Math.floor(withSun.height / 2); y + 64 <= withSun.height; y += 8) {
    for (let x = 0; x + 64 <= withSun.width; x += 8) {
      let gain = 0;
      for (let j = 0; j < 64; j += 4) for (let i = 0; i < 64; i += 4) gain += luma(withSun, x + i, y + j) - luma(withoutSun, x + i, y + j);
      if (gain > best.gain) best = { x, y, gain: gain / 256 };
    }
  }
  return best;
}

/** Display-maximum share, mean and deviation of the 8-bit luminance of one 64 x 64 block. */
function block(image: Pixels, x0: number, y0: number): { clipped: number; mean: number; deviation: number } {
  const values: number[] = [];
  let clipped = 0;
  for (let j = 0; j < 64; j += 1) {
    for (let i = 0; i < 64; i += 1) {
      const k = ((y0 + j) * image.width + x0 + i) * 4;
      if (image.data[k]! >= 254 && image.data[k + 1]! >= 254 && image.data[k + 2]! >= 254) clipped += 1;
      values.push(luma(image, x0 + i, y0 + j));
    }
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  return { clipped: clipped / values.length, mean, deviation };
}

/** Every room's own camera, plus a look down at the living-room floor: the view where the sun adds the most is measured. */
type FloorView = { roomId: string } | { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } };
const floorViews = (scene: SceneData): FloorView[] => [
  ...Object.keys(scene.roomCameras).map((roomId) => ({ roomId })),
  { position: { x: 6.5, y: 1.6, z: 8 }, target: { x: 3.5, y: 0, z: 8 } },
];

type FloorMeasure = {
  sun: SiteSun;
  view: FloorView;
  block: { x: number; y: number; gain: number; size: number };
  editing: ReturnType<typeof block>;
  before: ReturnType<typeof block>;
  after: ReturnType<typeof block>;
};

/** Mounts the demo under `sun`, bakes walk, and measures the view where direct sun adds the most. */
async function measureFloor(sun: SiteSun): Promise<FloorMeasure> {
  const scene: SceneData = { ...demoScene(), site: { sun } };
  let live: THREE.Scene | null = null;
  const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
  const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
      live ??= this as THREE.Scene;
    return add.apply(this, objects);
  });
  const viewer = mountViewer(openContainer(480, 320), {
    scene: { repository: new InlineSceneRepository(scene) },
    tour: { mode: 'off' },
    doors: { autoOpen: false },
    debug: true,
  });
  try {
    await viewer.ready;
    caught.mockRestore();
    const views = floorViews(scene);
    const shot = async (camera: FloorView): Promise<Pixels> =>
      pixels((await viewer.capture.still({ width: 320, height: 240, camera, caption: false })).blob);
    viewer.setMode('walk');
    const debug = (window as unknown as { __viewerDebug: { walkLighting: () => { state: string } } }).__viewerDebug;
    await until(() => debug.walkLighting().state === 'live', 'room lighting live', 120_000);
    for (let i = 0; i < 3; i += 1) await nextFrame();
    const uniforms = walkUniformsFor(live!);
    let best: { view: number; at: ReturnType<typeof sunlitBlock>; before: Pixels; after: Pixels } | null = null;
    for (const [view, camera] of views.entries()) {
      const after = await shot(camera);
      // The same frame with the factor off: what walk drew before it.
      uniforms.jeexSun.value = 1;
      const before = await shot(camera);
      uniforms.jeexSun.value = T.walkSunScale;
      const at = sunlitBlock(before, after);
      if (best === null || at.gain > best.at.gain) best = { view, at, before, after };
    }
    const { view, at, before, after } = best!;
    viewer.setMode('orbit');
    for (let i = 0; i < 3; i += 1) await nextFrame();
    const editing = await shot(views[view]!);
    return {
      sun,
      view: views[view]!,
      block: { ...at, size: 64 },
      editing: block(editing, at.x, at.y),
      before: block(before, at.x, at.y),
      after: block(after, at.x, at.y),
    };
  } finally {
    caught.mockRestore();
    viewer.dispose();
  }
}

describe('the sunlit floor in walk', { timeout: MOUNT_TIMEOUT_MS * 2 }, () => {
  // The evening sun of the demo apartment reaches no floor a room camera sees; noon's does (measured, all three recorded).
  test('keeps its texture: under 1 % clipped, and the luminance deviation the factor-off frame lost comes back to at least 80 % of the editing view', async () => {
    const measured: FloorMeasure[] = [];
    for (const sun of ['evening', 'noon', 'morning'] as const) measured.push(await measureFloor(sun));
    results['sunlitFloor'] = measured;
    // The preset whose sun reaches a floor the cameras see the most.
    const sunlit = measured.reduce((a, b) => (b.block.gain > a.block.gain ? b : a));
    expect(sunlit.block.gain).toBeGreaterThan(1);
    expect(sunlit.after.clipped).toBeLessThan(0.01);
    expect(sunlit.after.deviation).toBeGreaterThan(sunlit.before.deviation);
    expect(sunlit.after.deviation).toBeGreaterThanOrEqual(0.8 * sunlit.editing.deviation);
  });
});
