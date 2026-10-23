/**
 * The walk and tour room lighting in a real browser: the engine facts it
 * relies on (a grid chosen by its box's `containsPoint`, a hidden grid never
 * pushed, the patch neutral outside walk), the calibrated look of the demo
 * apartment and the lifecycle (bake, swap without a recompile, edits,
 * captures).
 *
 * Measurements are written to `test-results/walk-lighting.json` (git-ignored)
 * so a calibration can be read back without a debugger.
 */

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
// Static, so Vite pre-bundles the chunk's three addons before the first test instead of reloading mid-test.
import { WalkLighting, WalkPost } from '../../src/render/walk-post.js';
import { createExteriorGrid, RoomGrid } from '../../src/render/walk-lighting/room-grid.js';
import { packAtlas, type Rgb } from '../../src/render/walk-lighting/exterior-sh.js';
import { createWalkUniforms, installWalkPatch } from '../../src/render/walk-lighting/box-probe-patch.js';
import { WALK_LIGHTING_TUNING as T } from '../../src/render/walk-lighting/walk-lighting-tuning.js';
import { createLightingContext } from '../../src/lighting/lighting-context.js';
import { LIGHTING_STANDARD } from '../../src/lighting/lighting-standard.js';
import type { RoomBox } from '../../src/render/walk-lighting/room-volumes.js';
import type { SceneOp } from '../../src/scene/types.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

const MOUNT_TIMEOUT_MS = 300_000;
const results: Record<string, unknown> = {};

function record(name: string, value: unknown): void {
  results[name] = value;
}

afterAll(async () => {
  await commands.writeFile('test-results/walk-lighting.json', JSON.stringify(results, null, 2));
});

/** A method as the prototype defines it, before a spy wraps it; called with `.call(this, ...)`. */
function original<T extends object, K extends keyof T>(proto: T, key: K): T[K] {
  return Object.getOwnPropertyDescriptor(proto, key)!.value as T[K];
}

/** sRGB-encoded 8-bit channel as linear light. */
const linear = (byte: number): number => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** Mean linear luminance of the central `size` x `size` pixels of a PNG. */
async function centreLuminance(blob: Blob, size = 8): Promise<number> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const x0 = Math.floor((bitmap.width - size) / 2);
  const y0 = Math.floor((bitmap.height - size) / 2);
  const { data } = context.getImageData(x0, y0, size, size);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.2126 * linear(data[i]!) + 0.7152 * linear(data[i + 1]!) + 0.0722 * linear(data[i + 2]!);
  return sum / (data.length / 4);
}

/* --------------------------------------------------------------- engine pins */

/** A renderer of its own, with the lighting standard's display transform. */
function renderer(size = 64): THREE.WebGLRenderer {
  const container = openContainer(size, size);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const gl = new THREE.WebGLRenderer({ canvas });
  gl.setPixelRatio(1);
  gl.setSize(size, size, false);
  return gl;
}

/** A room grid over a unit box whose atlas holds one constant colour of irradiance. */
function constantGrid(colour: Rgb, volume: RoomBox): RoomGrid {
  const grid = new RoomGrid(volume);
  const coefficients: Rgb[] = Array.from({ length: 9 }, () => [0, 0, 0] as Rgb);
  coefficients[0] = colour.map((c) => c / 0.886227) as unknown as Rgb;
  const atlas = packAtlas(coefficients, 2);
  const texture = new THREE.Data3DTexture(atlas.data, 2, 2, atlas.depth);
  texture.type = THREE.FloatType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  grid.texture = texture;
  grid.resolution.set(2, 2, 2);
  return grid;
}

const box = (min: number, max: number, selectionGrow: number): RoomBox => ({
  roomId: `box-${min}`,
  projection: { min: { x: min, y: min, z: min }, max: { x: max, y: max, z: max } },
  sampling: { min: { x: min, y: min, z: min }, max: { x: max, y: max, z: max } },
  selection: {
    min: { x: min - selectionGrow, y: min - selectionGrow, z: min - selectionGrow },
    max: { x: max + selectionGrow, y: max + selectionGrow, z: max + selectionGrow },
  },
  resolution: { x: 2, y: 2, z: 2 },
});

