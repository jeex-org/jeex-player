/**
 * Where the parts of a door or a window land in the WORLD, read from the
 * matrices the real `SceneBuilder` produces.
 *
 * An opening group stands on its wall turned by `rotation.y = angleY`, and a
 * `Y` turn sends local `+x` to `(cos, -sin)`: on a wall that runs along no
 * axis the group's local `x` is the wall's tangent mirrored, not the tangent.
 * Every check here is therefore made in plan terms (distance from the wall's
 * centreline, direction against its tangent), never in the group's local
 * numbers, which is how a leaf could stand half a metre off a diagonal wall
 * while every local-frame test still passed.
 *
 * The plans are in `plan-angled-openings.ts`: a door and a window on a 30°
 * wall, a door on an arc and an axis-aligned control door, whose world
 * matrices are pinned exactly as they were before openings learned their
 * wall's frame; and an interior door on a 60° partition drawn from `b` to `a`,
 * where the wall frame's `x` runs against the tangent.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SceneBuilder } from './scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { ARC_TOL, arcFromChord, type ArcDef } from '../plan/plan-geometry.js';
import { interiorSideOf, pointAt, resolveDoorSwing, LEAF_THICKNESS_M } from '../plan/door-swing.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { DOOR_VARIANTS, ENTRY_DOOR_VARIANTS, findOpeningVariant, type OpeningVariant } from '../assets/opening-variants.js';
import { OPENING_VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { applyToLeaf, doorLeavesOf } from '../doors/door-animator.js';
import { angledOpeningsPlan, reversedPartitionPlan } from '../fixtures/plan-angled-openings.js';
import { ANGLED, REVERSED } from '../fixtures/plan-angled-openings-ids.js';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import type { SceneData, Vec2 } from '../scene/types.js';

/** A millimetre: how far off its line a part may stand. */
const MM = 1e-3;
/** How far a part's own `x` axis may lean off the wall's tangent (a sine). */
const PARALLEL = 1e-9;
/** How far past the room face of its wall the builder sets a window's sill board, in metres. */
const SILL_BOARD_OFFSET_M = 0.07;

/** A sliding door variant the bank does not ship, put at the head of the door sets while its tests run. */
const SLIDING: OpeningVariant = {
  id: '01a1cfb4-2b3e-7c1d-9f60-5a7e2d4c8b19',
  slug: 'test-door-sliding',
  name: 'Sliding, test only',
  for: 'door',
  frame: { material: FINISH.white, width: 0.06, depth: 0.1 },
  leaf: { style: 'sliding', material: FINISH.white, handle: 'bar' },
  preview: { base: '#fff' },
};

type Style = 'single' | 'double' | 'sliding';

/**
 * Puts `SLIDING` at the head of `sets` (where `defaultOpeningVariant` picks a
 * door's variant) for the tests of the enclosing `describe`, and takes it out
 * of them again afterwards, by identity, so no production array keeps it.
 */
function withSlidingVariant(...sets: OpeningVariant[][]): void {
  beforeAll(() => {
    for (const set of sets) set.unshift(SLIDING);
  });
  afterAll(() => {
    for (const set of sets) {
      const at = set.indexOf(SLIDING);
      if (at >= 0) set.splice(at, 1);
    }
  });
}

/** The plan's own answer to "where is this opening": its centre, the tangent there, and the wall's arc. */
type WallLine = { centre: Vec2; tangent: Vec2; arc: ArcDef | null; thickness: number; width: number };

function lineOf(scene: SceneData, openingId: string): WallLine {
  const wall = scene.walls.find((candidate) => candidate.openings?.some((opening) => opening.id === openingId))!;
  const opening = wall.openings!.find((candidate) => candidate.id === openingId)!;
  const { point, tangent } = pointAt(scene, wall, opening.center);
  const a = scene.nodes.find((node) => node.id === wall.a)!.p;
  const b = scene.nodes.find((node) => node.id === wall.b)!.p;
  const arc = wall.arc ? arcFromChord(a, b, wall.arc.radius, wall.arc.ccw) : null;
  return { centre: point, tangent, arc, thickness: wall.thickness, width: opening.width };
}

/** A world point's distance ALONG the tangent from the opening centre, and ACROSS it (left of the tangent positive). */
function offsets(line: WallLine, p: THREE.Vector3): { along: number; across: number } {
  const dx = p.x - line.centre.x;
  const dz = p.z - line.centre.z;
  return { along: dx * line.tangent.x + dz * line.tangent.z, across: -dx * line.tangent.z + dz * line.tangent.x };
}

