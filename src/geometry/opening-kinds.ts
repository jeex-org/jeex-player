/**
 * One entry per `OpeningType`: how a window, a door and a passage are built,
 * where they can be clicked, and which point of the group a click must reach.
 *
 * `OPENING_BUILDERS` is a `Record<OpeningType, OpeningKind>`, so the compiler
 * refuses a new opening type that nobody taught to build itself — the reason
 * this table exists instead of an `opening.type === 'window' ? … : …` chain
 * repeated through `opening-builder.ts`. The builder is the registry and the
 * lifecycle; the shapes live here.
 *
 * Geometry contracts:
 *  - a group owns only the materials it created, listed in the build result;
 *    the handle stock is shared and belongs to the caller;
 *  - a window is picked over its whole pane, a door and a passage only over
 *    their jamb bands and head, so a click still travels through the doorway;
 *  - on an arc the FRAME follows the wall, chord by chord, while the leaf —
 *    one rigid panel — keeps its flat rectangle on the tangent at the opening
 *    centre (documented limitation, curved leaves are out of scope);
 *  - a leaf records HOW it moves (`restAngle`, `hingeSign`, `openSign`, plus
 *    `slide` / `slideBase` when it slides), so `door-animator.ts` can shut it
 *    without re-deriving the swing. Leaves are built OPEN, the way the
 *    apartment is authored.
 */

import * as THREE from 'three';
import type { BuilderContext } from './builder-context.js';
import { finishMaterial, findFinish } from '../materials/finishes.js';
import type { ArcDef } from '../plan/plan-geometry.js';
import { EPS } from '../plan/plan-geometry.js';
import { leafPanelRects, paneLayout } from '../plan/opening-geometry.js';
import { chordBandBoxes, curvedOpeningParts, type CurvedBox, type CurvedOpeningParts } from '../plan/opening-arc.js';
import type { OpeningVariant } from '../assets/opening-variants.js';
import { LEAF_REST_ANGLE_RAD, LEAF_THICKNESS_M, resolveDoorSwing } from '../plan/door-swing.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import type { Opening, OpeningType, Vec2, Vec3, Wall } from '../scene/types.js';

/* -------------------------------------------------------------- tunables -- */

/** Height a door's pick point sits at, metres — handle height, or lower on a squat opening. */
const DOOR_PICK_HEIGHT_M = 1;
/** Pick proxy depth, metres: `thickness + margin`, never thinner than the floor. */
const PICK_DEPTH_MARGIN_M = 0.08;
const PICK_DEPTH_MIN_M = 0.16;
/** Doorway jamb and head pick bands, metres: a cap and a fraction of the opening. */
const PICK_BAND_MAX_M = 0.22;
const PICK_BAND_RATIO = 0.28;
/** Default glazing of a window variant that names none. */
const DEFAULT_GLAZING = { panes: 2 as const, mullions: 'none' as const, tint: '#bcdce0' };
/** Sill board profile, metres: stand-off from the wall face, thickness, depth, end overhang. */
const SILL_BOARD_OFFSET_M = 0.07;
const SILL_BOARD_THICKNESS_M = 0.035;
const SILL_BOARD_DEPTH_M = 0.18;
const SILL_BOARD_OVERHANG_M = 0.12;
/** Handle stock, metres: bar radius, bar length cap and ratio, knob radius, stand-off, inset, height. */
const HANDLE_RADIUS_M = 0.013;
const HANDLE_LENGTH_MAX_M = 0.42;
const HANDLE_LENGTH_RATIO = 0.24;
const KNOB_RADIUS_M = 0.032;
const HANDLE_STANDOFF_M = 0.03;
const HANDLE_INSET_M = 0.09;
const HANDLE_HEIGHT_M = 1.02;
/** Leaf clearance under the head and above the floor, metres. */
const LEAF_HEAD_GAP_M = 0.02;
const LEAF_FLOOR_GAP_M = 0.02;
/** Panel relief on a panelled leaf, metres: thickness and stand-off from the face. */
const PANEL_RELIEF_M = 0.014;
const PANEL_STANDOFF_M = 0.006;
/** Sliding track profile, metres: height, depth, stand-off from the wall, rise above the head. */
const TRACK_HEIGHT_M = 0.05;
const TRACK_DEPTH_M = 0.06;
const TRACK_STANDOFF_M = 0.03;
const TRACK_RISE_M = 0.03;

