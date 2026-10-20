/**
 * Real two-bedroom apartment, schema 2.2.
 *
 * Reproduced from a surveyed floor plan (≈46 px per metre) and 18 interior
 * photos of the apartment. Three offset blocks: the left column
 * (loggia + kitchen), the central block with a north protrusion (living, guest
 * room, north loggia) and the right block pushed south (study, bedroom); the
 * bottom of the centre holds the hall, the closet and the bathroom.
 *
 * The only deliberate deviation from the survey is the living room's north
 * window: it is replaced by a semicircular bay of radius 1.60 m, so
 * the demo shows a curved wall with a window running along the arc.
 *
 * Wall centrelines, metres (Y up, plan in X–Z, X east, Z south):
 *
 *                 X 0.00   2.20  2.80        6.00 6.60      9.55         14.40
 *                   |       |     |            |    |         |             |
 *   Z -1.05         ·       ·   ,-~~~~~~~~~~~-,   ·         ·             ·
 *                   .            ´   BAY r 1.60  `
 *   Z 0.00          ·       ·   |                 |  +=========+  loggia-north
 *                   .           |                 |  |  north  |  facade
 *   Z 0.55          ·       ·    `---------------´   | loggia  |
 *   Z 1.15          +======+=====+                 +=+=========+
 *                   | logg |                        |         |
 *   Z 1.70          | west |     l i v i n g         +=========+
 *                   |      #                         |        |
 *   Z 2.90          +======#                         | guest  |
 *                   |      #                         |  room  |
 *   Z 3.90          | kitch#                         |        +=============+
 *                   |  en  #                         |        |    study    |
 *   Z 5.45          |      #-------+--------+--------+--------+             |
 *                   |      # close |      h a l l    |        |             |
 *   Z 6.50          |      #  t    |                 +--------+=============+
 *                   |      #       |                 |        |   bedroom   |
 *   Z 7.55          +======+=======+=======+=========+--------+             |
 *                                          |  bath   |        |             |
 *   Z 10.50                                +=========+========+=============+
 *
 *   `=` / `|` facade 0.30    `#` bearing 0.38 (bearing-central)    `-` partition 0.10
 *
 * Room interiors (inner wall faces), metres:
 *   loggia-west   X 0.15 … 2.01   Z 1.30 … 2.75
 *   kitchen       X 0.15 … 2.01   Z 3.05 … 7.40
 *   living        X 2.39 … 6.55   Z 1.30 … 5.40  + bay (inner radius 1.45 about 4.40, 0.55)
 *   loggia-north  X 6.75 … 9.40   Z 0.15 … 1.55
 *   guest-room    X 6.65 … 9.40/9.50  Z 1.85 … 5.40
 *   study         X 9.60 … 14.25  Z 4.05 … 6.45
 *   bedroom       X 9.60 … 14.25  Z 6.55 … 10.35
 *   bathroom      X 7.35 … 9.50   Z 7.60 … 10.35
 *   closet        X 2.39 … 4.65   Z 5.50 … 7.40
 *   hall          X 4.75 … 9.50   Z 5.50 … 7.40 (7.50 east of X 7.20)
 *
 * Ceiling 2.65; doors head 2.10, windows sill 0.85–0.90 / head 2.30.
 *
 * The labels above are the entities' readable names; their ids are the UUID
 * literals of `demo-ids.ts` (`NODE.wNw`, `WALL.bearingCentral`, `ROOM.living`),
 * and every catalogue reference is the bundled entry's own UUID constant
 * (`FINISH.oak`, `OPENING_VARIANT.window_oak_vertical`). The plan is exported as `apartmentScene` at the bottom of this file,
 * furnished from `demo-furniture.ts` and with the four interior presets of
 * `demo-interiors.ts` attached.
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
  name: 'Two-bedroom apartment, real plan',
  ceilingHeight: 2.65,

  nodes: [
    // West facade and the left column
    { id: NODE.wNw, p: { x: 0.0, z: 1.15 } },
    { id: NODE.wLgw, p: { x: 0.0, z: 2.9 } },
    { id: NODE.wSw, p: { x: 0.0, z: 7.55 } },
    // Central bearing line
    { id: NODE.cN, p: { x: 2.2, z: 1.15 } },
    { id: NODE.cLgw, p: { x: 2.2, z: 2.9 } },
    { id: NODE.cM, p: { x: 2.2, z: 5.45 } },
    { id: NODE.cS, p: { x: 2.2, z: 7.55 } },
    // Living room bay: two 0.60 returns, then the semicircle between them.
    // The returns run north–south, so they are tangent to the arc ends.
    { id: NODE.bayA, p: { x: 2.8, z: 1.15 } },
    { id: NODE.bayA2, p: { x: 2.8, z: 0.55 } },
    { id: NODE.bayB2, p: { x: 6.0, z: 0.55 } },
    { id: NODE.bayB, p: { x: 6.0, z: 1.15 } },
    // Closet
    { id: NODE.clN, p: { x: 4.7, z: 5.45 } },
    { id: NODE.clS, p: { x: 4.7, z: 7.55 } },
    // Living / guest divide and the north protrusion
    { id: NODE.livNe, p: { x: 6.6, z: 1.15 } },
    { id: NODE.lgnNw, p: { x: 6.6, z: 0.0 } },
    { id: NODE.lgnNe, p: { x: 9.55, z: 0.0 } },
    { id: NODE.lgnSw, p: { x: 6.6, z: 1.7 } },
    { id: NODE.lgnSe, p: { x: 9.55, z: 1.7 } },
    { id: NODE.livSe, p: { x: 6.6, z: 5.45 } },
    // Right block
    { id: NODE.stNw, p: { x: 9.55, z: 3.9 } },
    { id: NODE.stNe, p: { x: 14.4, z: 3.9 } },
    { id: NODE.grSe, p: { x: 9.55, z: 5.45 } },
    { id: NODE.hallE, p: { x: 9.55, z: 6.5 } },
    { id: NODE.beNe, p: { x: 14.4, z: 6.5 } },
    { id: NODE.beSe, p: { x: 14.4, z: 10.5 } },
    // Bathroom block
    { id: NODE.baNe, p: { x: 9.55, z: 7.55 } },
    { id: NODE.baNw, p: { x: 7.2, z: 7.55 } },
    { id: NODE.baSw, p: { x: 7.2, z: 10.5 } },
    { id: NODE.baSe, p: { x: 9.55, z: 10.5 } },
  ],

  walls: [
    // ---- Facade, walked clockwise from the north-west corner ----
    {
      id: WALL.facNLgw,
      a: NODE.wNw,
      b: NODE.cN,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowLoggiaWest, type: 'window', center: 1.1, width: 1.6, sill: 0.85, head: 2.3 }],
    },
    { id: WALL.facNLivingW, a: NODE.cN, b: NODE.bayA, thickness: 0.3, role: 'facade' },
    { id: WALL.facBayReturnW, a: NODE.bayA, b: NODE.bayA2, thickness: 0.3, role: 'facade' },
    {
      id: WALL.bayLiving,
      a: NODE.bayA2,
      b: NODE.bayB2,
      thickness: 0.3,
      role: 'facade',
      arc: { radius: 1.6, ccw: false },
      // Chord 3.20 = 2 · 1.60, so this is an exact semicircle bulging north to
      // z = -1.05. Arc length is π · 1.6 = 5.027; the window is on the apex.
      openings: [
        {
          id: OPENING.windowLivingBay,
          type: 'window',
          center: 2.513,
          width: 2.6,
          sill: 0.85,
          head: 2.3,
          variant: OPENING_VARIANT.window_oak_vertical,
        },
      ],
    },
    { id: WALL.facBayReturnE, a: NODE.bayB2, b: NODE.bayB, thickness: 0.3, role: 'facade' },
    { id: WALL.facNLivingE, a: NODE.bayB, b: NODE.livNe, thickness: 0.3, role: 'facade' },
    { id: WALL.facLgnW, a: NODE.livNe, b: NODE.lgnNw, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facLgnN,
      a: NODE.lgnNw,
      b: NODE.lgnNe,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowLoggiaNorth, type: 'window', center: 1.475, width: 2.2, sill: 0.85, head: 2.3 }],
    },
    { id: WALL.facLgnE, a: NODE.lgnNe, b: NODE.lgnSe, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facEGuest,
      a: NODE.lgnSe,
      b: NODE.stNw,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowGuestEast, type: 'window', center: 1.1, width: 1.3, sill: 0.85, head: 2.3 }],
    },
    {
      id: WALL.facNStudy,
      a: NODE.stNw,
      b: NODE.stNe,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowStudy, type: 'window', center: 2.6, width: 1.8, sill: 0.85, head: 2.3 }],
    },
    { id: WALL.facEStudy, a: NODE.stNe, b: NODE.beNe, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facEBed,
      a: NODE.beNe,
      b: NODE.beSe,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowBedroomEast, type: 'window', center: 1.8, width: 2.0, sill: 0.85, head: 2.3 }],
    },
    { id: WALL.facSBed, a: NODE.beSe, b: NODE.baSe, thickness: 0.3, role: 'facade' },
    { id: WALL.facSBath, a: NODE.baSe, b: NODE.baSw, thickness: 0.3, role: 'facade' },
    { id: WALL.facWBath, a: NODE.baSw, b: NODE.baNw, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facSHall,
      a: NODE.baNw,
      b: NODE.clS,
      thickness: 0.3,
      role: 'facade',
      // Entrance door, centre at (5.90, 7.55).
      openings: [
        {
          id: OPENING.doorEntrance,
          type: 'door',
          entrance: true,
          center: 1.3,
          width: 1.0,
          sill: 0,
          head: 2.1,
          hinge: 'a',
          swing: 'in',
          variant: OPENING_VARIANT.entry_door_walnut_panelled,
        },
      ],
    },
    { id: WALL.facSCloset, a: NODE.clS, b: NODE.cS, thickness: 0.3, role: 'facade' },
    {
      id: WALL.facSKitchen,
      a: NODE.cS,
      b: NODE.wSw,
      thickness: 0.3,
      role: 'facade',
      openings: [{ id: OPENING.windowKitchenSouth, type: 'window', center: 1.1, width: 1.2, sill: 0.9, head: 2.3 }],
    },
    { id: WALL.facWKitchen, a: NODE.wSw, b: NODE.wLgw, thickness: 0.3, role: 'facade' },
    { id: WALL.facWLgw, a: NODE.wLgw, b: NODE.wNw, thickness: 0.3, role: 'facade' },

    // ---- Loggia envelopes (still part of the thermal shell: 0.30) ----
    {
      id: WALL.wallLoggiaWest,
      a: NODE.wLgw,
      b: NODE.cLgw,
      thickness: 0.3,
      role: 'facade',
      openings: [
        // Balcony block: door at (0.78, 2.90) plus the window beside it.
        { id: OPENING.doorKitchenLoggia, type: 'door', center: 0.78, width: 0.8, sill: 0, head: 2.1, hinge: 'b', swing: 'in' },
        { id: OPENING.windowKitchenLoggia, type: 'window', center: 1.65, width: 0.75, sill: 0.9, head: 2.3 },
      ],
    },
    { id: WALL.wallLgnLiv, a: NODE.livNe, b: NODE.lgnSw, thickness: 0.3, role: 'facade' },
    {
      id: WALL.wallLoggiaNorth,
      a: NODE.lgnSw,
      b: NODE.lgnSe,
      thickness: 0.3,
      role: 'facade',
      openings: [
        // Balcony door at (7.60, 1.70) plus the window beside it.
        { id: OPENING.doorGuestLoggia, type: 'door', center: 1.0, width: 0.85, sill: 0, head: 2.1, hinge: 'b', swing: 'in' },
        { id: OPENING.windowGuestLoggia, type: 'window', center: 2.1, width: 1.0, sill: 0.9, head: 2.3 },
      ],
    },

    // ---- Central load-bearing line, 0.38 ----
    { id: WALL.bearingCentralN, a: NODE.cN, b: NODE.cLgw, thickness: 0.38, role: 'bearing' },
    {
      id: WALL.bearingCentral,
      a: NODE.cLgw,
      b: NODE.cM,
      thickness: 0.38,
      role: 'bearing',
      // Kitchen ↔ living opening, centre at (2.20, 4.45).
      openings: [{ id: OPENING.doorKitchenLiving, type: 'door', center: 1.55, width: 1.1, sill: 0, head: 2.1, hinge: 'a', swing: 'out' }],
    },
    { id: WALL.bearingCentralS, a: NODE.cM, b: NODE.cS, thickness: 0.38, role: 'bearing' },

    // ---- Partitions, 0.10 ----
    { id: WALL.wallLivGuest, a: NODE.lgnSw, b: NODE.livSe, thickness: 0.1, role: 'partition' },
    { id: WALL.wallLivCloset, a: NODE.cM, b: NODE.clN, thickness: 0.1, role: 'partition' },
    {
      id: WALL.wallLivHall,
      a: NODE.clN,
      b: NODE.livSe,
      thickness: 0.1,
      role: 'partition',
      // Living ↔ hall opening, centre at (5.65, 5.45).
      openings: [{ id: OPENING.doorLivingHall, type: 'door', center: 0.95, width: 1.2, sill: 0, head: 2.15, hinge: 'b', swing: 'out' }],
    },
    {
      id: WALL.wallGuestHall,
      a: NODE.livSe,
      b: NODE.grSe,
      thickness: 0.1,
      role: 'partition',
      // Guest room door, centre at (7.40, 5.45).
      openings: [{ id: OPENING.doorGuestHall, type: 'door', center: 0.8, width: 0.9, sill: 0, head: 2.1, hinge: 'b', swing: 'out' }],
    },
    {
      id: WALL.wallCloset,
      a: NODE.clN,
      b: NODE.clS,
      thickness: 0.1,
      role: 'partition',
      // Closet door, centre at (4.70, 6.50).
      openings: [{ id: OPENING.doorCloset, type: 'door', center: 1.05, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'in' }],
    },
    { id: WALL.wallGuestStudy, a: NODE.stNw, b: NODE.grSe, thickness: 0.1, role: 'partition' },
    {
      id: WALL.wallHallStudy,
      a: NODE.grSe,
      b: NODE.hallE,
      thickness: 0.1,
      role: 'partition',
      // Study door, centre at (9.55, 5.975).
      openings: [{ id: OPENING.doorStudy, type: 'door', center: 0.525, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'out' }],
    },
    {
      id: WALL.wallHallBed,
      a: NODE.hallE,
      b: NODE.baNe,
      thickness: 0.1,
      role: 'partition',
      // Bedroom door, centre at (9.55, 7.025).
      openings: [{ id: OPENING.doorBedroom, type: 'door', center: 0.525, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'out' }],
    },
    { id: WALL.wallStudyBed, a: NODE.hallE, b: NODE.beNe, thickness: 0.1, role: 'partition' },
    {
      id: WALL.wallHallBath,
      a: NODE.baNw,
      b: NODE.baNe,
      thickness: 0.1,
      role: 'partition',
      // Bathroom door, centre at (8.50, 7.55).
      openings: [{ id: OPENING.doorBathroom, type: 'door', center: 1.3, width: 0.8, sill: 0, head: 2.1, hinge: 'a', swing: 'in' }],
    },
    { id: WALL.wallBathBed, a: NODE.baNe, b: NODE.baSe, thickness: 0.1, role: 'partition' },
  ],

  rooms: [
    {
      id: ROOM.loggiaWest,
      name: 'West loggia',
      anchor: { x: 1.05, z: 2.0 },
      floorMaterial: FINISH.ceramic_light,
      accent: '#a8b5a4',
      kind: 'loggia',
    },
    { id: ROOM.kitchen, name: 'Kitchen', anchor: { x: 1.05, z: 5.2 }, floorMaterial: FINISH.oak, accent: '#8fae9d' },
    {
      id: ROOM.living,
      name: 'Living and dining room',
      anchor: { x: 4.4, z: 3.4 },
      floorMaterial: FINISH.oak,
      accent: '#d9a66d',
    },
    { id: ROOM.guestRoom, name: 'Guest room', anchor: { x: 8.0, z: 3.6 }, floorMaterial: FINISH.oak, accent: '#93a896' },
    {
      id: ROOM.loggiaNorth,
      name: 'North loggia',
      anchor: { x: 8.0, z: 0.9 },
      floorMaterial: FINISH.ceramic_light,
      accent: '#bd765c',
      kind: 'loggia',
    },
    { id: ROOM.study, name: 'Study', anchor: { x: 12.0, z: 5.2 }, floorMaterial: FINISH.oak, accent: '#c8beb0' },
    { id: ROOM.bedroom, name: 'Bedroom', anchor: { x: 12.0, z: 8.5 }, floorMaterial: FINISH.oak, accent: '#cfae8e' },
    { id: ROOM.bathroom, name: 'Bathroom', anchor: { x: 8.4, z: 9.0 }, floorMaterial: FINISH.stone, accent: '#a5c0be' },
    { id: ROOM.closet, name: 'Walk-in closet', anchor: { x: 3.5, z: 6.5 }, floorMaterial: FINISH.oak, accent: '#b0a294' },
    { id: ROOM.hall, name: 'Entrance hall', anchor: { x: 7.0, z: 6.5 }, floorMaterial: FINISH.oak, accent: '#d2b28f' },
  ],

  // No `materials[]`: every finish this scene uses (oak, stone, light ceramic
  // for floors; walnut, linen, brass, ... for furniture) is a bundled catalogue
  // entry and resolves through `material-catalogue.resolveFinish`. The field is
  // reserved for materials a scene defines itself.

  assets: demoFurniture,

  presentationCamera: { position: { x: 7.2, y: 14.0, z: 22.0 }, target: { x: 7.2, y: 0.6, z: 5.2 } },

  roomCameras: {
    [ROOM.loggiaWest]: { position: { x: 0.9, y: 1.6, z: 2.3 }, target: { x: 1.6, y: 1.3, z: 1.4 } },
    [ROOM.kitchen]: { position: { x: 1.15, y: 1.6, z: 6.4 }, target: { x: 0.5, y: 1.2, z: 4.6 } },
    // Walk mode spawns here: the open floor between the TV wall and the coffee
    // table, the only spot with a straight run to both the lounge and the hall.
    [ROOM.living]: { position: { x: 3.45, y: 1.6, z: 3.3 }, target: { x: 4.4, y: 1.3, z: 0.6 } },
    [ROOM.guestRoom]: { position: { x: 8.3, y: 1.6, z: 4.9 }, target: { x: 7.2, y: 1.3, z: 3.4 } },
    [ROOM.loggiaNorth]: { position: { x: 7.2, y: 1.6, z: 1.3 }, target: { x: 8.6, y: 1.3, z: 0.5 } },
    [ROOM.study]: { position: { x: 10.2, y: 1.6, z: 6.1 }, target: { x: 12.6, y: 1.3, z: 4.4 } },
    [ROOM.bedroom]: { position: { x: 10.3, y: 1.6, z: 8.6 }, target: { x: 12.4, y: 1.3, z: 7.4 } },
    [ROOM.bathroom]: { position: { x: 8.45, y: 1.6, z: 8.1 }, target: { x: 8.3, y: 1.2, z: 9.9 } },
    [ROOM.closet]: { position: { x: 4.2, y: 1.6, z: 6.9 }, target: { x: 3.4, y: 1.3, z: 5.7 } },
    [ROOM.hall]: { position: { x: 9.1, y: 1.6, z: 7.1 }, target: { x: 5.6, y: 1.3, z: 6.2 } },
  },

  // Walk mode spawns here: the open floor between the TV wall and the coffee
  // table, the only spot with a straight run to both the lounge and the hall.
  walkSpawn: { position: { x: 3.45, y: 1.6, z: 3.3 }, target: { x: 4.4, y: 1.3, z: 0.6 } },

  navigation: {
    points: [
      { x: 0.9, y: 1.6, z: 2.3 }, // loggia-west
      { x: 1.15, y: 1.6, z: 4.6 }, // kitchen, by the hob
      { x: 1.15, y: 1.6, z: 6.4 }, // kitchen, by the window
      { x: 3.45, y: 1.6, z: 3.3 }, // living, lounge
      { x: 5.8, y: 1.6, z: 4.9 }, // living, by the hall door
      { x: 7.2, y: 1.6, z: 0.9 }, // loggia-north
      { x: 7.9, y: 1.6, z: 3.6 }, // guest room
      { x: 11.0, y: 1.6, z: 5.4 }, // study
      { x: 11.0, y: 1.6, z: 8.6 }, // bedroom
      { x: 8.45, y: 1.6, z: 8.2 }, // bathroom
      { x: 3.6, y: 1.6, z: 6.6 }, // closet
      { x: 6.5, y: 1.6, z: 6.4 }, // hall, by the entrance
      { x: 8.6, y: 1.6, z: 6.4 }, // hall, by the bedroom door
    ],
  },

  autotour: {
    // Eye-level walkthrough: entrance hall → living room and its bay → guest
    // room → kitchen → walk-in closet → bathroom → study → bedroom. Every wall
    // crossing happens at the centre of a door, and every leg keeps clear of
    // the re-laid furniture.
    //
    // The bay is a dead end reached along the WEST channel (between the plant
    // and the dining table, then through the 2.90 m throat): the east aisle
    // pinches to 0.44 m between the sofa and the console, which no camera line
    // can thread with a quarter-metre to spare. `tour-player.test.ts` holds the
    // whole smoothed run — fillets included — to that clearance, and
    // `scene-data.test.ts` holds every leg to `canTraverse` past the furniture.
    speed: 1.1,
    path: [
      { x: 5.9, y: 1.6, z: 7.15 }, // 0  hall, just inside the entrance
      { x: 5.9, y: 1.6, z: 6.6 }, // 1  hall
      { x: 5.65, y: 1.6, z: 5.45 }, // 2  door-living-hall
      { x: 5.7, y: 1.6, z: 4.95 }, // 3  living, south aisle
      { x: 4.3, y: 1.6, z: 4.75 }, // 4  living, south aisle
      { x: 3.45, y: 1.6, z: 3.3 }, // 5  living, mid floor past the TV wall
      { x: 3.45, y: 1.6, z: 2.3 }, // 6  living, west of the dining table
      { x: 3.22, y: 1.6, z: 1.5 }, // 7  living, west channel
      { x: 3.2, y: 1.6, z: 0.75 }, // 8  living, bay throat
      { x: 3.35, y: 1.6, z: 0.05 }, // 9  living, inside the bay
      { x: 3.2, y: 1.6, z: 0.75 }, // 10 living, bay throat
      { x: 3.22, y: 1.6, z: 1.5 }, // 11 living, west channel
      { x: 3.45, y: 1.6, z: 2.3 }, // 12 living
      { x: 3.45, y: 1.6, z: 3.3 }, // 13 living, mid floor
      { x: 4.3, y: 1.6, z: 4.75 }, // 14 living, south aisle
      { x: 5.7, y: 1.6, z: 4.95 }, // 15 living, south aisle
      { x: 5.65, y: 1.6, z: 5.45 }, // 16 door-living-hall
      { x: 6.6, y: 1.6, z: 6.2 }, // 17 hall
      { x: 7.4, y: 1.6, z: 5.45 }, // 18 door-guest-hall
      { x: 8.25, y: 1.6, z: 4.7 }, // 19 guest room
      { x: 8.05, y: 1.6, z: 2.6 }, // 20 guest room, by the balcony door
      { x: 8.25, y: 1.6, z: 4.1 }, // 21 guest room
      { x: 7.4, y: 1.6, z: 5.45 }, // 22 door-guest-hall
      { x: 6.2, y: 1.6, z: 6.3 }, // 23 hall
      { x: 5.65, y: 1.6, z: 5.45 }, // 24 door-living-hall
      { x: 5.7, y: 1.6, z: 4.95 }, // 25 living, south aisle
      { x: 3.3, y: 1.6, z: 4.6 }, // 26 living, south aisle
      { x: 2.2, y: 1.6, z: 4.45 }, // 27 door-kitchen-living
      { x: 1.04, y: 1.6, z: 4.6 }, // 28 kitchen
      { x: 1.04, y: 1.6, z: 6.4 }, // 29 kitchen, by the window
      { x: 1.02, y: 1.6, z: 5.0 }, // 30 kitchen
      { x: 1.35, y: 1.6, z: 4.55 }, // 31 kitchen, clear of the fridge
      { x: 2.2, y: 1.6, z: 4.45 }, // 32 door-kitchen-living
      { x: 3.3, y: 1.6, z: 4.6 }, // 33 living
      { x: 5.7, y: 1.6, z: 4.95 }, // 34 living
      { x: 5.65, y: 1.6, z: 5.45 }, // 35 door-living-hall
      { x: 5.3, y: 1.6, z: 6.3 }, // 36 hall, by the closet door
      { x: 4.7, y: 1.6, z: 6.5 }, // 37 door-closet
      { x: 3.75, y: 1.6, z: 6.6 }, // 38 walk-in closet
      { x: 4.7, y: 1.6, z: 6.5 }, // 39 door-closet
      { x: 5.6, y: 1.6, z: 6.5 }, // 40 hall
      { x: 8.5, y: 1.6, z: 6.6 }, // 41 hall, north of the console
      { x: 8.5, y: 1.6, z: 7.55 }, // 42 door-bathroom
      { x: 8.45, y: 1.6, z: 8.6 }, // 43 bathroom
      { x: 8.5, y: 1.6, z: 7.55 }, // 44 door-bathroom
      { x: 8.6, y: 1.6, z: 6.8 }, // 45 hall
      { x: 9.55, y: 1.6, z: 5.975 }, // 46 door-study
      { x: 10.55, y: 1.6, z: 5.6 }, // 47 study
      { x: 12.15, y: 1.6, z: 5.58 }, // 48 study, behind the desk chair
      { x: 13.35, y: 1.6, z: 5.55 }, // 49 study, by the window wall
      { x: 11.5, y: 1.6, z: 5.6 }, // 50 study, facing the shelves
      { x: 9.55, y: 1.6, z: 5.975 }, // 51 door-study
      { x: 9.1, y: 1.6, z: 6.6 }, // 52 hall
      { x: 9.55, y: 1.6, z: 7.025 }, // 53 door-bedroom
      { x: 10.4, y: 1.6, z: 7.6 }, // 54 bedroom
      { x: 10.6, y: 1.6, z: 9.3 }, // 55 bedroom
      { x: 13.65, y: 1.6, z: 9.25 }, // 56 bedroom, past the foot of the bed
      { x: 13.75, y: 1.6, z: 7.6 }, // 57 bedroom, by the window
    ],
    gaze: [
      { at: 0, target: { x: 5.9, y: 1.3, z: 6.2 } },
      { at: 1, target: { x: 7.66, y: 1.3, z: 7.465 } }, // hall mirror over the console
      { at: 3, target: { x: 2.6, y: 1.35, z: 2.95 } }, // living TV wall
      { at: 5, target: { x: 4.4, y: 1.0, z: 1.0 } }, // dining table under the pendant
      { at: 8, target: { x: 4.4, y: 1.4, z: -0.55 } }, // bay window
      { at: 9, target: { x: 4.4, y: 1.4, z: -0.9 } },
      { at: 14, target: { x: 5.3, y: 0.9, z: 3.25 } }, // living sofa on the way back
      { at: 19, target: { x: 7.125, y: 0.9, z: 3.63 } }, // guest sofa
      { at: 20, target: { x: 7.6, y: 1.3, z: 1.7 } }, // loggia-north balcony door
      { at: 28, target: { x: 0.45, y: 1.1, z: 5.88 } }, // kitchen worktop
      { at: 29, target: { x: 1.1, y: 1.5, z: 7.4 } }, // kitchen window
      { at: 38, target: { x: 2.69, y: 1.2, z: 6.65 } }, // closet wardrobe
      { at: 43, target: { x: 7.6, y: 1.2, z: 8.2 } }, // bathroom vanity
      { at: 47, target: { x: 12.15, y: 0.9, z: 4.36 } }, // study desk
      { at: 49, target: { x: 12.15, y: 1.5, z: 3.95 } }, // study window
      { at: 50, target: { x: 10.42, y: 1.2, z: 4.2 } }, // study shelves
      { at: 54, target: { x: 12.35, y: 0.8, z: 7.67 } }, // bed
      // The east aisle is 0.97 m wide, so the window can only be a closing shot
      // from across the room; from the aisle itself the run ends on the bed head.
      { at: 55, target: { x: 14.25, y: 1.5, z: 8.3 } }, // bedroom window
      { at: 57, target: { x: 12.35, y: 1.5, z: 6.58 } }, // art over the bed head
    ],
    zones: [
      { at: 0, speed: 0.9 }, // hall is narrow
      { at: 3, speed: 1.2 }, // living room
      { at: 7, speed: 0.8 }, // west channel and the bay
      { at: 13, speed: 1.2 }, // back across the living room
      { at: 19, speed: 0.95 }, // guest room
      { at: 28, speed: 0.75 }, // kitchen is 1.86 m wide
      { at: 33, speed: 1.2 },
      { at: 38, speed: 0.7 }, // walk-in closet
      { at: 41, speed: 1.0 }, // hall
      { at: 43, speed: 0.7 }, // bathroom
      { at: 47, speed: 0.95 }, // study
      { at: 54, speed: 1.05 }, // bedroom
    ],
  },
};

/** The apartment as the viewer loads it: the plan above plus its four interiors. */
export const apartmentScene: SceneData = { ...baseApartment, interiors: demoInteriors };
