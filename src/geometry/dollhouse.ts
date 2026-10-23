/**
 * The two ways the apartment can be shown: `dollhouse` (no ceilings, no light
 * fixtures, near facade walls hidden as the camera orbits) and `full` (walk and
 * tour, everything visible).
 *
 * A wall is exterior exactly when the solved plan gives it a facade face; the
 * hide test comes from that face — the mid-point of its polyline plus its
 * outward normal — so no centroid heuristic is needed. Everything
 * carrying the wall's id is hidden together (both faces, skirting, window and
 * door groups), which is what makes the near facade wall disappear completely.
 * A junction core carries `wallIds` instead of one `wallId` and survives until
 * every wall meeting there is hidden, so it stays as the end cap of whichever
 * wall is still standing.
 *
 * Invariant: walls are always full height. The dollhouse never scales a wall,
 * it only hides the ones standing between the camera and the interior.
 *
 * Shadow invariant: a wall is cut away by LAYERS, never by `visible`. Its whole
 * subtree (layers do not inherit) leaves layer 0, so no camera draws it and no
 * raycaster picks it, and joins `SHADOW_ONLY_LAYER`, so it keeps casting the
 * sun's shadow exactly as when it stands (`render/shadow-layer-pass.ts`).
 * Every `castShadow` is left as the builder set it (window panes and glass
 * inserts do not cast). The set of casters is therefore the same in every
 * shell state, and a change of the cutaway never needs the shadow redrawn.
 * The ceiling cap is the one thing still hidden by `visible`: it casts
 * nothing, the closed ceiling slabs do that (`geometry/ceiling-casters.ts`).
 */

import * as THREE from 'three';
import { SHADOW_ONLY_LAYER } from '../shared/render-layers.js';
import { polylineMidpoint } from '../plan/plan-geometry.js';
import type { SolvedPlan } from '../plan/plan-solver.js';

export type ShellState = 'dollhouse' | 'full';

/** The plane test for one exterior wall: a point on it and its outward normal. */
type WallPlane = { cx: number; cz: number; ox: number; oz: number };

/** Objects whose visibility the dollhouse drives, in registration order. */
type ExteriorObjects = () => readonly THREE.Object3D[];

export class Dollhouse {
  private readonly wallPlanes = new Map<string, WallPlane>();
  private readonly exteriors: ExteriorObjects;
  private root: THREE.Object3D | null = null;
  private shellState: ShellState = 'dollhouse';
  private keepExteriors = false;

  constructor(exteriors: ExteriorObjects) {
    this.exteriors = exteriors;
  }

  /** Precomputes the hide test for every exterior wall of a freshly built root. */
  prepare(plan: SolvedPlan, root: THREE.Object3D): void {
    this.wallPlanes.clear();
    this.root = root;
    for (const face of plan.facade) {
      // A wall with facade faces on both sides keeps the first one: either side
      // answers "is the camera outside" the same way for a free-standing wall.
      if (this.wallPlanes.has(face.wallId)) continue;
      const centre = polylineMidpoint(face.polyline);
      if (!centre) continue;
      // A facade face's normal already points outwards (the mesh's `outwardNormal`).
      this.wallPlanes.set(face.wallId, { cx: centre.x, cz: centre.z, ox: face.normal.x, oz: face.normal.z });
    }
  }

  /** Whether objects carrying `wallId` stand on the facade; the `Picker`'s exterior test. */
  isExterior(wallId: string): boolean {
    return this.wallPlanes.has(wallId);
  }

  get state(): ShellState {
    return this.shellState;
  }

  /**
   * Top view: keep every exterior wall standing.
   *
   * Seen from straight above a wall hides nothing, so the dollhouse's "the
   * camera is outside this wall" rule has no work to do — and it would answer
   * arbitrarily for a camera hovering over the middle of the plan. The 3D mode
   * sets this while it owns the render camera.
   */
  setKeepExteriors(keep: boolean, camera?: THREE.Camera): void {
    if (this.keepExteriors === keep) return;
    this.keepExteriors = keep;
    this.update(camera);
  }

  /** Switches the shell state and applies it to the whole scene root. */
  setState(state: ShellState, camera?: THREE.Camera): void {
    this.shellState = state;
    this.root?.traverse((object) => {
      if (object.userData['isCeiling']) object.visible = state === 'full';
      if (object.userData['isLightFixture']) {
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) child.visible = state === 'full';
          else if ((child as THREE.PointLight).isPointLight) child.visible = true;
        });
        return;
      }
      if (object.userData['isDoorLeaf']) {
        object.scale.y = 1;
        object.visible = true;
        return;
      }
      if (object.userData['isParametricWall'] && !object.userData['isExteriorWall']) {
        const wallBottom = object.userData['wallBottom'] as number;
        const wallHeight = object.userData['wallHeight'] as number;
        object.visible = true;
        object.scale.y = 1;
        object.position.y = wallBottom + wallHeight / 2;
      }
    });
    this.update(camera);
  }

  /** Shows far walls, hides only the walls standing between the camera and the interior. */
  update(camera?: THREE.Camera): void {
    const full = this.shellState === 'full' || this.keepExteriors;
    const camX = camera?.position.x ?? 0;
    const camZ = camera?.position.z ?? 0;
    for (const object of this.exteriors()) {
      if (full) {
        setDrawn(object, true);
        continue;
      }
      const wallIds = object.userData['wallIds'];
      if (Array.isArray(wallIds)) {
        // A junction core belongs to every wall meeting there, so it goes only
        // when they ALL go. Hiding it with the first one would take the end cap
        // off the wall that stays and re-open the corner the core just closed.
        setDrawn(
          object,
          wallIds.some((wallId) => !this.hidden(wallId, camX, camZ)),
        );
        continue;
      }
      setDrawn(object, !this.hidden(object.userData['wallId'] as string, camX, camZ));
    }
  }

  /** Whether the camera stands outside `wallId`; `false` for a wall with no facade face. */
  private hidden(wallId: string, camX: number, camZ: number): boolean {
    const plane = this.wallPlanes.get(wallId);
    if (!plane) return false;
    return (camX - plane.cx) * plane.ox + (camZ - plane.cz) * plane.oz > 0.001;
  }
}

/**
 * Puts `object` and every descendant on layer 0 (drawn) or off it (cut away).
 * A cut-away node joins the shadow-only layer and keeps it once drawn again:
 * no camera draws that layer, so it costs nothing, and the shadow pass then
 * sees the node in every state.
 */
function setDrawn(object: THREE.Object3D, drawn: boolean): void {
  // The whole subtree moves together, so the root tells its state: a frame
  // that changes nothing walks nothing.
  if (object.layers.isEnabled(0) === drawn) return;
  object.traverse((node) => {
    if (drawn) {
      node.layers.enable(0);
      return;
    }
    node.layers.enable(SHADOW_ONLY_LAYER);
    node.layers.disable(0);
  });
}