/** How far a plan point stands off the wall's centreline: the straight line, or the arc's circle. */
function offCentreline(line: WallLine, p: THREE.Vector3): number {
  if (!line.arc) return Math.abs(offsets(line, p).across);
  return Math.abs(Math.hypot(p.x - line.arc.centre.x, p.z - line.arc.centre.z) - line.arc.radius);
}

/** Sine of the angle between an object's own world `x` axis and the plan direction `d`. */
function leanOff(object: THREE.Object3D, d: Vec2): number {
  const axis = new THREE.Vector3().setFromMatrixColumn(object.matrixWorld, 0).normalize();
  return Math.abs(axis.x * d.z - axis.z * d.x);
}

/** World centre of a mesh's geometry: its origin may have been moved off it for the light bake. */
function centreOf(mesh: THREE.Mesh): THREE.Vector3 {
  mesh.geometry.computeBoundingBox();
  return mesh.localToWorld(mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()));
}

function build(scene: SceneData = angledOpeningsPlan): SceneBuilder {
  const builder = new SceneBuilder(scene, solvePlan(scene));
  builder.build();
  return builder;
}

/** The group of one opening with its world matrices current. */
function groupOf(builder: SceneBuilder, id: string): THREE.Group {
  const group = builder.getOpeningGroup(id)!;
  group.updateWorldMatrix(true, true);
  return group;
}

/** The straight frame boxes of a flat opening: direct box children that are not pick proxies or leaves. */
function frameBoxes(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter(
    (child): child is THREE.Mesh =>
      child instanceof THREE.Mesh &&
      child.geometry instanceof THREE.BoxGeometry &&
      child.userData['isParametricWall'] === true &&
      !child.name.endsWith('-pick'),
  );
}

/** The two side posts of a flat frame: the narrow boxes as tall as the whole frame (a mullion is a frame width shorter). */
function jambsOf(group: THREE.Group, line: WallLine): THREE.Mesh[] {
  const posts = frameBoxes(group).filter((box) => {
    const { width, height } = (box.geometry as THREE.BoxGeometry).parameters;
    return height > 1 && width <= line.width / 4;
  });
  const tallest = Math.max(...posts.map((box) => (box.geometry as THREE.BoxGeometry).parameters.height));
  return posts.filter((box) => (box.geometry as THREE.BoxGeometry).parameters.height === tallest);
}

/**
 * Whether a straight box of a CHORDED frame stands on its arc: its middle and
 * both ends of its run lie within the wall's chord budget (`ARC_TOL`, the
 * sagitta the arc is cut to) of the centreline circle, plus a millimetre.
 * `run: false` checks only the run's direction, for a part that stands proud
 * of the centreline by design (the sill board).
 */
function onArc(arc: ArcDef, box: THREE.Mesh, run = true): void {
  const half = (box.geometry as THREE.BoxGeometry).parameters.width / 2;
  const centre = centreOf(box);
  const axis = new THREE.Vector3().setFromMatrixColumn(box.matrixWorld, 0).normalize();
  const radial = (p: THREE.Vector3): number => Math.hypot(p.x - arc.centre.x, p.z - arc.centre.z);
  const ends = [centre.clone().addScaledVector(axis, -half), centre.clone().addScaledVector(axis, half)];
  if (run) {
    for (const p of [centre, ...ends]) expect(Math.abs(radial(p) - arc.radius)).toBeLessThan(ARC_TOL + MM);
  } else {
    // Proud of the centreline, but still running along the arc: both ends as far out as the middle, within the budget.
    for (const p of ends) expect(Math.abs(radial(p) - radial(centre))).toBeLessThan(ARC_TOL + MM);
  }
}

/** Distance from the opening centre to a jamb's inner face, along the wall: where a leaf hangs. */
function jambReach(line: WallLine, variant: OpeningVariant): number {
  return line.width / 2 - Math.min(variant.frame.width, line.width / 4);
}

type Door = { scene: SceneData; id: string };

