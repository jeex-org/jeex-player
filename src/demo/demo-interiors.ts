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
 * linter is held at 0/0 under every preset (`scene-data.test.ts`). That is why
 * the two compact wardrobes, the two-seat guest sofa and the bathroom's
 * stand-in washing machine keep their size variant in all four columns.
 */
const PRESET_IDS = [PRESET.nordicOak, PRESET.chalkAsh, PRESET.walnutTerracotta, PRESET.sageGraphite] as const;

const PRESET_NAMES: Quad = ['Nordic oak', 'Chalk and ash', 'Walnut and terracotta', 'Sage and graphite'];

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

/** Floors. Loggias keep their outdoor ceramic; the bathroom follows the palette. */
const PRESET_FLOORS: Record<string, Quad> = {
  [ROOM.kitchen]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.living]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.guestRoom]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.study]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.bedroom]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.closet]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.hall]: [FINISH.oak, FINISH.ash, FINISH.walnut, FINISH.chevron],
  [ROOM.bathroom]: [FINISH.stone, FINISH.ceramic_light, FINISH.stone, FINISH.terrazzo],
};

/** Walls, every room. The sleeping rooms take the warmer/greener half of each palette. */
const PRESET_WALLS: Record<string, Quad> = {
  [ROOM.loggiaWest]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.kitchen]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.living]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.loggiaNorth]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.closet]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.hall]: [FINISH.sand, FINISH.white, FINISH.wallpaper_cream, FINISH.sage],
  [ROOM.guestRoom]: [FINISH.sand, FINISH.white, FINISH.terra, FINISH.wallpaper_sage],
  [ROOM.study]: [FINISH.sand, FINISH.white, FINISH.terra, FINISH.wallpaper_sage],
  [ROOM.bedroom]: [FINISH.sand, FINISH.white, FINISH.terra, FINISH.wallpaper_sage],
  [ROOM.bathroom]: [FINISH.sand, FINISH.tiles_white, FINISH.tiles_white, FINISH.graphite],
};

