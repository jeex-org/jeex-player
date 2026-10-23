/**
 * The document-owned texture source of the library materials, against a stub
 * `fetch` and a stub decoder: where a map is fetched from, what is spent on
 * it, how it is decoded, who owns it and how its views sample.
 */

import { describe, expect, test } from 'bun:test';
import type * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  CompressedTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBA_BPTC_Format,
  SRGBColorSpace,
} from 'three';
import { collectLogger } from '../fixtures/stubs.js';
import { MAX_PROJECT_TEXTURE_BYTES, MAX_TEXTURE_FILE_BYTES, TEXTURE_FETCH_DEADLINE_MS } from '../shared/limits.js';
import { TextureSource, type TextureRequest, type TextureSourceOptions } from './texture-source.js';

const VERSION = '01a167f6-0409-7047-b2b7-9297ca140b6a';
const OTHER = '01a167f6-0409-7db4-97bc-9dda7c1d1083';
const BASE = 'https://example.test/p/';

/** The request for one map of `version` at `size`. */
function request(role: TextureRequest['role'] = 'albedo', size: TextureRequest['size'] = '512', version = VERSION): TextureRequest {
  return { versionId: version, role, size, path: `tex/${version}/${role}.${size}.webp` };
}

/** The URL a stub `fetch` was called with. */

/** A decoded image of `size` pixels; `closed` says whether the source let it go. */
type FakeImage = { width: number; height: number; closed: boolean; close: () => void };

/** A source over a stub network that answers every URL with `bytes` bytes, and a decoder that answers the named size. */
function harness(overrides: Partial<TextureSourceOptions> = {}, bytes = 100) {
  const fetched: string[] = [];
  const images: FakeImage[] = [];
  const decodeOptions: unknown[] = [];
  const logger = collectLogger();
  const options: TextureSourceOptions = {
    baseUrl: BASE,
    log: logger.log,
    maxAnisotropy: 16,
    fetch: async (url) => {
      fetched.push(url);
      return new Response(new Uint8Array(bytes));
    },
    decode: async (_blob, decodeOptionsGiven) => {
      decodeOptions.push(decodeOptionsGiven);
      const image: FakeImage = {
        width: 512,
        height: 512,
        closed: false,
        close() {
          image.closed = true;
        },
      };
      images.push(image);
      return image;
    },
    ...overrides,
  };
  return { source: new TextureSource(options), fetched, images, decodeOptions, logger };
}

describe('texture location', () => {
  test('a baked path resolves against the manifest folder', async () => {
    const { source, fetched } = harness();
    expect(await source.acquire(request(), {})).not.toBeNull();
    expect(fetched).toEqual([`${BASE}tex/${VERSION}/albedo.512.webp`]);
  });

  test('a host resolver is called once per fetched logical path, at fetch time, and never for a size not asked for', async () => {
    const asked: string[] = [];
    const { source, fetched } = harness({
      resolveTexture: (path) => {
        asked.push(path);
        return `https://signed.example.test/${path}?sig=1`;
      },
    });
    expect(asked).toEqual([]);
    await source.acquire(request(), {});
    await source.acquire(request(), {});
    expect(asked).toEqual([`tex/${VERSION}/albedo.512.webp`]);
    expect(fetched).toEqual([`https://signed.example.test/tex/${VERSION}/albedo.512.webp?sig=1`]);
  });

  test('a blob: URL from the resolver is fetched and drawn', async () => {
    const { source, fetched } = harness({ resolveTexture: async () => 'blob:https://host.example.test/1f0e' });
    expect(await source.acquire(request(), {})).not.toBeNull();
    expect(fetched).toEqual(['blob:https://host.example.test/1f0e']);
  });

  test('a relative path, a data: URL, a throwing and a rejecting resolver each leave that map unloaded with a warning', async () => {
    const answers: (() => string | Promise<string>)[] = [
      () => 'tex/relative.webp',
      () => 'data:image/webp;base64,AAAA',
      () => {
        throw new Error('no signature');
      },
      () => Promise.reject(new Error('expired')),
    ];
    for (const answer of answers) {
      const { source, fetched, logger } = harness({ resolveTexture: answer });
      expect(await source.acquire(request(), {})).toBeNull();
      expect(fetched).toEqual([]);
      expect(logger.codes()).toEqual(['texture-location']);
    }
  });

  test('one failed map does not stop another', async () => {
    const { source } = harness({ resolveTexture: (path) => (path.includes('normal') ? 'nope' : `https://cdn.example.test/${path}`) });
    expect(await source.acquire(request('normal'), {})).toBeNull();
    expect(await source.acquire(request('albedo', '512', OTHER), {})).not.toBeNull();
  });
});

