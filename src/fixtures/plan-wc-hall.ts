/**
 * A small hall with three doors, a 1.2 x 1.25 WC off it and a room beyond:
 * the plan the door clear-zone tests measure the push and pull sides on.
 * Every wall is 0.10 thick, so a room's inner face sits 0.05 inside the
 * centreline.
 *
 *      z=0     A(0,0)                              B(4,0)
 *               +-----------------------------------+
 *        entry  |            hall (4.0 x 1.45 in)   |
 *      z=1.55  G+--- door-wc ---H----- door-room ---+I
 *               |   WC          |                   |
 *               |  (1.2 x 1.25) |       room        |
 *      z=2.90  F+---------------+E                  |
 *                               |                   |
 *      z=4.2                   D+-------------------+C
 *
 * - The hall's inner faces are z = 0.05 (north) and z = 1.50 (south): 1.45 m.
 * - The WC's inner faces are x = 0.05..1.25 and z = 1.60..2.85: 1.2 x 1.25.
 * - `doorWc` is 0.70 wide at x = 0.65, `doorRoom` 0.80 wide at x = 2.30, and
 *   `doorEntry` 0.90 wide in the west wall at z = 0.775, hinged on G so its
 *   leaf sweeps the hall's west end.
 * - No opening authors a swing: a test sets the side it needs.
 */

import { FINISH } from '../materials/finish-ids.js';
import type { SceneData } from '../scene/types.js';

export const WC_HALL = {
  scene: '01a179fe-0f92-7467-b1fd-2131bf58e592',
  node: {
    a: '01a179fe-0f92-7468-9861-068c50dda32b',
    b: '01a179fe-0f92-7469-8bdf-71bf0d276608',
    c: '01a179fe-0f92-746a-a7af-201116de561f',
    d: '01a179fe-0f92-746b-94e8-a77629d2113a',
    e: '01a179fe-0f92-746c-9571-1cf5282f3d8e',
    f: '01a179fe-0f92-746d-b89a-a3a6db7cc852',
    g: '01a179fe-0f92-746e-b0e4-6446e414f53b',
    h: '01a179fe-0f92-746f-9e09-be0eff63cd48',
    i: '01a179fe-0f92-7470-b508-173813c2f3a2',
  },
  wall: {
    north: '01a179fe-0f92-7471-bd4e-0359c38b9460',
    eastHall: '01a179fe-0f92-7472-be49-95a3645d9216',
    eastRoom: '01a179fe-0f92-7473-86d0-7986bc0cb9be',
    south: '01a179fe-0f92-7474-acbd-c153184a12b8',
    roomWest: '01a179fe-0f92-7475-bcf7-2cb44a18abfa',
    wcSouth: '01a179fe-0f92-7476-8523-50542dd6ce48',
    wcWest: '01a179fe-0f92-7477-af2f-cabcd2b808b0',
    hallWest: '01a179fe-0f92-7478-9e0e-ba7ada08df46',
    hallWc: '01a179fe-0f92-7479-8c9c-3f442bcb6861',
    hallRoom: '01a179fe-0f92-747a-a380-1df02a68c5f8',
    wcRoom: '01a179fe-0f92-747b-94a4-a5d8b33fa0ba',
  },
  opening: {
    doorEntry: '01a179fe-0f92-747c-a4cc-dad85ba1c05c',
    doorWc: '01a179fe-0f92-747d-b7d6-54deac3ee570',
    doorRoom: '01a179fe-0f92-747e-adaf-bab644d20771',
  },
  room: {
    hall: '01a179ff-6a10-7d2e-8b41-3c9f0e7a5b01',
    wc: '01a179ff-6a10-7d2e-8b41-3c9f0e7a5b02',
    room: '01a179ff-6a10-7d2e-8b41-3c9f0e7a5b03',
  },
} as const;

const W = WC_HALL.wall;
const N = WC_HALL.node;

export const wcHallPlan: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: WC_HALL.scene,
  name: 'WC and hall test plan',
  ceilingHeight: 2.7,
  nodes: [
    { id: N.a, p: { x: 0, z: 0 } },
    { id: N.b, p: { x: 4, z: 0 } },
    { id: N.c, p: { x: 4, z: 4.2 } },
    { id: N.d, p: { x: 1.3, z: 4.2 } },
    { id: N.e, p: { x: 1.3, z: 2.9 } },
    { id: N.f, p: { x: 0, z: 2.9 } },
    { id: N.g, p: { x: 0, z: 1.55 } },
    { id: N.h, p: { x: 1.3, z: 1.55 } },
    { id: N.i, p: { x: 4, z: 1.55 } },
  ],
  walls: [
    { id: W.north, a: N.a, b: N.b, thickness: 0.1, role: 'facade' },
    { id: W.eastHall, a: N.b, b: N.i, thickness: 0.1, role: 'facade' },
    { id: W.eastRoom, a: N.i, b: N.c, thickness: 0.1, role: 'facade' },
    { id: W.south, a: N.c, b: N.d, thickness: 0.1, role: 'facade' },
    { id: W.roomWest, a: N.d, b: N.e, thickness: 0.1, role: 'facade' },
    { id: W.wcSouth, a: N.e, b: N.f, thickness: 0.1, role: 'facade' },
    { id: W.wcWest, a: N.f, b: N.g, thickness: 0.1, role: 'facade' },
    {
      id: W.hallWest,
      a: N.g,
      b: N.a,
      thickness: 0.1,
      role: 'facade',
      openings: [
        { id: WC_HALL.opening.doorEntry, type: 'door', entrance: true, center: 0.775, width: 0.9, sill: 0, head: 2.1, hinge: 'a' },
      ],
    },
    {
      id: W.hallWc,
      a: N.g,
      b: N.h,
      thickness: 0.1,
      role: 'partition',
      openings: [{ id: WC_HALL.opening.doorWc, type: 'door', center: 0.65, width: 0.7, sill: 0, head: 2.1 }],
    },
    {
      id: W.hallRoom,
      a: N.h,
      b: N.i,
      thickness: 0.1,
      role: 'partition',
      openings: [{ id: WC_HALL.opening.doorRoom, type: 'door', center: 1.0, width: 0.8, sill: 0, head: 2.1 }],
    },
    { id: W.wcRoom, a: N.h, b: N.e, thickness: 0.1, role: 'partition' },
  ],
  rooms: [
    { id: WC_HALL.room.hall, name: 'Hall', anchor: { x: 2, z: 0.7 }, floorMaterial: FINISH.oak },
    { id: WC_HALL.room.wc, name: 'WC', anchor: { x: 0.65, z: 2.2 }, floorMaterial: FINISH.oak },
    { id: WC_HALL.room.room, name: 'Room', anchor: { x: 2.6, z: 2.9 }, floorMaterial: FINISH.oak },
  ],
  assets: [],
  presentationCamera: { position: { x: 2, y: 8, z: 9 }, target: { x: 2, y: 1, z: 2 } },
  roomCameras: {},
  navigation: { points: [{ x: 2, y: 0, z: 0.7 }] },
  autotour: { speed: 1.2, path: [{ x: 2, y: 1.6, z: 0.7 }], gaze: [], zones: [] },
};