const DOORS: Record<string, Door> = {
  'the door on the 30° wall': { scene: angledOpeningsPlan, id: ANGLED.opening.doorDiagonal },
  'the door on the arc': { scene: angledOpeningsPlan, id: ANGLED.opening.doorArc },
  'the axis-aligned control door': { scene: angledOpeningsPlan, id: ANGLED.opening.doorControl },
  'the door on the 60° partition drawn from b to a': { scene: reversedPartitionPlan, id: REVERSED.opening.doorPartition },
};

/** The door built in one leaf style, shut, with what the plan says about it. */
function shutDoor({ scene, id }: Door, style: Style) {
  const builder = build(scene);
  if (style === 'double') expect(builder.rebuildOpening(id, OPENING_VARIANT.door_white_double)).toBe(true);
  const variant = style === 'sliding' ? SLIDING : findOpeningVariant(builder.getOpeningVariant(id)!)!;
  const group = groupOf(builder, id);
  const leaves = doorLeavesOf(group);
  // The sliding tests must build a sliding leaf, not fall back to whatever variant is first.
  for (const leaf of leaves) expect(leaf.userData['slide'] !== undefined).toBe(style === 'sliding');
  for (const leaf of leaves) applyToLeaf(leaf, 0);
  group.updateWorldMatrix(true, true);
  const wall = scene.walls.find((candidate) => candidate.openings?.some((opening) => opening.id === id))!;
  const opening = wall.openings!.find((candidate) => candidate.id === id)!;
  // The swing of the variant the door now wears: a double rebuilt over an entrance hangs on its own, narrower frame.
  const wornId = builder.getOpeningVariant(id);
  const worn = wornId ? { ...opening, variant: wornId } : opening;
  const swing = resolveDoorSwing(scene, solvePlan(scene), wall, worn, openingFrameWidth);
  return { group, leaves, variant, line: lineOf(scene, id), swing };
}

/**
 * World centre of a leaf's slab: the box over its panel, stiles, rails and
 * insert, without the handles, which stand on one edge only.
 */
function slabCentre(leaf: THREE.Object3D): THREE.Vector3 {
  const box = new THREE.Box3();
  for (const part of leaf.children) {
    if (!(part instanceof THREE.Mesh)) continue;
    if (part.geometry instanceof THREE.CylinderGeometry || part.geometry instanceof THREE.SphereGeometry) continue;
    box.expandByObject(part);
  }
  return box.getCenter(new THREE.Vector3());
}

function hingeOf(leaf: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(leaf.matrixWorld);
}