/** The red channel's share of the centre pixel of a small scene lit by grids only. */
function centreColour(gl: THREE.WebGLRenderer, scene: THREE.Scene): number[] {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(1.5, 0.5, 6);
  camera.lookAt(1.5, 0.5, 0);
  const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.FloatType });
  gl.setRenderTarget(target);
  gl.render(scene, camera);
  const pixel = new Float32Array(4);
  gl.readRenderTargetPixels(target, 32, 32, 1, 1, pixel);
  gl.setRenderTarget(null);
  target.dispose();
  return [pixel[0]!, pixel[1]!, pixel[2]!];
}

describe('engine pins (three r186)', () => {
  test('an object outside a grid’s sampling box but inside its selection box takes that grid; a hidden grid is never pushed', () => {
    const gl = renderer();
    const scene = new THREE.Scene();
    // Grid A samples 0..1 but selects up to 2.2; grid B (listed after it) selects everything.
    const a = constantGrid([1, 0, 0], box(0, 1, 1.2));
    const b = createExteriorGrid(
      { hemisphere: { sky: '#000000', ground: '#000000', intensity: 0 }, fill: { colour: '#00ff00', intensity: 3, position: [0, 0, 1] } },
      {
        min: { x: -5, y: -5, z: -5 },
        max: { x: 5, y: 5, z: 5 },
      },
    );
    scene.add(a, b);
    // A white matte card at x = 1.5: outside A's sampling box, inside its selection box.
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    card.position.set(1.5, 0.5, 0.5);
    scene.add(card);
    const taken = centreColour(gl, scene);
    expect(taken[0]!).toBeGreaterThan(0.05);
    expect(taken[1]!).toBeLessThan(taken[0]! * 0.1);
    a.visible = false;
    const fallback = centreColour(gl, scene);
    expect(fallback[0]!).toBeLessThan(0.01);
    expect(fallback[1]!).toBeGreaterThan(0.05);
    gl.dispose();
    gl.forceContextLoss();
  });

  test('the patched shader in the editing state draws exactly what the unpatched one draws', () => {
    const gl = renderer(96);
    const lighting = createLightingContext(THREE, gl);
    const scene = new THREE.Scene();
    const rig = lighting.createApartmentRig();
    rig.attach(scene);
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.3, metalness: 0.2 }),
      new THREE.MeshPhysicalMaterial({ color: 0xaa7755, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 }),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 1 }),
    ];
    materials.forEach((material, i) => {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 16), material);
      sphere.position.set(i - 1, 0, 0);
      scene.add(sphere);
    });
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
    camera.position.set(0, 0.5, 4);
    camera.lookAt(0, 0, 0);
    const read = (): Uint8Array => {
      const target = new THREE.WebGLRenderTarget(96, 96);
      gl.setRenderTarget(target);
      gl.render(scene, camera);
      const pixels = new Uint8Array(96 * 96 * 4);
      gl.readRenderTargetPixels(target, 0, 0, 96, 96, pixels);
      gl.setRenderTarget(null);
      target.dispose();
      return pixels;
    };
    const before = read();
    expect(installWalkPatch(scene, createWalkUniforms())).toBe(3);
    const after = read();
    let differing = 0;
    for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) differing += 1;
    expect(differing).toBe(0);
    lighting.dispose();
    gl.dispose();
    gl.forceContextLoss();
  });
});

/* ------------------------------------------------------ the demo apartment */

type Debug = {
  mode: () => string | undefined;
  walkLighting: () => { state: string; stats: unknown };
  applyOps: (ops: SceneOp[]) => { rev?: number; error?: unknown };
};

function debug(): Debug {
  return (window as unknown as { __viewerDebug: Debug }).__viewerDebug;
}

/** What the tests read of the lighting's private state. */
type Internals = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  grids: RoomGrid[];
  exterior: THREE.Object3D;
  rig: { ambient: THREE.AmbientLight; state: string };
};

const ROOM = {
  wc: '01a15f1b-dbbd-7631-9892-f955c42ec958',
  living: '01a15f1b-dbbd-7634-b8b8-af9c8008284d',
  bathroom: '01a15f1b-dbbd-7630-93f2-2522489e6e62',
};

