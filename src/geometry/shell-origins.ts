/**
 * Moves the origins of the shell's meshes into the rooms they bound, without
 * moving a single vertex in the world.
 *
 * The shell builder writes walls, floors, ceilings, skirtings and joints in
 * WORLD coordinates with the mesh at the origin. three picks the light-probe
 * grid that lights a mesh by the mesh's world origin (walk and tour room
 * lighting, `render/walk-lighting/`), so a zero origin would light every one of
 * them from whichever grid holds the point (0, 0, 0). This pass gives each mesh
 * an origin inside its own room: a wall face and its skirting 0.2 m in front of
 * the face's centre (a facade face 0.2 m outside it), a floor 0.1 m above the
 * floor and a ceiling 0.1 m below the ceiling at an interior point of the room,
 * a joint at the centre of its core. A door's frame parts, centred on the wall
 * centreline, move a few centimetres towards the side the leaf opens into.
 *
 * Invariants:
 * - world-space vertices and UVs are unchanged: the geometry is translated by
 *   exactly the opposite of the origin's move, so raycasts, exports, the sun's
 *   shadow fit and the selection glow (all through `matrixWorld`) see the
 *   same surfaces;
 * - the site slab and the ground keep their positions; a parametric wall part
 *   keeps its `position.y`, which the dollhouse owns (`dollhouse.ts`);
 * - the pass is idempotent and runs in every mode, so a material's program
 *   never depends on the mode; it runs after the shell is built and after an
 *   opening is rebuilt (`scene-builder.ts`).
 */

import * as THREE from 'three';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { Vec2 } from '../scene/types.js';

/** How far an origin sits from its surface, metres. */
export const SHELL_ORIGIN_OFFSET_M = Object.freeze({ wall: 0.2, floor: 0.1, ceiling: 0.1 });
/** How far a door frame part's origin moves off the centreline towards the leaf's side, metres. */
export const FRAME_SHIFT_M = 0.05;
/** Grid step of the interior point search, metres. */
const SEARCH_STEP_M = 0.1;

const scratch = new THREE.Vector3();
const inverse = new THREE.Quaternion();

/**
 * Moves `mesh`'s origin by `delta` (in its parent's frame) and its geometry by
 * the opposite, so its vertices stay where they were in the world.
 */
function shiftOrigin(mesh: THREE.Mesh, delta: THREE.Vector3): void {
  if (delta.lengthSq() === 0) return;
  inverse.copy(mesh.quaternion).invert();
  scratch.copy(delta).applyQuaternion(inverse).divide(mesh.scale);
  mesh.geometry.translate(-scratch.x, -scratch.y, -scratch.z);
  mesh.position.add(delta);
}

/** Moves a world-space mesh (parent at the identity) so its origin is `target`. */
function originTo(mesh: THREE.Mesh, target: THREE.Vector3): void {
  const delta = target.clone().sub(mesh.position);
  // Below a micrometre the origin is already there: float noise must not move it again.
  if (delta.lengthSq() < 1e-12) return;
  shiftOrigin(mesh, delta);
}

/** The world-space centre of `mesh`'s geometry bounds. */
function centreOf(mesh: THREE.Mesh): THREE.Vector3 {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).add(mesh.position);
}

function insidePolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** A point inside `polygon`: the middle of its bounds when that is inside, else the inside grid point nearest to it. */
function interiorPoint(polygon: readonly Vec2[]): Vec2 {
  const xs = polygon.map((p) => p.x);
  const zs = polygon.map((p) => p.z);
  const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  if (insidePolygon(middle, polygon)) return middle;
  let best: { point: Vec2; distance: number } | null = null;
  for (let x = Math.min(...xs) + SEARCH_STEP_M / 2; x < Math.max(...xs); x += SEARCH_STEP_M) {
    for (let z = Math.min(...zs) + SEARCH_STEP_M / 2; z < Math.max(...zs); z += SEARCH_STEP_M) {
      const distance = Math.hypot(x - middle.x, z - middle.z);
      if (insidePolygon({ x, z }, polygon) && (!best || distance < best.distance)) best = { point: { x, z }, distance };
    }
  }
  return best?.point ?? middle;
}

/** The world direction from a face towards its room (or out of the building for a facade face). */
function frontOf(userData: Record<string, unknown>): THREE.Vector3 {
  const outward = userData['outwardNormal'] as { x: number; z: number };
  const sign = userData['isExteriorWall'] === true ? 1 : -1;
  return new THREE.Vector3(sign * outward.x, 0, sign * outward.z);
}

/**
 * Rebases every shell mesh under `shell` (built by `shell-builder.ts` and
 * `opening-builder.ts`) as the module header describes.
 */
export function rebaseShellOrigins(shell: THREE.Object3D, plan: SolvedPlan, ceilingHeight: number): void {
  const polygons = new Map(plan.rooms.map((room) => [room.roomId, room.polygon]));
  const faceFronts = new Map<string, THREE.Vector3>();
  const items: THREE.Mesh[] = [];
  shell.traverse((object) => {
    if (object instanceof THREE.Mesh) items.push(object);
  });
  for (const mesh of items) {
    const data = mesh.userData;
    if (data['surface'] === 'wall') {
      const front = frontOf(data);
      faceFronts.set(JSON.stringify(data['face']), front);
      originTo(mesh, centreOf(mesh).addScaledVector(front, SHELL_ORIGIN_OFFSET_M.wall));
    } else if (data['surface'] === 'floor' || data['isCeiling'] === true) {
      const polygon = polygons.get(data['roomId'] as string);
      if (!polygon) continue;
      const point = interiorPoint(polygon);
      const floor = data['surface'] === 'floor';
      const y = floor ? SHELL_ORIGIN_OFFSET_M.floor : ceilingHeight - SHELL_ORIGIN_OFFSET_M.ceiling;
      originTo(mesh, new THREE.Vector3(point.x, y, point.z));
    } else if (data['wallJoint'] === true) {
      originTo(mesh, centreOf(mesh));
    }
  }
  // Skirtings after their faces: a board faces the way its face does.
  for (const mesh of items) {
    if (mesh.name !== 'wall-face-skirting') continue;
    const front = faceFronts.get(JSON.stringify(mesh.userData['face']));
    if (front) originTo(mesh, centreOf(mesh).addScaledVector(front, SHELL_ORIGIN_OFFSET_M.wall));
  }
  shell.traverse((object) => {
    if (object.children.some((child) => child.userData['isDoorLeaf'] === true)) rebaseOpeningFrames(object);
  });
}

/**
 * Moves the frame parts of one interior door group `FRAME_SHIFT_M` off the
 * wall centreline, along the group's local `z`, towards the side its leaf
 * opens into; a door on an exterior wall and an opening without a leaf are
 * left alone. Idempotent: a part remembers that it moved.
 */
export function rebaseOpeningFrames(group: THREE.Object3D): void {
  const leaf = group.children.find((child) => child.userData['isDoorLeaf'] === true);
  if (!leaf || leaf.userData['isExteriorWall'] === true) return;
  const openSign = leaf.userData['openSign'] as number;
  for (const part of group.children) {
    if (!(part instanceof THREE.Mesh) || part.userData['isParametricWall'] !== true) continue;
    if (part.userData['originShifted'] === true) continue;
    shiftOrigin(part, new THREE.Vector3(0, 0, openSign * FRAME_SHIFT_M));
    part.userData['originShifted'] = true;
  }
}
