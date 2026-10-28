/**
 * The low quality tier must hold the walk look: the per-room white balance and
 * exposure criteria of `room-white-balance.test.ts`, measured at
 * `quality: 'low'` (pixel-ratio cap 1.25, full occlusion buffer, denoise
 * radius 4 / samples 8, GTAO 8 rays, 4 probes baked per frame —
 * `src/render/quality-tier.ts`). A slower phone look may soften occlusion and
 * slow the probe bake, but the frames a visitor sees stay balanced
 * photographs: whites R/B in `NEUTRAL_RB`, median lightness at least
 * `MIN_MEDIAN`, clipped share at most `MAX_CLIPPED`.
 *
 * This file mirrors `room-white-balance.test.ts` on purpose: that test keeps
 * its measurement helpers (`whiteMask`, `measure`, the albedo classification)
 * private to its own describe block, so the code below is a copy of them, not
 * an import. The two files must stay in lockstep — when the criteria or the
 * metering change there, they change here. The mounts differ exactly twice:
 * the scene comes through `LocalFixtureRepository` (the demo page's own
 * source) and the mount pins `quality: 'low'`; a guard asserts the tier
 * before the bake, so a wrong tier cannot pass by accident.
 *
 * On a software rasteriser the file is skipped, like its mirror. Measurements
 * go to `test-results/quality-low-look.json` (git-ignored).
 */

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { WalkLighting } from '../../src/render/walk-post.js';
import { LocalFixtureRepository } from '../../src/demo/fixture-repository.js';
import { closeContainers, demoScene, nextFrame, openContainer, rendererName, softwareRasteriser } from './support.js';

const MOUNT_TIMEOUT_MS = 600_000;
/** The same window the high tier is held to (`room-white-balance.test.ts`). */
const NEUTRAL_RB = { min: 0.98, max: 1.14 };
/** sRGB median lightness of the frame, 0-255. */
const MIN_MEDIAN = 160;
/** Share of the frame with every channel at 250 or more. */
const MAX_CLIPPED = 0.01;
/** A room needs this many white-material pixels for its reading to count. */
const MIN_WHITE_PIXELS = 2000;
const SIZE = { w: 640, h: 400 };
const FOV = 60;
const ROOMS = ['Living and dining room', 'Bedroom', 'Kitchen', 'Bathroom'] as const;

const RENDERER = rendererName();
const results: Record<string, unknown> = { renderer: RENDERER, quality: 'low' };

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** The mean linear colour of a texture's image, or `null` when it has none that can be drawn. */
const textureMeans = new Map<THREE.Texture, [number, number, number] | null>();
function textureMean(texture: THREE.Texture): [number, number, number] | null {
  if (textureMeans.has(texture)) return textureMeans.get(texture)!;
  let mean: [number, number, number] | null = null;
  const image = texture.image as CanvasImageSource | undefined;
  if (image && typeof (image as { width?: number }).width === 'number') {
    const canvas = new OffscreenCanvas(8, 8);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0, 8, 8);
    const { data } = context.getImageData(0, 0, 8, 8);
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c += 1) sum[c]! += linear(data[i + c]! / 255);
    mean = sum.map((v) => v / 64) as [number, number, number];
  }
  textureMeans.set(texture, mean);
  return mean;
}

/**
 * The albedo of a white material (its base colour times its colour map's mean), or `null` for anything else:
 * a white material is a non-metal, unlit by itself, whose albedo is light (every channel over 0.6) and pale
 * (saturation under 0.2). The demo's whites are off-white: its ceiling paint reads red over blue 1.16, its
 * sanitary ware 1.06. A sand wall (a white colour over a sand map) is not white.
 */
function whiteAlbedo(material: THREE.Material): [number, number, number] | null {
  const m = material as THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>;
  if (!m.isMeshStandardMaterial || m.metalness > 0.5 || (m.transmission ?? 0) > 0 || m.transparent) return null;
  if (m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) return null;
  const map = m.map ? textureMean(m.map) : [1, 1, 1];
  if (map === null) return null;
  const albedo: [number, number, number] = [m.color.r * map[0]!, m.color.g * map[1]!, m.color.b * map[2]!];
  const max = Math.max(...albedo);
  return Math.min(...albedo) > 0.6 && (max - Math.min(...albedo)) / max < 0.2 ? albedo : null;
}

type Reading = { light: number; surface: number; whitePixels: number; median: number; clipped: number; whiteMaterials: string[] };

