/**
 * The demo apartment, schema 2.2: an invented two-bedroom flat with a study,
 * drawn for the player to show what it can do. It is no real property.
 *
 * A bearing spine runs east–west through the flat. North of it: the kitchen,
 * the bathroom, a WC and the guest bedroom. South of it: the entrance hall,
 * a corridor entered from the east facade, and then the L-shaped living and
 * dining room, the bedroom and the study. The living room's south facade
 * bulges out in a shallow curved bay (radius 2.20 m) with a window along the
 * arc, and a loggia runs along the south facade, reached from both the living
 * room and the bedroom.
 *
 * Wall centrelines, metres (Y up, plan in X–Z, X east, Z south):
 *
 *           X 0.00         4.40   6.80  8.20                      13.20
 *               |            |      |     |                          |
 *   Z 0.00      +============+======+=====+==========================+
 *               |            |      |     |                          |
 *               |  kitchen   | bath | WC  |      guest bedroom       |
 *               |            |      |     |                          |
 *   Z 3.60      +############+######+#####+##########################+
 *               |            |   e n t r a n c e   h a l l          [ entrance
 *   Z 5.20      |            +----------+--------------+-------------+
 *               |   living and dining   |              |             |
 *               |                       |   bedroom    |    study    |
 *               |                       |              |             |
 *   Z 9.20      +==-~~~~~~~~~-==========+==============+=============+
 *                   ` BAY  ´    |  l o g g i a                 |
 *   Z 10.70                     +==============================+
 *               X 0.90 … 4.30   5.60     7.00          11.00
 *
 *   `=` / `|` facade 0.30    `#` bearing spine 0.24    `-` partition 0.10
 *
 * Room interiors (inner wall faces), metres:
 *   kitchen       X 0.15 … 4.35   Z 0.15 … 3.48
 *   bathroom      X 4.45 … 6.75   Z 0.15 … 3.48
 *   wc            X 6.85 … 8.15   Z 0.15 … 3.48
 *   guest room    X 8.25 … 13.05  Z 0.15 … 3.48
 *   hall          X 4.45 … 13.05  Z 3.72 … 5.15
 *   living        X 0.15 … 4.35   Z 3.72 … 9.05, and X 0.15 … 6.95 Z 5.25 … 9.05,
 *                 plus the bay (inner radius 2.05 about 2.60, 7.80)
 *   bedroom       X 7.05 … 10.95  Z 5.25 … 9.05
 *   study         X 11.05 … 13.05 Z 5.25 … 9.05
 *   loggia        X 5.75 … 10.85  Z 9.35 … 10.55
 *
 * Ceiling 2.65; doors head 2.10, windows sill 0.85–0.90 / head 2.30.
 *
 * The labels above are the entities' readable names; their ids are the UUID
 * literals of `demo-ids.ts` (`NODE.spineEast`, `WALL.spineKitchen`,
 * `ROOM.living`), and every catalogue reference is the bundled entry's own
 * UUID constant (`FINISH.oak`, `OPENING_VARIANT.window_oak_vertical`). The plan
 * is exported as `apartmentScene` at the bottom of this file, furnished from
 * `demo-furniture.ts` and with the four interior presets of `demo-interiors.ts`
 * attached.
 */

