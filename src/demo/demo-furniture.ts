/**
 * The demo apartment's furniture (`scene-data.ts` places it): one entry per
 * placement, grouped by room and annotated with the photo it reproduces.
 *
 * Every placement names its room explicitly: ids are opaque UUIDs
 * (`demo-ids.ts`) and carry no name, so the room is data.
 *
 * Facing: every placement here names a legacy `type`, so what the viewer
 * renders is `rotationY + asset.yaw`, where `yaw` is the per-type
 * compensation in `asset-catalogue.LEGACY_TYPE_ALIASES` (a half turn for case
 * goods, appliances and wall pieces). A case good therefore opens along -Z
 * turned by that sum, NOT by `rotationY` alone - the reason a row of these
 * once stood with their doors pressed into the wall. `asset-facing.test.ts`
 * checks the sum against the solved wall faces; keep it green when you move
 * anything with a front.
 *
 * Pure data: no `three`, no DOM.
 */

import { ARCHETYPE, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import type { DemoAsset } from '../scene/types.js';
import { DEMO } from './demo-ids.js';

const { room: ROOM, asset: ASSET } = DEMO;

export const demoFurniture: readonly DemoAsset[] = [
  // ---- West loggia (photo 15): a planter at the window, a chair facing it ----
  // Both loggia palms stand at 0.66: at 1.19 m they are under the 1.2 m that
  // rule 7 calls tall, and a Kentia is the one plant in the flat that stands
  // right at the glass. Scale it up and the only lawful spot is 0.7 m into
  // the room, which is not what photo 15 shows.
  {
    id: ASSET.loggiaWestPlant,
    type: 'plant',
    room: ROOM.loggiaWest,
    asset: ARCHETYPE.plant_kentia,
    position: { x: 0.42, y: 0, z: 1.55 },
    scale: 0.66,
  },
  {
    id: ASSET.loggiaWestChair,
    type: 'chair',
    room: ROOM.loggiaWest,
    position: { x: 1.62, y: 0, z: 1.8 },
    rotationY: Math.PI,
    material: FINISH.steel_brushed,
  },
  {
    id: ASSET.loggiaWestSideTable,
    type: 'side-table',
    room: ROOM.loggiaWest,
    position: { x: 1.72, y: 0, z: 2.45 },
    material: FINISH.walnut_dark,
  },

  // ---- Kitchen (photos 03, 04): one galley run on the west wall ----
  // Base run z 3.96 … 7.08 on the west face: the hob first (clear of the
  // loggia door's zone, which ends at z 3.95), then the 2.40 m worktop. The
  // wall cabinet sits inside that span and clear of the hood; the fridge
  // closes the room on the east wall, south of the living-room door.
  {
    id: ASSET.kitchenCooker,
    type: 'stove',
    room: ROOM.kitchen,
    position: { x: 0.45, y: 0, z: 4.32 },
    rotationY: Math.PI / 2,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.kitchenHood,
    type: 'hood',
    room: ROOM.kitchen,
    position: { x: 0.41, y: 1.64, z: 4.32 },
    rotationY: Math.PI / 2,
    material: FINISH.steel_brushed,
  },
  {
    id: ASSET.kitchenCounter,
    type: 'counter',
    room: ROOM.kitchen,
    position: { x: 0.46, y: 0, z: 5.88 },
    rotationY: Math.PI / 2,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.kitchenUpperCabinet,
    type: 'upper-cabinet',
    room: ROOM.kitchen,
    position: { x: 0.325, y: 1.81, z: 5.88 },
    rotationY: Math.PI / 2,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.kitchenFridge,
    type: 'fridge',
    room: ROOM.kitchen,
    position: { x: 1.66, y: 0, z: 5.45 },
    rotationY: -Math.PI / 2,
    material: FINISH.steel_brushed,
  },
  {
    id: ASSET.kitchenPlant,
    type: 'plant',
    room: ROOM.kitchen,
    asset: ARCHETYPE.plant_strelitzia_white,
    position: { x: 1.7, y: 0, z: 6.9 },
    scale: 0.85,
  },

  // ---- Living room ----
  // Two zones split north/south instead of by a screen: the dining table
  // stands in the bay under its window, the lounge faces the TV on the west
  // wall. The south strip stays clear so the hall door can open into the room
  // and the kitchen door keeps its run.
  { id: ASSET.livingTable, type: 'table', room: ROOM.living, position: { x: 4.4, y: 0, z: 1.0 }, material: FINISH.oak_natural },
  {
    id: ASSET.livingChairA,
    type: 'chair',
    room: ROOM.living,
    position: { x: 4.05, y: 0, z: 0.195 },
    rotationY: 0,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.livingChairB,
    type: 'chair',
    room: ROOM.living,
    position: { x: 4.75, y: 0, z: 0.195 },
    rotationY: 0,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.livingChairC,
    type: 'chair',
    room: ROOM.living,
    position: { x: 4.05, y: 0, z: 1.805 },
    rotationY: Math.PI,
    material: FINISH.wool_navy,
  },
  {
    id: ASSET.livingChairD,
    type: 'chair',
    room: ROOM.living,
    position: { x: 4.75, y: 0, z: 1.805 },
    rotationY: Math.PI,
    material: FINISH.wool_navy,
  },
  { id: ASSET.livingPendant, type: 'pendant', room: ROOM.living, position: { x: 4.4, y: 0, z: 1.0 }, material: FINISH.brass_soft },
  { id: ASSET.livingRug, type: 'rug', room: ROOM.living, position: { x: 4.3, y: 0, z: 3.1 }, material: FINISH.linen_sand },
  {
    id: ASSET.livingTvUnit,
    type: 'tv-unit',
    room: ROOM.living,
    position: { x: 2.6, y: 0, z: 2.95 },
    rotationY: Math.PI / 2,
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.livingSofa,
    type: 'sofa',
    room: ROOM.living,
    position: { x: 5.3, y: 0, z: 3.25 },
    rotationY: Math.PI / 2,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.livingCoffeeTable,
    type: 'side-table',
    room: ROOM.living,
    position: { x: 4.3, y: 0, z: 3.25 },
    material: FINISH.walnut_dark,
  },
  { id: ASSET.livingLamp, type: 'lamp', room: ROOM.living, position: { x: 5.6, y: 0, z: 1.85 }, material: FINISH.ash_black },
  {
    id: ASSET.livingConsole,
    type: 'console',
    room: ROOM.living,
    position: { x: 6.38, y: 0, z: 2.6 },
    rotationY: -Math.PI / 2,
    material: FINISH.oak_natural,
  },
  // Flush to the west wall: standing 0.23 m off it, the plant pinched the only
  // aisle to the bay (plant to dining table) down to 0.35 m.
  {
    id: ASSET.livingPlant,
    type: 'plant',
    room: ROOM.living,
    asset: ARCHETYPE.plant_strelitzia,
    position: { x: 2.68, y: 0, z: 1.7 },
    scale: 0.85,
  },
  {
    id: ASSET.livingBookshelf,
    type: 'bookshelf',
    room: ROOM.living,
    position: { x: 3.3, y: 0, z: 5.25 },
    rotationY: Math.PI,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.livingArt,
    type: 'art',
    room: ROOM.living,
    position: { x: 3.3, y: 1.5, z: 5.37 },
    rotationY: Math.PI,
    material: FINISH.walnut_dark,
  },

  // ---- North loggia (photos 16, 17): one chair turned to the window ----
  {
    id: ASSET.loggiaNorthRug,
    type: 'rug',
    room: ROOM.loggiaNorth,
    position: { x: 8.1, y: 0, z: 0.85 },
    scale: 0.5,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.loggiaNorthArmchair,
    type: 'armchair',
    room: ROOM.loggiaNorth,
    position: { x: 8.6, y: 0, z: 0.85 },
    rotationY: 0,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.loggiaNorthPlant,
    type: 'plant',
    room: ROOM.loggiaNorth,
    asset: ARCHETYPE.plant_kentia,
    position: { x: 7.0, y: 0, z: 0.4 },
    scale: 0.66,
  },

  // ---- Guest room (photos 05, 06) ----
  // Sofa and wardrobe swapped, as asked. The west wall is the only run the
  // two door zones leave whole, and it is 1.75 m long: a two-seat sofa fits
  // it, a three-seat one does not. The wardrobe goes to the east wall, in the
  // compact 1.20 m variant, below the step and clear of the window. The
  // armchair is turned north, to the loggia; the spare chair is gone.
  {
    id: ASSET.guestRoomSofa,
    type: 'sofa',
    room: ROOM.guestRoom,
    variant: VARIANT.sofa_2s_linen,
    position: { x: 7.125, y: 0, z: 3.63 },
    rotationY: -Math.PI / 2,
  },
  {
    id: ASSET.guestRoomWardrobe,
    type: 'wardrobe',
    room: ROOM.guestRoom,
    variant: VARIANT.wardrobe_compact_walnut,
    position: { x: 9.2, y: 0, z: 4.55 },
    rotationY: -Math.PI / 2,
  },
  {
    id: ASSET.guestRoomArmchair,
    type: 'armchair',
    room: ROOM.guestRoom,
    position: { x: 8.95, y: 0, z: 2.55 },
    rotationY: 0,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.guestRoomRug,
    type: 'rug',
    room: ROOM.guestRoom,
    position: { x: 8.3, y: 0, z: 3.4 },
    scale: 0.7,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.guestRoomPlant,
    type: 'plant',
    room: ROOM.guestRoom,
    asset: ARCHETYPE.plant_strelitzia,
    position: { x: 6.9, y: 0, z: 2.25 },
    scale: 0.78,
  },

  // ---- Study (photos 07, 08): desk under the window, wardrobe off the door ----
  {
    id: ASSET.studyDesk,
    type: 'desk',
    room: ROOM.study,
    position: { x: 12.15, y: 0, z: 4.36 },
    rotationY: 0,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.studyChair,
    type: 'chair',
    room: ROOM.study,
    position: { x: 12.15, y: 0, z: 5.0 },
    rotationY: Math.PI,
    material: FINISH.wool_sage,
  },
  { id: ASSET.studyTableLamp, type: 'table-lamp', room: ROOM.study, position: { x: 11.76, y: 0.75, z: 4.36 }, material: FINISH.brass_soft },
  {
    id: ASSET.studyWardrobe,
    type: 'wardrobe',
    room: ROOM.study,
    position: { x: 13.39, y: 0, z: 6.15 },
    rotationY: Math.PI,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.studyBookshelf,
    type: 'bookshelf',
    room: ROOM.study,
    position: { x: 10.42, y: 0, z: 4.2 },
    rotationY: 0,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.studyPlant,
    type: 'plant',
    room: ROOM.study,
    asset: ARCHETYPE.plant_ficus_lyrata,
    position: { x: 10.05, y: 0, z: 5.0 },
    scale: 0.8,
  },

  // ---- Bedroom (photos 09, 10) ----
  {
    id: ASSET.bedroomBed,
    type: 'bed',
    room: ROOM.bedroom,
    position: { x: 12.35, y: 0, z: 7.67 },
    rotationY: Math.PI,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.bedroomNightstandA,
    type: 'nightstand',
    room: ROOM.bedroom,
    position: { x: 11.11, y: 0, z: 6.76 },
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.bedroomNightstandB,
    type: 'nightstand',
    room: ROOM.bedroom,
    position: { x: 13.59, y: 0, z: 6.76 },
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.bedroomLampA,
    type: 'table-lamp',
    room: ROOM.bedroom,
    position: { x: 11.11, y: 0.56, z: 6.76 },
    material: FINISH.brass_soft,
  },
  {
    id: ASSET.bedroomLampB,
    type: 'table-lamp',
    room: ROOM.bedroom,
    position: { x: 13.59, y: 0.56, z: 6.76 },
    material: FINISH.brass_soft,
  },
  {
    id: ASSET.bedroomArt,
    type: 'art',
    room: ROOM.bedroom,
    position: { x: 12.35, y: 1.5, z: 6.58 },
    rotationY: 0,
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.bedroomWardrobe,
    type: 'wardrobe',
    room: ROOM.bedroom,
    position: { x: 11.0, y: 0, z: 10.05 },
    rotationY: Math.PI,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.bedroomDresser,
    type: 'dresser',
    room: ROOM.bedroom,
    position: { x: 13.2, y: 0, z: 10.12 },
    rotationY: Math.PI,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.bedroomRug,
    type: 'rug',
    room: ROOM.bedroom,
    position: { x: 12.35, y: 0, z: 9.2 },
    scale: 0.75,
    material: FINISH.linen_sand,
  },
  {
    id: ASSET.bedroomPlant,
    type: 'plant',
    room: ROOM.bedroom,
    asset: ARCHETYPE.plant_ficus_lyrata,
    position: { x: 9.9, y: 0, z: 9.3 },
    scale: 0.8,
  },

  // ---- Bathroom (photo 11): corner bath, wall-hung vanity, washer ----
  {
    id: ASSET.bathroomBathtub,
    type: 'bathtub',
    room: ROOM.bathroom,
    position: { x: 8.42, y: 0, z: 9.93 },
    material: FINISH.ceramic_white,
  },
  {
    id: ASSET.bathroomToilet,
    type: 'toilet',
    room: ROOM.bathroom,
    position: { x: 9.28, y: 0, z: 7.95 },
    rotationY: Math.PI,
    material: FINISH.ceramic_white,
  },
  {
    id: ASSET.bathroomVanity,
    type: 'vanity',
    room: ROOM.bathroom,
    position: { x: 7.6, y: 0, z: 8.2 },
    rotationY: Math.PI / 2,
    material: FINISH.walnut_dark,
  },
  {
    id: ASSET.bathroomMirror,
    type: 'mirror',
    room: ROOM.bathroom,
    position: { x: 7.385, y: 1.55, z: 8.2 },
    rotationY: Math.PI / 2,
    material: FINISH.brass_soft,
  },
  // Washing machine: no such type in the bank, nearest box is a nightstand.
  {
    id: ASSET.bathroomWasher,
    type: 'nightstand',
    room: ROOM.bathroom,
    position: { x: 9.26, y: 0, z: 9.0 },
    rotationY: -Math.PI / 2,
    scale: 1.15,
    material: FINISH.plaster_white,
  },
  { id: ASSET.bathroomMat, type: 'door-mat', room: ROOM.bathroom, position: { x: 8.45, y: 0, z: 8.85 }, material: FINISH.linen_sand },

  // ---- Walk-in closet (photo 12) ----
  {
    id: ASSET.closetWardrobe,
    type: 'wardrobe',
    room: ROOM.closet,
    variant: VARIANT.wardrobe_compact_walnut,
    position: { x: 2.69, y: 0, z: 6.65 },
    rotationY: Math.PI / 2,
  },
  {
    id: ASSET.closetShoeCabinet,
    type: 'shoe-cabinet',
    room: ROOM.closet,
    position: { x: 3.9, y: 0, z: 5.68 },
    rotationY: 0,
    material: FINISH.plaster_white,
  },
  {
    id: ASSET.closetMirror,
    type: 'mirror',
    room: ROOM.closet,
    position: { x: 3.9, y: 1.55, z: 5.535 },
    rotationY: 0,
    material: FINISH.brass_soft,
  },

  // ---- Entrance hall (photos 13, 14) ----
  // Seven doors meet here, so the floor stays empty: the console sits BESIDE
  // the entrance, on the only run of wall no clear zone claims, with the
  // mirror centred above it. No coat rack — it stood in three door swings.
  { id: ASSET.hallMat, type: 'door-mat', room: ROOM.hall, position: { x: 5.9, y: 0, z: 7.15 }, material: FINISH.ash_black },
  {
    id: ASSET.hallConsole,
    type: 'console',
    room: ROOM.hall,
    position: { x: 7.66, y: 0, z: 7.33 },
    rotationY: Math.PI,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.hallMirror,
    type: 'mirror',
    room: ROOM.hall,
    position: { x: 7.66, y: 1.6, z: 7.465 },
    rotationY: Math.PI,
    material: FINISH.oak_natural,
  },
  {
    id: ASSET.hallPlant,
    type: 'plant',
    room: ROOM.hall,
    asset: ARCHETYPE.plant_strelitzia_white,
    position: { x: 6.75, y: 0, z: 7.1 },
    scale: 0.85,
  },
];