/** A clock the test advances by hand: every scheduled callback waits for `fire`. */
function manualClock() {
  const pending: { run: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    schedule: (run: () => void, ms: number) => {
      const timer = { run, ms, cancelled: false };
      pending.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    /** Runs every live callback scheduled for `ms`. */
    fire(ms: number) {
      for (const timer of pending.splice(0)) if (!timer.cancelled && timer.ms === ms) timer.run();
    },
  };
}

/** Lets every queued promise continuation run. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('texture job deadline', () => {
  test('a resolver that never settles is abandoned at the deadline, frees its slot and leaves the map unloaded', async () => {
    const clock = manualClock();
    const asked: string[] = [];
    const { source, logger } = harness({
      schedule: clock.schedule,
      parallel: 1,
      resolveTexture: (path) => {
        asked.push(path);
        return path.includes('normal') ? new Promise<string>(() => {}) : `https://cdn.example.test/${path}`;
      },
    });
    const stalled = source.acquire(request('normal'), {});
    const queued = source.acquire(request('albedo'), {});
    await settle();
    expect(asked).toEqual([`tex/${VERSION}/normal.512.webp`]);
    clock.fire(TEXTURE_FETCH_DEADLINE_MS);
    expect(await stalled).toBeNull();
    expect(await queued).not.toBeNull();
    expect(logger.codes()).toEqual(['texture-deadline']);
  });

  test('a response that stalls after its headers is aborted at the deadline', async () => {
    const clock = manualClock();
    let cancelled = false;
    const { source, logger } = harness({
      schedule: clock.schedule,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull: () => new Promise(() => {}),
            cancel() {
              cancelled = true;
            },
          }),
        ),
    });
    const stalled = source.acquire(request(), {});
    await settle();
    clock.fire(TEXTURE_FETCH_DEADLINE_MS);
    expect(await stalled).toBeNull();
    expect(cancelled).toBe(true);
    expect(logger.codes()).toEqual(['texture-deadline']);
  });

  test('a resolver answer that arrives after the deadline is ignored', async () => {
    const clock = manualClock();
    let answer: (url: string) => void = () => undefined;
    const { source, fetched } = harness({
      schedule: clock.schedule,
      resolveTexture: () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    });
    const late = source.acquire(request(), {});
    await settle();
    clock.fire(TEXTURE_FETCH_DEADLINE_MS);
    expect(await late).toBeNull();
    answer('https://cdn.example.test/late.webp');
    await settle();
    expect(fetched).toEqual([]);
  });

  test('a job that finishes in time cancels its deadline', async () => {
    const clock = manualClock();
    const { source, logger } = harness({ schedule: clock.schedule });
    expect(await source.acquire(request(), {})).not.toBeNull();
    clock.fire(TEXTURE_FETCH_DEADLINE_MS);
    expect(logger.codes()).toEqual([]);
  });
});

describe('texture bytes: per-file cap and document budget', () => {
  /** A network that streams `bytes` per file in 50-byte chunks, with no Content-Length. */
  function streaming(bytes: number) {
    const fetched: string[] = [];
    return {
      fetched,
      fetch: async (url: string) => {
        fetched.push(url);
        let sent = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (sent >= bytes) return controller.close();
              const chunk = Math.min(50, bytes - sent);
              sent += chunk;
              controller.enqueue(new Uint8Array(chunk));
            },
          }),
        );
      },
    };
  }

  test('the per-file and the document limits default to the published constants', () => {
    const { source } = harness();
    expect(source.limits).toEqual({ file: MAX_TEXTURE_FILE_BYTES, document: MAX_PROJECT_TEXTURE_BYTES });
  });

  test('a file over its cap is cancelled after the cap and its surface stays flat', async () => {
    const network = streaming(300);
    const { source, logger } = harness({ fetch: network.fetch, maxFileBytes: 200 });
    expect(await source.acquire(request(), {})).toBeNull();
    expect(logger.codes()).toEqual(['texture-too-large']);
    expect(source.spent).toBe(250);
  });

  test('the document budget stops the active fetch and the queued ones, warns once naming the limit, and refuses new work', async () => {
    const network = streaming(100);
    const { source, logger } = harness({ fetch: network.fetch, maxDocumentBytes: 250, parallel: 1 });
    const first = await Promise.all([source.acquire(request('albedo'), {}), source.acquire(request('normal'), {})]);
    expect(first.every((texture) => texture !== null)).toBe(true);
    const [over, queued] = await Promise.all([source.acquire(request('arm'), {}), source.acquire(request('roughness'), {})]);
    expect([over, queued]).toEqual([null, null]);
    expect(await source.acquire(request('ao'), {})).toBeNull();
    expect(network.fetched.length).toBe(3);
    expect(logger.codes()).toEqual(['texture-budget']);
    expect(logger.messages()[0]).toContain('MAX_PROJECT_TEXTURE_BYTES');
  });

  test('a cache hit costs nothing, even past the budget', async () => {
    const network = streaming(100);
    const { source } = harness({ fetch: network.fetch, maxDocumentBytes: 150 });
    expect(await source.acquire(request(), {})).not.toBeNull();
    expect(await source.acquire(request('normal'), {})).toBeNull();
    expect(await source.acquire(request(), {})).not.toBeNull();
    expect(network.fetched.length).toBe(2);
    expect(source.spent).toBe(150);
  });

  test('concurrent requests for one map share one fetch', async () => {
    const network = streaming(100);
    const { source } = harness({ fetch: network.fetch });
    const views = await Promise.all([source.acquire(request(), {}), source.acquire(request(), {}), source.acquire(request(), {})]);
    expect(views.every((view) => view !== null)).toBe(true);
    expect(network.fetched.length).toBe(1);
  });

  test('a new document starts at zero', async () => {
    const network = streaming(100);
    const spent = harness({ fetch: network.fetch, maxDocumentBytes: 100 });
    expect(await spent.source.acquire(request(), {})).toBeNull();
    const next = harness({ fetch: network.fetch, maxDocumentBytes: 150 });
    expect(next.source.spent).toBe(0);
    expect(await next.source.acquire(request('normal'), {})).not.toBeNull();
  });

  test('a response that is not ok leaves the map unloaded with a warning', async () => {
    const { source, logger } = harness({ fetch: async () => new Response('gone', { status: 404 }) });
    expect(await source.acquire(request(), {})).toBeNull();
    expect(logger.codes()).toEqual(['texture-fetch']);
  });
});

