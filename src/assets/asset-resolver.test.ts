import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CEILING_HEIGHT,
  HANGING_HEADROOM,
  MIN_HANGING_DROP,
  clampHangingDrop,
  isBakedVariant,
  isResolved,
  mergeFinishes,
  mountHeightFor,
  optionNumber,
  resolveAsset,
} from './asset-resolver.js';
import { DEFAULT_LIBRARY, findObject, listCatalogueObjects } from './asset-catalogue.js';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import type { DemoAsset } from '../scene/types.js';
import type { ResolvableObject } from './asset-resolver.js';
import { ARCHETYPE, VARIANT } from './catalogue-ids.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectBank } from './project-catalogue.js';
import { parseProjectManifest } from './project-manifest.schema.js';
import { LAMP_PROJECT_FIXTURE as LAMPS, PROJECT_FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';

/** Ids no bank carries: a placement, a library, a baked archetype and its variant, a finish. */
const PLACEMENT = '01a12fed-dd98-7894-8642-886f3cb7ba35';
const OTHER_LIBRARY = '01a12fed-dd99-79d4-a6d9-aae12b8c417b';
const LOUNGE = '01a12fed-dd9a-77dc-9037-58746cbdf27a';
const LOUNGE_BLACK = '01a12fed-dd9b-7e7b-ac9c-8effe9bef284';
const UNKNOWN_FINISH = '01a12fed-dd9c-7cdf-ab9a-b0d258fbf25e';
const UNKNOWN_VARIANT = '01a12fed-dd9d-7935-afa1-52a886ab0be6';

const at = (id: string): DemoAsset => apartmentScene.assets.find((asset) => asset.id === id)!;
const placement = (extra: Partial<DemoAsset> & { type: string }): DemoAsset => ({
  id: PLACEMENT,
  position: { x: 0, y: 0, z: 0 },
  ...extra,
});

describe('placement resolution', () => {
  test('every placement in the demo scene resolves', () => {
    for (const asset of apartmentScene.assets) {
      const result = resolveAsset(asset, { ceilingHeight: apartmentScene.ceilingHeight });
      expect({ id: asset.id, resolved: isResolved(result) }).toEqual({ id: asset.id, resolved: true });
    }
  });

  test('a legacy type resolves to its aliased archetype and default variant', () => {
    const result = resolveAsset(at(DEMO.asset.livingSofa));
    expect(isResolved(result)).toBe(true);
    if (!isResolved(result)) return;
    expect(result.asset.archetypeId).toBe(ARCHETYPE.sofa_3s);
    expect(result.asset.variantId).toBe(VARIANT.sofa_3s_linen);
    expect(result.asset.library).toBe(DEFAULT_LIBRARY);
  });

  test('legacy placements ignore the material shortcut, catalogue placements honour it', () => {
    const legacy = resolveAsset(placement({ type: 'sofa', material: FINISH.ash_black }));
    const modern = resolveAsset(placement({ type: ARCHETYPE.sofa_3s, asset: ARCHETYPE.sofa_3s, material: FINISH.ash_black }));
    if (!isResolved(legacy) || !isResolved(modern)) throw new Error('expected both to resolve');
    expect(legacy.asset.finishes['upholstery']).toBe(FINISH.linen_sand);
    expect(modern.asset.finishes['upholstery']).toBe(FINISH.ash_black);
  });

  test('legacy case goods get a half turn so old rotations still face into the room', () => {
    const wardrobe = resolveAsset(at(DEMO.asset.bedroomWardrobe));
    const sofa = resolveAsset(at(DEMO.asset.livingSofa));
    if (!isResolved(wardrobe) || !isResolved(sofa)) throw new Error('expected both to resolve');
    expect(wardrobe.asset.yaw).toBeCloseTo(Math.PI, 6);
    expect(sofa.asset.yaw).toBe(0);
  });

  test('a placement that names a variant directly carries no facing compensation', () => {
    const result = resolveAsset(placement({ type: ARCHETYPE.bed_double, asset: ARCHETYPE.bed_double, variant: VARIANT.bed_platform }));
    if (!isResolved(result)) throw new Error('expected a resolution');
    expect(result.asset.variantId).toBe(VARIANT.bed_platform);
    expect(result.asset.yaw).toBe(0);
  });

  test('a size variant reshapes the object instead of scaling it', () => {
    const base = resolveAsset(placement({ type: ARCHETYPE.sofa_3s, asset: ARCHETYPE.sofa_3s }));
    const small = resolveAsset(placement({ type: ARCHETYPE.sofa_3s, asset: ARCHETYPE.sofa_3s, variant: VARIANT.sofa_2s_linen }));
    if (!isResolved(base) || !isResolved(small)) throw new Error('expected both to resolve');
    expect(small.asset.dims[0]).toBeLessThan(base.asset.dims[0]);
    expect(small.asset.scale).toBe(1);
    expect(optionNumber(small.asset.options, 'seats', 3)).toBe(2);
  });

  test('with an injected bank, a placement naming the bank library resolves whatever the document default is', () => {
    const object = findObject(ARCHETYPE.sofa_3s)!;
    const catalogue = (id: string) => (id === object.id ? { object } : null);
    const own = placement({ type: ARCHETYPE.sofa_3s, asset: ARCHETYPE.sofa_3s, library: OTHER_LIBRARY });

    const named = resolveAsset(own, { catalogue, catalogueLibrary: OTHER_LIBRARY });
    expect(isResolved(named) && named.asset.library).toBe(OTHER_LIBRARY);
    // Without saying which library the bank answers for, only the document default is accepted.
    const unnamed = resolveAsset(own, { catalogue });
    expect(!isResolved(unnamed) && unnamed.failure.reason).toBe('unknown-library');
  });

  test('unknown libraries, assets and variants degrade to typed failures', () => {
    const library = resolveAsset(placement({ type: 'sofa', asset: ARCHETYPE.sofa_3s, library: OTHER_LIBRARY }));
    const asset = resolveAsset(placement({ type: 'flying-carpet' }));
    const variant = resolveAsset(placement({ type: ARCHETYPE.sofa_3s, asset: ARCHETYPE.sofa_3s, variant: UNKNOWN_VARIANT }));
    expect(isResolved(library)).toBe(false);
    expect(isResolved(asset)).toBe(false);
    expect(isResolved(variant)).toBe(false);
    if (!isResolved(library)) expect(library.failure.reason).toBe('unknown-library');
    if (!isResolved(asset)) expect(asset.failure.reason).toBe('unknown-asset');
    if (!isResolved(variant)) expect(variant.failure.reason).toBe('unknown-variant');
  });

  test('per-slot overrides beat the variant, unknown finishes fall back', () => {
    const object = findObject(ARCHETYPE.sofa_3s)!;
    // Every catalogue object declares four variants (asserted in
    // `asset-catalogue.test.ts`), so the first one is there.
    const variant = object.variants[0]!;
    expect(mergeFinishes(object, variant, { leg: FINISH.ash_black }, undefined)['leg']).toBe(FINISH.ash_black);
    expect(mergeFinishes(object, variant, { leg: UNKNOWN_FINISH }, undefined)['leg']).toBe(FINISH.oak_natural);
  });

  test('every slot of every archetype resolves to a finish', () => {
    for (const object of listCatalogueObjects()) {
      for (const variant of object.variants) {
        const merged = mergeFinishes(object, variant, undefined, undefined);
        for (const slot of object.slots) {
          expect({ variant: variant.id, slot, filled: Boolean(merged[slot]) }).toEqual({ variant: variant.id, slot, filled: true });
        }
      }
    }
  });
});

describe('ceiling-mounted fixtures', () => {
  test('a ceiling anchor is mounted at the scene ceiling, not at y = 0', () => {
    expect(mountHeightFor('ceiling', 0, 2.65)).toBe(2.65);
    expect(mountHeightFor('ceiling', 0, 3.15)).toBe(3.15);
  });

  test('an explicit height on the placement still wins', () => {
    expect(mountHeightFor('ceiling', 2.2, 3.15)).toBe(2.2);
  });

  test('floor and wall anchors keep their authored height', () => {
    expect(mountHeightFor('floor', 0, 2.65)).toBe(0);
    expect(mountHeightFor('wall', 1.6, 2.65)).toBe(1.6);
  });

  test('the hanging drop shortens to keep headroom in a low room', () => {
    expect(clampHangingDrop(1.05, 3.15)).toBe(1.05);
    expect(clampHangingDrop(1.5, 3.15)).toBe(1.5);
    expect(clampHangingDrop(1.5, 2.65)).toBeCloseTo(2.65 - HANGING_HEADROOM, 6);
    expect(clampHangingDrop(1.05, 2.65)).toBeCloseTo(1.05, 6);
  });

  test('the drop never inverts, however low the ceiling', () => {
    for (const ceiling of [0, 1, 1.5, 1.7, 2.2, 2.65, 3.15]) {
      const drop = clampHangingDrop(1.5, ceiling);
      expect(drop).toBeGreaterThanOrEqual(MIN_HANGING_DROP);
      if (ceiling > HANGING_HEADROOM + MIN_HANGING_DROP) expect(drop).toBeLessThan(ceiling);
    }
  });

  test('resolution applies the clamp to the pendant dims and mounts it at the ceiling', () => {
    const low = resolveAsset(placement({ type: 'pendant' }), { ceilingHeight: 2.65 });
    const high = resolveAsset(placement({ type: 'pendant' }), { ceilingHeight: 3.15 });
    if (!isResolved(low) || !isResolved(high)) throw new Error('expected both to resolve');
    expect(low.asset.mountY).toBe(2.65);
    expect(high.asset.mountY).toBe(3.15);
    expect(low.asset.dims[1]).toBeLessThanOrEqual(2.65 - HANGING_HEADROOM + 1e-9);
    expect(high.asset.dims[1]).toBe(1.05);
  });

  test('a long pendant keeps its drop under a tall ceiling and loses it under a low one', () => {
    const long = { type: 'pendant', asset: ARCHETYPE.pendant, variant: VARIANT.pendant_cone_long };
    const tall = resolveAsset(placement(long), { ceilingHeight: 3.15 });
    const squat = resolveAsset(placement(long), { ceilingHeight: 2.65 });
    if (!isResolved(tall) || !isResolved(squat)) throw new Error('expected both to resolve');
    expect(tall.asset.dims[1]).toBe(1.5);
    expect(squat.asset.dims[1]).toBeLessThan(1.5);
    // Fixture bottom stays above head height in both rooms.
    expect(3.15 - tall.asset.dims[1]).toBeGreaterThanOrEqual(HANGING_HEADROOM);
    expect(2.65 - squat.asset.dims[1]).toBeGreaterThanOrEqual(HANGING_HEADROOM);
  });

  test('the default ceiling height is used when a caller gives none', () => {
    const result = resolveAsset(placement({ type: 'ceiling-light' }));
    if (!isResolved(result)) throw new Error('expected a resolution');
    expect(result.asset.mountY).toBe(DEFAULT_CEILING_HEIGHT);
  });
});

describe('builder options', () => {
  test('readers fall back when the option is missing or the wrong type', () => {
    expect(optionNumber({ a: 3 }, 'a', 1)).toBe(3);
    expect(optionNumber({ a: 'x' }, 'a', 1)).toBe(1);
    expect(optionNumber({}, 'a', 1)).toBe(1);
  });
});

describe('baked variants', () => {
  /** A project object the way a catalogue publishes it: a GLB, own part names, no builder. */
  const bakedObject = (extra: Partial<ResolvableObject> = {}): ResolvableObject => ({
    id: LOUNGE,
    name: 'Lounge chair',
    category: 'furniture/armchairs',
    dims: [0.81, 0.83, 1.51],
    anchor: 'floor',
    wallSnap: true,
    clearance: 0.6,
    tags: [],
    model: 'obj/lounge@1.0.0.glb',
    slots: ['upholstery', 'shell', 'base', 'fittings'],
    defaultFinishes: {},
    primarySlot: 'upholstery',
    defaultVariant: LOUNGE_BLACK,
    variants: [{ id: LOUNGE_BLACK, name: 'Black', version: '1.0.0', finishes: {}, pricing: { model: 'free' } }],
    ...extra,
  });
  const resolveIn = (object: ResolvableObject, extra: Partial<DemoAsset> = {}) =>
    resolveAsset(
      { id: PLACEMENT, type: LOUNGE, asset: LOUNGE, position: { x: 0, y: 0, z: 0 }, ...extra },
      { defaultLibrary: OTHER_LIBRARY, catalogue: (id) => (id === object.id ? { object } : null) },
    );

  test('a GLB variant that binds no finish anywhere is baked', () => {
    const object = bakedObject();
    expect(isBakedVariant(object, object.variants[0]!)).toBe(true);
    const result = resolveIn(object);
    expect(isResolved(result) && result.asset.baked).toBe(true);
  });

  test('a builder-less GLB variant that names a finish is still baked', () => {
    const object = bakedObject({
      variants: [
        { id: LOUNGE_BLACK, name: 'Black', version: '1.0.0', finishes: { upholstery: UNKNOWN_FINISH }, pricing: { model: 'free' } },
      ],
    });
    expect(isBakedVariant(object, object.variants[0]!)).toBe(true);
  });

  test('a builder-less GLB archetype with default finishes is still baked', () => {
    const object = bakedObject({ defaultFinishes: { upholstery: FINISH.linen_sand } });
    expect(isBakedVariant(object, object.variants[0]!)).toBe(true);
    const result = resolveIn(object);
    expect(isResolved(result) && result.asset.baked).toBe(true);
  });

  test("a builder-less variant without its own GLB is baked under the archetype's", () => {
    const object = bakedObject({ defaultFinishes: { upholstery: FINISH.linen_sand } });
    expect(object.variants[0]!.model).toBeUndefined();
    expect(isBakedVariant(object, object.variants[0]!)).toBe(true);
  });

  test('a builder archetype with a GLB that declares finishes is not baked', () => {
    const object = bakedObject({ builder: 'armchair', defaultFinishes: { upholstery: FINISH.linen_sand } });
    expect(isBakedVariant(object, object.variants[0]!)).toBe(false);
  });

  test('without a GLB nothing is baked', () => {
    const { model: _model, ...object } = bakedObject();
    expect(isBakedVariant(object, object.variants[0]!)).toBe(false);
  });

  test('every shipped bank variant stays not baked', () => {
    for (const object of listCatalogueObjects()) {
      for (const variant of object.variants)
        expect({ id: variant.id, baked: isBakedVariant(object, variant) }).toEqual({ id: variant.id, baked: false });
    }
  });
});

describe('lamp lights', () => {
  const fixture = (folder: string) =>
    parseProjectManifest(
      JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'tests', 'fixtures', folder, 'project.json'), 'utf8')) as unknown,
    );

  function resolveIn(folder: string, asset: string, variant: string) {
    const manifest = fixture(folder);
    const bank = projectBank(manifest, 'https://example.com/bake/');
    const result = resolveAsset(
      { id: PLACEMENT, type: asset, asset, variant, position: { x: 0, y: 0, z: 0 } },
      {
        defaultLibrary: manifest.library.id,
        catalogue: bank.catalogue,
        catalogueLibrary: manifest.library.id,
        resolveFinish: bank.resolveFinish,
      },
    );
    if (!isResolved(result)) throw new Error(`${asset} should resolve`);
    return result.asset;
  }

  test('a lit project variant carries its lights, as authored', () => {
    const asset = resolveIn('project-lamps', LAMPS.asset.pendant, LAMPS.variant.pendant);
    expect(asset.lights).toEqual([{ kind: 'point', position: [0, 0.063, 0], colour: '#ffd9a4', lumens: 600, cutoff: 5.2 }]);
  });

  test('an unlit project variant and a bank variant carry none', () => {
    expect('lights' in resolveIn('project', PROJECT_FIXTURE.asset.boxSofa, PROJECT_FIXTURE.variant.boxSofa)).toBe(false);
    const bank = resolveAsset(placement({ type: 'pendant', asset: ARCHETYPE.pendant }));
    if (!isResolved(bank)) throw new Error('the bank pendant should resolve');
    expect('lights' in bank.asset).toBe(false);
  });
});