/** Grey 0.18 matte cards facing +x: one in the windowless WC, one in the living room. */
const PATCHES = {
  wc: {
    at: new THREE.Vector3(6.95, 1.3, 1.8),
    camera: { position: { x: 7.95, y: 1.3, z: 1.8 }, target: { x: 6.95, y: 1.3, z: 1.8 } },
    yaw: Math.PI / 2,
  },
  // Facing the living room's west window (x = 0, z = 8).
  living: {
    at: new THREE.Vector3(1.6, 1.3, 7.6),
    camera: { position: { x: 0.6, y: 1.3, z: 7.6 }, target: { x: 1.6, y: 1.3, z: 7.6 } },
    yaw: -Math.PI / 2,
  },
};

function addPatches(scene: THREE.Scene): void {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.18, 0.18, 0.18, THREE.LinearSRGBColorSpace),
    roughness: 1,
    metalness: 0,
  });
  for (const [name, patch] of Object.entries(PATCHES)) {
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), material);
    card.name = `test-patch-${name}`;
    card.position.copy(patch.at);
    card.rotation.y = patch.yaw;
    scene.add(card);
  }
}

describe('room lighting on the demo apartment', { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  let lighting: Internals;
  let orbitBefore: Blob;
  const errors: string[] = [];

  /** The mean linear luminance of a patch, captured from its camera. */
  async function patch(name: keyof typeof PATCHES): Promise<number> {
    const { blob } = await handle.capture.still({ width: 160, height: 120, camera: PATCHES[name].camera, caption: false });
    return centreLuminance(blob);
  }

  beforeAll(async () => {
    const log = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
      log(...args);
    });
    const load = original(WalkLighting.prototype, 'load');
    vi.spyOn(WalkLighting.prototype, 'load').mockImplementation(function (this: WalkLighting, doc) {
      lighting = this as unknown as Internals;
      load.call(this, doc);
    });
    // The live scene, caught on its first draw, gets the grey cards before anything is measured.
    let live: THREE.Scene | null = null;
    const add = original(THREE.Object3D.prototype, 'add');
    const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
        live ??= this as THREE.Scene;
      return add.apply(this, objects);
    });
    handle = mountViewer(openContainer(480, 320), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    await handle.ready;
    await until(() => live !== null, 'the first frame', 60_000);
    caught.mockRestore();
    addPatches(live!);
    // The bank's lamps reach through walls until the lamp step: off, so the rooms are compared by daylight alone.
    live!.traverse((object) => {
      if ((object as THREE.PointLight).isPointLight) (object as THREE.PointLight).intensity = 0;
    });
  }, MOUNT_TIMEOUT_MS);

  afterAll(() => {
    handle.dispose();
    vi.restoreAllMocks();
    closeContainers();
  });

  test('an orbit frame before walk, then the bake: live within its frame budget, without errors', async () => {
    orbitBefore = (await handle.capture.still({ width: 200, height: 150, caption: false })).blob;
    // The bake is held after its first slice, so a still is taken while it runs.
    const frame = original(WalkLighting.prototype, 'frame');
    let slices = 0;
    let hold = true;
    const held = vi.spyOn(WalkLighting.prototype, 'frame').mockImplementation(function (this: WalkLighting, eligible) {
      if (eligible && this.phase === 'baking') {
        if (hold && slices > 0) return;
        slices += 1;
      }
      frame.call(this, eligible);
    });
    const started = performance.now();
    handle.setMode('walk');
    await until(() => slices > 0, 'the first bake slice', 120_000);
    const states: string[] = [];
    const renderTo = original(WalkPost.prototype, 'renderTo');
    const capture = vi.spyOn(WalkPost.prototype, 'renderTo').mockImplementation(function (this: WalkPost, ...args) {
      const sky = lighting.scene.getObjectByName('jeex-lighting-sky') as THREE.Light;
      states.push(`${lighting.rig.state}:${sky.intensity}:${lighting.grids.some((grid) => grid.visible)}`);
      renderTo.apply(this, args);
    });
    await handle.capture.still({ width: 80, height: 60, camera: 'live', caption: false });
    capture.mockRestore();
    expect(states).toEqual([`editing:${LIGHTING_STANDARD.apartment.hemisphere.intensity}:false`]);
    hold = false;
    held.mockRestore();
    await until(() => debug().walkLighting().state === 'live', 'room lighting live', MOUNT_TIMEOUT_MS - 60_000);
    record('liveAfterMs', Math.round(performance.now() - started));
    record('stats', debug().walkLighting().stats);
    expect(errors).toEqual([]);
  });

  test('no shader thrash: the program count holds still over ten frames after the swap', async () => {
    const programs = (): number => lighting.renderer.info.programs?.length ?? -1;
    await nextFrame();
    const first = programs();
    for (let i = 0; i < 10; i += 1) await nextFrame();
    record('programs', first);
    expect(programs()).toBe(first);
  });

  test('every shell mesh and every bathroom furniture origin selects its own room’s grid', () => {
    const order = [...lighting.grids];
    const first = (object: THREE.Object3D): string | null => {
      const origin = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
      return order.find((grid) => grid.boundingBox.containsPoint(origin))?.roomId ?? null;
    };
    const wrong: string[] = [];
    lighting.scene.traverse((object) => {
      const data = object.userData;
      const roomId = data['roomId'] as string | undefined;
      const shell =
        (object as THREE.Mesh).isMesh &&
        (data['surface'] === 'floor' || data['isCeiling'] === true || (data['surface'] === 'wall' && roomId !== undefined));
      if (shell && first(object) !== roomId) wrong.push(`${object.name}:${roomId}->${first(object)}`);
    });
    expect(wrong).toEqual([]);
    const bathroom = demoScene().assets.filter((asset) => asset.room === ROOM.bathroom);
    expect(bathroom.length).toBeGreaterThan(0);
    for (const asset of bathroom) {
      const group = lighting.scene.getObjectByProperty('name', asset.id) ?? null;
      const meshes: THREE.Object3D[] = [];
      group?.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) meshes.push(object);
      });
      for (const mesh of meshes) expect(first(mesh)).toBe(ROOM.bathroom);
    }
  });

  test('calibration: the windowless WC reads at most 0.35 of the living room; measured values recorded', async () => {
    const wc = await patch('wc');
    const living = await patch('living');
    record('walk', { wc, living, ratio: wc / living, ambient: T.ambientFloor, exposure: T.walkExposure });
    // The components, for the calibration: no ambient floor, exposure 1.
    const ambient = lighting.rig.ambient.intensity;
    const exposure = lighting.renderer.toneMappingExposure;
    lighting.rig.ambient.intensity = 0;
    lighting.renderer.toneMappingExposure = 1;
    record('raw', { wc: await patch('wc'), living: await patch('living') });
    lighting.rig.ambient.intensity = 0.1;
    record('ambient0.1', { wc: await patch('wc'), living: await patch('living') });
    lighting.rig.ambient.intensity = ambient;
    lighting.renderer.toneMappingExposure = exposure;
    expect(wc / living).toBeLessThanOrEqual(0.35);
    expect(wc).toBeGreaterThan(0);
  });

  test('no double counting: doubling the environment changes a rough grey patch by less than 4 %', async () => {
    const before = await patch('living');
    const intensity = lighting.scene.environmentIntensity;
    lighting.scene.environmentIntensity = intensity * 2;
    const after = await patch('living');
    lighting.scene.environmentIntensity = intensity;
    record('doubleEnvironment', { before, after });
    expect(Math.abs(after - before) / before).toBeLessThan(0.04);
  });

  test('facades look as in the editing modes within 5 %', async () => {
    const facade = { position: { x: 18, y: 1.6, z: 2 }, target: { x: 13.35, y: 1.6, z: 2 } };
    const walk = await centreLuminance((await handle.capture.still({ width: 160, height: 120, camera: facade, caption: false })).blob, 16);
    handle.setMode('orbit');
    await until(() => debug().walkLighting().state === 'live' && lighting.rig.state === 'editing', 'the editing look', 30_000);
    const editing = await centreLuminance(
      (await handle.capture.still({ width: 160, height: 120, camera: facade, caption: false })).blob,
      16,
    );
    record('facade', { walk, editing });
    record('editing', { wc: await patch('wc'), living: await patch('living') });
    expect(Math.abs(walk - editing) / editing).toBeLessThan(0.05);
  });

  test('restore: an orbit frame after walk is pixel-identical to one before', async () => {
    for (let i = 0; i < 5; i += 1) await nextFrame();
    const after = await handle.capture.still({ width: 200, height: 150, caption: false });
    const a = new Uint8Array(await orbitBefore.arrayBuffer());
    const b = new Uint8Array(await after.blob.arrayBuffer());
    record('restoreBytes', { before: a.length, after: b.length });
    expect(b.length).toBe(a.length);
    expect(b.every((value, i) => value === a[i])).toBe(true);
  });

  test('a panorama in walk is darker in the windowless WC than in the living room, as on screen', async () => {
    handle.setMode('walk');
    await until(() => lighting.rig.state === 'walk', 'the walk look again', 60_000);
    const mean = async (roomId: string): Promise<number> => {
      const { blob } = await handle.capture.panorama({ width: 256, roomId, caption: false });
      return centreLuminance(blob, 64);
    };
    const wc = await mean(ROOM.wc);
    const living = await mean(ROOM.living);
    record('panorama', { wc, living });
    expect(wc).toBeLessThan(living);
  });

  test('a still of the live view in walk is as dark as the screen, within 2 %', async () => {
    const draw = original(WalkPost.prototype, 'render');
    let screen: number | null = null;
    let pose: { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;
    const spy = vi.spyOn(WalkPost.prototype, 'render').mockImplementation(function (this: WalkPost, ...args) {
      draw.apply(this, args);
      if (screen !== null) return;
      const camera = args[1] as THREE.PerspectiveCamera;
      const position = camera.getWorldPosition(new THREE.Vector3());
      pose = { position, target: position.clone().add(camera.getWorldDirection(new THREE.Vector3())), fov: camera.fov };
      const gl = lighting.renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(16 * 16 * 4);
      gl.readPixels(Math.floor(width / 2) - 8, Math.floor(height / 2) - 8, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4)
        sum += 0.2126 * linear(pixels[i]!) + 0.7152 * linear(pixels[i + 1]!) + 0.0722 * linear(pixels[i + 2]!);
      screen = sum / 256;
    });
    await until(() => screen !== null, 'a frame on screen', 10_000);
    spy.mockRestore();
    const size = lighting.renderer.getDrawingBufferSize(new THREE.Vector2());
    const shot = pose!;
    const camera = { position: shot.position, target: shot.target };
    const { blob } = await handle.capture.still({ width: size.x, height: size.y, camera, fov: shot.fov, caption: false });
    const still = await centreLuminance(blob, 16);
    record('stillVsScreen', { still, screen });
    expect(Math.abs(still - screen!) / screen!).toBeLessThan(0.02);
  });

  test('an edit in walk re-captures only its room’s probe, after the debounce', async () => {
    const refresh = vi.spyOn(WalkLighting.prototype, 'refresh');
    const asset = demoScene().assets.find((item) => item.room === ROOM.living)!;
    const result = debug().applyOps([
      { op: 'move_object', assetId: asset.id, position: { x: asset.position.x + 0.05, y: asset.position.y, z: asset.position.z } },
    ]);
    expect(result.error).toBeUndefined();
    for (let i = 0; i < 5; i += 1) await nextFrame();
    expect(refresh).not.toHaveBeenCalled();
    await until(() => refresh.mock.calls.length > 0, 'the refresh after the debounce', 10_000);
    expect(refresh.mock.calls[0]![0]).toEqual({ all: false, grids: [], probes: [ROOM.living] });
  });
});

