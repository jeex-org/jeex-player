/**
 * The demo apartment's four interior presets (`scene-data.ts` attaches them).
 *
 * Kept apart from the plan because they are a different kind of data: the plan
 * says where things are, these tables say what they are dressed in. Both name
 * the flat's entities through `demo-ids.ts`, so neither needs the other.
 *
 * Pure data: no `three`, no DOM.
 */

import type { InteriorPreset, SceneOp } from '../scene/scene-ops.js';
import { OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { DEMO } from './demo-ids.js';

const { room: ROOM, asset: ASSET, opening: OPENING, preset: PRESET } = DEMO;

/**
 * Four complete interiors for the demo flat, in panel order. Every table below
 * has one row per thing the presets touch and one column per preset, so a whole
 * palette reads down a column and a single object's four looks read across a
 * row. Column 0 reproduces exactly what the plan (`scene-data.ts`) ships,
 * which is what makes "back to the standard" one click.
 *
 * Rule for choosing a variant: it must have the SAME footprint as the shipped
 * one, because a preset dresses the flat, it does not re-lay it — the layout
 * linter is held at 0/0 under every preset, and `scene-data.test.ts` checks
 * every placement's footprint and height against the shipped one. That is why
 * no column takes a size variant: not the wide basin, not the 2.8 m island,
 * not a tall shelf, lamp or side table.
 */
const PRESET_IDS = [PRESET.oakSand, PRESET.chalkAsh, PRESET.walnutTerracotta, PRESET.sageGraphite] as const;

const PRESET_NAMES: Quad = ['Oak and sand', 'Chalk and ash', 'Walnut and terracotta', 'Sage and graphite'];

/**
 * `[floor, wall]` the panel draws each preview swatch from. By convention it is
 * the pair the living room gets, so the swatch never lies about the palette.
 */
const PRESET_SWATCHES: Array<[string, string]> = [
  [FINISH.oak, FINISH.sand],
  [FINISH.ash, FINISH.white],
  [FINISH.walnut, FINISH.wallpaper_cream],
  [FINISH.chevron, FINISH.sage],
];

/** One value per preset, in `PRESET_IDS` order. */
type Quad = readonly [string, string, string, string];

/** Floors. The loggia keeps its outdoor ceramic; the bathroom and the WC follow the palette. */
const PRESET_FLOORS: Record<string, Quad> = {
  [ROOM.kitchen]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.living]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.guestRoom]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.study]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.bedroom]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.hall]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.bathroom]: [FINISH.stone, FINISH.ceramic_light, FINISH.stone, FINISH.terrazzo],
  [ROOM.wc]: [FINISH.stone, FINISH.ceramic_light, FINISH.stone, FINISH.terrazzo],
};

/** Walls, every room. The sleeping rooms take the warmer/greener half of each palette. */
const PRESET_WALLS: Record<string, Quad> = {
  [ROOM.kitchen]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.living]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.loggia]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.hall]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.guestRoom]: [FINISH.sand, FINISH.white, FINISH.terra, FINISH.wallpaper_sage],
  [ROOM.study]: [FINISH.sand, FINISH.white, FINISH.terra, FINISH.wallpaper_sage],
  [ROOM.bedroom]: [FINISH.sand, FINISH.white, FINISH.terra, FINISH.wallpaper_sage],
  [ROOM.bathroom]: [FINISH.sand, FINISH.tiles_white, FINISH.tiles_white, FINISH.graphite],
  [ROOM.wc]: [FINISH.sand, FINISH.tiles_white, FINISH.tiles_white, FINISH.graphite],
};

