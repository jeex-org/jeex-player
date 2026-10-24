/**
 * Object-bank finish library: the catalogue data and the lookups over it.
 *
 * This is the *furniture* half of the material system, deliberately separate
 * from `finish-catalogue.ts`, which owns the room surfaces the user paints.
 * Entries mirror the `materials[]` shape of the open library manifest: `id`,
 * `name`, `tags`, `apply` and a `pbr` block. Where the manifest allows a
 * parametric material, an entry carries a `generator` instead of baked maps; `asset-finishes.ts` rasterises those through `textures.ts`.
 *
 * Pure module: no `three`, no DOM — so the validator and the scene model can
 * resolve an object finish id without pulling in the renderer.
 *
 * Every row is addressed by its UUID; its readable name is its display-only
 * `slug`. No alias table maps readable words (`linen`, `brass`) onto rows: a
 * document names a finish by its UUID.
 */

import { FINISH } from './finish-ids.js';
import type { FinishDefinition } from './finish-types.js';

/**
 * The finish TYPES live in `finish-types.ts` and the three with importers of
 * their own are re-exported here, so that every importer of this module keeps
 * the path it has always used while a module that only needs the SHAPE of a
 * material — `assets/project-manifest.ts` — can take it without the seventy
 * entries below. `FinishApply` and `FinishPbr` are reached through
 * `finish-types.ts` directly: re-exporting a type nobody imports from here is
 * dead surface (`check:dead`).
 */
export type { FinishDefinition, FinishGenerator, FinishSlot } from './finish-types.js';

/** Metres one wood texture repeat covers along and across the grain. */
const WOOD_TILE: [number, number] = [1.2, 0.4];

/**
 * Every finish of the object bank, each addressed by its fixed UUID literal
 * (`FINISH` in `finish-ids.ts`) and carrying its readable `slug` for display.
 */
