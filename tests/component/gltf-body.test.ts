import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { createGltfModelSource, type ModelRequest } from '../../src/geometry/model-source.js';
import { prepareGltfBody } from '../../src/geometry/gltf-body.js';
import { FinishRegistry } from '../../src/assets/asset-finishes.js';
import { ARCHETYPE, VARIANT } from '../../src/assets/catalogue-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';

/**
 * The GLB path over a REAL transport: Vite serves the committed fixture, the
 * page's own `fetch` gets it, and the lazily imported `GLTFLoader` parses it.
 *
 * What only a browser can prove, and `src/geometry/model-source.test.ts`
 * therefore cannot: the finish materials a loaded body ends up wearing are the
 * generated, textured ones — under `bun test` every generator returns null and
 * a flat colour hides whether the binding reached a real material at all.
 */

const request: ModelRequest = {
  url: '/tests/fixtures/project/obj/box-sofa@1.0.0.glb',
  archetypeId: ARCHETYPE.sofa_3s,
  variantId: VARIANT.sofa_3s_linen,
  dims: [2.1, 0.85, 0.95],
  materialSlots: { upholstery: 'seat' },
};

describe('a GLB body in a real browser', () => {
  test('loads, measures and wears the placement finishes', async () => {
    const source = createGltfModelSource();
    const finishes = new FinishRegistry();
    try {
      const loaded = await source(request, new AbortController().signal);
      expect(loaded.triangles).toBe(24);
      const outcome = prepareGltfBody(loaded.group, request, finishes, { upholstery: FINISH.linen_sand, frame: FINISH.oak_natural });
      expect(outcome.warnings).toEqual([]);

      const materials: THREE.MeshStandardMaterial[] = [];
      outcome.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) materials.push(child.material);
      });
      expect(materials.map((material) => material.name)).toEqual([FINISH.linen_sand, FINISH.oak_natural]);
      // The distinguishing fact: a generated finish carries a rasterised map.
      expect(materials.every((material) => material.map !== null)).toBe(true);

      const box = new THREE.Box3().setFromObject(outcome.group);
      expect(box.min.y).toBeCloseTo(0, 3);
      expect(
        box
          .getSize(new THREE.Vector3())
          .toArray()
          .map((value) => Number(value.toFixed(3))),
      ).toEqual([2.1, 0.85, 0.95]);
    } finally {
      finishes.dispose();
      source.dispose();
    }
  });

  test('a path that is not a model rejects without taking the cache down with it', async () => {
    const source = createGltfModelSource();
    try {
      // The dev server answers an unknown path with its index page and a 200,
      // which is exactly the shape of failure a CDN gives a mistyped `model`.
      const missing = { ...request, url: '/tests/fixtures/project/obj/no-such-model.glb' };
      await expect(source(missing, new AbortController().signal)).rejects.toThrow(/is not a GLB container/);
      const loaded = await source(request, new AbortController().signal);
      expect(loaded.triangles).toBe(24);
    } finally {
      source.dispose();
    }
  });
});
