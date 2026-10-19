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
import { periodicFbm, periodicNoise2D, wrapOffsets } from './texture-noise.js';
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
 * Grayscale periodic-noise tile, cached and shared between finishes. Mid grey
 * (128) is neutral under `soft-light`/`overlay`, so these tiles can be laid
 * over any base colour to add grain without shifting its hue.
 */
export function noiseTile(name: string, size: number, field: (x: number, y: number) => number): HTMLCanvasElement | null {
  const key = `${name}:${size}`;
  const hit = sharedTextureCache.canvas(key);
  if (hit) return hit;
  const surface = createCanvas2D(size);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y += 1) {
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
  ctx.putImageData(image, 0, 0);
  return sharedTextureCache.putCanvas(key, canvas);
}

/**
 * Grain seeds are shared per material family rather than per finish: the noise
 * is greyscale and colour-independent, so four cached tiles cover the whole
 * catalogue instead of one per finish.
 */
export const GRAIN_WOOD = 101;
export const GRAIN_MINERAL = 102;
export const GRAIN_FABRIC = 103;
export const GRAIN_PAPER = 104;

/** Fine surface grain shared by plaster, wallpaper and fabric. */
export function grainTile(seed: number, strength: number, size = 256): HTMLCanvasElement | null {
  return noiseTile(`grain:${seed}:${strength}:${size}`, size, (x, y) => {
    const coarse = periodicFbm(x, y, { octaves: 4, freq: 3, gain: 0.55, seed });
    const fine = periodicNoise2D(x, y, size / 2, seed + 91);
    return 0.5 + (coarse - 0.5) * strength + (fine - 0.5) * strength * 0.55;
  });
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