function leafChecks(style: Style): void {
  for (const [name, door] of Object.entries(DOORS)) {
    test(`${name}, ${style}: every shut leaf hangs on the wall line at its jamb`, () => {
      const { leaves, variant, line, swing } = shutDoor(door, style);
      expect(leaves.length).toBe(style === 'double' ? 2 : 1);
      const reach = jambReach(line, variant);
      const hinges = leaves.map((leaf) => offsets(line, hingeOf(leaf)));
      // A sliding leaf runs on the face of the wall, a leaf thickness off it; a hinged one on the centreline.
      const across = style === 'sliding' ? line.thickness / 2 + LEAF_THICKNESS_M : 0;
      for (const hinge of hinges) {
        expect(Math.abs(Math.abs(hinge.across) - across)).toBeLessThan(MM);
        expect(Math.abs(Math.abs(hinge.along) - reach)).toBeLessThan(MM);
      }
      if (style === 'double') expect(Math.sign(hinges[0]!.along)).toBe(-Math.sign(hinges[1]!.along));
      if (style === 'single') {
        const pivot = offsets(line, new THREE.Vector3(swing.pivot.x, 0, swing.pivot.z));
        expect(Math.sign(hinges[0]!.along)).toBe(Math.sign(pivot.along));
      }
    });

    test(`${name}, ${style}: every shut leaf lies along the wall`, () => {
      const { leaves, line } = shutDoor(door, style);
      for (const leaf of leaves) {
        expect(leanOff(leaf, line.tangent)).toBeLessThan(PARALLEL);
        // Shut, the far edge of the leaf is on the line too, not only its hinge.
        const box = new THREE.Box3().setFromObject(leaf);
        const centre = offsets(line, box.getCenter(new THREE.Vector3()));
        expect(Math.abs(Math.abs(centre.across) - Math.abs(offsets(line, hingeOf(leaf)).across))).toBeLessThan(MM);
      }
    });

    test(`${name}, ${style}: the open leaf stands on the side the swing decides`, () => {
      const { leaves, line, swing } = shutDoor(door, style);
      const pivot = offsets(line, new THREE.Vector3(swing.pivot.x, 0, swing.pivot.z));
      for (const leaf of leaves) {
        const shut = hingeOf(leaf);
        applyToLeaf(leaf, 1);
        leaf.updateWorldMatrix(true, true);
        const centre = offsets(line, new THREE.Box3().setFromObject(leaf).getCenter(new THREE.Vector3()));
        // The swing names a room side, not a direction square to this tangent
        // (on an arc it is the face's normal): the open leaf belongs on the
        // side of the wall line that normal points to.
        const side = Math.sign(-swing.open.x * line.tangent.z + swing.open.z * line.tangent.x);
        if (style === 'sliding') {
          // Parked beside the opening, on the face it slid along, the wall line untouched.
          const moved = offsets(line, hingeOf(leaf));
          expect(Math.abs(moved.across - offsets(line, shut).across)).toBeLessThan(MM);
          expect(Math.sign(centre.across)).toBe(side);
          // It parks past the hinge jamb, by the length of the leaf.
          const parked = moved.along - offsets(line, shut).along;
          expect(Math.sign(parked)).toBe(Math.sign(pivot.along));
          expect(Math.abs(Math.abs(parked) - swing.leaf)).toBeLessThan(MM);
        } else {
          expect(side * (centre.across - offsets(line, shut).across)).toBeGreaterThan(0.05);
        }
      }
    });

    // On an arc the plan's pivot is on the curve while a flat leaf hangs on the
    // tangent at the opening's centre (a documented limitation), so the exact
    // place is asserted on straight walls only.
    if (style !== 'sliding' && door.scene.walls.some((wall) => !wall.arc && wall.openings?.some((opening) => opening.id === door.id))) {
      test(`${name}, ${style}: the open leaf stands where the plan's swing puts it`, () => {
        const { leaves, swing } = shutDoor(door, style);
        // A single leaf is the plan's whole leaf; a double door hangs half of it
        // on each jamb, the second jamb a whole leaf along from the pivot.
        const length = style === 'double' ? swing.leaf / 2 : swing.leaf;
        const jambs =
          style === 'double'
            ? [swing.pivot, { x: swing.pivot.x + swing.closed.x * swing.leaf, z: swing.pivot.z + swing.closed.z * swing.leaf }]
            : [swing.pivot];
        const expected = jambs.map((jamb) => ({ x: jamb.x + (swing.open.x * length) / 2, z: jamb.z + (swing.open.z * length) / 2 }));
        expect(leaves.length).toBe(expected.length);
        for (const leaf of leaves) applyToLeaf(leaf, 1);
        for (const leaf of leaves) leaf.updateWorldMatrix(true, true);
        const centres = leaves.map((leaf) => slabCentre(leaf));
        for (const want of expected) {
          const nearest = Math.min(...centres.map((centre) => Math.hypot(centre.x - want.x, centre.z - want.z)));
          expect(nearest).toBeLessThan(MM);
        }
      });
    }
  }
}

describe('door leaves on angled and curved walls', () => {
  leafChecks('single');
  leafChecks('double');
  describe('sliding', () => {
    withSlidingVariant(DOOR_VARIANTS, ENTRY_DOOR_VARIANTS);
    leafChecks('sliding');
  });
});