/* ----------------------------------------------------- reflections, measured */

type Box = { x0: number; x1: number; z0: number; z1: number };
const HEIGHT_M = 2.6;

/** A closed matte room: four walls and a ceiling facing in, origins inside, casting shadows. */
function room(scene: THREE.Scene, b: Box, open: { side: 'x1' | 'x0' } | null = null): void {
  const material = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9 });
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const walls: Array<{ size: [number, number]; at: [number, number, number]; yaw: number; side: string }> = [
    { size: [w, HEIGHT_M], at: [cx, HEIGHT_M / 2, b.z0 + 0.01], yaw: 0, side: 'z0' },
    { size: [w, HEIGHT_M], at: [cx, HEIGHT_M / 2, b.z1 - 0.01], yaw: Math.PI, side: 'z1' },
    { size: [d, HEIGHT_M], at: [b.x0 + 0.01, HEIGHT_M / 2, cz], yaw: Math.PI / 2, side: 'x0' },
    { size: [d, HEIGHT_M], at: [b.x1 - 0.01, HEIGHT_M / 2, cz], yaw: -Math.PI / 2, side: 'x1' },
  ];
  for (const wall of walls) {
    if (open?.side === wall.side) continue;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...wall.size), material);
    mesh.position.set(...wall.at);
    mesh.rotation.y = wall.yaw;
    mesh.castShadow = true;
    scene.add(mesh);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, HEIGHT_M - 0.01, cz);
  ceiling.castShadow = true;
  scene.add(ceiling);
}

