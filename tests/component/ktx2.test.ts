/**
 * KTX2 (Basis Universal) textures through the REAL transcoder in a real
 * WebGL context: three's KTX2 loader, the transcoder pair the dev server
 * answers beside the module that asks for it (`scripts/basis-transcoder-plugin.ts`),
 * and the formats the context reports.
 *
 * Every request the page makes goes through a forwarding `fetch` spy, so the
 * tests can say exactly how often each transcoder file was asked for, and
 * that work without KTX2 asks for neither.
 */

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createGltfModelSource, type ModelRequest } from '../../src/geometry/model-source.js';
import { createKtx2Support, type Ktx2Support } from '../../src/materials/ktx2.js';
import { TextureSource } from '../../src/materials/texture-source.js';
import { createLogger } from '../../src/shared/logger.js';
import { isViewerLibError } from '../../src/shared/errors.js';
import { ARCHETYPE, VARIANT } from '../../src/assets/catalogue-ids.js';

const SIZE = 64;
const VERSION = '01a167f6-0409-7047-b2b7-9297ca140b6a';
const BASISU_GLB = '/tests/fixtures/project/obj/box-sofa-basisu@1.0.0.glb';
const PLAIN_GLB = '/tests/fixtures/project/obj/box-sofa@1.0.0.glb';

const opened: THREE.WebGLRenderer[] = [];
const supports: Ktx2Support[] = [];
let requested: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  requested = [];
  globalThis.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return realFetch(input, init);
    },
    { preconnect: realFetch.preconnect },
  );
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const made of supports.splice(0)) made.dispose();
  for (const made of opened.splice(0)) {
    made.dispose();
    made.forceContextLoss();
  }
});

/** A renderer of `SIZE` pixels square. */
function renderer(): THREE.WebGLRenderer {
  const made = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  made.setPixelRatio(1);
  made.setSize(SIZE, SIZE, false);
  opened.push(made);
  return made;
}

/** A transcoder for `on`, disposed after the test. */
function support(on: THREE.WebGLRenderer, ownUrl?: string): Ktx2Support {
  const made = createKtx2Support({ renderer: () => on, ...(ownUrl !== undefined && { ownUrl }) });
  supports.push(made);
  return made;
}

/** How often the page asked for each transcoder file. */
function transcoderRequests(): { js: number; wasm: number } {
  const named = requested.filter((url) => url.includes('lazy-jeex-viewer-basis-transcoder-'));
  return { js: named.filter((url) => url.endsWith('.js')).length, wasm: named.filter((url) => url.endsWith('.wasm')).length };
}

/** A committed KTX2 fixture's URL on the dev server. */
const ktx2Fixture = (name: string): string => `/tests/fixtures/ktx2/${name}`;

const request = (url: string): ModelRequest => ({
  url: new URL(url, location.href).href,
  archetypeId: ARCHETYPE.sofa_3s,
  variantId: VARIANT.sofa_3s_linen,
  dims: [2.1, 0.85, 0.95],
});

/** The canvas of `on` after drawing `object` from behind (+z), as 0..1 RGB rows, row 0 at the top. */
function drawFromBehind(on: THREE.WebGLRenderer, object: THREE.Object3D): number[][][] {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight('#ffffff', 3), object);
  const camera = new THREE.OrthographicCamera(-1.1, 1.1, 0.9, -0.1, 0.1, 10);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);
  on.render(scene, camera);
  const gl = on.getContext();
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const rows: number[][][] = [];
  for (let y = SIZE - 1; y >= 0; y -= 1) {
    rows.push(Array.from({ length: SIZE }, (_, x) => [0, 1, 2].map((channel) => pixels[(y * SIZE + x) * 4 + channel]! / 255)));
  }
  return rows;
}

