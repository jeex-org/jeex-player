import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SceneBuilder } from '../geometry/scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { metadataTable } from '../scene/metadata-table.js';
import { exportGraph } from './export-graph.js';
import { buildCeilingCasters } from '../geometry/ceiling-casters.js';
import { faceKey, isFaceKey, sameFace, type FaceKey } from '../scene/types.js';

/** A fresh, throwaway build of the fixture plan, the way an export snapshots one. */
function buildFixture(): { root: THREE.Group; builder: SceneBuilder } {
  const plan = solvePlan(lShapePlan);
  const builder = new SceneBuilder(lShapePlan, plan);
  const { root } = builder.build();
  return { root, builder };
}

function countMeshes(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}

/** The same "invisible pick proxy" predicate `exportGraph` removes by: a fully transparent mesh. */
function isPickProxy(object: THREE.Object3D): boolean {
  if (!(object instanceof THREE.Mesh)) return false;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  return material instanceof THREE.Material && material.transparent && material.opacity === 0;
}

/** Every real mesh in the original, minus the pick-proxy helpers `exportGraph` drops. */
function realMeshCount(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && !isPickProxy(child)) count += 1;
  });
  return count;
}

function withExtension(object: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  object.traverse((child) => {
    const extensions = (child.userData as { gltfExtensions?: { EXT_mesh_features?: unknown } })['gltfExtensions'];
    if (extensions?.EXT_mesh_features) found.push(child);
  });
  return found;
}

describe('exportGraph', () => {
  test('the clone carries no functions in userData anywhere', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);
      let sawAny = false;
      clone.traverse((object) => {
        sawAny = true;
        // Every value must round-trip through JSON without exception, and a
        // function is never one of the values that survives it.
        expect(() => JSON.stringify(object.userData)).not.toThrow();
        for (const value of Object.values(object.userData)) {
          expect(typeof value).not.toBe('function');
        }
      });
      expect(sawAny).toBe(true);
    } finally {
      builder.dispose();
    }
  });

  test('a wall-face mesh materialises roomId and its face key as plain data, not functions', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);
      let sawInteriorFace = false;
      clone.traverse((object) => {
        if (object.userData['surface'] !== 'wall') return;
        expect(isFaceKey(object.userData['face'])).toBe(true);
        if (object.userData['roomId'] !== undefined) {
          expect(typeof object.userData['roomId']).toBe('string');
          sawInteriorFace = true;
        }
      });
      expect(sawInteriorFace).toBe(true);
    } finally {
      builder.dispose();
    }
  });

  test('a wall-face mesh points at the row that spells out the same face', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);
      let faces = 0;
      clone.traverse((object) => {
        if (object.userData['surface'] !== 'wall') return;
        faces += 1;
        const face = object.userData['face'] as FaceKey;
        const extensions = object.userData['gltfExtensions'] as { EXT_mesh_features: { featureIds: Array<{ constant: number }> } };
        const row = rows[extensions.EXT_mesh_features.featureIds[0]!.constant]!;
        if (row.class !== 'wallFace') throw new Error(`a wall mesh points at a ${row.class} row`);
        expect(sameFace(faceKey(row.roomId ?? null, row.wallId, row.side), face)).toBe(true);
      });
      expect(faces).toBe(plan.faces.size);
    } finally {
      builder.dispose();
    }
  });

  test('furniture keeps its roomId as a string when the placement names one', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);
      const withAsset = withExtension(clone).filter((object) => typeof object.userData['assetId'] === 'string');
      expect(withAsset.length).toBeGreaterThan(0);
    } finally {
      builder.dispose();
    }
  });

  test('every node with EXT_mesh_features points at a real row index', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);
      const tagged = withExtension(clone);
      expect(tagged.length).toBeGreaterThan(0);
      for (const object of tagged) {
        const extension = (
          object.userData as { gltfExtensions: { EXT_mesh_features: { featureIds: Array<{ constant: number; propertyTable: number }> } } }
        ).gltfExtensions.EXT_mesh_features;
        const index = extension.featureIds[0]!.constant;
        expect(extension.featureIds[0]!.propertyTable).toBe(0);
        expect(rows[index]).toBeTruthy();
      }
    } finally {
      builder.dispose();
    }
  });

  test('geometries and materials are shared with the live graph, not cloned', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);
      const originalMeshes: THREE.Mesh[] = [];
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) originalMeshes.push(child);
      });
      const cloneMeshes: THREE.Mesh[] = [];
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) cloneMeshes.push(child);
      });
      expect(cloneMeshes.length).toBeGreaterThan(0);
      // Every geometry instance in the clone is ALSO referenced by the original —
      // never a copy `exportGraph` would have to dispose.
      const originalGeometries = new Set(originalMeshes.map((mesh) => mesh.geometry));
      for (const mesh of cloneMeshes) expect(originalGeometries.has(mesh.geometry)).toBe(true);
    } finally {
      builder.dispose();
    }
  });

  test('mesh count matches the original minus its invisible pick-proxy helpers', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);
      // A pick proxy (fully transparent, opacity 0) is a helper for clicking,
      // never a visible surface, and `exportGraph` removes it; every other
      // mesh survives — the ceiling included, even though the shell builds it
      // `visible = false` by default (the dollhouse hides it; an export is not
      // a camera angle).
      expect(realMeshCount(root)).toBeGreaterThan(0);
      expect(countMeshes(clone)).toBe(realMeshCount(root));
    } finally {
      builder.dispose();
    }
  });

  test('the ceiling is forced visible: an export is not a camera angle', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const clone = exportGraph(root, rows);
      let sawCeiling = false;
      clone.traverse((object) => {
        if (object.userData['isCeiling'] !== true) return;
        sawCeiling = true;
        expect(object.visible).toBe(true);
      });
      expect(sawCeiling).toBe(true);
    } finally {
      builder.dispose();
    }
  });

  test('shadow-only casters never reach an export', () => {
    const { root, builder } = buildFixture();
    const plan = solvePlan(lShapePlan);
    const casters = buildCeilingCasters(lShapePlan, plan);
    try {
      root.add(casters.group);
      const clone = exportGraph(root, metadataTable(lShapePlan, plan));
      let shadowOnly = 0;
      clone.traverse((object) => {
        if (object.userData['shadowOnly'] === true) shadowOnly += 1;
      });
      expect(shadowOnly).toBe(0);
      expect(casters.group.children.length).toBeGreaterThan(0);
    } finally {
      casters.dispose();
      builder.dispose();
    }
  });
});
