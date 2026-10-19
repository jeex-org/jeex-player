/**
 * Procedural geometry builders for the object bank.
 *
 * A builder reads only its resolved asset - `dims`, `finishes`, `options` - and
 * returns a group. Conventions, which are the "pivot and anchor" checks of
 * content-pipeline QC:
 *  - `anchor: 'floor'`: origin at the centre of the footprint, `y = 0` on the floor.
 *  - `anchor: 'wall'`: the object is centred on its origin; the placement puts
 *    that origin on the wall at the right height.
 *  - `anchor: 'ceiling'`: origin at the ceiling plane, the object hangs into -Y.
 *  - the front of every object faces **+Z here**; the loader turns the body once
 *    so the scene sees the documented "front faces -Z at rotationY = 0".
 *  - dimensions are `[width, height, depth]` in metres and drive the geometry, so
 *    a size variant reshapes the object instead of scaling it.
 *
 * Invariant: builders only ever take geometry from the shared cache and
 * materials from the finish registry - they never create or dispose either.
 *
 * The builder bodies themselves live in the five `asset-builders-*` part
 * modules, grouped by category; this file only assembles them into `BUILDERS`.
 * `Builder` itself lives in `asset-kit.ts` so those four modules can import it
 * without a cycle back through this one.
 */

import type { Builder } from './asset-kit.js';
import { buildSofa, buildTable, buildChair, buildStool, buildBed } from './asset-builders-seating.js';
import { buildCaseGoods, buildWallCabinet, buildShelving, buildMediaUnit } from './asset-builders-storage.js';
import {
  buildIsland,
  buildCounter,
  buildCooker,
  buildAppliance,
  buildHood,
  buildVanity,
  buildToilet,
  buildBathtub,
} from './asset-builders-kitchen-bath.js';
import {
  buildLamp,
  buildPendant,
  buildCeilingLight,
  buildRug,
  buildArt,
  buildMirror,
  buildCoatRack,
} from './asset-builders-lighting-decor.js';
import { buildFicusLyrata, buildKentia, buildStrelitzia, buildStrelitziaWhite } from './asset-builders-plants.js';

export const BUILDERS: Readonly<Record<string, Builder>> = {
  sofa: buildSofa,
  table: buildTable,
  chair: buildChair,
  stool: buildStool,
  bed: buildBed,
  case_goods: buildCaseGoods,
  wall_cabinet: buildWallCabinet,
  shelving: buildShelving,
  media_unit: buildMediaUnit,
  island: buildIsland,
  counter: buildCounter,
  cooker: buildCooker,
  appliance: buildAppliance,
  hood: buildHood,
  vanity: buildVanity,
  toilet: buildToilet,
  bathtub: buildBathtub,
  lamp: buildLamp,
  pendant: buildPendant,
  ceiling_light: buildCeilingLight,
  plant_kentia: buildKentia,
  plant_strelitzia: buildStrelitzia,
  plant_ficus_lyrata: buildFicusLyrata,
  plant_strelitzia_white: buildStrelitziaWhite,
  rug: buildRug,
  art: buildArt,
  mirror: buildMirror,
  coat_rack: buildCoatRack,
};
