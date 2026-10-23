/**
 * The texture source of one mounted project: what the app layer knows and the
 * materials layer may not reach for — the device class the renderer reported,
 * its anisotropy, the host's live resolver — handed in as values.
 *
 * One source per document. It is created DEFERRED: the document's first frame
 * is drawn flat, with no network in it, and `SceneMount` starts the source a
 * frame later, the way the GLB upgrade pass is queued.
 */

import { TextureSource, type DecodedImage, type TextureFetch } from '../materials/texture-source.js';
import type { TextureDeviceClass } from '../materials/texture-size.js';
import type { LibraryTextures } from '../geometry/library-surface.js';
import type { Logger } from '../shared/logger.js';
import type * as THREE from 'three';
import { gpuClass } from '../telemetry/device.js';

/** What the running viewer knows about drawing textures; `null` from the caller without a WebGL context. */
export type TextureEnv = {
  /** The GPU class of the context, computed whether or not telemetry is on. */
  readonly device: TextureDeviceClass;
  /** `renderer.capabilities.getMaxAnisotropy()`. */
  readonly maxAnisotropy: number;
  readonly log: Logger;
  /** `ViewerOptions.resolveTexture`, when the host gave one. */
  readonly resolveTexture?: ((path: string) => string | Promise<string>) | undefined;
  /** For tests: the page's `fetch` and `createImageBitmap` when absent. */
  readonly fetch?: TextureFetch | undefined;
  readonly decode?: ((blob: Blob, options: ImageBitmapOptions) => Promise<DecodedImage>) | undefined;
};

/** A deferred texture source for the project whose manifest folder is `baseUrl`. */
export function createProjectTextures(baseUrl: string, env: TextureEnv): LibraryTextures {
  const source = new TextureSource({
    baseUrl,
    log: env.log,
    maxAnisotropy: env.maxAnisotropy,
    deferred: true,
    ...(env.resolveTexture !== undefined && { resolveTexture: env.resolveTexture }),
    ...(env.fetch !== undefined && { fetch: env.fetch }),
    ...(env.decode !== undefined && { decode: env.decode }),
  });
  return { source, device: env.device };
}

/**
 * What `renderer` says about drawing textures: its GPU class (the same
 * capability class telemetry reports, computed here whether or not telemetry
 * is on) and its anisotropy. `null` without a renderer, which is the viewer
 * without a WebGL context.
 */
export function textureEnvOf(
  renderer: THREE.WebGLRenderer | undefined,
  resolveTexture: TextureEnv['resolveTexture'],
  log: Logger,
): TextureEnv | null {
  if (renderer === undefined) return null;
  const gl = renderer.getContext();
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const device = gpuClass(gl, webgl2);
  return { device, maxAnisotropy: renderer.capabilities.getMaxAnisotropy(), log, resolveTexture };
}
