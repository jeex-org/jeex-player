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
  schemaVersion: '2.4',
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
      openings: [{ id: OPENING.doorKitchenLiving, type: 'door', center: 3.8, width: 0.8, sill: 0, head: 2.1, hinge: 'b', swing: 'out' }],
    },
    {
      id: WALL.spineBath,
      a: NODE.spineKitchenBath,
      b: NODE.spineBathWc,
      thickness: 0.24,
      role: 'bearing',
      // Bathroom door, centre at (6.00, 3.60).
      openings: [{ id: OPENING.doorBathroom, type: 'door', center: 1.6, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'in' }],
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
      openings: [{ id: OPENING.doorGuestRoom, type: 'door', center: 0.8, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'out' }],
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
    { id: ROOM.kitchen, name: 'Kitchen', anchor: { x: 2.2, z: 2.9 }, floorMaterial: FINISH.oak, accent: '#8fae9d', purpose: 'kitchen' },
    {
      id: ROOM.bathroom,
      name: 'Bathroom',
      anchor: { x: 5.6, z: 1.8 },
      floorMaterial: FINISH.stone,
      accent: '#a5c0be',
      purpose: 'bathroom',
    },
    { id: ROOM.wc, name: 'WC', anchor: { x: 7.3, z: 1.6 }, floorMaterial: FINISH.stone, accent: '#b5c4c9', purpose: 'wc' },
    {
      id: ROOM.guestRoom,
      name: 'Guest bedroom',
      anchor: { x: 9.8, z: 1.8 },
      floorMaterial: FINISH.oak,
      accent: '#93a896',
      purpose: 'bedroom',
    },
    { id: ROOM.hall, name: 'Entrance hall', anchor: { x: 8.6, z: 4.4 }, floorMaterial: FINISH.oak, accent: '#d2b28f', purpose: 'hall' },
    {
      id: ROOM.living,
      name: 'Living and dining room',
      anchor: { x: 3.0, z: 7.0 },
      floorMaterial: FINISH.oak,
      accent: '#d9a66d',
      purpose: 'living',
    },
    { id: ROOM.bedroom, name: 'Bedroom', anchor: { x: 8.4, z: 7.2 }, floorMaterial: FINISH.oak, accent: '#cfae8e', purpose: 'bedroom' },
    { id: ROOM.study, name: 'Study', anchor: { x: 12.0, z: 7.0 }, floorMaterial: FINISH.oak, accent: '#c8beb0', purpose: 'study' },
    {
      id: ROOM.loggia,
      name: 'Loggia',
      anchor: { x: 8.3, z: 9.9 },
      floorMaterial: FINISH.ceramic_light,
      accent: '#bd765c',
      kind: 'loggia',
      purpose: 'balcony',
    },
  ],

  // Smooth white paint on every wall and a pure white ceiling over every room
  // (a loggia has none); the first interior preset repaints the same walls.
  finishes: {
    rooms: Object.fromEntries(
      [ROOM.kitchen, ROOM.bathroom, ROOM.wc, ROOM.guestRoom, ROOM.hall, ROOM.living, ROOM.bedroom, ROOM.study, ROOM.loggia].map((id) => [
        id,
        id === ROOM.loggia ? { walls: FINISH.smooth_white } : { walls: FINISH.smooth_white, ceiling: FINISH.ceiling_white },
      ]),
    ),
  },

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
    //
    // Doors are walked straight through: a waypoint at the door centre,
    // approached and left along the door's axis, so the corner fillets turn
    // in the rooms, never in the reveal, and the hall is walked on the side
    // clear of the open door leaves. The gaze holds a target behind each
    // door on its axis while the camera passes it, and every look at an
    // object hands over to the next look before the camera leaves the room,
    // so the view never swings across a wall at arm's length. The played run
    // is held to the walls by `autotour-walls.test.ts`.
    speed: 1.1,
    path: [
      { x: 12.4, y: 1.6, z: 4.4 }, // 0  hall, just inside the entrance
      { x: 12.1, y: 1.6, z: 4.7 }, // 1  hall, the console and its mirror ahead
      { x: 10.6, y: 1.6, z: 4.7 }, // 2  hall, past the console
      { x: 7.0, y: 1.6, z: 4.7 }, // 3  hall
      { x: 5.2, y: 1.6, z: 4.7 }, // 4  hall, west end
      { x: 4.4, y: 1.6, z: 4.4 }, // 5  door-living-hall
      { x: 3.9, y: 1.6, z: 4.4 }, // 6  living, straight through the door
      { x: 3.95, y: 1.6, z: 5.0 }, // 7  living, north end of the aisle
      { x: 3.95, y: 1.6, z: 7.6 }, // 8  living, aisle between sofa and table
      { x: 4.0, y: 1.6, z: 8.45 }, // 9  living, south of the dining table
      { x: 1.8, y: 1.6, z: 8.55 }, // 10 living, behind the lounge
      { x: 1.75, y: 1.6, z: 9.3 }, // 11 living, inside the bay
      { x: 1.8, y: 1.6, z: 8.55 }, // 12 living
      { x: 3.95, y: 1.6, z: 7.6 }, // 13 living, aisle
      { x: 3.95, y: 1.6, z: 5.0 }, // 14 living
      { x: 3.8, y: 1.6, z: 4.3 }, // 15 living, by the kitchen door
      { x: 3.8, y: 1.6, z: 3.6 }, // 16 door-kitchen-living
      { x: 3.8, y: 1.6, z: 2.9 }, // 17 kitchen, straight through the door
      { x: 3.6, y: 1.6, z: 1.3 }, // 18 kitchen, east of the island
      { x: 1.2, y: 1.6, z: 1.3 }, // 19 kitchen, at the worktop
      { x: 3.6, y: 1.6, z: 1.3 }, // 20 kitchen
      { x: 3.8, y: 1.6, z: 2.9 }, // 21 kitchen
      { x: 3.8, y: 1.6, z: 3.6 }, // 22 door-kitchen-living
      { x: 3.8, y: 1.6, z: 4.4 }, // 23 living, straight through the door
      { x: 4.4, y: 1.6, z: 4.4 }, // 24 door-living-hall
      { x: 5.75, y: 1.6, z: 4.7 }, // 25 hall, by the bathroom door
      { x: 6.0, y: 1.6, z: 4.7 }, // 26 hall, facing the bathroom door
      { x: 6.0, y: 1.6, z: 3.6 }, // 27 door-bathroom
      { x: 6.0, y: 1.6, z: 3.0 }, // 28 bathroom, straight through the door
      { x: 5.4, y: 1.6, z: 2.4 }, // 29 bathroom, past the door
      { x: 6.0, y: 1.6, z: 3.0 }, // 30 bathroom, facing the door
      { x: 6.0, y: 1.6, z: 3.6 }, // 31 door-bathroom
      { x: 6.0, y: 1.6, z: 4.7 }, // 32 hall, straight out of the door
      { x: 9.0, y: 1.6, z: 4.7 }, // 33 hall
      { x: 9.0, y: 1.6, z: 3.6 }, // 34 door-guest-room
      { x: 9.0, y: 1.6, z: 2.5 }, // 35 guest bedroom, straight through the door
      { x: 10.2, y: 1.6, z: 1.0 }, // 36 guest bedroom, by the window
      { x: 9.0, y: 1.6, z: 2.5 }, // 37 guest bedroom, facing the door
      { x: 9.0, y: 1.6, z: 3.6 }, // 38 door-guest-room
      { x: 9.0, y: 1.6, z: 4.7 }, // 39 hall, straight out of the door
      { x: 7.7, y: 1.6, z: 4.7 }, // 40 hall, facing the bedroom door
      { x: 7.7, y: 1.6, z: 5.2 }, // 41 door-bedroom
      { x: 8.1, y: 1.6, z: 6.3 }, // 42 bedroom
      { x: 8.15, y: 1.6, z: 7.4 }, // 43 bedroom, by the foot of the bed
      { x: 8.2, y: 1.6, z: 8.4 }, // 44 bedroom, past the foot of the bed
      { x: 8.45, y: 1.6, z: 9.2 }, // 45 door-bedroom-loggia
      { x: 8.45, y: 1.6, z: 10.2 }, // 46 loggia
      { x: 6.4, y: 1.6, z: 10.2 }, // 47 loggia, west end
      { x: 7.9, y: 1.6, z: 10.2 }, // 48 loggia
      { x: 8.45, y: 1.6, z: 10.2 }, // 49 loggia, facing the door
      { x: 8.45, y: 1.6, z: 9.2 }, // 50 door-bedroom-loggia
      { x: 8.2, y: 1.6, z: 8.4 }, // 51 bedroom
      { x: 8.0, y: 1.6, z: 6.0 }, // 52 bedroom, facing the door
      { x: 7.7, y: 1.6, z: 5.2 }, // 53 door-bedroom
      { x: 7.7, y: 1.6, z: 4.7 }, // 54 hall, straight out of the door
      { x: 11.45, y: 1.6, z: 4.45 }, // 55 hall, by the study door
      { x: 11.6, y: 1.6, z: 4.45 }, // 56 hall, facing the study door
      { x: 11.6, y: 1.6, z: 5.2 }, // 57 door-study
      { x: 11.6, y: 1.6, z: 6.3 }, // 58 study
      { x: 12.4, y: 1.6, z: 7.4 }, // 59 study, behind the desk chair
    ],
    gaze: [
      { at: 0, target: { x: 5.0, y: 1.4, z: 4.4 } }, // down the corridor
      { at: 1, target: { x: 11.2, y: 1.6, z: 3.75 } }, // hall mirror over the console
      { at: 2, target: { x: 2.0, y: 1.4, z: 4.4 } }, // down the corridor, through the living-room door
      { at: 7, target: { x: 0.36, y: 1.0, z: 6.0 } }, // media unit
      { at: 8, target: { x: 5.5, y: 1.0, z: 7.06 } }, // dining table under the pendant
      { at: 10, target: { x: 2.4, y: 0.8, z: 7.2 } }, // the lounge
      { at: 11, target: { x: 2.6, y: 1.4, z: 9.9 } }, // bay window
      { at: 12, target: { x: 5.5, y: 1.0, z: 7.06 } }, // back towards the dining table
      { at: 13, target: { x: 1.6, y: 1.5, z: 3.745 } }, // art over the lounge
      { at: 16, target: { x: 3.8, y: 1.4, z: 1.5 } }, // straight through the kitchen door
      { at: 18, target: { x: 1.35, y: 1.0, z: 0.5 } }, // kitchen worktop
      { at: 19, target: { x: 2.91, y: 1.2, z: 0.45 } }, // hob
      { at: 20, target: { x: 2.0, y: 0.9, z: 2.15 } }, // island
      { at: 21, target: { x: 3.8, y: 1.4, z: 5.5 } }, // straight back to the kitchen door
      { at: 24, target: { x: 7.0, y: 1.5, z: 4.45 } }, // down the hall
      { at: 25, target: { x: 7.0, y: 1.5, z: 4.7 } }, // held down the hall
      { at: 27, target: { x: 6.0, y: 1.4, z: 1.8 } }, // straight through the bathroom door
      { at: 29, target: { x: 6.5, y: 1.0, z: 1.6 } }, // bathroom vanity
      { at: 30, target: { x: 6.4, y: 1.4, z: 5.0 } }, // out of the bathroom door, towards the hall
      { at: 32, target: { x: 13.0, y: 1.5, z: 4.45 } }, // down the hall
      { at: 34, target: { x: 9.0, y: 1.4, z: 1.8 } }, // straight through the guest-room door
      { at: 35, target: { x: 11.93, y: 0.6, z: 1.75 } }, // guest bed
      { at: 36, target: { x: 10.6, y: 1.5, z: 0.0 } }, // guest bedroom window
      { at: 37, target: { x: 8.4, y: 1.4, z: 5.0 } }, // out of the guest-room door, towards the hall
      { at: 38, target: { x: 8.4, y: 1.4, z: 5.0 } }, // held through the door
      { at: 39, target: { x: 4.6, y: 1.4, z: 4.45 } }, // down the hall
      { at: 40, target: { x: 7.7, y: 1.4, z: 7.0 } }, // straight through the bedroom door
      { at: 42, target: { x: 9.83, y: 0.6, z: 7.15 } }, // bed
      { at: 43, target: { x: 9.6, y: 1.5, z: 9.2 } }, // bedroom window
      { at: 44, target: { x: 8.45, y: 1.4, z: 10.7 } }, // straight through the loggia door
      { at: 46, target: { x: 8.3, y: 1.4, z: 10.7 } }, // loggia window
      { at: 47, target: { x: 10.6, y: 1.5, z: 10.2 } }, // along the loggia
      { at: 48, target: { x: 10.6, y: 1.5, z: 10.2 } }, // held until the door
      { at: 49, target: { x: 8.45, y: 1.4, z: 7.0 } }, // straight back through the loggia door
      { at: 51, target: { x: 10.925, y: 1.5, z: 7.15 } }, // art over the bed head
      { at: 52, target: { x: 7.7, y: 1.4, z: 3.9 } }, // straight out of the bedroom door
      { at: 53, target: { x: 7.7, y: 1.4, z: 3.9 } }, // held through the door
      { at: 54, target: { x: 13.0, y: 1.5, z: 4.45 } }, // down the hall
      { at: 55, target: { x: 13.0, y: 1.5, z: 4.45 } }, // down the hall
      { at: 57, target: { x: 11.6, y: 1.4, z: 7.5 } }, // straight through the study door
      { at: 58, target: { x: 12.05, y: 0.9, z: 8.74 } }, // desk
      { at: 59, target: { x: 12.1, y: 1.5, z: 9.2 } }, // study window
    ],
    zones: [
      { at: 0, speed: 0.9 }, // hall is a corridor
      { at: 7, speed: 1.2 }, // living room
      { at: 10, speed: 0.8 }, // the bay
      { at: 13, speed: 1.2 }, // back across the living room
      { at: 17, speed: 0.75 }, // kitchen, around the island
      { at: 23, speed: 1.0 }, // back to the hall
      { at: 29, speed: 0.7 }, // bathroom
      { at: 32, speed: 1.0 }, // hall
      { at: 35, speed: 0.95 }, // guest bedroom
      { at: 42, speed: 1.05 }, // bedroom
      { at: 46, speed: 0.75 }, // loggia
      { at: 54, speed: 1.0 }, // hall
      { at: 58, speed: 0.9 }, // study
    ],
  },
};

/** The apartment as the viewer loads it: the plan above plus its four interiors. */
export const apartmentScene: SceneData = { ...baseApartment, interiors: demoInteriors };
