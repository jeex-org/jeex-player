import { describe, expect, test } from 'bun:test';
import {
  LEGACY_TYPE_ALIASES,
  assetCard,
  findCatalogueEntry,
  interiorLibrary,
  legacyAlias,
  listCatalogueObjects,
  listVariants,
} from './asset-catalogue.js';
import { finishById } from './asset-finishes.js';
import { BUILDERS } from './asset-builders.js';
import { apartmentScene } from '../demo/scene-data.js';
import { isUuidV7 } from '../scene/types.js';
import { ARCHETYPE, VARIANT } from './catalogue-ids.js';
import STORE_CATEGORIES from '../../tests/fixtures/store-categories/asset-category-1.json' with { type: 'json' };

const objects = listCatalogueObjects();

describe('object bank manifest', () => {
  test('declares the documented manifest header fields', () => {
    expect(interiorLibrary.manifestVersion).toBe('1.0');
    expect(interiorLibrary.id).toBe('starter:interior-v1');
    expect(interiorLibrary.publisher).toBe('jeex');
    expect(interiorLibrary.license.length).toBeGreaterThan(0);
    expect(objects.length).toBeGreaterThan(30);
  });

  test('every archetype files under a leaf of the store category tree', () => {
    const tree = new Set(STORE_CATEGORIES.paths);
    const outside = objects.filter((object) => !tree.has(object.category)).map((object) => `${object.slug}: ${object.category}`);
    expect(outside).toEqual([]);
  });

  test('archetype ids are unique UUID v7 and their slugs snake_case', () => {
    const ids = objects.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const object of objects) {
      expect({ slug: object.slug, uuid: isUuidV7(object.id) }).toEqual({ slug: object.slug, uuid: true });
      expect(object.slug).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });

  test('variant ids are unique UUID v7 library-wide and their slugs prefixed by the archetype family', () => {
    const seen = new Set<string>(objects.map((object) => object.id));
    for (const object of objects) {
      // `split` on a non-empty slug always yields at least one segment.
      const family = object.slug.split('_')[0]!;
      for (const variant of object.variants) {
        expect({ slug: variant.slug, uuid: isUuidV7(variant.id), duplicate: seen.has(variant.id) }).toEqual({
          slug: variant.slug,
          uuid: true,
          duplicate: false,
        });
        seen.add(variant.id);
        expect({ slug: variant.slug, family, ok: variant.slug.startsWith(family) }).toEqual({ slug: variant.slug, family, ok: true });
      }
    }
    expect(listVariants().length).toBe(objects.length * 4);
  });

  test('every archetype carries exactly four variants', () => {
    for (const object of objects) {
      expect({ id: object.id, variants: object.variants.length }).toEqual({ id: object.id, variants: 4 });
    }
  });

  test('the default variant exists and every variant is versioned and priced', () => {
    for (const object of objects) {
      expect({ id: object.id, hasDefault: object.variants.some((variant) => variant.id === object.defaultVariant) }).toEqual({
        id: object.id,
        hasDefault: true,
      });
      for (const variant of object.variants) {
        expect(variant.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(['free', 'subscription', 'premium']).toContain(variant.pricing.model);
        if (variant.pricing.model === 'subscription') expect(variant.pricing.tier).toBeDefined();
      }
    }
  });

  test('every archetype has at least one free variant so the demo needs no entitlement', () => {
    for (const object of objects) {
      expect({ id: object.id, free: object.variants.some((variant) => variant.pricing.model === 'free') }).toEqual({
        id: object.id,
        free: true,
      });
    }
  });

  test('dimensions are plausible interior metres', () => {
    for (const object of objects) {
      for (const dims of [object.dims, ...object.variants.map((variant) => variant.dims ?? object.dims)]) {
        const [width, height, depth] = dims;
        expect(width).toBeGreaterThan(0.05);
        expect(width).toBeLessThan(3.5);
        expect(height).toBeGreaterThan(0.01);
        expect(height).toBeLessThan(2.6);
        expect(depth).toBeGreaterThan(0.01);
        expect(depth).toBeLessThan(2.4);
      }
    }
  });

  test('every archetype names a builder that exists', () => {
    for (const object of objects) {
      expect({ id: object.id, builder: object.builder, known: object.builder in BUILDERS }).toEqual({
        id: object.id,
        builder: object.builder,
        known: true,
      });
    }
  });

  test('every finish named by a slot default or a variant exists in the finish library', () => {
    for (const object of objects) {
      for (const slot of object.slots) {
        const id = object.defaultFinishes[slot];
        expect({ object: object.id, slot, known: Boolean(id && finishById(id)) }).toEqual({ object: object.id, slot, known: true });
      }
      expect(object.slots).toContain(object.primarySlot);
      for (const variant of object.variants) {
        for (const [slot, id] of Object.entries(variant.finishes ?? {})) {
          expect({ variant: variant.id, slot, known: Boolean(finishById(id)) }).toEqual({ variant: variant.id, slot, known: true });
          expect(object.slots).toContain(slot as (typeof object.slots)[number]);
        }
      }
    }
  });

  test('variants never carry raw colours - only finish ids', () => {
    for (const object of objects) {
      for (const variant of object.variants) {
        for (const id of Object.values(variant.finishes ?? {})) expect(id.startsWith('#')).toBe(false);
      }
    }
  });

  test('only floor-standing objects need clearance in front of them', () => {
    for (const object of objects) {
      expect(['floor', 'wall', 'ceiling']).toContain(object.anchor);
      if (object.anchor !== 'floor') expect(object.clearance).toBe(0);
    }
  });
});

describe('asset references', () => {
  test('resolves an archetype id, a variant id and a legacy type', () => {
    expect(findCatalogueEntry(ARCHETYPE.sofa_3s)?.object.id).toBe(ARCHETYPE.sofa_3s);
    expect(findCatalogueEntry(VARIANT.sofa_3s_boucle)?.variantId).toBe(VARIANT.sofa_3s_boucle);
    expect(findCatalogueEntry('sofa')?.object.id).toBe(ARCHETYPE.sofa_3s);
    expect(findCatalogueEntry('not_a_thing')).toBeUndefined();
  });

  test('a readable 1.x id resolves nothing: the bank is addressed by UUID', () => {
    expect(findCatalogueEntry('sofa_3s')).toBeUndefined();
    expect(findCatalogueEntry('sofa_3s_boucle')).toBeUndefined();
  });

  test('produces a compact search card', () => {
    const sofa = objects.find((object) => object.id === ARCHETYPE.sofa_3s)!;
    expect(assetCard(sofa)).toEqual({
      id: ARCHETYPE.sofa_3s,
      name: 'Three-seat sofa',
      dims: [2.24, 0.86, 0.95],
      tags: ['living'],
      variants: 4,
    });
  });
});

describe('legacy type aliases', () => {
  test('every type used by the demo scene maps onto an archetype that exists', () => {
    for (const asset of apartmentScene.assets) {
      const alias = legacyAlias(asset.type);
      expect({ id: asset.id, type: asset.type, aliased: Boolean(alias) }).toEqual({ id: asset.id, type: asset.type, aliased: true });
      expect(findCatalogueEntry(asset.type)?.object.id).toBe(alias!.archetype);
    }
  });

  test('aliases never point at a missing archetype or variant', () => {
    for (const [type, alias] of Object.entries(LEGACY_TYPE_ALIASES)) {
      const entry = findCatalogueEntry(type);
      expect({ type, found: Boolean(entry) }).toEqual({ type, found: true });
      if (alias.defaultVariant) {
        expect(entry!.object.variants.some((variant) => variant.id === alias.defaultVariant)).toBe(true);
      }
    }
  });

  test('facing compensation is either absent or a half turn', () => {
    for (const [type, alias] of Object.entries(LEGACY_TYPE_ALIASES)) {
      if (alias.yaw === undefined) continue;
      expect({ type, yaw: alias.yaw }).toEqual({ type, yaw: Math.PI });
    }
  });
});
