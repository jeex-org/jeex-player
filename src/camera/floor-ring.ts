/**
 * The walk-mode floor cursor: a flat ring on the floor under the pointer that
 * says «a click takes you here» (like Matterport's circle cursor).
 *
 * The ring is shown only where a click would actually walk: a navigable floor,
 * the nearest thing under the pointer (not a wall or a sofa standing in front
 * of it), and reachable in a straight line from where the walker stands. The
 * decision is `floorRingPoint`, pure; the mesh only follows it.
 *
 * It is a scene citizen the picker never sees: it registers with no registry,
 * carries no `userData.surface`, and answers every raycast with nothing, so a
 * click through it lands on the floor beneath.
 */

import * as THREE from 'three';
import { FLOOR_RING_LAYER } from '../shared/render-layers.js';
import type { SurfacePick } from '../geometry/picker.js';

/** Ring radii and lift off the floor, metres; the lift keeps it out of z-fighting. */
const INNER_M = 0.17;
const OUTER_M = 0.22;
const LIFT_M = 0.012;
const SEGMENTS = 48;
/** Drawn after the room, over nothing: the ring is an affordance, not furniture. */
const RENDER_ORDER = 10;

/** The name the ring carries in the scene graph, for a debugger reading it. */
export const FLOOR_RING_NAME = 'jeex-floor-ring';

/**
 * Where the ring goes, or `null` for hidden: `floor` is the navigable floor
 * point under the pointer, `pick` the nearest visible surface there, and
 * `reachable` whether a straight walk to it is possible right now.
 */
export function floorRingPoint(
  pick: SurfacePick | null,
  floor: THREE.Vector3 | null,
  reachable: (point: THREE.Vector3) => boolean,
): THREE.Vector3 | null {
  if (!floor) return null;
  // A wall, a door leaf or a piece of furniture nearer than the floor hides
  // it: the click would land on that, not walk.
  if (pick && pick.surface !== 'floor') return null;
  return reachable(floor) ? floor : null;
}

export class FloorRing {
  readonly object: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    const geometry = new THREE.RingGeometry(INNER_M, OUTER_M, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = FLOOR_RING_NAME;
    this.object.renderOrder = RENDER_ORDER;
    this.object.visible = false;
    this.object.layers.set(FLOOR_RING_LAYER);
    this.object.raycast = () => undefined;
  }

  /** Puts the ring at `point` on the floor, or hides it for `null`. */
  show(point: THREE.Vector3 | null): void {
    if (!point) {
      this.object.visible = false;
      return;
    }
    this.object.position.set(point.x, point.y + LIFT_M, point.z);
    this.object.visible = true;
  }

  get visible(): boolean {
    return this.object.visible;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