/* ----------------------------------------------------------------- model -- */

/** Where an opening sits on its wall centreline. */
export type OpeningPlacement = {
  point: Vec2;
  angleY: number;
  /** Normal of the room-owning side of the wall. */
  normal: Vec2;
  sill: number;
  head: number;
  /** Centreline arc of the wall; absent on a straight wall. */
  arc?: ArcDef | undefined;
  /** Opening span along the arc, arc length from node `a`. */
  t0?: number | undefined;
  t1?: number | undefined;
  /** `+1` when the room lies OUTSIDE the arc circle, `-1` when inside. */
  interiorOutward?: 1 | -1 | undefined;
};

/** Everything one opening kind needs to build itself. */
export type OpeningBuildContext = {
  /** Shared plan lookups (scene, solved plan, exterior wall ids). */
  builder: BuilderContext;
  wall: Wall;
  opening: Opening;
  placement: OpeningPlacement;
  variant: OpeningVariant;
  /**
   * Brass stock every handle is made of. It is SHARED between openings and
   * owned by the caller, so it never appears in a build result's materials.
   */
  handleMaterial: THREE.Material;
};

/** One invisible pick proxy, already in the opening group's local frame. */
type PickBox = {
  width: number;
  height: number;
  depth: number;
  x: number;
  y: number;
  z: number;
  /** Rotation about local `Y`; non-zero only on a chorded arc. */
  rotationY: number;
  /**
   * `openingPart` tag for the proxy mesh. Only the chorded boxes carry one —
   * on a straight wall an opening group holds no tagged mesh at all, and
   * `scene-builder.test.ts` asserts exactly that.
   */
  part?: 'pick';
};

/** Result of building one opening: its group and the materials it owns. */
type OpeningBuild = { group: THREE.Group; materials: THREE.Material[] };

/** The leaf a variant asks for, with the flat default filled in. */
type LeafSpec = NonNullable<OpeningVariant['leaf']>;

type OpeningKind = {
  build(ctx: OpeningBuildContext): OpeningBuild;
  pickBoxes(ctx: OpeningBuildContext): PickBox[];
  pickLocal(ctx: OpeningBuildContext): THREE.Vector3;
};

/* ------------------------------------------------------------- local frame */

/**
 * A plan point on the wall, expressed in the opening group's local frame.
 * The group is a rotation about `Y` by `placement.angleY` at
 * `placement.point`, so the inverse is that rotation transposed.
 */
function toLocal(placement: OpeningPlacement, p: Vec2): Vec2 {
  const cos = Math.cos(placement.angleY);
  const sin = Math.sin(placement.angleY);
  const dx = p.x - placement.point.x;
  const dz = p.z - placement.point.z;
  return { x: cos * dx - sin * dz, z: sin * dx + cos * dz };
}

/** A plan DIRECTION expressed in the opening group's local frame. */
function toLocalVector(placement: OpeningPlacement, v: Vec2): Vec2 {
  const cos = Math.cos(placement.angleY);
  const sin = Math.sin(placement.angleY);
  return { x: cos * v.x - sin * v.z, z: sin * v.x + cos * v.z };
}

/**
 * `rotation.y` a child of the group needs so that its own `+x` points along
 * the plan direction `d`. A `rotation.y` of `phi` sends `+x` to
 * `(cos phi, -sin phi)` in `(x, z)`, hence the negated `z`.
 */
function localRotation(placement: OpeningPlacement, d: Vec2): number {
  return Math.atan2(-d.z, d.x) - placement.angleY;
}

/* ------------------------------------------------------------- primitives */

function frameBox(
  c: OpeningBuildContext,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData['isParametricWall'] = true;
  mesh.userData['isExteriorWall'] = c.builder.exteriorWallIds.has(c.wall.id);
  mesh.userData['wallId'] = c.wall.id;
  mesh.userData['wallBottom'] = y - height / 2;
  mesh.userData['wallHeight'] = height;
  return mesh;
}

function cylinder(radius: number, height: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 12), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Material for a variant's finish id, remembered so the group can dispose it. */
function variantMaterial(finishId: string, materials: THREE.Material[]): THREE.MeshStandardMaterial {
  const finish = findFinish(finishId) ?? findFinish('white')!;
  const material = finishMaterial(finish, 1, 1);
  materials.push(material);
  return material;
}

