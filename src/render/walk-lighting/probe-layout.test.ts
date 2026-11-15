import { describe, expect, test } from 'bun:test';
import { gridAtlasLayout, probeArrayLayout, WEBGL2_MINIMUMS } from './probe-layout.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting-tuning.js';

/** The largest grid a room box may ask for, and the exterior grid's. */
const LARGEST = { x: T.maxProbesPerAxis, y: T.gridLayers, z: T.maxProbesPerAxis };
const EXTERIOR = { x: 2, y: 2, z: 2 };

describe('the probe array', () => {
  test('holds every room of the largest plan within WebGL 2’s guaranteed array layers', () => {
    const layout = probeArrayLayout(T.maxBoxes);
    expect(layout.layers).toBe(T.maxBoxes * 6);
    expect(layout.layers).toBeLessThanOrEqual(WEBGL2_MINIMUMS.arrayLayers);
  });

  test('has 128 texel faces and a mip chain down to 4 texels, one level per level of a probe’s PMREM', () => {
    const layout = probeArrayLayout(9);
    expect(layout.faceSize).toBe(128);
    expect(layout.levels).toBe(6);
    expect(layout.faceSize >> (layout.levels - 1)).toBe(4);
    // RGBA16F: 8 bytes a texel, every level of every layer.
    expect(layout.bytes).toBe(54 * 8 * (128 ** 2 + 64 ** 2 + 32 ** 2 + 16 ** 2 + 8 ** 2 + 4 ** 2));
  });
});

describe('the packed grid atlas', () => {
  const grids = [...Array.from({ length: T.maxBoxes }, () => LARGEST), EXTERIOR];
  const layout = gridAtlasLayout(grids);

  test('holds the largest grid of every room box and the exterior within WebGL 2’s guaranteed 3D size', () => {
    expect(layout.width).toBeLessThanOrEqual(WEBGL2_MINIMUMS.size3d);
    expect(layout.height).toBeLessThanOrEqual(WEBGL2_MINIMUMS.size3d);
    expect(layout.depth).toBeLessThanOrEqual(WEBGL2_MINIMUMS.size3d);
  });

  test('gives every grid its own block, padding included, inside the atlas', () => {
    const blocks = grids.map((grid, i) => {
      const slot = layout.slots[i]!;
      return { x0: slot.x, x1: slot.x + grid.x + 2, y0: slot.y, y1: slot.y + 7 * (grid.y + 2), z1: grid.z + 2 };
    });
    for (const block of blocks) {
      expect(block.x1).toBeLessThanOrEqual(layout.width);
      expect(block.y1).toBeLessThanOrEqual(layout.height);
      expect(block.z1).toBeLessThanOrEqual(layout.depth);
    }
    blocks.forEach((a, i) =>
      blocks.slice(i + 1).forEach((b) => {
        const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
        expect(apart).toBe(true);
      }),
    );
  });

  test('lays the demo-sized grids side by side in one row', () => {
    const small = gridAtlasLayout([{ x: 7, y: 3, z: 5 }, { x: 4, y: 3, z: 3 }, EXTERIOR]);
    expect(small.slots).toEqual([
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 15, y: 0 },
    ]);
    expect([small.width, small.height, small.depth]).toEqual([19, 35, 7]);
    // RGBA32F, as three's own grid atlas: 16 bytes a texel.
    expect(small.bytes).toBe(19 * 35 * 7 * 16);
  });
});