describe('straight frames on angled walls', () => {
  for (const [name, door] of Object.entries(DOORS)) {
    test(`${name}: both jambs stand on the wall line`, () => {
      const { group, variant, line } = shutDoor(door, 'single');
      if (line.arc) {
        // The arc's frame is chorded; every jamb chord sits on the arc.
        const jambs = group.children.filter((child) => child.userData['openingPart'] === 'jamb') as THREE.Mesh[];
        expect(jambs.length).toBeGreaterThanOrEqual(2);
        for (const jamb of jambs) onArc(line.arc, jamb);
        return;
      }
      const jambs = jambsOf(group, line);
      expect(jambs.length).toBe(2);
      const reach = line.width / 2 - Math.min(variant.frame.width, line.width / 4) / 2;
      const along = jambs.map((jamb) => offsets(line, centreOf(jamb)).along).sort((p, q) => p - q);
      expect(Math.abs(along[0]! + reach)).toBeLessThan(MM);
      expect(Math.abs(along[1]! - reach)).toBeLessThan(MM);
      for (const jamb of jambs) {
        expect(offCentreline(line, centreOf(jamb))).toBeLessThan(MM);
        expect(leanOff(jamb, line.tangent)).toBeLessThan(PARALLEL);
      }
    });
  }

  test('the window on the 30° wall: jambs, rails, bars and panes stand on the wall line, along it', () => {
    const id = ANGLED.opening.windowDiagonal;
    const group = groupOf(build(), id);
    const line = lineOf(angledOpeningsPlan, id);
    expect(jambsOf(group, line).length).toBe(2);
    const parts = group.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh &&
        !child.name.endsWith('-pick') &&
        (child.geometry instanceof THREE.BoxGeometry || child.geometry instanceof THREE.PlaneGeometry),
    );
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) {
      expect(leanOff(part, line.tangent)).toBeLessThan(PARALLEL);
      // The sill board stands proud of the room face by design; everything else is on the centreline.
      if (part.userData['isParametricWall'] === true || part.geometry instanceof THREE.PlaneGeometry) {
        expect(offCentreline(line, centreOf(part))).toBeLessThan(MM);
      }
    }
  });

  test('the sill board of the window on the 30° wall stands on the room side, proud of the face', () => {
    const id = ANGLED.opening.windowDiagonal;
    const group = groupOf(build(), id);
    const line = lineOf(angledOpeningsPlan, id);
    const wallId = angledOpeningsPlan.walls.find((wall) => wall.openings?.some((opening) => opening.id === id))!.id;
    const room = interiorSideOf(solvePlan(angledOpeningsPlan), wallId, line.tangent).normal;
    // The flat sill board is the one box that is neither a frame part nor a pick proxy.
    const boards = group.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh &&
        child.geometry instanceof THREE.BoxGeometry &&
        child.userData['isParametricWall'] !== true &&
        !child.name.endsWith('-pick'),
    );
    expect(boards.length).toBe(1);
    const centre = centreOf(boards[0]!);
    const { along } = offsets(line, centre);
    const out = (centre.x - line.centre.x) * room.x + (centre.z - line.centre.z) * room.z;
    expect(Math.abs(along)).toBeLessThan(MM);
    expect(Math.abs(out - (line.thickness / 2 + SILL_BOARD_OFFSET_M))).toBeLessThan(MM);
  });

  test('the pick proxies of the angled door and window lie along their wall', () => {
    const builder = build();
    for (const id of [ANGLED.opening.doorDiagonal, ANGLED.opening.windowDiagonal]) {
      const group = groupOf(builder, id);
      const line = lineOf(angledOpeningsPlan, id);
      const proxies = group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.name === `${id}-pick`);
      expect(proxies.length).toBeGreaterThan(0);
      for (const proxy of proxies) {
        expect(leanOff(proxy, line.tangent)).toBeLessThan(PARALLEL);
        expect(offCentreline(line, centreOf(proxy))).toBeLessThan(MM);
      }
    }
  });

  test("the demo flat's bay window: every straight box of its frame stands on the arc", () => {
    const id = DEMO.opening.windowLivingBay;
    const group = groupOf(build(apartmentScene), id);
    const line = lineOf(apartmentScene, id);
    const arc = line.arc!;
    const boxes = group.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry && child.userData['isParametricWall'] === true,
    );
    expect(boxes.length).toBeGreaterThan(4);
    for (const box of boxes) onArc(arc, box, box.userData['openingPart'] !== 'sill-board');
  });
});

/** Every object of a group, in traversal order, as its type and its sixteen world-matrix numbers (`-0` kept). */
function worldMatrices(group: THREE.Object3D): string[] {
  group.updateWorldMatrix(true, true);
  const out: string[] = [];
  group.traverse((object) => {
    out.push(`${object.type} ${object.matrixWorld.elements.map((n) => (Object.is(n, -0) ? '-0' : String(n))).join(' ')}`);
  });
  return out;
}

describe('the axis-aligned control door builds bit for bit as before', () => {
  function matrices(style: Style): { built: string[]; closed: string[] } {
    const builder = build();
    if (style === 'double') builder.rebuildOpening(ANGLED.opening.doorControl, OPENING_VARIANT.door_white_double);
    const group = builder.getOpeningGroup(ANGLED.opening.doorControl)!;
    const built = worldMatrices(group);
    for (const leaf of doorLeavesOf(group)) applyToLeaf(leaf, 0);
    return { built, closed: worldMatrices(group) };
  }

  test('single leaf, open and shut', () => {
    expect(matrices('single')).toEqual(CONTROL_MATRICES.single);
  });

  test('double leaves, open and shut', () => {
    expect(matrices('double')).toEqual(CONTROL_MATRICES.double);
  });

  describe('sliding', () => {
    withSlidingVariant(DOOR_VARIANTS);
    test('sliding leaf, open and shut', () => {
      expect(matrices('sliding')).toEqual(CONTROL_MATRICES.sliding);
    });
  });
});

