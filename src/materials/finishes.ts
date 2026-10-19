/**
 * Three.js side of the finish catalogue: the only place that turns a `Finish`
 * into materials and textures, so world scale (`tile`, in metres per texture
 * repeat) stays here. The catalogue data itself lives in the pure
 * `finish-catalogue.ts` and is re-exported unchanged.
 *
 * WHICH texture a kind draws is not decided here: `finish-generators.ts` is the
 * one registry over both families (room surfaces and objects), and this module
 * only says how a `Finish` reads as its parameters. One registry rather than a
 * table per family is what keeps a project material from being drawable on a
 * wall and not on a sofa.
 */

import * as THREE from 'three';
import type { GeneratorEntry, GeneratorParams } from './finish-generators.js';
import { generatorFor, paramsOfGenerator } from './finish-generators.js';

export type { Finish } from './finish-catalogue.js';
export { FLOOR_FINISHES, WALL_FINISHES, findFinish, finishKind, finishTile } from './finish-catalogue.js';

import type { Finish } from './finish-catalogue.js';
import { createCanvas2D } from './canvas-2d.js';
import { sharedTextureCache } from './texture-cache.js';

/**
 * The registry key and the parameters a finish draws with.
 *
 * A catalogue row says WHICH generator by its `kind` and carries the
 * parameters as its own fields; a finish that came from a project's
 * `materials[]` carries the generator whole (`Finish.generator`,
 * `finish-catalogue.finishFromProjectMaterial`) and that one wins — it is the
 * richer statement, and it can name a kind no `FinishKind` has, which is the
 * point of the open generator set.
 */
function drawing(finish: Finish): { readonly entry: GeneratorEntry | undefined; readonly params: GeneratorParams } {
  if (finish.generator) return { entry: generatorFor(finish.generator.kind), params: paramsOfGenerator(finish.generator) };
  return {
    entry: generatorFor(finish.kind),
    params: { tone: finish.base, accent: finish.accent, seed: finish.seed ?? 1, grid: finish.grid, style: finish.style },
  };
}

export function finishTexture(finish: Finish): THREE.Texture | null {
  const { entry, params } = drawing(finish);
  return entry?.colour(params) ?? null;
}

/**
 * Height detail that matches `finishTexture`, or `null` for flat finishes.
 * Shares the texture cache, so it costs one canvas per finish at most.
 */
export function finishBumpTexture(finish: Finish): THREE.Texture | null {
  if (!finish.bump) return null;
  const { entry, params } = drawing(finish);
  return entry?.bump?.(params) ?? null;
}

/**
 * Bump clones keyed by finish and repeat. Unlike colour maps (cloned per
 * material and disposed by the caller that replaces them), these clones are
 * shared between materials and owned by the texture cache — callers must not
 * dispose `material.bumpMap`, and it is freed when the last viewer on the page
 * releases the cache (`texture-cache.ts`).
 */
const BUMP_CLONE_PREFIX = 'bump-clone:';

function bumpClone(finish: Finish, repeatX: number, repeatY: number): THREE.Texture | null {
  const source = finishBumpTexture(finish);
  if (!source) return null;
  const key = `${BUMP_CLONE_PREFIX}${finish.id}:${repeatX.toFixed(3)}:${repeatY.toFixed(3)}`;
  const hit = sharedTextureCache.texture(key);
  if (hit) return hit;
  const clone = source.clone();
  clone.needsUpdate = true;
  clone.repeat.set(repeatX, repeatY);
  return sharedTextureCache.putTexture(key, clone);
}

/** Applies a finish to a material in place: texture (cloned for independent repeat) or flat colour. */
export function applyFinishToMaterial(material: THREE.MeshStandardMaterial, finish: Finish, repeatX: number, repeatY: number): void {
  const texture = finishTexture(finish);
  if (texture) {
    const clone = texture.clone();
    clone.needsUpdate = true;
    clone.repeat.set(repeatX, repeatY);
    material.map = clone;
    material.color.set('#ffffff');
    const bump = bumpClone(finish, repeatX, repeatY);
    material.bumpMap = bump;
    material.bumpScale = finish.bump ?? 1;
  } else {
    material.map = null;
    material.bumpMap = null;
    material.color.set(finish.base);
  }
  material.roughness = finish.roughness;
  material.needsUpdate = true;
}

export function finishMaterial(finish: Finish, repeatX: number, repeatY: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: finish.roughness });
  applyFinishToMaterial(material, finish, repeatX, repeatY);
  return material;
}

/**
 * The finish rendered into a `size x size` canvas, or `null` when there is no
 * texture to render and no canvas to render it into (`canvas-2d.ts`).
 */
function swatchCanvas(finish: Finish, size: number): HTMLCanvasElement | null {
  const texture = finishTexture(finish);
  if (!texture) return null;
  const image = texture.image as HTMLCanvasElement;
  if (!image) return null;
  const surface = createCanvas2D(size);
  if (!surface) return null;
  // Halve repeatedly before the final draw: a straight 1024 -> 64 downscale
  // drops most of the grain and makes every wood swatch look the same.
  let source: HTMLCanvasElement = image;
  while (source.width > size * 2) {
    const step = createCanvas2D(Math.max(size, Math.floor(source.width / 2)), Math.max(size, Math.floor(source.height / 2)));
    if (!step) break;
    step.ctx.drawImage(source, 0, 0, step.canvas.width, step.canvas.height);
    source = step.canvas;
  }
  surface.ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, size, size);
  return surface.canvas;
}

/** Small preview image of a finish for UI swatches. */
export function finishSwatchDataURL(finish: Finish, size = 64): string | null {
  return swatchCanvas(finish, size)?.toDataURL('image/png') ?? null;
}

/**
 * Preview of a finish PAIR, split on the diagonal: the first finish fills the
 * lower-left triangle, the second the upper-right one, with a hairline between
 * them. This is how an interior preset shows its floor and its walls in one
 * chip. No text is ever drawn into it (previews carry no text) — the preset's name is
 * a separate label.
 */
export function finishPairSwatchDataURL(first: Finish, second: Finish, size = 72): string | null {
  const lower = swatchCanvas(first, size);
  const upper = swatchCanvas(second, size);
  if (!lower || !upper) return null;
  const surface = createCanvas2D(size);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  ctx.drawImage(lower, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(size, size);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(upper, 0, 0);
  ctx.restore();
  // The seam: without it two close-toned finishes read as one flat chip.
  ctx.strokeStyle = 'rgba(12, 14, 14, .35)';
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, size);
  ctx.stroke();
  return canvas.toDataURL('image/png');
}
