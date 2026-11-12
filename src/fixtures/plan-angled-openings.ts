/**
 * A small flat whose openings stand on walls that do not run along an axis:
 * the plan the opening world-placement tests build. Facades are 0.30 thick,
 * the partition 0.10.
 *
 *      z=0   SW(0,0)            SM(4.5,0)     SE(6,0)
 *             +--------------------+-------------+
 *             |                    |              )
 *             |      living        |    study      )  arc, radius 3,
 *      z=3   DW                    | (control door) ) bulging east
 *               \  30° diagonal    |              )
 *      z=5        +----------------+-------------+
 *               DN(3.46,5)       NM(4.5,5)      NE(6,5)
 *
 * - The diagonal runs from DW(0, 3) to DN(2√3, 5): 4 m at 30° to the x axis.
 *   It carries the entrance door (centre 1.0, 0.9 wide) and a window
 *   (centre 2.8, 1.2 wide).
 * - The east wall is an arc of radius 3 over the 5 m chord SE–NE, bulging
 *   east; its door (centre 1.5 m along the arc, 0.9 wide) sits off the apex,
 *   where the tangent runs along no axis.
 * - The partition runs along +z at x = 4.5; its door (centre 2.5, 0.8 wide)
 *   is the axis-aligned control.
 * - No door authors a swing: the plan decides it.
 */

import { FINISH } from '../materials/finish-ids.js';
import type { SceneData } from '../scene/types.js';
import { ANGLED, REVERSED } from './plan-angled-openings-ids.js';

const N = ANGLED.node;
const W = ANGLED.wall;

export const angledOpeningsPlan: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: ANGLED.scene,
  name: 'Angled openings test plan',
  ceilingHeight: 2.7,
  nodes: [
    { id: N.southWest, p: { x: 0, z: 0 } },
    { id: N.southMid, p: { x: 4.5, z: 0 } },
    { id: N.southEast, p: { x: 6, z: 0 } },
    { id: N.northEast, p: { x: 6, z: 5 } },
    { id: N.northMid, p: { x: 4.5, z: 5 } },
    { id: N.diagonalNorth, p: { x: 2 * Math.sqrt(3), z: 5 } },
    { id: N.diagonalWest, p: { x: 0, z: 3 } },
  ],
  walls: [
    { id: W.southLiving, a: N.southWest, b: N.southMid, thickness: 0.3, role: 'facade' },
    { id: W.southStudy, a: N.southMid, b: N.southEast, thickness: 0.3, role: 'facade' },
    {
      id: W.eastArc,
      a: N.southEast,
      b: N.northEast,
      thickness: 0.3,
      role: 'facade',
      arc: { radius: 3, ccw: false },
      openings: [{ id: ANGLED.opening.doorArc, type: 'door', center: 1.5, width: 0.9, sill: 0, head: 2.1 }],
    },
    { id: W.northStudy, a: N.northEast, b: N.northMid, thickness: 0.3, role: 'facade' },
    { id: W.northLiving, a: N.northMid, b: N.diagonalNorth, thickness: 0.3, role: 'facade' },
    {
      id: W.diagonal,
      a: N.diagonalWest,
      b: N.diagonalNorth,
      thickness: 0.3,
      role: 'facade',
      openings: [
        { id: ANGLED.opening.doorDiagonal, type: 'door', entrance: true, center: 1.0, width: 0.9, sill: 0, head: 2.1 },
        { id: ANGLED.opening.windowDiagonal, type: 'window', center: 2.8, width: 1.2, sill: 0.85, head: 2.3 },
      ],
    },
    { id: W.west, a: N.diagonalWest, b: N.southWest, thickness: 0.3, role: 'facade' },
    {
      id: W.partition,
      a: N.southMid,
      b: N.northMid,
      thickness: 0.1,
      role: 'partition',
      openings: [{ id: ANGLED.opening.doorControl, type: 'door', center: 2.5, width: 0.8, sill: 0, head: 2.1 }],
    },
  ],
  rooms: [
    { id: ANGLED.room.living, name: 'Living room', anchor: { x: 2, z: 1.5 }, floorMaterial: FINISH.oak },
    { id: ANGLED.room.study, name: 'Study', anchor: { x: 5.5, z: 2.5 }, floorMaterial: FINISH.oak },
  ],
  assets: [],
  presentationCamera: { position: { x: 3, y: 8, z: 10 }, target: { x: 3, y: 1, z: 2.5 } },
  roomCameras: {},
  navigation: { points: [{ x: 2, y: 0, z: 1.5 }] },
  autotour: { speed: 1.2, path: [{ x: 2, y: 1.6, z: 1.5 }], gaze: [], zones: [] },
};