describe('texture decode', () => {
  test('decodes top row up, with no colour conversion and no premultiplication', async () => {
    const { source, decodeOptions } = harness();
    await source.acquire(request(), {});
    expect(decodeOptions).toEqual([{ imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' }]);
  });

  test('an image whose pixel size is not its named size is closed, not used, and warned about', async () => {
    const images: FakeImage[] = [];
    const { source, logger } = harness({
      decode: async () => {
        const image: FakeImage = {
          width: 500,
          height: 512,
          closed: false,
          close() {
            image.closed = true;
          },
        };
        images.push(image);
        return image;
      },
    });
    expect(await source.acquire(request(), {})).toBeNull();
    expect(images[0]?.closed).toBe(true);
    expect(logger.codes()).toEqual(['texture-size-mismatch']);
  });

  test('a decode failure leaves the map unloaded with a warning', async () => {
    const { source, logger } = harness({ decode: () => Promise.reject(new Error('not a webp')) });
    expect(await source.acquire(request(), {})).toBeNull();
    expect(logger.codes()).toEqual(['texture-decode']);
  });
});

describe('texture ownership', () => {
  /** True once `texture` has been disposed. */
  function watchDispose(texture: THREE.Texture | null): () => boolean {
    let disposed = false;
    texture?.addEventListener('dispose', () => {
      disposed = true;
    });
    return () => disposed;
  }

  test('two owners share one image; it is closed only after the last of them releases it', async () => {
    const { source, fetched, images } = harness();
    const first = {};
    const second = {};
    const a = await source.acquire(request(), first);
    const b = await source.acquire(request(), second);
    expect(a).not.toBe(b);
    expect(a?.source).toBe(b?.source);
    expect(fetched.length).toBe(1);
    const aDisposed = watchDispose(a);
    const bDisposed = watchDispose(b);
    source.release(first);
    expect([aDisposed(), bDisposed(), images[0]?.closed]).toEqual([true, false, false]);
    source.release(second);
    expect([bDisposed(), images[0]?.closed]).toEqual([true, true]);
  });

  test('the encoded bytes stay for the document: a released image is rebuilt without a fetch or a charge', async () => {
    const { source, fetched, images } = harness();
    const owner = {};
    await source.acquire(request(), owner);
    source.release(owner);
    const spent = source.spent;
    expect(await source.acquire(request(), {})).not.toBeNull();
    expect(fetched.length).toBe(1);
    expect(images.length).toBe(2);
    expect(source.spent).toBe(spent);
  });

  test('a completion after its owner released is not handed out, and its image is closed', async () => {
    let answer: () => void = () => undefined;
    const { source, images } = harness({
      fetch: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(new Response(new Uint8Array(10)));
        }),
    });
    const owner = {};
    const late = source.acquire(request(), owner);
    await settle();
    source.release(owner);
    answer();
    expect(await late).toBeNull();
    await settle();
    expect(images[0]?.closed).toBe(true);
  });

  test('after dispose, a pending acquire answers null, every image is closed and nothing new is fetched', async () => {
    let answer: () => void = () => undefined;
    const { source, fetched, images } = harness({
      fetch: (url) =>
        new Promise<Response>((resolve) => {
          fetched.push(url);
          answer = () => resolve(new Response(new Uint8Array(10)));
        }),
    });
    const held = {};
    const pending = source.acquire(request('normal'), held);
    await settle();
    source.dispose();
    answer();
    expect(await pending).toBeNull();
    expect(await source.acquire(request('arm'), {})).toBeNull();
    expect(fetched.length).toBe(1);
    await settle();
    expect(images.every((image) => image.closed)).toBe(true);
  });
});

describe('texture views', () => {
  test('a view repeats, mipmaps, filters trilinearly and takes the bounded anisotropy', async () => {
    for (const [hardware, expected] of [
      [16, 8],
      [4, 4],
    ] as const) {
      const { source } = harness({ maxAnisotropy: hardware });
      const view = (await source.acquire(request('arm'), {}))!;
      expect({
        wrap: [view.wrapS, view.wrapT],
        mipmaps: view.generateMipmaps,
        min: view.minFilter,
        mag: view.magFilter,
        anisotropy: view.anisotropy,
        flipY: view.flipY,
      }).toEqual({
        wrap: [RepeatWrapping, RepeatWrapping],
        mipmaps: true,
        min: LinearMipmapLinearFilter,
        mag: LinearFilter,
        anisotropy: expected,
        flipY: false,
      });
    }
  });

  test('the colour roles are sRGB and every other role holds data', async () => {
    const { source } = harness();
    const spaces: Record<string, string> = {};
    for (const role of ['albedo', 'albedoTint', 'normal', 'roughness', 'ao', 'arm'] as const) {
      spaces[role] = (await source.acquire(request(role), {}))!.colorSpace;
    }
    expect(spaces).toEqual({
      albedo: SRGBColorSpace,
      albedoTint: SRGBColorSpace,
      normal: NoColorSpace,
      roughness: NoColorSpace,
      ao: NoColorSpace,
      arm: NoColorSpace,
    });
  });

  test('views of one map share one image upload and are marked for it', async () => {
    const { source } = harness();
    const [a, b] = await Promise.all([source.acquire(request(), {}), source.acquire(request(), {})]);
    expect(a!.source).toBe(b!.source);
    expect(a!.version).toBeGreaterThan(0);
  });
});

describe('texture work waits for the first frame', () => {
  test('a deferred source fetches nothing until it is started, then runs what was asked for', async () => {
    const { source, fetched } = harness({ deferred: true });
    const pending = source.acquire(request(), {});
    await settle();
    expect(fetched).toEqual([]);
    source.start();
    expect(await pending).not.toBeNull();
    expect(fetched.length).toBe(1);
  });

  test('a source that is not deferred starts at once', async () => {
    const { source, fetched } = harness();
    await source.acquire(request(), {});
    expect(fetched.length).toBe(1);
  });
});

describe('KTX2 maps', () => {
  /** The committed KTX2 fixture `name`, as the network would answer it. */
  const fixture = (name: string): Uint8Array =>
    new Uint8Array(readFileSync(resolvePath(import.meta.dirname, '../../tests/fixtures/ktx2', name)));

  /** A KTX2 request for `role` at 256 px. */
  const ktx2Request = (role: TextureRequest['role'] = 'albedo', size: TextureRequest['size'] = '256'): TextureRequest => ({
    versionId: VERSION,
    role,
    size,
    path: `tex/${VERSION}/${role}.${size}.ktx2`,
  });

  /** A source whose network answers `file` and whose transcoder answers a compressed texture of `levels` levels. */
  function ktx2Harness(file: string, levels = 9, overrides: Partial<TextureSourceOptions> = {}) {
    const transcoded: ArrayBuffer[] = [];
    const decoded: number[] = [];
    const fetched: string[] = [];
    const logger = collectLogger();
    const bytes = fixture(file);
    const source = new TextureSource({
      baseUrl: BASE,
      log: logger.log,
      maxAnisotropy: 16,
      fetch: async (url) => {
        fetched.push(url);
        return new Response(bytes.slice());
      },
      decode: async () => {
        decoded.push(1);
        throw new Error('a KTX2 map never reaches the image decoder');
      },
      transcode: async (given) => {
        transcoded.push(given);
        const mipmaps = Array.from({ length: levels }, (_, level) => ({
          data: new Uint8Array(16),
          width: 256 >> level,
          height: 256 >> level,
        }));
        return new CompressedTexture(mipmaps, 256, 256, RGBA_BPTC_Format);
      },
      ...overrides,
    });
    return { source, transcoded, decoded, fetched, logger };
  }

  test('a .ktx2 map is transcoded, never decoded as an image, into a compressed view of the file’s own levels', async () => {
    const { source, transcoded, decoded } = ktx2Harness('albedo.256.ktx2');
    const view = await source.acquire(ktx2Request(), {});
    expect(view).toBeInstanceOf(CompressedTexture);
    expect(transcoded).toHaveLength(1);
    expect(decoded).toEqual([]);
    const compressed = view as CompressedTexture;
    expect(compressed.mipmaps).toHaveLength(9);
    expect(compressed.format).toBe(RGBA_BPTC_Format);
    expect([compressed.generateMipmaps, compressed.minFilter, compressed.magFilter]).toEqual([
      false,
      LinearMipmapLinearFilter,
      LinearFilter,
    ]);
    expect([compressed.wrapS, compressed.wrapT, compressed.anisotropy, compressed.flipY]).toEqual([
      RepeatWrapping,
      RepeatWrapping,
      8,
      false,
    ]);
    expect(compressed.colorSpace).toBe(SRGBColorSpace);
  });

  test('a single-level file is drawn with linear minification', async () => {
    const { source } = ktx2Harness('albedo.256.ktx2', 1);
    const view = await source.acquire(ktx2Request(), {});
    expect(view?.minFilter).toBe(LinearFilter);
  });

  test('a data role is drawn as data whatever the container says; a container that disagrees with its role warns', async () => {
    const normal = ktx2Harness('normal.256.ktx2');
    expect((await normal.source.acquire(ktx2Request('normal'), {}))?.colorSpace).toBe(NoColorSpace);
    expect(normal.logger.codes()).toEqual([]);
    // The linear normal fixture served as a colour map: drawn as sRGB, by its role, with a warning.
    const wrong = ktx2Harness('normal.256.ktx2');
    expect((await wrong.source.acquire(ktx2Request('albedo'), {}))?.colorSpace).toBe(SRGBColorSpace);
    expect(wrong.logger.codes()).toEqual(['texture-colour-space']);
  });

  test('a container of another size is refused before the transcoder is asked, with a warning', async () => {
    const { source, transcoded, logger } = ktx2Harness('orientation.128.ktx2');
    expect(await source.acquire(ktx2Request(), {})).toBeNull();
    expect(transcoded).toEqual([]);
    expect(logger.codes()).toEqual(['texture-ktx2']);
    expect(logger.messages()[0]).toContain('is 128 x 128, not 256 x 256');
  });

  test('bytes that are no KTX2, no transcoder, and a transcoder that fails each leave the map flat with a warning', async () => {
    const notKtx2 = harness({ transcode: async () => new CompressedTexture([], 256, 256) });
    expect(await notKtx2.source.acquire(ktx2Request(), {})).toBeNull();
    expect(notKtx2.logger.codes()).toEqual(['texture-ktx2']);
    const none = ktx2Harness('albedo.256.ktx2', 9, { transcode: undefined });
    expect(await none.source.acquire(ktx2Request(), {})).toBeNull();
    expect(none.logger.codes()).toEqual(['texture-ktx2']);
    const failing = ktx2Harness('albedo.256.ktx2', 9, { transcode: () => Promise.reject(new Error('worker')) });
    expect(await failing.source.acquire(ktx2Request(), {})).toBeNull();
    expect(failing.logger.codes()).toEqual(['texture-ktx2']);
  });

  test('two owners share one transcoded source; one release keeps the other; the last release and a reacquire transcode again without a fetch', async () => {
    const { source, transcoded, fetched } = ktx2Harness('albedo.256.ktx2');
    const [first, second, third] = [{}, {}, {}];
    const [a, b] = await Promise.all([source.acquire(ktx2Request(), first), source.acquire(ktx2Request(), second)]);
    expect(a).not.toBe(b);
    expect(a?.source).toBe(b?.source);
    expect((a as CompressedTexture).mipmaps).toBe((b as CompressedTexture).mipmaps);
    expect([fetched.length, transcoded.length]).toEqual([1, 1]);
    source.release(first);
    expect(await source.acquire(ktx2Request(), third)).not.toBeNull();
    expect(transcoded.length).toBe(1);
    source.release(second);
    source.release(third);
    const spent = source.spent;
    const again = await source.acquire(ktx2Request(), {});
    expect(again).toBeInstanceOf(CompressedTexture);
    expect([fetched.length, source.spent]).toEqual([1, spent]);
    // The kept bytes are whole, and the transcoder got them again.
    expect(transcoded.length).toBe(2);
    expect(transcoded[1]!.byteLength).toBe(fixture('albedo.256.ktx2').byteLength);
  });
});