export const ASSET_FINISHES: readonly (FinishDefinition & { readonly slug: string })[] = [
  // --- Wood -------------------------------------------------------------------------------
  {
    id: FINISH.oak_natural,
    slug: 'oak_natural',
    name: 'Natural oak',
    tags: ['wood', 'warm', 'light'],
    apply: ['furniture', 'floor'],
    pbr: { color: '#b99a75', roughness: 0.55, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.6, tile: WOOD_TILE, bump: 0.0016 },
    generator: { kind: 'wood_grain', tone: '#b99a75', seed: 11, variation: 0.9 },
  },
  {
    id: FINISH.walnut_dark,
    slug: 'walnut_dark',
    name: 'Dark walnut',
    tags: ['wood', 'dark', 'warm'],
    apply: ['furniture'],
    pbr: { color: '#6a4b39', roughness: 0.48, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.5, tile: WOOD_TILE, bump: 0.0016 },
    generator: { kind: 'wood_grain', tone: '#6a4b39', seed: 23, variation: 1.1 },
  },
  {
    id: FINISH.ash_black,
    slug: 'ash_black',
    name: 'Black stained ash',
    tags: ['wood', 'dark', 'contemporary'],
    apply: ['furniture'],
    pbr: { color: '#2c2b29', roughness: 0.52, metalness: 0, tile: WOOD_TILE, bump: 0.0012 },
    generator: { kind: 'wood_grain', tone: '#2c2b29', seed: 37, variation: 1.4 },
  },
  {
    id: FINISH.teak_honey,
    slug: 'teak_honey',
    name: 'Honey teak',
    tags: ['wood', 'warm'],
    apply: ['furniture'],
    pbr: { color: '#a87248', roughness: 0.5, metalness: 0, clearcoat: 0.14, clearcoatRoughness: 0.55, tile: WOOD_TILE, bump: 0.0016 },
    generator: { kind: 'wood_grain', tone: '#a87248', seed: 43, variation: 1 },
  },
  // --- Upholstery -------------------------------------------------------------------------
  {
    id: FINISH.linen_sand,
    slug: 'linen_sand',
    name: 'Sand linen',
    tags: ['fabric', 'upholstery', 'warm'],
    apply: ['fabric', 'furniture'],
    pbr: { color: '#cdbda2', roughness: 0.94, sheen: 0.6, sheenColor: '#efe4d0', sheenRoughness: 0.75, tile: [0.35, 0.35], bump: 0.0011 },
    generator: { kind: 'fabric_weave', tone: '#cdbda2', seed: 5, threads: 72, variance: 0.1 },
  },
  {
    id: FINISH.wool_charcoal,
    slug: 'wool_charcoal',
    name: 'Charcoal wool',
    tags: ['fabric', 'upholstery', 'dark'],
    apply: ['fabric', 'furniture'],
    pbr: { color: '#4a4e52', roughness: 0.95, sheen: 0.45, sheenColor: '#8a9096', sheenRoughness: 0.8, tile: [0.35, 0.35], bump: 0.0012 },
    generator: { kind: 'fabric_weave', tone: '#4a4e52', seed: 19, threads: 64, variance: 0.12 },
  },
  {
    id: FINISH.boucle_ivory,
    slug: 'boucle_ivory',
    name: 'Ivory boucle',
    tags: ['fabric', 'upholstery', 'light'],
    apply: ['fabric', 'furniture'],
    pbr: { color: '#e2dbcb', roughness: 0.97, sheen: 0.8, sheenColor: '#fffaf0', sheenRoughness: 0.9, tile: [0.22, 0.22], bump: 0.0022 },
    generator: { kind: 'fabric_weave', tone: '#e2dbcb', seed: 41, threads: 40, variance: 0.16 },
  },
  {
    id: FINISH.velvet_terracotta,
    slug: 'velvet_terracotta',
    name: 'Terracotta velvet',
    tags: ['fabric', 'upholstery', 'accent'],
    apply: ['fabric', 'furniture'],
    pbr: { color: '#b06a51', roughness: 0.82, sheen: 1, sheenColor: '#e6a184', sheenRoughness: 0.42, tile: [0.3, 0.3], bump: 0.0008 },
    generator: { kind: 'fabric_weave', tone: '#b06a51', seed: 7, threads: 88, variance: 0.08 },
  },
  {
    id: FINISH.wool_sage,
    slug: 'wool_sage',
    name: 'Sage wool',
    tags: ['fabric', 'upholstery', 'accent'],
    apply: ['fabric', 'furniture'],
    pbr: { color: '#8f9c8b', roughness: 0.93, sheen: 0.5, sheenColor: '#c3cdbe', sheenRoughness: 0.8, tile: [0.35, 0.35], bump: 0.0012 },
    generator: { kind: 'fabric_weave', tone: '#8f9c8b', seed: 53, threads: 64, variance: 0.11 },
  },
  {
    id: FINISH.wool_navy,
    slug: 'wool_navy',
    name: 'Navy wool',
    tags: ['fabric', 'upholstery', 'dark'],
    apply: ['fabric', 'furniture'],
    pbr: { color: '#42536a', roughness: 0.93, sheen: 0.45, sheenColor: '#8496ad', sheenRoughness: 0.8, tile: [0.35, 0.35], bump: 0.0012 },
    generator: { kind: 'fabric_weave', tone: '#42536a', seed: 59, threads: 64, variance: 0.11 },
  },
  {
    id: FINISH.leather_tan,
    slug: 'leather_tan',
    name: 'Tan leather',
    tags: ['leather', 'upholstery', 'warm'],
    apply: ['fabric', 'furniture'],
    pbr: { color: '#9c6b47', roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.55, tile: [0.4, 0.4], bump: 0.0009 },
    generator: { kind: 'painted_plaster', tone: '#9c6b47', seed: 61 },
  },
  // --- Painted / lacquered ----------------------------------------------------------------
  {
    id: FINISH.plaster_white,
    slug: 'plaster_white',
    name: 'White plaster',
    tags: ['paint', 'neutral'],
    apply: ['wall', 'furniture'],
    pbr: { color: '#e6e0d6', roughness: 0.88, tile: [1, 1], bump: 0.0006 },
    generator: { kind: 'painted_plaster', tone: '#e6e0d6', seed: 103 },
  },
  {
    id: FINISH.lacquer_sage,
    slug: 'lacquer_sage',
    name: 'Sage lacquer',
    tags: ['paint', 'kitchen', 'accent'],
    apply: ['furniture'],
    pbr: { color: '#7d8f80', roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.24 },
  },
  {
    id: FINISH.lacquer_clay,
    slug: 'lacquer_clay',
    name: 'Clay lacquer',
    tags: ['paint', 'kitchen', 'warm'],
    apply: ['furniture'],
    pbr: { color: '#b3866c', roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.28 },
  },
  {
    id: FINISH.lacquer_ink,
    slug: 'lacquer_ink',
    name: 'Ink lacquer',
    tags: ['paint', 'kitchen', 'dark'],
    apply: ['furniture'],
    pbr: { color: '#2e3436', roughness: 0.3, clearcoat: 0.75, clearcoatRoughness: 0.2 },
  },
  {
    id: FINISH.lacquer_navy,
    slug: 'lacquer_navy',
    name: 'Navy lacquer',
    tags: ['paint', 'kitchen', 'dark'],
    apply: ['furniture'],
    pbr: { color: '#3b4a5e', roughness: 0.32, clearcoat: 0.72, clearcoatRoughness: 0.22 },
  },
  {
    id: FINISH.lacquer_cream,
    slug: 'lacquer_cream',
    name: 'Cream lacquer',
    tags: ['paint', 'kitchen', 'light'],
    apply: ['furniture'],
    pbr: { color: '#e3d7bf', roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.28 },
  },
  // --- Stone / ceramic --------------------------------------------------------------------
  {
    id: FINISH.stone_carrara,
    slug: 'stone_carrara',
    name: 'Carrara stone',
    tags: ['stone', 'worktop', 'light'],
    apply: ['furniture', 'floor'],
    pbr: { color: '#ded9d0', roughness: 0.28, clearcoat: 0.35, clearcoatRoughness: 0.22, tile: [1.4, 1.4], bump: 0.0005 },
    generator: { kind: 'tile_grid', tone: '#ded9d0', grout: '#cec8bd', seed: 71, grid: 1, style: 'stone' },
  },
  {
    id: FINISH.stone_basalt,
    slug: 'stone_basalt',
    name: 'Basalt stone',
    tags: ['stone', 'worktop', 'dark'],
    apply: ['furniture'],
    pbr: { color: '#575a5a', roughness: 0.42, tile: [1.4, 1.4], bump: 0.0006 },
    generator: { kind: 'tile_grid', tone: '#575a5a', grout: '#4a4d4d', seed: 73, grid: 1, style: 'stone' },
  },
  {
    id: FINISH.ceramic_white,
    slug: 'ceramic_white',
    name: 'White ceramic',
    tags: ['ceramic', 'bathroom'],
    apply: ['furniture'],
    pbr: { color: '#f2f0ec', roughness: 0.12, clearcoat: 0.9, clearcoatRoughness: 0.08 },
  },
  {
    id: FINISH.tile_sage,
    slug: 'tile_sage',
    name: 'Sage tile',
    tags: ['tile', 'bathroom', 'kitchen'],
    apply: ['wall', 'furniture'],
    pbr: { color: '#9fb2a8', roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.2, tile: [0.4, 0.4], bump: 0.0018 },
    generator: { kind: 'tile_grid', tone: '#9fb2a8', grout: '#e2ded4', seed: 17, grid: 4, style: 'ceramic' },
  },
  {
    id: FINISH.tile_white,
    slug: 'tile_white',
    name: 'White tile',
    tags: ['tile', 'bathroom', 'kitchen'],
    apply: ['wall', 'furniture'],
    pbr: { color: '#e8e4da', roughness: 0.2, clearcoat: 0.55, clearcoatRoughness: 0.18, tile: [0.4, 0.4], bump: 0.0018 },
    generator: { kind: 'tile_grid', tone: '#e8e4da', grout: '#bfbab0', seed: 83, grid: 4, style: 'ceramic' },
  },
  // --- Metal ------------------------------------------------------------------------------
  {
    id: FINISH.steel_brushed,
    slug: 'steel_brushed',
    name: 'Brushed steel',
    tags: ['metal', 'neutral'],
    apply: ['metal'],
    pbr: { color: '#b9bcbe', roughness: 0.34, metalness: 0.94 },
  },
  {
    id: FINISH.brass_soft,
    slug: 'brass_soft',
    name: 'Soft brass',
    tags: ['metal', 'warm', 'accent'],
    apply: ['metal'],
    pbr: { color: '#b99553', roughness: 0.3, metalness: 0.9 },
  },
  {
    id: FINISH.chrome_polished,
    slug: 'chrome_polished',
    name: 'Polished chrome',
    tags: ['metal', 'bathroom'],
    apply: ['metal'],
    pbr: { color: '#d7dade', roughness: 0.08, metalness: 1 },
  },
  {
    id: FINISH.metal_ink,
    slug: 'metal_ink',
    name: 'Powder-coated black',
    tags: ['metal', 'dark'],
    apply: ['metal'],
    pbr: { color: '#26292b', roughness: 0.46, metalness: 0.72 },
  },
  // --- Decor ------------------------------------------------------------------------------
  {
    id: FINISH.glass_clear,
    slug: 'glass_clear',
    name: 'Clear glass',
    tags: ['glass'],
    apply: ['glass'],
    pbr: { color: '#dfeaea', roughness: 0.05, metalness: 0, transmission: 0.92, ior: 1.5, opacity: 1 },
  },
  {
    id: FINISH.glass_smoke,
    slug: 'glass_smoke',
    name: 'Smoked oven glass',
    tags: ['glass', 'appliance', 'dark'],
    apply: ['glass'],
    pbr: {
      color: '#31383d',
      roughness: 0.06,
      metalness: 0,
      transmission: 0.85,
      ior: 1.5,
      opacity: 1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
    },
  },
  {
    id: FINISH.mirror_silver,
    slug: 'mirror_silver',
    name: 'Mirror',
    tags: ['glass', 'bathroom'],
    apply: ['glass'],
    pbr: { color: '#cfd6d8', roughness: 0.02, metalness: 1 },
  },
  {
    id: FINISH.screen_dark,
    slug: 'screen_dark',
    name: 'Screen',
    tags: ['glass', 'appliance', 'dark'],
    apply: ['glass', 'decor'],
    pbr: { color: '#0f1518', roughness: 0.12, metalness: 0.2, emissive: '#16323a', emissiveIntensity: 0.35 },
  },
  {
    id: FINISH.screen_tv,
    slug: 'screen_tv',
    name: 'TV screen',
    tags: ['glass', 'dark'],
    apply: ['glass', 'decor'],
    // A switched-off panel: near-black glass under a hard clear coat, so it
    // reads black and still catches the room's highlights; no glow of its own.
    pbr: { color: '#060809', roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 },
  },
  {
    id: FINISH.shade_ivory,
    slug: 'shade_ivory',
    name: 'Ivory shade',
    tags: ['lighting', 'fabric'],
    apply: ['decor'],
    pbr: {
      color: '#f4e6cc',
      roughness: 0.9,
      emissive: '#ffdba6',
      emissiveIntensity: 0.55,
      sheen: 0.5,
      sheenColor: '#fff3dd',
      sheenRoughness: 0.8,
    },
  },
  {
    id: FINISH.shade_ink,
    slug: 'shade_ink',
    name: 'Ink shade',
    tags: ['lighting', 'dark'],
    apply: ['decor'],
    pbr: { color: '#33383a', roughness: 0.85, emissive: '#ffca7d', emissiveIntensity: 0.22 },
  },
  {
    id: FINISH.shade_opal,
    slug: 'shade_opal',
    name: 'Opal glass shade',
    tags: ['lighting', 'light'],
    apply: ['decor'],
    pbr: { color: '#f6f0e2', roughness: 0.45, emissive: '#ffe6bb', emissiveIntensity: 0.95 },
  },
  {
    id: FINISH.lamp_warm,
    slug: 'lamp_warm',
    name: 'Warm lamp',
    tags: ['lighting', 'warm', 'light'],
    apply: ['decor'],
    pbr: { color: '#fff4da', roughness: 0.32, emissive: '#ffcf8a', emissiveIntensity: 1.8 },
  },
  {
    id: FINISH.terracotta_pot,
    slug: 'terracotta_pot',
    name: 'Terracotta pot',
    tags: ['ceramic', 'plants', 'warm'],
    apply: ['decor'],
    pbr: { color: '#b5765c', roughness: 0.78, tile: [0.5, 0.5], bump: 0.0009 },
    generator: { kind: 'painted_plaster', tone: '#b5765c', seed: 29 },
  },
  {
    id: FINISH.soil_dark,
    slug: 'soil_dark',
    name: 'Potting soil',
    tags: ['plants'],
    apply: ['decor'],
    pbr: { color: '#38302a', roughness: 1 },
  },
  {
    // Deep and slightly glossy, read off the reference photographs: a leaf lit
    // through a window is a saturated green with a wet-looking sheen on it,
    // and the pale mint a low-saturation colour plus a broad sheen produces
    // makes plants read as plastic.
    id: FINISH.foliage_green,
    slug: 'foliage_green',
    name: 'Foliage',
    tags: ['plants', 'green'],
    apply: ['decor'],
    pbr: {
      color: '#36613a',
      roughness: 0.62,
      sheen: 0.08,
      sheenColor: '#5f8f52',
      sheenRoughness: 0.6,
      clearcoat: 0.07,
      clearcoatRoughness: 0.45,
    },
  },
  {
    // The darker half of the two-tone crown every plant builder alternates
    // between: a canopy finished in one green reads as a single moulding
    // however good the silhouette is, so each leaf takes this or
    // `foliage_green` by its own index.
    id: FINISH.foliage_deep,
    slug: 'foliage_deep',
    name: 'Deep foliage',
    tags: ['plants', 'green', 'dark'],
    apply: ['decor'],
    pbr: {
      color: '#264a2b',
      roughness: 0.6,
      sheen: 0.08,
      sheenColor: '#4a7442',
      sheenRoughness: 0.6,
      clearcoat: 0.07,
      clearcoatRoughness: 0.45,
    },
  },
  {
    // Palm fronds are matte and a touch lighter than a fig's leathery leaf -
    // the same crown in the glossy pair reads as plastic at any distance.
    id: FINISH.foliage_palm,
    slug: 'foliage_palm',
    name: 'Palm frond',
    tags: ['plants', 'green'],
    apply: ['decor'],
    pbr: { color: '#4a7c4b', roughness: 0.84, sheen: 0.08, sheenColor: '#77a565', sheenRoughness: 0.8 },
  },
  {
    id: FINISH.foliage_palm_deep,
    slug: 'foliage_palm_deep',
    name: 'Deep palm frond',
    tags: ['plants', 'green', 'dark'],
    apply: ['decor'],
    pbr: { color: '#36613a', roughness: 0.84, sheen: 0.08, sheenColor: '#5f8a52', sheenRoughness: 0.8 },
  },
  {
    // A fig's trunk: pale grey-brown, matte, with just enough grain to stop a
    // 4 cm cylinder reading as a painted dowel.
    id: FINISH.bark_grey,
    slug: 'bark_grey',
    name: 'Grey bark',
    tags: ['plants', 'wood'],
    apply: ['decor'],
    pbr: { color: '#7d7166', roughness: 0.9, tile: [0.14, 0.24], bump: 0.0018 },
    generator: { kind: 'wood_grain', tone: '#7d7166', seed: 97, lines: 26, variation: 0.3 },
  },
  {
    id: FINISH.rattan_natural,
    slug: 'rattan_natural',
    name: 'Natural rattan',
    tags: ['plants', 'basket', 'warm', 'light'],
    apply: ['decor'],
    // A woven basket is a fabric weave at a rope's pitch, not at a thread's:
    // the 6 cm tile is what makes the courses read as canes.
    pbr: { color: '#c39a67', roughness: 0.88, tile: [0.06, 0.06], bump: 0.0032 },
    generator: { kind: 'fabric_weave', tone: '#c39a67', seed: 61, threads: 6, variance: 0.22 },
  },
  {
    id: FINISH.ceramic_cream_gloss,
    slug: 'ceramic_cream_gloss',
    name: 'Cream gloss ceramic',
    tags: ['ceramic', 'plants', 'light'],
    apply: ['decor'],
    pbr: { color: '#efe4cf', roughness: 0.14, clearcoat: 0.5, clearcoatRoughness: 0.1 },
  },
  {
    id: FINISH.clay_taupe,
    slug: 'clay_taupe',
    name: 'Taupe clay',
    tags: ['ceramic', 'plants', 'warm'],
    apply: ['decor'],
    pbr: { color: '#8f8377', roughness: 0.9, tile: [0.45, 0.45], bump: 0.0014 },
    generator: { kind: 'painted_plaster', tone: '#8f8377', seed: 71 },
  },
  {
    id: FINISH.pebble_light,
    slug: 'pebble_light',
    name: 'Light pebble mulch',
    tags: ['plants', 'stone', 'light'],
    apply: ['decor'],
    pbr: { color: '#c6bda9', roughness: 0.94, tile: [0.09, 0.09], bump: 0.0026 },
    generator: { kind: 'painted_plaster', tone: '#c6bda9', seed: 83 },
  },
  {
    id: FINISH.rug_wool_sand,
    slug: 'rug_wool_sand',
    name: 'Sand wool rug',
    tags: ['fabric', 'rug', 'warm'],
    apply: ['fabric', 'decor'],
    pbr: { color: '#bcae95', roughness: 1, sheen: 0.3, sheenColor: '#ded2b9', sheenRoughness: 0.9, tile: [0.5, 0.5], bump: 0.0026 },
    generator: { kind: 'fabric_weave', tone: '#bcae95', seed: 13, threads: 32, variance: 0.14 },
  },
  {
    id: FINISH.rug_wool_ink,
    slug: 'rug_wool_ink',
    name: 'Ink wool rug',
    tags: ['fabric', 'rug', 'dark'],
    apply: ['fabric', 'decor'],
    pbr: { color: '#585d60', roughness: 1, sheen: 0.25, sheenColor: '#9aa0a3', sheenRoughness: 0.9, tile: [0.5, 0.5], bump: 0.0026 },
    generator: { kind: 'fabric_weave', tone: '#585d60', seed: 31, threads: 32, variance: 0.14 },
  },
  {
    id: FINISH.rug_wool_clay,
    slug: 'rug_wool_clay',
    name: 'Clay wool rug',
    tags: ['fabric', 'rug', 'accent'],
    apply: ['fabric', 'decor'],
    pbr: { color: '#b58a75', roughness: 1, sheen: 0.28, sheenColor: '#dcb9a4', sheenRoughness: 0.9, tile: [0.5, 0.5], bump: 0.0026 },
    generator: { kind: 'fabric_weave', tone: '#b58a75', seed: 37, threads: 32, variance: 0.14 },
  },
  {
    id: FINISH.paper_cream,
    slug: 'paper_cream',
    name: 'Cream paper',
    tags: ['decor', 'art'],
    apply: ['decor'],
    pbr: { color: '#e8e2d4', roughness: 0.95 },
  },
  {
    id: FINISH.pigment_clay,
    slug: 'pigment_clay',
    name: 'Clay pigment',
    tags: ['decor', 'art', 'accent'],
    apply: ['decor'],
    pbr: { color: '#b3705a', roughness: 0.9 },
  },
  {
    id: FINISH.pigment_sage,
    slug: 'pigment_sage',
    name: 'Sage pigment',
    tags: ['decor', 'art'],
    apply: ['decor'],
    pbr: { color: '#7f9285', roughness: 0.9 },
  },
  {
    id: FINISH.pigment_ochre,
    slug: 'pigment_ochre',
    name: 'Ochre pigment',
    tags: ['decor', 'art', 'warm'],
    apply: ['decor'],
    pbr: { color: '#c39a54', roughness: 0.9 },
  },
  {
    id: FINISH.pigment_indigo,
    slug: 'pigment_indigo',
    name: 'Indigo pigment',
    tags: ['decor', 'art', 'dark'],
    apply: ['decor'],
    pbr: { color: '#3f5570', roughness: 0.9 },
  },
];

const FINISH_INDEX = new Map(ASSET_FINISHES.map((finish) => [finish.id, finish]));

/** The bank's record of a finish UUID, or `undefined` when the bank has no such row. */
export function finishById(id: string): FinishDefinition | undefined {
  return FINISH_INDEX.get(id);
}

/**
 * `id` when the bank knows it, else `undefined` — the shipped bank's
 * `FinishIdResolver` (`assets/asset-resolver.ts`), which drops an unknown id so
 * a slot falls back to its archetype default.
 *
 * A document names a finish by its UUID and nothing else: the readable words a
 * 1.x scene used (`linen`, `oak_natural`) are not resolved here, they are
 * translated once by the host through `CATALOGUE_ID_BY_SLUG`
 * (`assets/catalogue-slugs.ts`).
 */
export function resolveFinishId(id: string | undefined): string | undefined {
  return id !== undefined && FINISH_INDEX.has(id) ? id : undefined;
}

/** Base albedo of a finish, for UI chips that cannot render a real preview. */
export function finishColour(id: string): string | null {
  return finishById(id)?.pbr.color ?? null;
}
