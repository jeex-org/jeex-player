import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import { activeVariantFor, variantsForPlacement, variantsForType, type VariantBank } from './asset-variants.js';
import { findCatalogueEntry, listCatalogueObjects } from './asset-catalogue.js';
import { projectCatalogue, projectPreviewUrl } from './project-catalogue.js';
import type { ProjectLibraryManifest } from './project-manifest.js';
import { finishById } from './asset-finishes.js';
import type { DemoAsset } from '../scene/types.js';
import { DEMO } from '../demo/demo-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { ARCHETYPE, VARIANT } from './catalogue-ids.js';

/** A placement no scene declares. */
const PLACEMENT = '01a12fed-dd9e-709a-b09b-dec3dabc29c7';

describe('asset variant bank', () => {
  test('every furniture type in the scene has exactly four variants', () => {
    const types = new Set(apartmentScene.assets.map((asset) => asset.type));
    for (const type of types) {
      expect({ type, variants: variantsForType(type).length }).toEqual({ type, variants: 4 });
    }
  });

  test('every archetype in the bank has exactly four variants', () => {
    for (const object of listCatalogueObjects()) {
      expect({ id: object.id, variants: variantsForType(object.id).length }).toEqual({ id: object.id, variants: 4 });
    }
  });

  test('variant ids are unique within a type and the first is the standard look', () => {
    for (const object of listCatalogueObjects()) {
      const variants = variantsForType(object.id);
      const ids = variants.map((variant) => variant.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toBe(object.defaultVariant);
    }
  });

  test('variants only reference known finishes, never raw colours', () => {
    for (const object of listCatalogueObjects()) {
      for (const variant of variantsForType(object.id)) {
        for (const finishId of Object.values(variant.finishes)) {
          expect({ variant: variant.id, finishId, known: Boolean(finishById(finishId)) }).toEqual({
            variant: variant.id,
            finishId,
            known: true,
          });
          expect(finishId.startsWith('#')).toBe(false);
        }
      }
    }
  });

  test('every variant offers at least one swatch colour for the UI chip', () => {
    for (const object of listCatalogueObjects()) {
      for (const variant of variantsForType(object.id)) {
        expect(variant.swatch.length).toBeGreaterThan(0);
        for (const colour of variant.swatch) expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  test('a legacy type, an archetype id and a variant id all reach the same list', () => {
    const byType = variantsForType('bed').map((variant) => variant.id);
    const byArchetype = variantsForType(ARCHETYPE.bed_double).map((variant) => variant.id);
    const byVariant = variantsForType(VARIANT.bed_platform).map((variant) => variant.id);
    expect(byType).toEqual(byArchetype);
    expect(byVariant).toEqual(byArchetype);
    expect(byType).toContain(VARIANT.bed_platform);
  });

  test('an unknown reference yields no variants rather than throwing', () => {
    expect(variantsForType('not-a-thing')).toEqual([]);
  });

  test('the active variant of a legacy placement is the archetype default', () => {
    const bed = apartmentScene.assets.find((asset) => asset.id === DEMO.asset.bedroomBed)!;
    expect(activeVariantFor(bed)).toBe(VARIANT.bed_double_linen);
    expect(variantsForPlacement(bed).map((variant) => variant.id)).toContain(VARIANT.bed_platform);
  });

  test('an explicit variant on a placement wins', () => {
    expect(activeVariantFor({ id: PLACEMENT, type: 'bed', variant: VARIANT.bed_platform, position: { x: 0, y: 0, z: 0 } })).toBe(
      VARIANT.bed_platform,
    );
  });
});

/**
 * The Replace list of a document that loaded a project is the PROJECT's bank with
 * the bundled one behind it, and a variant's picture comes from the manifest
 * when the manifest names one.
 *
 * The library below is written out rather than read from the fixture folder
 * because the point is the MERGE, and that needs an archetype the bundled bank
 * has never heard of next to one whose id it already owns.
 */
const REMOTE = {
  project: '01a12fed-dd9f-7064-b80d-5e98dfaa4c1f',
  publisher: '01a12fed-dda0-7ddf-a13e-af419419bc9f',
  bed: '01a12fed-dda1-7e20-b6f2-115f25ae16cb',
  oak: '01a12fed-dda2-7160-8f10-7caee27ad2e7',
  walnut: '01a12fed-dda3-7b65-890c-741e66949119',
  bare: '01a12fed-dda4-74ba-8d19-c102bafb889c',
} as const;
const REMOTE_BASE = `https://example.com/w1/${REMOTE.project}/3/`;
const REMOTE_PREVIEW = `https://cdn.example.com/v1/previews/${REMOTE.publisher}/${REMOTE.bed}/${REMOTE.oak}/2.1.0.webp`;

function remoteLibrary(): ProjectLibraryManifest {
  return {
    manifestVersion: '1.0',
    id: REMOTE.project,
    publisher: REMOTE.publisher,
    license: 'Apache-2.0',
    materials: [],
    objects: [
      {
        id: REMOTE.bed,
        name: 'Catalogue bed',
        category: 'furniture/beds',
        dims: [1.8, 0.5, 2.1],
        anchor: 'floor',
        wallSnap: true,
        clearance: 0.7,
        tags: ['bedroom'],
        model: 'obj/bed_remote@2.1.0.glb',
        slots: ['frame'],
        defaultFinishes: { frame: FINISH.oak_natural },
        primarySlot: 'frame',
        defaultVariant: REMOTE.oak,
        variants: [
          { id: REMOTE.oak, name: 'Oak', version: '2.1.0', pricing: { model: 'free' }, preview: REMOTE_PREVIEW },
          {
            id: REMOTE.walnut,
            name: 'Walnut',
            version: '2.1.0',
            pricing: { model: 'premium' },
            preview: 'prev/bed_remote_walnut.webp',
          },
          { id: REMOTE.bare, name: 'Bare', version: '2.1.0', pricing: { model: 'free' } },
        ],
      },
    ],
  };
}

function remoteBank(library: ProjectLibraryManifest = remoteLibrary()): VariantBank {
  return { catalogue: projectCatalogue(library, findCatalogueEntry), previewUrl: projectPreviewUrl(REMOTE_BASE) };
}

describe('the variant bank merges the project with the bundled library', () => {
  test('a project-only archetype gets a Replace list at all — without the bank it has none', () => {
    const placement: DemoAsset = { id: PLACEMENT, type: 'bed', asset: REMOTE.bed, position: { x: 0, y: 0, z: 0 } };

    // Without the bank the panel is EMPTY: the bundled library has no such
    // bed, which is exactly the gap the project bank closes.
    expect(variantsForPlacement(placement)).toEqual([]);
    expect(variantsForPlacement(placement, remoteBank()).map((variant) => variant.id)).toEqual([REMOTE.oak, REMOTE.walnut, REMOTE.bare]);
  });

  test('an id the project does not declare still reaches the bundled bank', () => {
    const placement: DemoAsset = { id: PLACEMENT, type: 'sofa', asset: ARCHETYPE.sofa_3s, position: { x: 0, y: 0, z: 0 } };
    expect(variantsForPlacement(placement, remoteBank()).map((variant) => variant.id)).toEqual(
      variantsForPlacement(placement).map((variant) => variant.id),
    );
  });

  test('on an id collision the PROJECT entry wins: it is the one whose GLB is loaded', () => {
    const shadowing = remoteLibrary();
    const bank = remoteBank({ ...shadowing, objects: [{ ...shadowing.objects[0]!, id: ARCHETYPE.sofa_3s }] });
    const placement: DemoAsset = { id: PLACEMENT, type: 'sofa', asset: ARCHETYPE.sofa_3s, position: { x: 0, y: 0, z: 0 } };

    expect(variantsForPlacement(placement, bank).map((variant) => variant.id)).toEqual([REMOTE.oak, REMOTE.walnut, REMOTE.bare]);
    expect(variantsForPlacement(placement).map((variant) => variant.id)).toContain(VARIANT.sofa_3s_boucle);
  });

  test('activeVariantFor reads the project default for a project-only archetype', () => {
    const placement: DemoAsset = { id: PLACEMENT, type: 'bed', asset: REMOTE.bed, position: { x: 0, y: 0, z: 0 } };
    expect(activeVariantFor(placement, remoteBank())).toBe(REMOTE.oak);
  });
});

describe('a variant carries the picture its manifest names', () => {
  const placement: DemoAsset = { id: PLACEMENT, type: 'bed', asset: REMOTE.bed, position: { x: 0, y: 0, z: 0 } };

  test('an absolute catalogue address is carried through untouched', () => {
    const variants = variantsForPlacement(placement, remoteBank());
    expect(variants[0]?.preview).toBe(REMOTE_PREVIEW);
  });

  test('a relative path is resolved against the project folder', () => {
    const variants = variantsForPlacement(placement, remoteBank());
    expect(variants[1]?.preview).toBe(`${REMOTE_BASE}prev/bed_remote_walnut.webp`);
  });

  test('a variant with no preview leaves the field ABSENT, not empty', () => {
    const variants = variantsForPlacement(placement, remoteBank());
    expect(variants[2]?.preview).toBeUndefined();
    expect(Object.hasOwn(variants[2]!, 'preview')).toBe(false);
  });

  test('access and allowed are carried from the manifest, and left ABSENT where it says nothing', () => {
    const library = remoteLibrary();
    const gated = {
      ...library,
      objects: [
        {
          ...library.objects[0]!,
          variants: [
            { ...library.objects[0]!.variants[0]!, access: 'free' as const, allowed: true },
            { ...library.objects[0]!.variants[1]!, access: 'pro' as const, allowed: false },
            library.objects[0]!.variants[2]!,
          ],
        },
      ],
    };
    const variants = variantsForPlacement(placement, remoteBank(gated));

    expect(variants.map((variant) => ({ id: variant.id, access: variant.access, allowed: variant.allowed }))).toEqual([
      { id: REMOTE.oak, access: 'free', allowed: true },
      { id: REMOTE.walnut, access: 'pro', allowed: false },
      { id: REMOTE.bare, access: undefined, allowed: undefined },
    ]);
    expect(Object.hasOwn(variants[2]!, 'access')).toBe(false);
    expect(Object.hasOwn(variants[2]!, 'allowed')).toBe(false);
  });

  test('a variant nobody is allowed to place is still OFFERED: the viewer gates nothing', () => {
    const library = remoteLibrary();
    const gated = {
      ...library,
      objects: [
        {
          ...library.objects[0]!,
          variants: library.objects[0]!.variants.map((variant) => ({ ...variant, access: 'exclusive' as const, allowed: false })),
        },
      ],
    };
    expect(variantsForPlacement(placement, remoteBank(gated)).length).toBe(3);
  });

  test('every variant of the bundled bank carries none: a shipped scene is rendered exactly as before', () => {
    for (const object of listCatalogueObjects()) {
      for (const variant of variantsForType(object.id)) {
        expect({
          id: variant.id,
          hasPreview: Object.hasOwn(variant, 'preview'),
          hasAccess: Object.hasOwn(variant, 'access'),
          hasAllowed: Object.hasOwn(variant, 'allowed'),
        }).toEqual({ id: variant.id, hasPreview: false, hasAccess: false, hasAllowed: false });
      }
    }
  });
});
