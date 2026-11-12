/**
 * `doorLeaf`: the hinge and swing a door shows, explicit or derived, and the
 * room on each side, read off the same `resolveDoorSwing` the plan drawing and
 * the 3D leaf use.
 */

import { describe, expect, test } from 'bun:test';
import { OPENING_VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { opDraft, openingOf } from '../fixtures/op-drafts.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { doorSwings } from '../plan/door-swing.js';
import { ZONED, ZONE_OUTLINES, zone, zonedLivingPlan } from '../fixtures/plan-zoned-living.js';
import { solvePlan } from '../plan/plan-solver.js';
import { applyOp } from '../scene/scene-ops.js';
import type { SceneData } from '../scene/types.js';
import { doorLeaf } from './door-leaf.js';

const ENTRY = L_SHAPE.opening.doorEntry;
const DOOR_AB = L_SHAPE.opening.doorAb;

/** Ids of the arc fixture below: fixed UUID v7 literals, generated once. */
const ARC = {
  scene: '01a1cf0d-4e06-7696-876f-5d7de4b04fab',
  node: {
    sw: '01a1cf0d-4e06-7697-8c6d-10dbd53712cd',
    se: '01a1cf0d-4e06-7698-aa87-234c0bc7705b',
    e: '01a1cf0d-4e06-7699-8813-c34df4517957',
    ne: '01a1cf0d-4e06-769a-a735-674bcbfb998a',
    nw: '01a1cf0d-4e06-769b-bb56-7d92d85b97cc',
    w: '01a1cf0d-4e06-769c-8c4d-c0e8f4bba68e',
  },
  wall: {
    south: '01a1cf0d-4e06-769d-92aa-714dd093a79e',
    eastLow: '01a1cf0d-4e06-769e-81a5-2faaebbbbb77',
    eastHigh: '01a1cf0d-4e06-769f-9465-6a69e072d442',
    north: '01a1cf0d-4e06-76a0-ad63-32ded564d2df',
    westHigh: '01a1cf0d-4e06-76a1-b6cf-a5c9170f5ba6',
    westLow: '01a1cf0d-4e06-76a2-8181-18861db1c15c',
    arc: '01a1cf0d-4e06-76a3-a4de-2b7fa6d56054',
  },
  opening: { door: '01a1cf0d-f595-7089-891f-f895ebd9d17a' },
  room: { north: '01a1cf0d-f595-708a-8562-e022f8424d34', south: '01a1cf0d-f595-708b-abb0-f234907426c6' },
} as const;

/**
 * A 6 x 8 flat cut in two by an arc partition from (0, 0) to (6, 0) of radius
 * 3.2, bulging to -z: the north room takes the bowl under the chord, the south
 * room the strip below the arc. The door sits 0.8 m along the arc from its west
 * end, where the wall runs at about 70 degrees to its chord.
 */
const arcPlan: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: ARC.scene,
  name: 'Arc partition test plan',
  ceilingHeight: 2.7,
  nodes: [
    { id: ARC.node.sw, p: { x: 0, z: -4 } },
    { id: ARC.node.se, p: { x: 6, z: -4 } },
    { id: ARC.node.e, p: { x: 6, z: 0 } },
    { id: ARC.node.ne, p: { x: 6, z: 4 } },
    { id: ARC.node.nw, p: { x: 0, z: 4 } },
    { id: ARC.node.w, p: { x: 0, z: 0 } },
  ],
  walls: [
    { id: ARC.wall.south, a: ARC.node.sw, b: ARC.node.se, thickness: 0.3, role: 'facade' },
    { id: ARC.wall.eastLow, a: ARC.node.se, b: ARC.node.e, thickness: 0.3, role: 'facade' },
    { id: ARC.wall.eastHigh, a: ARC.node.e, b: ARC.node.ne, thickness: 0.3, role: 'facade' },
    { id: ARC.wall.north, a: ARC.node.ne, b: ARC.node.nw, thickness: 0.3, role: 'facade' },
    { id: ARC.wall.westHigh, a: ARC.node.nw, b: ARC.node.w, thickness: 0.3, role: 'facade' },
    { id: ARC.wall.westLow, a: ARC.node.w, b: ARC.node.sw, thickness: 0.3, role: 'facade' },
    {
      id: ARC.wall.arc,
      a: ARC.node.w,
      b: ARC.node.e,
      thickness: 0.1,
      role: 'partition',
      arc: { radius: 3.2, ccw: false },
      openings: [{ id: ARC.opening.door, type: 'door', center: 0.8, width: 0.8, sill: 0, head: 2.1 }],
    },
  ],
  rooms: [
    { id: ARC.room.north, name: 'North room', anchor: { x: 3, z: 2 }, floorMaterial: FINISH.oak },
    { id: ARC.room.south, name: 'South room', anchor: { x: 3, z: -3.2 }, floorMaterial: FINISH.stone },
  ],
  assets: [],
  presentationCamera: { position: { x: 3, y: 8, z: 10 }, target: { x: 3, y: 1, z: 0 } },
  roomCameras: {},
  navigation: { points: [] },
  autotour: { path: [], gaze: [] },
};