/** A floor over `b`, at `roughness`, origin inside. */
function floor(scene: THREE.Scene, b: Box, roughness: number): void {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 1 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
  scene.add(mesh);
}

/** A bright emissive bar: the stripe or the window of a test room. */
function light(scene: THREE.Scene, size: [number, number, number], at: [number, number, number]): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 6 }),
  );
  mesh.position.set(...at);
  scene.add(mesh);
}

const square = (b: Box) => [
  { x: b.x0, z: b.z0 },
  { x: b.x1, z: b.z0 },
  { x: b.x1, z: b.z1 },
  { x: b.x0, z: b.z1 },
];

/** A renderer, the apartment rig and the room lighting over `rooms`, baked and live. */
function lit(rooms: Array<{ id: string; box: Box }>, build: (scene: THREE.Scene) => void, size = { w: 320, h: 240 }) {
  const gl = renderer(size.w);
  gl.setSize(size.w, size.h, false);
  gl.shadowMap.enabled = true;
  const context = createLightingContext(THREE, gl);
  const scene = new THREE.Scene();
  context.createApartmentRig().attach(scene);
  build(scene);
  const lighting = new WalkLighting(gl, scene);
  lighting.load({
    volumes: {
      rooms: rooms.map((r) => ({ roomId: r.id, polygon: square(r.box), halfWall: 0.05 })),
      ceilingHeight: HEIGHT_M,
      doors: [],
      furniture: [],
    },
    furniture: null,
  });
  for (let frame = 0; frame < 2000 && lighting.phase !== 'live'; frame += 1) lighting.frame(true);
  expect(lighting.phase).toBe('live');
  const shoot = (position: THREE.Vector3Like, target: THREE.Vector3Like): { pixels: Float32Array; camera: THREE.PerspectiveCamera } => {
    const camera = new THREE.PerspectiveCamera(60, size.w / size.h, 0.05, 50);
    camera.position.copy(position);
    camera.lookAt(target.x, target.y, target.z);
    camera.updateMatrixWorld();
    const target2 = new THREE.WebGLRenderTarget(size.w, size.h, { type: THREE.FloatType });
    gl.setRenderTarget(target2);
    gl.render(scene, camera);
    const pixels = new Float32Array(size.w * size.h * 4);
    gl.readRenderTargetPixels(target2, 0, 0, size.w, size.h, pixels);
    gl.setRenderTarget(null);
    target2.dispose();
    return { pixels, camera };
  };
  const lum = (pixels: Float32Array, x: number, y: number): number => {
    const i = (y * size.w + x) * 4;
    return 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
  };
  const dispose = (): void => {
    lighting.dispose();
    context.dispose();
    gl.dispose();
    gl.forceContextLoss();
  };
  return { gl, scene, lighting, shoot, lum, size, dispose };
}

