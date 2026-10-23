import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createGltfModelSource, modelResourceModifier, resolveModelResource, type ModelRequest } from './model-source.js';
import { prepareGltfBody } from './gltf-body.js';
import { FinishRegistry } from '../assets/asset-finishes.js';
import { ARCHETYPE, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { ViewerLibError, isViewerLibError } from '../shared/errors.js';
import type { Ktx2Support } from '../materials/ktx2.js';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/**
 * The model source and the body preparation, against the committed fixture
 * (`scripts/make-fixture-glb.ts`): a real GLB container parsed by the real
 * `GLTFLoader`, with `fetch` faked so the test needs no server.
 *
 * Canvas-free, as every `bun test` here is: the finish registry's texture
 * generators return null without a document, so the materials it hands out are
 * flat colours — which is all these assertions read (their `name` is the
 * finish id).
 *
 * The resource gate (`resolveModelResource`) is tested twice: directly, over
 * the judgement itself, and through the real loader with a GLB that names an
 * external texture — the case where a hostile container must be refused before the loader asks the network for anything.
 */

const FIXTURE = readFileSync('tests/fixtures/project/obj/box-sofa@1.0.0.glb');
const FIXTURE_URL = 'https://cdn.example.com/interior-v1/obj/box-sofa.glb';

function fixtureBody(): ArrayBuffer {
  return FIXTURE.buffer.slice(FIXTURE.byteOffset, FIXTURE.byteOffset + FIXTURE.byteLength);
}

/** A `fetch` that serves the fixture and counts how often it was asked. */
function countingFetch(): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response(fixtureBody(), { status: 200 });
  }) as typeof fetch;
  return { fetch: impl, calls: () => calls };
}

const request: ModelRequest = {
  url: FIXTURE_URL,
  archetypeId: ARCHETYPE.sofa_3s,
  variantId: VARIANT.sofa_3s_linen,
  dims: [2.1, 0.85, 0.95],
  materialSlots: { upholstery: 'seat' },
};