import { OPENING_VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import type { SceneData } from '../scene/types.js';
import { demoFurniture } from './demo-furniture.js';
import { demoInteriors } from './demo-interiors.js';
import { DEMO } from './demo-ids.js';

const { node: NODE, wall: WALL, opening: OPENING, room: ROOM } = DEMO;

const baseApartment: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: DEMO.scene,
  name: 'Two-bedroom demo apartment',
  ceilingHeight: 2.65,

  nodes: [
    // North facade
    { id: NODE.northWest, p: { x: 0.0, z: 0.0 } },
    { id: NODE.kitchenBathN, p: { x: 4.4, z: 0.0 } },
    { id: NODE.bathWcN, p: { x: 6.8, z: 0.0 } },
    { id: NODE.wcGuestN, p: { x: 8.2, z: 0.0 } },
    { id: NODE.northEast, p: { x: 13.2, z: 0.0 } },
    // East facade
    { id: NODE.spineEast, p: { x: 13.2, z: 3.6 } },
    { id: NODE.corridorEast, p: { x: 13.2, z: 5.2 } },
    { id: NODE.southEast, p: { x: 13.2, z: 9.2 } },
    // South facade, walked west
    { id: NODE.studyBedroomS, p: { x: 11.0, z: 9.2 } },
    { id: NODE.bedroomLivingS, p: { x: 7.0, z: 9.2 } },
    { id: NODE.loggiaLivingS, p: { x: 5.6, z: 9.2 } },
    // The bay is one arc between these two nodes, chord 3.40, no returns.
    { id: NODE.bayEast, p: { x: 4.3, z: 9.2 } },
    { id: NODE.bayWest, p: { x: 0.9, z: 9.2 } },
    { id: NODE.southWest, p: { x: 0.0, z: 9.2 } },
    // The bearing spine
    { id: NODE.spineWest, p: { x: 0.0, z: 3.6 } },
    { id: NODE.spineKitchenBath, p: { x: 4.4, z: 3.6 } },
    { id: NODE.spineBathWc, p: { x: 6.8, z: 3.6 } },
    { id: NODE.spineWcGuest, p: { x: 8.2, z: 3.6 } },
    // The corridor's south side
    { id: NODE.corridorWest, p: { x: 4.4, z: 5.2 } },
    { id: NODE.corridorBedroom, p: { x: 7.0, z: 5.2 } },
    { id: NODE.corridorStudy, p: { x: 11.0, z: 5.2 } },
    // The loggia
    { id: NODE.loggiaSouthWest, p: { x: 5.6, z: 10.7 } },
    { id: NODE.loggiaSouthEast, p: { x: 11.0, z: 10.7 } },
  ],

  walls: [
    // ---- Facade, walked clockwise from the north-west corner ----
    { id: WALL.facNorthKitchen, a: NODE.northWest, b: NODE.kitchenBathN, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facNorthBath,
      a: NODE.kitchenBathN,
      b: NODE.bathWcN,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowBath, type: 'window', center: 1.2, width: 0.8, sill: 0.9, head: 2.3 }],
    },
    { id: WALL.facNorthWc, a: NODE.bathWcN, b: NODE.wcGuestN, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facNorthGuest,
      a: NODE.wcGuestN,
      b: NODE.northEast,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowGuestNorth, type: 'window', center: 2.4, width: 1.6, sill: 0.85, head: 2.3 }],
    },
    { id: WALL.facEastGuest, a: NODE.northEast, b: NODE.spineEast, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facEastEntrance,
      a: NODE.spineEast,
      b: NODE.corridorEast,
      thickness: 0.3,
      role: 'facade',
      // Entrance door at the east end of the corridor, centre at (13.20, 4.40).
      openings: [
        {
          id: OPENING.doorEntrance,
          type: 'door',
          entrance: true,
          center: 0.8,
          width: 1.0,
          sill: 0,
          head: 2.1,
          hinge: 'a',
          swing: 'in',
          variant: OPENING_VARIANT.entry_door_walnut_panelled,
        },
      ],
    },
    { id: WALL.facEastStudy, a: NODE.corridorEast, b: NODE.southEast, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facSouthStudy,
      a: NODE.southEast,
      b: NODE.studyBedroomS,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowStudy, type: 'window', center: 1.1, width: 1.2, sill: 0.85, head: 2.3 }],
    },
    {
      id: WALL.facSouthBedroom,
      a: NODE.studyBedroomS,
      b: NODE.bedroomLivingS,
      thickness: 0.3,
      role: 'facade',
      openings: [
        // Window at (10.00, 9.20), loggia door at (8.40, 9.20): the door stands
        // 2.10 m east of the living room's, so a walk across the loggia is two
        // easy turns, not a hairpin, and the loggia's seat stays east of both.
        { id: OPENING.windowBedroomSouth, type: 'window', center: 1.0, width: 1.6, sill: 0.85, head: 2.3 },
        { id: OPENING.doorBedroomLoggia, type: 'door', center: 2.6, width: 0.8, sill: 0, head: 2.1, hinge: 'b', swing: 'out' },
      ],
    },
    {
      id: WALL.facSouthLivingLoggia,
      a: NODE.bedroomLivingS,
      b: NODE.loggiaLivingS,
      thickness: 0.3,
      role: 'facade',
      // Loggia door from the living room, centre at (6.30, 9.20).
      openings: [{ id: OPENING.doorLivingLoggia, type: 'door', center: 0.7, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'out' }],
    },
    { id: WALL.facSouthLivingE, a: NODE.loggiaLivingS, b: NODE.bayEast, thickness: 0.3, role: 'facade' },
    {
      id: WALL.bayLiving,
      a: NODE.bayEast,
      b: NODE.bayWest,
      thickness: 0.3,
      role: 'facade',
      // Chord 3.40 on a 2.20 radius: a shallow arc bulging 0.80 south of the
      // facade line. Arc length 3.885; the window is centred on the apex.
      arc: { radius: 2.2, ccw: false },
      openings: [
        {
          id: OPENING.windowLivingBay,
          type: 'window',
          center: 1.9425,
          width: 2.4,
          sill: 0.85,
          head: 2.3,
          variant: OPENING_VARIANT.window_oak_vertical,
        },
      ],
    },
    { id: WALL.facSouthLivingW, a: NODE.bayWest, b: NODE.southWest, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facWestLiving,
      a: NODE.southWest,
      b: NODE.spineWest,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowLivingWest, type: 'window', center: 1.2, width: 1.2, sill: 0.85, head: 2.3 }],
    },
    {
      id: WALL.facWestKitchen,
      a: NODE.spineWest,
      b: NODE.northWest,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowKitchenWest, type: 'window', center: 1.8, width: 1.4, sill: 0.9, head: 2.3 }],
    },

    // ---- Loggia envelope (outside the rooms, still facade: 0.30) ----
    { id: WALL.loggiaWest, a: NODE.loggiaLivingS, b: NODE.loggiaSouthWest, thickness: 0.3, role: 'facade' },
    {
      id: WALL.loggiaSouth,
      a: NODE.loggiaSouthWest,
      b: NODE.loggiaSouthEast,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowLoggia, type: 'window', center: 2.7, width: 2.8, sill: 0.85, head: 2.3 }],
    },
    { id: WALL.loggiaEast, a: NODE.loggiaSouthEast, b: NODE.studyBedroomS, thickness: 0.3, role: 'facade' },

    // ---- Bearing spine, 0.24 ----
    {
      id: WALL.spineKitchen,
      a: NODE.spineWest,
      b: NODE.spineKitchenBath,
      thickness: 0.24,
      role: 'bearing',
      // Kitchen ↔ living door, centre at (3.80, 3.60).
      openings: [{ id: OPENING.doorKitchenLiving, type: 'door', center: 3.8, width: 0.8, sill: 0, head: 2.1, hinge: 'b', swing: 'in' }],
    },
    {
      id: WALL.spineBath,
      a: NODE.spineKitchenBath,
      b: NODE.spineBathWc,
      thickness: 0.24,
      role: 'bearing',
      // Bathroom door, centre at (6.00, 3.60).
      openings: [{ id: OPENING.doorBathroom, type: 'door', center: 1.6, width: 0.8, sill: 0, head: 2.1, hinge: 'b', swing: 'in' }],
    },
    {
      id: WALL.spineWc,
      a: NODE.spineBathWc,
      b: NODE.spineWcGuest,
      thickness: 0.24,
      role: 'bearing',
      // WC door, centre at (7.50, 3.60).
      openings: [{ id: OPENING.doorWc, type: 'door', center: 0.7, width: 0.7, sill: 0, head: 2.1, hinge: 'a', swing: 'in' }],
    },
    {
      id: WALL.spineGuest,
      a: NODE.spineWcGuest,
      b: NODE.spineEast,
      thickness: 0.24,
      role: 'bearing',
      // Guest room door, centre at (9.00, 3.60).
      openings: [{ id: OPENING.doorGuestRoom, type: 'door', center: 0.8, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'in' }],
    },

    // ---- Partitions, 0.10 ----
    { id: WALL.wallKitchenBath, a: NODE.kitchenBathN, b: NODE.spineKitchenBath, thickness: 0.1, role: 'partition' },
    { id: WALL.wallBathWc, a: NODE.bathWcN, b: NODE.spineBathWc, thickness: 0.1, role: 'partition' },
    { id: WALL.wallWcGuest, a: NODE.wcGuestN, b: NODE.spineWcGuest, thickness: 0.1, role: 'partition' },
    {
      id: WALL.wallLivingHallEnd,
      a: NODE.spineKitchenBath,
      b: NODE.corridorWest,
      thickness: 0.1,
      role: 'partition',
      // Living ↔ hall door at the corridor's west end, centre at (4.40, 4.40).
      openings: [{ id: OPENING.doorLivingHall, type: 'door', center: 0.8, width: 0.9, sill: 0, head: 2.1, hinge: 'a', swing: 'out' }],
    },
    { id: WALL.wallLivingHall, a: NODE.corridorWest, b: NODE.corridorBedroom, thickness: 0.1, role: 'partition' },
    {
      id: WALL.wallBedroomHall,
      a: NODE.corridorBedroom,
      b: NODE.corridorStudy,
      thickness: 0.1,
      role: 'partition',
      // Bedroom door, centre at (7.70, 5.20).
      openings: [{ id: OPENING.doorBedroom, type: 'door', center: 0.7, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'in' }],
    },
    {
      id: WALL.wallStudyHall,
      a: NODE.corridorStudy,
      b: NODE.corridorEast,
      thickness: 0.1,
      role: 'partition',
      // Study door, centre at (11.60, 5.20).
      openings: [{ id: OPENING.doorStudy, type: 'door', center: 0.6, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'in' }],
    },
    { id: WALL.wallLivingBedroom, a: NODE.corridorBedroom, b: NODE.bedroomLivingS, thickness: 0.1, role: 'partition' },
    { id: WALL.wallBedroomStudy, a: NODE.corridorStudy, b: NODE.studyBedroomS, thickness: 0.1, role: 'partition' },
  ],

  rooms: [
    { id: ROOM.kitchen, name: 'Kitchen', anchor: { x: 2.2, z: 2.9 }, floorMaterial: FINISH.oak, accent: '#8fae9d' },
    { id: ROOM.bathroom, name: 'Bathroom', anchor: { x: 5.6, z: 1.8 }, floorMaterial: FINISH.stone, accent: '#a5c0be' },
    { id: ROOM.wc, name: 'WC', anchor: { x: 7.3, z: 1.6 }, floorMaterial: FINISH.stone, accent: '#b5c4c9' },
    { id: ROOM.guestRoom, name: 'Guest bedroom', anchor: { x: 9.8, z: 1.8 }, floorMaterial: FINISH.oak, accent: '#93a896' },
    { id: ROOM.hall, name: 'Entrance hall', anchor: { x: 8.6, z: 4.4 }, floorMaterial: FINISH.oak, accent: '#d2b28f' },
    {
      id: ROOM.living,
      name: 'Living and dining room',
      anchor: { x: 3.0, z: 7.0 },
      floorMaterial: FINISH.oak,
      accent: '#d9a66d',
    },
    { id: ROOM.bedroom, name: 'Bedroom', anchor: { x: 8.4, z: 7.2 }, floorMaterial: FINISH.oak, accent: '#cfae8e' },
    { id: ROOM.study, name: 'Study', anchor: { x: 12.0, z: 7.0 }, floorMaterial: FINISH.oak, accent: '#c8beb0' },
    {
      id: ROOM.loggia,
      name: 'Loggia',
      anchor: { x: 8.3, z: 9.9 },
      floorMaterial: FINISH.ceramic_light,
      accent: '#bd765c',
      kind: 'loggia',
    },
  ],

  // No `materials[]`: every finish this scene uses (oak, stone, light ceramic
  // for floors; walnut, linen, brass, ... for furniture) is a bundled catalogue
  // entry and resolves through `material-catalogue.resolveFinish`. The field is
  // reserved for materials a scene defines itself.

  assets: demoFurniture,

  // From the north: the curved bay, its window and the loggia stand on the far
  // side of the dollhouse, where their inner faces and glass are seen; steep
  // enough that the corridor wall does not hide the rooms south of it.
  presentationCamera: { position: { x: 6.6, y: 15.5, z: -8.5 }, target: { x: 6.6, y: 0.6, z: 5.0 } },

  roomCameras: {
    [ROOM.kitchen]: { position: { x: 3.6, y: 1.6, z: 2.9 }, target: { x: 1.6, y: 1.2, z: 0.5 } },
    [ROOM.bathroom]: { position: { x: 6.0, y: 1.6, z: 2.9 }, target: { x: 5.2, y: 1.2, z: 0.8 } },
    [ROOM.wc]: { position: { x: 7.3, y: 1.6, z: 2.9 }, target: { x: 7.5, y: 1.1, z: 0.6 } },
    [ROOM.guestRoom]: { position: { x: 9.2, y: 1.6, z: 2.9 }, target: { x: 12.2, y: 1.2, z: 1.75 } },
    [ROOM.hall]: { position: { x: 12.3, y: 1.6, z: 4.4 }, target: { x: 5.0, y: 1.3, z: 4.4 } },
    // Walk mode spawns here: the aisle between the lounge and the dining
    // table, looking up the lounge, with a straight run to the hall door.
    [ROOM.living]: { position: { x: 4.0, y: 1.6, z: 8.3 }, target: { x: 1.5, y: 1.2, z: 4.2 } },
    [ROOM.bedroom]: { position: { x: 8.0, y: 1.6, z: 6.0 }, target: { x: 10.9, y: 1.2, z: 7.4 } },
    [ROOM.study]: { position: { x: 11.7, y: 1.6, z: 6.1 }, target: { x: 12.4, y: 1.2, z: 8.8 } },
    [ROOM.loggia]: { position: { x: 6.3, y: 1.6, z: 9.9 }, target: { x: 9.7, y: 1.2, z: 10.4 } },
  },

  // Walk mode spawns here: the aisle between the lounge and the dining
  // table, looking up the lounge, with a straight run to the hall door.
  walkSpawn: { position: { x: 4.0, y: 1.6, z: 8.3 }, target: { x: 1.5, y: 1.2, z: 4.2 } },

  navigation: {
    points: [
      { x: 3.6, y: 1.6, z: 2.9 }, // kitchen, by the door
      { x: 1.2, y: 1.6, z: 1.2 }, // kitchen, at the worktop
      { x: 5.6, y: 1.6, z: 2.6 }, // bathroom
      { x: 7.25, y: 1.6, z: 2.7 }, // wc
      { x: 9.6, y: 1.6, z: 2.6 }, // guest bedroom
      { x: 12.3, y: 1.6, z: 4.4 }, // hall, by the entrance
      { x: 9.0, y: 1.6, z: 4.45 }, // hall, middle
      { x: 5.2, y: 1.6, z: 4.45 }, // hall, west end
      { x: 4.0, y: 1.6, z: 8.3 }, // living, aisle
      { x: 3.95, y: 1.6, z: 5.0 }, // living, by the hall door
      { x: 1.75, y: 1.6, z: 9.3 }, // living, in the bay
      { x: 8.0, y: 1.6, z: 6.0 }, // bedroom, by the door
      { x: 8.2, y: 1.6, z: 8.4 }, // bedroom, by the window
      { x: 11.6, y: 1.6, z: 6.3 }, // study
      { x: 6.5, y: 1.6, z: 9.9 }, // loggia
    ],
  },

  autotour: {
    // Eye-level walkthrough: entrance hall → living room and its bay →
    // kitchen → bathroom → guest bedroom → bedroom and the loggia → study.
    // Every wall crossing happens at the centre of a door, and every leg
    // keeps clear of the furniture (`scene-data.test.ts` holds each leg to
    // `canTraverse` and `pathBlockedByFurniture`).
    speed: 1.1,
    path: [
      { x: 12.4, y: 1.6, z: 4.4 }, // 0  hall, just inside the entrance
      { x: 11.0, y: 1.6, z: 4.45 }, // 1  hall, past the console
      { x: 7.0, y: 1.6, z: 4.45 }, // 2  hall
      { x: 5.2, y: 1.6, z: 4.45 }, // 3  hall, west end
      { x: 4.4, y: 1.6, z: 4.4 }, // 4  door-living-hall
      { x: 3.95, y: 1.6, z: 5.0 }, // 5  living, north end of the aisle
      { x: 3.95, y: 1.6, z: 7.6 }, // 6  living, aisle between sofa and table
      { x: 4.0, y: 1.6, z: 8.45 }, // 7  living, south of the dining table
      { x: 1.8, y: 1.6, z: 8.55 }, // 8  living, behind the lounge
      { x: 1.75, y: 1.6, z: 9.3 }, // 9  living, inside the bay
      { x: 1.8, y: 1.6, z: 8.55 }, // 10 living
      { x: 3.95, y: 1.6, z: 7.6 }, // 11 living, aisle
      { x: 3.95, y: 1.6, z: 5.0 }, // 12 living
      { x: 3.85, y: 1.6, z: 4.3 }, // 13 living, by the kitchen door
      { x: 3.8, y: 1.6, z: 3.6 }, // 14 door-kitchen-living
      { x: 3.6, y: 1.6, z: 2.9 }, // 15 kitchen
      { x: 3.6, y: 1.6, z: 1.2 }, // 16 kitchen, east of the island
      { x: 1.2, y: 1.6, z: 1.2 }, // 17 kitchen, at the worktop
      { x: 3.6, y: 1.6, z: 1.2 }, // 18 kitchen
      { x: 3.6, y: 1.6, z: 2.9 }, // 19 kitchen
      { x: 3.8, y: 1.6, z: 3.6 }, // 20 door-kitchen-living
      { x: 3.9, y: 1.6, z: 4.3 }, // 21 living
      { x: 4.4, y: 1.6, z: 4.4 }, // 22 door-living-hall
      { x: 6.0, y: 1.6, z: 4.45 }, // 23 hall
      { x: 6.0, y: 1.6, z: 3.6 }, // 24 door-bathroom
      { x: 5.6, y: 1.6, z: 2.6 }, // 25 bathroom
      { x: 6.0, y: 1.6, z: 3.6 }, // 26 door-bathroom
      { x: 7.0, y: 1.6, z: 4.45 }, // 27 hall
      { x: 9.0, y: 1.6, z: 4.45 }, // 28 hall
      { x: 9.0, y: 1.6, z: 3.6 }, // 29 door-guest-room
      { x: 9.6, y: 1.6, z: 2.5 }, // 30 guest bedroom
      { x: 10.2, y: 1.6, z: 1.0 }, // 31 guest bedroom, by the window
      { x: 9.6, y: 1.6, z: 2.5 }, // 32 guest bedroom
      { x: 9.0, y: 1.6, z: 3.6 }, // 33 door-guest-room
      { x: 8.0, y: 1.6, z: 4.6 }, // 34 hall
      { x: 7.7, y: 1.6, z: 5.2 }, // 35 door-bedroom
      { x: 8.1, y: 1.6, z: 6.3 }, // 36 bedroom
      { x: 8.2, y: 1.6, z: 8.4 }, // 37 bedroom, past the foot of the bed
      { x: 8.4, y: 1.6, z: 9.2 }, // 38 door-bedroom-loggia
      { x: 8.4, y: 1.6, z: 9.75 }, // 39 loggia
      { x: 6.4, y: 1.6, z: 9.75 }, // 40 loggia, west end
      { x: 8.4, y: 1.6, z: 9.75 }, // 41 loggia
      { x: 8.4, y: 1.6, z: 9.2 }, // 42 door-bedroom-loggia
      { x: 8.2, y: 1.6, z: 8.4 }, // 43 bedroom
      { x: 8.1, y: 1.6, z: 6.3 }, // 44 bedroom
      { x: 7.7, y: 1.6, z: 5.2 }, // 45 door-bedroom
      { x: 7.7, y: 1.6, z: 4.6 }, // 46 hall
      { x: 11.6, y: 1.6, z: 4.6 }, // 47 hall
      { x: 11.6, y: 1.6, z: 5.2 }, // 48 door-study
      { x: 11.6, y: 1.6, z: 6.3 }, // 49 study
      { x: 12.4, y: 1.6, z: 7.4 }, // 50 study, behind the desk chair
    ],
    gaze: [
      { at: 0, target: { x: 5.0, y: 1.4, z: 4.4 } }, // down the corridor
      { at: 1, target: { x: 11.2, y: 1.6, z: 3.75 } }, // hall mirror over the console
      { at: 5, target: { x: 0.36, y: 1.0, z: 6.0 } }, // media unit
      { at: 6, target: { x: 5.5, y: 1.0, z: 7.06 } }, // dining table under the pendant
      { at: 8, target: { x: 2.6, y: 1.4, z: 9.85 } }, // bay window
      { at: 9, target: { x: 2.6, y: 1.4, z: 9.9 } },
      { at: 12, target: { x: 1.6, y: 1.5, z: 3.745 } }, // art over the lounge
      { at: 15, target: { x: 1.35, y: 1.0, z: 0.5 } }, // kitchen worktop
      { at: 17, target: { x: 2.91, y: 1.2, z: 0.45 } }, // hob
      { at: 19, target: { x: 2.0, y: 0.9, z: 2.15 } }, // island
      { at: 25, target: { x: 6.5, y: 1.0, z: 1.6 } }, // bathroom vanity
      { at: 30, target: { x: 11.93, y: 0.6, z: 1.75 } }, // guest bed
      { at: 31, target: { x: 10.6, y: 1.5, z: 0.0 } }, // guest bedroom window
      { at: 36, target: { x: 9.83, y: 0.6, z: 7.15 } }, // bed
      { at: 37, target: { x: 10.0, y: 1.5, z: 9.2 } }, // bedroom window
      { at: 39, target: { x: 8.3, y: 1.4, z: 10.7 } }, // loggia window
      { at: 43, target: { x: 10.925, y: 1.5, z: 7.15 } }, // art over the bed head
      { at: 49, target: { x: 12.05, y: 0.9, z: 8.74 } }, // desk
      { at: 50, target: { x: 12.1, y: 1.5, z: 9.2 } }, // study window
    ],
    zones: [
      { at: 0, speed: 0.9 }, // hall is a corridor
      { at: 5, speed: 1.2 }, // living room
      { at: 8, speed: 0.8 }, // the bay
      { at: 11, speed: 1.2 }, // back across the living room
      { at: 15, speed: 0.75 }, // kitchen, around the island
      { at: 21, speed: 1.0 }, // hall
      { at: 25, speed: 0.7 }, // bathroom
      { at: 27, speed: 1.0 }, // hall
      { at: 30, speed: 0.95 }, // guest bedroom
      { at: 36, speed: 1.05 }, // bedroom
      { at: 39, speed: 0.75 }, // loggia
      { at: 46, speed: 1.0 }, // hall
      { at: 49, speed: 0.9 }, // study
    ],
  },
};

/** The apartment as the viewer loads it: the plan above plus its four interiors. */
export const apartmentScene: SceneData = { ...baseApartment, interiors: demoInteriors };
