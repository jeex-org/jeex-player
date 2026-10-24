/**
 * `CATALOGUE_ID_BY_SLUG` and the UUIDs of the bundled catalogue it describes.
 *
 * The table is what a host translates a 1.x document with, so it is held to
 * three things: it is the catalogue's own `slug -> id` pairs and nothing else,
 * it agrees with the source constants every module names entries by, and it
 * cannot be changed by whoever imports it. Beside it, the catalogue itself:
 * every id a UUID v7 and unique across kinds, and every reference between
 * entries landing on an entry.
 */

import { describe, expect, test } from 'bun:test';
import { ASSET_FINISHES } from '../materials/asset-finish-catalogue.js';
import { FRAME_FINISHES, frameFinish } from '../materials/frame-finishes.js';
import { FLOOR_FINISHES, RETIRED_FINISHES, WALL_FINISHES, findFinish } from '../materials/finish-catalogue.js';
import { FINISH } from '../materials/finish-ids.js';
import { isUuidV7 } from '../scene/types.js';
import { LEGACY_TYPE_ALIASES, findCatalogueEntry, findObject, listCatalogueObjects } from './asset-catalogue.js';
import { finishById } from './asset-finishes.js';
import { ARCHETYPE, OPENING_VARIANT, VARIANT } from './catalogue-ids.js';
import { CATALOGUE_ID_BY_SLUG, type CatalogueSlugTable } from './catalogue-slugs.js';
import { DOOR_VARIANTS, ENTRY_DOOR_VARIANTS, WINDOW_VARIANTS } from './opening-variants.js';

const objects = listCatalogueObjects();
const variants = objects.flatMap((object) => object.variants);
const finishes = [...FLOOR_FINISHES, ...WALL_FINISHES, ...RETIRED_FINISHES, ...ASSET_FINISHES, ...FRAME_FINISHES];
const openings = [...WINDOW_VARIANTS, ...DOOR_VARIANTS, ...ENTRY_DOOR_VARIANTS];

/** A source constant keyed the way its module spells keys: the slug with `-` as `_`. */
function asConstantKeys(table: CatalogueSlugTable): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([slug, id]) => [slug.replaceAll('-', '_'), id]));
}

describe('CATALOGUE_ID_BY_SLUG', () => {
  test('has one flat table per kind', () => {
    expect(Object.keys(CATALOGUE_ID_BY_SLUG).sort()).toEqual(['archetype', 'finish', 'openingVariant', 'variant']);
  });

  test('each table is exactly the entries of its kind, slug to id', () => {
    const pairs = (entries: readonly { id: string; slug: string }[]) => Object.fromEntries(entries.map((entry) => [entry.slug, entry.id]));
    expect({ ...CATALOGUE_ID_BY_SLUG.archetype }).toEqual(pairs(objects));
    expect({ ...CATALOGUE_ID_BY_SLUG.variant }).toEqual(pairs(variants));
    expect({ ...CATALOGUE_ID_BY_SLUG.finish }).toEqual(pairs(finishes));
    expect({ ...CATALOGUE_ID_BY_SLUG.openingVariant }).toEqual(pairs(openings));
  });

  test('no slug is lost to a collision: floor, wall and furniture finish slugs are disjoint, as is every other kind', () => {
    expect(Object.keys(CATALOGUE_ID_BY_SLUG.archetype)).toHaveLength(objects.length);
    expect(Object.keys(CATALOGUE_ID_BY_SLUG.variant)).toHaveLength(variants.length);
    expect(Object.keys(CATALOGUE_ID_BY_SLUG.finish)).toHaveLength(finishes.length);
    expect(Object.keys(CATALOGUE_ID_BY_SLUG.openingVariant)).toHaveLength(openings.length);
  });

  test('agrees with the source constants the modules name entries by', () => {
    expect(asConstantKeys(CATALOGUE_ID_BY_SLUG.archetype)).toEqual({ ...ARCHETYPE });
    expect(asConstantKeys(CATALOGUE_ID_BY_SLUG.variant)).toEqual({ ...VARIANT });
    expect(asConstantKeys(CATALOGUE_ID_BY_SLUG.finish)).toEqual({ ...FINISH });
    expect(asConstantKeys(CATALOGUE_ID_BY_SLUG.openingVariant)).toEqual({ ...OPENING_VARIANT });
  });

  test('translates the 1.x words a host meets', () => {
    expect(CATALOGUE_ID_BY_SLUG.archetype['sofa_3s']).toBe(ARCHETYPE.sofa_3s);
    expect(CATALOGUE_ID_BY_SLUG.variant['sofa_3s_boucle']).toBe(VARIANT.sofa_3s_boucle);
    expect(CATALOGUE_ID_BY_SLUG.finish['oak']).toBe(FINISH.oak);
    expect(CATALOGUE_ID_BY_SLUG.finish['ceramic-light']).toBe(FINISH.ceramic_light);
    expect(CATALOGUE_ID_BY_SLUG.finish['oak_natural']).toBe(FINISH.oak_natural);
    expect(CATALOGUE_ID_BY_SLUG.openingVariant['door-white-flat-bar']).toBe(OPENING_VARIANT.door_white_flat_bar);
    expect(CATALOGUE_ID_BY_SLUG.finish['no-such-finish']).toBeUndefined();
  });

  test('is frozen through, and a prototype key reads as unknown', () => {
    expect(Object.isFrozen(CATALOGUE_ID_BY_SLUG)).toBe(true);
    for (const table of Object.values(CATALOGUE_ID_BY_SLUG)) {
      expect(Object.isFrozen(table)).toBe(true);
      expect(table['constructor']).toBeUndefined();
      expect(table['__proto__']).toBeUndefined();
    }
  });
});

describe('the bundled catalogue ids', () => {
  test('every entry id is a UUID v7, unique across every kind', () => {
    const ids = [...objects, ...variants, ...finishes, ...openings].map((entry) => entry.id);
    expect(ids.filter((id) => !isUuidV7(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every entry carries a readable slug', () => {
    for (const entry of [...objects, ...variants, ...finishes, ...openings]) expect(entry.slug.length).toBeGreaterThan(0);
  });

  test('every reference between entries lands on an entry', () => {
    for (const object of objects) {
      expect(object.variants.some((variant) => variant.id === object.defaultVariant)).toBe(true);
      for (const id of Object.values(object.defaultFinishes))
        expect({ object: object.slug, id, known: Boolean(finishById(id)) }).toEqual({ object: object.slug, id, known: true });
      for (const variant of object.variants) {
        for (const id of Object.values(variant.finishes ?? {})) {
          expect({ variant: variant.slug, id, known: Boolean(finishById(id)) }).toEqual({ variant: variant.slug, id, known: true });
        }
      }
    }
    for (const [type, alias] of Object.entries(LEGACY_TYPE_ALIASES)) {
      expect({ type, known: findObject(alias.archetype) !== undefined }).toEqual({ type, known: true });
      expect(findCatalogueEntry(type)?.object.id).toBe(alias.archetype);
    }
    for (const opening of openings) {
      expect({
        opening: opening.slug,
        frame: (findFinish(opening.frame.material) ?? frameFinish(opening.frame.material) ?? null) !== null,
      }).toEqual({
        opening: opening.slug,
        frame: true,
      });
      if (opening.leaf)
        expect({
          opening: opening.slug,
          leaf: (findFinish(opening.leaf.material) ?? frameFinish(opening.leaf.material) ?? null) !== null,
        }).toEqual({
          opening: opening.slug,
          leaf: true,
        });
    }
  });
});
