/**
 * The maps of a document's library materials: where each file is fetched
 * from, what the document may spend on them, how they are decoded, who owns
 * them, and the views a room surface samples them through.
 *
 * One source per mounted document, created by the app layer, which hands in
 * everything this module may not reach for itself: the manifest folder or the
 * host's live resolver, the renderer's anisotropy and the logger. Every map is
 * best-effort: a map that cannot be had leaves its surface in the flat colour
 * it was first drawn in, with a warning, and never throws.
 */

import * as THREE from 'three';
import type { Logger } from '../shared/logger.js';
import { ViewerLibError } from '../shared/errors.js';
import { linkedAbortController } from '../shared/abort.js';
import { ByteLimitError, readCapped } from '../shared/capped-read.js';
import { MAX_PROJECT_TEXTURE_BYTES, MAX_TEXTURE_FILE_BYTES, MAX_TEXTURE_PARALLEL, TEXTURE_FETCH_DEADLINE_MS } from '../shared/limits.js';
import type { LibraryMapRole, LibraryMapSize } from './finish-types.js';
import { KTX2_TRANSFER_SRGB, ktx2MapProblem, readKtx2Facts } from './ktx2-container.js';

/** One map file of one library material at one size. */
export type TextureRequest = {
  readonly versionId: string;
  readonly role: LibraryMapRole;
  readonly size: LibraryMapSize;
  /** The logical path the manifest lists: `tex/<versionId>/<role>.<px>.<webp|ktx2>`. */
  readonly path: string;
};

/** The part of `fetch` the source calls. */
export type TextureFetch = (url: string, init: RequestInit) => Promise<Response>;

/** What a decoder hands back: an image of a known size the source may close. */
export type DecodedImage = { readonly width: number; readonly height: number; close(): void };

/** Everything a source is handed. */
export type TextureSourceOptions = {
  /** The manifest folder, absolute, with its trailing slash: what a logical path resolves against. */
  readonly baseUrl: string;
  /** The host's live resolver (`ViewerOptions.resolveTexture`); replaces the manifest folder when given. */
  readonly resolveTexture?: ((path: string) => string | Promise<string>) | undefined;
  readonly log: Logger;
  /** The renderer's maximum anisotropy. */
  readonly maxAnisotropy: number;
  /** The page's `fetch` when absent. */
  readonly fetch?: TextureFetch;
  /** `createImageBitmap` when absent. */
  readonly decode?: (blob: Blob, options: ImageBitmapOptions) => Promise<DecodedImage>;
  /**
   * The viewer's KTX2 transcoder (`Ktx2Support.transcode`), for `.ktx2` maps;
   * absent, such a map stays flat with a warning.
   */
  readonly transcode?: ((bytes: ArrayBuffer) => Promise<THREE.CompressedTexture>) | undefined;
  /** Schedules `run` after `ms` and answers its cancel; `setTimeout` when absent (tests drive a clock by hand). */
  readonly schedule?: (run: () => void, ms: number) => () => void;
  /** Jobs in flight at once; `MAX_TEXTURE_PARALLEL` when absent. */
  readonly parallel?: number;
  /** Largest file, bytes; `MAX_TEXTURE_FILE_BYTES` when absent. */
  readonly maxFileBytes?: number;
  /** Bytes the document may fetch; `MAX_PROJECT_TEXTURE_BYTES` when absent. */
  readonly maxDocumentBytes?: number;
  /**
   * Holds every job until `start()`: the document's first frame is drawn
   * with flat colours and no network in it, and texture work begins after.
   */
  readonly deferred?: boolean;
};

/** The default clock. */
function scheduleTimeout(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
}

/** Why a job stopped before it had a map. */
class TextureDeadline extends Error {
  constructor() {
    super('texture job deadline');
  }
}

/** What a KTX2 map transcoded to: the mip payload and the GPU format every view of it uploads. */
type CompressedPayload = {
  readonly mipmaps: THREE.CompressedTextureMipmap[];
  readonly format: THREE.CompressedPixelFormat;
  readonly type: THREE.TextureDataType;
};

