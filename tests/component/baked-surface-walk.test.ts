/**
 * Baked surfaces in walk and tour, in a real WebGL context: the lightmap
 * scaled by the walk's interior sun factor inside rooms (so a baked wall
 * displays as in the editing modes) and unscaled outside them and in grid
 * captures, no grid light on a baked surface, the environment's specular and
 * the room probes' reflections kept; then, on the mounted demo apartment with
 * its shell marked baked, no compile after the walk warm-up and a context
 * restore that comes back to the same walk frame once the bake is done.
 *
 * Small scenes drive the walk patch's uniforms directly and read linear
 * float; the mounted part reads stills.
 */

import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
// Static, so Vite pre-bundles the chunk's three addons before the first test instead of reloading mid-test.
import { WalkLighting } from '../../src/render/walk-post.js';
import { markBakedSurface, setLampBaked } from '../../src/render/baked-surface.js';
import {
  atlasLayout,
  createWalkUniforms,
  installWalkPatch,
  setRoomBoxes,
  setUniformState,
  TILE,
  type WalkUniforms,
} from '../../src/render/walk-lighting/box-probe-patch.js';
import { packAtlas, type Rgb } from '../../src/render/walk-lighting/exterior-sh.js';
import { RoomGrid } from '../../src/render/walk-lighting/room-grid.js';
import type { RoomBox } from '../../src/render/walk-lighting/room-volumes.js';
import { WALK_LIGHTING_TUNING as T } from '../../src/render/walk-lighting/walk-lighting-tuning.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

const SIZE = 32;
const CENTRE = [16, 16] as const;
const opened: THREE.WebGLRenderer[] = [];

function renderer(): THREE.WebGLRenderer {
  const gl = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  gl.setPixelRatio(1);
  gl.setSize(SIZE, SIZE, false);
  opened.push(gl);
  return gl;
}

afterEach(() => {
  for (const gl of opened.splice(0)) {
    gl.dispose();
    gl.forceContextLoss();
  }
});

/** Looks at the unit plane at `x` head-on from +z. */
function camera(x = 0): THREE.OrthographicCamera {
  const view = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  view.position.set(x, 0, 1.5);
  view.lookAt(x, 0, 0);
  return view;
}

function centre(gl: THREE.WebGLRenderer, scene: THREE.Scene, view: THREE.Camera): [number, number, number] {
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType });
  gl.setRenderTarget(target);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(scene, view);
  const pixel = new Float32Array(4);
  gl.readRenderTargetPixels(target, CENTRE[0], CENTRE[1], 1, 1, pixel);
  gl.setRenderTarget(null);
  target.dispose();
  return [pixel[0]!, pixel[1]!, pixel[2]!];
}

const luminance = (rgb: readonly number[]): number => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
const ratio = (a: readonly number[], b: readonly number[]): number => luminance(a) / luminance(b);
const near = (a: number, b: number, relative = 0.01): boolean => Math.abs(a - b) <= relative * Math.abs(b) + 1e-4;

function grey(options: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.LinearSRGBColorSpace),
    roughness: 1,
    metalness: 0,
    specularIntensity: 0,
    ...options,
  });
}

