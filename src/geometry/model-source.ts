/**
 * Where a furniture body comes from when the catalogue names a `model`: the
 * asynchronous GLB source that sits behind the procedural builders.
 *
 * The procedural body is never a placeholder to be waited out — it is the
 * first frame, and `ready` still means "the first scene is built and the first
 * frame is drawn" with no GLB in it. This module is what runs
 * AFTER that: it fetches the container, parses it once per URL, and hands out
 * a clone per placement for `gltf-body.ts` to dress.
 *
 * Everything glTF is behind a dynamic `import()`, so `GLTFLoader` and the
 * meshopt decoder land in their own `lazy-*` chunk and cost the boot bundle
 * nothing (`scripts/budget-check.ts` keeps the boot bundle and the lazy chunks
 * apart). The import happens on the first request, which is after the first
 * frame by construction.
 *
 * Ownership: the parsed GLB's geometries and materials belong to the SOURCE,
 * not to the clones in the scene — `dispose()` frees them, and whoever created
 * the source calls it (`SceneBuilder`).
 *
 * Containment: a GLB is untrusted data, and `images[].uri` / `buffers[].uri`
 * taken from it name what the loader fetches next — so every such URI passes
 * `resolveModelResource` (wired in through `LoadingManager.setURLModifier`),
 * which allows `data:` and in-folder http(s) and refuses everything else.
 * `MAX_MODEL_BYTES` caps the container; this gate is what stops the CONTAINER
 * from naming the next download.
 */

import * as THREE from 'three';
import type { AssetDims } from '../assets/asset-types.js';
import { ViewerLibError } from '../shared/errors.js';
import { MAX_MODEL_BYTES } from '../shared/limits.js';
import { readGlbContainer } from './glb-container.js';

/** One placement's ask: which file, for which catalogue entry, at which size. */
export type ModelRequest = {
  url: string;
  archetypeId: string;
  variantId: string;
  dims: AssetDims;
  materialSlots?: Readonly<Record<string, string>> | undefined;
};

/**
 * What a source (or `prepareGltfBody`) produced.
 *
 * `warnings` are catalogue defects, not failures: `bbox-off-by-<pct>`,
 * `unbound-material:<name>`, `pivot-off-floor`, `camera-in-model`,
 * `light-in-model`. A GLB that cannot be parsed at all rejects instead.
 */
export type ModelOutcome = {
  group: THREE.Group;
  triangles: number;
  warnings: readonly string[];
  /**
   * Bytes this request pulled off the network, `0` when the container was
   * already parsed for another placement.
   *
   * It is what the per-project budget is spent from (`MAX_PROJECT_BYTES`),
   * and counting it HERE rather than in the caller is what keeps the
   * number honest: one file shared by twelve placements is downloaded once and
   * must be charged once.
   */
  bytes: number;
};

export type AsyncModelSource = (request: ModelRequest, signal: AbortSignal) => Promise<ModelOutcome>;

/** What a caller may configure about the default source. */
export type ModelSourceOptions = {
  /** For tests, and for a host that signs its own catalogue URLs; the page's `fetch` when absent. */
  fetch?: typeof fetch;
  /**
   * `'omit'` for the files of a baked PROJECT: a project folder is
   * static content on some other origin, and sending a cookie to it is both
   * useless and a preflight nobody's file server was asked to answer. Absent
   * leaves the platform default, which is what the shipped library path has
   * always used.
   */
  credentials?: RequestCredentials;
  /** Largest single container this source will read, bytes; `MAX_MODEL_BYTES` when absent. */
  maxBytes?: number;
};

/** A source that holds GPU resources of its own; the creator frees them. */
export type DisposableModelSource = AsyncModelSource & { dispose: () => void };

/**
 * Triangles of a built object.
 *
 * Lives here rather than on the loader because both bodies are measured the
 * same way and both budgets read the same number: the per-object triangle
 * budget of `asset-loader.test.ts` and the `≤ 50 000` a delivered GLB may
 * carry under the catalogue conventions.
 */
export function countTriangles(object: THREE.Object3D): number {
  let total = 0;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const index = child.geometry.getIndex();
    const position = child.geometry.getAttribute('position');
    if (index) total += index.count / 3;
    else if (position) total += position.count / 3;
  });
  return Math.round(total);
}

type LoaderModule = { parseAsync: (data: ArrayBuffer, path: string) => Promise<{ scene: THREE.Group }> };

/**
 * Builds a `GLTFLoader` against ONE manager. Every parse gets its own loader:
 * two parses can be in flight at the same time (two variants of one archetype),
 * and a manager is constructed against a single model's folder — a shared
 * instance would let one model's gate judge another's resources.
 */
type LoaderFactory = (manager: THREE.LoadingManager) => LoaderModule;

