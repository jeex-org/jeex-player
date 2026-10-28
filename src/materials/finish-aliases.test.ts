/**
 * The contemporary bundled set in the pure catalogue: the three retired
 * finishes are aliases that answer with their target's own row and family,
 * the picker lists offer no alias, and the eleven new finishes follow the
 * existing rows of their family.
 */

import { describe, expect, test } from 'bun:test';
import { FLOOR_FINISHES, RETIRED_FINISHES, WALL_FINISHES, findFinish, finishKind } from './finish-catalogue.js';
import { FINISH } from './finish-ids.js';
import { CATALOGUE_ID_BY_SLUG } from '../assets/catalogue-slugs.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';

const ALIASES = [
  [FINISH.wallpaper_cream, FINISH.white],
  [FINISH.wallpaper_sage, FINISH.sage],
  [FINISH.ash, FINISH.oak],
] as const;

describe('retired finishes', () => {
  test('are exactly the three aliases, with their historical slugs', () => {
    expect(RETIRED_FINISHES).toEqual([
      { id: FINISH.wallpaper_cream, slug: 'wallpaper-cream', target: FINISH.white },
      { id: FINISH.wallpaper_sage, slug: 'wallpaper-sage', target: FINISH.sage },
      { id: FINISH.ash, slug: 'ash', target: FINISH.oak },
    ]);
  });

  test("answer with the target's own row and family, and stay valid finishes", () => {
    for (const [alias, target] of ALIASES) {
      expect(findFinish(alias)).toBe(findFinish(target));
      expect(finishKind(alias)).toBe(finishKind(target));
      expect(CATALOGUE_REGISTRIES.isFinish(alias)).toBe(true);
    }
  });

  test('are never offered by the picker lists', () => {
    const listed = new Set([...FLOOR_FINISHES, ...WALL_FINISHES].map((finish) => finish.id));
    for (const [alias] of ALIASES) expect(listed.has(alias)).toBe(false);
  });

  test('keep their historical slugs in the 1.x translation table', () => {
    expect(CATALOGUE_ID_BY_SLUG.finish['ash']).toBe(FINISH.ash);
    expect(CATALOGUE_ID_BY_SLUG.finish['wallpaper-cream']).toBe(FINISH.wallpaper_cream);
    expect(CATALOGUE_ID_BY_SLUG.finish['wallpaper-sage']).toBe(FINISH.wallpaper_sage);
  });
});

describe('the contemporary set', () => {
  test('the floors are the existing ones, then the two herringbone parquets', () => {
    expect(FLOOR_FINISHES.map((finish) => finish.id)).toEqual([
      FINISH.oak,
      FINISH.walnut,
      FINISH.teak,
      FINISH.chevron,
      FINISH.terrazzo,
      FINISH.stone,
      FINISH.ceramic_light,
      FINISH.ceramic_graphite,
      FINISH.herringbone,
      FINISH.herringbone_dark,
    ]);
  });

  test('the walls are the existing ones, then the nine new wall finishes, then the two flat paints', () => {
    expect(WALL_FINISHES.map((finish) => finish.id)).toEqual([
      FINISH.sand,
      FINISH.white,
      FINISH.sage,
      FINISH.terra,
      FINISH.graphite,
      FINISH.tiles_white,
      FINISH.pure_white,
      FINISH.ink,
      FINISH.venetian,
      FINISH.microcement,
      FINISH.microcement_grey,
      FINISH.travertine,
      FINISH.marble,
      FINISH.porcelain_grey,
      FINISH.zellige,
      FINISH.smooth_white,
      FINISH.ceiling_white,
    ]);
  });

  test('the new ids are the ones the library gives', () => {
    expect(FINISH.zellige).toBe('01a16edb-fb93-7729-93ff-3b4d4290edb5');
    expect(FINISH.herringbone).toBe('01a16edb-fb93-7729-93ff-3b4ea71ae797');
    expect(findFinish(FINISH.graphite)?.name).toBe('Mocha');
  });
});
