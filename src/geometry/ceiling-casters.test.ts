/**
 * The closed ceiling slabs that block the sun: one per room that has a
 * ceiling, closed, 100 mm thick on top of the ceiling height, grown 2 mm past
 * the room outline, casting from the shadow-only layer alone.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { draftOf } from '../shared/committed.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { solvePlan } from '../plan/plan-solver.js';
import { SHADOW_ONLY_LAYER } from '../shared/render-layers.js';
import { buildCeilingCasters, CEILING_CASTER_OVERLAP_M, CEILING_CASTER_THICKNESS_M } from './ceiling-casters.js';
import type { SceneData } from '../scene/types.js';

function meshesOf(group: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

/** Edge -> how many triangles use it, over the geometry welded by position. */
function edgeUse(geometry: THREE.BufferGeometry): Map<string, number> {
  const bare = new THREE.BufferGeometry();
  bare.setAttribute('position', geometry.getAttribute('position'));
  if (geometry.index) bare.setIndex(geometry.index);
  const welded = mergeVertices(bare, 1e-6);
  const index = welded.index!;
  const uses = new Map<string, number>();
  for (let at = 0; at < index.count; at += 3) {
    const corners = [index.getX(at), index.getX(at + 1), index.getX(at + 2)];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = corners[edge]!;
      const b = corners[(edge + 1) % 3]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return uses;
}

describe('buildCeilingCasters', () => {
  const plan = solvePlan(lShapePlan);

  test('one slab per room, each closed, between the ceiling height and 100 mm above it', () => {
    const casters = buildCeilingCasters(lShapePlan, plan);
    const meshes = meshesOf(casters.group);
    expect(meshes.length).toBe(lShapePlan.rooms.length);
    for (const mesh of meshes) {
      const uses = edgeUse(mesh.geometry);
      expect([...uses.values()].every((count) => count === 2)).toBe(true);
      const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute);
      expect(box.min.y).toBeCloseTo(lShapePlan.ceilingHeight, 5);
      expect(box.max.y).toBeCloseTo(lShapePlan.ceilingHeight + CEILING_CASTER_THICKNESS_M, 5);
    }
    casters.dispose();
  });

  test('the outline is the room polygon grown by the wall-top overlap', () => {
    const casters = buildCeilingCasters(lShapePlan, plan);
    for (const room of plan.rooms) {
      const mesh = casters.group.getObjectByName(`ceiling-caster-${room.roomId}`) as THREE.Mesh;
      const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute);
      const xs = room.polygon.map((point) => point.x);
      const zs = room.polygon.map((point) => point.z);
      expect(box.min.x).toBeCloseTo(Math.min(...xs) - CEILING_CASTER_OVERLAP_M, 6);
      expect(box.max.x).toBeCloseTo(Math.max(...xs) + CEILING_CASTER_OVERLAP_M, 6);
      expect(box.min.z).toBeCloseTo(Math.min(...zs) - CEILING_CASTER_OVERLAP_M, 6);
      expect(box.max.z).toBeCloseTo(Math.max(...zs) + CEILING_CASTER_OVERLAP_M, 6);
    }
    casters.dispose();
  });

  test('every slab casts, receives nothing and lives on the shadow-only layer alone', () => {
    const casters = buildCeilingCasters(lShapePlan, plan);
    const only = new THREE.Layers();
    only.set(SHADOW_ONLY_LAYER);
    for (const object of [casters.group, ...meshesOf(casters.group)]) expect(object.layers.mask).toBe(only.mask);
    for (const mesh of meshesOf(casters.group)) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(false);
      expect(mesh.userData['shadowOnly']).toBe(true);
    }
    casters.dispose();
  });

  test('a loggia keeps no ceiling', () => {
    const scene = draftOf(lShapePlan);
    scene.rooms[0]!.kind = 'loggia';
    const loggia: SceneData = scene;
    const casters = buildCeilingCasters(loggia, solvePlan(loggia));
    expect(meshesOf(casters.group).length).toBe(lShapePlan.rooms.length - 1);
    expect(casters.group.getObjectByName(`ceiling-caster-${lShapePlan.rooms[0]!.id}`)).toBeUndefined();
    casters.dispose();
  });

  test('dispose releases every geometry and the shared material, once', () => {
    const casters = buildCeilingCasters(lShapePlan, plan);
    const released = new Set<unknown>();
    const meshes = meshesOf(casters.group);
    for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => released.add(mesh.geometry));
    const material = meshes[0]!.material as THREE.Material;
    let materialDisposals = 0;
    material.addEventListener('dispose', () => {
      materialDisposals += 1;
    });
    casters.dispose();
    casters.dispose();
    expect(released.size).toBe(meshes.length);
    expect(materialDisposals).toBe(1);
    expect(casters.group.children.length).toBe(0);
  });
});
