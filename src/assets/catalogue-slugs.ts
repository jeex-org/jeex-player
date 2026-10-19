/**
 * `CATALOGUE_ID_BY_SLUG`: the bundled catalogue's readable names, mapped to
 * the UUIDs that address its entries from schema 2.0 on.
 *
 * A 1.x document named catalogue entries by their readable ids (`sofa_3s`,
 * `oak_natural`, `door-white-flat-bar`); a 2.0 document names them by UUID and
 * the viewer reads nothing else. This table is for the HOST that translates an
 * old document once, before handing it over — the viewer itself never
 * resolves a slug, and no lookup in `src/` goes through here.
 *
 * Derived at module load from the entries' own `slug` fields, so it cannot
 * drift from the catalogue it describes: a renamed or added entry is in the
 * table the moment it is in the bank. One flat table per kind, because the
 * kinds are separate namespaces in a document (an archetype, a variant, a
 * finish of a floor, a wall or a furniture slot, an opening's variant); the
 * three finish catalogues share one table, their slugs being disjoint
 * (`catalogue-slugs.test.ts`).
 *
 * Every table has a null prototype and is frozen with the whole: a 1.x word
 * that happens to be `constructor` reads as unknown rather than as a function.
 *
 * Pure module: no `three`, no DOM.
 */

import { ASSET_FINISHES } from '../materials/asset-finish-catalogue.js';
import { FLOOR_FINISHES, WALL_FINISHES } from '../materials/finish-catalogue.js';
import { listCatalogueObjects } from './asset-catalogue.js';
import { DOOR_VARIANTS, ENTRY_DOOR_VARIANTS, WINDOW_VARIANTS } from './opening-variants.js';

/** One kind's slug -> UUID table. */
export type CatalogueSlugTable = Readonly<Record<string, string>>;

/** The four tables, one per kind of catalogue entry a document references. */
export type CatalogueIdBySlug = {
  readonly archetype: CatalogueSlugTable;
  readonly variant: CatalogueSlugTable;
  /** Floor, wall and furniture finishes together. */
  readonly finish: CatalogueSlugTable;
  readonly openingVariant: CatalogueSlugTable;
};

/** `slug -> id` over `entries`, null-prototype and frozen. */
function tableOf(entries: readonly { readonly id: string; readonly slug: string }[]): CatalogueSlugTable {
  const table: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const entry of entries) table[entry.slug] = entry.id;
  return Object.freeze(table);
}

const objects = listCatalogueObjects();

export const CATALOGUE_ID_BY_SLUG: CatalogueIdBySlug = Object.freeze({
  archetype: tableOf(objects),
  variant: tableOf(objects.flatMap((object) => object.variants)),
  finish: tableOf([...FLOOR_FINISHES, ...WALL_FINISHES, ...ASSET_FINISHES]),
  openingVariant: tableOf([...WINDOW_VARIANTS, ...DOOR_VARIANTS, ...ENTRY_DOOR_VARIANTS]),
});
