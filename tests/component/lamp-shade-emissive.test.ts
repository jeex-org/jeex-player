/**
 * Lamp shades in a real browser: lit, never blown out.
 *
 * A shade finish glows by its emissive term, which three adds unshaded and
 * which the display exposure then multiplies. Walk renders at a higher
 * exposure than the editing look, so a glow tuned for the editing look clips
 * in walk. This file meters the demo apartment's floor lamp, worn in each
 * glowing shade finish in turn (one mount per finish, so the walk room
 * lighting is built for that finish before any reading), BEFORE tone
 * mapping: the renderer's tone mapping is switched to linear at
 * 1/headroom of the mode's exposure for the capture, so a decoded pixel ×
 * headroom is the value the tone mapper would have received (`HEADROOM` in
 * walk, `EDITING_HEADROOM` in orbit and the 3D plan).
 *
 * In walk the shade's mean brightest channel must stay at or under
 * `CEILING`. It was PBR Neutral's compression constant 0.76 (the knee itself,
 * `KNEE`, is 0.8 before tone mapping) while the lamps stayed out of the room
 * grids; since they feed them, the light a lamp bounces off the ceiling and
 * walls lands on its own shade too, which is physical and lifts the unlit
 * shade alone to about 0.76. The bound is the highest lamps-on reading
 * measured then (1.380, `lamp_warm`, on an NVIDIA GPU) plus 10 %, so the
 * emissive cap still has to hold the glow on top of that light. In the
 * editing look the glow must still add light; the displayed
 * 8-bit luminance is recorded too.
 *
 * The shade's pixels are the ones a reference glow (intensity 1) brightens;
 * the same capture with the emissive off is the unlit surface of the same
 * colour under the same light.
 *
 * Measurements go to `test-results/lamp-shade-emissive.json` (git-ignored).
 */

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { DEMO } from '../../src/demo/demo-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

const MOUNT_TIMEOUT_MS = 300_000;
/** In the living room, looking at its floor lamp and the wall behind it (the light-temperature test's view). */
const LAMP_VIEW = { position: { x: 4.6, y: 1.5, z: 6.2 }, target: { x: 2.86, y: 0.9, z: 7.45 } };
const SHOT = { width: 320, height: 240 } as const;
/** Headroom of the linear walk capture: a decoded pixel × this is the pre-tone-map value. */
const HEADROOM = 8;
/** A pixel belongs to the shade when a reference glow raises it by more than this, pre-tone-map. */
const MASK_STEP = 0.02;
/** Pre-tone-map brightest channel where PBR Neutral starts to compress: its constant 0.76 plus its 0.04 offset. */
const KNEE = 0.8;
/** The walk ceiling of the shade's mean brightest channel: the measured lamps-on maximum 1.380 plus 10 % (see above). */
const CEILING = 1.52;
/** Headroom of the linear editing-look capture (its largest pre-tone-map value is 3.2). */
const EDITING_HEADROOM = 4;
/** How much light the glow must still add in the editing look, before tone mapping. */
const EDITING_LIT_RATIO = 1.02;
/** How much brighter than the unlit surface the shade must read in walk, in mean luminance. */
const WALK_LIT_RATIO = 1.25;

const SHADES = ['shade_ivory', 'shade_ink', 'shade_opal', 'lamp_warm'] as const;
type Shade = (typeof SHADES)[number];

type WalkReading = {
  pixels: number;
  /** Mean pre-tone-map luminance of the shade as it renders, and of the same pixels with its emissive off. */
  lit: number;
  unlit: number;
  ratio: number;
  /** Mean, and 95th percentile, over the shade of the pre-tone-map brightest channel. */
  peakMean: number;
  peak95: number;
  /** Share of shade pixels whose brightest channel reaches `KNEE`. */
  compressed: number;
};
type DisplayReading = {
  pixels: number;
  /** Mean displayed 8-bit sRGB luminance of the shade with its glow and without it, and the difference. */
  lit: number;
  unlit: number;
  step: number;
  /** Mean pre-tone-map luminance with the glow over the same without it. */
  ratio: number;
};
type Entry = { intensity: number; walk?: WalkReading; orbit?: DisplayReading; plan3d?: DisplayReading };