describe('KTX2 furniture', () => {
  test('a KHR_texture_basisu GLB loads through the real transcoder and draws its red base colour', async () => {
    const on = renderer();
    const source = createGltfModelSource({ ktx2: support(on) });
    const outcome = await source(request(BASISU_GLB), new AbortController().signal);
    // The backrest (the frame) fills the top of the view from behind: saturated red.
    const top = drawFromBehind(on, outcome.group)
      .slice(4, 20)
      .flatMap((row) => row.slice(8, 56));
    const red = top.filter(([r, g, b]) => r! > 0.5 && g! < 0.25 && b! < 0.25).length;
    expect(red / top.length).toBeGreaterThan(0.8);
    expect(transcoderRequests()).toEqual({ js: 1, wasm: 1 });
    source.dispose();
  });

  test('a transcoder that cannot be fetched keeps the procedural body: the model is refused with ktx2-transcoder', async () => {
    const on = renderer();
    // Port 9 refuses the connection: the transcoder pair cannot be had.
    const source = createGltfModelSource({ ktx2: support(on, 'http://127.0.0.1:9/jeex-viewer.js') });
    const failure = await source(request(BASISU_GLB), new AbortController().signal).catch((error: unknown) => error);
    expect(isViewerLibError(failure) && failure.code).toBe('scene-load');
    expect(isViewerLibError(failure) && failure.detail).toMatchObject({ reason: 'ktx2-transcoder' });
    source.dispose();
  });
});

describe('the transcoder is fetched once, and only when needed', () => {
  test('a WebP map and a GLB without KTX2 ask for no transcoder file', async () => {
    const on = renderer();
    const ktx2 = support(on);
    const source = createGltfModelSource({ ktx2 });
    await source(request(PLAIN_GLB), new AbortController().signal);
    const canvas = new OffscreenCanvas(128, 128);
    canvas.getContext('2d')!.fillRect(0, 0, 128, 128);
    const webp = await canvas.convertToBlob({ type: 'image/png' });
    const textures = new TextureSource({
      baseUrl: 'https://fixture.test/',
      log: createLogger(() => undefined),
      maxAnisotropy: 1,
      fetch: async () => new Response(webp),
      transcode: (bytes) => ktx2.transcode(bytes),
    });
    const owner = {};
    expect(
      await textures.acquire({ versionId: VERSION, role: 'albedo', size: '128', path: `tex/${VERSION}/albedo.128.webp` }, owner),
    ).not.toBeNull();
    expect(transcoderRequests()).toEqual({ js: 0, wasm: 0 });
    textures.dispose();
    source.dispose();
  });

  test('a KTX2 GLB and KTX2 room maps loaded together share one start: each file is fetched once', async () => {
    const on = renderer();
    const ktx2 = support(on);
    const source = createGltfModelSource({ ktx2 });
    const textures = new TextureSource({
      baseUrl: new URL('/tests/fixtures/', location.href).href,
      log: createLogger(() => undefined),
      maxAnisotropy: 1,
      transcode: (bytes) => ktx2.transcode(bytes),
    });
    const owner = {};
    const [model, albedo, normal] = await Promise.all([
      source(request(BASISU_GLB), new AbortController().signal),
      textures.acquire({ versionId: VERSION, role: 'albedo', size: '256', path: 'ktx2/albedo.256.ktx2' }, owner),
      textures.acquire({ versionId: VERSION, role: 'normal', size: '256', path: 'ktx2/normal.256.ktx2' }, owner),
    ]);
    expect(model.group).toBeDefined();
    expect(albedo).toBeInstanceOf(THREE.CompressedTexture);
    expect(normal).toBeInstanceOf(THREE.CompressedTexture);
    expect(transcoderRequests()).toEqual({ js: 1, wasm: 1 });
    expect(requested.filter((url) => url.endsWith('.ktx2')).map((url) => new URL(url).pathname)).toEqual([
      ktx2Fixture('albedo.256.ktx2'),
      ktx2Fixture('normal.256.ktx2'),
    ]);
    textures.dispose();
    source.dispose();
  });
});
