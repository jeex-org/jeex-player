/**
 * The sliced noise-tile prewarm on a real canvas: it yields between slices,
 * it draws exactly the pixels an on-demand tile has, and the painters then
 * use the tiles it cached instead of drawing their own.
 */

import { afterEach, describe, expect, test } from 'vitest';
import {
  COMMON_NOISE_TILES,
  PLANK_WEAR,
  grainTileSpec,
  GRAIN_WOOD,
  weaveSlubSpec,
  type NoiseTileSpec,
} from '../../src/materials/noise-tiles.js';
import { noiseTile } from '../../src/materials/texture-canvas.js';
import { prewarmNoiseTiles } from '../../src/materials/texture-prewarm.js';
import { sharedTextureCache } from '../../src/materials/texture-cache.js';
import { planksTexture, resetTextureCache } from '../../src/materials/textures.js';

afterEach(() => {
  resetTextureCache();
});

/**
 * SHA-256 of each tile's grey bytes as the inline painters drew them before
 * the tiles became named specs (computed once, outside the repository, from
 * those painters' fields): a tile that drifts from its old pixels fails here.
 */
const GOLDEN: Readonly<Record<string, string>> = {
  'grain:101:0.5:256:256': '043088ada48c0dbdf6234d4cb289bae686d3d018bb04b77992912d8d394f998a',
  'grain:101:0.42:256:256': 'd8ca0fbb1530be64334dfac3f07f6c6a18f5a8044f191501092d7d34d06f6f7c',
  'grain:102:0.7:256:256': '38eb98f13845f2e0c8001c31fac57bb23f6ccf995914fd9bbf7d763b3d03fac8',
  'grain:103:0.55:256:256': 'f4d8fc963603230bd41df5021ecd4fed7d10bb3774a40ed44185e48c38f262de',
  'grain:104:0.35:256:256': 'f819d4e107930d22e23e9e8e6ad5c00f43b9520acbf6801e0c1560bb2e837fd0',
  'plank-wear:512': '75060b50928d40ffebbcbbe17d499ec5833cdd36db65ac0e8ff0aae5452514ce',
  'wood-drift:256': 'b5c52dfa526e31f9afe170c1672f99e2d72f9ef338f87a0dafd052d99dd3aca9',
  'wood-pores:256': 'c725047e85315080a45d02f1ba66cb70892fb864ebf69dbb2ea6b90d0d5b1f90',
  'plaster-broad:512': 'cb66d6460324748590c3445db16978eb6e8a2e6fe9b20e5a3231b02c5d1545b6',
  'plaster-tooth:256': '4380c8cc224a98bb63c80fb47d23237e2c9cf551cc1b046862545590d3704dca',
  'paper:256': 'fc501fe99949c17d100d26106fb682e450c09564343f801e4c371fb178304f79',
  'tile-sheen:512': '3f735b18bcbfd21e4db5ad8a30792ea10871e4e02ae3bb094006b2521bde8a8d',
  'terrazzo-sheen:512': 'bb7e925e679e55e7785e2d1bba7198a0c15f3d98f9eb2678b25937d548f55f5e',
  'sky-veil:128': '2e134db3bcc3c1a95eb913dba9b7efe9d2d26bc873601b71d8cb00378e2941d4',
  'weave-slub:5:256': 'cc0cd49ec5757154c0bee3698a6ed6de331aa2a711e253c58e86272d1b7cd8ee',
};

/** The tiles pinned against `GOLDEN`: every common tile and one weave slub. */
const PINNED: readonly NoiseTileSpec[] = [...COMMON_NOISE_TILES, weaveSlubSpec(5)];

/** The SHA-256 of a grey tile's red channel, hex. */
async function greyHash(canvas: HTMLCanvasElement): Promise<string> {
  const rgba = pixels(canvas);
  const grey = new Uint8Array(rgba.length / 4);
  for (let index = 0; index < grey.length; index += 1) grey[index] = rgba[index * 4]!;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', grey));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** A clock on which every look at the time is past the deadline: the prewarm yields at every step. */
function strictClock(): { now: () => number; yieldTask: () => Promise<void>; yields: () => number } {
  let time = 0;
  let yields = 0;
  return {
    now: () => (time += 100),
    yieldTask: async () => {
      yields += 1;
    },
    yields: () => yields,
  };
}

describe('prewarmNoiseTiles', () => {
  test('draws every tile with the pixels the inline painters drew before', async () => {
    await prewarmNoiseTiles(PINNED, new AbortController().signal);
    expect(Object.keys(GOLDEN).sort()).toEqual(PINNED.map((spec) => spec.key).sort());
    for (const spec of PINNED) {
      const canvas = sharedTextureCache.canvas(spec.key);
      expect(canvas, spec.key).not.toBeNull();
      expect([spec.key, await greyHash(canvas!)]).toEqual([spec.key, GOLDEN[spec.key]]);
    }
  });

  test('draws every common tile with the pixels an on-demand tile has', async () => {
    await prewarmNoiseTiles(COMMON_NOISE_TILES, new AbortController().signal);
    const warmed = new Map<NoiseTileSpec, Uint8ClampedArray>();
    for (const spec of COMMON_NOISE_TILES) {
      const canvas = sharedTextureCache.canvas(spec.key);
      expect(canvas, spec.key).not.toBeNull();
      warmed.set(spec, pixels(canvas!));
    }
    resetTextureCache();
    for (const spec of COMMON_NOISE_TILES) {
      const onDemand = noiseTile(spec)!;
      expect(pixels(onDemand), spec.key).toEqual(warmed.get(spec));
    }
  });

  test('yields between slices, and a tile enters the cache only when complete', async () => {
    const clock = strictClock();
    const spec = grainTileSpec(GRAIN_WOOD, 0.5);
    let partial = false;
    const original = clock.yieldTask;
    clock.yieldTask = async () => {
      if (sharedTextureCache.canvas(spec.key) !== null) partial = true;
      await original();
    };
    await prewarmNoiseTiles([spec], new AbortController().signal, clock);
    // 256 rows in steps of 8, and this clock is past the deadline at every step.
    expect(clock.yields()).toBe(256 / 8);
    expect(partial).toBe(false);
    expect(sharedTextureCache.canvas(spec.key)).not.toBeNull();
  });

  test('stops at the next slice once its signal aborts, caching nothing half drawn', async () => {
    const clock = strictClock();
    const controller = new AbortController();
    const yieldTask = clock.yieldTask;
    clock.yieldTask = async () => {
      controller.abort();
      await yieldTask();
    };
    await prewarmNoiseTiles([PLANK_WEAR], controller.signal, clock);
    expect(sharedTextureCache.canvas(PLANK_WEAR.key)).toBeNull();
  });

  test('a painter uses the tiles the prewarm cached instead of drawing its own', async () => {
    await prewarmNoiseTiles(COMMON_NOISE_TILES, new AbortController().signal);
    const before = COMMON_NOISE_TILES.map((spec) => sharedTextureCache.canvas(spec.key));
    expect(planksTexture('#b08a62', 3)).not.toBeNull();
    // The same canvas objects, not equal ones: a painter that drew its own tile would replace them.
    COMMON_NOISE_TILES.forEach((spec, index) => expect(sharedTextureCache.canvas(spec.key), spec.key).toBe(before[index]));
  });
});
