import { describe, expect, test } from 'bun:test';
import { STORE_IDS } from '../../tests/fixtures/store-ids/store-ids.js';
import { MIN_COLLIDABLE_HEIGHT, listCatalogueObjects } from './asset-catalogue.js';
import { projectAssetFacts, shippedAssetFacts, type FactsLibrary } from './asset-facts.js';
import { footprintOf, obstaclesFor } from './asset-footprint.js';
import { planFixtures } from './plan-fixtures.js';
import { ARCHETYPE, VARIANT } from './catalogue-ids.js';
import { apartmentScene } from '../demo/scene-data.js';
import type { DemoAsset, SceneData } from '../scene/types.js';

/** A placement at the origin naming `type` (and whatever else `extra` adds). */
function placed(type: string, extra: Partial<DemoAsset> = {}): DemoAsset {
  return { id: '01a16a50-0000-7000-8000-000000000001', type, position: { x: 0, y: 0, z: 0 }, ...extra };
}

describe('the shipped bank footprints', () => {
  test('floor objects report half-extents derived from their dimensions', () => {
    expect(footprintOf(placed('sofa'))).toEqual({ hx: 1.12, hz: 0.475 });
    expect(footprintOf(placed('chair', { asset: ARCHETYPE.sofa_3s }))).toEqual({ hx: 1.12, hz: 0.475 });
    expect(footprintOf(placed('chair', { asset: ARCHETYPE.sofa_3s, variant: VARIANT.sofa_2s_linen }))).toEqual({ hx: 0.83, hz: 0.475 });
  });

  test('a placement known only by its variant id is sized by that variant', () => {
    expect(footprintOf(placed('01a16a50-0000-7000-8000-0000000000ff', { variant: VARIANT.sofa_2s_linen }))).toEqual({
      hx: 0.83,
      hz: 0.475,
    });
  });

  test('wall and ceiling objects have no walk footprint', () => {
    expect(footprintOf(placed('art'))).toBeNull();
    expect(footprintOf(placed(ARCHETYPE.pendant))).toBeNull();
    expect(footprintOf(placed('ceiling-light'))).toBeNull();
  });

  test('an id no bank knows has no footprint', () => {
    expect(footprintOf(placed('01a16a50-0000-7000-8000-0000000000ff'))).toBeNull();
  });

  test('every floor archetype tall enough to walk into has a positive footprint', () => {
    for (const object of listCatalogueObjects()) {
      if (object.anchor !== 'floor' || object.dims[1] < MIN_COLLIDABLE_HEIGHT) continue;
      const footprint = footprintOf(placed(object.id))!;
      expect(footprint.hx).toBeGreaterThan(0);
      expect(footprint.hz).toBeGreaterThan(0);
    }
  });

  test('a rug is walked over, not around', () => {
    expect(footprintOf(placed(ARCHETYPE.rug_rect))).toBeNull();
    expect(footprintOf(placed(ARCHETYPE.door_mat))).toBeNull();
  });

  test('a plant collides with its pot: dims times the layout.footprint FRACTION', () => {
    const object = listCatalogueObjects().find((candidate) => candidate.layout?.footprint !== undefined)!;
    const share = object.layout!.footprint!;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    expect(footprintOf(placed(object.id))).toEqual({ hx: (object.dims[0] / 2) * share, hz: (object.dims[2] / 2) * share });
  });
});

/* -------------------------------------------------------- project library --- */

const IDS = {
  library: '01a16a50-1000-7000-8000-000000000000',
  vanity: '01a16a50-1000-7000-8000-000000000001',
  vanityTall: '01a16a50-1000-7000-8000-000000000002',
  plant: '01a16a50-1000-7000-8000-000000000003',
  plantDefault: '01a16a50-1000-7000-8000-000000000004',
  rug: '01a16a50-1000-7000-8000-000000000005',
  rugDefault: '01a16a50-1000-7000-8000-000000000006',
  vanityDefault: '01a16a50-1000-7000-8000-000000000007',
  mirror: '01a16a50-1000-7000-8000-000000000008',
  mirrorDefault: '01a16a50-1000-7000-8000-000000000009',
} as const;

