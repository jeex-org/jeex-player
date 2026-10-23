/**
 * The sun over one built apartment root: its direction from the scene's site,
 * its shadow frustum fitted to what casts and receives, and the cached shadow
 * map kept honest.
 *
 * `prepareSunShadow` is the one preparation every root gets, the live view's
 * (`app/scene-mount.ts`) and every offscreen capture's
 * (`app/capture-commands.ts`): it adds the closed ceiling slabs beside the
 * shell (`geometry/ceiling-casters.ts`), aims the rig's sun and fits its
 * frustum. The cut-away walls are the dollhouse's to move between layers; the
 * casters are the same in every shell state, so nothing here hears of it.
 *
 * Bounds are the world boxes of every mesh under the root that casts or
 * receives and is seen, plus the swept space of every door leaf (a box around
 * the leaf grown by its own width), minus the site ground disk, which would
 * otherwise spend the map on a field. The building's shadow on that disk is
 * kept: the casters' footprint on the ground plane, every caster corner
 * carried along the light down to the ground's height and clamped to the
 * disk (`groundFootprint`), is one more box of the fit, so a low sun's long
 * shadow stays in the map while the disk itself never widens it. They are
 * read when asked (`refit`), not per frame.
 *
 * Dirtiness invariant: the map is redrawn exactly when something it shows may
 * have changed. `refit` changes the frustum when the fit changed and otherwise
 * marks the map dirty only when the casters' signature (geometry, world matrix
 * and visibility of every included mesh) changed, so a paint-only revision
 * redraws nothing. `include` (a drag, a furniture animation frame) always marks
 * dirty and grows the frustum only when the object left it; `endPreview` fits
 * the apartment again. `markDirty` is for motion inside the fit (doors, whose
 * sweep is reserved).
 */

import * as THREE from 'three';
import { buildCeilingCasters, type CeilingCasters } from '../geometry/ceiling-casters.js';
import { fitShadowFrustum, type ShadowBox, type ShadowFit } from '../lighting/shadow-fit.js';
import { sunDirection, type SunDirection } from '../lighting/sun-direction.js';
import type { ApartmentRig } from '../lighting/lighting-context.js';
import type { Triple } from '../lighting/lighting-standard.js';
import type { SceneData, SceneSite } from '../scene/types.js';
import type { SolvedPlan } from '../plan/plan-solver.js';

/** Names of meshes that never widen the fit: the ground disk around the site. */
const EXCLUDED_NAMES: ReadonlySet<string> = new Set(['site-ground']);

/** What the debug surface reads of the sun. */
export type SunShadowState = {
  readonly direction: Triple;
  readonly azimuth: number;
  readonly elevation: number;
  readonly fit: ShadowFit | null;
  readonly draws: number;
};

/** The sun of one root. */
export type SunShadow = {
  /** Re-reads the bounds after a structural change; redraws only what changed. */
  refit(): void;
  /** A pose or visibility changed inside the fit. */
  markDirty(): void;
  /**
   * `object` moves: redraw, and grow the frustum only if it left it. `preview`
   * (an asset-move drag) keeps the growth until `endPreview`; an animation's
   * growth is dropped by `settle` or the next `refit`.
   */
  include(object: THREE.Object3D, kind?: 'animation' | 'preview'): void;
  /** The preview ended (commit, cancel, revert): fit the apartment again. */
  endPreview(): void;
  /** An animation came to rest: drop what it grew, unless a preview still runs. */
  settle(): void;
  /** Aims the sun by `site` (absent: the legacy direction); `true` when it changed and the fit was redone. */
  orient(site: SceneSite | undefined): boolean;
  /** The world box around everything the fit is made of, for tests and the debug surface. */
  bounds(): ShadowBox;
  state(): SunShadowState;
  /** Takes the slabs away and releases them. */
  dispose(): void;
};

const BOX = new THREE.Box3();