/** Furniture, one row per placement. Column 0 is the variant the plan (`scene-data.ts`) ships. */
const PRESET_VARIANTS: Record<string, Quad> = {
  [ASSET.loggiaWestPlant]: [
    VARIANT.plant_kentia_rattan,
    VARIANT.plant_kentia_white,
    VARIANT.plant_kentia_clay,
    VARIANT.plant_kentia_rattan,
  ],
  [ASSET.loggiaWestChair]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.loggiaWestSideTable]: [VARIANT.table_side_walnut, VARIANT.table_side_marble, VARIANT.table_side_oak, VARIANT.table_side_tall],

  [ASSET.kitchenCooker]: [VARIANT.cooker_white, VARIANT.cooker_steel, VARIANT.cooker_cream, VARIANT.cooker_navy],
  [ASSET.kitchenHood]: [
    VARIANT.hood_extractor_steel,
    VARIANT.hood_extractor_white,
    VARIANT.hood_extractor_brass,
    VARIANT.hood_extractor_ink,
  ],
  [ASSET.kitchenCounter]: [VARIANT.counter_run_white, VARIANT.counter_run_white, VARIANT.counter_run_oak, VARIANT.counter_run_ink],
  [ASSET.kitchenUpperCabinet]: [
    VARIANT.cabinet_wall_white,
    VARIANT.cabinet_wall_white,
    VARIANT.cabinet_wall_oak,
    VARIANT.cabinet_wall_sage,
  ],
  [ASSET.kitchenFridge]: [VARIANT.fridge_tall_steel, VARIANT.fridge_tall_steel, VARIANT.fridge_tall_steel, VARIANT.fridge_tall_sage],
  [ASSET.kitchenPlant]: [
    VARIANT.plant_upright_white,
    VARIANT.plant_upright_white,
    VARIANT.plant_upright_cream,
    VARIANT.plant_upright_basalt,
  ],

  [ASSET.livingTable]: [VARIANT.table_dining_oak, VARIANT.table_dining_stone_top, VARIANT.table_dining_walnut, VARIANT.table_dining_oak],
  [ASSET.livingChairA]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.livingChairB]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.livingChairC]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.livingChairD]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.livingPendant]: [VARIANT.pendant_cone_ink, VARIANT.pendant_globe_opal, VARIANT.pendant_dome_brass, VARIANT.pendant_cone_ink],
  [ASSET.livingRug]: [VARIANT.rug_rect_sand, VARIANT.rug_rect_sand, VARIANT.rug_rect_clay, VARIANT.rug_rect_ink],
  // The 2.2 m media unit is the one wide variant the living room cannot take:
  // it reaches into the kitchen door's clear zone and its swing.
  [ASSET.livingTvUnit]: [VARIANT.tv_unit_walnut, VARIANT.tv_unit_white, VARIANT.tv_unit_oak, VARIANT.tv_unit_walnut],
  [ASSET.livingSofa]: [VARIANT.sofa_3s_linen, VARIANT.sofa_3s_boucle, VARIANT.sofa_3s_linen, VARIANT.sofa_3s_wool_charcoal],
  [ASSET.livingCoffeeTable]: [VARIANT.table_side_walnut, VARIANT.table_side_marble, VARIANT.table_side_oak, VARIANT.table_side_tall],
  [ASSET.livingLamp]: [VARIANT.lamp_floor_ink, VARIANT.lamp_floor_steel, VARIANT.lamp_floor_brass, VARIANT.lamp_floor_dark],
  [ASSET.livingConsole]: [VARIANT.console_hall_walnut, VARIANT.console_hall_white, VARIANT.console_hall_oak, VARIANT.console_hall_ink],
  [ASSET.livingPlant]: [
    VARIANT.plant_strelitzia_cream,
    VARIANT.plant_strelitzia_cream,
    VARIANT.plant_strelitzia_clay,
    VARIANT.plant_strelitzia_basalt,
  ],
  [ASSET.livingBookshelf]: [VARIANT.bookshelf_walnut, VARIANT.bookshelf_tall_white, VARIANT.bookshelf_oak_open, VARIANT.bookshelf_ink],
  [ASSET.livingArt]: [VARIANT.art_framed_clay, VARIANT.art_framed_portrait, VARIANT.art_framed_clay, VARIANT.art_framed_sage],

  [ASSET.loggiaNorthRug]: [VARIANT.rug_rect_sand, VARIANT.rug_rect_sand, VARIANT.rug_rect_clay, VARIANT.rug_rect_ink],
  [ASSET.loggiaNorthArmchair]: [VARIANT.armchair_velvet, VARIANT.armchair_boucle, VARIANT.armchair_velvet, VARIANT.armchair_sage],
  [ASSET.loggiaNorthPlant]: [
    VARIANT.plant_kentia_rattan,
    VARIANT.plant_kentia_white,
    VARIANT.plant_kentia_clay,
    VARIANT.plant_kentia_rattan,
  ],

  // Size-locked: the west wall of the guest room takes a two-seat sofa only,
  // and both compact wardrobes stand on runs a full-size one would not fit.
  [ASSET.guestRoomSofa]: [VARIANT.sofa_2s_linen, VARIANT.sofa_2s_linen, VARIANT.sofa_2s_linen, VARIANT.sofa_2s_linen],
  [ASSET.guestRoomWardrobe]: [
    VARIANT.wardrobe_compact_walnut,
    VARIANT.wardrobe_compact_walnut,
    VARIANT.wardrobe_compact_walnut,
    VARIANT.wardrobe_compact_walnut,
  ],
  [ASSET.guestRoomArmchair]: [VARIANT.armchair_velvet, VARIANT.armchair_boucle, VARIANT.armchair_velvet, VARIANT.armchair_sage],
  [ASSET.guestRoomRug]: [VARIANT.rug_rect_sand, VARIANT.rug_rect_sand, VARIANT.rug_rect_clay, VARIANT.rug_rect_ink],
  [ASSET.guestRoomPlant]: [
    VARIANT.plant_strelitzia_cream,
    VARIANT.plant_strelitzia_cream,
    VARIANT.plant_strelitzia_clay,
    VARIANT.plant_strelitzia_basalt,
  ],

  [ASSET.studyDesk]: [VARIANT.desk_oak, VARIANT.desk_white, VARIANT.desk_walnut, VARIANT.desk_walnut],
  [ASSET.studyChair]: [VARIANT.chair_dining_oak, VARIANT.chair_dining_oak, VARIANT.chair_dining_clay, VARIANT.chair_dining_sage],
  [ASSET.studyTableLamp]: [VARIANT.lamp_table_brass, VARIANT.lamp_table_steel, VARIANT.lamp_table_brass, VARIANT.lamp_table_ink],
  [ASSET.studyWardrobe]: [VARIANT.wardrobe_white, VARIANT.wardrobe_white, VARIANT.wardrobe_oak, VARIANT.wardrobe_ink],
  [ASSET.studyBookshelf]: [VARIANT.bookshelf_walnut, VARIANT.bookshelf_tall_white, VARIANT.bookshelf_oak_open, VARIANT.bookshelf_ink],
  [ASSET.studyPlant]: [VARIANT.plant_ficus_taupe, VARIANT.plant_ficus_cream, VARIANT.plant_ficus_taupe, VARIANT.plant_ficus_basalt],

  [ASSET.bedroomBed]: [VARIANT.bed_double_linen, VARIANT.bed_double_boucle, VARIANT.bed_double_boucle, VARIANT.bed_platform],
  [ASSET.bedroomNightstandA]: [VARIANT.nightstand_oak, VARIANT.nightstand_white, VARIANT.nightstand_walnut, VARIANT.nightstand_ink],
  [ASSET.bedroomNightstandB]: [VARIANT.nightstand_oak, VARIANT.nightstand_white, VARIANT.nightstand_walnut, VARIANT.nightstand_ink],
  [ASSET.bedroomLampA]: [VARIANT.lamp_table_brass, VARIANT.lamp_table_steel, VARIANT.lamp_table_brass, VARIANT.lamp_table_ink],
  [ASSET.bedroomLampB]: [VARIANT.lamp_table_brass, VARIANT.lamp_table_steel, VARIANT.lamp_table_brass, VARIANT.lamp_table_ink],
  [ASSET.bedroomArt]: [VARIANT.art_framed_clay, VARIANT.art_framed_portrait, VARIANT.art_framed_clay, VARIANT.art_framed_sage],
  [ASSET.bedroomWardrobe]: [VARIANT.wardrobe_white, VARIANT.wardrobe_white, VARIANT.wardrobe_oak, VARIANT.wardrobe_ink],
  [ASSET.bedroomDresser]: [VARIANT.dresser_oak, VARIANT.dresser_white, VARIANT.dresser_oak, VARIANT.dresser_ink],
  [ASSET.bedroomRug]: [VARIANT.rug_rect_sand, VARIANT.rug_rect_sand, VARIANT.rug_rect_clay, VARIANT.rug_rect_ink],
  [ASSET.bedroomPlant]: [VARIANT.plant_ficus_taupe, VARIANT.plant_ficus_cream, VARIANT.plant_ficus_taupe, VARIANT.plant_ficus_basalt],

  [ASSET.bathroomBathtub]: [VARIANT.bathtub_white, VARIANT.bathtub_white, VARIANT.bathtub_brass, VARIANT.bathtub_basalt],
  [ASSET.bathroomToilet]: [VARIANT.toilet_wc_white, VARIANT.toilet_wc_white, VARIANT.toilet_wc_brass, VARIANT.toilet_wc_matt],
  [ASSET.bathroomVanity]: [VARIANT.vanity_sink_walnut, VARIANT.vanity_sink_wide_oak, VARIANT.vanity_sink_walnut, VARIANT.vanity_sink_sage],
  [ASSET.bathroomMirror]: [VARIANT.mirror_round_brass, VARIANT.mirror_round_ink, VARIANT.mirror_rect_walnut, VARIANT.mirror_round_ink],
  // The washing-machine stand-in: white in every palette but the shipped one.
  [ASSET.bathroomWasher]: [VARIANT.nightstand_oak, VARIANT.nightstand_white, VARIANT.nightstand_white, VARIANT.nightstand_white],
  [ASSET.bathroomMat]: [VARIANT.door_mat_sand, VARIANT.door_mat_sand, VARIANT.door_mat_clay, VARIANT.door_mat_ink],

  [ASSET.closetWardrobe]: [
    VARIANT.wardrobe_compact_walnut,
    VARIANT.wardrobe_compact_walnut,
    VARIANT.wardrobe_compact_walnut,
    VARIANT.wardrobe_compact_walnut,
  ],
  [ASSET.closetShoeCabinet]: [VARIANT.cabinet_shoe_oak, VARIANT.cabinet_shoe_white, VARIANT.cabinet_shoe_tall, VARIANT.cabinet_shoe_ink],
  [ASSET.closetMirror]: [VARIANT.mirror_round_brass, VARIANT.mirror_round_ink, VARIANT.mirror_rect_walnut, VARIANT.mirror_round_ink],

  [ASSET.hallMat]: [VARIANT.door_mat_sand, VARIANT.door_mat_sand, VARIANT.door_mat_clay, VARIANT.door_mat_ink],
  [ASSET.hallConsole]: [VARIANT.console_hall_walnut, VARIANT.console_hall_white, VARIANT.console_hall_oak, VARIANT.console_hall_ink],
  [ASSET.hallMirror]: [VARIANT.mirror_round_brass, VARIANT.mirror_round_ink, VARIANT.mirror_rect_walnut, VARIANT.mirror_round_ink],
  [ASSET.hallPlant]: [VARIANT.plant_upright_white, VARIANT.plant_upright_white, VARIANT.plant_upright_cream, VARIANT.plant_upright_basalt],
};

/** Windows and doors. Only the fill changes; the hole in the wall never moves. */
const PRESET_OPENINGS: Record<string, Quad> = {
  [OPENING.windowLoggiaWest]: [
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
  [OPENING.windowLoggiaNorth]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowGuestEast]: [
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
  [OPENING.windowBedroomEast]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowKitchenSouth]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowKitchenLoggia]: [
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_pvc_white,
    OPENING_VARIANT.window_oak_vertical,
    OPENING_VARIANT.window_graphite_grid,
  ],
  [OPENING.windowGuestLoggia]: [
    OPENING_VARIANT.window_pvc_white,
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
  [OPENING.doorKitchenLoggia]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorGuestLoggia]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
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
  [OPENING.doorGuestHall]: [
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_white_flat_bar,
    OPENING_VARIANT.door_oak_panelled_knob,
    OPENING_VARIANT.door_glass_slim,
  ],
  [OPENING.doorCloset]: [
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
  [OPENING.doorBedroom]: [
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