/** A hand-made library: dims are OVERALL bounding boxes, as a store bake writes them. */
const LIBRARY: FactsLibrary = {
  objects: [
    {
      id: IDS.vanity,
      anchor: 'floor',
      category: 'bathroom/vanity-units',
      // Overall height includes the tap; the basin rim is what blocks.
      dims: [1.0, 1.1, 0.6],
      layout: { blockingHeight: 0.85, footprint: 0.5 },
      defaultVariant: IDS.vanityDefault,
      variants: [{ id: IDS.vanityDefault }, { id: IDS.vanityTall, dims: [1.2, 1.1, 0.6] }],
    },
    {
      id: IDS.plant,
      anchor: 'floor',
      category: 'decor/plants',
      dims: [0.8, 1.6, 0.6],
      layout: { footprint: 0.25 },
      defaultVariant: IDS.plantDefault,
      variants: [{ id: IDS.plantDefault }],
    },
    {
      // Overall 0.4 m tall (a fringe standing up), but it blocks nothing.
      id: IDS.rug,
      anchor: 'floor',
      category: 'decor/rugs',
      dims: [2, 0.4, 1.4],
      layout: { blockingHeight: 0.02 },
      defaultVariant: IDS.rugDefault,
      variants: [{ id: IDS.rugDefault }],
    },
    {
      id: IDS.mirror,
      anchor: 'wall',
      category: 'decor/mirrors',
      dims: [0.7, 0.7, 0.05],
      defaultVariant: IDS.mirrorDefault,
      variants: [{ id: IDS.mirrorDefault }],
    },
  ],
};

describe('a project library over the shipped bank', () => {
  const facts = projectAssetFacts(LIBRARY);

  test('a store-id placement is sized from the project, with the footprint fraction applied', () => {
    expect(footprintOf(placed(IDS.vanity, { asset: IDS.vanity }), facts)).toEqual({ hx: 0.25, hz: 0.15 });
    expect(footprintOf(placed(IDS.plant, { asset: IDS.plant }), facts)).toEqual({ hx: 0.1, hz: 0.075 });
  });

  test('a size variant collides at its own size, also when the placement names only the variant', () => {
    expect(footprintOf(placed(IDS.vanity, { asset: IDS.vanity, variant: IDS.vanityTall }), facts)).toEqual({ hx: 0.3, hz: 0.15 });
    expect(footprintOf(placed('01a16a50-0000-7000-8000-0000000000ff', { variant: IDS.vanityTall }), facts)).toEqual({ hx: 0.3, hz: 0.15 });
  });

  test('blockingHeight, not the overall height, decides whether a floor object is walked over', () => {
    expect(footprintOf(placed(IDS.rug, { asset: IDS.rug }), facts)).toBeNull();
  });

  test('wall pieces are walked under', () => {
    expect(footprintOf(placed(IDS.mirror, { asset: IDS.mirror }), facts)).toBeNull();
  });

  test('the placement scale and an explicit collision box apply as for the bank', () => {
    expect(footprintOf(placed(IDS.vanity, { asset: IDS.vanity, scale: 2 }), facts)).toEqual({ hx: 0.5, hz: 0.3 });
    expect(footprintOf(placed(IDS.vanity, { asset: IDS.vanity, collision: { hx: 1, hz: 1 } }), facts)).toEqual({ hx: 1, hz: 1 });
  });

  test('a placement naming no variant is sized by the default variant', () => {
    expect(facts(placed(IDS.vanity, { asset: IDS.vanity }))?.dims).toEqual([1.0, 1.1, 0.6]);
  });

  test('a known non-blocking object never takes a legacy box, whatever its type word', () => {
    expect(footprintOf(placed('chair', { asset: IDS.rug }), facts)).toBeNull();
    expect(footprintOf(placed('chair', { asset: IDS.mirror }), facts)).toBeNull();
  });

  test('the height threshold is read before the placement scale', () => {
    const low: FactsLibrary = {
      objects: [
        {
          id: IDS.vanity,
          anchor: 'floor',
          dims: [0.4, MIN_COLLIDABLE_HEIGHT, 0.4],
          defaultVariant: IDS.vanityDefault,
          variants: [{ id: IDS.vanityDefault }],
        },
      ],
    };
    expect(footprintOf(placed(IDS.vanity, { asset: IDS.vanity, scale: 0.5 }), projectAssetFacts(low))).toEqual({ hx: 0.1, hz: 0.1 });
  });

  test('what the project does not declare falls through to the shipped bank', () => {
    expect(footprintOf(placed('sofa'), facts)).toEqual({ hx: 1.12, hz: 0.475 });
    expect(facts(placed(ARCHETYPE.bathtub))?.category).toBe(shippedAssetFacts(placed(ARCHETYPE.bathtub))?.category);
  });

  test('the category comes from the project, so the plan draws its fixtures', () => {
    const scene: SceneData = {
      ...apartmentScene,
      assets: [placed(IDS.vanity, { asset: IDS.vanity }), placed(IDS.plant, { asset: IDS.plant })],
    };
    expect(planFixtures(scene, facts).map((fixture) => fixture.category)).toEqual(['bathroom/vanity-units']);
    expect(planFixtures(scene)).toEqual([]);
  });
});