describe('createGltfModelSource', () => {
  test('parses a GLB into a group and counts its triangles', async () => {
    const { fetch, calls } = countingFetch();
    const source = createGltfModelSource({ fetch });
    const outcome = await source(request, new AbortController().signal);
    expect(calls()).toBe(1);
    expect(outcome.triangles).toBe(24);
    expect(outcome.warnings).toEqual([]);
    const box = new THREE.Box3().setFromObject(outcome.group);
    expect(box.max.y).toBeCloseTo(0.85, 3);
    source.dispose();
  });

  test('caches the parsed GLB per url and clones it per placement', async () => {
    const { fetch, calls } = countingFetch();
    const source = createGltfModelSource({ fetch });
    const first = await source(request, new AbortController().signal);
    const second = await source(request, new AbortController().signal);
    expect(calls()).toBe(1);
    expect(second.group).not.toBe(first.group);
    source.dispose();
  });

  test('an aborted signal rejects and leaves nothing poisoned in the cache', async () => {
    const { fetch, calls } = countingFetch();
    const source = createGltfModelSource({ fetch });
    const aborted = new AbortController();
    aborted.abort();
    const failure = await source(request, aborted.signal).catch((error: unknown) => error);
    expect(isViewerLibError(failure) && failure.code).toBe('disposed');
    const outcome = await source(request, new AbortController().signal);
    expect(outcome.triangles).toBe(24);
    expect(calls()).toBe(1);
    source.dispose();
  });

  test('a transport failure comes back as a scene-load error, not a bare Error', async () => {
    const source = createGltfModelSource({
      fetch: (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
    });
    const failure = await source(request, new AbortController().signal).catch((error: unknown) => error);
    expect(isViewerLibError(failure) && failure.code).toBe('scene-load');
    source.dispose();
  });
});

// ------------------------------------------------ KHR_texture_basisu GLBs ---

const BASISU = readFileSync('tests/fixtures/project/obj/box-sofa-basisu@1.0.0.glb');
const BASISU_URL = 'https://cdn.example.com/interior-v1/obj/box-sofa-basisu.glb';

/** A transport serving the basisu fixture. */
const basisuFetch = (async () =>
  new Response(BASISU.buffer.slice(BASISU.byteOffset, BASISU.byteOffset + BASISU.byteLength), { status: 200 })) as unknown as typeof fetch;

/**
 * A transcoder stand-in: `start` decides whether it starts, `fail` whether a
 * texture it is asked for reports an error; every texture it hands out is
 * recorded so the test can see it disposed.
 */
function stubKtx2(options: { start?: boolean; fail?: boolean } = {}): {
  support: Ktx2Support;
  starts: () => number;
  textures: THREE.CompressedTexture[];
} {
  let starts = 0;
  const textures: THREE.CompressedTexture[] = [];
  const support: Ktx2Support = {
    async forParse() {
      starts += 1;
      if (options.start === false) throw new Error('transcoder 404');
      let first: unknown;
      const loader = {
        load(_url: string, onLoad: (texture: THREE.CompressedTexture) => void, _progress: unknown, onError: (error: unknown) => void) {
          if (options.fail === true) {
            first ??= new Error('transcode failed');
            onError(first);
            return;
          }
          const texture = new THREE.CompressedTexture([], 16, 16);
          textures.push(texture);
          onLoad(texture);
        },
      } as unknown as KTX2Loader;
      return { loader, error: () => first };
    },
    transcode: () => Promise.reject(new Error('unused')),
    dispose: () => undefined,
  };
  return { support, starts: () => starts, textures };
}

const basisuRequest: ModelRequest = { ...request, url: BASISU_URL };

describe('GLBs with KHR_texture_basisu', () => {
  test('load with the transcoder: the frame wears the KTX2 texture', async () => {
    const ktx2 = stubKtx2();
    const source = createGltfModelSource({ fetch: basisuFetch, ktx2: ktx2.support });
    const outcome = await source(basisuRequest, new AbortController().signal);
    const maps: THREE.Texture[] = [];
    outcome.group.traverse((child) => {
      if (child instanceof THREE.Mesh && (child.material as THREE.MeshStandardMaterial).map)
        maps.push((child.material as THREE.MeshStandardMaterial).map!);
    });
    expect(maps).toHaveLength(1);
    expect(maps[0]).toBe(ktx2.textures[0]);
    expect(ktx2.starts()).toBe(1);
    source.dispose();
  });

  test('a GLB without the extension never asks for the transcoder', async () => {
    const ktx2 = stubKtx2();
    const source = createGltfModelSource({ fetch: countingFetch().fetch, ktx2: ktx2.support });
    await source(request, new AbortController().signal);
    expect(ktx2.starts()).toBe(0);
    source.dispose();
  });

  test.each([
    ['no transcoder at all', undefined],
    ['a transcoder that cannot start', { start: false }],
    ['a texture the transcoder reports an error for', { fail: true }],
  ])('%s refuses the model with reason ktx2-transcoder, so the procedural body stays', async (_name, stub) => {
    const ktx2 = stub === undefined ? undefined : stubKtx2(stub);
    const source = createGltfModelSource({ fetch: basisuFetch, ...(ktx2 !== undefined && { ktx2: ktx2.support }) });
    const failure = await source(basisuRequest, new AbortController().signal).catch((error: unknown) => error);
    expect(isViewerLibError(failure) && failure.code).toBe('scene-load');
    expect((failure as ViewerLibError).detail).toMatchObject({ url: BASISU_URL, reason: 'ktx2-transcoder' });
    source.dispose();
  });

  test('a refused parse is not cached: the next placement tries again', async () => {
    const ktx2 = stubKtx2({ start: false });
    const source = createGltfModelSource({ fetch: basisuFetch, ktx2: ktx2.support });
    await source(basisuRequest, new AbortController().signal).catch(() => undefined);
    await source(basisuRequest, new AbortController().signal).catch(() => undefined);
    expect(ktx2.starts()).toBe(2);
    source.dispose();
  });

  test('dispose frees the textures of every parsed model, not only its geometries and materials', async () => {
    const ktx2 = stubKtx2();
    const source = createGltfModelSource({ fetch: basisuFetch, ktx2: ktx2.support });
    await source(basisuRequest, new AbortController().signal);
    let disposed = 0;
    ktx2.textures[0]!.addEventListener('dispose', () => (disposed += 1));
    source.dispose();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(disposed).toBe(1);
  });
});

// ------------------------------------------------------------- the GLB gate ---

const RESOURCE_FOLDER = new URL('https://cdn.example.com/interior-v1/obj/');

/** Runs `fn` and returns what it threw; fails the test when it threw nothing. */
function refusalOf(fn: () => unknown): ViewerLibError {
  try {
    fn();
  } catch (error) {
    expect(isViewerLibError(error)).toBe(true);
    return error as ViewerLibError;
  }
  throw new Error('expected the gate to refuse');
}

describe('resolveModelResource', () => {
  test('lets a `data:` uri through untouched: nothing is fetched', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveModelResource(uri, RESOURCE_FOLDER)).toBe(uri);
  });

  test('lets an in-folder uri through unchanged, so the happy path fetches exactly the uri it was given', () => {
    expect(resolveModelResource('https://cdn.example.com/interior-v1/obj/texture.png', RESOURCE_FOLDER)).toBe(
      'https://cdn.example.com/interior-v1/obj/texture.png',
    );
  });

  test.each([
    ['another origin', 'https://evil.example/t.png'],
    ['a sibling folder that shares a prefix', 'https://cdn.example.com/interior-v1/obj-evil/t.png'],
    ['a parent folder', 'https://cdn.example.com/interior-v1/shared/t.png'],
    ['a protocol-relative host', '//evil.example/t.png'],
    ['the site root', 'https://cdn.example.com/t.png'],
  ])('refuses an http(s) resource outside the model folder: %s', (_name, uri) => {
    const failure = refusalOf(() => resolveModelResource(uri, RESOURCE_FOLDER));
    expect(failure.code).toBe('model-external-resource');
    expect(failure.message).toContain(RESOURCE_FOLDER.href);
    // The refused URI comes out of the GLB — untrusted data — so it lives in
    // `detail` only, the same rule the project containment message follows.
    expect(failure.message).not.toContain(uri);
    expect(failure.detail).toMatchObject({ url: uri, folder: RESOURCE_FOLDER.href });
  });

  test.each([
    ['a file url', 'file:///etc/passwd'],
    ['a blob url', 'blob:https://cdn.example.com/9c3d'],
    ['a javascript url', 'javascript:alert(1)'],
  ])('refuses a non-http(s) scheme: %s', (_name, uri) => {
    const failure = refusalOf(() => resolveModelResource(uri, RESOURCE_FOLDER));
    expect(failure.code).toBe('model-external-resource');
    expect(failure.message).not.toContain(uri);
  });

  test('refuses a string that is not a url at all', () => {
    const failure = refusalOf(() => resolveModelResource('https://exa mple/t.png', RESOURCE_FOLDER));
    expect(failure.code).toBe('model-external-resource');
    expect(failure.message).not.toContain('exa mple');
  });
});

