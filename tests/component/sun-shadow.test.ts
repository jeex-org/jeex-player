/**
 * The sun shadow against a real WebGL context: the engine behaviour the
 * shadow-only adapter rests on, the rig's cache and its isolation between
 * rigs, the ceilings of a default-state capture, and the redraw count of a
 * mounted viewer through static frames, the cutaway, paint, doors, furniture
 * and an edit.
 *
 * The scene of the mounted tests is `plan-l-shape`: the smallest scene with
 * doors, furniture and two rooms (a component test mounts the smallest scene
 * that carries its claim).
 */

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { afterEach, describe, expect, test } from 'vitest';
import { CATALOGUE_REGISTRIES } from '../../src/assets/catalogue-registries.js';
import { captureCommands } from '../../src/app/capture-commands.js';
import { DEFAULT_VIEWER_OPTIONS } from '../../src/app/viewer-options.js';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { createMessages } from '../../src/ui/messages.js';
import { SceneModel } from '../../src/scene/scene-model.js';
import { SceneBuilder } from '../../src/geometry/scene-builder.js';
import { createRenderRuntime, type RenderRuntime } from '../../src/render/render-runtime.js';
import { installShadowLayerPass } from '../../src/render/shadow-layer-pass.js';
import { playerLighting } from '../../src/render/lighting-engine.js';
import { SHADOW_ONLY_LAYER } from '../../src/shared/render-layers.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { L_SHAPE } from '../../src/fixtures/plan-l-shape-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import { DOOR_ANIMATION_MS } from '../../src/doors/door-state.js';
import { LEGACY_SUN_DIRECTION } from '../../src/lighting/sun-direction.js';
import type { SceneData, SceneOp } from '../../src/scene/types.js';
import type { SunShadowState } from '../../src/render/sun-shadow.js';
import { closeContainers, nextFrame, openContainer, until } from './support.js';

type Debug = {
  mode: () => string | undefined;
  sunShadow: () => SunShadowState | null;
  toggleDoor: (id: string) => boolean;
  applyOps: (ops: SceneOp[]) => { rev?: number; error?: unknown };
};

function debug(): Debug {
  return (window as unknown as { __viewerDebug: Debug }).__viewerDebug;
}

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  closeContainers();
});

async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await nextFrame();
}

/** A bare renderer on a canvas of its own; no viewer around it. */
function bareRenderer(size = 64): THREE.WebGLRenderer {
  const container = openContainer(size, size);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(size, size, false);
  disposers.push(() => {
    renderer.dispose();
    renderer.forceContextLoss();
  });
  return renderer;
}

/** The grey value of the pixel at canvas `(x, y)` from the bottom-left, after `render`. */
function pixelAt(renderer: THREE.WebGLRenderer, x: number, y: number): [number, number, number] {
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return [pixel[0]!, pixel[1]!, pixel[2]!];
}

/** A grey floor 8 m square, a sun straight above it and an ortho camera looking down. */
function stage(): { scene: THREE.Scene; camera: THREE.OrthographicCamera; sun: THREE.DirectionalLight; floor: THREE.Mesh } {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#404040' }));
  floor.receiveShadow = true;
  scene.add(floor);
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  sun.position.set(0.01, 10, 0);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 20 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight('#ffffff', 0.2));
  const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 50);
  camera.position.set(0, 20, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  return { scene, camera, sun, floor };
}

/** A red box hovering over the floor's centre. */
function caster(): THREE.Mesh {
  const box = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3), new THREE.MeshBasicMaterial({ color: '#ff0000' }));
  box.position.set(0, 3, 0);
  box.castShadow = true;
  return box;
}

const grey = (rgb: readonly number[]): number => (rgb[0]! + rgb[1]! + rgb[2]!) / 3;

describe('the shadow-only adapter (three r186 behaviour)', () => {
  test('a caster on the shadow-only layer alone darkens the floor with the adapter, not without it, and is never drawn', () => {
    const renderer = bareRenderer();
    renderer.shadowMap.enabled = true;
    const { scene, camera } = stage();
    const box = caster();
    box.layers.set(SHADOW_ONLY_LAYER);
    scene.add(box);

    renderer.render(scene, camera);
    const without = pixelAt(renderer, 32, 32);

    installShadowLayerPass(renderer);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    const withAdapter = pixelAt(renderer, 32, 32);
    const edge = pixelAt(renderer, 4, 4);

    // Without the adapter three never draws the hidden caster into the map.
    expect(grey(without)).toBeGreaterThan(grey(withAdapter) + 40);
    // With it the centre is in shadow and the corner, outside the box's shadow, is lit.
    expect(grey(edge)).toBeGreaterThan(grey(withAdapter) + 40);
    // The caster itself never reaches the picture: no red.
    expect(withAdapter[0] - withAdapter[1]).toBeLessThan(10);
    expect(camera.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false);
  });
});

