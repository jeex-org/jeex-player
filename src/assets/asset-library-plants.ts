/**
 * The houseplant half of `starter:interior-v1`: four species, each built to its
 * own reference photograph.
 *
 * Pure data, and a separate file for the same reason the builders are
 * (`asset-builders-plants.ts`): four archetypes whose every variant carries
 * four finish slots and a seed do not read as one paragraph inside the rest of
 * the manifest, and `asset-library.ts` is at its size limit without them.
 *
 * The `accent` slot is the deeper of the two foliage tones every crown
 * alternates between, so a variant re-tones both halves of the canopy and not
 * just the pot. A palm takes the matte `foliage_palm` pair and the three
 * broad-leaved species the glossy `foliage_green` pair, because a frond and a
 * fig leaf do not catch light the same way. `layout.footprint` is the pot's own
 * radius as a fraction of the archetype's half-footprint - the canopy
 * overhangs it, and it is the pot you walk into.
 */

import type { CatalogueObject } from './asset-types.js';
import { v } from './asset-library-shared.js';
import { ARCHETYPE, VARIANT } from './catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';

/** Matte palm greens, for the one species whose leaves are not glossy. */
const PALM = { soil: FINISH.soil_dark, foliage: FINISH.foliage_palm, accent: FINISH.foliage_palm_deep } as const;
/** The glossy pair, for the broad-leaved species. */
const BROAD = { soil: FINISH.soil_dark, foliage: FINISH.foliage_green, accent: FINISH.foliage_deep } as const;
/** The fig: woody parts on a slot of their own, pale gravel over its soil. */
const WOODY = { ...BROAD, soil: FINISH.pebble_light, bark: FINISH.bark_grey } as const;
/** The upright Strelitzia, mulched with pale pebbles rather than bare soil. */
const MULCHED = { ...BROAD, soil: FINISH.pebble_light } as const;

