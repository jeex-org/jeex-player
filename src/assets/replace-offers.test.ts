/**
 * `replaceOffers`: what the "Replace with another…" popup lists for a
 * selection — the assets `replace_asset` would accept, from offers or else
 * from the bundled bank, grouped by category.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { categoryLabel, replaceOffers, replaceOp } from './replace-offers.js';
import { libraryStack } from './library-stack.js';
import { ARCHETYPE } from './catalogue-ids.js';
import { listCatalogueObjects } from './asset-catalogue.js';
import { parseProjectLibrary } from './project-manifest.schema.js';
import type { DemoAsset } from '../scene/types.js';
import { OFFERS_FIXTURE as OFFERS } from '../../tests/fixtures/offers/fixture-ids.js';

const OFFERS_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'offers');
const offers = parseProjectLibrary(JSON.parse(readFileSync(join(OFFERS_DIR, 'library.json'), 'utf8')) as unknown);
const BANK = libraryStack(null, { library: offers, baseUrl: 'https://cdn.example.com/o/' }).variants;

const PLACEMENT = '01a1f5aa-1027-735a-bf9c-1e2a8a3c0ed1';
const sofa: DemoAsset = { id: PLACEMENT, type: ARCHETYPE.sofa_3s, asset: ARCHETYPE.sofa_3s, position: { x: 1, y: 0, z: 2 } };
const noPreview = (): string | null => null;
const ids = (groups: ReturnType<typeof replaceOffers>): string[] =>
  groups.flatMap((group) => group.offers.map((offer) => offer.archetypeId));

describe('replaceOffers', () => {
  test('lists offers with the same anchor pair, its own archetype excluded, grouped by top-level category in first-seen order', () => {
    const offered: DemoAsset = { ...sofa, type: OFFERS.asset.longSofa, asset: OFFERS.asset.longSofa, library: OFFERS.library };
    const groups = replaceOffers(offered, BANK, noPreview);
    // The bench is the one other floor object; the vase and the lamp stand on surfaces.
    expect(ids(groups)).toEqual([OFFERS.asset.hallBench]);
    expect(groups.map((group) => group.category)).toEqual(['furniture']);
    expect(groups[0]!.offers[0]!.library).toBe(OFFERS.library);
  });

  test('an offer the project library also declares is offered under the project library, as the copy that is drawn', () => {
    const projectLibrary = {
      ...offers,
      id: '01a1f5aa-1028-7c11-9d22-3e4f5a6b7c8d',
      objects: offers.objects.filter((object) => object.id === OFFERS.asset.hallBench),
    };
    const bank = libraryStack(
      { library: projectLibrary, baseUrl: 'https://cdn.example.com/p/' },
      { library: offers, baseUrl: 'https://cdn.example.com/o/' },
    ).variants;
    const offered: DemoAsset = { ...sofa, type: OFFERS.asset.longSofa, asset: OFFERS.asset.longSofa, library: OFFERS.library };
    const bench = replaceOffers(offered, bank, noPreview)
      .flatMap((group) => group.offers)
      .find((offer) => offer.archetypeId === OFFERS.asset.hallBench);
    expect(bench?.library).toBe(projectLibrary.id);
  });

  test('an on-surface object is offered the other on-surface objects', () => {
    const vase: DemoAsset = { ...sofa, type: OFFERS.asset.budVase, asset: OFFERS.asset.budVase, library: OFFERS.library };
    expect(ids(replaceOffers(vase, BANK, noPreview))).toEqual([OFFERS.asset.tableLamp]);
  });

  test('a mirrored placement is offered nothing whose mirror facts forbid its axis', () => {
    const mirrored: DemoAsset = {
      ...sofa,
      type: OFFERS.asset.longSofa,
      asset: OFFERS.asset.longSofa,
      library: OFFERS.library,
      mirror: { x: true },
    };
    expect(ids(replaceOffers(mirrored, BANK, noPreview))).toEqual([]);
    const bundled = replaceOffers({ ...sofa, mirror: { x: true } }, undefined, noPreview);
    expect(ids(bundled)).not.toContain(ARCHETYPE.tv_unit);
    expect(ids(bundled)).not.toContain(ARCHETYPE.fridge_tall);
  });

  test('without offers the bundled floor bank is offered, the sofa itself excluded', () => {
    const groups = replaceOffers(sofa, undefined, noPreview);
    const floor = listCatalogueObjects().filter((object) => (object.anchor ?? 'floor') === 'floor' && object.onSurface !== true);
    expect(new Set(ids(groups))).toEqual(new Set(floor.map((object) => object.id).filter((id) => id !== ARCHETYPE.sofa_3s)));
    expect(ids(groups)).not.toContain(ARCHETYPE.pendant);
    // One group per top-level category, not one per leaf: the card names
    // already say "Dining table" or "Coffee table".
    const labels = groups.map((group) => group.label);
    expect(labels[0]).toBe('Furniture');
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(expect.arrayContaining(['Furniture', 'Kitchen', 'Appliances', 'Bathroom', 'Lighting', 'Decor']));
  });

  test('a bundled on-surface object has nothing to offer: the popup shows its empty state', () => {
    const lamp: DemoAsset = { ...sofa, type: ARCHETYPE.lamp_table, asset: ARCHETYPE.lamp_table, position: { x: 1, y: 0.75, z: 2 } };
    expect(replaceOffers(lamp, undefined, noPreview)).toEqual([]);
  });

  test('a pick names the default variant explicitly, as listed when the popup opened', () => {
    const groups = replaceOffers(sofa, undefined, noPreview);
    const armchair = groups.flatMap((group) => group.offers).find((offer) => offer.archetypeId === ARCHETYPE.armchair)!;
    const entry = listCatalogueObjects().find((object) => object.id === ARCHETYPE.armchair)!;
    expect(armchair.variant).toBe(entry.defaultVariant);
    expect(replaceOp(PLACEMENT, armchair)).toEqual({
      op: 'replace_asset',
      assetId: PLACEMENT,
      asset: ARCHETYPE.armchair,
      variant: entry.defaultVariant,
    });
    const offered: DemoAsset = { ...sofa, type: OFFERS.asset.longSofa, asset: OFFERS.asset.longSofa, library: OFFERS.library };
    const bench = replaceOffers(offered, BANK, noPreview)[0]!.offers[0]!;
    expect(replaceOp(PLACEMENT, bench)).toEqual({
      op: 'replace_asset',
      assetId: PLACEMENT,
      asset: OFFERS.asset.hallBench,
      library: OFFERS.library,
      variant: OFFERS.variant.hallBench,
    });
  });

  test('a bundled archetype gets a rendered preview of its default variant, once per archetype', () => {
    const asked: [string, string][] = [];
    const render = (candidate: DemoAsset, variantId: string): string => {
      asked.push([candidate.asset ?? candidate.type, variantId]);
      return `data:image/png;base64,${candidate.asset}`;
    };
    const cache = new Map<string, string | null>();
    const groups = replaceOffers(sofa, undefined, render, cache);
    const armchair = groups.flatMap((group) => group.offers).find((offer) => offer.archetypeId === ARCHETYPE.armchair)!;
    expect(armchair.thumbnail).toBe(`data:image/png;base64,${ARCHETYPE.armchair}`);
    expect(asked).toContainEqual([ARCHETYPE.armchair, armchair.variant]);
    const count = asked.length;
    replaceOffers(sofa, undefined, render, cache);
    expect(asked).toHaveLength(count);
  });
});

describe('categoryLabel', () => {
  test('the top path segment, made readable', () => {
    expect(categoryLabel('furniture/sofas')).toBe('Furniture');
    expect(categoryLabel('home_decor/benches')).toBe('Home decor');
    expect(categoryLabel('decor')).toBe('Decor');
  });
});
