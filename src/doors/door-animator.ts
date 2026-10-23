/**
 * The Three.js half of door interaction: it puts `DoorStates` on the leaves,
 * once per frame, and nothing else.
 *
 * Invariant: the animator owns a leaf's `rotation.y` (hinged) or its
 * `position` (sliding) and reads how to move it from the leaf's own
 * `userData` contract (`restAngle`, `slide`, `slideBase`, written by
 * `opening-builder.ts`). It never derives a swing, never touches materials or
 * visibility — the dollhouse owns those — and never writes to the document.
 *
 * It is also where the door PROXIMITY AUTOMATION runs: once per frame, in the
 * modes where the eye is at door height, the camera pose decides which
 * rest-closed doors are held open and which are given back to their rest state
 * (`door-state.doorAutomation`). The animator owns no rule of its own — it
 * reads the pose, asks the pure function, and tells the state machine.
 *
 * Rebuild invariant: an opening group is replaced wholesale by a variant swap
 * (`viewer-editor.swapOpening`) and by every plan-level rebuild, and the leaves
 * come back OPEN. `applyAll()` is therefore called after both, so a door the
 * user shut stays shut across a swap.
 */

import * as THREE from 'three';
import type { DoorStates } from './door-state.js';
import { DOOR_AUTO_CLOSE_M, doorAutomation, doorsToAutoOpen, type DoorCentre } from './door-state.js';
import type { Vec3 } from '../scene/types.js';

// Module-level scratch: `doorLeafCentre` runs every frame while
// the HUD is up (`app/door-controller.ts screenPoint`); none of these boxes
// or the centre vector is ever returned by reference — `doorLeafCentre`
// reads `centre` into a plain `Vec3` before returning.
const SCRATCH_LEAF_BOX = new THREE.Box3();
const SCRATCH_MERGED_BOX = new THREE.Box3();
const SCRATCH_CENTRE = new THREE.Vector3();

type DoorAnimatorDeps = {
  states: DoorStates;
  /** The built group of one opening (`SceneBuilder.getOpeningGroup`). */
  group: (openingId: string) => THREE.Object3D | null | undefined;
  /** Every interactive door with its world centre (`SceneBuilder.openingsList`). */
  doors: () => readonly DoorCentre[];
  /** The rendering camera, for the auto-open test; absent before it exists. */
  camera: () => THREE.Camera | undefined;
  /**
   * True while a SCRIPT drives the camera — the tour, or a walk along a
   * mini-map route (`CameraController.walkAlong`). Only consulted when the
   * proximity automation is off: then a closed door on a scripted way opens
   * itself for good, and a walker in manual control opens doors by hand.
   */
  scriptedCamera: () => boolean;
  /**
   * `doors.autoOpen`: a rest-closed door opens as the eye approaches and shuts
   * again as it leaves (`door-state.doorAutomation`). Absent means off, which
   * is the pre-automation behaviour above.
   */
  autoOpen?: () => boolean;
  /**
   * True in the modes where the eye is at door height — walk, tour and scripted
   * travel. The automation measures a PLAN distance, so it must not run under
   * the 360 camera or a plan mode, where the camera hangs metres above a door
   * it is nowhere near.
   */
  walkerCamera?: () => boolean;
};

export class DoorAnimator {
  private readonly deps: DoorAnimatorDeps;
  private readonly forward = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  /** Whether a leaf moved since the last `takeMoved`. */
  private moved = false;

  constructor(deps: DoorAnimatorDeps) {
    this.deps = deps;
  }

  /**
   * One frame: the doors around the eye open or shut themselves, the state
   * machine advances, and only the leaves that moved are touched.
   */
  update(now: number): void {
    if (this.automates()) {
      const { hold, release } = this.pending();
      for (const id of hold) this.deps.states.hold(id, now);
      for (const id of release) this.deps.states.release(id, now);
    } else if (this.deps.autoOpen?.() !== true) {
      this.releaseLatches();
      if (this.deps.scriptedCamera()) this.autoOpen(now);
    }
    for (const id of this.deps.states.update(now)) this.apply(id);
  }

  /**
   * What `update` would do to the doors this frame, without doing it: the
   * debug surface answers with exactly the rule the frame runs, and both lists
   * are empty wherever the automation does not run.
   */
  pending(): { hold: string[]; release: string[] } {
    const camera = this.automates() ? this.deps.camera() : undefined;
    if (!camera) return { hold: [], release: [] };
    camera.getWorldDirection(this.forward);
    camera.getWorldPosition(this.position);
    return doorAutomation(
      this.deps.doors(),
      this.deps.states.list(),
      { x: this.position.x, z: this.position.z },
      { x: this.forward.x, z: this.forward.z },
    );
  }

  /** Whether the proximity automation runs at all right now. */
  private automates(): boolean {
    return this.deps.autoOpen?.() === true && this.deps.walkerCamera?.() !== false;
  }