describe('a mirror', () => {
  test('never reflects a shadow-only caster; the same box on layer 0 shows in it', () => {
    const renderer = bareRenderer(64);
    renderer.shadowMap.enabled = true;
    installShadowLayerPass(renderer);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    const mirror = new Reflector(new THREE.PlaneGeometry(4, 4), { textureWidth: 64, textureHeight: 64, color: 0xffffff });
    disposers.push(() => mirror.dispose());
    scene.add(mirror);
    // Behind the camera: the box can only be seen in the mirror.
    const box = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 0.5), new THREE.MeshBasicMaterial({ color: '#ff0000' }));
    box.position.set(0, 0, 6);
    box.castShadow = true;
    box.layers.set(SHADOW_ONLY_LAYER);
    scene.add(box);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    const hidden = pixelAt(renderer, 32, 32);
    box.layers.enable(0);
    renderer.render(scene, camera);
    const shown = pixelAt(renderer, 32, 32);
    expect(shown[0] - shown[2]).toBeGreaterThan(60);
    expect(hidden[0] - hidden[2]).toBeLessThan(10);
  });
});

describe('the apartment rig cache', () => {
  function rigScene(shadowCache: boolean) {
    const renderer = bareRenderer();
    const lighting = playerLighting(renderer);
    disposers.push(() => lighting.dispose());
    const { scene, camera } = stage();
    const rig = lighting.createApartmentRig({ shadowCache });
    rig.attach(scene);
    rig.setSunDirection([0.001, 1, 0]);
    rig.setShadowFrustum({
      position: [0.01, 10, 0],
      target: [0, 0, 0],
      up: [0, 0, -1],
      left: -5,
      right: 5,
      top: 5,
      bottom: -5,
      near: 0.1,
      far: 20,
      bias: -0.0001,
      normalBias: 0.01,
      texel: 10 / 2048,
    });
    const box = caster();
    // Seen by the shadow pass (its depth material is three's own), never by the camera.
    const material = box.material as THREE.MeshBasicMaterial;
    material.colorWrite = false;
    material.depthWrite = false;
    box.position.x = -2;
    scene.add(box);
    return { renderer, scene, camera, rig, box };
  }

  test('an uncached rig shows a moved caster on the next render; a cached one only after it is told', () => {
    for (const cached of [false, true]) {
      const { renderer, scene, camera, rig, box } = rigScene(cached);
      renderer.render(scene, camera);
      const leftBefore = grey(pixelAt(renderer, 16, 32));
      box.position.x = 2;
      renderer.render(scene, camera);
      const leftAfter = grey(pixelAt(renderer, 16, 32));
      if (cached) {
        expect({ cached, moved: leftAfter > leftBefore + 40 }).toEqual({ cached, moved: false });
        rig.markShadowDirty();
        renderer.render(scene, camera);
        expect(grey(pixelAt(renderer, 16, 32))).toBeGreaterThan(leftBefore + 40);
        expect(rig.shadowDraws).toBe(2);
      } else {
        expect({ cached, moved: leftAfter > leftBefore + 40 }).toEqual({ cached, moved: true });
      }
    }
  });

  test('two cached rigs keep their own dirtiness, whichever renders first', () => {
    const renderer = bareRenderer();
    const lighting = playerLighting(renderer);
    disposers.push(() => lighting.dispose());
    const live = stage();
    const capture = stage();
    const liveRig = lighting.createApartmentRig({ shadowCache: true });
    const captureRig = lighting.createApartmentRig({ shadowCache: true });
    liveRig.attach(live.scene);
    captureRig.attach(capture.scene);
    renderer.render(live.scene, live.camera);
    renderer.render(capture.scene, capture.camera);
    expect([liveRig.shadowDraws, captureRig.shadowDraws]).toEqual([1, 1]);
    for (const order of [
      [capture, live],
      [live, capture],
    ]) {
      liveRig.markShadowDirty();
      captureRig.markShadowDirty();
      const before = [liveRig.shadowDraws, captureRig.shadowDraws];
      renderer.render(order[0]!.scene, order[0]!.camera);
      renderer.render(order[1]!.scene, order[1]!.camera);
      expect([liveRig.shadowDraws - before[0]!, captureRig.shadowDraws - before[1]!]).toEqual([1, 1]);
    }
    // And nothing more while nobody asks.
    const settled = [liveRig.shadowDraws, captureRig.shadowDraws];
    renderer.render(live.scene, live.camera);
    renderer.render(capture.scene, capture.camera);
    expect([liveRig.shadowDraws, captureRig.shadowDraws]).toEqual(settled);
  });
});

