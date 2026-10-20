/**
 * Schema 2.0 test plans used by the solver, validator and navigation tests.
 *
 * `lShapePlan` is the reference L-shape plan of the wall system: two rooms sharing a
 * 0.10 partition whose centreline continues into a 0.30 outer wall, so room A
 * steps by 0.10 at z = 5 (the `jog` case). Verified numbers:
 * - room A face on the partition sits at x = 5.95, room B at x = 6.05;
 * - the jog vertices are (5.95, 5.0) and (5.85, 5.0);
 * - room A's south face is 5.80 m long, 3.15 m high and decomposes into six
 *   quads of 13.06 m2 around the entry door and the south window.
 *
 * `bayPlan` is a 4 x 4 room whose north wall is a semicircular bay of radius
 * 2.0: the straight walls are tangent to the arc, so the offset joints land
 * exactly on the concentric arcs (R - 0.15 inside, R + 0.15 outside).
 *
 *      z=0    n1(0,0)         n2(6,0)          n3(10,0)
 *              +---------------+----------------+
 *              |               |                |
 *              |    room A     | 0.10 partition |   room B
 *              |   (6 x 8)     |                |   (4 x 5)
 *      z=5     |             n5+----------------+ n4(10,5)
 *              |               |  0.30 outer wall (w-step)
 *              |            n6(6,8)
 *      z=8     +---------------+
 *            n7(0,8)
 */

import { FINISH } from '../materials/finish-ids.js';
import type { MaterialDefinition, SceneData } from '../scene/types.js';
import { BAY, L_SHAPE, PLAN_MATERIAL } from './plan-l-shape-ids.js';

/**
 * Scene-local materials, declared so the `materials[]` path has something to
 * read. The rooms floor in catalogue finishes and the furniture wears catalogue
 * finishes, as an editor-authored scene does.
 */
const MATERIALS: MaterialDefinition[] = [
  { id: PLAN_MATERIAL.oak, name: 'Natural oak', color: '#b8895a', roughness: 0.54 },
  { id: PLAN_MATERIAL.stone, name: 'Warm limestone', color: '#c8beb0', roughness: 0.76 },
  { id: PLAN_MATERIAL.white, name: 'Cabinet white', color: '#f1ebdf', roughness: 0.6 },
];

export const lShapePlan: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: L_SHAPE.scene,
  name: 'L-shape test plan',
  ceilingHeight: 3.15,
  nodes: [
    { id: L_SHAPE.node.n1, p: { x: 0, z: 0 } },
    { id: L_SHAPE.node.n2, p: { x: 6, z: 0 } },
    { id: L_SHAPE.node.n3, p: { x: 10, z: 0 } },
    { id: L_SHAPE.node.n4, p: { x: 10, z: 5 } },
    { id: L_SHAPE.node.n5, p: { x: 6, z: 5 } },
    { id: L_SHAPE.node.n6, p: { x: 6, z: 8 } },
    { id: L_SHAPE.node.n7, p: { x: 0, z: 8 } },
  ],
  walls: [
    {
      id: L_SHAPE.wall.wSA,
      a: L_SHAPE.node.n1,
      b: L_SHAPE.node.n2,
      thickness: 0.3,
      role: 'facade',
      openings: [
        // Face coordinates on room A's side: 0.60..1.60 and 3.00..5.00.
        { id: L_SHAPE.opening.doorEntry, type: 'door', entrance: true, center: 1.25, width: 1.0, sill: 0, head: 2.15 },
        { id: L_SHAPE.opening.windowASouth, type: 'window', center: 4.15, width: 2.0, sill: 0.82, head: 2.35 },
      ],
    },
    { id: L_SHAPE.wall.wSB, a: L_SHAPE.node.n2, b: L_SHAPE.node.n3, thickness: 0.3, role: 'facade' },
    {
      id: L_SHAPE.wall.wE,
      a: L_SHAPE.node.n3,
      b: L_SHAPE.node.n4,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: L_SHAPE.opening.windowBEast, type: 'window', center: 2.5, width: 1.6, sill: 0.82, head: 2.35 }],
    },
    { id: L_SHAPE.wall.wNB, a: L_SHAPE.node.n4, b: L_SHAPE.node.n5, thickness: 0.3, role: 'facade' },
    { id: L_SHAPE.wall.wStep, a: L_SHAPE.node.n5, b: L_SHAPE.node.n6, thickness: 0.3, role: 'facade' },
    { id: L_SHAPE.wall.wNA, a: L_SHAPE.node.n6, b: L_SHAPE.node.n7, thickness: 0.3, role: 'facade' },
    { id: L_SHAPE.wall.wW, a: L_SHAPE.node.n7, b: L_SHAPE.node.n1, thickness: 0.3, role: 'facade' },
    {
      id: L_SHAPE.wall.wPart,
      a: L_SHAPE.node.n2,
      b: L_SHAPE.node.n5,
      thickness: 0.1,
      role: 'partition',
      openings: [{ id: L_SHAPE.opening.doorAb, type: 'door', center: 2.5, width: 0.9, sill: 0, head: 2.1 }],
    },
  ],
  rooms: [
    { id: L_SHAPE.room.a, name: 'Room A', anchor: { x: 3, z: 4 }, floorMaterial: FINISH.oak },
    { id: L_SHAPE.room.b, name: 'Room B', anchor: { x: 8, z: 2.5 }, floorMaterial: FINISH.stone },
  ],
  materials: MATERIALS,
  assets: [
    { id: L_SHAPE.asset.sofa, type: 'sofa', position: { x: 2, z: 6, y: 0 }, rotationY: 0, material: FINISH.plaster_white },
    { id: L_SHAPE.asset.table, type: 'table', position: { x: 8, z: 2.5, y: 0 }, material: FINISH.oak_natural },
  ],
  presentationCamera: { position: { x: 5, y: 9, z: 16 }, target: { x: 5, y: 1, z: 4 } },
  // Authored on purpose: a scene without one is a legitimate case, but it is
  // reported (`camera-controller.ts` warns once per scene), and this fixture is
  // mounted by dozens of tests. The pose is room A's camera, which is also its
  // first navigation point, so every assertion written against the derived
  // spawn still holds.
  walkSpawn: { position: { x: 3, y: 1.6, z: 4 }, target: { x: 5, y: 1.4, z: 1 } },
  roomCameras: {
    [L_SHAPE.room.a]: { position: { x: 3, y: 1.6, z: 4 }, target: { x: 5, y: 1.4, z: 1 } },
    [L_SHAPE.room.b]: { position: { x: 8, y: 1.6, z: 2.5 }, target: { x: 9.5, y: 1.4, z: 2.5 } },
  },
  navigation: {
    points: [
      { x: 3, y: 0, z: 4 },
      { x: 6, y: 0, z: 2.5 },
      { x: 8, y: 0, z: 2.5 },
    ],
  },
  autotour: {
    speed: 1.2,
    path: [
      { x: 1.25, y: 1.6, z: 1 },
      { x: 3, y: 1.6, z: 4 },
      { x: 6, y: 1.6, z: 2.5 },
      { x: 8, y: 1.6, z: 2.5 },
    ],
    gaze: [{ at: 1, target: { x: 4.15, y: 1.5, z: 0 } }],
    zones: [{ at: 2, speed: 0.9 }],
  },
};