/** Furniture, one row per placement. Column 0 is the variant the plan (`scene-data.ts`) ships. */
const PRESET_VARIANTS: Record<string, Quad> = {
  [ASSET.kitchenCounter]: [VARIANT.counter_run_white, VARIANT.counter_run_white, VARIANT.counter_run_oak, VARIANT.counter_run_ink],
  [ASSET.kitchenCooker]: [VARIANT.cooker_white, VARIANT.cooker_steel, VARIANT.cooker_cream, VARIANT.cooker_navy],
  [ASSET.kitchenHood]: [
    VARIANT.hood_extractor_steel,
    VARIANT.hood_extractor_white,
    VARIANT.hood_extractor_brass,
    VARIANT.hood_extractor_ink,
  ],
  [ASSET.kitchenUpperCabinet]: [
    VARIANT.cabinet_wall_white,
    VARIANT.cabinet_wall_white,
    VARIANT.cabinet_wall_oak,
    VARIANT.cabinet_wall_sage,
  ],
  [ASSET.kitchenFridge]: [VARIANT.fridge_tall_steel, VARIANT.fridge_tall_steel, VARIANT.fridge_tall_steel, VARIANT.fridge_tall_sage],
  [ASSET.kitchenIsland]: [VARIANT.island_kitchen_ink, VARIANT.island_kitchen_oak, VARIANT.island_kitchen_oak, VARIANT.island_kitchen_sage],
  [ASSET.kitchenPlant]: [
    VARIANT.plant_upright_white,
    VARIANT.plant_upright_white,
    VARIANT.plant_upright_cream,
    VARIANT.plant_upright_basalt,
  ],

  [ASSET.bathroomBathtub]: [VARIANT.bathtub_white, VARIANT.bathtub_white, VARIANT.bathtub_brass, VARIANT.bathtub_basalt],
  [ASSET.bathroomToilet]: [VARIANT.toilet_wc_white, VARIANT.toilet_wc_white, VARIANT.toilet_wc_brass, VARIANT.toilet_wc_matt],
  [ASSET.bathroomVanity]: [VARIANT.vanity_sink_walnut, VARIANT.vanity_sink_ink, VARIANT.vanity_sink_walnut, VARIANT.vanity_sink_sage],
  [ASSET.bathroomMirror]: [VARIANT.mirror_round_brass, VARIANT.mirror_round_ink, VARIANT.mirror_round_brass, VARIANT.mirror_round_ink],
  [ASSET.bathroomMat]: [VARIANT.door_mat_sand, VARIANT.door_mat_sand, VARIANT.door_mat_clay, VARIANT.door_mat_ink],

  [ASSET.wcToilet]: [VARIANT.toilet_wc_white, VARIANT.toilet_wc_white, VARIANT.toilet_wc_brass, VARIANT.toilet_wc_matt],
  [ASSET.wcVanity]: [VARIANT.vanity_sink_walnut, VARIANT.vanity_sink_ink, VARIANT.vanity_sink_walnut, VARIANT.vanity_sink_sage],
  [ASSET.wcMirror]: [VARIANT.mirror_round_brass, VARIANT.mirror_round_ink, VARIANT.mirror_round_brass, VARIANT.mirror_round_ink],

  [ASSET.guestRoomBed]: [VARIANT.bed_double_linen, VARIANT.bed_double_boucle, VARIANT.bed_double_boucle, VARIANT.bed_double_linen],
  [ASSET.guestRoomNightstandA]: [VARIANT.nightstand_oak, VARIANT.nightstand_white, VARIANT.nightstand_walnut, VARIANT.nightstand_ink],
  [ASSET.guestRoomNightstandB]: [VARIANT.nightstand_oak, VARIANT.nightstand_white, VARIANT.nightstand_walnut, VARIANT.nightstand_ink],
  [ASSET.guestRoomLamp]: [VARIANT.lamp_table_brass, VARIANT.lamp_table_steel, VARIANT.lamp_table_brass, VARIANT.lamp_table_ink],
  [ASSET.guestRoomWardrobe]: [VARIANT.wardrobe_white, VARIANT.wardrobe_white, VARIANT.wardrobe_oak, VARIANT.wardrobe_ink],
  [ASSET.guestRoomArt]: [VARIANT.art_framed_clay, VARIANT.art_framed_sage, VARIANT.art_framed_clay, VARIANT.art_framed_sage],
  [ASSET.guestRoomRug]: [VARIANT.rug_rect_sand, VARIANT.rug_rect_sand, VARIANT.rug_rect_clay, VARIANT.rug_rect_ink],

  [ASSET.hallMat]: [VARIANT.door_mat_sand, VARIANT.door_mat_sand, VARIANT.door_mat_clay, VARIANT.door_mat_ink],
  [ASSET.hallConsole]: [VARIANT.console_hall_walnut, VARIANT.console_hall_white, VARIANT.console_hall_oak, VARIANT.console_hall_ink],
  [ASSET.hallMirror]: [VARIANT.mirror_round_brass, VARIANT.mirror_round_ink, VARIANT.mirror_round_brass, VARIANT.mirror_round_ink],
  [ASSET.hallShoeCabinet]: [VARIANT.cabinet_shoe_oak, VARIANT.cabinet_shoe_white, VARIANT.cabinet_shoe_oak, VARIANT.cabinet_shoe_ink],

  [ASSET.livingTable]: [VARIANT.table_dining_oak, VARIANT.table_dining_stone_top, VARIANT.table_dining_walnut, VARIANT.table_dining_oak],
  [ASSET.livingChairA]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.livingChairB]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.livingChairC]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.livingChairD]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.livingPendant]: [VARIANT.pendant_cone_ink, VARIANT.pendant_globe_opal, VARIANT.pendant_dome_brass, VARIANT.pendant_cone_ink],
  [ASSET.livingArt]: [VARIANT.art_framed_clay, VARIANT.art_framed_sage, VARIANT.art_framed_clay, VARIANT.art_framed_sage],
  [ASSET.livingTvUnit]: [VARIANT.tv_unit_walnut, VARIANT.tv_unit_white, VARIANT.tv_unit_oak, VARIANT.tv_unit_walnut],
  [ASSET.livingSofa]: [VARIANT.sofa_3s_linen, VARIANT.sofa_3s_boucle, VARIANT.sofa_3s_linen, VARIANT.sofa_3s_wool_charcoal],
  [ASSET.livingCoffeeTable]: [VARIANT.table_side_walnut, VARIANT.table_side_marble, VARIANT.table_side_oak, VARIANT.table_side_marble],
  [ASSET.livingLamp]: [VARIANT.lamp_floor_ink, VARIANT.lamp_floor_steel, VARIANT.lamp_floor_brass, VARIANT.lamp_floor_dark],
  [ASSET.livingRug]: [VARIANT.rug_rect_sand, VARIANT.rug_rect_sand, VARIANT.rug_rect_clay, VARIANT.rug_rect_ink],
  [ASSET.livingBookshelf]: [VARIANT.bookshelf_walnut, VARIANT.bookshelf_oak_open, VARIANT.bookshelf_oak_open, VARIANT.bookshelf_ink],
  [ASSET.livingPlant]: [
    VARIANT.plant_strelitzia_cream,
    VARIANT.plant_strelitzia_cream,
    VARIANT.plant_strelitzia_clay,
    VARIANT.plant_strelitzia_basalt,
  ],
  [ASSET.livingArmchair]: [VARIANT.armchair_velvet, VARIANT.armchair_boucle, VARIANT.armchair_velvet, VARIANT.armchair_sage],
  [ASSET.livingSideTable]: [VARIANT.table_side_walnut, VARIANT.table_side_marble, VARIANT.table_side_oak, VARIANT.table_side_marble],

  [ASSET.bedroomBed]: [VARIANT.bed_double_linen, VARIANT.bed_double_boucle, VARIANT.bed_double_boucle, VARIANT.bed_double_linen],
  [ASSET.bedroomNightstandA]: [VARIANT.nightstand_oak, VARIANT.nightstand_white, VARIANT.nightstand_walnut, VARIANT.nightstand_ink],
  [ASSET.bedroomNightstandB]: [VARIANT.nightstand_oak, VARIANT.nightstand_white, VARIANT.nightstand_walnut, VARIANT.nightstand_ink],
  [ASSET.bedroomLampA]: [VARIANT.lamp_table_brass, VARIANT.lamp_table_steel, VARIANT.lamp_table_brass, VARIANT.lamp_table_ink],
  [ASSET.bedroomLampB]: [VARIANT.lamp_table_brass, VARIANT.lamp_table_steel, VARIANT.lamp_table_brass, VARIANT.lamp_table_ink],
  [ASSET.bedroomArt]: [VARIANT.art_framed_clay, VARIANT.art_framed_sage, VARIANT.art_framed_clay, VARIANT.art_framed_sage],
  [ASSET.bedroomWardrobe]: [VARIANT.wardrobe_white, VARIANT.wardrobe_white, VARIANT.wardrobe_oak, VARIANT.wardrobe_ink],
  [ASSET.bedroomDresser]: [VARIANT.dresser_oak, VARIANT.dresser_white, VARIANT.dresser_oak, VARIANT.dresser_ink],
  [ASSET.bedroomRug]: [VARIANT.rug_rect_sand, VARIANT.rug_rect_sand, VARIANT.rug_rect_clay, VARIANT.rug_rect_ink],

  [ASSET.studyDesk]: [VARIANT.desk_oak, VARIANT.desk_white, VARIANT.desk_walnut, VARIANT.desk_walnut],
  [ASSET.studyChair]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.studyTableLamp]: [VARIANT.lamp_table_brass, VARIANT.lamp_table_steel, VARIANT.lamp_table_brass, VARIANT.lamp_table_ink],
  [ASSET.studyBookshelf]: [VARIANT.bookshelf_walnut, VARIANT.bookshelf_oak_open, VARIANT.bookshelf_oak_open, VARIANT.bookshelf_ink],
  [ASSET.studyPlant]: [VARIANT.plant_ficus_taupe, VARIANT.plant_ficus_cream, VARIANT.plant_ficus_taupe, VARIANT.plant_ficus_basalt],

  [ASSET.loggiaRug]: [VARIANT.rug_rect_sand, VARIANT.rug_rect_sand, VARIANT.rug_rect_clay, VARIANT.rug_rect_ink],
  [ASSET.loggiaArmchair]: [VARIANT.armchair_velvet, VARIANT.armchair_boucle, VARIANT.armchair_velvet, VARIANT.armchair_sage],
  [ASSET.loggiaSideTable]: [VARIANT.table_side_walnut, VARIANT.table_side_marble, VARIANT.table_side_oak, VARIANT.table_side_marble],
};