function lightmap(value: number): THREE.DataTexture {
  const byte = Math.round(value * 255);
  const texture = new THREE.DataTexture(new Uint8Array([byte, byte, byte, 255]), 1, 1);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function baked(map: number, options: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  const material = grey({ lightMap: lightmap(map), lightMapIntensity: 1, ...options });
  markBakedSurface(material);
  return material;
}

const cube = (min: number, max: number): RoomBox['projection'] => ({ min: { x: min, y: min, z: min }, max: { x: max, y: max, z: max } });

/** A room box over [min, max] on every axis. */
const room = (min: number, max: number): RoomBox => ({
  roomId: 'room',
  projection: cube(min, max),
  sampling: cube(min + 0.5, max - 0.5),
  selection: cube(min - 0.2, max + 0.2),
  resolution: { x: 2, y: 2, z: 2 },
});

/** A constant-irradiance grid over `box`. */
function constantGrid(box: RoomBox, level: number): RoomGrid {
  const grid = new RoomGrid(box);
  const coefficients: Rgb[] = Array.from({ length: 9 }, () => [0, 0, 0] as Rgb);
  coefficients[0] = [level / 0.886227, level / 0.886227, level / 0.886227];
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

/** A scene with a studio-like environment (or a black one), walk uniforms over one room box, the patch installed. */
function walkScene(
  gl: THREE.WebGLRenderer,
  box: RoomBox,
  options: { blackEnvironment?: boolean } = {},
): { scene: THREE.Scene; uniforms: WalkUniforms } {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(gl);
  const source = new THREE.Scene();
  if (!options.blackEnvironment) source.background = new THREE.Color(0.6, 0.6, 0.6);
  scene.environment = pmrem.fromScene(source, 0).texture;
  pmrem.dispose();
  const uniforms = createWalkUniforms();
  setRoomBoxes(uniforms, [box], [{ roomId: box.roomId, position: { x: 0, y: 0, z: 0 } }], atlasLayout(1));
  return { scene, uniforms };
}

function plane(material: THREE.Material, x = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.position.x = x;
  return mesh;
}

describe('the lightmap of a baked surface in walk', () => {
  test('inside a room: scaled by the walk sun factor, so it displays as in the editing modes', () => {
    const gl = renderer();
    const box = room(-3, 3);
    const { scene, uniforms } = walkScene(gl, box);
    scene.add(plane(baked(0.5)), constantGrid(box, 0.4));
    installWalkPatch(scene, uniforms);
    const view = camera();
    setUniformState(uniforms, 'editing');
    const editing = centre(gl, scene, view);
    setUniformState(uniforms, 'walk');
    const walk = centre(gl, scene, view);
    setUniformState(uniforms, 'capture');
    const capture = centre(gl, scene, view);
    expect(luminance(editing)).toBeGreaterThan(0.03);
    expect(near(ratio(walk, editing), T.walkSunScale)).toBe(true);
    // Displayed under the walk exposure, the wall reads as in editing.
    expect(near(luminance(walk) * T.walkExposure, luminance(editing))).toBe(true);
    // The capture state of the grid and probe bake sees the lightmap unscaled.
    expect(near(luminance(capture), luminance(editing))).toBe(true);
  });

  test('outside every room: lightmap factor 1 under the existing outside compensation, no grid light', () => {
    const gl = renderer();
    const box = room(-3, 3);
    const { scene, uniforms } = walkScene(gl, box);
    scene.add(plane(baked(0.5), 10), constantGrid(room(7, 13), 0.4));
    installWalkPatch(scene, uniforms);
    const view = camera(10);
    setUniformState(uniforms, 'editing');
    const editing = centre(gl, scene, view);
    setUniformState(uniforms, 'walk');
    const walk = centre(gl, scene, view);
    expect(near(ratio(walk, editing), uniforms.jeexOutside.value)).toBe(true);
    // What the editing reading holds is the lightmap alone: the grid and the environment add nothing.
    const alone = new THREE.Scene();
    alone.add(plane(grey({ lightMap: lightmap(0.5), lightMapIntensity: 1 }), 10));
    expect(near(luminance(editing), luminance(centre(gl, alone, view)))).toBe(true);
  });

  test('doubling the room grid leaves a baked floor unchanged and changes an unbaked card', () => {
    const gl = renderer();
    const box = room(-3, 3);
    const readWith = (material: THREE.Material, level: number): number => {
      const { scene, uniforms } = walkScene(gl, box);
      scene.add(plane(material), constantGrid(box, level));
      installWalkPatch(scene, uniforms);
      setUniformState(uniforms, 'walk');
      return luminance(centre(gl, scene, camera()));
    };
    const floor = baked(0.3);
    expect(near(readWith(floor, 0.8), readWith(floor, 0.4))).toBe(true);
    const card = grey();
    expect(readWith(card, 0.8)).toBeGreaterThan(1.5 * readWith(card, 0.4));
  });
});

describe('reflections on a baked surface in walk', () => {
  test('rough metal: the environment specular is not scaled by the walk diffuse switch on a baked surface', () => {
    const gl = renderer();
    const box = room(-3, 3);
    const metal = { metalness: 1, roughness: 0.6, specularIntensity: 1 };
    const readIn = (material: THREE.Material): { editing: number; walk: number } => {
      const { scene, uniforms } = walkScene(gl, box);
      scene.add(plane(material));
      installWalkPatch(scene, uniforms);
      setUniformState(uniforms, 'editing');
      const editing = luminance(centre(gl, scene, camera()));
      setUniformState(uniforms, 'walk');
      // The studio environment's radiance, not the (empty) room probes: only the diffuse switch differs.
      uniforms.jeexBoxProbes.value = 0;
      return { editing, walk: luminance(centre(gl, scene, camera())) };
    };
    const bakedMetal = readIn(baked(0, metal));
    const plainMetal = readIn(grey(metal));
    expect(bakedMetal.editing).toBeGreaterThan(0.05);
    expect(near(bakedMetal.walk, bakedMetal.editing)).toBe(true);
    // The switch is real: an unbaked rough metal loses its multiple scattering in walk.
    expect(plainMetal.walk).toBeLessThan(0.99 * plainMetal.editing);
  });

  test('room-probe specular and clearcoat of a glossy baked floor equal the unbaked floor’s', () => {
    const gl = renderer();
    const box = room(-3, 3);
    const glossy = { color: 0x000000, roughness: 0.2, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.1 };
    const atlas = new THREE.DataTexture(new Float32Array(TILE.width * TILE.height * 4).fill(0.5), TILE.width, TILE.height);
    atlas.type = THREE.FloatType;
    atlas.needsUpdate = true;
    const readIn = (material: THREE.Material, probes: boolean): number => {
      const { scene, uniforms } = walkScene(gl, box, { blackEnvironment: true });
      uniforms.jeexAtlas.value = atlas;
      scene.add(plane(material));
      installWalkPatch(scene, uniforms);
      setUniformState(uniforms, 'walk');
      uniforms.jeexBoxProbes.value = probes ? 1 : 0;
      return luminance(centre(gl, scene, camera()));
    };
    const bakedFloor = readIn(baked(0, glossy), true);
    const plainFloor = readIn(grey(glossy), true);
    expect(bakedFloor).toBeGreaterThan(0.01);
    expect(near(bakedFloor, plainFloor)).toBe(true);
    // The light is the probes': with them off the black environment leaves nothing.
    expect(readIn(baked(0, glossy), false)).toBeLessThan(0.1 * bakedFloor);
  });
});

describe('a real grid capture', () => {
  test('sees the baked walls’ lightmap unscaled in the capture state, scaled in the walk state', () => {
    const gl = renderer();
    const box = room(-2, 2);
    const bakeWith = (walls: THREE.Material, state: 'capture' | 'walk'): number => {
      const { scene, uniforms } = walkScene(gl, box, { blackEnvironment: true });
      const shell = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), walls);
      scene.add(shell);
      const grid = new RoomGrid(box);
      scene.add(grid);
      installWalkPatch(scene, uniforms);
      setUniformState(uniforms, state);
      grid.bake(gl, scene, { start: 0, count: 8, pass: 0, cubemapSize: 8 });
      setUniformState(uniforms, 'editing');
      shell.visible = false;
      const card = plane(grey());
      card.scale.setScalar(0.25);
      scene.add(card);
      return luminance(centre(gl, scene, camera()));
    };
    const side = { side: THREE.BackSide };
    const reference = bakeWith(grey({ lightMap: lightmap(0.5), lightMapIntensity: 1, ...side }), 'capture');
    const capture = bakeWith(baked(0.5, side), 'capture');
    const walk = bakeWith(baked(0.5, side), 'walk');
    expect(reference).toBeGreaterThan(0.01);
    expect(near(capture, reference, 0.02)).toBe(true);
    expect(near(walk / capture, T.walkSunScale, 0.05)).toBe(true);
  });
});

