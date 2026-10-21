/**
 * The demo apartment's furniture (`scene-data.ts` places it): one entry per
 * placement, grouped by room, each room opened by a note on why its pieces
 * stand where they do.
 *
 * Every placement names its room explicitly: ids are opaque UUIDs
 * (`demo-ids.ts`) and carry no name, so the room is data.
 *
 * Facing: every placement here names a legacy `type`, so what the viewer
 * renders is `rotationY + asset.yaw`, where `yaw` is the per-type
 * compensation in `asset-catalogue.LEGACY_TYPE_ALIASES` (a half turn for case
 * goods, appliances and wall pieces). A case good therefore opens along -Z
 * turned by that sum, NOT by `rotationY` alone: with the half turn, a piece on
 * the north wall takes `rotationY: 0`, on the south wall `Math.PI`, on the west
 * wall `Math.PI / 2` and on the east wall `-Math.PI / 2`. `asset-facing.test.ts`
 * checks the sum against the solved wall faces; keep it green when you move
 * anything with a front.
 *
 * Pure data: no `three`, no DOM.
 */

import { ARCHETYPE } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import type { DemoAsset } from '../scene/types.js';
import { DEMO } from './demo-ids.js';

const { room: ROOM, asset: ASSET } = DEMO;

export const demoFurniture: readonly DemoAsset[] = [
  // ---- Kitchen: one run on the north wall, an island in the middle ----
  // The run is worktop then hob, 3.12 m from the west corner; the wall
  // cabinet is centred over the worktop and stays clear of the hood. The
  // fridge stands on the east wall, out of the run, and the island keeps
  // 0.9 m of floor on both of its long sides.
  {
    id: ASSET.kitchenCounter,
    type: 'counter',
    room: ROOM.kitchen,
    position: { x: 1.35, y: 0, z: 0.46 },
    rotationY: 0,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.kitchenCooker,
    type: 'stove',
    room: ROOM.kitchen,
    position: { x: 2.91, y: 0, z: 0.45 },
    rotationY: 0,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.kitchenHood,
    type: 'hood',
    room: ROOM.kitchen,
    position: { x: 2.91, y: 1.64, z: 0.41 },
    rotationY: 0,
    material: FINISH.steel_brushed,
  },
  {
    id: ASSET.kitchenUpperCabinet,
    type: 'upper-cabinet',
    room: ROOM.kitchen,
    position: { x: 1.35, y: 1.81, z: 0.325 },
    rotationY: 0,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.kitchenFridge,
    type: 'fridge',
    room: ROOM.kitchen,
    position: { x: 4.0, y: 0, z: 0.54 },
    rotationY: -Math.PI / 2,
    material: FINISH.steel_brushed,
  },
  {
    id: ASSET.kitchenIsland,
    type: 'island',
    room: ROOM.kitchen,
    position: { x: 2.0, y: 0, z: 2.15 },
    rotationY: 0,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.kitchenPlant,
    type: 'plant',
    room: ROOM.kitchen,
    asset: ARCHETYPE.plant_strelitzia_white,
    position: { x: 0.6, y: 0, z: 3.0 },
    scale: 0.75,
  },

  // ---- Bathroom: bath under the window, WC and basin facing each other ----
  {
    id: ASSET.bathroomBathtub,
    type: 'bathtub',
    room: ROOM.bathroom,
    position: { x: 5.6, y: 0, z: 0.55 },
    material: FINISH.ceramic_white,
  },
  {
    id: ASSET.bathroomToilet,
    type: 'toilet',
    room: ROOM.bathroom,
    position: { x: 4.8, y: 0, z: 1.9 },
    rotationY: -Math.PI / 2,
    material: FINISH.ceramic_white,
  },
  {
    id: ASSET.bathroomVanity,
    type: 'vanity',
    room: ROOM.bathroom,
    position: { x: 6.5, y: 0, z: 1.6 },
    rotationY: -Math.PI / 2,
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.bathroomMirror,
    type: 'mirror',
    room: ROOM.bathroom,
    position: { x: 6.72, y: 1.55, z: 1.6 },
    rotationY: -Math.PI / 2,
    material: FINISH.brass_soft,
  },
  { id: ASSET.bathroomMat, type: 'door-mat', room: ROOM.bathroom, position: { x: 5.6, y: 0, z: 1.3 }, material: FINISH.linen_sand },

  // ---- WC: the pan on the north wall, a hand basin on the east wall ----
  // The room is 1.30 m wide, so the basin keeps 0.80 m of floor beside it.
  {
    id: ASSET.wcToilet,
    type: 'toilet',
    room: ROOM.wc,
    position: { x: 7.5, y: 0, z: 0.5 },
    rotationY: Math.PI,
    material: FINISH.ceramic_white,
  },
  {
    id: ASSET.wcVanity,
    type: 'vanity',
    room: ROOM.wc,
    position: { x: 7.9, y: 0, z: 2.0 },
    rotationY: -Math.PI / 2,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.wcMirror,
    type: 'mirror',
    room: ROOM.wc,
    position: { x: 8.12, y: 1.55, z: 2.0 },
    rotationY: -Math.PI / 2,
    material: FINISH.brass_soft,
  },

  // ---- Guest bedroom: bed head on the east wall, wardrobe on the west ----
  {
    id: ASSET.guestRoomBed,
    type: 'bed',
    room: ROOM.guestRoom,
    position: { x: 11.93, y: 0, z: 1.75 },
    rotationY: Math.PI / 2,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.guestRoomNightstandA,
    type: 'nightstand',
    room: ROOM.guestRoom,
    position: { x: 12.84, y: 0, z: 0.56 },
    rotationY: -Math.PI / 2,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.guestRoomNightstandB,
    type: 'nightstand',
    room: ROOM.guestRoom,
    position: { x: 12.84, y: 0, z: 2.94 },
    rotationY: -Math.PI / 2,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.guestRoomLamp,
    type: 'table-lamp',
    room: ROOM.guestRoom,
    position: { x: 12.84, y: 0.56, z: 0.56 },
    material: FINISH.brass_soft,
  },
  {
    id: ASSET.guestRoomWardrobe,
    type: 'wardrobe',
    room: ROOM.guestRoom,
    position: { x: 8.55, y: 0, z: 1.4 },
    rotationY: Math.PI / 2,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.guestRoomArt,
    type: 'art',
    room: ROOM.guestRoom,
    position: { x: 13.025, y: 1.5, z: 1.75 },
    rotationY: -Math.PI / 2,
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.guestRoomRug,
    type: 'rug',
    room: ROOM.guestRoom,
    position: { x: 11.0, y: 0, z: 1.75 },
    rotationY: Math.PI / 2,
    scale: 0.6,
    material: FINISH.linen_sand,
  },

  // ---- Entrance hall ----
  // Seven doors open off the corridor, so the floor stays empty: the console
  // and the shoe cabinet stand on the one run of the spine no clear zone
  // claims, beside the entrance, with the mirror centred over the console.
  { id: ASSET.hallMat, type: 'door-mat', room: ROOM.hall, position: { x: 12.55, y: 0, z: 4.4 }, material: FINISH.ash_black },
  {
    id: ASSET.hallConsole,
    type: 'console',
    room: ROOM.hall,
    position: { x: 11.2, y: 0, z: 3.89 },
    rotationY: 0,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.hallMirror,
    type: 'mirror',
    room: ROOM.hall,
    position: { x: 11.2, y: 1.6, z: 3.75 },
    rotationY: 0,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.hallShoeCabinet,
    type: 'shoe-cabinet',
    room: ROOM.hall,
    position: { x: 10.07, y: 0, z: 3.9 },
    rotationY: 0,
    material: FINISH.plaster_white,
  },

  // ---- Living and dining room ----
  // The lounge takes the west wing: the media unit on the west wall, the
  // sofa facing it. The dining table stands in the east half, between the
  // corridor wall and the loggia door, with 0.75 m behind every chair. The
  // 1.29 m aisle between the two groups is the route from the hall and
  // kitchen doors to the loggia; the bay is a reading corner.
  {
    id: ASSET.livingTvUnit,
    type: 'tv-unit',
    room: ROOM.living,
    position: { x: 0.36, y: 0, z: 6.0 },
    rotationY: Math.PI / 2,
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.livingSofa,
    type: 'sofa',
    room: ROOM.living,
    position: { x: 2.86, y: 0, z: 6.0 },
    rotationY: Math.PI / 2,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.livingCoffeeTable,
    type: 'side-table',
    room: ROOM.living,
    position: { x: 1.705, y: 0, z: 6.0 },
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.livingRug,
    type: 'rug',
    room: ROOM.living,
    position: { x: 1.9, y: 0, z: 6.0 },
    rotationY: Math.PI / 2,
    scale: 0.6,
    material: FINISH.linen_sand,
  },
  { id: ASSET.livingLamp, type: 'lamp', room: ROOM.living, position: { x: 2.86, y: 0, z: 7.45 }, material: FINISH.ash_black },
  {
    id: ASSET.livingArt,
    type: 'art',
    room: ROOM.living,
    position: { x: 1.6, y: 1.5, z: 3.745 },
    rotationY: 0,
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.livingPlant,
    type: 'plant',
    room: ROOM.living,
    asset: ARCHETYPE.plant_strelitzia,
    position: { x: 0.55, y: 0, z: 4.4 },
    scale: 0.7,
  },
  { id: ASSET.livingTable, type: 'table', room: ROOM.living, position: { x: 5.5, y: 0, z: 7.06 }, material: FINISH.oak_natural },
  {
    id: ASSET.livingChairA,
    type: 'chair',
    room: ROOM.living,
    position: { x: 5.15, y: 0, z: 6.255 },
    rotationY: 0,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.livingChairB,
    type: 'chair',
    room: ROOM.living,
    position: { x: 5.85, y: 0, z: 6.255 },
    rotationY: 0,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.livingChairC,
    type: 'chair',
    room: ROOM.living,
    position: { x: 5.15, y: 0, z: 7.865 },
    rotationY: Math.PI,
    material: FINISH.wool_navy,
  },
  {
    id: ASSET.livingChairD,
    type: 'chair',
    room: ROOM.living,
    position: { x: 5.85, y: 0, z: 7.865 },
    rotationY: Math.PI,
    material: FINISH.wool_navy,
  },
  { id: ASSET.livingPendant, type: 'pendant', room: ROOM.living, position: { x: 5.5, y: 0, z: 7.06 }, material: FINISH.brass_soft },
  {
    id: ASSET.livingBookshelf,
    type: 'bookshelf',
    room: ROOM.living,
    position: { x: 6.8, y: 0, z: 6.1 },
    rotationY: -Math.PI / 2,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.livingArmchair,
    type: 'armchair',
    room: ROOM.living,
    position: { x: 2.6, y: 0, z: 9.3 },
    rotationY: Math.PI,
    material: FINISH.linen_sand,
  },
  { id: ASSET.livingSideTable, type: 'side-table', room: ROOM.living, position: { x: 3.4, y: 0, z: 9.1 }, material: FINISH.oak_natural },

  // ---- Bedroom: bed head on the study wall, wardrobe on the opposite wall ----
  // The wardrobe stands on the west wall, south of the hall door's clear zone,
  // and keeps more than 0.9 m clear in front of it to the foot of the bed.
  {
    id: ASSET.bedroomBed,
    type: 'bed',
    room: ROOM.bedroom,
    position: { x: 9.83, y: 0, z: 7.15 },
    rotationY: Math.PI / 2,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.bedroomNightstandA,
    type: 'nightstand',
    room: ROOM.bedroom,
    position: { x: 10.74, y: 0, z: 5.96 },
    rotationY: -Math.PI / 2,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.bedroomNightstandB,
    type: 'nightstand',
    room: ROOM.bedroom,
    position: { x: 10.74, y: 0, z: 8.34 },
    rotationY: -Math.PI / 2,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.bedroomLampA,
    type: 'table-lamp',
    room: ROOM.bedroom,
    position: { x: 10.74, y: 0.56, z: 5.96 },
    material: FINISH.brass_soft,
  },
  {
    id: ASSET.bedroomLampB,
    type: 'table-lamp',
    room: ROOM.bedroom,
    position: { x: 10.74, y: 0.56, z: 8.34 },
    material: FINISH.brass_soft,
  },
  {
    id: ASSET.bedroomArt,
    type: 'art',
    room: ROOM.bedroom,
    position: { x: 10.925, y: 1.5, z: 7.15 },
    rotationY: -Math.PI / 2,
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.bedroomWardrobe,
    type: 'wardrobe',
    room: ROOM.bedroom,
    position: { x: 7.35, y: 0, z: 7.06 },
    rotationY: Math.PI / 2,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.bedroomDresser,
    type: 'dresser',
    room: ROOM.bedroom,
    position: { x: 9.45, y: 0, z: 5.48 },
    rotationY: 0,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.bedroomRug,
    type: 'rug',
    room: ROOM.bedroom,
    position: { x: 9.0, y: 0, z: 7.15 },
    rotationY: Math.PI / 2,
    scale: 0.7,
    material: FINISH.linen_sand,
  },

  // ---- Study: desk under the south window, shelves on the bedroom wall ----
  {
    id: ASSET.studyDesk,
    type: 'desk',
    room: ROOM.study,
    position: { x: 12.05, y: 0, z: 8.74 },
    rotationY: Math.PI,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.studyChair,
    type: 'chair',
    room: ROOM.study,
    position: { x: 12.05, y: 0, z: 8.1 },
    rotationY: 0,
    material: FINISH.wool_sage,
  },
  { id: ASSET.studyTableLamp, type: 'table-lamp', room: ROOM.study, position: { x: 11.65, y: 0.75, z: 8.74 }, material: FINISH.brass_soft },
  {
    id: ASSET.studyBookshelf,
    type: 'bookshelf',
    room: ROOM.study,
    position: { x: 11.2, y: 0, z: 7.2 },
    rotationY: Math.PI / 2,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.studyPlant,
    type: 'plant',
    room: ROOM.study,
    asset: ARCHETYPE.plant_ficus_lyrata,
    position: { x: 12.6, y: 0, z: 5.8 },
    scale: 0.7,
  },

  // ---- Loggia: an armchair turned to the view ----
  // The loggia is the walk between its two doors as well, so its seat stands
  // east of both and the strip between them stays clear.
  {
    id: ASSET.loggiaRug,
    type: 'rug',
    room: ROOM.loggia,
    position: { x: 9.7, y: 0, z: 9.95 },
    scale: 0.4,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.loggiaArmchair,
    type: 'armchair',
    room: ROOM.loggia,
    position: { x: 9.7, y: 0, z: 9.95 },
    rotationY: Math.PI,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.loggiaSideTable,
    type: 'side-table',
    room: ROOM.loggia,
    position: { x: 10.5, y: 0, z: 9.95 },
    material: FINISH.walnut_dark,
  },
];
