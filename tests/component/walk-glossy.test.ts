/**
 * Measurements on the demo living room in walk, on a hardware renderer only:
 * the floor's gloss by specular contrast, the window in a polished floor,
 * and the camera white balance's calibration (the ceiling's colour at the
 * walk start, a saturated finish and the window's sky).
 *
 * Everything is metered in scene-linear colour: the live scene rendered into
 * a float target with the live walk lighting (rig, grids, probes), which
 * three draws without tone mapping or exposure, so a ratio of channels or a
 * contrast is read before the display transform. The white balance is linear
 * and applied before tone mapping (`tests/component/walk-post.test.ts` pins
 * that), so its effect on a metered colour is the matrix times that colour.
 *
 * On a software rasteriser the whole file is skipped with its reason: the
 * bake and the probes would take minutes and the numbers are calibrated on
 * the GPU. Measurements go to `test-results/walk-glossy.json` (git-ignored).
 */

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { WalkLighting, WalkPost, WALK_POST_TUNING, WALK_WHITE_BALANCE } from '../../src/render/walk-post.js';
import { atlasLayout, setRoomBoxes, type WalkUniforms } from '../../src/render/walk-lighting/box-probe-patch.js';
import type { RoomBox, RoomProbe } from '../../src/render/walk-lighting/room-volumes.js';
import { whiteBalanceMatrix, type Mat3, type Rgb } from '../../src/render/white-balance.js';
import { openingMaterialFacts } from '../../src/geometry/opening-kinds.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

const MOUNT_TIMEOUT_MS = 300_000;
const LIVING = '01a15f1b-dbbd-7634-b8b8-af9c8008284d';
/** Mesh names of the living room's floor (the shell names its floor meshes after the room). */
const LIVING_FLOOR = /^floor-01a15f1b-dbbd-7634/;
/** The ceiling of the living room at the walk start, metered without the white balance (scene linear, R/B). */
const CEILING_RB_MEASURED = 2.086;
/**
 * Where the 2D footprint placement put the living probe before the
 * clearance: beside the floor lamp's shade. Only the «before» reading uses it.
 */
const PROBE_BEFORE = { x: 2.7, y: 1.5, z: 7.13 };
/** Pose fA of the gloss metering: across the living room towards its west wall. */
const POSE_GLOSS = { position: new THREE.Vector3(5.6, 1.6, 6.2), target: new THREE.Vector3(0.3, 0.9, 7.7) };
/** Pose P2 of the window metering: across the living room towards the bay. */
const POSE_WINDOW = { position: new THREE.Vector3(2.6, 1.6, 6.0), target: new THREE.Vector3(2.4, 0.4, 9.6) };
const SIZE = { w: 480, h: 300 };
/** Classes a mask can tell apart. */
const MASK_CLASSES = 64;
/** Mask classes from here on are candidate furniture meshes. */
const FURNITURE_CLASS0 = 10;

/** The renderer string of a fresh WebGL2 context, and whether it is a hardware one. */
function rendererString(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'none';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
}
const RENDERER = rendererString();
const HARDWARE = !/swiftshader|llvmpipe|softpipe|none/i.test(RENDERER);

const maskHistograms: Array<Record<string, number>> = [];
const results: Record<string, unknown> = { renderer: RENDERER, maskHistograms };
const record = (name: string, value: unknown): void => {
  results[name] = value;
};

type Internals = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  uniforms: WalkUniforms;
  volumes: { boxes: RoomBox[]; probes: RoomProbe[] };
  refresh: WalkLighting['refresh'];
};

/** Window glass: the opening builder's glazing material (it names no pane). */
const isGlass = (mesh: THREE.Mesh): boolean =>
  [mesh.material].flat().some((material) => openingMaterialFacts.get(material)?.glass === true);

const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const times = (m: Mat3, c: Rgb): Rgb =>
  [0, 1, 2].map((r) => Math.max(0, m[r * 3]! * c[0] + m[r * 3 + 1]! * c[1] + m[r * 3 + 2]! * c[2])) as unknown as Rgb;