/**
 * The control door's world matrices as the builder made them before openings
 * learned their wall's frame (each object of the group in traversal order:
 * its type, then `matrixWorld.elements`). Built is the open pose the scene
 * shows; shut is after `applyToLeaf(leaf, 0)`.
 */
const CONTROL_MATRICES = {
  single: {
    built: [
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0 2.5 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.87 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.13 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 2.0700000000000003 2.5 1',
      'Group 1 0 0 0 0 1 0 0 0 0 1 0 4.5 0.02 2.16 1',
      'Mesh 1 0 0 0 0 1 0 0 0 0 1 0 4.16 1.03 2.16 1',
      'Mesh 1 0 0 0 0 1 0 0 0 0 1 0 3.91 1.04 2.2125000000000004 1',
      'Mesh 1 0 0 0 0 1 0 0 0 0 1 0 3.91 1.04 2.1075 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.79 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.21 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.99 2.5 1',
    ],
    closed: [
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0 2.5 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.87 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.13 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 2.0700000000000003 2.5 1',
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0.02 2.16 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.03 2.5 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5525 1.04 2.75 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.4475 1.04 2.75 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.79 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.21 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.99 2.5 1',
    ],
  },
  double: {
    built: [
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0 2.5 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.87 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.13 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 2.0700000000000003 2.5 1',
      'Group 1 0 0 0 0 1 0 0 0 0 1 0 4.5 0.02 2.16 1',
      'Mesh 1 0 0 0 0 1 0 0 0 0 1 0 4.33 1.03 2.16 1',
      'Mesh 1 0 0 0 0 1 0 0 0 0 1 0 4.25 1.04 2.2125000000000004 1',
      'Mesh 1 0 0 0 0 1 0 0 0 0 1 0 4.25 1.04 2.1075 1',
      'Group -1 0 -4.440892098500626e-16 0 0 1 0 0 4.440892098500626e-16 0 -1 0 4.5 0.02 2.84 1',
      'Mesh -1 0 -4.440892098500626e-16 0 0 1 0 0 4.440892098500626e-16 0 -1 0 4.33 1.03 2.84 1',
      'Mesh -1 0 -4.440892098500626e-16 0 0 1 0 0 4.440892098500626e-16 0 -1 0 4.25 1.04 2.7874999999999996 1',
      'Mesh -1 0 -4.440892098500626e-16 0 0 1 0 0 4.440892098500626e-16 0 -1 0 4.25 1.04 2.8924999999999996 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.79 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.21 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.99 2.5 1',
    ],
    closed: [
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0 2.5 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.87 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.13 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 2.0700000000000003 2.5 1',
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0.02 2.16 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.03 2.33 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5525 1.04 2.41 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.4475 1.04 2.41 1',
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0.02 2.84 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.03 2.67 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5525 1.04 2.59 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.4475 1.04 2.59 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.79 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.21 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.99 2.5 1',
    ],
  },
  sliding: {
    built: [
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0 2.5 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.87 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.13 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 2.0700000000000003 2.5 1',
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.405 0.02 1.48 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.405 1.03 1.82 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.4575000000000005 1.04 2.0700000000000003 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.3525 1.04 2.0700000000000003 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.37 2.13 2.16 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.79 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.21 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.99 2.5 1',
    ],
    closed: [
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 0 2.5 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.87 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 1.05 2.13 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.45 2.0700000000000003 2.5 1',
      'Group 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.405 0.02 2.16 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.405 1.03 2.5 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.4575000000000005 1.04 2.75 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.3525 1.04 2.75 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.37 2.13 2.16 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.79 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.05 2.21 1',
      'Mesh 2.220446049250313e-16 0 -1 0 0 1 0 0 1 0 2.220446049250313e-16 0 4.5 1.99 2.5 1',
    ],
  },
} satisfies Record<Style, { built: string[]; closed: string[] }>;