async function pixels(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

describe.skipIf(softwareRasteriser())(
  `per-room camera white balance in walk at quality low (${RENDERER})`,
  { timeout: MOUNT_TIMEOUT_MS },
  () => {
    let handle: ViewerHandle;
    let live: { renderer: THREE.WebGLRenderer; scene: THREE.Scene } | null = null;
    const readings = new Map<string, Reading>();

    /**
     * The albedo each pixel of a view from `camera` shows where it is a white material, zero elsewhere: linear
     * RGB, rows from the top as an image; and the white materials' names.
     */
    function whiteMask(camera: THREE.Camera): { albedo: Float32Array; names: string[] } {
      const { renderer, scene } = live!;
      const paints = new Map<string, THREE.MeshBasicMaterial>();
      const paint = (rgb: readonly number[]): THREE.MeshBasicMaterial => {
        const key = rgb.join(',');
        let material = paints.get(key);
        if (!material) {
          material = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, side: THREE.DoubleSide });
          material.color.setRGB(rgb[0]!, rgb[1]!, rgb[2]!, THREE.LinearSRGBColorSpace);
          paints.set(key, material);
        }
        return material;
      };
      const swapped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      const hidden: THREE.Object3D[] = [];
      const names = new Set<string>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        const materials = [mesh.material].flat();
        // What draws nothing on screen (pick shapes, auras) stays undrawn: painted it would cover what it wraps.
        if (materials.every((m) => !m.visible || !m.colorWrite || (m.transparent && m.opacity <= 0))) {
          hidden.push(mesh);
          mesh.visible = false;
          return;
        }
        swapped.set(mesh, mesh.material);
        const albedo = whiteAlbedo(materials[0]!);
        if (albedo) names.add(materials[0]!.name || mesh.name);
        mesh.material = paint(albedo ?? [0, 0, 0]);
      });
      const background = scene.background;
      const target = new THREE.WebGLRenderTarget(SIZE.w, SIZE.h, { type: THREE.FloatType });
      const previous = renderer.getRenderTarget();
      const out = new Float32Array(SIZE.w * SIZE.h * 4);
      try {
        scene.background = null;
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 1);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, SIZE.w, SIZE.h, out);
      } finally {
        renderer.setRenderTarget(previous);
        scene.background = background;
        for (const [mesh, material] of swapped) mesh.material = material;
        for (const object of hidden) object.visible = true;
        target.dispose();
        for (const material of paints.values()) material.dispose();
      }
      const albedo = new Float32Array(SIZE.w * SIZE.h * 3);
      for (let y = 0; y < SIZE.h; y += 1)
        for (let x = 0; x < SIZE.w; x += 1)
          for (let c = 0; c < 3; c += 1) albedo[((SIZE.h - 1 - y) * SIZE.w + x) * 3 + c] = out[(y * SIZE.w + x) * 4 + c]!;
      return { albedo, names: [...names].sort() };
    }

    /**
     * Reads a still: the light on its white materials (red over blue of their pixels over that of their albedo,
     * clipped pixels left out), the same surfaces as they read (paint included), its median lightness and its
     * clipped share.
     */
    function measure(data: Uint8ClampedArray, albedo: Float32Array, names: string[]): Reading {
      const count = data.length / 4;
      const lum = new Float64Array(count);
      const sums = { r: 0, b: 0, ar: 0, ab: 0 };
      let whitePixels = 0;
      let clipped = 0;
      for (let i = 0; i < count; i += 1) {
        const [r, g, b] = [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!];
        lum[i] = 0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255);
        if (Math.min(r, g, b) >= 250) clipped += 1;
        if (albedo[i * 3]! <= 0 || Math.max(r, g, b) >= 250) continue;
        sums.r += linear(r / 255);
        sums.b += linear(b / 255);
        sums.ar += albedo[i * 3]!;
        sums.ab += albedo[i * 3 + 2]!;
        whitePixels += 1;
      }
      lum.sort();
      const surface = sums.r / sums.b;
      return {
        light: surface / (sums.ar / sums.ab),
        surface,
        whitePixels,
        median: lum[Math.floor(count / 2)]! ** (1 / 2.2) * 255,
        clipped: clipped / count,
        whiteMaterials: names,
      };
    }

    beforeAll(async () => {
      const load = Object.getOwnPropertyDescriptor(WalkLighting.prototype, 'load')!.value as WalkLighting['load'];
      vi.spyOn(WalkLighting.prototype, 'load').mockImplementation(function (this: WalkLighting, doc) {
        live = this as unknown as { renderer: THREE.WebGLRenderer; scene: THREE.Scene };
        load.call(this, doc);
      });
      const startedAt = performance.now();
      handle = mountViewer(openContainer(SIZE.w, SIZE.h), {
        scene: { repository: new LocalFixtureRepository() },
        view: { mode: 'walk' },
        tour: { mode: 'off' },
        doors: { autoOpen: false },
        quality: 'low',
        debug: true,
      });
      console.log(`[qlow] mounted at ${Math.round(performance.now() - startedAt)} ms`);
      // The lighting controller reports its one failure per document through
      // the error event; log it, so a stalled bake names its throw.
      handle.on('error', (error) => {
        const cause = error.cause;
        console.log(
          `[qlow] viewer error: code=${error.code} message=${error.message} cause=${cause instanceof Error ? cause.message : String(cause)}`,
        );
      });
      await handle.ready;
      console.log(`[qlow] ready at ${Math.round(performance.now() - startedAt)} ms`);
      handle.setMode('walk');
      // Guard: the whole measurement below is only about the low tier, and the
      // lighting bake is already running on its tier when the state turns live.
      const quality = window.__viewerDebug!.quality();
      expect(quality.mode).toBe('fixed');
      expect(quality.tier).toBe('low');
      console.log(`[qlow] tier ${JSON.stringify(quality)} at ${Math.round(performance.now() - startedAt)} ms`);
      // A polling wait with breadcrumbs instead of `until`: a stall must name
      // the last lighting phase it saw, not die as a bare hook timeout. A
      // terminal state never becomes `live`, so waiting the budget out there
      // would stall a failing run for nothing (`dev/meter.ts` does the same).
      let lastState = window.__viewerDebug!.walkLighting().state;
      console.log(`[qlow] lighting state at ready: ${lastState}`);
      const lightingDeadline = performance.now() + 480_000;
      while (window.__viewerDebug!.walkLighting().state !== 'live') {
        const now = window.__viewerDebug!.walkLighting().state;
        if (now === 'failed' || now === 'empty' || now === 'off') {
          throw new Error(
            `walk lighting ended in ${now} (from ${lastState} after ${Math.round(performance.now() - startedAt)} ms; see the viewer error above)`,
          );
        }
        if (performance.now() > lightingDeadline) {
          throw new Error(
            `walk lighting never went live (last state ${window.__viewerDebug!.walkLighting().state} after ${Math.round(performance.now() - startedAt)} ms)`,
          );
        }
        await nextFrame();
        if (now !== lastState) {
          console.log(`[qlow] lighting ${lastState} -> ${now} at ${Math.round(performance.now() - startedAt)} ms`);
          lastState = now;
        }
      }
      console.log(`[qlow] lighting live at ${Math.round(performance.now() - startedAt)} ms`);
      for (let i = 0; i < 30; i += 1) await nextFrame();
      const scene = demoScene();
      for (const name of ROOMS) {
        const room = scene.rooms.find((candidate) => candidate.name === name);
        if (!room) throw new Error(`the demo has no room named ${name}`);
        const pose = scene.roomCameras[room.id]!;
        const camera = new THREE.PerspectiveCamera(FOV, SIZE.w / SIZE.h, 0.05, 200);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
        camera.updateMatrixWorld();
        const { albedo, names } = whiteMask(camera);
        const shot = await handle.capture.still({ width: SIZE.w, height: SIZE.h, camera: { roomId: room.id }, fov: FOV, caption: false });
        readings.set(name, measure(await pixels(shot.blob), albedo, names));
        console.log(`[qlow] metered ${name} at ${Math.round(performance.now() - startedAt)} ms`);
      }
      results['readings'] = Object.fromEntries(readings);
      await commands.writeFile('test-results/quality-low-look.json', JSON.stringify(results, null, 2));
    }, MOUNT_TIMEOUT_MS);

    afterAll(() => {
      handle?.dispose();
      vi.restoreAllMocks();
      closeContainers();
    });

    test.each(ROOMS)('%s: the light on its white materials reads near neutral at the low tier', (name) => {
      const { light, whitePixels } = readings.get(name)!;
      expect(whitePixels).toBeGreaterThanOrEqual(MIN_WHITE_PIXELS);
      expect(light).toBeGreaterThanOrEqual(NEUTRAL_RB.min);
      expect(light).toBeLessThanOrEqual(NEUTRAL_RB.max);
    });

    test.each(ROOMS)('%s: as bright as a photograph at the low tier, without flattening the window to white', (name) => {
      const { median, clipped } = readings.get(name)!;
      expect(median).toBeGreaterThanOrEqual(MIN_MEDIAN);
      expect(clipped).toBeLessThanOrEqual(MAX_CLIPPED);
    });
  },
);
