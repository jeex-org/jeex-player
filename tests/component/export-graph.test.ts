/**
 * `exportGraph` against a real build, in a real browser.
 *
 * `src/render/export-graph.test.ts` (bun) covers the logic thoroughly and
 * fast, with no GPU; this file exists because `src/render/**` carries a
 * component-tier coverage floor (`scripts/coverage-check.ts`
 * `COMPONENT_LAYER_FLOORS`) that a bun-only test cannot satisfy — the two
 * suites report to separate coverage runs. Real canvas textures apply here
 * (no `document` fallback), which is closer to what an actual export sees.
 */

import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { SceneBuilder } from '../../src/geometry/scene-builder.js';
import { solvePlan } from '../../src/plan/plan-solver.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { metadataTable } from '../../src/scene/metadata-table.js';
import { exportGraph } from '../../src/render/export-graph.js';
import { isFaceKey } from '../../src/scene/types.js';

function build(): { root: THREE.Group; dispose: () => void } {
  const plan = solvePlan(lShapePlan);
  const builder = new SceneBuilder(lShapePlan, plan);
  const { root } = builder.build();
  return { root, dispose: () => builder.dispose() };
}

describe('exportGraph, in a real browser', () => {
  test('the clone is JSON-safe throughout, carries EXT_mesh_features, and forces the ceiling visible', () => {
    const { root, dispose } = build();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);

      let nodes = 0;
      let tagged = 0;
      let ceilingSeen = false;
      let facesSeen = 0;
      let furnitureSeen = 0;
      clone.traverse((object) => {
        nodes += 1;
        expect(() => JSON.stringify(object.userData)).not.toThrow();
        for (const value of Object.values(object.userData)) expect(typeof value).not.toBe('function');

        const extensions = (object.userData as { gltfExtensions?: { EXT_mesh_features?: unknown } })['gltfExtensions'];
        if (extensions?.EXT_mesh_features) tagged += 1;

        if (object.userData['isCeiling'] === true) {
          ceilingSeen = true;
          expect(object.visible).toBe(true);
        }
        if (object.userData['surface'] === 'wall') {
          facesSeen += 1;
          expect(isFaceKey(object.userData['face'])).toBe(true);
        }
        if (typeof object.userData['assetId'] === 'string') furnitureSeen += 1;
      });

      expect(nodes).toBeGreaterThan(0);
      expect(tagged).toBeGreaterThan(0);
      expect(ceilingSeen).toBe(true);
      expect(facesSeen).toBeGreaterThan(0);
      expect(furnitureSeen).toBeGreaterThan(0);

      // Pick proxies (fully transparent) never made it into the clone.
      clone.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        const invisible = material instanceof THREE.Material && material.transparent && material.opacity === 0;
        expect(invisible).toBe(false);
      });

      // Geometries and materials are shared, never cloned.
      const originalGeometries = new Set<THREE.BufferGeometry>();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) originalGeometries.add(object.geometry);
      });
      let checkedAny = false;
      clone.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          checkedAny = true;
          expect(originalGeometries.has(object.geometry)).toBe(true);
        }
      });
      expect(checkedAny).toBe(true);
    } finally {
      dispose();
    }
  });
});