/* ------------------------------------------- the mounted demo, shell baked */

const MOUNT_TIMEOUT_MS = 300_000;
/** Program counts of the mounted part, printed at the end for the report. */
const results: Record<string, unknown> = {};
afterAll(() => {
  console.info(`baked-surface-walk: ${JSON.stringify(results)}`);
});

type Debug = { walkLighting: () => { state: string } };
const debug = (): Debug => (window as unknown as { __viewerDebug: Debug }).__viewerDebug;

/** Marks every floor, ceiling and room wall material of `scene` baked, with a constant lightmap. */
function bakeShell(scene: THREE.Scene): number {
  const done = new Set<THREE.Material>();
  const map = lightmap(0.25);
  scene.traverse((object) => {
    const data = object.userData;
    const mesh = object as THREE.Mesh;
    const shell =
      mesh.isMesh &&
      (data['surface'] === 'floor' || data['isCeiling'] === true || (data['surface'] === 'wall' && data['roomId'] !== undefined));
    if (!shell) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard.isMeshStandardMaterial || done.has(standard)) continue;
      standard.lightMap = map;
      standard.lightMapIntensity = 1;
      markBakedSurface(standard);
      done.add(standard);
    }
  });
  return done.size;
}

/** Mean absolute difference of two PNG stills, 8-bit levels. */
async function stillDifference(a: Blob, b: Blob): Promise<{ mean: number; size: [number, number] }> {
  const data = async (blob: Blob): Promise<ImageData> => {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const [x, y] = await Promise.all([data(a), data(b)]);
  let sum = 0;
  for (let i = 0; i < x.data.length; i += 1) if (i % 4 !== 3) sum += Math.abs(x.data[i]! - y.data[i]!);
  return { mean: sum / ((x.data.length * 3) / 4), size: [x.width, x.height] };
}

describe('the demo apartment with its shell baked, in walk', { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  let live: THREE.Scene | null = null;
  let lighting: { renderer: THREE.WebGLRenderer } | null = null;
  const view = { position: { x: 0.6, y: 1.3, z: 7.6 }, target: { x: 1.6, y: 1.3, z: 7.6 } };

  beforeAll(async () => {
    const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
        live = this as THREE.Scene;
      return add.apply(this, objects);
    });
    const load = Object.getOwnPropertyDescriptor(WalkLighting.prototype, 'load')!.value as WalkLighting['load'];
    vi.spyOn(WalkLighting.prototype, 'load').mockImplementation(function (this: WalkLighting, doc) {
      lighting = this as unknown as { renderer: THREE.WebGLRenderer };
      load.call(this, doc);
    });
    handle = mountViewer(openContainer(320, 240), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    await handle.ready;
    await until(() => live !== null, 'the live scene', 60_000);
    expect(bakeShell(live!)).toBeGreaterThan(0);
  }, MOUNT_TIMEOUT_MS);

  afterAll(() => {
    handle.dispose();
    vi.restoreAllMocks();
    closeContainers();
  });

  const programs = (): number => lighting?.renderer.info.programs?.length ?? -1;
  const still = async (): Promise<Blob> => (await handle.capture.still({ width: 160, height: 120, camera: view, caption: false })).blob;

  test('after the warm-up, the swap, mode switches and lamp toggles compile nothing', async () => {
    const enterWalk = async (what: string): Promise<void> => {
      handle.setMode('walk');
      await until(() => debug().walkLighting().state === 'live', what, MOUNT_TIMEOUT_MS - 60_000);
      for (let i = 0; i < 5; i += 1) await nextFrame();
      await still();
    };
    const toOrbit = async (): Promise<void> => {
      handle.setMode('orbit');
      for (let i = 0; i < 5; i += 1) await nextFrame();
      await still();
    };
    // Warm-up: the first entry (patch installed, grids baked) and the first way back, where the hidden
    // grids change three's own program parameters of every patched material.
    const warmup: Record<string, number> = {};
    await enterWalk('room lighting live');
    warmup['walk'] = programs();
    await toOrbit();
    warmup['orbit'] = programs();
    await enterWalk('room lighting live again');
    warmup['walkAgain'] = programs();
    results['warmup'] = warmup;
    const counts: Record<string, number> = { warmed: programs() };
    for (let i = 0; i < 10; i += 1) await nextFrame();
    counts['frames'] = programs();
    await toOrbit();
    counts['orbit'] = programs();
    await enterWalk('room lighting live a third time');
    counts['walk'] = programs();
    const lamps: THREE.PointLight[] = [];
    live!.traverse((object) => {
      if ((object as THREE.PointLight).isPointLight) lamps.push(object as THREE.PointLight);
    });
    expect(lamps.length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i += 1) {
      setLampBaked(lamps[0]!, i % 2 === 0);
      lamps[0]!.intensity *= 1.5;
      await still();
    }
    setLampBaked(lamps[0]!, false);
    counts['toggles'] = programs();
    results['counts'] = counts;
    expect(counts).toEqual(Object.fromEntries(Object.keys(counts).map((key) => [key, counts['warmed']])));
  });

  test('a context restore in walk comes back to the same frame once the bake is done', async () => {
    const before = await still();
    const canvas = handle.element.querySelector('canvas')!;
    const context = (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))!;
    const extension = context.getExtension('WEBGL_lose_context')!;
    const ready = new Promise<void>((resolve) => {
      const off = handle.on('ready', () => {
        off();
        resolve();
      });
    });
    live = null;
    extension.loseContext();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    extension.restoreContext();
    await ready;
    await until(() => live !== null, 'the re-mounted scene', 60_000);
    // The light-bake binding marks the re-mounted shell; this test stands in for it.
    expect(bakeShell(live!)).toBeGreaterThan(0);
    if (handle.getState().mode !== 'walk') handle.setMode('walk');
    await until(() => debug().walkLighting().state === 'live', 'room lighting live after the restore', MOUNT_TIMEOUT_MS - 60_000);
    const after = await still();
    const difference = await stillDifference(before, after);
    expect(difference.mean).toBeLessThan(1);
  });
});