/** Tinted glazing material of a window variant, owned by the group. */
function glassMaterial(variant: OpeningVariant, materials: THREE.Material[]): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: variant.glazing?.tint ?? DEFAULT_GLAZING.tint,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  materials.push(material);
  return material;
}

/** The empty group of an opening, placed and turned onto its wall. */
function openingGroup(c: OpeningBuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = c.opening.id;
  group.position.set(c.placement.point.x, 0, c.placement.point.z);
  group.rotation.y = c.placement.angleY;
  return group;
}

/* ------------------------------------------------------------ arc framing */

/**
 * The chorded frame of one opening on a curved wall, or `null` when the wall
 * is straight (then the flat single-rectangle path is used unchanged).
 */
function curvedParts(
  c: OpeningBuildContext,
  options: { frameWidth: number; frameDepth: number; glazed: boolean },
): CurvedOpeningParts | null {
  const { arc, t0, t1, interiorOutward } = c.placement;
  if (!arc || t0 === undefined || t1 === undefined || interiorOutward === undefined) return null;
  const glazing = options.glazed ? (c.variant.glazing ?? DEFAULT_GLAZING) : undefined;
  return curvedOpeningParts({
    arc,
    thickness: c.wall.thickness,
    t0,
    t1,
    sill: c.placement.sill,
    head: c.placement.head,
    frameWidth: options.frameWidth,
    frameDepth: options.frameDepth,
    interiorOutward,
    glazing: glazing ? { panes: glazing.panes, mullions: glazing.mullions } : undefined,
    sillBoard: options.glazed && c.variant.sillBoard === true,
  });
}

/** One box of a curved opening, placed in the group's local frame. */
function curvedBox(c: OpeningBuildContext, box: CurvedBox, material: THREE.Material): THREE.Mesh {
  const local = toLocal(c.placement, box.centre);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.length, box.height, box.depth), material);
  mesh.position.set(local.x, box.y, local.z);
  mesh.rotation.y = localRotation(c.placement, box.tangent);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Which part of the curved frame this box is; the arc containment test
  // reads it to tell the frame from the sill board, which protrudes by design.
  mesh.userData['openingPart'] = box.role;
  mesh.userData['isParametricWall'] = true;
  mesh.userData['isExteriorWall'] = c.builder.exteriorWallIds.has(c.wall.id);
  mesh.userData['wallId'] = c.wall.id;
  mesh.userData['wallBottom'] = box.y - box.height / 2;
  mesh.userData['wallHeight'] = box.height;
  return mesh;
}

/* --------------------------------------------------------- pick geometry */

function pickDepth(c: OpeningBuildContext): number {
  return Math.max(PICK_DEPTH_MIN_M, c.wall.thickness + PICK_DEPTH_MARGIN_M);
}

/** Width of a doorway's jamb and head bands, capped so they cannot meet. */
function pickBand(c: OpeningBuildContext): number {
  const height = c.placement.head - c.placement.sill;
  return Math.min(PICK_BAND_MAX_M, c.opening.width * PICK_BAND_RATIO, height * PICK_BAND_RATIO);
}

/** A chorded pick band converted into local-frame proxy boxes. */
function chordPickBoxes(c: OpeningBuildContext, boxes: CurvedBox[]): PickBox[] {
  return boxes.map((box) => {
    const local = toLocal(c.placement, box.centre);
    return {
      width: box.length,
      height: box.height,
      depth: box.depth,
      x: local.x,
      y: box.y,
      z: local.z,
      rotationY: localRotation(c.placement, box.tangent),
      part: 'pick',
    };
  });
}

/** A flat proxy box on the wall centreline, square to the group. */
function flatPickBox(width: number, height: number, depth: number, x: number, y: number): PickBox {
  return { width, height, depth, x, y, z: 0, rotationY: 0 };
}

/* ------------------------------------------------------------------ window */

/**
 * Window group for one variant: frame from `variant.frame`, glazing split by
 * `paneLayout`, glass tinted by `variant.glazing.tint`, optional sill board.
 * The group sits on the wall centreline with local `+x` along the wall.
 */