describe('a default-state capture', () => {
  async function decode(blob: Blob): Promise<ImageData> {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  function centreGrey(image: ImageData): number {
    let sum = 0;
    let count = 0;
    for (let y = image.height / 2 - 4; y < image.height / 2 + 4; y += 1) {
      for (let x = image.width / 2 - 4; x < image.width / 2 + 4; x += 1) {
        const at = (y * image.width + x) * 4;
        sum += (image.data[at]! + image.data[at + 1]! + image.data[at + 2]!) / 3;
        count += 1;
      }
    }
    return sum / count;
  }

  test('its ceilings block the sun: the floor under a room centre is darker than in a build without the ceiling casters', async () => {
    const container = openContainer(320, 240);
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const runtime: RenderRuntime = createRenderRuntime({
      canvas,
      viewport: { clientWidth: 320, clientHeight: 240, element: container },
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
    });
    disposers.push(() => runtime.dispose());
    const model = SceneModel.load(structuredClone(lShapePlan), CATALOGUE_REGISTRIES);
    // The live scene of this runtime is a plain build: no ceiling casters, the rig's default frustum.
    const builder = new SceneBuilder(model.scene, model.plan);
    disposers.push(() => builder.dispose());
    runtime.scene.add(builder.build().root);
    const capture = captureCommands({
      runtime: () => runtime,
      model: () => model,
      livePose: () => null,
      options: () => DEFAULT_VIEWER_OPTIONS,
      messages: () => createMessages('en'),
      shellState: () => 'dollhouse',
      ready: () => true,
    });
    const room = model.plan.rooms.find((candidate) => candidate.roomId === L_SHAPE.room.a)!;
    const cx = (room.bbox.minX + room.bbox.maxX) / 2;
    const cz = (room.bbox.minZ + room.bbox.maxZ) / 2;
    const camera = { position: { x: cx, y: 12, z: cz + 0.01 }, target: { x: cx, y: 0, z: cz } };
    const request = { width: 160, height: 160, camera, fov: 20, caption: false } as const;
    const open = centreGrey(await decode((await capture.still({ ...request, state: 'current' })).blob));
    const closed = centreGrey(await decode((await capture.still({ ...request, state: 'default' })).blob));
    expect(closed).toBeLessThan(open - 20);
  });
});

describe('a default-state panorama', () => {
  test('never shows a ceiling caster: the sky above a room without its cap is the sky, not the slab', async () => {
    const container = openContainer(320, 240);
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const runtime: RenderRuntime = createRenderRuntime({
      canvas,
      viewport: { clientWidth: 320, clientHeight: 240, element: container },
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
    });
    disposers.push(() => runtime.dispose());
    const model = SceneModel.load(structuredClone(lShapePlan), CATALOGUE_REGISTRIES);
    const capture = captureCommands({
      runtime: () => runtime,
      model: () => model,
      livePose: () => null,
      options: () => DEFAULT_VIEWER_OPTIONS,
      messages: () => createMessages('en'),
      shellState: () => 'dollhouse',
      ready: () => true,
    });
    const { blob } = await capture.panorama({ width: 256, roomId: L_SHAPE.room.a, state: 'default', caption: false });
    const bitmap = await createImageBitmap(blob);
    const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = offscreen.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    // The top rows of an equirectangular image look straight up: the warm sky
    // gradient there, or a neutral grey-white where a slab is drawn.
    const top = context.getImageData(0, 0, bitmap.width, 2).data;
    let warmth = 0;
    for (let at = 0; at < top.length; at += 4) warmth += top[at]! - top[at + 2]!;
    bitmap.close();
    expect(warmth / (top.length / 4)).toBeGreaterThan(12);
  });
});

describe('a mounted viewer redraws the sun shadow only when something changed', () => {
  async function mount(scene: SceneData = structuredClone(lShapePlan)): Promise<ViewerHandle> {
    const container = openContainer(480, 320);
    const handle = mountViewer(container, { scene: { repository: new InlineSceneRepository(scene) }, tour: { mode: 'off' }, debug: true });
    disposers.push(() => handle.dispose());
    await handle.ready;
    handle.setMode('orbit');
    await until(() => debug().mode() === 'orbit', 'orbit');
    await settle();
    return handle;
  }

  const draws = (): number => debug().sunShadow()?.draws ?? -1;

  /** Waits until the redraw count has held still for 20 frames. */
  async function settle(): Promise<number> {
    let last = draws();
    let still = 0;
    for (let frame = 0; frame < 600 && still < 20; frame += 1) {
      await nextFrame();
      const now = draws();
      still = now === last ? still + 1 : 0;
      last = now;
    }
    return last;
  }

  test('static frames, the cutaway and paint draw nothing; a door draws while it moves, then stops', async () => {
    const handle = await mount();
    const start = draws();
    expect(start).toBeGreaterThanOrEqual(1);
    await frames(60);
    expect(draws() - start).toBeLessThanOrEqual(1);

    const beforeCutaway = draws();
    handle.setMode('walk');
    await until(() => debug().mode() === 'walk', 'walk');
    await frames(30);
    handle.setMode('orbit');
    await until(() => debug().mode() === 'orbit', 'orbit again');
    await frames(30);
    expect(draws()).toBe(beforeCutaway);

    const beforePaint = draws();
    const painted = debug().applyOps([{ op: 'set_material', target: L_SHAPE.room.a, material: FINISH.stone }]);
    expect(painted.error).toBeUndefined();
    await frames(20);
    expect(draws()).toBe(beforePaint);

    const beforeDoor = draws();
    expect(debug().toggleDoor(L_SHAPE.opening.doorAb)).toBe(true);
    const motionFrames = Math.ceil(DOOR_ANIMATION_MS / 16);
    await frames(10);
    expect(draws()).toBeGreaterThan(beforeDoor);
    const after = await settle();
    expect(after - beforeDoor).toBeGreaterThanOrEqual(2);
    expect(after - beforeDoor).toBeLessThanOrEqual(motionFrames * 4);
    await frames(30);
    expect(draws()).toBe(after);
  });

  test('hiding the furniture and an edit redraw; the edit refits the frustum around the moved body', async () => {
    const handle = await mount();
    const beforeHide = draws();
    handle.setFurnitureVisible(false);
    const hidden = await settle();
    expect(hidden).toBeGreaterThan(beforeHide);
    handle.setFurnitureVisible(true);
    const shown = await settle();
    expect(shown).toBeGreaterThan(hidden);

    const width = (): number => {
      const fit = debug().sunShadow()!.fit!;
      return Math.max(fit.right - fit.left, fit.top - fit.bottom);
    };
    const before = width();
    const moved = debug().applyOps([{ op: 'move_object', assetId: L_SHAPE.asset.table, position: { x: 8, y: 0, z: 2 } }]);
    expect(moved.error).toBeUndefined();
    const afterEdit = await settle();
    expect(afterEdit).toBeGreaterThan(shown);
    expect(width()).toBeCloseTo(before, 1);
  });

  test('a site orients the sun; a scene without one brings back the legacy direction', async () => {
    const oriented = { ...structuredClone(lShapePlan), schemaVersion: '2.3', site: { northDeg: 0, sun: 'evening' } } as SceneData;
    const handle = await mount(oriented);
    const state = debug().sunShadow()!;
    expect(state.azimuth).toBeCloseTo(270, 6);
    expect(state.elevation).toBeCloseTo(20, 6);
    await handle.loadScene({ document: structuredClone(lShapePlan) });
    await until(() => debug().sunShadow()?.direction[0] === LEGACY_SUN_DIRECTION[0], 'the legacy sun');
    expect(debug().sunShadow()!.direction).toEqual(LEGACY_SUN_DIRECTION);
  });
});