function shadowBox(box: THREE.Box3): ShadowBox {
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

/** True when `object` and every ancestor are visible. */
function seen(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** FNV-1a over the bits of a list of numbers: cheap, order-sensitive. */
class Signature {
  private hash = 0x811c9dc5;
  private readonly floats = new Float32Array(1);
  private readonly bits = new Uint32Array(this.floats.buffer);

  add(value: number): void {
    this.floats[0] = value;
    this.hash = Math.imul(this.hash ^ this.bits[0]!, 0x01000193) >>> 0;
  }

  get value(): number {
    return this.hash;
  }
}

/** The ground plane a building's shadow falls on: its height and, where it is a disk, its centre and radius. */
export type ShadowGround = { readonly y: number; readonly centre: readonly [number, number]; readonly radius: number };

/**
 * Where the casters' shadow lands on `ground`: every corner of every caster
 * box carried along the light (opposite `direction`, which points to the sun)
 * down to the ground's height, clamped to the ground disk, as one flat box.
 * `null` when there are no casters. Pure.
 */
export function groundFootprint(casters: readonly ShadowBox[], direction: Triple, ground: ShadowGround): ShadowBox | null {
  if (casters.length === 0 || !(direction[1] > 0)) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const box of casters) {
    for (const cx of [box.min[0], box.max[0]])
      for (const cy of [box.min[1], box.max[1]])
        for (const cz of [box.min[2], box.max[2]]) {
          const drop = Math.max(0, cy - ground.y) / direction[1];
          let x = cx - direction[0] * drop - ground.centre[0];
          let z = cz - direction[2] * drop - ground.centre[1];
          const reach = Math.hypot(x, z);
          if (reach > ground.radius) {
            x *= ground.radius / reach;
            z *= ground.radius / reach;
          }
          minX = Math.min(minX, x + ground.centre[0]);
          maxX = Math.max(maxX, x + ground.centre[0]);
          minZ = Math.min(minZ, z + ground.centre[1]);
          maxZ = Math.max(maxZ, z + ground.centre[1]);
        }
  }
  return { min: [minX, ground.y, minZ], max: [maxX, ground.y, maxZ] };
}

/** The site ground disk under `root`, as a plane the shadow lands on; `null` without one. */
function groundOf(root: THREE.Object3D): ShadowGround | null {
  const disk = root.getObjectByName('site-ground');
  if (!(disk instanceof THREE.Mesh) || !seen(disk)) return null;
  const parameters = (disk.geometry as THREE.CircleGeometry).parameters as { radius?: number } | undefined;
  const scale = disk.getWorldScale(new THREE.Vector3());
  const centre = disk.getWorldPosition(new THREE.Vector3());
  return { y: centre.y, centre: [centre.x, centre.z], radius: (parameters?.radius ?? 0) * Math.max(scale.x, scale.z) };
}

/** Boxes of everything that casts or receives under `root`, the casters among them, the ground and the casters' signature. */
function survey(root: THREE.Object3D): { boxes: ShadowBox[]; casters: ShadowBox[]; ground: ShadowGround | null; signature: number } {
  root.updateMatrixWorld(true);
  const boxes: ShadowBox[] = [];
  const casters: ShadowBox[] = [];
  const signature = new Signature();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const mesh: THREE.Mesh = object;
    if (!(mesh.castShadow || mesh.receiveShadow) || EXCLUDED_NAMES.has(mesh.name) || !seen(mesh)) return;
    const geometry = mesh.geometry;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    if (geometry.boundingBox === null || geometry.boundingBox.isEmpty()) return;
    BOX.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    boxes.push(shadowBox(BOX));
    if (mesh.castShadow) casters.push(shadowBox(BOX));
    signature.add(geometry.id);
    for (const element of mesh.matrixWorld.elements) signature.add(element);
  });
  // A door leaf swings around its hinge: reserve the space it can reach.
  root.traverse((object) => {
    if (object.userData['isDoorLeaf'] !== true || !seen(object)) return;
    BOX.setFromObject(object);
    if (BOX.isEmpty()) return;
    const reach = Math.max(BOX.max.x - BOX.min.x, BOX.max.z - BOX.min.z);
    BOX.min.x -= reach;
    BOX.min.z -= reach;
    BOX.max.x += reach;
    BOX.max.z += reach;
    boxes.push(shadowBox(BOX));
    casters.push(shadowBox(BOX));
  });
  return { boxes, casters, ground: groundOf(root), signature: signature.value };
}

/** Scratch vectors of `fitContains`: it runs per animated object per frame. */
const FIT_D = new THREE.Vector3();
const FIT_X = new THREE.Vector3();
const FIT_Y = new THREE.Vector3();
const FIT_EYE = new THREE.Vector3();
const FIT_CORNER = new THREE.Vector3();

/** Whether every corner of `box` lies inside the frustum of `fit`. */
function fitContains(fit: ShadowFit, box: ShadowBox): boolean {
  const eye = FIT_EYE.set(...fit.position);
  const d = FIT_D.set(...fit.target)
    .subVectors(eye, FIT_D)
    .normalize();
  const x = FIT_X.set(...fit.up)
    .cross(d)
    .normalize();
  const y = FIT_Y.copy(d).cross(x);
  const corner = FIT_CORNER;
  for (const cx of [box.min[0], box.max[0]])
    for (const cy of [box.min[1], box.max[1]])
      for (const cz of [box.min[2], box.max[2]]) {
        corner.set(cx, cy, cz).sub(eye);
        const lx = corner.dot(x);
        const ly = corner.dot(y);
        const depth = -corner.dot(d);
        if (lx < fit.left || lx > fit.right || ly < fit.bottom || ly > fit.top || depth < fit.near || depth > fit.far) return false;
      }
  return true;
}

function union(boxes: readonly ShadowBox[]): ShadowBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!);
      max[axis] = Math.max(max[axis]!, box.max[axis]!);
    }
  }
  return { min, max };
}

/** What the sun uses of its rig. */
type SunRigUse = Pick<ApartmentRig, 'shadowMapSize' | 'shadowDraws' | 'setSunDirection' | 'setShadowFrustum' | 'markShadowDirty'>;