/**
 * One decoded map: the `Source` every view shares (one GPU upload), the
 * compressed payload when it came from a KTX2 file, and how to let it go.
 */
type DecodedMap = {
  readonly source: THREE.TextureSource<{ readonly width: number; readonly height: number }>;
  readonly compressed: CompressedPayload | null;
  close(): void;
};

/**
 * One map of the document: its encoded bytes (fetched once, kept for the
 * document's lifetime), its decoded image while anyone holds it, the owners
 * that hold it and the views each of them was given.
 */
type TextureEntry = {
  readonly bytes: Promise<ArrayBuffer | null>;
  image: Promise<DecodedMap | null> | null;
  /** The image once decoded and held, so a release closes it at once. */
  decoded: DecodedMap | null;
  readonly holders: Set<object>;
  readonly views: Map<object, THREE.Texture[]>;
};

/** The anisotropy a room surface is sampled with at most. */
const MAX_VIEW_ANISOTROPY = 8;

/** How every room-surface map is decoded. */
const DECODE_OPTIONS: ImageBitmapOptions = { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' };

/** True for a URL the source may fetch a map from: absolute `http(s)`, or a host's `blob:`. */
function isFetchableUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'blob:';
  } catch {
    return false;
  }
}

export class TextureSource {
  private readonly options: TextureSourceOptions;
  private readonly transport: TextureFetch;
  private readonly decode: (blob: Blob, options: ImageBitmapOptions) => Promise<DecodedImage>;
  /** The two byte limits this source enforces. */
  readonly limits: { readonly file: number; readonly document: number };
  /** One entry per version, role and size, shared by every request for it. */
  private readonly entries = new Map<string, TextureEntry>();
  /** The keys each owner holds. */
  private readonly held = new Map<object, Set<string>>();
  private disposed = false;
  /** Jobs waiting for a slot, oldest first; each is told whether it may run. */
  private readonly queue: ((run: boolean) => void)[] = [];
  private running = 0;
  /** Aborted when the document budget is spent: every active job stops, no new one starts. */
  private readonly stopped = new AbortController();
  private bytesRead = 0;
  /** Resolves when the source may run jobs. */
  private readonly started: Promise<void>;
  private open: () => void = () => undefined;

  constructor(options: TextureSourceOptions) {
    this.options = options;
    this.transport = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.decode = options.decode ?? ((blob, decodeOptions) => createImageBitmap(blob, decodeOptions));
    this.limits = { file: options.maxFileBytes ?? MAX_TEXTURE_FILE_BYTES, document: options.maxDocumentBytes ?? MAX_PROJECT_TEXTURE_BYTES };
    this.started = new Promise((resolve) => {
      this.open = resolve;
    });
    if (options.deferred !== true) this.open();
  }

  /** Lets a deferred source run its jobs, the ones already asked for first. */
  start(): void {
    this.open();
  }

  /** Bytes this document has fetched so far: every byte read, cache hits excluded. */
  get spent(): number {
    return this.bytesRead;
  }

  /**
   * A view of the map `request` names for `owner`, or `null` when it cannot be
   * had — or when `owner` released it, or the source was disposed, while it
   * loaded: a late completion is never handed out.
   */
  async acquire(request: TextureRequest, owner: object): Promise<THREE.Texture | null> {
    if (this.disposed) return null;
    const key = `${request.versionId}|${request.role}|${request.size}`;
    let entry = this.entries.get(key);
    if (entry === undefined) {
      entry = { bytes: this.load(request), image: null, decoded: null, holders: new Set(), views: new Map() };
      this.entries.set(key, entry);
    }
    entry.holders.add(owner);
    this.keysOf(owner).add(key);
    const current = entry;
    current.image ??= this.imageOf(current, request);
    const image = await current.image;
    if (image === null || this.disposed || !current.holders.has(owner)) return null;
    const view = this.viewOf(image, request.role);
    const views = current.views.get(owner) ?? [];
    views.push(view);
    current.views.set(owner, views);
    return view;
  }

