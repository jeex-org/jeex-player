/**
 * A 1.3 x 1.9 bathroom with a door in each short wall, both near its east
 * side: the plan the circulation tests walk a small room's 0.6 m path on.
 * Every wall is 0.10 thick, so the inner faces sit 0.05 inside the
 * centreline.
 *
 *      z=0     A(0,0)    door-north     B(1.4,0)
 *               +-----------====-----+
 *               |                    |
 *               |   bath             |
 *               |   (1.3 x 1.9 in)   |
 *               |                    |
 *               +-----------====-----+
 *      z=2.0   D(0,2)    door-south     C(1.4,2)
 *
 * - The inner faces are x = 0.05..1.35 and z = 0.05..1.95.
 * - Both doors are 0.60 wide at x = 1.02 (0.72..1.32), so a piece along the
 *   west wall leaves the path between them on the east side.
 * - No opening authors a swing.
 */

import { FINISH } from '../materials/finish-ids.js';
import type { SceneData } from '../scene/types.js';

export const BATH_TWO_DOORS = {
  scene: '01a17a4c-b813-73cb-868d-fd052483ad6c',
  node: {
    a: '01a17a4c-b813-73cc-a803-86d8d3ea6b69',
    b: '01a17a4c-b813-73cd-8fbb-7982e46a5972',
    c: '01a17a4c-b813-73ce-ad22-52f0bf27be3b',
    d: '01a17a4c-b813-73cf-924c-3fa1cb136d03',
  },
  wall: {
    north: '01a17a4c-b813-73d0-940f-7538d6fa4c1c',
    east: '01a17a4c-b813-73d1-8d8e-2bfa4dba951a',
    south: '01a17a4c-b813-73d2-8ae2-b26b52ee2c32',
    west: '01a17a4c-b813-73d3-aa7d-3496d2ff31ae',
  },
  opening: {
    doorNorth: '01a17a4c-b813-73d4-ac79-9170721708c9',
    doorSouth: '01a17a4c-b813-73d5-be10-ccc5373e70c2',
  },
  room: {
    bath: '01a17a4c-b813-73d6-9677-0469c1b74282',
  },
} as const;

const W = BATH_TWO_DOORS.wall;
const N = BATH_TWO_DOORS.node;

export const bathTwoDoorsPlan: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: BATH_TWO_DOORS.scene,
  name: 'Bathroom with two doors test plan',
  ceilingHeight: 2.7,
  nodes: [
    { id: N.a, p: { x: 0, z: 0 } },
    { id: N.b, p: { x: 1.4, z: 0 } },
    { id: N.c, p: { x: 1.4, z: 2 } },
    { id: N.d, p: { x: 0, z: 2 } },
  ],
  walls: [
    {
      id: W.north,
      a: N.a,
      b: N.b,
      thickness: 0.1,
      role: 'facade',
      openings: [{ id: BATH_TWO_DOORS.opening.doorNorth, type: 'door', entrance: true, center: 1.02, width: 0.6, sill: 0, head: 2.1 }],
    },
    { id: W.east, a: N.b, b: N.c, thickness: 0.1, role: 'facade' },
    {
      id: W.south,
      a: N.c,
      b: N.d,
      thickness: 0.1,
      role: 'facade',
      openings: [{ id: BATH_TWO_DOORS.opening.doorSouth, type: 'door', center: 0.38, width: 0.6, sill: 0, head: 2.1 }],
    },
    { id: W.west, a: N.d, b: N.a, thickness: 0.1, role: 'facade' },
  ],
  rooms: [{ id: BATH_TWO_DOORS.room.bath, name: 'Bathroom', anchor: { x: 0.7, z: 1 }, floorMaterial: FINISH.oak }],
  assets: [],
  presentationCamera: { position: { x: 0.7, y: 6, z: 5 }, target: { x: 0.7, y: 1, z: 1 } },
  roomCameras: {},
  navigation: { points: [{ x: 1, y: 0, z: 1 }] },
  autotour: { speed: 1.2, path: [{ x: 1, y: 1.6, z: 1 }], gaze: [], zones: [] },
};