/** `rig` with its three redraw requests also reported to `redrawn`. */
function heardRig(rig: ApartmentRig, redrawn: () => void): SunRigUse {
  return {
    shadowMapSize: rig.shadowMapSize,
    get shadowDraws() {
      return rig.shadowDraws;
    },
    setSunDirection: (direction) => {
      rig.setSunDirection(direction);
      redrawn();
    },
    setShadowFrustum: (fit) => {
      rig.setShadowFrustum(fit);
      redrawn();
    },
    markShadowDirty: () => {
      rig.markShadowDirty();
      redrawn();
    },
  };
}

function sameSite(a: SceneSite | undefined, b: SceneSite | undefined): boolean {
  return a?.northDeg === b?.northDeg && a?.sun === b?.sun && (a === undefined) === (b === undefined);
}

/**
 * Prepares `root` (built from `scene` and `plan`) for `rig`'s sun: slabs,
 * direction and fit. The rig is the caller's; `dispose` leaves it lit.
 * `redrawn` hears every redraw of the map asked of the rig: the next display
 * draw shows a new shadow (walk and tour draw on demand, `render-demand.ts`).
 */
export function prepareSunShadow(
  root: THREE.Object3D,
  scene: Pick<SceneData, 'rooms' | 'ceilingHeight' | 'site'>,
  plan: Pick<SolvedPlan, 'rooms'>,
  liveRig: ApartmentRig,
  redrawn?: () => void,
): SunShadow {
  const rig = redrawn === undefined ? liveRig : heardRig(liveRig, redrawn);
  const casters: CeilingCasters = buildCeilingCasters(scene, plan);
  root.add(casters.group);
  let site: SceneSite | undefined = scene.site;
  let sun: SunDirection = sunDirection(site);
  let fit: ShadowFit | null = null;
  let signature: number | null = null;
  let base: ShadowBox[] = [];
  let casterBoxes: ShadowBox[] = [];
  let ground: ShadowGround | null = null;
  const extra: ShadowBox[] = [];
  /** Whether an asset-move drag is running: its growth stays until `endPreview`. */
  let previewing = false;
  let released = false;

  /** `boxes` and the casters' shadow on the ground, which the fit must hold too. */
  const withFootprint = (boxes: readonly ShadowBox[]): ShadowBox[] => {
    const footprint = ground === null ? null : groundFootprint([...casterBoxes, ...extra], sun.direction, ground);
    return footprint === null ? [...boxes] : [...boxes, footprint];
  };

  /** Fits `boxes`; sets the frustum when it changed and reports whether it did. */
  const apply = (boxes: readonly ShadowBox[]): boolean => {
    if (boxes.length === 0) return false;
    const next = fitShadowFrustum(withFootprint(boxes), sun.direction, rig.shadowMapSize);
    if (fit !== null && JSON.stringify(next) === JSON.stringify(fit)) return false;
    fit = next;
    rig.setShadowFrustum(next);
    return true;
  };

  const refit = (): void => {
    if (released) return;
    const surveyed = survey(root);
    // An animation's growth does not outlive the structure it was measured on.
    if (!previewing) extra.length = 0;
    base = surveyed.boxes;
    casterBoxes = surveyed.casters;
    ground = surveyed.ground;
    const changed = apply([...base, ...extra]);
    if (!changed && signature !== surveyed.signature) rig.markShadowDirty();
    signature = surveyed.signature;
  };

  rig.setSunDirection(sun.direction);
  refit();

  return {
    refit,
    markDirty() {
      if (!released) rig.markShadowDirty();
    },
    include(object, kind = 'animation') {
      if (released) return;
      if (kind === 'preview') previewing = true;
      object.updateWorldMatrix(true, true);
      BOX.setFromObject(object);
      if (!BOX.isEmpty()) {
        const box = shadowBox(BOX);
        if (fit === null || !fitContains(fit, box)) {
          extra.push(box);
          if (apply([...base, ...extra])) return;
        }
      }
      rig.markShadowDirty();
    },
    endPreview() {
      if (released) return;
      previewing = false;
      refit();
    },
    settle() {
      if (released || previewing || extra.length === 0) return;
      extra.length = 0;
      apply(base);
    },
    orient(next) {
      if (released || sameSite(site, next)) return false;
      site = next;
      sun = sunDirection(site);
      rig.setSunDirection(sun.direction);
      fit = null;
      refit();
      return true;
    },
    bounds: () => union(withFootprint([...base, ...extra])),
    // Copies: the debug surface hands this to page code, which must not reach the live fit.
    state: () => ({
      direction: sun.direction,
      azimuth: sun.azimuth,
      elevation: sun.elevation,
      fit: fit === null ? null : structuredClone(fit),
      draws: rig.shadowDraws,
    }),
    dispose() {
      if (released) return;
      released = true;
      casters.dispose();
    },
  };
}
