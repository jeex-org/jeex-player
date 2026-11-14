/**
 * The glow threshold on the demo flat in walk, through the real chain, on a
 * hardware renderer only: what reaches the glow stage (the linear picture
 * after the occlusion, the rest mean and SMAA) is metered per surface class.
 * The lit walls stay under the stage's threshold; the lamp's light-emitting
 * core (the shade's inside lit at close range by its lamp) and the sun's
 * glints in the window rise far over it.
 *
 * What stays under it on purpose, and is recorded rather than asserted: the
 * outer fabric of a glowing shade (its emissive is capped below the tone
 * curve's knee in walk, `lamp-shade-emissive.test.ts`) and the body of the
 * sky through a window (the lighting standard sets a window sky's median at
 * about a lit wall's level, `LIGHTING_STANDARD.hdri.skyBrightness`). Both
 * read as bright surfaces, not as light sources, so they do not glow.
 *
 * The picture is a still through the chain (`WalkPost.renderTo`) from fixed
 * poses, read where the stage reads it; surfaces are told apart by a class
 * mask of the same view. Values are display-referred: linear luminance times
 * the gain the output pass applies after the stage (the walk exposure and the
 * room's camera balance on grey, `glowThreshold`), so they compare with
 * `WALK_POST_TUNING.bloom.threshold` and the room balance's numbers.
 *
 * On a software rasteriser the file is skipped: the room lighting's bake
 * takes minutes there. Measurements go to `test-results/bloom-threshold.json`
 * (git-ignored).
 */

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { WALK_POST_TUNING, WalkPost } from '../../src/render/walk-post.js';
import { glowThreshold } from '../../src/render/glow-pass.js';
import { openingMaterialFacts } from '../../src/geometry/opening-kinds.js';
import { closeContainers, demoScene, nextFrame, openContainer, rendererName, softwareRasteriser, until } from './support.js';

const MOUNT_TIMEOUT_MS = 300_000;
const SIZE = { w: 480, h: 300 };
const RENDERER = rendererName();
const HARDWARE = !softwareRasteriser();

/** The fixed poses the threshold is judged at (the side-by-side shots use them too). */
const BLOOM_POSES = {
  /** The living room's floor lamp and the wall behind it. */
  lamp: { position: [4.6, 1.5, 6.2], target: [2.86, 0.9, 7.45] },
  /** Under the living room's pendant over the dining table, looking up into its shade. */
  pendant: { position: [4.9, 1.2, 5.6], target: [5.5, 1.95, 7.06] },
  /** Across the living room towards the bay windows. */
  window: { position: [2.6, 1.6, 6.0], target: [2.4, 0.4, 9.6] },
} as const;

const CLASS = { wall: 0, emissive: 1, sky: 2 } as const;
const MASK_CLASSES = 8;
/** Pixels a wall is shrunk by before it is metered (see `inside`). */
const EDGE = 2;

const results: Record<string, unknown> = { renderer: RENDERER };
const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A glowing surface: a material whose emissive term adds light (lamp bulbs, shades). */
function glows(mesh: THREE.Mesh): boolean {
  return [mesh.material].flat().some((material) => {
    const m = material as THREE.MeshStandardMaterial;
    return m.emissive !== undefined && m.emissiveIntensity > 0 && luminance(m.emissive.r, m.emissive.g, m.emissive.b) > 0;
  });
}

const isGlass = (mesh: THREE.Mesh): boolean =>
  [mesh.material].flat().some((material) => openingMaterialFacts.get(material)?.glass === true);

