/**
 * The object bank: indexes and lookups over a library manifest of furniture
 * archetypes and their variants.
 *
 * Pure data - no `three`, no DOM. The manifest itself lives in
 * `asset-library.ts` and the shape both of them agree on lives in
 * `asset-types.ts`; this module owns everything the rest of the app asks of
 * the bank — the indexes, the legacy type bridge, placement refs and the walk
 * footprints.
 *
 * The catalogue types are re-exported here because that is where every caller
 * already asks for them; the definitions themselves stay in `asset-types.ts`
 * so the manifest can declare itself without importing its own index.
 *
 * Invariants (enforced by `asset-catalogue.test.ts`): every archetype has
 * exactly four variants, its `defaultVariant` exists among them, every
 * archetype and variant id is a UUID v7 unique across the library, and every
 * finish named by a slot exists in the finish library.
 */

import { interiorLibrary } from './asset-library.js';
import { ARCHETYPE } from './catalogue-ids.js';
import { assetRefOf, type AssetRef, type AssetRefFields } from '../scene/registries.js';
import type { AssetDims, CatalogueObject, CatalogueVariant } from './asset-types.js';

export type { AssetDims, AssetOptions, AssetPricing, CatalogueObject, CatalogueVariant } from './asset-types.js';

export { interiorLibrary };

/**
 * The built-in bank's library id: what a placement belongs to when neither it
 * nor its scene names a library. Code vocabulary, not a record id — it is
 * never written into a document, where a library is always a UUID.
 */
export const DEFAULT_LIBRARY = interiorLibrary.id;

const OBJECT_INDEX = new Map(interiorLibrary.objects.map((object) => [object.id, object]));
const VARIANT_INDEX = new Map<string, { object: CatalogueObject; variant: CatalogueVariant }>();
for (const object of interiorLibrary.objects) {
  for (const variant of object.variants) VARIANT_INDEX.set(variant.id, { object, variant });
}

/* ------------------------------------------------------------ legacy types */

/**
 * Bridge from the pre-bank `DemoAsset.type` ids to the object bank.
 *
 * A placement may name a furniture *type* word (`'sofa'`, `'tv-unit'`) instead
 * of an *asset* (an archetype UUID) and a *variant*. The words are vocabulary,
 * not ids, and this map sends each one to the archetype that draws it.
 *
 * `yaw` is facing compensation for type-word placements. The bank's convention
 * is one rule - the front of every object faces -Z at `rotationY = 0` - while
 * type-word placements carry rotations authored against a per-type convention:
 * seating and beds face -Z, but case goods, appliances and wall pieces face
 * +Z, so those types get a half turn here. Placements that name `asset` directly
 * never go through this map and always follow the single convention.
 */
export type LegacyTypeAlias = {
  /** Archetype UUID in the bank. */
  archetype: string;
  /** Variant UUID chosen for a legacy placement; defaults to the archetype's own default. */
  defaultVariant?: string;
  /** Extra yaw applied to legacy placements, radians. */
  yaw?: number;
};

const HALF_TURN = Math.PI;

export const LEGACY_TYPE_ALIASES: Readonly<Record<string, LegacyTypeAlias>> = {
  sofa: { archetype: ARCHETYPE.sofa_3s },
  armchair: { archetype: ARCHETYPE.armchair },
  bed: { archetype: ARCHETYPE.bed_double },
  nightstand: { archetype: ARCHETYPE.nightstand, yaw: HALF_TURN },
  wardrobe: { archetype: ARCHETYPE.wardrobe, yaw: HALF_TURN },
  dresser: { archetype: ARCHETYPE.dresser, yaw: HALF_TURN },
  desk: { archetype: ARCHETYPE.desk, yaw: HALF_TURN },
  table: { archetype: ARCHETYPE.table_dining },
  chair: { archetype: ARCHETYPE.chair_dining, yaw: HALF_TURN },
  stool: { archetype: ARCHETYPE.stool_bar },
  'side-table': { archetype: ARCHETYPE.table_side },
  'table-lamp': { archetype: ARCHETYPE.lamp_table },
  'tv-unit': { archetype: ARCHETYPE.tv_unit, yaw: HALF_TURN },
  bookshelf: { archetype: ARCHETYPE.bookshelf, yaw: HALF_TURN },
  plant: { archetype: ARCHETYPE.plant_strelitzia },
  lamp: { archetype: ARCHETYPE.lamp_floor },
  rug: { archetype: ARCHETYPE.rug_rect },
  art: { archetype: ARCHETYPE.art_framed, yaw: HALF_TURN },
  mirror: { archetype: ARCHETYPE.mirror_round, yaw: HALF_TURN },
  counter: { archetype: ARCHETYPE.counter_run, yaw: HALF_TURN },
  stove: { archetype: ARCHETYPE.cooker, yaw: HALF_TURN },
  'upper-cabinet': { archetype: ARCHETYPE.cabinet_wall, yaw: HALF_TURN },
  hood: { archetype: ARCHETYPE.hood_extractor, yaw: HALF_TURN },
  fridge: { archetype: ARCHETYPE.fridge_tall, yaw: HALF_TURN },
  island: { archetype: ARCHETYPE.island_kitchen, yaw: HALF_TURN },
  pendant: { archetype: ARCHETYPE.pendant },
  'ceiling-light': { archetype: ARCHETYPE.ceiling_light },
  bathtub: { archetype: ARCHETYPE.bathtub },
  toilet: { archetype: ARCHETYPE.toilet_wc },
  vanity: { archetype: ARCHETYPE.vanity_sink, yaw: HALF_TURN },
  'shoe-cabinet': { archetype: ARCHETYPE.cabinet_shoe, yaw: HALF_TURN },
  'coat-rack': { archetype: ARCHETYPE.coat_rack },
  console: { archetype: ARCHETYPE.console_hall, yaw: HALF_TURN },
  'door-mat': { archetype: ARCHETYPE.door_mat },
};

