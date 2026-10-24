/**
 * Loading a host's sky in a real browser, on the committed synthetic
 * fixtures (`scripts/make-fixture-hdri.ts`): the gain-map environment through
 * three's own decoder, the display sky through the browser's AVIF decoder.
 * Measurements go to `test-results/hdri-assets.json` (git-ignored).
 */

import * as THREE from 'three';
import { afterAll, describe, expect, test } from 'vitest';
import { commands } from 'vitest/browser';
// Static, so Vite pre-bundles the chunk before the first test.
import { loadHdriEnvironment, loadHdriPair, loadHdriSky } from '../../src/render/walk-post.js';
import type { HdriEntry } from '../../src/lighting/hdri-entry.js';
import { LIGHTING_STANDARD } from '../../src/lighting/lighting-standard.js';
import { closeContainers, openContainer } from './support.js';

const results: Record<string, unknown> = {};
afterAll(async () => {
  closeContainers();
  await commands.writeFile('test-results/hdri-assets.json', JSON.stringify(results, null, 2));
});

type Sidecar = {
  sun: HdriEntry['sun'];
  reference: { skyMeanLuminance: number; skyHorizontalIrradiance: number; coneResidual: number };
};

const fixture = (name: string): string => new URL(`/tests/fixtures/hdri/${name}`, location.href).href;
const sidecar = async (): Promise<Sidecar> => (await (await fetch(fixture('sky.json'))).json()) as Sidecar;
const entryOf = async (): Promise<HdriEntry> => ({
  environmentUrl: fixture('sky-1k.jpg'),
  skyUrl: fixture('sky-256.avif'),
  sun: (await sidecar()).sun,
});

function renderer(): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  openContainer(64, 64).appendChild(canvas);
  const gl = new THREE.WebGLRenderer({ canvas });
  gl.setSize(64, 64, false);
  return gl;
}

const renderString = (gl: THREE.WebGLRenderer): string => {
  const context = gl.getContext();
  const info = context.getExtension('WEBGL_debug_renderer_info');
  return String(info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER));
};

