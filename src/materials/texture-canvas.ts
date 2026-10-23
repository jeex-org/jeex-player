/**
 * Canvas plumbing shared by every procedural texture: the texture cache, the
 * Three.js wrapping of a canvas, the torus-aware draw helper and the cached
 * periodic noise tiles.
 *
 * Invariant: everything here keeps textures tileable. `drawWrapped` repaints a
 * shape on the far side of the border it crosses, and `overlayNoise` repeats a
 * noise tile at native resolution instead of stretching it (stretching clamps
 * at the outer texels and leaves a hairline exactly on the seam).
 *
 * Every entry point returns `null` when `createCanvas2D` does (`canvas-2d.ts`
 * owns that one policy), so the module is importable from bun tests.
 */

import * as THREE from 'three';
import { wrapOffsets } from './texture-noise.js';
import { grainTileSpec, type NoiseTileSpec } from './noise-tiles.js';
import { createCanvas2D, type Ctx } from './canvas-2d.js';
import { sharedTextureCache } from './texture-cache.js';

/**
 * Reports one renderer's hardware maximum to the shared cache. Call with
 * `renderer.capabilities.getMaxAnisotropy()` once the renderer exists; with
 * two renderers on a page the LOWEST of them wins (`texture-cache.ts`).
 */
export function setTextureAnisotropy(value: number): void {
  sharedTextureCache.reportCapability(value);
}

export function getTextureAnisotropy(): number {
  return sharedTextureCache.anisotropy;
}

export type { Ctx } from './canvas-2d.js';

/** What a canvas texture CARRIES: an sRGB colour map, or linear data (bump, roughness). */
export type TextureKind = 'colour' | 'data';

function toTexture(canvas: HTMLCanvasElement, kind: TextureKind, repeatWrap: boolean): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  // Colour maps are authored in sRGB; bump/roughness data must stay linear.
  texture.colorSpace = kind === 'colour' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const wrap = repeatWrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = sharedTextureCache.anisotropy;
  return texture;
}

export type CachedOptions = { size?: number; kind?: TextureKind; repeatWrap?: boolean };

export function cached(key: string, draw: (ctx: Ctx, size: number) => void, options: CachedOptions = {}): THREE.Texture | null {
  const hit = sharedTextureCache.texture(key);
  if (hit) return hit;
  const size = options.size ?? 512;
  const surface = createCanvas2D(size);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  draw(ctx, size);
  return sharedTextureCache.putTexture(key, toTexture(canvas, options.kind ?? 'colour', options.repeatWrap ?? true));
}

/* ------------------------------------------------------------- torus tools */

/**
 * Draws `paint` once per wrapped copy needed for the given bounding box, so a
 * shape straddling the tile border reappears on the opposite side.
 */
export function drawWrapped(ctx: Ctx, size: number, box: { x: number; y: number; w: number; h: number }, paint: (ctx: Ctx) => void): void {
  const xs = wrapOffsets(box.x, box.w, size);
  const ys = wrapOffsets(box.y, box.h, size);
  for (const dx of xs) {
    for (const dy of ys) {
      ctx.save();
      ctx.translate(dx, dy);
      paint(ctx);
      ctx.restore();
    }
  }
}

/**
 * Writes rows `from` to `to` (exclusive) of a noise tile's pixels. The one
 * loop both the on-demand tile and the sliced prewarm (`texture-prewarm.ts`)
 * run, so a tile drawn either way has the same pixels.
 */
export function fillNoiseRows(spec: NoiseTileSpec, data: Uint8ClampedArray, from: number, to: number): void {
  const { size, field } = spec;
  for (let y = from; y < to; y += 1) {
    const ny = y / size;
    for (let x = 0; x < size; x += 1) {
      const value = Math.min(255, Math.max(0, Math.round(field(x / size, ny) * 255)));
      const index = (y * size + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
}

/**
 * Grayscale periodic-noise tile, cached and shared between finishes. Mid grey
 * (128) is neutral under `soft-light`/`overlay`, so these tiles can be laid
 * over any base colour to add grain without shifting its hue.
 */
export function noiseTile(spec: NoiseTileSpec): HTMLCanvasElement | null {
  const hit = sharedTextureCache.canvas(spec.key);
  if (hit) return hit;
  const surface = createCanvas2D(spec.size);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const image = ctx.createImageData(spec.size, spec.size);
  fillNoiseRows(spec, image.data, 0, spec.size);
  ctx.putImageData(image, 0, 0);
  return sharedTextureCache.putCanvas(spec.key, canvas);
}

export { GRAIN_FABRIC, GRAIN_MINERAL, GRAIN_PAPER, GRAIN_WOOD } from './noise-tiles.js';

/** Fine surface grain shared by plaster, wallpaper and fabric. */
export function grainTile(seed: number, strength: number, size = 256): HTMLCanvasElement | null {
  return noiseTile(grainTileSpec(seed, strength, size));
}

/**
 * Lays a cached noise tile over the whole canvas with a soft blend.
 *
 * The tile is repeated at its native resolution rather than stretched: scaling
 * would clamp at the tile's outer texels and leave a faint bright/dark hairline
 * exactly on the seam, which is the one place it must not appear.
 */
export function overlayNoise(
  ctx: Ctx,
  size: number,
  tile: HTMLCanvasElement | null,
  alpha: number,
  mode: GlobalCompositeOperation = 'soft-light',
): void {
  if (!tile) return;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  for (let y = 0; y < size; y += tile.height) {
    for (let x = 0; x < size; x += tile.width) ctx.drawImage(tile, x, y);
  }
  ctx.restore();
}

/**
 * Disposes and forgets every cached texture and noise tile, whatever the
 * reference count says. It is the TEST entry point; a running viewer releases
 * its hold instead (`TextureCache.release`, from `RenderRuntime.dispose`), so
 * a sibling viewer never loses the textures it is still drawing with.
 */
export function resetTextureCache(): void {
  sharedTextureCache.dispose();
}