/**
 * A 6 × 5 box cut in two by an interior partition at 60° to the x axis, drawn
 * from its NORTH end to its SOUTH end, so its tangent points down and to the
 * west (−120°): the wall frame's `x` runs against the tangent here. Facades
 * are 0.30 thick, the partition 0.10.
 *
 *      z=0   SW(0,0)      SM(2,0)                SE(6,0)
 *             +-------------+-----------------------+
 *             |              \                      |
 *             |    west       \  partition (b←a)    |
 *             |                \       east         |
 *             +-----------------+--------------------+
 *      z=5   NW(0,5)          NM(2+5/√3, 5)        NE(6,5)
 *
 * Its door (centre 2.9 of the partition's 5.77 m, 0.8 wide) is an interior
 * door, which the light-bake pass moves its frame for. No door authors a
 * swing: the plan decides it.
 */
const R = REVERSED.node;
const RW = REVERSED.wall;

export const reversedPartitionPlan: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: REVERSED.scene,
  name: 'Reversed partition test plan',
  ceilingHeight: 2.7,
  nodes: [
    { id: R.southWest, p: { x: 0, z: 0 } },
    { id: R.southMid, p: { x: 2, z: 0 } },
    { id: R.southEast, p: { x: 6, z: 0 } },
    { id: R.northEast, p: { x: 6, z: 5 } },
    { id: R.northMid, p: { x: 2 + 5 / Math.sqrt(3), z: 5 } },
    { id: R.northWest, p: { x: 0, z: 5 } },
  ],
  walls: [
    { id: RW.southWest, a: R.southWest, b: R.southMid, thickness: 0.3, role: 'facade' },
    { id: RW.southEast, a: R.southMid, b: R.southEast, thickness: 0.3, role: 'facade' },
    { id: RW.east, a: R.southEast, b: R.northEast, thickness: 0.3, role: 'facade' },
    { id: RW.northEast, a: R.northEast, b: R.northMid, thickness: 0.3, role: 'facade' },
    { id: RW.northWest, a: R.northMid, b: R.northWest, thickness: 0.3, role: 'facade' },
    { id: RW.west, a: R.northWest, b: R.southWest, thickness: 0.3, role: 'facade' },
    {
      id: RW.partition,
      a: R.northMid,
      b: R.southMid,
      thickness: 0.1,
      role: 'partition',
      openings: [{ id: REVERSED.opening.doorPartition, type: 'door', center: 2.9, width: 0.8, sill: 0, head: 2.1 }],
    },
  ],
  rooms: [
    { id: REVERSED.room.west, name: 'West room', anchor: { x: 1, z: 2.5 }, floorMaterial: FINISH.oak },
    { id: REVERSED.room.east, name: 'East room', anchor: { x: 5, z: 2.5 }, floorMaterial: FINISH.oak },
  ],
  assets: [],
  presentationCamera: { position: { x: 3, y: 8, z: 10 }, target: { x: 3, y: 1, z: 2.5 } },
  roomCameras: {},
  navigation: { points: [{ x: 1, y: 0, z: 2.5 }] },
  autotour: { speed: 1.2, path: [{ x: 1, y: 1.6, z: 2.5 }], gaze: [], zones: [] },
};
