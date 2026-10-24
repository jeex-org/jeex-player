/**
 * One atlas page of a light bake, from its lossless WebP level files to a
 * texture the GPU uploads once.
 *
 * The page's levels were filtered from decoded linear light by the bake, so
 * the browser must never build mips from RGBM bytes: the texture carries the
 * prepared levels 0 to the contract's mip limit and generates none. three
 * r186 allocates `mipmaps.length` immutable levels, so sampling stops at the
 * limit without any renderer internals. Each image is decoded with
 * premultiplication and colour conversion off (M is a straight alpha, the
 * bytes are linear and not colour), and the texture is in no colour space,
 * unflipped (the rows are top-down, like glTF's UVs) and read from UV
 * channel 1.
 *
 * Invariant: the decoded images stay alive until `dispose`, so a restored
 * context can upload them again; on a failed load every image already decoded
 * is closed.
 */

import * as THREE from 'three';
import type { LightBakePage } from './light-bake.js';
import { LightBakeError } from './light-bake-error.js';

/** A loaded page: its texture and the release of its images and GPU memory. */
export type LightmapPage = { readonly texture: THREE.Texture; readonly levels: number; dispose(): void };

/** How a level file is fetched: the default is `fetch`, tests may serve bytes themselves. */
export type FetchBytes = (url: URL) => Promise<Blob>;

export const fetchBlob: FetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new LightBakeError('page', `light bake ${url.pathname}: HTTP ${String(response.status)}`);
  return response.blob();
};

/** The size of level `level` of a page `width` × `height`. */
export function levelSize(width: number, height: number, level: number): { width: number; height: number } {
  return { width: Math.max(1, Math.floor(width / 2 ** level)), height: Math.max(1, Math.floor(height / 2 ** level)) };
}

/** Decodes one level file exactly: no premultiplication, no colour conversion, no flip. */
export async function decodeLevel(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'from-image' });
}

/** A texture over prepared levels, configured for an RGBM lightmap. */
export function lightmapTexture(levels: readonly ImageBitmap[]): THREE.Texture {
  const texture = new THREE.Texture(levels[0]);
  // three's type names compressed and cube mipmaps only; an image list is what its uploader reads for a plain texture.
  Object.assign(texture, { mipmaps: [...levels] });
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.anisotropy = 1;
  texture.channel = 1;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Loads levels 0..`lodLimit` of `page` from files next to `base`; refuses a
 * level whose size is not the one its index implies.
 */
export async function loadLightmapPage(
  page: LightBakePage,
  lodLimit: number,
  base: URL,
  fetchBytes: FetchBytes = fetchBlob,
): Promise<LightmapPage> {
  const files = page.webp.slice(0, lodLimit + 1);
  const settled = await Promise.allSettled(files.map(async (file) => decodeLevel(await fetchBytes(new URL(file, base)))));
  const decoded = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const failure = settled.find((result) => result.status === 'rejected');
  const release = (): void => {
    for (const image of decoded) image.close();
  };
  if (failure) {
    release();
    throw new LightBakeError('page', `a lightmap level of the page failed to load: ${String(failure.reason)}`, { cause: failure.reason });
  }
  for (const [level, image] of decoded.entries()) {
    const want = levelSize(page.width, page.height, level);
    if (image.width !== want.width || image.height !== want.height) {
      release();
      throw new LightBakeError(
        'page',
        `lightmap level ${files[level]!}: ${String(image.width)} x ${String(image.height)}, expected ${String(want.width)} x ${String(want.height)}`,
      );
    }
  }
  const texture = lightmapTexture(decoded);
  let disposed = false;
  return {
    texture,
    levels: decoded.length,
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
      release();
    },
  };
}
