/**
 * Pointer picking and the object registries it reads: pickable surfaces,
 * navigable floors and the objects that belong to an exterior wall.
 *
 * Invariant: a pick is decided by `userData` alone — `surface`, `roomId` /
 * `resolveRoomId`, `resolveFace`, `openingId`, `assetId` — never by mesh
 * names or geometry, and an object hidden anywhere up its hierarchy can never
 * swallow a pick.
 */
import * as THREE from 'three';
import { isFaceKey, type FaceKey } from '../scene/types.js';
import { GLOW_GROUP_NAME } from './selection-glow.js';

type SurfaceKind = 'floor' | 'wall' | 'furniture' | 'opening';

export type SurfacePick = {
  surface: SurfaceKind;
  roomId?: string | undefined;
  /** `Opening.id` of the picked window or door (`surface === 'opening'`). */
  openingId?: string | undefined;
  /**
   * Painting unit of the picked wall: its `FaceKey` (`{ room?, wallId, side }`),
   * answered by the mesh's `userData.resolveFace`.
   */
  face?: FaceKey | undefined;
  /**
   * The wall the pick belongs to: the wall itself (`userData.wallId`, written
   * by `shell-builder.ts:352`) or the wall an opening hangs on
   * (`opening-kinds.ts` puts the same key on the group and its children).
   */
  wallId?: string | undefined;
  assetId?: string | undefined;
};

/** `pickSelection`'s answer: what is under the pointer and WHERE the ray met it. */
export type SelectionPick = { pick: SurfacePick; point: THREE.Vector3 };

/** The whole DOM surface the picker needs from its canvas. */
type PickerCanvas = {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
};

/** Answers whether objects carrying `wallId` stand on the facade. */
type ExteriorTest = (wallId: string) => boolean;

/**
 * Depth-first walk that never descends into a selection-aura subtree.
 *
 * The aura meshes live under the object they highlight (`GLOW_GROUP_NAME`) but
 * are not part of it: registering them as pickables would let a click land on
 * the haze, and swapping their material would replace the glow shader. Every
 * traversal that collects furniture or opening meshes goes through here.
 */
function traverseSkippingGlow(root: THREE.Object3D, visit: (object: THREE.Object3D) => void): void {
  if (root.name === GLOW_GROUP_NAME) return;
  visit(root);
  for (const child of root.children) traverseSkippingGlow(child, visit);
}