/**
 * Lazily imports `GLTFLoader` and `MeshoptDecoder` and returns the factory that
 * wires them together.
 *
 * `EXT_meshopt_compression` is the compression the catalogue conventions ask a library for,
 * and the decoder is 20-odd KB that only a scene with GLB furniture ever pays
 * for — so it is imported here, beside the loader, rather than at module
 * scope. The import happens on the first request, which is after the first
 * frame by construction; the per-parse construction after that is cheap.
 */
async function createLoaderFactory(): Promise<LoaderFactory> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  return (manager) => {
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader;
  };
}

/**
 * The folder a GLB's own resources resolve against when the runtime has no
 * `location` (`bun:test`, a worker): the same stand-in `project-repository.ts`
 * uses for its containment comparison, and as unreachable on the network — a
 * relative model URL cannot be fetched in such a runtime anyway.
 */
const PLACEHOLDER_BASE = 'http://jeex.invalid/';

/**
 * The one gate every URI inside a GLB must pass before the loader may fetch it,
 * and the URL to fetch when it does.
 *
 * `requested` is what `GLTFLoader` hands the manager AFTER its own
 * `LoaderUtils.resolveURL` against the model folder, so a plain relative URI
 * arrives already prefixed and an absolute one unchanged; the judgement is
 * therefore on the RESOLVED value, the same way `project-repository` judges a
 * manifest's `scene` path:
 *
 * - `data:` — allowed: self-contained, nothing leaves the document;
 * - http(s) **inside the model folder** — allowed, unchanged;
 * - http(s) **outside it** — refused, so a hostile container cannot make the
 *   frame fetch arbitrary URLs (and cannot read a same-origin resource of the
 *   viewer's origin back out of the render);
 * - any other scheme — refused.
 *
 * `base` is what a RELATIVE `requested` is resolved against: the model folder
 * for a URI read straight out of the container (the pre-parse scan), the
 * document's own address for what the loader hands the manager — by then the
 * loader has prefixed the model path, which is itself relative whenever the
 * model URL was, and resolving it against the folder a second time would judge
 * a URL nobody fetches.
 *
 * The message names only the model folder — host-supplied, like every fetch
 * URL in the library's errors — and never `requested`: the sentence travels to
 * the host page through the bridge's `messageOf`, so a value read out of the
 * GLB in it would be an echo channel. The refused URI stays in `detail`, which
 * the bridge does not forward.
 */
export function resolveModelResource(requested: string, folder: URL, base: URL | string = folder): string {
  if (/^data:/i.test(requested)) return requested;
  let resolved: URL;
  try {
    resolved = new URL(requested, base);
  } catch (cause) {
    throw new ViewerLibError('model-external-resource', `model resource is not a url (${folder.href})`, {
      detail: { url: requested, folder: folder.href },
      cause,
    });
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new ViewerLibError('model-external-resource', `model resource names a scheme this viewer does not fetch (${folder.href})`, {
      detail: { url: requested, folder: folder.href },
    });
  }
  if (!resolved.href.startsWith(folder.href)) {
    throw new ViewerLibError('model-external-resource', `model resource is outside the model folder (${folder.href})`, {
      detail: { url: requested, folder: folder.href },
    });
  }
  return requested;
}

/**
 * The `LoadingManager` URL modifier for one model: `resolveModelResource`
 * at the fetch site, plus the loader's OWN object URLs.
 *
 * `GLTFLoader` hands a texture stored in the container itself (an image with a
 * `bufferView`, which is how a packed GLB carries its textures) to the texture
 * loader as a `blob:` URL it has just made with `URL.createObjectURL` — through
 * this same modifier. Refusing `blob:` here would strip every embedded texture,
 * silently (a texture that fails arrives as `null`). A `blob:` URI written in
 * the container's JSON never gets this far: the pre-parse scan in `parse`
 * judges those with `resolveModelResource`, which refuses the scheme.
 */
export function modelResourceModifier(folder: URL, base: URL | string): (requested: string) => string {
  return (requested) => (/^blob:/i.test(requested) ? requested : resolveModelResource(requested, folder, base));
}

/** Drops what the catalogue conventions forbid in a delivered model and says so. */
function stripStageObjects(scene: THREE.Group): string[] {
  const warnings: string[] = [];
  const doomed: THREE.Object3D[] = [];
  scene.traverse((child) => {
    if ((child as THREE.Camera).isCamera) doomed.push(child);
    else if ((child as THREE.Light).isLight) doomed.push(child);
  });
  for (const object of doomed) {
    warnings.push((object as THREE.Camera).isCamera ? 'camera-in-model' : 'light-in-model');
    object.removeFromParent();
  }
  return [...new Set(warnings)];
}

/** Frees every geometry and material reachable from a parsed GLB scene. */
function disposeScene(scene: THREE.Object3D): void {
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
  });
}

type CacheEntry = { scene: THREE.Group; warnings: readonly string[]; bytes: number };