/**
 * `lShapePlan` without an authored `walkSpawn`, so the walk entry has to
 * be DERIVED from the plan.
 *
 * It lives here rather than being spread inline in a test (`{ ...lShapePlan }`)
 * because a spread silently inherits whatever the base fixture grows: the day
 * `lShapePlan` authored a spawn, every "a scene that authored none" test
 * started testing the opposite of its own name.
 */
export const spawnlessLShapePlan: SceneData = (() => {
  const { walkSpawn: _authored, ...rest } = lShapePlan;
  return rest;
})();

/**
 * Semicircular bay: the north side of a 4 x 4 room is an arc of radius 2.0
 * bulging to -z. Room offset radius is 1.85, facade offset radius 2.15.
 */
export const bayPlan: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: BAY.scene,
  name: 'Semicircular bay test plan',
  ceilingHeight: 3.15,
  nodes: [
    { id: BAY.node.b1, p: { x: 0, z: 0 } },
    { id: BAY.node.b2, p: { x: 4, z: 0 } },
    { id: BAY.node.b3, p: { x: 4, z: 4 } },
    { id: BAY.node.b4, p: { x: 0, z: 4 } },
  ],
  walls: [
    {
      id: BAY.wall.bay,
      a: BAY.node.b1,
      b: BAY.node.b2,
      thickness: 0.3,
      role: 'facade',
      arc: { radius: 2, ccw: false },
      openings: [{ id: BAY.opening.windowBay, type: 'window', center: Math.PI, width: 1.6, sill: 0.82, head: 2.35 }],
    },
    { id: BAY.wall.bayE, a: BAY.node.b2, b: BAY.node.b3, thickness: 0.3, role: 'facade' },
    {
      id: BAY.wall.bayS,
      a: BAY.node.b3,
      b: BAY.node.b4,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: BAY.opening.doorBay, type: 'door', center: 2, width: 0.9, sill: 0, head: 2.1 }],
    },
    { id: BAY.wall.bayW, a: BAY.node.b4, b: BAY.node.b1, thickness: 0.3, role: 'facade' },
  ],
  rooms: [{ id: BAY.room.bayRoom, name: 'Bay room', anchor: { x: 2, z: 2 }, floorMaterial: FINISH.oak }],
  materials: MATERIALS,
  assets: [{ id: BAY.asset.armchair, type: 'armchair', position: { x: 2, z: -1, y: 0 }, material: FINISH.plaster_white }],
  presentationCamera: { position: { x: 2, y: 7, z: 12 }, target: { x: 2, y: 1, z: 1 } },
  roomCameras: { [BAY.room.bayRoom]: { position: { x: 2, y: 1.6, z: 2 }, target: { x: 2, y: 1.4, z: -1 } } },
  navigation: {
    points: [
      { x: 2, y: 0, z: 2 },
      { x: 2, y: 0, z: -1 },
    ],
  },
  autotour: {
    speed: 1.1,
    path: [
      { x: 2, y: 1.6, z: 3.4 },
      { x: 2, y: 1.6, z: 2 },
      { x: 2, y: 1.6, z: -1 },
    ],
    gaze: [{ at: 2, target: { x: 2, y: 1.5, z: -2 } }],
  },
};