/** A fixed UUID v7 literal for the zoned fixture's door, generated once. */
const ZONED_DOOR = '01a1cf26-bc5b-76f4-a681-8c6e9afe2f73';

/** A fixed UUID v7 literal for the zone on room B's floor at the partition door. */
const ZONED_DOOR_ZONE = '01a1cf3c-99cf-7490-92f2-13c9ee590812';

describe('doorLeaf', () => {
  test('a door with no explicit hinge or swing answers the derived jamb and side', () => {
    // At 1.25 m on a 6 m wall the derived hinge is the jamb farther from node a's end: b.
    // The entrance sits in an exterior wall, so it opens into its only room.
    expect(doorLeaf(lShapePlan, ENTRY)).toEqual({
      hinge: 'b',
      swing: 'in',
      leaves: 1,
      explicit: { hinge: false, swing: false },
      rooms: { in: L_SHAPE.room.a, out: null },
    });
  });

  test('a partition door names the room on each side; the current swing names the one the drawn leaf opens into', () => {
    const plan = solvePlan(lShapePlan);
    const leaf = doorLeaf(lShapePlan, DOOR_AB, plan)!;
    // The partition runs n2 -> n5 (north); its left, the interior, is room A.
    expect(leaf.rooms).toEqual({ in: L_SHAPE.room.a, out: L_SHAPE.room.b });
    const drawn = doorSwings(lShapePlan, plan, openingFrameWidth).find((swing) => swing.openingId === DOOR_AB)!;
    expect(leaf.rooms[leaf.swing]).toBe(drawn.roomId);

    const scene = opDraft();
    applyOp(scene, { op: 'set_opening', openingId: DOOR_AB, swing: 'out' }, CATALOGUE_REGISTRIES);
    const flipped = doorLeaf(scene, DOOR_AB)!;
    expect(flipped.rooms).toEqual({ in: L_SHAPE.room.a, out: L_SHAPE.room.b });
    expect(flipped.rooms[flipped.swing]).toBe(L_SHAPE.room.b);
  });

  test('a facade door has no room on its outer side, whichever way it opens', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_opening', openingId: ENTRY, swing: 'out' }, CATALOGUE_REGISTRIES);
    expect(doorLeaf(scene, ENTRY)?.rooms).toEqual({ in: L_SHAPE.room.a, out: null });
  });

  test('an arc partition door names the room on each side and agrees with the drawn swing', () => {
    const plan = solvePlan(arcPlan);
    const leaf = doorLeaf(arcPlan, ARC.opening.door, plan)!;
    // At the door the wall runs south-east; its left, the concave side, is the north room.
    expect(leaf.rooms).toEqual({ in: ARC.room.north, out: ARC.room.south });
    const drawn = doorSwings(arcPlan, plan, openingFrameWidth)[0]!;
    expect(leaf.rooms[leaf.swing]).toBe(drawn.roomId);
  });

  test('a door that opens onto a zone names the zone, not the room the zone lies in', () => {
    // The kitchen zone runs along the east wall from z = 2 to z = 5; a door at z = 3.5 opens onto its floor.
    const withDoor = (center: number): SceneData => {
      const scene = zonedLivingPlan([zone(ZONED.room.kitchen, 'Kitchen', ZONE_OUTLINES.kitchen)]);
      const door = { id: ZONED_DOOR, type: 'door', center, width: 0.9, sill: 0, head: 2.1, swing: 'in' } as const;
      return { ...scene, walls: scene.walls.map((wall) => (wall.id === ZONED.wall.east ? { ...wall, openings: [door] } : wall)) };
    };
    expect(doorLeaf(withDoor(3.5), ZONED_DOOR)?.rooms).toEqual({ in: ZONED.room.kitchen, out: null });

    // Slid to z = 6.5 it opens onto the living room's own floor again.
    expect(doorLeaf(withDoor(6.5), ZONED_DOOR)?.rooms).toEqual({ in: ZONED.room.living, out: null });
  });

  test('a narrow door in a thick wall still names the zone beyond the wall face', () => {
    // A 0.6 m door in a 0.5 m east wall, whose inner face is x = 9.75: half its
    // leaf ends inside the wall, short of the kitchen zone outlined up to that face.
    const kitchen = [
      { x: 7.1, z: 2 },
      { x: 9.75, z: 2 },
      { x: 9.75, z: 5 },
      { x: 7.1, z: 5 },
    ];
    const scene = zonedLivingPlan([zone(ZONED.room.kitchen, 'Kitchen', kitchen)]);
    const door = { id: ZONED_DOOR, type: 'door', center: 3.5, width: 0.6, sill: 0, head: 2.1, swing: 'in' } as const;
    const thick: SceneData = {
      ...scene,
      walls: scene.walls.map((wall) => (wall.id === ZONED.wall.east ? { ...wall, thickness: 0.5, openings: [door] } : wall)),
    };
    expect(doorLeaf(thick, ZONED_DOOR)?.rooms).toEqual({ in: ZONED.room.kitchen, out: null });
  });

  test('a partition door opening out onto a zone names the zone on that side', () => {
    // Room B lies east of the partition (x = 6); a zone outlined on its floor at the doorway.
    const scene = opDraft();
    scene.rooms.push({
      id: ZONED_DOOR_ZONE,
      name: 'Reading corner',
      anchor: { x: 7, z: 2.5 },
      polygon: [
        { x: 6.15, z: 1.5 },
        { x: 8, z: 1.5 },
        { x: 8, z: 3.5 },
        { x: 6.15, z: 3.5 },
      ],
      floorMaterial: FINISH.oak,
    });
    applyOp(scene, { op: 'set_opening', openingId: DOOR_AB, swing: 'out' }, CATALOGUE_REGISTRIES);
    const leaf = doorLeaf(scene, DOOR_AB)!;
    expect(leaf.rooms).toEqual({ in: L_SHAPE.room.a, out: ZONED_DOOR_ZONE });
    expect(leaf.rooms[leaf.swing]).toBe(ZONED_DOOR_ZONE);
  });

  test('explicit values are answered as the document carries them', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_opening', openingId: ENTRY, hinge: 'a', swing: 'out' }, CATALOGUE_REGISTRIES);
    expect(doorLeaf(scene, ENTRY)).toMatchObject({ hinge: 'a', swing: 'out', leaves: 1, explicit: { hinge: true, swing: true } });

    applyOp(scene, { op: 'set_opening', openingId: ENTRY, swing: null }, CATALOGUE_REGISTRIES);
    expect(doorLeaf(scene, ENTRY)).toMatchObject({ hinge: 'a', swing: 'in', leaves: 1, explicit: { hinge: true, swing: false } });
  });

  test('the derived hinge changes jamb when the door slides past the middle of its wall', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_opening', openingId: ENTRY, center: 4.75 }, CATALOGUE_REGISTRIES);
    expect(doorLeaf(scene, ENTRY)?.hinge).toBe('a');
  });

  test('a double variant answers two leaves, a single one answers one', () => {
    const scene = opDraft();
    openingOf(scene, DOOR_AB).variant = OPENING_VARIANT.door_white_double;
    expect(doorLeaf(scene, DOOR_AB)?.leaves).toBe(2);
    openingOf(scene, DOOR_AB).variant = OPENING_VARIANT.door_white_flat_bar;
    expect(doorLeaf(scene, DOOR_AB)?.leaves).toBe(1);
  });

  test('a window, a passage or an unknown id answers null', () => {
    expect(doorLeaf(lShapePlan, L_SHAPE.opening.windowASouth)).toBeNull();
    expect(doorLeaf(lShapePlan, '01a1f7a0-5b10-7c00-8a00-0000000000ff')).toBeNull();
    const scene = opDraft();
    openingOf(scene, DOOR_AB).type = 'passage';
    expect(doorLeaf(scene, DOOR_AB)).toBeNull();
  });

  test('a solved plan handed in answers the same leaf, and what the drawing resolves for every door', () => {
    const plan = solvePlan(lShapePlan);
    expect(doorLeaf(lShapePlan, ENTRY, plan)).toEqual(doorLeaf(lShapePlan, ENTRY));
    const drawn = doorSwings(lShapePlan, plan, openingFrameWidth);
    expect(drawn.length).toBeGreaterThan(1);
    for (const swing of drawn) {
      const leaf = doorLeaf(lShapePlan, swing.openingId, plan);
      expect(leaf && { hinge: leaf.hinge, swing: leaf.swing }).toEqual({ hinge: swing.hinge, swing: swing.swing });
    }
  });
});