/**
 * The response body as bytes, refusing anything over `limit`.
 *
 * Read off the STREAM, exactly as `scene/scene-source.readCapped` reads a JSON
 * document and for the same reason: a `Content-Length` is the server's claim
 * about a body it has not sent yet, and a chunked response carries none. A
 * response with no readable stream (a test fake) falls back to
 * `arrayBuffer()`, which is honest about what it can promise - nothing was
 * streamed, so nothing was capped, and the size is still checked afterwards.
 */
async function readModelCapped(response: Response, url: string, limit: number): Promise<ArrayBuffer> {
  const refuse = (bytes: number): never => {
    throw new ViewerLibError('scene-load', `model ${url} is over ${limit} bytes`, { detail: { url, limit, bytes } });
  };
  const body = response.body;
  if (!body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > limit) refuse(buffer.byteLength);
    return buffer;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      refuse(total);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/**
 * Default source: one lazy loader, one parse per URL, one clone per placement.
 *
 * `options.fetch` exists for tests and for a host that signs its own catalogue URLs;
 * absent, the page's own `fetch` is used.
 */
export function createGltfModelSource(options: ModelSourceOptions = {}): DisposableModelSource {
  const transport = options.fetch ?? globalThis.fetch.bind(globalThis);
  const credentials = options.credentials;
  const limit = options.maxBytes ?? MAX_MODEL_BYTES;
  let factory: Promise<LoaderFactory> | undefined;
  const parsed = new Map<string, Promise<CacheEntry>>();

  async function parse(url: string, signal: AbortSignal): Promise<CacheEntry> {
    factory ??= createLoaderFactory();
    const response = await transport(url, credentials === undefined ? { signal } : { signal, credentials });
    if (!response.ok) {
      throw new ViewerLibError('scene-load', `model ${url} could not be fetched`, { detail: { url, status: response.status } });
    }
    const bytes = await readModelCapped(response, url, limit);
    const path = url.slice(0, url.lastIndexOf('/') + 1);
    // The folder the loader resolves a GLB's own resource URIs against, as an
    // absolute URL so the containment comparison below is sound. Resolved here
    // — where `url` is in hand — rather than inside the modifier.
    const base = (globalThis as { location?: { href?: string } }).location?.href ?? PLACEHOLDER_BASE;
    const folder = new URL(path, base);
    // The container's structure first (`glb-container.ts`): a broken one is a
    // `scene-load` refusal with a reason, and the document it returns is the
    // one the loader will parse — so the scan below judges what gets loaded.
    const container = readGlbContainer(bytes, url);
    // Judge every URI the container names BEFORE the loader runs, not only at
    // the fetch site. The reason is three's own tolerance: a texture that
    // fails to load arrives as `null` and the model goes on without it — so a
    // refusal raised only inside `setURLModifier` would be swallowed for
    // images (buffers, the other fetchable kind, do reject). The scan makes
    // the refusal deterministic for every URI the document names; the manager
    // below stays as the enforcement at the fetch site itself, for anything a
    // future loader version resolves another way.
    for (const entry of [...(container.images ?? []), ...(container.buffers ?? [])]) {
      if (entry.uri !== undefined) resolveModelResource(entry.uri, folder);
    }
    // One manager per parse: it exists to hold THIS model's gate (`factory`
    // exists to build one loader per manager — see `LoaderFactory`).
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(modelResourceModifier(folder, base));
    // What the container check cannot see — a document whose accessors read a
    // buffer it does not have — still fails inside the loader; that failure is
    // wrapped here so a host never receives a bare three.js error.
    let gltf: { scene: THREE.Group };
    try {
      gltf = await (await factory)(manager).parseAsync(bytes, path);
    } catch (cause) {
      if (cause instanceof ViewerLibError) throw cause;
      throw new ViewerLibError('scene-load', `model ${url} could not be parsed`, { cause, detail: { url, reason: 'glb-parse' } });
    }
    return { scene: gltf.scene, warnings: stripStageObjects(gltf.scene), bytes: bytes.byteLength };
  }

  const source = async (request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> => {
    if (signal.aborted) throw new ViewerLibError('disposed', `model ${request.url} was abandoned before it loaded`);
    let pending = parsed.get(request.url);
    // Only the request that actually STARTS the download is charged for it;
    // every later placement of the same variant rides the cached parse.
    const fresh = pending === undefined;
    if (!pending) {
      // A rejected parse must not become the cached answer: the next placement
      // (or the next mount) gets to try again.
      pending = parse(request.url, signal);
      parsed.set(request.url, pending);
      pending.catch(() => parsed.delete(request.url));
    }
    const entry = await pending;
    if (signal.aborted) throw new ViewerLibError('disposed', `model ${request.url} was abandoned while it loaded`);
    const group = entry.scene.clone(true);
    return { group, triangles: countTriangles(group), warnings: entry.warnings, bytes: fresh ? entry.bytes : 0 };
  };

  source.dispose = (): void => {
    for (const pending of parsed.values()) pending.then((entry) => disposeScene(entry.scene)).catch(() => undefined);
    parsed.clear();
    factory = undefined;
  };
  return source;
}