describe('modelResourceModifier, the gate at the fetch site', () => {
  const BASE = 'https://cdn.example.com/app/';
  const folder = new URL('models/', BASE);
  const modify = modelResourceModifier(folder, BASE);

  test('lets the loader’s own object url through: a texture stored inside the GLB arrives as one', () => {
    // `GLTFLoader` turns an image with a `bufferView` into
    // `URL.createObjectURL(blob)` and hands THAT to the texture loader through
    // this modifier; refusing it would strip every embedded texture. A `blob:`
    // written in the container's JSON is refused earlier, by the scan.
    const objectUrl = 'blob:https://cdn.example.com/0b6f2d1e-7c1a-4d3e-9b2f-5a8c1e0d4f7a';
    expect(modify(objectUrl)).toBe(objectUrl);
  });

  test('judges what the loader will fetch: a relative model path is resolved against the document, once', () => {
    // A relative model url makes the loader's own prefix relative too
    // (`models/` + uri); resolved against the folder a second time,
    // `models/../x.png` would look like `models/x.png` and pass.
    expect(modify('models/tex/a.png')).toBe('models/tex/a.png');
    expect(refusalOf(() => modify('models/../x.png')).code).toBe('model-external-resource');
  });
});

// ------------------------------------------------- the gate through the loader ---