/** True when the object and every ancestor of it is visible. */
export function visibleThroughHierarchy(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

/**
 * A resolver's answer as an id, or `undefined`. The resolvers are `userData`
 * callbacks, so they may answer `null` (no owner at this face index) or `''`
 * (a face that belongs to the facade rather than a room); both mean "no id".
 */
function nonEmptyId(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export class Picker {
  private readonly canvas: PickerCanvas;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly pickables: THREE.Object3D[] = [];
  private readonly floorMeshes: THREE.Object3D[] = [];
  private readonly exteriorObjects: THREE.Object3D[] = [];

  constructor(canvas: PickerCanvas) {
    this.canvas = canvas;
  }

  /**
   * Registers a freshly built subtree: every object with a `surface`, every
   * navigable floor and — when `isExterior` says so — every object belonging
   * to a facade wall.
   */
  register(root: THREE.Object3D, isExterior?: ExteriorTest): void {
    traverseSkippingGlow(root, (object) => {
      if (object.userData['surface']) this.pickables.push(object);
      if (object.userData['navigable']) this.floorMeshes.push(object);
      if (!isExterior) return;
      const wallId = object.userData['wallId'];
      if (typeof wallId === 'string' && isExterior(wallId)) this.exteriorObjects.push(object);
      // A junction core belongs to several walls at once (`wallIds`). It joins
      // the registry as soon as ONE of them is a facade wall; the dollhouse
      // then decides when it actually goes.
      const wallIds = object.userData['wallIds'];
      if (Array.isArray(wallIds) && wallIds.some((id) => typeof id === 'string' && isExterior(id))) {
        this.exteriorObjects.push(object);
      }
    });
  }

  /**
   * Registers one furniture group, tagging its meshes so a pick can name the
   * asset it belongs to. Returns the meshes it tagged.
   */
  registerFurniture(group: THREE.Object3D, assetId: string): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    traverseSkippingGlow(group, (object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.userData['surface'] = 'furniture';
      object.userData['assetId'] = assetId;
      meshes.push(object);
      this.pickables.push(object);
    });
    return meshes;
  }

  /**
   * Registers a rebuilt opening group. The group itself carries the opening's
   * bookkeeping but no pickable surface, so only its children are pickable.
   */
  registerOpening(group: THREE.Object3D, isExterior: ExteriorTest): void {
    traverseSkippingGlow(group, (object) => {
      if (object.userData['surface'] && object !== group) this.pickables.push(object);
      const wallId = object.userData['wallId'];
      if (typeof wallId === 'string' && isExterior(wallId)) this.exteriorObjects.push(object);
    });
  }

  /** Drops every object of `root` — auras included — from all three registries. */
  unregister(root: THREE.Object3D): void {
    root.traverse((object) => {
      remove(this.pickables, object);
      remove(this.floorMeshes, object);
      remove(this.exteriorObjects, object);
    });
  }

  /** Objects whose visibility the dollhouse view drives, in registration order. */
  exteriors(): readonly THREE.Object3D[] {
    return this.exteriorObjects;
  }

  /** Orbit-mode click: the floor, wall, furniture or opening under the cursor. */
  pickSurface(clientX: number, clientY: number, camera: THREE.Camera): SurfacePick | null {
    const hit = this.hitAt(clientX, clientY, camera);
    return hit ? describePick(hit) : null;
  }

  /**
   * The same pick plus WHERE the ray landed, for a host that needs the plan
   * point of a click (`app/selection.ts`). `pickSurface` keeps its signature:
   * every existing caller asks a different question.
   */
  pickSelection(clientX: number, clientY: number, camera: THREE.Camera): SelectionPick | null {
    const hit = this.hitAt(clientX, clientY, camera);
    return hit ? { pick: describePick(hit), point: hit.point } : null;
  }

  /** The nearest VISIBLE intersection that carries a `surface`, or `undefined`. */
  private hitAt(clientX: number, clientY: number, camera: THREE.Camera): THREE.Intersection | undefined {
    // Hidden objects (dollhouse near-side walls, hidden furniture) must not swallow the pick.
    return this.cast(clientX, clientY, camera, this.pickables, false).find(
      (item) => visibleThroughHierarchy(item.object) && item.object.userData['surface'],
    );
  }

  /** World point under the pointer on a navigable floor, or `null`. */
  floorPoint(clientX: number, clientY: number, camera: THREE.Camera): THREE.Vector3 | null {
    const hit = this.cast(clientX, clientY, camera, this.floorMeshes, true).find((item) => item.object.userData['navigable']);
    return hit ? hit.point : null;
  }

  /**
   * The ray from `camera` through the pointer, for a caller that needs a point
   * on it where no mesh was hit (the 360 zoom's fallback level). The answer is
   * the picker's own scratch ray, valid until the next cast: copy to keep it.
   */
  pointerRay(clientX: number, clientY: number, camera: THREE.Camera): THREE.Ray {
    this.aim(clientX, clientY, camera);
    return this.raycaster.ray;
  }

  private aim(clientX: number, clientY: number, camera: THREE.Camera): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, camera);
  }

  private cast(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    targets: THREE.Object3D[],
    recursive: boolean,
  ): THREE.Intersection[] {
    this.aim(clientX, clientY, camera);
    return this.raycaster.intersectObjects(targets, recursive);
  }
}

function remove(list: THREE.Object3D[], object: THREE.Object3D): void {
  const index = list.indexOf(object);
  if (index >= 0) list.splice(index, 1);
}

/**
 * One intersection as a `SurfacePick`. Free rather than a method: it reads
 * `userData` and nothing of the picker's own state, and both public picks
 * answer through it, so the two can never disagree about what a hit means.
 */
function describePick(hit: THREE.Intersection): SurfacePick {
  const object = hit.object;
  const surface = object.userData['surface'] as SurfaceKind;
  const wallId = typeof object.userData['wallId'] === 'string' ? object.userData['wallId'] : undefined;
  if (surface === 'furniture') {
    return { surface, assetId: typeof object.userData['assetId'] === 'string' ? object.userData['assetId'] : undefined };
  }
  if (surface === 'opening') {
    return {
      surface,
      openingId: typeof object.userData['openingId'] === 'string' ? object.userData['openingId'] : undefined,
      wallId,
    };
  }
  const faceIndex = hit.face ? hit.face.materialIndex : 0;
  let roomId = typeof object.userData['roomId'] === 'string' ? object.userData['roomId'] : undefined;
  if (!roomId && typeof object.userData['resolveRoomId'] === 'function') {
    roomId = nonEmptyId(object.userData['resolveRoomId'](faceIndex));
  }
  let face: FaceKey | undefined;
  if (typeof object.userData['resolveFace'] === 'function') {
    const resolved: unknown = object.userData['resolveFace'](faceIndex);
    if (isFaceKey(resolved)) face = resolved;
  }
  return surface === 'wall' ? { surface, roomId, face, wallId } : { surface, roomId, face };
}
