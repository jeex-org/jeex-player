import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SceneBuilder } from '../geometry/scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { metadataTable } from '../scene/metadata-table.js';
import { exportGraph, exportGraphWithRows } from './export-graph.js';
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

/** The nearest node at or above `object` (in the clone) that names an element, or `null`. */
function owner(object: THREE.Object3D): THREE.Object3D | null {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const data = node.userData as Record<string, unknown>;
    if (
      data['surface'] === 'wall' ||
      data['surface'] === 'floor' ||
      data['isCeiling'] === true ||
      (data['surface'] === 'opening' && typeof data['openingId'] === 'string') ||
      typeof data['assetId'] === 'string'
    )
      return node;
  }
  return null;
}

function meshesOf(object: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  return meshes;
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

  test('no node of the clone carries a glTF extension: feature ids belong on primitives, which the GLB export writes', () => {
    const { root, builder } = buildFixture();
    try {
      const clone = exportGraph(root, metadataTable(lShapePlan, solvePlan(lShapePlan)));
      const tagged: string[] = [];
      clone.traverse((object) => {
        if (object.userData['gltfExtensions'] !== undefined) tagged.push(object.name || object.type);
      });
      expect(tagged).toEqual([]);
    } finally {
      builder.dispose();
    }
  });

  test('a wall-face mesh maps to the row that spells out the same face', () => {
    const { root, builder } = buildFixture();
    try {
      const plan = solvePlan(lShapePlan);
      const rows = metadataTable(lShapePlan, plan);
      const { graph, meshRows } = exportGraphWithRows(root, rows);
      let faces = 0;
      for (const mesh of meshesOf(graph)) {
        if (mesh.userData['surface'] !== 'wall') continue;
        faces += 1;
        const row = rows[meshRows.get(mesh) ?? -1];
        if (row?.class !== 'wallFace') throw new Error(`a wall mesh maps to ${row?.class ?? 'no'} row`);
        expect(sameFace(faceKey(row.roomId ?? null, row.wallId, row.side), mesh.userData['face'] as FaceKey)).toBe(true);
      }
      expect(faces).toBe(plan.faces.size);
    } finally {
      builder.dispose();
    }
  });

  test('floor and ceiling meshes map to the row of their room', () => {
    const { root, builder } = buildFixture();
    try {
      const rows = metadataTable(lShapePlan, solvePlan(lShapePlan));
      const { graph, meshRows } = exportGraphWithRows(root, rows);
      const seen = { floor: 0, ceiling: 0 };
      for (const mesh of meshesOf(graph)) {
        const kind = mesh.userData['surface'] === 'floor' ? 'floor' : mesh.userData['isCeiling'] === true ? 'ceiling' : null;
        if (!kind) continue;
        seen[kind] += 1;
        const row = rows[meshRows.get(mesh) ?? -1];
        expect({ kind, class: row?.class, id: row?.class === 'wallFace' ? undefined : row?.id }).toEqual({
          kind,
          class: 'room',
          id: mesh.userData['roomId'],
        });
      }
      expect(seen.floor).toBeGreaterThan(0);
      expect(seen.ceiling).toBeGreaterThan(0);
    } finally {
      builder.dispose();
    }
  });

  test('every mesh inside an opening or a furniture placement maps to that element, through its group', () => {
    const { root, builder } = buildFixture();
    try {
      const rows = metadataTable(lShapePlan, solvePlan(lShapePlan));
      const { graph, meshRows } = exportGraphWithRows(root, rows);
      const seen = { opening: 0, furniture: 0 };
      for (const mesh of meshesOf(graph)) {
        const group = owner(mesh);
        if (!group || group === mesh) continue;
        const data = group.userData as Record<string, unknown>;
        const expected: { class: 'opening' | 'furniture'; id: unknown } | null =
          data['surface'] === 'opening'
            ? { class: 'opening', id: data['openingId'] }
            : typeof data['assetId'] === 'string'
              ? { class: 'furniture', id: data['assetId'] }
              : null;
        if (!expected) continue;
        seen[expected.class] += 1;
        const row = rows[meshRows.get(mesh) ?? -1];
        const actual: { class: unknown; id: unknown } = { class: row?.class, id: row?.class === 'wallFace' ? undefined : row?.id };
        expect(actual).toEqual(expected);
      }
      expect(seen.opening).toBeGreaterThan(0);
      expect(seen.furniture).toBeGreaterThan(0);
    } finally {
      builder.dispose();
    }
  });

  test('every mapped mesh is in the graph, and every row but a wall row is reached by a mesh', () => {
    const { root, builder } = buildFixture();
    try {
      const rows = metadataTable(lShapePlan, solvePlan(lShapePlan));
      const { graph, meshRows } = exportGraphWithRows(root, rows);
      const inGraph = new Set(meshesOf(graph));
      for (const mesh of meshRows.keys()) expect(inGraph.has(mesh)).toBe(true);
      const reached = new Set(meshRows.values());
      const unreached = rows.flatMap((row, index) => (row.class !== 'wall' && !reached.has(index) ? [`${index} ${row.class}`] : []));
      expect(unreached).toEqual([]);
      for (const mesh of inGraph) if (owner(mesh) === null) expect(meshRows.has(mesh)).toBe(false);
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