function buildWindow(c: OpeningBuildContext): OpeningBuild {
  const { sill, head } = c.placement;
  const width = c.opening.width;
  const height = head - sill;
  const materials: THREE.Material[] = [];
  const group = openingGroup(c);
  if (height <= EPS || width <= EPS) return { group, materials };

  const frameMaterial = variantMaterial(c.variant.frame.material, materials);
  const frameWidth = Math.min(c.variant.frame.width, width / 3, height / 3);
  const frameDepth = Math.max(0.05, Math.min(c.variant.frame.depth, c.wall.thickness + 0.02));

  // A curved wall gets the faceted frame: bands, posts and panes per chord.
  const curved = curvedParts(c, { frameWidth, frameDepth, glazed: true });
  if (curved) {
    const glass = glassMaterial(c.variant, materials);
    for (const box of curved.boxes) group.add(curvedBox(c, box, frameMaterial));
    for (const pane of curved.panes) {
      const local = toLocal(c.placement, pane.centre);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pane.width, pane.height), glass);
      mesh.position.set(local.x, pane.y, local.z);
      mesh.rotation.y = localRotation(c.placement, pane.tangent);
      mesh.userData['openingPart'] = 'pane';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    return { group, materials };
  }

  // Jambs, then sill and head rails, all flush with the wall centreline.
  group.add(frameBox(c, frameWidth, height, frameDepth, frameMaterial, -width / 2 + frameWidth / 2, sill + height / 2, 0));
  group.add(frameBox(c, frameWidth, height, frameDepth, frameMaterial, width / 2 - frameWidth / 2, sill + height / 2, 0));
  group.add(frameBox(c, width, frameWidth, frameDepth, frameMaterial, 0, sill + frameWidth / 2, 0));
  group.add(frameBox(c, width, frameWidth, frameDepth, frameMaterial, 0, head - frameWidth / 2, 0));

  const glazing = c.variant.glazing ?? DEFAULT_GLAZING;
  const glass = glassMaterial(c.variant, materials);
  const layout = paneLayout(width - frameWidth * 2, height - frameWidth * 2, glazing.panes, glazing.mullions);
  const originX = -width / 2 + frameWidth;
  const originY = sill + frameWidth;
  const barDepth = Math.min(frameDepth * 0.6, 0.055);
  for (const pane of layout.panes) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pane.width, pane.height), glass);
    mesh.position.set(originX + pane.x + pane.width / 2, originY + pane.y + pane.height / 2, 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  for (const bar of layout.bars) {
    group.add(
      frameBox(c, bar.width, bar.height, barDepth, frameMaterial, originX + bar.x + bar.width / 2, originY + bar.y + bar.height / 2, 0),
    );
  }

  if (c.variant.sillBoard) {
    const local = toLocalVector(c.placement, c.placement.normal);
    const offset = c.wall.thickness / 2 + SILL_BOARD_OFFSET_M;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(width + SILL_BOARD_OVERHANG_M, SILL_BOARD_THICKNESS_M, SILL_BOARD_DEPTH_M),
      frameMaterial,
    );
    board.position.set(local.x * offset, sill + SILL_BOARD_THICKNESS_M / 2, local.z * offset);
    board.receiveShadow = true;
    group.add(board);
  }
  return { group, materials };
}

/** A window is picked over its whole pane, chord by chord on an arc. */
function windowPickBoxes(c: OpeningBuildContext): PickBox[] {
  const { arc, t0, t1, sill, head } = c.placement;
  const depth = pickDepth(c);
  if (arc && t0 !== undefined && t1 !== undefined) {
    return chordPickBoxes(c, chordBandBoxes(arc, 'pick', t0, t1, sill, head, depth));
  }
  return [flatPickBox(c.opening.width, head - sill, depth, 0, sill + (head - sill) / 2)];
}

function windowPickLocal(c: OpeningBuildContext): THREE.Vector3 {
  const { sill, head } = c.placement;
  return new THREE.Vector3(0, sill + (head - sill) / 2, 0);
}

/* ---------------------------------------------------------------- doorway */

/**
 * Frame of a doorway — the part a door and a passage share. A passage is a
 * doorway without a leaf, so it is exactly this and nothing else.
 */