const results: Partial<Record<Shade, Entry>> = {};
afterAll(async () => {
  await commands.writeFile('test-results/lamp-shade-emissive.json', JSON.stringify(results, null, 2));
});

const decode = (byte: number): number => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** The PNG as RGB floats: decoded to linear × `scale`, or the raw 8-bit codes when `scale` is null. */
async function rgb(blob: Blob, scale: number | null): Promise<Float32Array> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = new Float32Array((data.length / 4) * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    for (let c = 0; c < 3; c += 1) out[o + c] = scale === null ? data[i + c]! : decode(data[i + c]!) * scale;
  }
  return out;
}

const lum = (pixels: Float32Array, o: number): number => 0.2126 * pixels[o]! + 0.7152 * pixels[o + 1]! + 0.0722 * pixels[o + 2]!;
const peak = (pixels: Float32Array, o: number): number => Math.max(pixels[o]!, pixels[o + 1]!, pixels[o + 2]!);
const percentile = (values: number[], q: number): number => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] ?? Number.NaN;
};

type Debug = { walkLighting: () => { state: string } };
const debug = (): Debug => (window as unknown as { __viewerDebug: Debug }).__viewerDebug;

describe.each(SHADES)('the demo floor lamp in %s', { timeout: MOUNT_TIMEOUT_MS }, (shade) => {
  let handle: ViewerHandle;
  let live: THREE.Scene | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  const entry: Entry = { intensity: Number.NaN };

  const findLamp = (): THREE.Object3D | undefined => {
    let found: THREE.Object3D | undefined;
    live!.traverse((object) => {
      if (found === undefined && object.userData['assetId'] === DEMO.asset.livingLamp) found = object;
    });
    return found;
  };

  /** The floor lamp's glowing materials, as the viewer built them. */
  const glowing = (): THREE.MeshStandardMaterial[] => {
    const out = new Set<THREE.MeshStandardMaterial>();
    findLamp()?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.emissive !== undefined && standard.emissiveIntensity > 0 && standard.emissive.getHex() !== 0) out.add(standard);
      }
    });
    return [...out];
  };

  /** A still of LAMP_VIEW; with `headroom`, tone mapping is linear at 1/headroom of the mode's exposure. */
  const capture = async (headroom: number | null): Promise<Float32Array> => {
    const gl = renderer!;
    const { toneMapping, toneMappingExposure } = gl;
    if (headroom !== null) {
      gl.toneMapping = THREE.LinearToneMapping;
      gl.toneMappingExposure = toneMappingExposure / headroom;
    }
    try {
      const { blob } = await handle.capture.still({ ...SHOT, camera: LAMP_VIEW, caption: false });
      return await rgb(blob, headroom);
    } finally {
      gl.toneMapping = toneMapping;
      gl.toneMappingExposure = toneMappingExposure;
    }
  };

  /** Captures as rendered, with the glow off, and with a reference glow; the mask comes from the last two (pre-tone-map). */
  const threeCaptures = async (headroom: number | null): Promise<{ lit: Float32Array; unlit: Float32Array; mask: boolean[] }> => {
    const materials = glowing();
    expect(materials.length).toBeGreaterThan(0);
    const saved = materials.map((material) => material.emissiveIntensity);
    const set = (value: number | null): void => {
      materials.forEach((material, i) => {
        material.emissiveIntensity = value ?? saved[i]!;
      });
    };
    try {
      const lit = await capture(headroom);
      set(0);
      const unlit = await capture(headroom);
      const unlitLinear = headroom === null ? await capture(HEADROOM) : unlit;
      set(1);
      const glow1 = await capture(HEADROOM);
      const mask: boolean[] = [];
      for (let o = 0; o < glow1.length; o += 3) mask.push(lum(glow1, o) - lum(unlitLinear, o) > MASK_STEP);
      return { lit, unlit, mask };
    } finally {
      set(null);
    }
  };

  const readWalk = async (): Promise<WalkReading> => {
    const { lit, unlit, mask } = await threeCaptures(HEADROOM);
    let litSum = 0;
    let unlitSum = 0;
    let compressed = 0;
    const peaks: number[] = [];
    mask.forEach((inside, i) => {
      if (!inside) return;
      const o = i * 3;
      litSum += lum(lit, o);
      unlitSum += lum(unlit, o);
      const p = peak(lit, o);
      peaks.push(p);
      if (p >= KNEE) compressed += 1;
    });
    const n = Math.max(peaks.length, 1);
    return {
      pixels: peaks.length,
      lit: litSum / n,
      unlit: unlitSum / n,
      ratio: litSum / Math.max(unlitSum, 1e-9),
      peakMean: peaks.reduce((total, value) => total + value, 0) / n,
      peak95: percentile(peaks, 0.95),
      compressed: compressed / n,
    };
  };

  const readDisplay = async (): Promise<DisplayReading> => {
    const shown = await threeCaptures(null);
    const linear = await threeCaptures(EDITING_HEADROOM);
    let litSum = 0;
    let unlitSum = 0;
    let litLinear = 0;
    let unlitLinear = 0;
    let pixels = 0;
    shown.mask.forEach((inside, i) => {
      if (!inside) return;
      pixels += 1;
      litSum += lum(shown.lit, i * 3);
      unlitSum += lum(shown.unlit, i * 3);
      litLinear += lum(linear.lit, i * 3);
      unlitLinear += lum(linear.unlit, i * 3);
    });
    const n = Math.max(pixels, 1);
    return { pixels, lit: litSum / n, unlit: unlitSum / n, step: (litSum - unlitSum) / n, ratio: litLinear / Math.max(unlitLinear, 1e-9) };
  };

  beforeAll(async () => {
    const scene = demoScene();
    const worn = {
      ...scene,
      assets: scene.assets.map((asset) =>
        asset.id === DEMO.asset.livingLamp ? { ...asset, finishes: { ...asset.finishes, shade: FINISH[shade] } } : asset,
      ),
    };
    const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
    const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
        live ??= this as THREE.Scene;
      return add.apply(this, objects);
    });
    handle = mountViewer(openContainer(480, 320), {
      scene: { repository: new InlineSceneRepository(worn) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
      debug: true,
    });
    await handle.ready;
    await until(() => live !== null, 'the live scene', 60_000);
    caught.mockRestore();
    await until(() => glowing().length > 0, 'the floor lamp built', 60_000);
    entry.intensity = glowing()[0]!.emissiveIntensity;
    // The renderer, taken off the lamp's next draw.
    findLamp()!.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const before = object.onBeforeRender.bind(object);
      object.onBeforeRender = (...args: Parameters<THREE.Object3D['onBeforeRender']>) => {
        renderer ??= args[0];
        before(...args);
      };
    });
    await handle.capture.still({ width: 8, height: 8, camera: LAMP_VIEW, caption: false });
    expect(renderer).not.toBeNull();
    results[shade] = entry;
  }, MOUNT_TIMEOUT_MS);

  afterAll(() => {
    handle.dispose();
    closeContainers();
  });

  test.each(['orbit', 'plan3d'] as const)('in %s the glow still adds light', async (mode) => {
    handle.setMode(mode);
    for (let i = 0; i < 3; i += 1) await nextFrame();
    const reading = await readDisplay();
    entry[mode] = reading;
    console.info(`lamp shade ${shade} ${mode}: ${JSON.stringify(reading)}`);
    expect(reading.pixels).toBeGreaterThan(500);
    expect(reading.ratio).toBeGreaterThanOrEqual(EDITING_LIT_RATIO);
  });

  test('in walk it stays under the tone-mapping ceiling and reads lit', async () => {
    handle.setMode('walk');
    await until(() => debug().walkLighting().state === 'live', 'room lighting live', 120_000);
    for (let i = 0; i < 3; i += 1) await nextFrame();
    const reading = await readWalk();
    entry.walk = reading;
    console.info(`lamp shade ${shade} walk: ${JSON.stringify(reading)}`);
    expect(reading.pixels).toBeGreaterThan(500);
    expect(reading.peakMean).toBeLessThanOrEqual(CEILING);
    expect(reading.ratio).toBeGreaterThanOrEqual(WALK_LIT_RATIO);
  });
});
