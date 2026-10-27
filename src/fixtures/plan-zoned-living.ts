/**
 * One wall-bounded living room with the zones a recognised plan outlines
 * inside it (a dining corner, a kitchen run, a hall): the plan the floor
 * ownership tests cut. The zones are rooms with their own `polygon`; each test
 * picks which of them the scene carries.
 *
 * Every wall is 0.20 thick, so the room's inner faces are x = 0.1..9.9 and
 * z = 0.1..7.9: 9.8 x 7.8 = 76.44 m².
 *
 *      z=0    A(0,0) +-----------------------------------------+ B(10,0)
 *                    | dining  |                               |
 *                    | 4 x 3.5 |                    | kitchen  |
 *                    +---------+     living         | 2.8 x 3  |
 *                    |                              +----------|
 *                    |                 hall                    |
 *      z=8    D(0,8) +---------------[ 2 x 1.1 ]---------------+ C(10,8)
 *
 * - `dining` shares the north and west faces exactly; `kitchen` the east face.
 * - `hall` reaches 0.2 m past the south face, as a traced zone does: 0.9 of
 *   its 1.1 m depth (82 %) lies in the room.
 */

import { FINISH } from '../materials/finish-ids.js';
import type { Room, SceneData, Vec2 } from '../scene/types.js';

export const ZONED = {
  scene: '01a17b8a-1511-758a-b811-931ef6e1e2df',
  node: {
    a: '01a17b8a-1511-758b-8b43-c6f48c80b937',
    b: '01a17b8a-1511-758c-ad4a-4a995f2991ba',
    c: '01a17b8a-1511-758d-95b6-48605a62108a',
    d: '01a17b8a-1511-758e-96ff-e0396fdc7d6f',
  },
  wall: {
    north: '01a17b8a-1511-758f-9a70-37afd60efd46',
    east: '01a17b8a-1511-7590-bf70-24e1fc80c22a',
    south: '01a17b8a-1511-7591-b69f-902914a2651e',
    west: '01a17b8a-1511-7592-a969-7c493867ea8f',
  },
  room: {
    living: '01a17b8a-1511-7593-b6f6-946d257bdd28',
    dining: '01a17b8a-1511-7594-9c5c-2a9ceaa94083',
    kitchen: '01a17b8a-1511-7595-999d-54ff3d2d557d',
    hall: '01a17b8a-1511-7596-9c76-6ad2399900f5',
    other: '01a17b8a-1511-7597-b8b4-cb9d1659cf69',
  },
} as const;

/** An axis-aligned outline, corners in order. */
export function box(x0: number, z0: number, x1: number, z1: number): Vec2[] {
  return [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
}

/** The three zones of the drawing, by id. */
export const ZONE_OUTLINES = {
  dining: box(0.1, 0.1, 4.1, 3.6),
  kitchen: box(7.1, 2, 9.9, 5),
  hall: box(4.5, 7, 6.5, 8.1),
} as const;

/** A zone room: its own outline, its anchor at the outline's first corner nudged in. */
export function zone(id: string, name: string, polygon: readonly Vec2[]): Room {
  const [first] = polygon;
  return { id, name, anchor: { x: first!.x + 0.05, z: first!.z + 0.05 }, polygon: [...polygon], floorMaterial: FINISH.oak };
}

const N = ZONED.node;

/** The living room with `zones` outlined in it; its anchor (2, 2) lies in the dining corner. */
export function zonedLivingPlan(zones: readonly Room[]): SceneData {
  return {
    schemaVersion: '2.4',
    units: 'm',
    id: ZONED.scene,
    name: 'Zoned living room test plan',
    ceilingHeight: 2.7,
    nodes: [
      { id: N.a, p: { x: 0, z: 0 } },
      { id: N.b, p: { x: 10, z: 0 } },
      { id: N.c, p: { x: 10, z: 8 } },
      { id: N.d, p: { x: 0, z: 8 } },
    ],
    walls: [
      { id: ZONED.wall.north, a: N.a, b: N.b, thickness: 0.2, role: 'facade' },
      { id: ZONED.wall.east, a: N.b, b: N.c, thickness: 0.2, role: 'facade' },
      { id: ZONED.wall.south, a: N.c, b: N.d, thickness: 0.2, role: 'facade' },
      { id: ZONED.wall.west, a: N.d, b: N.a, thickness: 0.2, role: 'facade' },
    ],
    rooms: [{ id: ZONED.room.living, name: 'Living room', anchor: { x: 2, z: 2 }, floorMaterial: FINISH.oak }, ...zones],
    assets: [],
    presentationCamera: { position: { x: 5, y: 12, z: 12 }, target: { x: 5, y: 0, z: 4 } },
    roomCameras: {},
    navigation: { points: [{ x: 5, y: 0, z: 4 }] },
    autotour: { speed: 1.2, path: [{ x: 5, y: 1.6, z: 4 }], gaze: [], zones: [] },
  };
}
