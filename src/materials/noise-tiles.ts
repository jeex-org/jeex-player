/**
 * The periodic noise tiles the procedural textures lay over their base, as
 * named data: one `NoiseTileSpec` per tile, its cache key, its size and the
 * field it samples.
 *
 * They are the costly part of every procedural texture: a 512 px tile with a
 * few octaves of periodic noise is a quarter of a million field samples, each
 * a handful of lattice hashes. Spelled out here rather than inline at each
 * painter so the same tile can be drawn ahead of the build, in slices
 * (`texture-prewarm.ts`), and the painter then finds it in the cache. A tile
 * is content-addressed (`texture-cache.ts`): drawn early or drawn on demand,
 * its key names the same pixels.
 */

import { periodicFbm, periodicNoise2D, periodicRidge } from './texture-noise.js';

/** One noise tile: its cache key, its square size in px and the field over `[0, 1)²` it samples. */
export type NoiseTileSpec = {
  readonly key: string;
  readonly size: number;
  readonly field: (x: number, y: number) => number;
};

const spec = (name: string, size: number, field: (x: number, y: number) => number): NoiseTileSpec => ({
  key: `${name}:${size}`,
  size,
  field,
});

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
export function grainTileSpec(seed: number, strength: number, size = 256): NoiseTileSpec {
  return spec(`grain:${seed}:${strength}:${size}`, size, (x, y) => {
    const coarse = periodicFbm(x, y, { octaves: 4, freq: 3, gain: 0.55, seed });
    const fine = periodicNoise2D(x, y, size / 2, seed + 91);
    return 0.5 + (coarse - 0.5) * strength + (fine - 0.5) * strength * 0.55;
  });
}

/** Terrazzo's polished sheen: broad, very low contrast. */
export const TERRAZZO_SHEEN = spec(
  'terrazzo-sheen',
  512,
  (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 2, freq: 2, gain: 0.5, seed: 707 }) - 0.5) * 0.3,
);

/** The tiles' sheen, at the texture's own size: high enough a frequency to read as surface. */
export function tileSheenSpec(size: number): NoiseTileSpec {
  return spec('tile-sheen', size, (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 3, freq: 12, gain: 0.5, seed: 133 }) - 0.5) * 0.18);
}

/** Plaster's trowel-scale undulation, at the texture's own size. */
export function plasterBroadSpec(size: number): NoiseTileSpec {
  return spec('plaster-broad', size, (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 4, freq: 3, gain: 0.55, seed: 21 }) - 0.5) * 0.34);
}

/** Plaster's fine tooth. */
export const PLASTER_TOOTH = spec('plaster-tooth', 256, (x, y) => {
  const fine = periodicFbm(x, y, { octaves: 3, freq: 32, gain: 0.5, seed: 55 });
  return 0.5 + (fine - 0.5) * 0.5;
});

/** Wallpaper's paper ground: a fine linen tooth with a slight vertical bias. */
export const PAPER = spec('paper', 256, (x, y) => {
  const weave = periodicNoise2D(x, y, 96, 12) * 0.6 + periodicNoise2D(x, y, 24, 34) * 0.4;
  return 0.5 + (weave - 0.5) * 0.42;
});

/** Fabric slubs and nap, one tile per weave seed. */
export function weaveSlubSpec(seed: number): NoiseTileSpec {
  return spec(`weave-slub:${seed}`, 256, (x, y) => {
    const slub = periodicFbm(x, y, { octaves: 3, freq: 6, gain: 0.55, seed: seed * 7 + 3 });
    return 0.5 + (slub - 0.5) * 0.55;
  });
}

/** Whole-floor wear on plank floors. */
export const PLANK_WEAR = spec(
  'plank-wear',
  512,
  (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 3, freq: 2, gain: 0.6, seed: 401 }) - 0.5) * 0.42,
);

/** Broad tone drift across a wood-grain board. */
export const WOOD_DRIFT = spec(
  'wood-drift',
  256,
  (x, y) => 0.5 + (periodicFbm(x, y, { octaves: 3, freq: 2, gain: 0.55, seed: 811 }) - 0.5) * 0.3,
);

/** Wood pores: six times the lattice frequency across the grain. */
export const WOOD_PORES = spec('wood-pores', 256, (x, y) => {
  const along = periodicFbm(x, y * 6, { octaves: 3, freq: 4, gain: 0.5, seed: 613 });
  return 0.5 + (along - 0.5) * 0.9;
});

/** The whisper of cloud that keeps the sky gradient from banding. */
export const SKY_VEIL = spec(
  'sky-veil',
  128,
  (x, y) => 0.5 + (periodicRidge(x, y, { octaves: 3, freq: 2, gain: 0.5, seed: 3 }) - 0.5) * 0.25,
);

/** The size the tile and plaster painters draw at, and therefore the size of their sheen tiles. */
const SURFACE_TEXTURE_SIZE = 512;

/**
 * Every tile a viewer can be expected to need, whatever its scene: the ones
 * whose key does not depend on a finish. The weave slubs are left out because
 * each fabric seed has its own; they stay on demand.
 */
export const COMMON_NOISE_TILES: readonly NoiseTileSpec[] = [
  grainTileSpec(GRAIN_WOOD, 0.5),
  grainTileSpec(GRAIN_WOOD, 0.42),
  grainTileSpec(GRAIN_MINERAL, 0.7),
  grainTileSpec(GRAIN_FABRIC, 0.55),
  grainTileSpec(GRAIN_PAPER, 0.35),
  PLANK_WEAR,
  WOOD_DRIFT,
  WOOD_PORES,
  plasterBroadSpec(SURFACE_TEXTURE_SIZE),
  PLASTER_TOOTH,
  PAPER,
  tileSheenSpec(SURFACE_TEXTURE_SIZE),
  TERRAZZO_SHEEN,
  SKY_VEIL,
];