export const plantObjects: CatalogueObject[] = [
  {
    id: ARCHETYPE.plant_kentia,
    slug: 'plant_kentia',
    name: 'Kentia palm',
    category: 'decor/plants',
    dims: [0.88, 1.8, 0.88],
    anchor: 'floor',
    wallSnap: false,
    clearance: 0.2,
    tags: ['living', 'hall'],
    model: 'obj/plant_kentia.glb',
    builder: 'plant_kentia',
    // The pot is the obstacle, not the canopy: `KENTIA_POT_RADIUS` in `asset-builders-plants.ts`.
    layout: { footprint: 0.5 },
    options: { seed: 11, canes: 9, leaflets: 16 },
    slots: ['ceramic', 'soil', 'foliage', 'accent'],
    defaultFinishes: { ceramic: FINISH.rattan_natural, ...PALM },
    primarySlot: 'ceramic',
    mirror: { x: true, y: false, z: true },
    defaultVariant: VARIANT.plant_kentia_rattan,
    variants: [
      v(
        VARIANT.plant_kentia_rattan,
        'plant_kentia_rattan',
        'Kentia palm, woven basket',
        { ceramic: FINISH.rattan_natural, ...PALM },
        { tags: ['light'] },
      ),
      v(
        VARIANT.plant_kentia_clay,
        'plant_kentia_clay',
        'Kentia palm, clay planter',
        { ceramic: FINISH.clay_taupe, ...PALM },
        {
          options: { seed: 29 },
        },
      ),
      v(
        VARIANT.plant_kentia_compact,
        'plant_kentia_compact',
        'Kentia palm, compact',
        { ceramic: FINISH.rattan_natural, ...PALM },
        {
          tags: ['compact'],
          dims: [0.72, 1.42, 0.72],
          options: { seed: 41, canes: 7, leaflets: 13 },
        },
      ),
      v(
        VARIANT.plant_kentia_white,
        'plant_kentia_white',
        'Kentia palm, white planter',
        { ceramic: FINISH.plaster_white, ...PALM },
        {
          options: { seed: 67 },
        },
      ),
    ],
  },
  {
    id: ARCHETYPE.plant_strelitzia,
    slug: 'plant_strelitzia',
    name: 'Bird of paradise',
    category: 'decor/plants',
    // A mature Strelitzia is as wide as it is tall through the canopy; the pot
    // it stands in is a fifth of that, which is why the two are separate facts.
    dims: [1.1, 1.6, 1.02],
    anchor: 'floor',
    wallSnap: false,
    clearance: 0.2,
    tags: ['living', 'bedroom'],
    model: 'obj/plant_strelitzia.glb',
    builder: 'plant_strelitzia',
    // The pot is the obstacle, not the canopy: `STRELITZIA_POT_RADIUS` in `asset-builders-plants.ts`.
    layout: { footprint: 0.42 },
    options: { seed: 23, leaves: 11 },
    slots: ['ceramic', 'soil', 'foliage', 'accent'],
    defaultFinishes: { ceramic: FINISH.ceramic_cream_gloss, ...BROAD },
    primarySlot: 'ceramic',
    mirror: { x: true, y: false, z: true },
    defaultVariant: VARIANT.plant_strelitzia_cream,
    variants: [
      v(
        VARIANT.plant_strelitzia_cream,
        'plant_strelitzia_cream',
        'Bird of paradise, cream gloss pot',
        { ceramic: FINISH.ceramic_cream_gloss, ...BROAD },
        {
          tags: ['light'],
        },
      ),
      v(
        VARIANT.plant_strelitzia_clay,
        'plant_strelitzia_clay',
        'Bird of paradise, clay planter',
        { ceramic: FINISH.clay_taupe, ...BROAD },
        {
          options: { seed: 31 },
        },
      ),
      v(
        VARIANT.plant_strelitzia_basalt,
        'plant_strelitzia_basalt',
        'Bird of paradise, basalt planter',
        { ceramic: FINISH.stone_basalt, ...BROAD },
        {
          tags: ['dark'],
          options: { seed: 43 },
        },
      ),
      v(
        VARIANT.plant_strelitzia_large,
        'plant_strelitzia_large',
        'Bird of paradise, large',
        { ceramic: FINISH.ceramic_cream_gloss, ...BROAD },
        {
          tags: ['large'],
          dims: [1.22, 1.9, 1.12],
          options: { seed: 59, leaves: 13 },
        },
      ),
    ],
  },
  {
    id: ARCHETYPE.plant_ficus_lyrata,
    slug: 'plant_ficus_lyrata',
    name: 'Fiddle-leaf fig',
    category: 'decor/plants',
    dims: [1.02, 1.7, 0.98],
    anchor: 'floor',
    wallSnap: false,
    clearance: 0.2,
    tags: ['living', 'bedroom', 'hall'],
    model: 'obj/plant_ficus_lyrata.glb',
    builder: 'plant_ficus_lyrata',
    // The pot is the obstacle, not the canopy: `FICUS_POT_RADIUS` in `asset-builders-plants.ts`.
    layout: { footprint: 0.62 },
    options: { seed: 37, leaves: 38, branches: 4 },
    // The one species with woody parts, so the one with a `bark` slot: a fig's
    // trunk is grey-brown, and the green a palm's cane and a Strelitzia's
    // petiole take would make it a painted dowel.
    slots: ['ceramic', 'soil', 'foliage', 'accent', 'bark'],
    defaultFinishes: { ceramic: FINISH.clay_taupe, ...WOODY },
    primarySlot: 'ceramic',
    mirror: { x: true, y: false, z: true },
    defaultVariant: VARIANT.plant_ficus_taupe,
    variants: [
      v(VARIANT.plant_ficus_taupe, 'plant_ficus_taupe', 'Fiddle-leaf fig, taupe clay', { ceramic: FINISH.clay_taupe, ...WOODY }),
      v(
        VARIANT.plant_ficus_cream,
        'plant_ficus_cream',
        'Fiddle-leaf fig, cream gloss pot',
        { ceramic: FINISH.ceramic_cream_gloss, ...WOODY },
        {
          tags: ['light'],
          options: { seed: 47 },
        },
      ),
      v(
        VARIANT.plant_ficus_basalt,
        'plant_ficus_basalt',
        'Fiddle-leaf fig, basalt planter',
        { ceramic: FINISH.stone_basalt, ...WOODY },
        {
          tags: ['dark'],
          options: { seed: 61 },
        },
      ),
      v(
        VARIANT.plant_ficus_compact,
        'plant_ficus_compact',
        'Fiddle-leaf fig, compact',
        { ceramic: FINISH.clay_taupe, ...WOODY },
        {
          tags: ['compact'],
          dims: [0.8, 1.3, 0.76],
          options: { seed: 73, leaves: 26, branches: 3 },
        },
      ),
    ],
  },
  {
    // The fourth photograph: a young Strelitzia whose leaves come up in one
    // plane like a banana plant's, in a sphere pot cut flat, mulched with
    // pebbles - so this one's `soil` slot carries `pebble_light`.
    id: ARCHETYPE.plant_strelitzia_white,
    slug: 'plant_strelitzia_white',
    name: 'Upright bird of paradise',
    category: 'decor/plants',
    dims: [0.78, 1.4, 0.74],
    anchor: 'floor',
    wallSnap: false,
    clearance: 0.15,
    tags: ['hall', 'kitchen', 'bathroom'],
    model: 'obj/plant_strelitzia_white.glb',
    builder: 'plant_strelitzia_white',
    // The pot is the obstacle, not the canopy: `WHITE_POT_RADIUS` in `asset-builders-plants.ts`.
    layout: { footprint: 0.86 },
    options: { seed: 53, leaves: 9 },
    slots: ['ceramic', 'soil', 'foliage', 'accent'],
    defaultFinishes: { ceramic: FINISH.plaster_white, ...MULCHED },
    primarySlot: 'ceramic',
    mirror: { x: true, y: false, z: true },
    defaultVariant: VARIANT.plant_upright_white,
    variants: [
      v(
        VARIANT.plant_upright_white,
        'plant_upright_white',
        'Upright bird of paradise, white sphere',
        { ceramic: FINISH.plaster_white, ...MULCHED },
        {
          tags: ['light'],
        },
      ),
      v(
        VARIANT.plant_upright_cream,
        'plant_upright_cream',
        'Upright bird of paradise, cream gloss sphere',
        { ceramic: FINISH.ceramic_cream_gloss, ...MULCHED },
        {
          options: { seed: 79 },
        },
      ),
      v(
        VARIANT.plant_upright_basalt,
        'plant_upright_basalt',
        'Upright bird of paradise, basalt sphere',
        { ceramic: FINISH.stone_basalt, ...BROAD },
        {
          tags: ['dark'],
          options: { seed: 83 },
        },
      ),
      v(
        VARIANT.plant_upright_low,
        'plant_upright_low',
        'Upright bird of paradise, low',
        { ceramic: FINISH.plaster_white, ...MULCHED },
        {
          tags: ['compact'],
          dims: [0.66, 1.06, 0.62],
          options: { seed: 89, leaves: 7 },
        },
      ),
    ],
  },
];
