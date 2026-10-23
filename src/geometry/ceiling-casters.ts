/**
 * Closed slabs that make the ceilings block the sun in every shell state.
 *
 * The visible ceiling is a zero-thickness cap the shell builder makes for the
 * eye, hidden in the dollhouse and owned by that builder. As a caster such a
 * cap would leak light at grazing angles and depend on face culling, so this
 * module builds separate casters from the same solved room polygons: per room
 * with a ceiling (a loggia has none), a closed prism whose bottom is the
 * ceiling height, `CEILING_CASTER_THICKNESS_M` thick, its outline grown by
 * `CEILING_CASTER_OVERLAP_M` so it overlaps the wall tops and no slit of light
 * runs along a wall.
 *
 * Invariants: the slabs cast and never receive; they live on
 * `SHADOW_ONLY_LAYER` alone, so no camera ever draws them and no raycaster
 * picks them (the shadow pass sees them through `render/shadow-layer-pass.ts`);
 * the material is shared by every slab of one build and owned here, and
 * `dispose` releases the geometries and the material exactly once.
 */

import * as THREE from 'three';
import { SHADOW_ONLY_LAYER } from '../shared/render-layers.js';
import { effectiveRoom, type SceneData, type Vec2 } from '../scene/types.js';
import type { SolvedPlan } from '../plan/plan-solver.js';

/** Thickness of a ceiling slab, metres. */
export const CEILING_CASTER_THICKNESS_M = 0.1;
/** How far a slab's outline reaches past the room outline over the wall tops, metres. */
export const CEILING_CASTER_OVERLAP_M = 0.002;
/** Longest miter of a grown corner, in multiples of the overlap. */
const MITER_LIMIT = 4;
/** Name of the group the slabs hang in. */
export const CEILING_CASTERS_NAME = 'ceiling-casters';

/** The slabs of one build and their release. */
export type CeilingCasters = {
  readonly group: THREE.Group;
  dispose(): void;
};

/** Signed area of a plan polygon in the (x, z) plane. */
function signedArea(polygon: readonly Vec2[]): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

/**
 * `polygon` grown outwards by `distance`: every edge moved along its outward
 * normal and the corners mitred, the miter capped at `MITER_LIMIT` times the
 * distance so a needle corner cannot throw a spike.
 */
function grownOutline(polygon: readonly Vec2[], distance: number): Vec2[] {
  const sign = signedArea(polygon) >= 0 ? 1 : -1;
  const count = polygon.length;
  const outward = (from: Vec2, to: Vec2): Vec2 => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    // For a positive area the left normal (-dz, dx) points inside.
    return { x: (sign * dz) / length, z: (-sign * dx) / length };
  };
  return polygon.map((point, index) => {
    const before = outward(polygon[(index - 1 + count) % count]!, point);
    const after = outward(point, polygon[(index + 1) % count]!);
    const mx = before.x + after.x;
    const mz = before.z + after.z;
    const length = Math.hypot(mx, mz);
    if (length < 1e-9) return { x: point.x + before.x * distance, z: point.z + before.z * distance };
    const ux = mx / length;
    const uz = mz / length;
    const reach = Math.min(distance / Math.max(1e-9, ux * before.x + uz * before.z), distance * MITER_LIMIT);
    return { x: point.x + ux * reach, z: point.z + uz * reach };
  });
}

/** A closed prism over `outline` from `bottom` to `bottom + thickness`. */
function slabGeometry(outline: readonly Vec2[], bottom: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map((point) => new THREE.Vector2(point.x, point.z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  // Shape (x, y) with depth along +z becomes world (x, -depth, y): the
  // rotation is proper, so the faces keep pointing out of the solid.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, bottom + thickness, 0);
  return geometry;
}

/** The slabs for the rooms of `plan` that have a ceiling, in a group of their own. */
export function buildCeilingCasters(scene: Pick<SceneData, 'rooms' | 'ceilingHeight'>, plan: Pick<SolvedPlan, 'rooms'>): CeilingCasters {
  const group = new THREE.Group();
  group.name = CEILING_CASTERS_NAME;
  group.layers.set(SHADOW_ONLY_LAYER);
  group.userData['shadowOnly'] = true;
  // Never drawn (no camera draws the shadow-only layer); the shadow pass reads
  // only its side and visibility, through three's own depth material.
  const material = new THREE.MeshBasicMaterial();
  const rooms = new Map(scene.rooms.map((room) => [room.id, room]));
  for (const face of plan.rooms) {
    const room = rooms.get(face.roomId);
    if (!room || effectiveRoom(room).kind === 'loggia' || face.polygon.length < 3) continue;
    const mesh = new THREE.Mesh(
      slabGeometry(grownOutline(face.polygon, CEILING_CASTER_OVERLAP_M), scene.ceilingHeight, CEILING_CASTER_THICKNESS_M),
      material,
    );
    mesh.name = `ceiling-caster-${face.roomId}`;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.layers.set(SHADOW_ONLY_LAYER);
    mesh.userData['shadowOnly'] = true;
    mesh.userData['roomId'] = face.roomId;
    group.add(mesh);
  }
  let released = false;
  return {
    group,
    dispose() {
      if (released) return;
      released = true;
      for (const child of group.children) (child as THREE.Mesh).geometry.dispose();
      material.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