/* ------------------------------------------- the demo flat, store-id library --- */

/**
 * The demo apartment exported as a baked project whose library carries
 * store-minted UUIDs (`tests/fixtures/store-ids/`): every archetype and variant
 * id is one the shipped bank has never seen, and `dims` are the models'
 * overall bounding boxes.
 */
const storeScene: SceneData = { ...apartmentScene, assets: STORE_IDS.assets };

describe('the demo flat with store ids', () => {
  const facts = projectAssetFacts(STORE_IDS.library);

  test('the shipped bank alone knows none of it: nothing to walk around, nothing on the plan', () => {
    expect(obstaclesFor(storeScene)).toHaveLength(0);
    expect(planFixtures(storeScene)).toHaveLength(0);
  });

  test('read against its own library, every floor object 0.15 m or taller is an obstacle', () => {
    expect(storeScene.assets).toHaveLength(59);
    expect(obstaclesFor(storeScene, facts)).toHaveLength(44);
  });

  test('the plan draws the bath, both WCs, both vanities, the counter, the cooker, the fridge and the island', () => {
    expect(
      planFixtures(storeScene, facts)
        .map((fixture) => fixture.category)
        .sort(),
    ).toEqual([
      'appliances/cookers',
      'appliances/refrigerators',
      'bathroom/baths',
      'bathroom/toilets',
      'bathroom/toilets',
      'bathroom/vanity-units',
      'bathroom/vanity-units',
      'kitchen/base-units',
      'kitchen/islands',
    ]);
  });
});

describe('the layout facts every bank declares are in range', () => {
  test('footprint fractions in (0, 1], blocking heights not negative: the built-in bank and the store-id library', () => {
    const layouts = [...listCatalogueObjects().map((object) => object.layout), ...STORE_IDS.library.objects.map((object) => object.layout)];
    for (const layout of layouts) {
      if (layout?.footprint !== undefined) {
        expect(layout.footprint).toBeGreaterThan(0);
        expect(layout.footprint).toBeLessThanOrEqual(1);
      }
      if (layout?.blockingHeight !== undefined) expect(layout.blockingHeight).toBeGreaterThanOrEqual(0);
    }
    expect(layouts.filter((layout) => layout?.footprint !== undefined).length).toBeGreaterThan(3);
  });
});