/** The committed fixture taken apart: its JSON document and its BIN payload. */
function fixtureParts(): { json: Record<string, unknown>; bin: Uint8Array } {
  const view = new DataView(FIXTURE.buffer, FIXTURE.byteOffset, FIXTURE.byteLength);
  const jsonLength = view.getUint32(12, true);
  const binLength = view.getUint32(20 + jsonLength, true);
  const json = JSON.parse(new TextDecoder().decode(FIXTURE.subarray(20, 20 + jsonLength))) as Record<string, unknown>;
  return { json, bin: FIXTURE.subarray(28 + jsonLength, 28 + jsonLength + binLength) };
}

const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** One chunk of a container: its type and its payload, padded to 4 bytes on the way in. */
type Chunk = { type: number; bytes: Uint8Array };

function jsonChunk(json: unknown): Chunk {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const bytes = new Uint8Array((text.byteLength + 3) & ~3).fill(0x20);
  bytes.set(text);
  return { type: CHUNK_JSON, bytes };
}

function binChunk(bin: Uint8Array): Chunk {
  const bytes = new Uint8Array((bin.byteLength + 3) & ~3);
  bytes.set(bin);
  return { type: CHUNK_BIN, bytes };
}

/**
 * Packs chunks into a GLB container the way `scripts/make-fixture-glb.ts`
 * does: the 12-byte header (`glTF`, version 2, total length), then each chunk
 * as length, type, payload. `declaredLength` overrides the header's total so a
 * test can make the container lie about its own size.
 */
function packGlb(chunks: readonly Chunk[], declaredLength?: number): Uint8Array {
  const total = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.byteLength, 0);
  const glb = new Uint8Array(total);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, declaredLength ?? total, true);
  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.bytes.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    glb.set(chunk.bytes, offset + 8);
    offset += 8 + chunk.bytes.byteLength;
  }
  return glb;
}

/** A fresh `ArrayBuffer` holding exactly `bytes`, as a `Response` body. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/**
 * Re-packs the committed fixture's JSON with an external URI — a texture bound
 * to its first material, or the container's own buffer — the minimal real
 * containers that make `GLTFLoader` (or the pre-parse scan) see the resource.
 */
function withUri(json: Record<string, unknown>, bin: Uint8Array, at: 'texture' | 'buffer', uri: string): Record<string, unknown> {
  const copy = structuredClone(json);
  if (at === 'texture') {
    const materials = copy['materials'] as Array<{ pbrMetallicRoughness: Record<string, unknown> }>;
    materials[0]!.pbrMetallicRoughness = { ...materials[0]!.pbrMetallicRoughness, baseColorTexture: { index: 0 } };
    copy['images'] = [{ uri }];
    copy['textures'] = [{ source: 0 }];
  } else {
    copy['buffers'] = [{ uri, byteLength: bin.byteLength }];
  }
  return copy;
}

function fixtureWithUri(at: 'texture' | 'buffer', uri: string): ArrayBuffer {
  const { json, bin } = fixtureParts();
  return bufferOf(packGlb([jsonChunk(withUri(json, bin, at, uri)), binChunk(bin)]));
}

/** A `fetch` that serves `body` for the container and records every ask. */
async function loadWith(thenBody: (input: string) => ArrayBuffer): Promise<{ outcome: unknown; failure: unknown; calls: string[] }> {
  const calls: string[] = [];
  // The parameter is spelled `string` because that is what the source passes
  // (`transport(url, …)`); the `typeof fetch` assertion is the fake's costume.
  const impl = (async (input: string) => {
    calls.push(input);
    return new Response(thenBody(input), { status: 200 });
  }) as unknown as typeof fetch;
  const source = createGltfModelSource({ fetch: impl });
  let outcome: unknown;
  const failure = await source(request, new AbortController().signal).then(
    (value) => {
      outcome = value;
      return undefined;
    },
    (error: unknown) => error,
  );
  source.dispose();
  return { outcome, failure, calls };
}

