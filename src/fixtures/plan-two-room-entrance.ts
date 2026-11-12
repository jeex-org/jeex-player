/**
 * An 8 x 5 box split in two by a partition, with an entrance door in the
 * south facade and a door in the partition: the plan the opening pick tests
 * click both doors on. The facade is 0.30 thick, the partition 0.10.
 *
 *      z=0     A(0,0)  entrance   B(4,0)               C(8,0)
 *               +-----=====-------+--------------------+
 *               |                 |                    |
 *               |     living      =  door              |   bedroom
 *               |                 =  (z = 2.6)         |
 *               |                 |                    |
 *      z=5     F+-----------------+E-------------------+D
 *
 * - The entrance is 1.0 wide at x = 1.2 (0.7..1.7), head 2.1.
 * - The partition door is 0.9 wide at z = 2.6 (2.15..3.05), head 2.1.
 * - The ceiling is 2.7, so both walls stand 0.6 above both door heads.
 */

import { FINISH } from '../materials/finish-ids.js';
import type { SceneData } from '../scene/types.js';

export const TWO_ROOM_ENTRANCE = {
  scene: '01a1cede-e542-773c-a607-2217c4f521bb',
  node: {
    a: '01a1cede-e542-77f4-a804-0eb5366cbd03',
    b: '01a1cede-e542-7ae0-84e7-575e4912e5b6',
    c: '01a1cede-e542-7028-ad95-9a9fc6f6142a',
    d: '01a1cede-e542-7a87-97ea-3633f9c40e1e',
    e: '01a1cede-e542-7424-9ab2-74728e772812',
    f: '01a1cede-e542-7cd5-bd8d-ef0f460636d1',
  },
  wall: {
    livingSouth: '01a1cede-e542-79f9-835d-6b8565ac97d4',
    bedroomSouth: '01a1cede-e542-7995-a551-edeb0063ec3d',
    east: '01a1cede-e542-74b8-97f6-105a90f40cbb',
    bedroomNorth: '01a1cede-e542-7f49-8112-594b5dc0569c',
    livingNorth: '01a1cede-e542-76ab-9fa7-b8016c908b0d',
    west: '01a1cede-e542-7dcb-912c-b76106e8c598',
    partition: '01a1cede-e542-79f8-8588-4d19ebcfd24a',
  },
  opening: {
    entrance: '01a1cede-e542-7a61-bfa8-efc55cd92208',
    inner: '01a1cede-e542-7e01-9c71-cefb99493b8b',
  },
  room: {
    living: '01a1cede-e542-737d-b56c-f340f30d4c1b',
    bedroom: '01a1cede-e542-7f4d-882c-a78ec8e86195',
  },
} as const;

const N = TWO_ROOM_ENTRANCE.node;
const W = TWO_ROOM_ENTRANCE.wall;
const O = TWO_ROOM_ENTRANCE.opening;

export const twoRoomEntrancePlan: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: TWO_ROOM_ENTRANCE.scene,
  name: 'Two rooms with an entrance test plan',
  ceilingHeight: 2.7,
  nodes: [
    { id: N.a, p: { x: 0, z: 0 } },
    { id: N.b, p: { x: 4, z: 0 } },
    { id: N.c, p: { x: 8, z: 0 } },
    { id: N.d, p: { x: 8, z: 5 } },
    { id: N.e, p: { x: 4, z: 5 } },
    { id: N.f, p: { x: 0, z: 5 } },
  ],
  walls: [
    {
      id: W.livingSouth,
      a: N.a,
      b: N.b,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: O.entrance, type: 'door', entrance: true, center: 1.2, width: 1.0, sill: 0, head: 2.1 }],
    },
    { id: W.bedroomSouth, a: N.b, b: N.c, thickness: 0.3, role: 'facade' },
    { id: W.east, a: N.c, b: N.d, thickness: 0.3, role: 'facade' },
    { id: W.bedroomNorth, a: N.d, b: N.e, thickness: 0.3, role: 'facade' },
    { id: W.livingNorth, a: N.e, b: N.f, thickness: 0.3, role: 'facade' },
    { id: W.west, a: N.f, b: N.a, thickness: 0.3, role: 'facade' },
    {
      id: W.partition,
      a: N.b,
      b: N.e,
      thickness: 0.1,
      role: 'partition',
      openings: [{ id: O.inner, type: 'door', center: 2.6, width: 0.9, sill: 0, head: 2.1 }],
    },
  ],
  rooms: [
    { id: TWO_ROOM_ENTRANCE.room.living, name: 'Living room', anchor: { x: 2, z: 2.5 }, floorMaterial: FINISH.oak },
    { id: TWO_ROOM_ENTRANCE.room.bedroom, name: 'Bedroom', anchor: { x: 6, z: 2.5 }, floorMaterial: FINISH.walnut },
  ],
  assets: [],
  presentationCamera: { position: { x: 4, y: 9, z: 14 }, target: { x: 4, y: 1, z: 2.5 } },
  roomCameras: {},
  navigation: { points: [{ x: 2, y: 0, z: 2.5 }] },
  autotour: {
    speed: 1.2,
    path: [
      { x: 2, y: 1.6, z: 2.5 },
      { x: 6, y: 1.6, z: 2.5 },
    ],
    gaze: [],
    zones: [],
  },
};