describe.skipIf(!HARDWARE)(`the bloom threshold on the demo flat in walk (${RENDERER})`, { timeout: MOUNT_TIMEOUT_MS }, () => {
  let handle: ViewerHandle;
  /** Every chain that drew; the viewer builds one in walk. */
  const chains: WalkPost[] = [];
  let scene: THREE.Scene;
  let renderer: THREE.WebGLRenderer;

  beforeAll(async () => {
    const draw = Object.getOwnPropertyDescriptor(WalkPost.prototype, 'render')!.value as WalkPost['render'];
    vi.spyOn(WalkPost.prototype, 'render').mockImplementation(function (this: WalkPost, ...args) {
      chains.push(this);
      scene = args[0];
      draw.apply(this, args);
    });
    handle = mountViewer(openContainer(SIZE.w, SIZE.h), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      quality: 'high',
      debug: true,
    });
    await handle.ready;
    handle.setMode('walk');
    const debug = (window as unknown as { __viewerDebug: { walkLighting: () => { state: string } } }).__viewerDebug;
    await until(() => debug.walkLighting().state === 'live', 'room lighting live', MOUNT_TIMEOUT_MS - 60_000);
    await until(() => chains.length > 0, 'the walk chain draws');
    await nextFrame();
    renderer = chains[0]!.composer.renderer;
  }, MOUNT_TIMEOUT_MS);

  afterAll(async () => {
    await commands.writeFile('test-results/bloom-threshold.json', JSON.stringify(results, null, 2));
    handle.dispose();
    vi.restoreAllMocks();
    closeContainers();
  });

  function pose(name: keyof typeof BLOOM_POSES): THREE.PerspectiveCamera {
    const { position, target } = BLOOM_POSES[name];
    const camera = new THREE.PerspectiveCamera(60, SIZE.w / SIZE.h, 0.05, 200);
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateMatrixWorld();
    return camera;
  }

  /** What the bloom stage reads in a still from `camera`: linear RGBA, rows from the bottom. */
  function bloomInput(camera: THREE.Camera): Float32Array {
    const post = chains[0]!;
    const pixels = new Float32Array(SIZE.w * SIZE.h * 4);
    const stage = post.bloom;
    const render = stage.render.bind(stage);
    const out = new THREE.WebGLRenderTarget(SIZE.w, SIZE.h);
    stage.render = (gl, writeBuffer, readBuffer, delta, maskActive) => {
      const half = new Uint16Array(SIZE.w * SIZE.h * 4);
      gl.readRenderTargetPixels(readBuffer, 0, 0, SIZE.w, SIZE.h, half);
      for (let i = 0; i < half.length; i += 1) pixels[i] = THREE.DataUtils.fromHalfFloat(half[i]!);
      render(gl, writeBuffer, readBuffer, delta, maskActive);
    };
    try {
      post.renderTo(out, scene, camera, SIZE.w, SIZE.h);
    } finally {
      stage.render = render;
      out.dispose();
    }
    return pixels;
  }

  /** The class of every pixel of the view (walls, glowing surfaces, the sky), -1 for anything else. */
  function mask(camera: THREE.Camera): Int8Array {
    const palette = Array.from(
      { length: MASK_CLASSES },
      (_, k) =>
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setRGB((k + 1) / MASK_CLASSES, 0, 0, THREE.LinearSRGBColorSpace),
          toneMapped: false,
          fog: false,
          side: THREE.DoubleSide,
        }),
    );
    const none = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false, side: THREE.DoubleSide });
    const swapped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const hidden: THREE.Object3D[] = [];
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = [mesh.material].flat();
      // Glass shows the sky behind it: left out of the mask, like everything that draws nothing.
      if (isGlass(mesh) || materials.every((m) => !m.visible || !m.colorWrite) || materials.some((m) => m.transparent)) {
        if (mesh.visible) hidden.push(mesh);
        mesh.visible = false;
        return;
      }
      swapped.set(mesh, mesh.material);
      const kind = mesh.name === 'wall-face' ? CLASS.wall : glows(mesh) ? CLASS.emissive : null;
      mesh.material = kind === null ? none : palette[kind]!;
    });
    const background = scene.background;
    scene.background = new THREE.Color().setRGB((CLASS.sky + 1) / MASK_CLASSES, 0, 0, THREE.LinearSRGBColorSpace);
    const target = new THREE.WebGLRenderTarget(SIZE.w, SIZE.h, { type: THREE.FloatType });
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Float32Array(SIZE.w * SIZE.h * 4);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE.w, SIZE.h, pixels);
      const out = new Int8Array(SIZE.w * SIZE.h);
      for (let i = 0; i < out.length; i += 1) out[i] = Math.round(pixels[i * 4]! * MASK_CLASSES) - 1;
      return out;
    } finally {
      renderer.setRenderTarget(previous);
      target.dispose();
      for (const [mesh, material] of swapped) mesh.material = material;
      for (const object of hidden) object.visible = true;
      scene.background = background;
      for (const material of [...palette, none]) material.dispose();
    }
  }

  type Stats = { pixels: number; median: number; p99: number; max: number; over: number };

  /** Display-referred luminance per class (scene-linear times the walk exposure and the room balance), and the threshold in the same units. */
  function meter(name: keyof typeof BLOOM_POSES): { wall: Stats; emissive: Stats; sky: Stats; threshold: number } {
    const camera = pose(name);
    const classes = mask(camera);
    const linear = bloomInput(camera);
    const balance = chains[0]!.whiteBalanceAt(camera.position);
    const exposure = renderer.toneMappingExposure;
    const threshold = WALK_POST_TUNING.bloom.threshold;
    // The display gain the stage judges by: its linear threshold is the display one over this.
    const gain = threshold / glowThreshold(threshold, exposure, balance);
    const display = (i: number): number => gain * luminance(linear[i * 4]!, linear[i * 4 + 1]!, linear[i * 4 + 2]!);
    /**
     * Whether pixel `i` and every pixel within `EDGE` of it is of class `kind`: the picture is antialiased and the
     * mask is not, so a bright source's rim spills into the pixels of its neighbours (up to 12.7 on the wall
     * behind the pendant's core, 2026-11-14).
     */
    const inside = (i: number, kind: number): boolean => {
      const [x, y] = [i % SIZE.w, Math.floor(i / SIZE.w)];
      for (let dy = -EDGE; dy <= EDGE; dy += 1)
        for (let dx = -EDGE; dx <= EDGE; dx += 1) {
          const [u, v] = [x + dx, y + dy];
          if (u < 0 || v < 0 || u >= SIZE.w || v >= SIZE.h || classes[v * SIZE.w + u] !== kind) return false;
        }
      return true;
    };
    const stats = (kind: number): Stats => {
      const values: number[] = [];
      for (let i = 0; i < classes.length; i += 1) if (kind === CLASS.wall ? inside(i, kind) : classes[i] === kind) values.push(display(i));
      values.sort((a, b) => a - b);
      const at = (q: number): number => values[Math.min(values.length - 1, Math.floor(values.length * q))] ?? Number.NaN;
      const over = values.filter((value) => value > threshold).length;
      return { pixels: values.length, median: at(0.5), p99: at(0.99), max: values.at(-1) ?? Number.NaN, over };
    };
    const metered = { wall: stats(CLASS.wall), emissive: stats(CLASS.emissive), sky: stats(CLASS.sky), threshold };
    results[name] = { ...metered, exposure, gain };
    return metered;
  }

  test('at the floor lamp: the wall it lights from close by stays under the threshold, and so does the shade`s fabric', () => {
    const { wall, emissive, threshold } = meter('lamp');
    expect(wall.pixels).toBeGreaterThan(2000);
    expect(emissive.pixels).toBeGreaterThan(200);
    expect(wall.max).toBeLessThan(threshold);
    // The fabric reads as a lit surface (its emissive is capped under the knee); only its lit inside, a
    // pixel or two from this side, crosses.
    expect(emissive.p99).toBeLessThan(threshold);
  });

  test('under the pendant: the lamp`s light-emitting core rises far over the threshold, the walls stay under it', () => {
    const { wall, emissive, threshold } = meter('pendant');
    expect(emissive.over).toBeGreaterThanOrEqual(10);
    expect(emissive.max).toBeGreaterThan(4 * threshold);
    expect(wall.max).toBeLessThan(threshold);
  });

  test('towards the bay: the lit walls stay under the threshold, the sun`s glints in the windows rise far over it', () => {
    const { wall, sky, threshold } = meter('window');
    expect(wall.pixels).toBeGreaterThan(2000);
    expect(sky.pixels).toBeGreaterThan(500);
    expect(wall.max).toBeLessThan(threshold);
    expect(sky.over).toBeGreaterThanOrEqual(5);
    expect(sky.max).toBeGreaterThan(4 * threshold);
  });
});