describe('the resource gate, through the real loader', () => {
  test('a GLB naming an external texture is refused before the network is asked for it', async () => {
    const { failure, calls } = await loadWith(() => fixtureWithUri('texture', 'https://evil.example/t.png'));
    expect(isViewerLibError(failure) && failure.code).toBe('model-external-resource');
    // One call: the container. The texture `https://evil.example/t.png` never
    // reached `fetch` — the scan refused it before the loader ran (and the
    // loader's own tolerance for a failed texture could have swallowed the
    // refusal had it been raised only at the fetch site).
    expect(calls).toEqual([FIXTURE_URL]);
    // The message names the model's folder, not the uri the container asked for.
    expect((failure as ViewerLibError).message).toContain('https://cdn.example.com/interior-v1/obj/');
    expect((failure as ViewerLibError).message).not.toContain('evil.example');
  });

  test('the same holds for the container naming an external buffer', async () => {
    const { failure, calls } = await loadWith(() => fixtureWithUri('buffer', 'https://evil.example/external.bin'));
    expect(isViewerLibError(failure) && failure.code).toBe('model-external-resource');
    expect(calls).toEqual([FIXTURE_URL]);
    expect((failure as ViewerLibError).message).not.toContain('evil.example');
  });

  test.each([
    ['a relative texture inside the model folder', 'tex/texture.png'],
    ['an absolute texture inside the model folder', 'https://cdn.example.com/interior-v1/obj/texture.png'],
    ['a data: texture', 'data:image/png;base64,iVBORw0KGgo='],
  ])('%s passes the scan and the model loads, exactly as before', async (_name, uri) => {
    // The gate judges the URI, not the file: whatever the loader then makes of
    // the bytes is its own tolerance (under `bun test` no canvas can decode a
    // PNG — three carries on without the texture, as it always has for a
    // broken file).
    const { failure, outcome } = await loadWith(() => fixtureWithUri('texture', uri));
    expect(failure).toBeUndefined();
    expect(outcome).toBeDefined();
  });
});

// ------------------------------------------------- a broken container ---

/**
 * A GLB is untrusted bytes, and a broken one must come back as the viewer's own
 * `scene-load` refusal, decided BEFORE the loader runs: never a `RangeError` or
 * a `TypeError` out of `GLTFLoader`, never a hang, and never a container the
 * pre-parse scan and the loader read differently.
 *
 * Each case is built from the committed fixture's own JSON and BIN, so the
 * files stay a few KB and the only thing wrong with each is the one defect it
 * names. `reason` is the machine-readable half of the refusal (`detail.reason`);
 * the message names the model url, which the host supplied, and nothing read
 * out of the bytes.
 */