describe.skipIf(!HARDWARE)(`walk gloss and white balance in the demo living room (${RENDERER})`, { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  let lighting: Internals;
  let walkStart: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number } | null = null;

  /** The live scene rendered from `camera` into a float target: scene-linear RGBA, rows from the bottom. */
  function linearShot(view: THREE.Camera): Float32Array {
    const { renderer, scene } = lighting;
    const target = new THREE.WebGLRenderTarget(SIZE.w, SIZE.h, { type: THREE.FloatType });
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      renderer.render(scene, view);
      const pixels = new Float32Array(SIZE.w * SIZE.h * 4);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE.w, SIZE.h, pixels);
      return pixels;
    } finally {
      renderer.setRenderTarget(previous);
      target.dispose();
    }
  }

  /** Which class each pixel belongs to: `classify` names a class per mesh (or `null`); answers class indices, -1 for none. */
  function mask(view: THREE.Camera, classify: (mesh: THREE.Mesh) => number | null, backgroundClass: number | null = null): Int8Array {
    const { scene } = lighting;
    const swapped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const palette = Array.from(
      { length: MASK_CLASSES },
      (_, k) =>
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setRGB(k + 1, 0, 0),
          toneMapped: false,
          fog: false,
          side: THREE.DoubleSide,
        }),
    );
    const none = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false, side: THREE.DoubleSide });
    const background = scene.background;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      swapped.set(mesh, mesh.material);
      const index = classify(mesh);
      mesh.material = index === null ? none : palette[index]!;
    });
    scene.background = backgroundClass === null ? null : new THREE.Color().setRGB(backgroundClass + 1, 0, 0, THREE.LinearSRGBColorSpace);
    try {
      const pixels = linearShot(view);
      const out = new Int8Array(SIZE.w * SIZE.h);
      for (let i = 0; i < out.length; i += 1) out[i] = Math.round(pixels[i * 4]!) - 1;
      const histogram: Record<string, number> = {};
      for (let i = 0; i < out.length; i += 1) histogram[pixels[i * 4]!.toFixed(2)] = (histogram[pixels[i * 4]!.toFixed(2)] ?? 0) + 1;
      maskHistograms.push(histogram);
      return out;
    } finally {
      for (const [mesh, material] of swapped) mesh.material = material;
      scene.background = background;
      for (const material of [...palette, none]) material.dispose();
    }
  }

  function poseCamera(position: THREE.Vector3, target: THREE.Vector3, fov = 60): THREE.PerspectiveCamera {
    const result = new THREE.PerspectiveCamera(fov, SIZE.w / SIZE.h, 0.05, 200);
    result.position.copy(position);
    result.lookAt(target);
    result.updateMatrixWorld();
    return result;
  }

  /** Sets every living floor material's gloss inputs; answers the restore. */
  function blackFloor(roughness: number): () => void {
    const saved: Array<() => void> = [];
    const done = new Set<THREE.Material>();
    lighting.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !LIVING_FLOOR.test(mesh.name)) return;
      for (const material of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
        if (done.has(material)) continue;
        done.add(material);
        const before = {
          color: material.color.clone(),
          roughness: material.roughness,
          metalness: material.metalness,
          map: material.map,
          roughnessMap: material.roughnessMap,
          metalnessMap: material.metalnessMap,
          normalMap: material.normalMap,
          aoMap: material.aoMap,
        };
        Object.assign(material, {
          roughness,
          metalness: 0,
          map: null,
          roughnessMap: null,
          metalnessMap: null,
          normalMap: null,
          aoMap: null,
        });
        material.color.setRGB(0, 0, 0);
        material.needsUpdate = true;
        saved.push(() => {
          const { color, ...rest } = before;
          Object.assign(material, rest);
          material.color.copy(color);
          material.needsUpdate = true;
        });
      }
    });
    expect(saved.length).toBeGreaterThan(0);
    return () => saved.forEach((restore) => restore());
  }

  /** The living floor's specular contrast at `roughness` from `view`: p99 over median of linear luminance in the floor mask. */
  function contrast(view: THREE.Camera, roughness: number): { p99: number; median: number; contrast: number; pixels: number } {
    const restore = blackFloor(roughness);
    try {
      const floor = mask(view, (mesh) => (LIVING_FLOOR.test(mesh.name) ? 0 : null));
      const pixels = linearShot(view);
      const values: number[] = [];
      for (let i = 0; i < floor.length; i += 1)
        if (floor[i] === 0) values.push(luminance(pixels[i * 4]!, pixels[i * 4 + 1]!, pixels[i * 4 + 2]!));
      values.sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)]!;
      const p99 = values[Math.floor(values.length * 0.99)]!;
      return { p99, median, contrast: p99 / median, pixels: values.length };
    } finally {
      restore();
    }
  }

  /** Puts the living probe at `position` and re-captures it; answers the restore to the placement's point. */
  function probeAt(position: { x: number; y: number; z: number }): () => void {
    const probe = lighting.volumes.probes.find((p) => p.roomId === LIVING)!;
    const placed = { ...probe.position };
    const move = (to: { x: number; y: number; z: number }): void => {
      probe.position = { ...to };
      setRoomBoxes(lighting.uniforms, lighting.volumes.boxes, lighting.volumes.probes, atlasLayout(lighting.volumes.probes.length));
      lighting.refresh.call(lighting as unknown as WalkLighting, { all: false, grids: [], probes: [LIVING] }, null);
    };
    move(position);
    return () => move(placed);
  }

  /** Mean linear luminance of the black r 0.07 living floor in the glass's screen columns and beside them. */
  function windowBand(view: THREE.Camera): { columns: [number, number]; inside: number; beside: number; counts: [number, number] } {
    const restore = blackFloor(0.07);
    try {
      const classes = mask(view, (mesh) => (LIVING_FLOOR.test(mesh.name) ? 0 : null));
      const pixels = linearShot(view);
      // The panes' screen columns, from their projected bounds (glazing draws nothing into a mask).
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse),
      );
      let x0 = SIZE.w;
      let x1 = -1;
      lighting.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !isGlass(mesh) || !frustum.intersectsObject(mesh)) return;
        const box = new THREE.Box3().setFromObject(mesh);
        for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const p = new THREE.Vector3(
            corner & 1 ? box.max.x : box.min.x,
            corner & 2 ? box.max.y : box.min.y,
            corner & 4 ? box.max.z : box.min.z,
          ).project(view);
          const x = Math.round(((Math.max(-1, Math.min(1, p.x)) + 1) / 2) * (SIZE.w - 1));
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
        }
      });
      const inside: number[] = [];
      const beside: number[] = [];
      for (let i = 0; i < classes.length; i += 1) {
        if (classes[i] !== 0) continue;
        const x = i % SIZE.w;
        (x >= x0 && x <= x1 ? inside : beside).push(luminance(pixels[i * 4]!, pixels[i * 4 + 1]!, pixels[i * 4 + 2]!));
      }
      const mean = (list: number[]): number => list.reduce((sum, v) => sum + v, 0) / Math.max(1, list.length);
      return { columns: [x0, x1], inside: mean(inside), beside: mean(beside), counts: [inside.length, beside.length] };
    } finally {
      restore();
    }
  }

  beforeAll(async () => {
    const load = Object.getOwnPropertyDescriptor(WalkLighting.prototype, 'load')!.value as WalkLighting['load'];
    vi.spyOn(WalkLighting.prototype, 'load').mockImplementation(function (this: WalkLighting, doc) {
      lighting = this as unknown as Internals;
      load.call(this, doc);
    });
    const draw = Object.getOwnPropertyDescriptor(WalkPost.prototype, 'render')!.value as WalkPost['render'];
    vi.spyOn(WalkPost.prototype, 'render').mockImplementation(function (this: WalkPost, ...args) {
      const view = args[1] as THREE.PerspectiveCamera;
      walkStart ??= {
        position: view.getWorldPosition(new THREE.Vector3()),
        quaternion: view.getWorldQuaternion(new THREE.Quaternion()),
        fov: view.fov,
      };
      draw.apply(this, args);
    });
    handle = mountViewer(openContainer(SIZE.w, SIZE.h), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    await handle.ready;
    handle.setMode('walk');
    const debug = (window as unknown as { __viewerDebug: { walkLighting: () => { state: string } } }).__viewerDebug;
    await until(() => debug.walkLighting().state === 'live', 'room lighting live', MOUNT_TIMEOUT_MS - 60_000);
    await nextFrame();
    expect(walkStart).not.toBeNull();
  }, MOUNT_TIMEOUT_MS);

  afterAll(async () => {
    await commands.writeFile('test-results/walk-glossy.json', JSON.stringify(results, null, 2));
    handle.dispose();
    vi.restoreAllMocks();
    closeContainers();
  });

  test('mask diagnosis: how glazing and furniture meshes are drawn', () => {
    const how = (mesh: THREE.Mesh) => {
      const chain: Array<{ name: string; visible: boolean; layers: number }> = [];
      for (let o: THREE.Object3D | null = mesh; o; o = o.parent)
        chain.push({ name: `${o.type}:${o.name}`, visible: o.visible, layers: o.layers.mask });
      return {
        chain,
        frustumCulled: mesh.frustumCulled,
        renderOrder: mesh.renderOrder,
        hooks: mesh.onBeforeRender.toString().slice(0, 120),
        material: [mesh.material].flat().map((m) => m.type),
      };
    };
    let glass: THREE.Mesh | null = null;
    let item: THREE.Mesh | null = null;
    lighting.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!glass && isGlass(mesh)) glass = mesh;
      let p: THREE.Object3D | null = mesh;
      while (p && p.userData['assetId'] === undefined) p = p.parent;
      if (!item && p) item = mesh;
    });
    record('maskDiagnosis', { glass: glass && how(glass), item: item && how(item) });
  });

  test('the living probe is clear of the floor lamp', () => {
    const probe = lighting.volumes.probes.find((p) => p.roomId === LIVING)!.position;
    let nearest = Number.POSITIVE_INFINITY;
    const living = new Set(
      demoScene()
        .assets.filter((a) => a.room === LIVING)
        .map((a) => a.id),
    );
    lighting.scene.traverse((object) => {
      const id = object.userData['assetId'] as string | undefined;
      if (id === undefined || !living.has(id)) return;
      let light = false;
      object.traverse((child) => (light ||= (child as THREE.PointLight).isPointLight));
      if (!light) return;
      const box = new THREE.Box3().setFromObject(object);
      if (box.max.y >= 1.4) nearest = Math.min(nearest, box.distanceToPoint(new THREE.Vector3(probe.x, probe.y, probe.z)));
    });
    record('livingProbe', { before: PROBE_BEFORE, after: probe, clearanceFromFloorLamp: nearest });
    expect(nearest).toBeGreaterThanOrEqual(0.5);
  });

  test('gloss by contrast: r 0.07 at least 2.5 times r 0.6 on the black living floor', () => {
    const view = poseCamera(POSE_GLOSS.position, POSE_GLOSS.target);
    const restore = probeAt(PROBE_BEFORE);
    const before = { r007: contrast(view, 0.07), r06: contrast(view, 0.6) };
    restore();
    const after = { r007: contrast(view, 0.07), r06: contrast(view, 0.6) };
    record('glossContrast', {
      pose: { position: POSE_GLOSS.position.toArray(), target: POSE_GLOSS.target.toArray(), fov: 60, size: SIZE },
      before,
      after,
    });
    expect(after.r007.contrast).toBeGreaterThanOrEqual(2.5 * after.r06.contrast);
  });

  test('the window shows in the polished black floor in its own columns', () => {
    // Pose P2: across the living room towards the bay, where geometry puts the windows' mirror image on the floor.
    const view = poseCamera(POSE_WINDOW.position, POSE_WINDOW.target);
    let panes = 0;
    lighting.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && isGlass(object as THREE.Mesh)) panes += 1;
    });
    const restore = probeAt(PROBE_BEFORE);
    const before = windowBand(view);
    restore();
    const after = windowBand(view);
    record('windowBand', {
      pose: { position: POSE_WINDOW.position.toArray(), target: POSE_WINDOW.target.toArray(), fov: 60, size: SIZE },
      panes,
      before,
      after,
    });
    expect(after.columns[1]).toBeGreaterThan(after.columns[0]);
    expect(after.inside).toBeGreaterThan(after.beside);
  });

  test('white balance at the walk start: the ceiling reads warm white, a saturated finish and the sky keep their hue', () => {
    const start = walkStart!;
    const view = new THREE.PerspectiveCamera(start.fov, SIZE.w / SIZE.h, 0.05, 200);
    view.position.copy(start.position);
    view.quaternion.copy(start.quaternion);
    view.updateMatrixWorld();
    // The living walls count only where their finish is neutral (the demo's default is sand, so none do).
    const neutralWall = (mesh: THREE.Mesh): boolean => {
      const material = [mesh.material].flat()[0] as THREE.MeshStandardMaterial;
      const c = material.color;
      return (
        mesh.userData['surface'] === 'wall' &&
        mesh.userData['roomId'] === LIVING &&
        c !== undefined &&
        Math.max(c.r, c.g, c.b) > 0.5 &&
        Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 0.08 * Math.max(c.r, c.g, c.b)
      );
    };
    // Saturated furniture finishes, each its own class; the one covering most pixels is metered.
    const frustumAll = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse),
    );
    const candidates: THREE.Mesh[] = [];
    let owned = 0;
    lighting.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || candidates.length >= MASK_CLASSES - FURNITURE_CLASS0 || !frustumAll.intersectsObject(mesh)) return;
      let owner: THREE.Object3D | null = mesh;
      while (owner && owner.userData['assetId'] === undefined) owner = owner.parent;
      if (!owner) return;
      const c = ([mesh.material].flat()[0] as THREE.MeshStandardMaterial).color as THREE.Color | undefined;
      if (!c) return;
      const top = Math.max(c.r, c.g, c.b);
      owned += 1;
      if (top > 0.05 && (top - Math.min(c.r, c.g, c.b)) / top > 0.2) candidates.push(mesh);
    });
    // The sky is what the background shows (glazing draws nothing into a mask).
    const classes = mask(
      view,
      (mesh) => {
        if (mesh.name === `ceiling-${LIVING}`) return 0;
        if (neutralWall(mesh)) return 1;
        const k = candidates.indexOf(mesh);
        return k < 0 ? null : FURNITURE_CLASS0 + k;
      },
      3,
    );
    const counts = new Map<number, number>();
    for (const k of classes) if (k >= FURNITURE_CLASS0) counts.set(k, (counts.get(k) ?? 0) + 1);
    const furnitureClass = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    const furniture = furnitureClass < 0 ? null : candidates[furnitureClass - FURNITURE_CLASS0]!;
    const pixels = linearShot(view);
    const sums = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    for (let i = 0; i < classes.length; i += 1) {
      const raw = classes[i]!;
      const k = raw >= FURNITURE_CLASS0 ? (raw === furnitureClass ? 2 : -1) : raw;
      if (k < 0 || k > 3) continue;
      for (let c = 0; c < 3; c += 1) sums[k]![c]! += pixels[i * 4 + c]!;
      sums[k]![3]! += 1;
    }
    const mean = (k: number): Rgb => [0, 1, 2].map((c) => sums[k]![c]! / Math.max(1, sums[k]![3]!)) as unknown as Rgb;
    const ceiling = mean(0);
    const walls = mean(1);
    const neutral = [0, 1, 2].map((c) => (sums[0]![c]! + sums[1]![c]!) / Math.max(1, sums[0]![3]! + sums[1]![3]!)) as unknown as Rgb;
    // Calibration: the degree that puts the ceiling's red over blue at 1.45, by bisection.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      const c = times(whiteBalanceMatrix(neutral, mid), ceiling);
      if (c[0] / c[2] > 1.45) lo = mid;
      else hi = mid;
    }
    const tuned = times(WALK_WHITE_BALANCE, ceiling);
    const fabric = mean(2);
    const sky = mean(3);
    const fabricAfter = times(WALK_WHITE_BALANCE, fabric);
    const skyAfter = times(WALK_WHITE_BALANCE, sky);
    const argmax = (c: Rgb): number => c.indexOf(Math.max(...c));
    record('whiteBalance', {
      domain: 'scene linear (float target, no tone mapping, no exposure)',
      pose: { position: start.position.toArray(), quaternion: start.quaternion.toArray(), fov: start.fov, size: SIZE },
      pixels: sums.map((s) => s[3]),
      ceiling,
      walls,
      neutral,
      calibratedDegree: (lo + hi) / 2,
      tuning: WALK_POST_TUNING.whiteBalance,
      ceilingRbBefore: ceiling[0] / ceiling[2],
      ceilingAfter: tuned,
      ceilingRbAfter: tuned[0] / tuned[2],
      furnitureMeshes: { owned, candidates: candidates.length },
      furniture: {
        mesh: furniture?.name,
        material: furniture ? ([furniture.material].flat()[0] as THREE.Material).name : null,
        before: fabric,
        after: fabricAfter,
      },
      sky: { before: sky, after: skyAfter },
    });
    expect(Math.abs(ceiling[0] / ceiling[2] - CEILING_RB_MEASURED) / CEILING_RB_MEASURED).toBeLessThan(0.05);
    expect(tuned[0] / tuned[2]).toBeGreaterThanOrEqual(1.3);
    expect(tuned[0] / tuned[2]).toBeLessThanOrEqual(1.6);
    expect(tuned[0]).toBeGreaterThanOrEqual(tuned[1]);
    expect(tuned[1]).toBeGreaterThanOrEqual(tuned[2]);
    expect(furniture).not.toBeNull();
    expect(argmax(fabricAfter)).toBe(argmax(fabric));
    if (sums[3]![3]! > 0) expect(skyAfter[2] / skyAfter[0]).toBeGreaterThanOrEqual((sky[2] / sky[0]) * 0.999);
  });
});