function buildDoorFrame(c: OpeningBuildContext): OpeningBuild & { frameMaterial: THREE.MeshStandardMaterial | null; frameWidth: number } {
  const head = c.placement.head;
  const width = c.opening.width;
  const materials: THREE.Material[] = [];
  const group = openingGroup(c);
  if (head <= EPS || width <= EPS) return { group, materials, frameMaterial: null, frameWidth: 0 };

  const frameMaterial = variantMaterial(c.variant.frame.material, materials);
  const frameWidth = Math.min(c.variant.frame.width, width / 4);
  const frameDepth = Math.max(0.06, Math.min(c.variant.frame.depth, c.wall.thickness + 0.02));
  // On an arc the FRAME follows the wall; the leaf does not. A leaf is one
  // rigid panel, so it keeps its flat rectangle on the tangent at the opening
  // centre (documented limitation — curved leaves are out of scope).
  const curved = curvedParts(c, { frameWidth, frameDepth, glazed: false });
  if (curved) {
    for (const box of curved.boxes) group.add(curvedBox(c, box, frameMaterial));
  } else {
    group.add(frameBox(c, frameWidth, head, frameDepth, frameMaterial, -width / 2 + frameWidth / 2, head / 2, 0));
    group.add(frameBox(c, frameWidth, head, frameDepth, frameMaterial, width / 2 - frameWidth / 2, head / 2, 0));
    group.add(frameBox(c, width, frameWidth, frameDepth, frameMaterial, 0, head - frameWidth / 2, 0));
  }
  return { group, materials, frameMaterial, frameWidth };
}

function buildPassage(c: OpeningBuildContext): OpeningBuild {
  const { group, materials } = buildDoorFrame(c);
  return { group, materials };
}

/**
 * Door group for one variant: the doorway frame plus the leaf style of
 * `variant.leaf`. Swing decides which side of the wall the open leaf rests
 * against; sliding leaves do not rotate, they sit beside the opening.
 */
function buildDoor(c: OpeningBuildContext): OpeningBuild {
  const { group, materials, frameMaterial, frameWidth } = buildDoorFrame(c);
  if (!frameMaterial) return { group, materials };
  const { wall, opening, placement, variant } = c;
  const head = placement.head;
  const width = opening.width;

  const leafSpec = variant.leaf ?? { style: 'flat' as const, material: variant.frame.material, handle: 'bar' as const };
  const leafMaterial = leafSpec.material === variant.frame.material ? frameMaterial : variantMaterial(leafSpec.material, materials);
  // Hinge and swing come from the plan, not from the local frame: the same
  // `door-swing.ts` answer the layout linter clears is the leaf built here.
  // The variant's own `swing` only fills in for an opening that authors none.
  const swing = resolveDoorSwing(
    c.builder.scene,
    c.builder.plan,
    wall,
    { ...opening, swing: opening.swing ?? (variant.swing === 'out' ? 'out' : undefined) },
    openingFrameWidth,
  );
  // The group's local `+x` is not the wall tangent on every wall, so the
  // hinge end and the opening side are READ OUT of the local frame, never
  // assumed: `toLocal` is the exact inverse of the group's transform.
  const hingeSign = Math.sign(toLocal(placement, swing.pivot).x) || -1;
  const openSign = Math.sign(toLocalVector(placement, swing.open).z) || 1;
  /** Local `x` direction the leaf runs in from its hinge, towards the far jamb. */
  const leafRun: 1 | -1 = hingeSign < 0 ? 1 : -1;
  const clear = width - frameWidth * 2;
  const leafHeight = head - frameWidth - LEAF_HEAD_GAP_M;

  if (leafSpec.style === 'sliding') {
    // A sliding leaf covers the opening when it is shut and parks beside it,
    // on the room side, when it is open. `slide` is that offset, and the leaf
    // is BUILT at the open end of it, so a scene without the door animator
    // still shows the apartment the way it is authored: doors open.
    const leaf = doorLeaf(c, clear, leafHeight, leafSpec, leafMaterial, frameMaterial, leafRun, materials);
    const closed = { x: hingeSign * (width / 2 - frameWidth), y: LEAF_FLOOR_GAP_M, z: openSign * (wall.thickness / 2 + LEAF_THICKNESS_M) };
    const slide = { x: hingeSign * clear, y: 0, z: 0 };
    tagLeaf(leaf, { restAngle: 0, hingeSign, openSign, slide, slideBase: closed });
    leaf.position.set(closed.x + slide.x, closed.y + slide.y, closed.z + slide.z);
    group.add(leaf);
    // The track has to reach over the parked leaf, not only over the opening.
    group.add(
      frameBox(
        c,
        width + clear,
        TRACK_HEIGHT_M,
        TRACK_DEPTH_M,
        frameMaterial,
        slide.x / 2,
        head + TRACK_RISE_M,
        openSign * (wall.thickness / 2 + TRACK_STANDOFF_M),
      ),
    );
    return { group, materials };
  }

  if (leafSpec.style === 'double') {
    const half = clear / 2;
    for (const side of [1, -1] as const) {
      // Each leaf hangs on its own jamb and runs INWARDS, so the two meet at
      // the centre of the opening when they are shut; the quarter turn that
      // opens them is therefore the opposite sign of a single leaf's.
      const run = -side as 1 | -1;
      const leaf = doorLeaf(c, half, leafHeight, leafSpec, leafMaterial, frameMaterial, run, materials);
      leaf.position.set(side * (width / 2 - frameWidth), LEAF_FLOOR_GAP_M, 0);
      const restAngle = -run * openSign * LEAF_REST_ANGLE_RAD;
      tagLeaf(leaf, { restAngle, hingeSign: side, openSign });
      leaf.rotation.y = restAngle;
      group.add(leaf);
    }
    return { group, materials };
  }

  const leaf = doorLeaf(c, clear, leafHeight, leafSpec, leafMaterial, frameMaterial, leafRun, materials);
  leaf.position.set(hingeSign * (width / 2 - frameWidth), LEAF_FLOOR_GAP_M, 0);
  const restAngle = -leafRun * openSign * LEAF_REST_ANGLE_RAD;
  tagLeaf(leaf, { restAngle, hingeSign, openSign });
  leaf.rotation.y = restAngle;
  group.add(leaf);
  return { group, materials };
}