function brokenContainers(): Array<[string, Uint8Array, string]> {
  const { json, bin } = fixtureParts();
  const whole = packGlb([jsonChunk(json), binChunk(bin)]);
  const wrongMagic = whole.slice();
  wrongMagic.set(new TextEncoder().encode('glTX'), 0);
  const version1 = whole.slice();
  new DataView(version1.buffer).setUint32(4, 1, true);
  const jsonPastEnd = whole.slice();
  new DataView(jsonPastEnd.buffer).setUint32(12, 0x00ff_ffff, true);
  const noBuffers = structuredClone(json);
  delete noBuffers['buffers'];
  const external = withUri(json, bin, 'texture', 'https://evil.example/t.png');
  return [
    ['a header cut short', whole.slice(0, 10), 'glb-header'],
    ['an html page served with a 200', new TextEncoder().encode('<!doctype html><title>Not found</title>'), 'glb-magic'],
    ['a wrong magic number', wrongMagic, 'glb-magic'],
    ['a legacy version-1 header', version1, 'glb-version'],
    ['a body cut in half', whole.slice(0, whole.byteLength >> 1), 'glb-length'],
    ['a header declaring more bytes than arrived', packGlb([jsonChunk(json), binChunk(bin)], 0x7fff_ffff), 'glb-length'],
    ['a JSON chunk whose length runs past the end', jsonPastEnd, 'glb-chunk'],
    ['a first chunk that is not JSON', packGlb([binChunk(bin), jsonChunk(json)]), 'glb-json-first'],
    ['a JSON chunk that is not JSON', packGlb([{ type: CHUNK_JSON, bytes: new TextEncoder().encode('{not') }]), 'glb-json'],
    ['a JSON chunk that is an array', packGlb([jsonChunk([json])]), 'glb-json'],
    // The resource scan reads `images[].uri` and `buffers[].uri`: a document
    // whose shape there is not glTF's is refused before any URI is resolved.
    [
      'images that are not an array',
      packGlb([jsonChunk({ ...json, images: { uri: 'https://evil.example/t.png' } }), binChunk(bin)]),
      'glb-json',
    ],
    [
      'a buffer uri that is not a string',
      packGlb([jsonChunk({ ...json, buffers: [{ uri: 7, byteLength: 8 }] }), binChunk(bin)]),
      'glb-json',
    ],
    // The loader keeps the LAST JSON chunk and the scan reads the first: a
    // second one would smuggle a document past the scan.
    ['a second JSON chunk', packGlb([jsonChunk(json), binChunk(bin), jsonChunk(external)]), 'glb-chunk-order'],
    // BIN may only be the second chunk (glTF 2.0 §4.4.3.3); the loader would
    // take a BIN from anywhere.
    [
      'a BIN chunk after an unknown one',
      packGlb([jsonChunk(json), { type: 0x12345678, bytes: new Uint8Array(4) }, binChunk(bin)]),
      'glb-chunk-order',
    ],
    ['a chunk header cut short', packGlb([jsonChunk(json), binChunk(bin)]).slice(0, -4), 'glb-length'],
    ['a document with zero buffers whose accessors read one', packGlb([jsonChunk(noBuffers), binChunk(bin)]), 'glb-parse'],
    ['a document naming buffer 0 with no BIN chunk behind it', packGlb([jsonChunk(json)]), 'glb-parse'],
  ];
}

describe('a broken container, before the loader', () => {
  test.each(brokenContainers())('%s is refused as scene-load', async (_name, bytes, reason) => {
    const { failure, outcome, calls } = await loadWith(() => bufferOf(bytes));
    expect(outcome).toBeUndefined();
    expect(failure).toBeInstanceOf(ViewerLibError);
    const refusal = failure as ViewerLibError;
    expect(refusal.code).toBe('scene-load');
    expect(refusal.detail).toMatchObject({ url: FIXTURE_URL, reason });
    expect(refusal.message).toStartWith(`model ${FIXTURE_URL} `);
    expect(refusal.message).not.toContain('evil.example');
    // Only the container was asked for: a refusal never reaches the network.
    expect(calls).toEqual([FIXTURE_URL]);
  });

  test('a chunk of an unknown type after JSON and BIN is ignored, as glTF 2.0 requires', async () => {
    const { json, bin } = fixtureParts();
    const bytes = packGlb([jsonChunk(json), binChunk(bin), { type: 0x12345678, bytes: new Uint8Array(8).fill(0xff) }]);
    const { failure, outcome } = await loadWith(() => bufferOf(bytes));
    expect(failure).toBeUndefined();
    expect((outcome as { triangles: number }).triangles).toBe(24);
  });

  test('a container with zero buffers and nothing that reads one loads as an empty model', async () => {
    const bytes = packGlb([jsonChunk({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'empty' }] })]);
    const { failure, outcome } = await loadWith(() => bufferOf(bytes));
    expect(failure).toBeUndefined();
    expect((outcome as { triangles: number }).triangles).toBe(0);
  });

  test('a broken container is not cached: the next placement asks again', async () => {
    let served = 0;
    const impl = (async () => {
      served += 1;
      return new Response(served === 1 ? new Uint8Array(10) : fixtureBody(), { status: 200 });
    }) as unknown as typeof fetch;
    const source = createGltfModelSource({ fetch: impl });
    const first = await source(request, new AbortController().signal).catch((error: unknown) => error);
    expect(isViewerLibError(first) && first.code).toBe('scene-load');
    const second = await source(request, new AbortController().signal);
    expect(second.triangles).toBe(24);
    source.dispose();
  });
});

