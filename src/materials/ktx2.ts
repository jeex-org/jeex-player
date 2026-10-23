/**
 * The Basis Universal transcoder of one viewer: the one place KTX2 textures
 * are turned into GPU-compressed textures, for furniture GLBs
 * (`KHR_texture_basisu`) and library room maps alike.
 *
 * Lazy by construction: three's `KTX2Loader` is imported, and the two
 * transcoder files are fetched, the first time an asset needs them; a
 * document without KTX2 never pays for either. The files sit next to the
 * player file that runs (`shared/own-url.ts`), under the hashed names the
 * build gives them (`scripts/basis-transcoder-plugin.ts`); a loading-manager
 * URL modifier maps the fixed names three asks for onto them.
 *
 * One start per viewer: every asset shares the started loader and its one
 * worker. A start that fails is not kept, so the next KTX2 asset tries again
 * with a new loader. The formats are detected on the renderer the viewer
 * draws with. `dispose` ends the worker with the viewer.
 */

import * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OWN_FILE_URL } from '../shared/own-url.js';
import { ViewerLibError } from '../shared/errors.js';

/** The names three's loader asks for. */
type SourceName = 'basis_transcoder.js' | 'basis_transcoder.wasm';

/** The build's hash of the transcoder pair; `dev` where no build defined it (the dev server answers any hash). */
const BUILD_HASH: string = typeof __JEEX_BASIS_TRANSCODER__ === 'string' ? __JEEX_BASIS_TRANSCODER__ : 'dev';

/** Where a runtime with no document resolves a missing own URL; unreachable on purpose. */
const PLACEHOLDER_BASE = 'http://jeex.invalid/';

/** The published names of the pair, keyed by the names three's loader asks for. */
export function transcoderNames(hash: string): Record<SourceName, string> {
  return {
    'basis_transcoder.js': `lazy-jeex-viewer-basis-transcoder-${hash}.js`,
    'basis_transcoder.wasm': `lazy-jeex-viewer-basis-transcoder-${hash}.wasm`,
  };
}

/** The folder of the player file at `ownUrl`, where the pair is fetched from. */
export function transcoderFolder(ownUrl: string): string {
  const base = typeof document === 'undefined' ? PLACEHOLDER_BASE : document.baseURI;
  return new URL('./', ownUrl === '' ? base : ownUrl).href;
}

/** The part of three's loader module this service uses; a seam for tests. */
export type Ktx2LoaderModule = { KTX2Loader: new (manager: THREE.LoadingManager) => KTX2Loader };

/** A loader for one GLB parse, and the first error any of its textures reported. */
export type Ktx2ParseView = { readonly loader: KTX2Loader; error(): unknown };

/** The transcoder of one viewer. */
export type Ktx2Support = {
  /** The started loader for `GLTFLoader.setKTX2Loader`, wrapped for one parse; rejects when the transcoder cannot start. */
  forParse(): Promise<Ktx2ParseView>;
  /** The compressed texture `bytes` transcode to; the bytes themselves stay with the caller. */
  transcode(bytes: ArrayBuffer): Promise<THREE.CompressedTexture>;
  dispose(): void;
};

export type Ktx2SupportOptions = {
  /** The renderer the viewer draws with; `undefined` before the stage exists. */
  readonly renderer: () => THREE.WebGLRenderer | undefined;
  /** The running player file; `OWN_FILE_URL` when absent. */
  readonly ownUrl?: string;
  /** The pair's hash; the build's when absent. */
  readonly hash?: string;
  /** three's loader module; the lazy import when absent. */
  readonly importLoader?: () => Promise<Ktx2LoaderModule>;
};

/** The default import: its own lazy chunk, never in the boot bundle (the IIFE excepted, which cannot split). */
const importThreeLoader = (): Promise<Ktx2LoaderModule> => import('three/addons/loaders/KTX2Loader.js');

export function createKtx2Support(options: Ktx2SupportOptions): Ktx2Support {
  const folder = transcoderFolder(options.ownUrl ?? OWN_FILE_URL);
  const names = transcoderNames(options.hash ?? BUILD_HASH);
  const importLoader = options.importLoader ?? importThreeLoader;
  let started: Promise<KTX2Loader> | null = null;
  let disposed = false;

  async function create(): Promise<KTX2Loader> {
    const renderer = options.renderer();
    if (renderer === undefined) throw new ViewerLibError('webgl-unavailable', 'KTX2 transcoder: no renderer to detect texture formats on');
    const { KTX2Loader } = await importLoader();
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      for (const [source, published] of Object.entries(names)) if (url === folder + source) return folder + published;
      return url;
    });
    const loader = new KTX2Loader(manager).setTranscoderPath(folder).setWorkerLimit(1).detectSupport(renderer);
    try {
      await loader.init();
    } catch (error) {
      loader.dispose();
      throw error;
    }
    return loader;
  }

  function start(): Promise<KTX2Loader> {
    if (disposed) return Promise.reject(new ViewerLibError('disposed', 'KTX2 transcoder disposed'));
    if (started === null) {
      const attempt = create();
      started = attempt;
      attempt.catch(() => {
        if (started === attempt) started = null;
      });
    }
    return started;
  }

  return {
    async forParse() {
      const loader = await start();
      let first: unknown;
      const view = Object.create(loader) as KTX2Loader;
      view.load = (url, onLoad, onProgress, onError) => {
        loader.load(url, onLoad, onProgress, (error) => {
          first ??= error;
          onError?.(error);
        });
      };
      return { loader: view, error: () => first };
    },
    async transcode(bytes) {
      const loader = await start();
      // The worker takes ownership of the buffer it is given: hand it a copy.
      return new Promise((resolve, reject) => {
        loader.parse(bytes.slice(0), resolve, reject);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      void started?.then((loader) => loader.dispose()).catch(() => undefined);
      started = null;
    },
  };
}