/**
 * Records how a leaf moves, so `door-animator.ts` can drive it without
 * re-deriving the swing: `restAngle` is the `rotation.y` of the fully OPEN
 * leaf (`rotation.y = restAngle * t`), `slide` the open offset of a sliding
 * one (`position = slideBase + slide * t`). Leaving those implicit is what
 * made "which way does this leaf close" a question only the builder could
 * answer.
 */
function tagLeaf(
  leaf: THREE.Group,
  contract: {
    restAngle: number;
    hingeSign: number;
    openSign: number;
    slide?: Vec3;
    slideBase?: Vec3;
  },
): void {
  leaf.userData['restAngle'] = contract.restAngle;
  leaf.userData['hingeSign'] = contract.hingeSign;
  leaf.userData['openSign'] = contract.openSign;
  if (contract.slide) leaf.userData['slide'] = { ...contract.slide };
  if (contract.slideBase) leaf.userData['slideBase'] = { ...contract.slideBase };
}

/**
 * One door leaf hinged at the group origin, extending `direction * width`
 * along local `x`. Panelled leaves get inset panels on both faces, glass
 * leaves a tinted insert inside a stile-and-rail ring.
 */
function doorLeaf(
  c: OpeningBuildContext,
  width: number,
  height: number,
  leafSpec: LeafSpec,
  leafMaterial: THREE.MeshStandardMaterial,
  frameMaterial: THREE.MeshStandardMaterial,
  direction: 1 | -1,
  materials: THREE.Material[],
): THREE.Group {
  const leaf = new THREE.Group();
  leaf.userData['isDoorLeaf'] = true;
  leaf.userData['isExteriorWall'] = c.builder.exteriorWallIds.has(c.wall.id);
  leaf.userData['wallId'] = c.wall.id;
  leaf.userData['wallBottom'] = 0;
  leaf.userData['wallHeight'] = height;
  if (width <= EPS || height <= EPS) return leaf;
  const centreX = (direction * width) / 2;

  if (leafSpec.style === 'glass') {
    // Stile-and-rail ring with a tinted insert instead of a solid panel.
    const stile = Math.min(0.12, width / 3);
    const rail = Math.min(0.2, height / 4);
    leaf.add(frameBox(c, stile, height, LEAF_THICKNESS_M, leafMaterial, (direction * stile) / 2, height / 2, 0));
    leaf.add(frameBox(c, stile, height, LEAF_THICKNESS_M, leafMaterial, direction * (width - stile / 2), height / 2, 0));
    leaf.add(frameBox(c, width, rail, LEAF_THICKNESS_M, leafMaterial, centreX, rail / 2, 0));
    leaf.add(frameBox(c, width, rail, LEAF_THICKNESS_M, leafMaterial, centreX, height - rail / 2, 0));
    const insertMaterial = new THREE.MeshPhysicalMaterial({
      color: '#cfe3e4',
      roughness: 0.12,
      metalness: 0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    materials.push(insertMaterial);
    const insert = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(0.05, width - stile * 2), Math.max(0.05, height - rail * 2)),
      insertMaterial,
    );
    insert.position.set(centreX, height / 2, 0);
    insert.castShadow = false;
    leaf.add(insert);
  } else {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, LEAF_THICKNESS_M), leafMaterial);
    panel.position.set(centreX, height / 2, 0);
    panel.castShadow = true;
    panel.receiveShadow = true;
    leaf.add(panel);
    if (leafSpec.style === 'panelled') {
      for (const rect of leafPanelRects(width, height, 2)) {
        for (const side of [1, -1] as const) {
          leaf.add(
            frameBox(
              c,
              rect.width,
              rect.height,
              PANEL_RELIEF_M,
              frameMaterial,
              direction * (rect.x + rect.width / 2),
              rect.y + rect.height / 2,
              side * (LEAF_THICKNESS_M / 2 + PANEL_STANDOFF_M),
            ),
          );
        }
      }
    }
  }

  const brass = c.handleMaterial;
  const handleX = direction * (width - HANDLE_INSET_M);
  const barLength = Math.min(HANDLE_LENGTH_MAX_M, height * HANDLE_LENGTH_RATIO);
  if (leafSpec.handle === 'bar') {
    for (const side of [1, -1] as const) {
      leaf.add(cylinder(HANDLE_RADIUS_M, barLength, brass, handleX, HANDLE_HEIGHT_M, side * (LEAF_THICKNESS_M / 2 + HANDLE_STANDOFF_M)));
    }
  } else if (leafSpec.handle === 'knob') {
    for (const side of [1, -1] as const) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(KNOB_RADIUS_M, 12, 10), brass);
      knob.position.set(handleX, HANDLE_HEIGHT_M, side * (LEAF_THICKNESS_M / 2 + HANDLE_STANDOFF_M));
      leaf.add(knob);
    }
  }
  return leaf;
}