/** Windows and doors. Only the fill changes; the hole in the wall never moves. */
const PRESET_OPENINGS: Record<string, Quad> = {
  [OPENING.windowKitchenWest]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowBath]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowGuestNorth]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowStudy]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowLivingWest]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowBedroomSouth]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowLoggia]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowLivingBay]: [
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],

  [OPENING.doorEntrance]: [
    OPENING_VARIANT.entry_door_walnut_panelled,
    OPENING_VARIANT.entry_door_white_glass,
    OPENING_VARIANT.entry_door_oak_veneer,
    OPENING_VARIANT.entry_door_graphite_steel,
  ],
  [OPENING.doorKitchenLiving]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorLivingHall]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorBathroom]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorWc]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorGuestRoom]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorBedroom]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorStudy]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorLivingLoggia]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorBedroomLoggia]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
};

/**
 * The tables above, transposed into one `InteriorPreset` per column: the four
 * interiors `apartmentScene` ships, in panel order.
 *
 * Order inside a batch matters once: the wall paints come after the floors, and
 * `set_material` on a room drops that room's per-face overrides, so a preset
 * always lands on a room whose faces agree with it.
 */
export const demoInteriors: readonly InteriorPreset[] = PRESET_IDS.map((id, column) => {
  const ops: SceneOp[] = [];
  for (const [roomId, quad] of Object.entries(PRESET_FLOORS)) {
    ops.push({ op: 'set_material', target: roomId, material: quad[column]! });
  }
  for (const [roomId, quad] of Object.entries(PRESET_WALLS)) {
    ops.push({ op: 'set_material', target: roomId, material: quad[column]! });
  }
  for (const [assetId, quad] of Object.entries(PRESET_VARIANTS)) {
    ops.push({ op: 'replace_asset_variant', assetId, variant: quad[column]! });
  }
  for (const [openingId, quad] of Object.entries(PRESET_OPENINGS)) {
    ops.push({ op: 'replace_opening_variant', openingId, variant: quad[column]! });
  }
  return { id, name: PRESET_NAMES[column]!, swatch: PRESET_SWATCHES[column]!, ops };
});