export function legacyAlias(type: string): LegacyTypeAlias | undefined {
  return LEGACY_TYPE_ALIASES[type];
}

/* ------------------------------------------------------------- asset refs */

/**
 * The reference a placement names, with the SHIPPED library as the last
 * default: `library`, else `sceneLibrary` (the document's `assetLibrary`),
 * else `DEFAULT_LIBRARY`. The rule itself belongs to the scene document, so it
 * lives one layer down in `scene/registries.assetRefOf` and this is the bound
 * form every caller in the bank asks for.
 */
export function placementRef(placement: AssetRefFields, sceneLibrary?: string): AssetRef {
  return assetRefOf(placement, sceneLibrary ?? DEFAULT_LIBRARY);
}

function aliasEntry(assetId: string): { object: CatalogueObject; variantId?: string | undefined; yaw?: number | undefined } | undefined {
  const alias = LEGACY_TYPE_ALIASES[assetId];
  if (!alias) return undefined;
  const aliased = OBJECT_INDEX.get(alias.archetype);
  if (!aliased) return undefined;
  return { object: aliased, variantId: alias.defaultVariant, yaw: alias.yaw };
}

/**
 * Looks up an archetype UUID, a concrete variant UUID, or a legacy
 * `DemoAsset.type` word. Returns the archetype plus the variant the id
 * selected, so `ARCHETYPE.sofa_3s`, `VARIANT.sofa_3s_boucle` and `'sofa'` all
 * resolve.
 *
 * A bank id is a UUID and a type word never is, so the three tables cannot
 * answer for the same string and the order they are asked in decides nothing.
 */
export function findCatalogueEntry(
  assetId: string,
): { object: CatalogueObject; variantId?: string | undefined; yaw?: number | undefined } | undefined {
  const object = OBJECT_INDEX.get(assetId);
  if (object) return { object };
  const byVariant = VARIANT_INDEX.get(assetId);
  if (byVariant) return { object: byVariant.object, variantId: byVariant.variant.id };
  return aliasEntry(assetId);
}

export function findObject(archetypeId: string): CatalogueObject | undefined {
  return OBJECT_INDEX.get(archetypeId);
}

export function listCatalogueObjects(): readonly CatalogueObject[] {
  return interiorLibrary.objects;
}

/** Every variant in the bank, flattened - used by tests and by catalogue tooling. */
export function listVariants(): Array<{ archetypeId: string; variant: CatalogueVariant }> {
  return interiorLibrary.objects.flatMap((object) => object.variants.map((variant) => ({ archetypeId: object.id, variant })));
}

/** A compact card for one object: id, name, dimensions, tags and its variant count, for listing the bank. */
export function assetCard(object: CatalogueObject): {
  id: string;
  name: string;
  dims: AssetDims;
  tags: readonly string[];
  variants: number;
} {
  return { id: object.id, name: object.name, dims: object.dims, tags: object.tags, variants: object.variants.length };
}

/** Shortest floor object that still blocks a walk, metres (a rug is 2 cm). */
export const MIN_COLLIDABLE_HEIGHT = 0.15;

/**
 * Default walk-collision footprint of an asset, as half-extents in metres
 * before rotation, derived from the catalogue `dims`.
 *
 * Accepts an archetype UUID, a variant UUID or a legacy `DemoAsset.type`. Returns
 * `null` for anything the bank does not know, and for objects that are not on
 * the floor (wall and ceiling pieces are walked under, not around).
 *
 * Objects lower than `MIN_COLLIDABLE_HEIGHT` (rugs, door mats) are walked over
 * rather than around and get no footprint either, and an archetype that
 * declares `layout.footprint` reports that share of its plan size instead of
 * all of it - a plant's pot rather than the canopy overhanging it.
 *
 * `navigation.ts` derives every walk obstacle from here, so a footprint is
 * always the rendered variant's own size instead of a second copy of it.
 */
export function footprintFor(idOrType: string): { hx: number; hz: number } | null {
  const entry = findCatalogueEntry(idOrType);
  if (!entry) return null;
  const { object, variantId } = entry;
  if (object.anchor !== 'floor') return null;
  const variant = variantId ? object.variants.find((candidate) => candidate.id === variantId) : undefined;
  const dims = variant?.dims ?? object.dims;
  if (dims[1] < MIN_COLLIDABLE_HEIGHT) return null;
  const standing = object.layout?.footprint ?? 1;
  return { hx: (dims[0] / 2) * standing, hz: (dims[2] / 2) * standing };
}