/**
 * A doorway is picked only over its two jamb bands and its head, so a click
 * still travels through the open doorway to whatever stands behind it.
 */
function doorwayPickBoxes(c: OpeningBuildContext): PickBox[] {
  const { arc, t0, t1, sill, head } = c.placement;
  const depth = pickDepth(c);
  const band = pickBand(c);
  const height = head - sill;
  if (arc && t0 !== undefined && t1 !== undefined) {
    // On an arc the proxy is segmented like the frame: a single box spanning
    // the whole chord hull would stand half a metre proud of the wall.
    return chordPickBoxes(c, [
      ...chordBandBoxes(arc, 'pick', t0, Math.min(t1, t0 + band), sill, head, depth),
      ...chordBandBoxes(arc, 'pick', Math.max(t0, t1 - band), t1, sill, head, depth),
      ...chordBandBoxes(arc, 'pick', t0, t1, head - band, head, depth),
    ]);
  }
  const width = c.opening.width;
  const centreY = sill + height / 2;
  return [
    flatPickBox(band, height, depth, -width / 2 + band / 2, centreY),
    flatPickBox(band, height, depth, width / 2 - band / 2, centreY),
    flatPickBox(width, band, depth, 0, head - band / 2),
  ];
}

/** The near jamb band at handle height: a point inside the doorway's own proxy. */
function doorwayPickLocal(c: OpeningBuildContext): THREE.Vector3 {
  const { sill, head } = c.placement;
  const y = Math.min(DOOR_PICK_HEIGHT_M, sill + (head - sill) / 2);
  const first = doorwayPickBoxes(c)[0];
  if (first) return new THREE.Vector3(first.x, y, first.z);
  return new THREE.Vector3(-c.opening.width / 2 + pickBand(c) / 2, y, 0);
}

/* ------------------------------------------------------------------ table */

/**
 * The one place an opening type turns into geometry. `Record<OpeningType, …>`
 * is deliberate: adding a type to `types.ts` without teaching it to build
 * itself is a compile error, not a silently unbuilt opening. A door and a
 * passage share their pick geometry — a passage IS a door's doorway, minus
 * the leaf.
 */
export const OPENING_BUILDERS: Readonly<Record<OpeningType, OpeningKind>> = {
  window: { build: buildWindow, pickBoxes: windowPickBoxes, pickLocal: windowPickLocal },
  door: { build: buildDoor, pickBoxes: doorwayPickBoxes, pickLocal: doorwayPickLocal },
  passage: { build: buildPassage, pickBoxes: doorwayPickBoxes, pickLocal: doorwayPickLocal },
};