  /** Pushes every door's state onto its leaves, whatever the leaves show now. */
  applyAll(): void {
    for (const door of this.deps.states.list()) this.apply(door.id);
  }

  /** Puts one door's `t` on its leaves. */
  apply(openingId: string): void {
    const group = this.deps.group(openingId);
    if (!group) return;
    const t = this.deps.states.get(openingId)?.t ?? 1;
    for (const leaf of doorLeavesOf(group)) applyToLeaf(leaf, t);
    this.moved = true;
  }

  /** Whether any leaf was put somewhere since the last call (every frame of a motion and its final pose). */
  takeMoved(): boolean {
    const moved = this.moved;
    this.moved = false;
    return moved;
  }

  /**
   * Latches the eye has LEFT BEHIND, given back to the automation
   * (`DoorStates.rearm`), on the same radius the proximity automation releases
   * on — `doors.autoOpen: false` only, where nothing else ever re-arms a door.
   *
   * Without it a door shut by hand would stay latched for the rest of the
   * session, and since a latch is what `autoOpen` below refuses to touch, the
   * scripted fallback would have nothing left to open. The rule it enforces is
   * the one the automation already has: a decision you walked away from is
   * over; one you are standing at still stands.
   */
  private releaseLatches(): void {
    const latched = this.deps.states.latchedIds();
    if (latched.size === 0) return;
    const camera = this.deps.camera();
    if (!camera) return;
    const position = camera.getWorldPosition(this.position);
    for (const door of this.deps.doors()) {
      if (!latched.has(door.id)) continue;
      if (Math.hypot(door.center.x - position.x, door.center.z - position.z) > DOOR_AUTO_CLOSE_M) {
        this.deps.states.rearm(door.id);
      }
    }
  }

  /**
   * Closed doors the scripted camera is walking up to, opened before it
   * arrives — the pre-automation rule, kept for `doors.autoOpen: false`.
   *
   * A door the user has just LATCHED in front of the camera is not one of
   * them. Re-opening it was the script overruling the person watching it: they
   * shut a door on a running route and the fallback pushed it straight back
   * open. Held instead, the walker waits at the leaf and
   * the route says why it stopped (`camera-controller.advanceTravel`).
   */
  private autoOpen(now: number): void {
    const closed = this.deps.states.closedIds();
    if (closed.size === 0) return;
    const openable = new Set(closed);
    for (const id of this.deps.states.latchedIds()) openable.delete(id);
    if (openable.size === 0) return;
    const camera = this.deps.camera();
    if (!camera) return;
    camera.getWorldDirection(this.forward);
    // `this.position` is the same scratch field `releaseLatches` uses: the two
    // are never in flight at once, so reusing it is safe.
    const position = camera.getWorldPosition(this.position);
    const ids = doorsToAutoOpen(this.deps.doors(), { x: position.x, z: position.z }, { x: this.forward.x, z: this.forward.z }, openable);
    for (const id of ids) this.deps.states.open(id, now);
  }
}

/** Every leaf group under an opening group (one hinged leaf, two for a double). */
export function doorLeavesOf(group: THREE.Object3D): THREE.Object3D[] {
  const leaves: THREE.Object3D[] = [];
  group.traverse((object) => {
    if (object.userData['isDoorLeaf'] === true) leaves.push(object);
  });
  return leaves;
}

/**
 * Places one leaf at `t` (0 shut, 1 fully open) from its own contract.
 *
 * A leaf built before the contract existed carries neither key; it is left
 * exactly where the builder put it rather than being swung by a guess.
 */
export function applyToLeaf(leaf: THREE.Object3D, t: number): void {
  const slide = leaf.userData['slide'] as Vec3 | undefined;
  const base = leaf.userData['slideBase'] as Vec3 | undefined;
  if (slide && base) {
    leaf.position.set(base.x + slide.x * t, base.y + slide.y * t, base.z + slide.z * t);
    return;
  }
  const restAngle = leaf.userData['restAngle'];
  if (typeof restAngle !== 'number') return;
  leaf.rotation.y = restAngle * t;
}

/**
 * World centre of a door's leaves — mid-height, mid-width — which is where the
 * HUD button sits and what `__viewerDebug.doorScreenPoint` projects.
 *
 * The box is taken over the leaf meshes only: the frame stands still while the
 * leaf swings, and a button anchored to the frame would drift off the door.
 */
export function doorLeafCentre(group: THREE.Object3D): Vec3 | null {
  const leaves = doorLeavesOf(group);
  if (leaves.length === 0) return null;
  const box = SCRATCH_MERGED_BOX.makeEmpty();
  let found = false;
  for (const leaf of leaves) {
    leaf.updateWorldMatrix(true, true);
    const leafBox = SCRATCH_LEAF_BOX.setFromObject(leaf);
    if (leafBox.isEmpty()) continue;
    box.union(leafBox);
    found = true;
  }
  if (!found) return null;
  const centre = box.getCenter(SCRATCH_CENTRE);
  return { x: centre.x, y: centre.y, z: centre.z };
}