  /**
   * Gives back everything `owner` holds: its views are disposed, and an image
   * nobody holds any more is closed. Its encoded bytes stay, so a later
   * acquire rebuilds it without a fetch.
   */
  release(owner: object): void {
    for (const key of this.held.get(owner) ?? []) {
      const entry = this.entries.get(key);
      if (entry === undefined) continue;
      entry.holders.delete(owner);
      for (const view of entry.views.get(owner) ?? []) view.dispose();
      entry.views.delete(owner);
      if (entry.holders.size > 0 || entry.image === null) continue;
      const image = entry.image;
      entry.image = null;
      // Closed at once when it is decoded, else the moment the decode lands.
      if (entry.decoded === null) void image.then((decoded) => decoded?.close());
      else entry.decoded.close();
      entry.decoded = null;
    }
    this.held.delete(owner);
  }

  /** Stops every job, releases every owner and forgets every byte: the document is gone. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopped.abort(new Error('texture source disposed'));
    // A deferred job still waiting for the first frame is let through to find the source stopped.
    this.open();
    for (const waiting of this.queue.splice(0)) waiting(false);
    for (const owner of [...this.held.keys()]) this.release(owner);
    this.entries.clear();
  }

  /** The decoded image of `entry`, remembered on it once it lands while it is still the entry's current one. */
  private async imageOf(entry: TextureEntry, request: TextureRequest): Promise<DecodedMap | null> {
    const bytes = await entry.bytes;
    const image =
      bytes === null
        ? null
        : request.path.endsWith('.ktx2')
          ? await this.transcodeMap(request, bytes)
          : await this.decodeImage(request, bytes);
    if (image !== null && entry.holders.size > 0) entry.decoded = image;
    return image;
  }

  /**
   * A new sampler over a shared image: repeating, mipmapped, trilinear, with
   * the anisotropy of the smaller of 8 and the hardware's, and the colour
   * space of its role. Its transform is the material's to set; the image
   * upload is shared by every view of it.
   */
  private viewOf(image: DecodedMap, role: LibraryMapRole): THREE.Texture {
    const { compressed } = image;
    // A compressed view carries the shared payload itself (three uploads a
    // compressed texture from its `mipmaps`), and generates no mipmaps: it
    // samples the levels the file supplies, trilinearly when there are several.
    const view =
      compressed === null
        ? new THREE.Texture()
        : new THREE.CompressedTexture(
            compressed.mipmaps,
            image.source.data.width,
            image.source.data.height,
            compressed.format,
            compressed.type,
          );
    view.source = image.source;
    view.wrapS = THREE.RepeatWrapping;
    view.wrapT = THREE.RepeatWrapping;
    view.generateMipmaps = compressed === null;
    view.minFilter = compressed !== null && compressed.mipmaps.length <= 1 ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    view.magFilter = THREE.LinearFilter;
    view.anisotropy = Math.max(1, Math.min(MAX_VIEW_ANISOTROPY, this.options.maxAnisotropy));
    // A WebP image is decoded top row up already, and an `ImageBitmap` ignores
    // `flipY` anyway; a compressed one cannot be flipped, and its material
    // reverses v instead (`libraryTextureMatrix`).
    view.flipY = false;
    view.colorSpace = role === 'albedo' || role === 'albedoTint' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    // `version`, not `needsUpdate`: the setter also bumps the shared `Source`, which
    // would re-upload the image for every surface that takes a view of it. A new
    // `Source` is uploaded on first use anyway; only this view's sampler is new.
    view.version++;
    return view;
  }

  /** The keys `owner` holds, created on first use. */
  private keysOf(owner: object): Set<string> {
    let keys = this.held.get(owner);
    if (keys === undefined) {
      keys = new Set();
      this.held.set(owner, keys);
    }
    return keys;
  }

