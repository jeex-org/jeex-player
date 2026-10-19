/**
 * The `selection-anchor` box's position: a scene target resolved to a world
 * point, projected through the camera of the frame about to be drawn, and
 * published as two CSS custom properties.
 *
 * Invariant: the position is delivered by a CSS PROPERTY, not by a 60 Hz event.
 * An `anchor` event through the handle's fan-out was considered and rejected:
 * every frame would cross the host's boundary to say
 * something the stylesheet already applies for free, and a host that wants the
 * numbers reads them back with `anchorPoint()` when it needs them.
 *
 * Second invariant: no walk of the scene graph per frame. The WALK is what is
 * cached — the objects an entity target resolved to, against the document
 * root's identity — and the BOX over those objects is recomputed every frame.
 * The split is deliberate: a commit that changes the plan hands out a fresh
 * root (`geometry/scene-builder.ts`), but a commit that only moves or re-dresses
 * one thing does NOT. `viewer-editor.swapFurniture` adds the new group under
 * the same root, and `scene-builder.upgradeOne` swaps a placement's body for a
 * loaded GLB in place, so a cached world POINT would go stale and stay stale.
 * Recomputing the box costs one union over the handful of objects the entity
 * actually is; walking the whole document sixty times a second is what is
 * forbidden. A matched object that has left the graph (the old half of a
 * variant swap) invalidates the walk, and a POINT target is not cached at all,
 * because there is nothing to walk.
 *
 * Known limit: a target the walk did NOT find stays not-found until the root or
 * the target changes. An entity that appears under an unchanged root would need
 * a walk per frame to notice, which is the cost this module exists to avoid.
 *
 * It knows nothing about the DOM or about `ViewerApp`: the sink is a function
 * and the scene arrives as an argument, which is what lets every case above be
 * proved under Bun.
 */

import * as THREE from 'three';
import { highlightMatches } from '../render/selection-highlight.js';
import { projectToViewport } from '../render/viewport-projection.js';
import type { HostSlots } from '../ui/host-slots.js';
import type { AnchorPoint, AnchorTarget, ViewerSlots } from './viewer-handle.js';

/** Reused rather than allocated: `update` runs once a frame. */
const SCRATCH_POINT = new THREE.Vector3();
const SCRATCH_BOX = new THREE.Box3();

/** What one frame tells the anchor about the scene it is drawn against. */
export type AnchorScene = {
  camera: THREE.Camera;
  /** The DOCUMENT root, not the renderer's scene: it is what a commit replaces. */
  root: THREE.Object3D | undefined;
  viewport: { width: number; height: number };
};

/** Whether a target names a place in the world rather than a thing in the document. */
function isPoint(target: AnchorTarget): target is { x: number; y: number; z: number } {
  return !('kind' in target);
}

/**
 * Every object under `root` that belongs to `target` — THE walk, and the only
 * one this module does.
 *
 * `highlightMatches` is the same predicate `setSelection`'s tint uses, so the
 * anchor and the highlight can never disagree about what a wall is.
 */
function matchesUnder(root: THREE.Object3D, target: Exclude<AnchorTarget, { x: number }>): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (highlightMatches(object, target)) found.push(object);
  });
  return found;
}

/**
 * The centre of the union of `objects`' boxes, written into `out`; `null` when
 * they enclose nothing at all.
 */
function centreOf(objects: readonly THREE.Object3D[], out: THREE.Vector3): THREE.Vector3 | null {
  SCRATCH_BOX.makeEmpty();
  for (const object of objects) SCRATCH_BOX.expandByObject(object);
  if (SCRATCH_BOX.isEmpty()) return null;
  return SCRATCH_BOX.getCenter(out);
}

/** An object still in the graph it was found in; the old half of a swap is not. */
function attached(object: THREE.Object3D): boolean {
  return object.parent !== null;
}

export class SlotAnchor {
  private readonly publish: (point: AnchorPoint | null) => void;
  private current: AnchorTarget | null = null;
  /** The last position computed, which is also what `anchorPoint()` answers. */
  private last: AnchorPoint | null = null;
  /** What the sink was last told, so an unchanged frame costs nothing. */
  private published: AnchorPoint | null | undefined;
  /** The root the current target was resolved against, and what came out of it. */
  private walkedRoot: THREE.Object3D | undefined;
  private walkedObjects: readonly THREE.Object3D[] = [];
  /** The entity centre, recomputed each frame INTO this vector — never the point scratch. */
  private readonly walkedCentre = new THREE.Vector3();