describe('loading a host sky', () => {
  test('both files are requested before either has answered', async () => {
    const entry = await entryOf();
    const started: string[] = [];
    const gates: Array<() => void> = [];
    const fetcher = (url: string, init: { signal: AbortSignal }): Promise<Response> => {
      started.push(url);
      return new Promise<void>((resolve) => {
        gates.push(resolve);
      }).then(() => fetch(url, init));
    };
    const gl = renderer();
    const loading = loadHdriPair(gl, entry, new AbortController().signal, fetcher);
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(started.sort()).toEqual([entry.environmentUrl, entry.skyUrl].sort());
    for (const open of gates) open();
    const pair = await loading;
    pair.dispose();
    gl.dispose();
  });

  test('the environment decodes to a 256 cube; only the PMREM stays on the GPU; the measurement matches the reference after compensation', async () => {
    const entry = await entryOf();
    const reference = (await sidecar()).reference;
    const gl = renderer();
    const before = gl.info.memory.textures;
    const environment = await loadHdriEnvironment(gl, entry, new AbortController().signal);
    expect(environment.cubeSize).toBe(256);
    expect(environment.texture.mapping).toBe(THREE.CubeUVReflectionMapping);
    expect(gl.info.memory.textures).toBe(before + 1);
    const compensated = environment.sky.horizontal * LIGHTING_STANDARD.hdri.loaderCompensation;
    const raw = environment.sky.horizontal / reference.skyHorizontalIrradiance;
    results['environment'] = {
      renderer: renderString(gl),
      cubeSize: environment.cubeSize,
      horizontal: environment.sky.horizontal,
      residual: environment.sky.residual,
      reference,
      rawRatio: raw,
      measuredCompensation: reference.skyHorizontalIrradiance / environment.sky.horizontal,
      sunIntensity: environment.sunIntensity,
      gain: environment.gain,
    };
    // The shipped decoder may read darker than the reference; after the compensation it agrees within 2 %.
    expect(raw).toBeLessThanOrEqual(1.02);
    expect(Math.abs(compensated - reference.skyHorizontalIrradiance) / reference.skyHorizontalIrradiance).toBeLessThan(0.02);
    expect(environment.sunIntensity).toBeGreaterThan(0);
    environment.dispose();
    expect(gl.info.memory.textures).toBe(before);
    gl.dispose();
  });

  test('the sky decodes upright with no colour conversion: the red marker is where the panorama has it', async () => {
    const entry = await entryOf();
    const sky = await loadHdriSky(entry, new AbortController().signal);
    const bitmap = sky.texture.image as ImageBitmap;
    expect([bitmap.width, bitmap.height]).toEqual([256, 128]);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const at = (x: number, rowFromTopOfPanorama: number): Uint8ClampedArray =>
      // Flipped at decode: the bitmap's last row is the panorama's first (straight up).
      context.getImageData(x, bitmap.height - 1 - rowFromTopOfPanorama, 1, 1).data;
    // The marker: clockwise azimuth 144° (atan2(z, x) = -54°, u = 0.35), elevation 12° (row 55 of 128 from the top).
    const marker = at(Math.round(0.35 * 256), 55);
    const mirrored = at(Math.round(0.65 * 256), 55);
    results['skyMarker'] = { marker: [...marker], mirrored: [...mirrored] };
    expect(marker[0]!).toBeGreaterThan(marker[1]! * 3);
    expect(mirrored[0]!).toBeLessThan(mirrored[2]! * 1.5);
    sky.dispose();
  });

  test('an abort before the answers settles once and leaves nothing on the GPU', async () => {
    const entry = await entryOf();
    const gl = renderer();
    const before = gl.info.memory.textures;
    const abort = new AbortController();
    const loading = loadHdriPair(gl, entry, abort.signal);
    abort.abort(new Error('left walk'));
    await expect(loading).rejects.toThrow();
    expect(gl.info.memory.textures).toBe(before);
    gl.dispose();
  });

  test('a 404 on either file rejects the pair once and leaves nothing behind', async () => {
    const entry = await entryOf();
    for (const missing of [entry.environmentUrl, entry.skyUrl]) {
      const gl = renderer();
      const before = gl.info.memory.textures;
      const fetcher = (url: string, init: { signal: AbortSignal }): Promise<Response> =>
        url === missing ? Promise.resolve(new Response(null, { status: 404 })) : fetch(url, init);
      await expect(loadHdriPair(gl, entry, new AbortController().signal, fetcher)).rejects.toThrow(/404/);
      expect(gl.info.memory.textures).toBe(before);
      gl.dispose();
    }
  });

  test('a corrupt embedded gain-map image settles as one rejection, not an uncaught error', async () => {
    const entry = await entryOf();
    const bytes = new Uint8Array(await (await fetch(entry.environmentUrl)).arrayBuffer());
    // The gain map is the last JPEG in the container: keep its start marker, wreck the header after it.
    let soi = -1;
    for (let i = bytes.length - 3; i > 2; i -= 1) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
        soi = i;
        break;
      }
    }
    expect(soi).toBeGreaterThan(2);
    const corrupt = bytes.slice();
    corrupt.fill(0x5a, soi + 2, Math.min(corrupt.length, soi + 400));
    const uncaught: unknown[] = [];
    const listen = (event: PromiseRejectionEvent): void => {
      uncaught.push(event.reason);
    };
    window.addEventListener('unhandledrejection', listen);
    const gl = renderer();
    const before = gl.info.memory.textures;
    const fetcher = (): Promise<Response> => Promise.resolve(new Response(corrupt));
    await expect(loadHdriEnvironment(gl, entry, new AbortController().signal, fetcher)).rejects.toThrow();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    window.removeEventListener('unhandledrejection', listen);
    expect(uncaught).toEqual([]);
    expect(gl.info.memory.textures).toBe(before);
    gl.dispose();
  });
});