describe('reflections from the room probes', { timeout: MOUNT_TIMEOUT_MS }, () => {
  const A: Box = { x0: 0, x1: 4, z0: 0, z1: 4 };

  test('a mirror-like floor reflects a stripe on the far wall in the stripe’s own screen column (2 px)', () => {
    const world = lit([{ id: 'a', box: A }], (scene) => {
      room(scene, A);
      floor(scene, A, 0.02);
      light(scene, [0.12, 2.2, 0.04], [2.9, 1.2, 0.04]);
    });
    // Pitch 0 and off the probe's point (the room centre): a vertical stripe and its reflection share a column.
    const { pixels } = world.shoot({ x: 1.3, y: 1.3, z: 3.6 }, { x: 1.3, y: 1.3, z: 0 });
    /** The centroid column of the pixels above half the row's maximum: the stripe's centre, to a fraction of a pixel. */
    const brightest = (row: number): number => {
      let peak = 0;
      for (let x = 0; x < world.size.w; x += 1) peak = Math.max(peak, world.lum(pixels, x, row));
      let sum = 0;
      let weight = 0;
      for (let x = 0; x < world.size.w; x += 1) {
        const value = world.lum(pixels, x, row);
        if (value < peak / 2) continue;
        sum += x * value;
        weight += value;
      }
      return Math.round((sum / weight) * 10) / 10;
    };
    // Rows count from the bottom: 0.6 crosses the stripe, 0.1 the floor about 2.8 m ahead.
    const stripeRow = Math.round(world.size.h * 0.6);
    const floorRow = Math.round(world.size.h * 0.1);
    const stripe = brightest(stripeRow);
    const reflection = brightest(floorRow);
    record('reflectionColumns', {
      stripe,
      reflection,
      floorRowMean:
        Array.from({ length: world.size.w }, (_, x) => world.lum(pixels, x, floorRow)).reduce((sum, v) => sum + v, 0) / world.size.w,
    });
    expect(Math.abs(reflection - stripe)).toBeLessThanOrEqual(2);
    // Re-captured twice, a probe is the same: no probe sees an earlier one.
    const atlas = (world.lighting as unknown as { atlas: { target: THREE.WebGLRenderTarget } }).atlas.target;
    const read = (): Uint16Array => {
      const out = new Uint16Array(atlas.width * atlas.height * 4);
      world.gl.readRenderTargetPixels(atlas, 0, 0, atlas.width, atlas.height, out);
      return out;
    };
    world.lighting.refresh({ all: false, grids: [], probes: ['a'] });
    const first = read();
    world.lighting.refresh({ all: false, grids: [], probes: ['a'] });
    const second = read();
    expect(second.every((value, i) => value === first[i])).toBe(true);
    world.dispose();
  });

  test('a glossy floor in a closed room without a window reflects no window of the next room', () => {
    const lit2: Box = { x0: 4.1, x1: 8.1, z0: 0, z1: 4 };
    const world = lit(
      [
        { id: 'dark', box: A },
        { id: 'bright', box: lit2 },
      ],
      (scene) => {
        room(scene, A);
        room(scene, lit2);
        floor(scene, A, 0.05);
        floor(scene, lit2, 0.9);
        light(scene, [0.04, 1.2, 2], [8.05, 1.4, 2]);
      },
    );
    const { pixels } = world.shoot({ x: 1, y: 1.3, z: 2 }, { x: 4, y: 0.4, z: 2 });
    let brightest = 0;
    for (let y = 0; y < world.size.h * 0.35; y += 1)
      for (let x = 0; x < world.size.w; x += 1) brightest = Math.max(brightest, world.lum(pixels, x, y));
    record('closedRoomFloorMax', brightest);
    expect(brightest).toBeLessThan(0.5);
    world.dispose();
  });

  test('across an open boundary the floor’s reflection changes smoothly, no step larger than elsewhere', () => {
    const B: Box = { x0: 4.1, x1: 8.1, z0: 0, z1: 4 };
    const world = lit(
      [
        { id: 'a', box: A },
        { id: 'b', box: B },
      ],
      (scene) => {
        room(scene, A, { side: 'x1' });
        room(scene, B, { side: 'x0' });
        floor(scene, { x0: 0, x1: 8.1, z0: 0, z1: 4 }, 0.25);
        light(scene, [0.04, 1.6, 3], [0.06, 1.3, 2]);
      },
    );
    const { pixels, camera } = world.shoot({ x: 4.05, y: 1.5, z: 3.9 }, { x: 4.05, y: 0, z: 1.2 });
    const steps: Array<{ x: number; step: number }> = [];
    let previous: number | null = null;
    for (let x = 3.2; x <= 4.9; x += 0.02) {
      const p = new THREE.Vector3(x, 0, 2).project(camera);
      const px = Math.round(((p.x + 1) / 2) * world.size.w);
      const py = Math.round(((p.y + 1) / 2) * world.size.h);
      const value = world.lum(pixels, px, py);
      if (previous !== null) steps.push({ x, step: Math.abs(value - previous) });
      previous = value;
    }
    const near = steps.filter((s) => Math.abs(s.x - 4.05) <= T.blendM / 2);
    const far = steps.filter((s) => Math.abs(s.x - 4.05) > T.blendM / 2);
    const max = (list: typeof steps): number => Math.max(...list.map((s) => s.step));
    record('doorwaySteps', { near: max(near), elsewhere: max(far) });
    expect(max(near)).toBeLessThanOrEqual(Math.max(max(far) * 1.5, 1e-3));
    world.dispose();
  });
});