  constructor(publish: (point: AnchorPoint | null) => void) {
    this.publish = publish;
  }

  /** What to follow from now on; `null` parks the box. */
  target(next: AnchorTarget | null): void {
    this.current = next;
    // A new target is a new question: whatever was walked answers the old one.
    this.walkedRoot = undefined;
    this.walkedObjects = [];
    if (!next) this.park();
  }

  /** The last published position, or `null` while parked. */
  point(): AnchorPoint | null {
    return this.last;
  }

  /**
   * Whether there is anything to project at all.
   *
   * The frame hook asks before MEASURING the viewport: `clientWidth` is a
   * layout read, and a mount that never named the anchor slot must not pay for
   * one sixty times a second.
   */
  hasTarget(): boolean {
    return this.current !== null;
  }

  /** One frame: resolve, project, publish. `null` when there is no stage yet. */
  update(scene: AnchorScene | null): void {
    const target = this.current;
    if (!target) {
      this.park();
      return;
    }
    if (!scene) return;
    const world = this.worldPointOf(target, scene.root);
    // Nothing to project: the target is not in this document. Silent, the same
    // way `setSelection` is silent about a target it cannot find.
    if (!world) {
      this.publishAt(this.last?.x ?? 0, this.last?.y ?? 0, false);
      return;
    }
    // Frame hooks run BEFORE `renderer.render()` (`render-runtime.ts`), and
    // three.js refreshes the camera's world matrix inside `render`. Without
    // this the projection would be one frame behind the pose this hook's own
    // contract promises — `viewer-debug.ts` refreshes it before its own
    // `projectToViewport` for exactly this reason. Camera only, not the scene.
    scene.camera.updateMatrixWorld();
    const projected = projectToViewport(scene.camera, world, scene.viewport);
    // Behind the camera: keep the last numbers and hide the box.
    if (!projected) {
      this.publishAt(this.last?.x ?? 0, this.last?.y ?? 0, false);
      return;
    }
    const inside = projected.x >= 0 && projected.x <= scene.viewport.width && projected.y >= 0 && projected.y <= scene.viewport.height;
    this.publishAt(projected.x, projected.y, inside);
  }

  private worldPointOf(target: AnchorTarget, root: THREE.Object3D | undefined): THREE.Vector3 | null {
    if (isPoint(target)) return SCRATCH_POINT.set(target.x, target.y, target.z);
    if (!root) return null;
    // Walk again only when the document root changed, or when something the
    // last walk found has left the graph (a variant swap retires the old
    // group). Otherwise the cached objects are still the entity, and only
    // their BOX has to be recomputed — they may have moved or been re-dressed.
    if (this.walkedRoot !== root || !this.walkedObjects.every(attached)) {
      this.walkedRoot = root;
      this.walkedObjects = matchesUnder(root, target);
    }
    if (this.walkedObjects.length === 0) return null;
    return centreOf(this.walkedObjects, this.walkedCentre);
  }

  private park(): void {
    this.last = null;
    if (this.published === null) return;
    this.published = null;
    this.publish(null);
  }

  private publishAt(x: number, y: number, visible: boolean): void {
    // A degenerate camera projects to NaN. The sink parks a non-finite point
    // itself, but `anchorPoint()` is a READ a host does arithmetic on, and the
    // dedupe below never matches NaN — so it would be republished every frame.
    const finite = Number.isFinite(x) && Number.isFinite(y);
    const next: AnchorPoint = finite ? { x, y, visible } : { x: this.last?.x ?? 0, y: this.last?.y ?? 0, visible: false };
    this.last = next;
    const previous = this.published;
    if (previous && previous.x === next.x && previous.y === next.y && previous.visible === next.visible) return;
    this.published = next;
    this.publish(next);
  }
}

/** The public `ViewerSlots` object: the boxes from `ui`, the anchor from here. */
export function viewerSlots(slots: HostSlots, anchor: SlotAnchor): ViewerSlots {
  return {
    get: (name) => slots.get(name),
    anchorTo: (target) => anchor.target(target),
    anchorPoint: () => anchor.point(),
  };
}
