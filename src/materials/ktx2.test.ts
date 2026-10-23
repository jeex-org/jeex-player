import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { createKtx2Support, transcoderFolder, transcoderNames, type Ktx2LoaderModule } from './ktx2.js';

/** What the stub loader saw. */
type Seen = { created: number; disposed: number; inits: number; urls: string[]; parsed: ArrayBuffer[]; loads: string[] };

/** A stand-in for three's KTX2Loader; `init` fetches both transcoder names through the manager. */
function stubModule(
  seen: Seen,
  options: { failInits?: number; parseError?: unknown; loadError?: unknown } = {},
): () => Promise<Ktx2LoaderModule> {
  let failures = options.failInits ?? 0;
  class Stub {
    readonly manager: THREE.LoadingManager;
    path = '';
    constructor(manager: THREE.LoadingManager) {
      this.manager = manager;
      seen.created += 1;
    }
    setTranscoderPath(path: string): this {
      this.path = path;
      return this;
    }
    setWorkerLimit(): this {
      return this;
    }
    detectSupport(): this {
      return this;
    }
    async init(): Promise<void> {
      seen.inits += 1;
      for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) seen.urls.push(this.manager.resolveURL(this.path + name));
      if (failures > 0) {
        failures -= 1;
        throw new Error('404');
      }
    }
    parse(buffer: ArrayBuffer, onLoad: (texture: THREE.CompressedTexture) => void, onError: (error: unknown) => void): void {
      seen.parsed.push(buffer);
      if (options.parseError === undefined) onLoad(new THREE.CompressedTexture([], 4, 4));
      else onError(options.parseError);
    }
    load(url: string, onLoad: (texture: THREE.CompressedTexture) => void, _progress: unknown, onError: (error: unknown) => void): void {
      seen.loads.push(url);
      if (options.loadError === undefined) onLoad(new THREE.CompressedTexture([], 4, 4));
      else onError(options.loadError);
    }
    dispose(): void {
      seen.disposed += 1;
    }
  }
  return async () => ({ KTX2Loader: Stub as unknown as Ktx2LoaderModule['KTX2Loader'] });
}

const renderer = {} as THREE.WebGLRenderer;
const fresh = (): Seen => ({ created: 0, disposed: 0, inits: 0, urls: [], parsed: [], loads: [] });
const OWN = 'https://cdn.example/jeex/1.0.0/jeex-viewer-element.js';

describe('transcoder location', () => {
  test('the folder of the player file that runs', () => {
    expect(transcoderFolder(OWN)).toBe('https://cdn.example/jeex/1.0.0/');
    expect(transcoderFolder('https://cdn.example/jeex/1.0.0/jeex-viewer.iife.js?v=2')).toBe('https://cdn.example/jeex/1.0.0/');
  });

  test('the published names carry one hash', () => {
    expect(transcoderNames('abcd1234')).toEqual({
      'basis_transcoder.js': 'lazy-jeex-viewer-basis-transcoder-abcd1234.js',
      'basis_transcoder.wasm': 'lazy-jeex-viewer-basis-transcoder-abcd1234.wasm',
    });
  });
});

describe('createKtx2Support', () => {
  test('imports nothing and fetches nothing until a KTX2 asset asks', async () => {
    const seen = fresh();
    let imported = 0;
    const module = stubModule(seen);
    const support = createKtx2Support({
      renderer: () => renderer,
      ownUrl: OWN,
      hash: 'h',
      importLoader: () => ((imported += 1), module()),
    });
    expect(imported).toBe(0);
    await support.transcode(new ArrayBuffer(8));
    expect(imported).toBe(1);
    expect(seen.urls).toEqual([
      'https://cdn.example/jeex/1.0.0/lazy-jeex-viewer-basis-transcoder-h.js',
      'https://cdn.example/jeex/1.0.0/lazy-jeex-viewer-basis-transcoder-h.wasm',
    ]);
  });

  test('starts once for any number of assets, furniture and room maps together', async () => {
    const seen = fresh();
    const support = createKtx2Support({ renderer: () => renderer, ownUrl: OWN, hash: 'h', importLoader: stubModule(seen) });
    await Promise.all([support.transcode(new ArrayBuffer(8)), support.forParse(), support.transcode(new ArrayBuffer(8))]);
    expect(seen.created).toBe(1);
    expect(seen.inits).toBe(1);
  });

  test('a failed start is not kept: the next asset starts a new loader, and the failed one is disposed', async () => {
    const seen = fresh();
    const support = createKtx2Support({
      renderer: () => renderer,
      ownUrl: OWN,
      hash: 'h',
      importLoader: stubModule(seen, { failInits: 1 }),
    });
    await expect(support.transcode(new ArrayBuffer(8))).rejects.toThrow('404');
    await support.transcode(new ArrayBuffer(8));
    await support.transcode(new ArrayBuffer(8));
    expect(seen.inits).toBe(2);
    expect(seen.urls).toHaveLength(4);
    expect(seen.disposed).toBe(1);
  });

  test('no renderer: the start rejects without importing the loader', async () => {
    let imported = 0;
    const support = createKtx2Support({
      renderer: () => undefined,
      ownUrl: OWN,
      hash: 'h',
      importLoader: () => ((imported += 1), stubModule(fresh())()),
    });
    await expect(support.transcode(new ArrayBuffer(8))).rejects.toThrow(/renderer/);
    expect(imported).toBe(0);
  });

  test('the transcoder gets a copy: the caller keeps bytes it can hand over again', async () => {
    const seen = fresh();
    const support = createKtx2Support({ renderer: () => renderer, ownUrl: OWN, hash: 'h', importLoader: stubModule(seen) });
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await support.transcode(bytes);
    expect(seen.parsed[0]).not.toBe(bytes);
    expect([...new Uint8Array(seen.parsed[0]!)]).toEqual([1, 2, 3, 4]);
  });

  test('a transcoding error rejects', async () => {
    const support = createKtx2Support({
      renderer: () => renderer,
      ownUrl: OWN,
      hash: 'h',
      importLoader: stubModule(fresh(), { parseError: new Error('bad') }),
    });
    await expect(support.transcode(new ArrayBuffer(8))).rejects.toThrow('bad');
  });

  test('a parse view records the first error the GLTF loader is told about, and still tells it', async () => {
    const seen = fresh();
    const support = createKtx2Support({
      renderer: () => renderer,
      ownUrl: OWN,
      hash: 'h',
      importLoader: stubModule(seen, { loadError: new Error('worker') }),
    });
    const view = await support.forParse();
    expect(view.error()).toBeUndefined();
    const told: unknown[] = [];
    view.loader.load(
      'blob:x',
      () => undefined,
      undefined,
      (error) => told.push(error),
    );
    expect(seen.loads).toEqual(['blob:x']);
    expect(told).toHaveLength(1);
    expect((view.error() as Error).message).toBe('worker');
    // Another parse view starts clean.
    expect((await support.forParse()).error()).toBeUndefined();
  });

  test('dispose ends the loader, and a disposed support starts nothing', async () => {
    const seen = fresh();
    const support = createKtx2Support({ renderer: () => renderer, ownUrl: OWN, hash: 'h', importLoader: stubModule(seen) });
    await support.transcode(new ArrayBuffer(8));
    support.dispose();
    await Promise.resolve();
    expect(seen.disposed).toBe(1);
    await expect(support.transcode(new ArrayBuffer(8))).rejects.toThrow(/disposed/);
    expect(seen.created).toBe(1);
  });
});