describe('prepareGltfBody', () => {
  async function load(
    overrides: Partial<ModelRequest> = {},
  ): Promise<{ body: THREE.Group; source: ReturnType<typeof createGltfModelSource> }> {
    const { fetch } = countingFetch();
    const source = createGltfModelSource({ fetch });
    const outcome = await source({ ...request, ...overrides }, new AbortController().signal);
    return { body: outcome.group, source };
  }

  function materialNames(group: THREE.Object3D): string[] {
    const names: string[] = [];
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && !Array.isArray(child.material)) names.push(child.material.name);
    });
    return names;
  }

  test('binds materials by materialSlots and by the slot-name convention', async () => {
    const { body, source } = await load();
    const finishes = new FinishRegistry();
    const outcome = prepareGltfBody(body, request, finishes, { upholstery: FINISH.linen_sand, frame: FINISH.oak_natural });
    expect(outcome.warnings).toEqual([]);
    expect(materialNames(outcome.group)).toEqual([FINISH.linen_sand, FINISH.oak_natural]);
    finishes.dispose();
    source.dispose();
  });

  test('a material bound by neither route keeps its own and is reported', async () => {
    const { body, source } = await load({ materialSlots: undefined });
    const finishes = new FinishRegistry();
    const outcome = prepareGltfBody(body, { ...request, materialSlots: undefined }, finishes, {
      upholstery: FINISH.linen_sand,
      frame: FINISH.oak_natural,
    });
    expect(outcome.warnings).toEqual(['unbound-material:seat']);
    expect(materialNames(outcome.group)).toEqual(['seat', FINISH.oak_natural]);
    finishes.dispose();
    source.dispose();
  });

  test('dims the model does not match are reported, never corrected', async () => {
    const { body, source } = await load();
    const finishes = new FinishRegistry();
    // A catalogue that promises a tenth more width than the model delivers:
    // the deviation is measured against the PROMISE, so this is `10`, not `9`.
    const stretched: ModelRequest = { ...request, dims: [2.1 / 0.9, 0.85, 0.95] };
    const outcome = prepareGltfBody(body, stretched, finishes, { upholstery: FINISH.linen_sand, frame: FINISH.oak_natural });
    expect(outcome.warnings).toEqual(['bbox-off-by-10']);
    expect(new THREE.Box3().setFromObject(outcome.group).max.x).toBeCloseTo(1.05, 3);
    finishes.dispose();
    source.dispose();
  });

  test('a baked body keeps every shipped material and reports none unbound', async () => {
    const { body, source } = await load({ materialSlots: undefined });
    const shipped = materialNames(body);
    const finishes = new FinishRegistry();
    const outcome = prepareGltfBody(
      body,
      { ...request, materialSlots: undefined },
      finishes,
      { upholstery: FINISH.linen_sand, frame: FINISH.oak_natural },
      { baked: true },
    );
    expect(outcome.warnings).toEqual([]);
    expect(materialNames(outcome.group)).toEqual(shipped);
    outcome.group.traverse((child) => {
      if (child instanceof THREE.Mesh) expect([child.castShadow, child.receiveShadow]).toEqual([true, true]);
    });
    finishes.dispose();
    source.dispose();
  });

  test('a body that is not baked still swaps by slot', async () => {
    const { body, source } = await load();
    const finishes = new FinishRegistry();
    const outcome = prepareGltfBody(
      body,
      request,
      finishes,
      { upholstery: FINISH.linen_sand, frame: FINISH.oak_natural },
      { baked: false },
    );
    expect(materialNames(outcome.group)).toEqual([FINISH.linen_sand, FINISH.oak_natural]);
    finishes.dispose();
    source.dispose();
  });

  test('casts and receives shadows like a procedural body', async () => {
    const { body, source } = await load();
    const finishes = new FinishRegistry();
    const outcome = prepareGltfBody(body, request, finishes, {});
    let meshes = 0;
    outcome.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      meshes += 1;
      expect([child.castShadow, child.receiveShadow]).toEqual([true, true]);
    });
    expect(meshes).toBe(2);
    finishes.dispose();
    source.dispose();
  });
});