  /** Waits for a slot, runs one map's job in it, and frees it whatever happens. */
  private async load(request: TextureRequest): Promise<ArrayBuffer | null> {
    await this.started;
    if (!(await this.slot())) return null;
    try {
      return await this.job(request);
    } finally {
      this.running -= 1;
      this.queue.shift()?.(!this.stopped.signal.aborted);
    }
  }

  /** Resolves `true` when a slot is free and taken, `false` when the budget stopped the source first. */
  private slot(): Promise<boolean> {
    if (this.stopped.signal.aborted) return Promise.resolve(false);
    const parallel = this.options.parallel ?? MAX_TEXTURE_PARALLEL;
    if (this.running < parallel) {
      this.running += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      this.queue.push((run) => {
        if (run) this.running += 1;
        resolve(run);
      });
    });
  }

  /**
   * The encoded bytes of one map, located, fetched and read under ONE deadline
   * started before the resolver is asked. `null` with a warning on any failure.
   */
  private async job(request: TextureRequest): Promise<ArrayBuffer | null> {
    const controller = linkedAbortController(this.stopped.signal);
    let expire: (reason: TextureDeadline) => void = () => undefined;
    const expired = new Promise<never>((_, reject) => {
      expire = reject;
    });
    const cancel = (this.options.schedule ?? scheduleTimeout)(() => {
      expire(new TextureDeadline());
      controller.abort(new TextureDeadline());
    }, TEXTURE_FETCH_DEADLINE_MS);
    let bytes: ArrayBuffer | null;
    try {
      bytes = await Promise.race([this.fetchBytes(request, controller.signal), expired]);
    } catch (error) {
      this.warnFailure(request, error);
      return null;
    } finally {
      cancel();
      controller.abort();
    }
    return bytes;
  }

  /**
   * The bytes of a map as an image of its named size, or `null` with a
   * warning. Decoded top row up, so an upright scan stands upright on a wall
   * and a normal map reads with a positive scale; with no colour conversion
   * and no premultiplication, so a data map reaches the shader as written.
   */
  private async decodeImage(request: TextureRequest, bytes: ArrayBuffer): Promise<DecodedMap | null> {
    const { log } = this.options;
    let image: DecodedImage;
    try {
      image = await this.decode(new Blob([bytes]), DECODE_OPTIONS);
    } catch (cause) {
      log.warn('texture-decode', `Texture ${request.path} could not be decoded; the surface stays flat`, { path: request.path, cause });
      return null;
    }
    const size = Number(request.size);
    if (image.width !== size || image.height !== size) {
      image.close();
      log.warn(
        'texture-size-mismatch',
        `Texture ${request.path} is ${image.width} x ${image.height}, not ${size} x ${size}; the surface stays flat`,
        {
          path: request.path,
          width: image.width,
          height: image.height,
        },
      );
      return null;
    }
    return { source: new THREE.TextureSource(image), compressed: null, close: () => image.close() };
  }

  /**
   * The bytes of a KTX2 map as a compressed image of its named size, or
   * `null` with a warning. The container is judged before the transcoder is
   * asked (`ktx2-container.ts`): a wrong file costs no worker time. The
   * colour space stays the role's; a container whose transfer function says
   * otherwise is drawn by its role all the same, and named in a warning.
   */
  private async transcodeMap(request: TextureRequest, bytes: ArrayBuffer): Promise<DecodedMap | null> {
    const { log, transcode } = this.options;
    const path = request.path;
    const facts = readKtx2Facts(bytes);
    const problem = facts === null ? 'is not a KTX2 container' : ktx2MapProblem(facts, Number(request.size));
    if (problem !== null || facts === null) {
      log.warn('texture-ktx2', `Texture ${path} ${problem ?? 'is not a KTX2 container'}; the surface stays flat`, { path });
      return null;
    }
    if (transcode === undefined) {
      log.warn('texture-ktx2', `Texture ${path} needs the KTX2 transcoder, which this viewer does not have; the surface stays flat`, {
        path,
      });
      return null;
    }
    let texture: THREE.CompressedTexture;
    try {
      texture = await transcode(bytes);
    } catch (cause) {
      log.warn('texture-ktx2', `Texture ${path} could not be transcoded; the surface stays flat`, { path, cause });
      return null;
    }
    const colour = request.role === 'albedo' || request.role === 'albedoTint';
    if (colour !== (facts.transfer === KTX2_TRANSFER_SRGB)) {
      log.warn('texture-colour-space', `Texture ${path} is stored as ${colour ? 'linear' : 'sRGB'} data; it is drawn as its role says`, {
        path,
        role: request.role,
      });
    }
    const payload: CompressedPayload = { mipmaps: texture.mipmaps ?? [], format: texture.format, type: texture.type };
    const size = Number(request.size);
    return { source: new THREE.TextureSource({ width: size, height: size }), compressed: payload, close: () => texture.dispose() };
  }

  /** The warning a failed job leaves behind; a job the budget stopped says nothing (the budget said it once). */
  private warnFailure(request: TextureRequest, error: unknown): void {
    const { log } = this.options;
    const path = request.path;
    if (error instanceof TextureDeadline) {
      log.warn('texture-deadline', `Texture ${path} took longer than ${TEXTURE_FETCH_DEADLINE_MS} ms; the surface stays flat`, {
        path,
        limit: TEXTURE_FETCH_DEADLINE_MS,
      });
    } else if (error instanceof ByteLimitError) {
      log.warn('texture-too-large', `Texture ${path} is over ${error.limit} bytes (MAX_TEXTURE_FILE_BYTES); the surface stays flat`, {
        path,
        limit: error.limit,
      });
    } else if (!this.stopped.signal.aborted) {
      log.warn('texture-fetch', `Texture ${path} could not be fetched; the surface stays flat`, { path, cause: error });
    }
  }

  /** The bytes of one map, or `null` when it cannot be located (already warned). */
  private async fetchBytes(request: TextureRequest, signal: AbortSignal): Promise<ArrayBuffer | null> {
    const url = await this.locate(request);
    if (url === null || signal.aborted) return null;
    const response = await this.transport(url, { credentials: 'omit', signal });
    if (!response.ok)
      throw new ViewerLibError('scene-load', `texture ${request.path} answered ${response.status}`, {
        detail: { status: response.status },
      });
    return readCapped(response, this.limits.file, (bytes) => this.spend(bytes), signal);
  }

  /** Counts bytes read; the byte that reaches the document budget stops the source. */
  private spend(bytes: number): void {
    this.bytesRead += bytes;
    if (this.bytesRead < this.limits.document || this.stopped.signal.aborted) return;
    this.options.log.warn(
      'texture-budget',
      `Library textures reached ${this.limits.document} bytes (MAX_PROJECT_TEXTURE_BYTES); the remaining surfaces stay flat`,
      { limit: this.limits.document, spent: this.bytesRead },
    );
    this.stopped.abort(new Error('texture budget'));
    for (const waiting of this.queue.splice(0)) waiting(false);
  }

  /** The URL to fetch `request` from, or `null` with a warning. */
  private async locate(request: TextureRequest): Promise<string | null> {
    const { resolveTexture, baseUrl, log } = this.options;
    let url: unknown;
    try {
      url = resolveTexture === undefined ? new URL(request.path, baseUrl).href : await resolveTexture(request.path);
    } catch (cause) {
      log.warn('texture-location', `Texture ${request.path} could not be located; the surface stays flat`, { path: request.path, cause });
      return null;
    }
    if (isFetchableUrl(url)) return url;
    log.warn('texture-location', `Texture ${request.path} resolved to a URL this viewer does not fetch; the surface stays flat`, {
      path: request.path,
    });
    return null;
  }
}
