import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { AssetLoader, PENDING_MODEL } from './asset-loader.js';
import { formatAssetRef, listCatalogueObjects } from '../assets/asset-catalogue.js';
import { ARCHETYPE, VARIANT } from '../assets/catalogue-ids.js';
import { projectBank } from '../assets/project-catalogue.js';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import type { BakedProjectManifest } from '../assets/project-manifest.js';
import { apartmentScene } from '../demo/scene-data.js';
import type { DemoAsset } from '../scene/types.js';
import type { ModelOutcome, ModelRequest } from './model-source.js';
import { PROJECT_FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';

/**
 * Loader checks that need Three.js but no canvas: texture generators return
 * null without a document, so materials fall back to flat colours and the
 * geometry is unaffected.
 */

const TRIANGLE_BUDGET = 5000;
const origin = { x: 0, y: 0, z: 0 };

/** Placement ids this file invents for the inline placements it loads. */
const PLACEMENT = {
  probe: '01a12ffa-e524-74fb-86e0-c4cbdcb7bae0',
  sofaMain: '01a12ffa-e525-77f7-aec6-12e83a2ccc6d',
  pendant: '01a12ffa-e526-7b60-9d23-4686d2ab14f3',
  ghost: '01a12ffa-e527-7a3b-835c-b29b9dc40095',
} as const;

describe('object bank instantiation', () => {
  test('every variant in the bank builds without degrading', () => {
    const loader = new AssetLoader([], { ceilingHeight: apartmentScene.ceilingHeight });
    for (const object of listCatalogueObjects()) {
      for (const variant of object.variants) {
        const placement: DemoAsset = { id: PLACEMENT.probe, type: object.id, asset: object.id, variant: variant.id, position: origin };
        const result = loader.load(placement);
        expect({ variant: variant.id, degraded: result.degraded }).toEqual({ variant: variant.id, degraded: false });
      }
    }
    loader.dispose();
  });

  test('no object exceeds the per-item triangle budget', () => {
    const loader = new AssetLoader([], { ceilingHeight: apartmentScene.ceilingHeight });
    for (const object of listCatalogueObjects()) {
      for (const variant of object.variants) {
        const result = loader.load({ id: PLACEMENT.probe, type: object.id, asset: object.id, variant: variant.id, position: origin });
        const triangles = loader.triangles(result.group);
        expect({ variant: variant.id, overBudget: triangles > TRIANGLE_BUDGET }).toEqual({ variant: variant.id, overBudget: false });
      }
    }
    loader.dispose();
  });

  test('geometry is shared: a second copy of a scene adds no new buffers', () => {
    const loader = new AssetLoader(apartmentScene.materials, { ceilingHeight: apartmentScene.ceilingHeight });
    for (const asset of apartmentScene.assets) loader.load(asset);
    const first = loader.geometryCount();
    for (const asset of apartmentScene.assets) loader.load(asset);
    expect(loader.geometryCount()).toBe(first);
    loader.dispose();
  });

  test('a placement carries the selection contract and its catalogue metadata', () => {
    const loader = new AssetLoader([], { ceilingHeight: apartmentScene.ceilingHeight });
    const { group } = loader.load({ id: PLACEMENT.sofaMain, type: 'sofa', position: { x: 1, y: 0, z: 2 } });
    expect(group.userData['assetId']).toBe(PLACEMENT.sofaMain);
    expect(group.userData['archetypeId']).toBe(ARCHETYPE.sofa_3s);
    expect(group.userData['variantId']).toBe(VARIANT.sofa_3s_linen);
    expect(group.userData['assetRef']).toBe(`starter:interior-v1:${ARCHETYPE.sofa_3s}`);
    expect(group.userData['collision']).toEqual({ hx: 1.12, hz: 0.475 });
    loader.dispose();
  });

  test('an authored collision box wins over the catalogue footprint', () => {
    const loader = new AssetLoader([], {});
    const { group } = loader.load({ id: PLACEMENT.probe, type: 'sofa', position: origin, collision: { hx: 0.5, hz: 0.5 } });
    expect(group.userData['collision']).toEqual({ hx: 0.5, hz: 0.5 });
    loader.dispose();
  });

  test('a ceiling fixture is mounted at the ceiling, never at the floor', () => {
    const loader = new AssetLoader([], { ceilingHeight: 2.65 });
    const { group } = loader.load({ id: PLACEMENT.pendant, type: 'pendant', position: origin });
    expect(group.position.y).toBe(2.65);
    const box = new THREE.Box3().setFromObject(group);
    // Hangs downward from the ceiling and keeps clear of head height.
    expect(box.max.y).toBeLessThanOrEqual(2.66);
    expect(box.min.y).toBeGreaterThan(1.5);
    loader.dispose();
  });

  test('every placement in the demo scene builds and stands on the floor', () => {
    const loader = new AssetLoader(apartmentScene.materials, { ceilingHeight: apartmentScene.ceilingHeight });
    for (const asset of apartmentScene.assets) {
      const result = loader.load(asset);
      expect({ id: asset.id, degraded: result.degraded }).toEqual({ id: asset.id, degraded: false });
      const box = new THREE.Box3().setFromObject(result.group);
      expect({ id: asset.id, sunk: box.min.y < -0.02 }).toEqual({ id: asset.id, sunk: false });
      expect({ id: asset.id, throughCeiling: box.max.y > apartmentScene.ceilingHeight + 0.02 }).toEqual({
        id: asset.id,
        throughCeiling: false,
      });
    }
    loader.dispose();
  });

  test('an unresolvable placement degrades to a placeholder instead of vanishing', () => {
    const loader = new AssetLoader([], {});
    const result = loader.load({ id: PLACEMENT.ghost, type: 'flying-carpet', position: origin });
    expect(result.degraded).toBe(true);
    expect(result.group.userData['assetId']).toBe(PLACEMENT.ghost);
    expect(result.group.children.length).toBeGreaterThan(0);
    loader.dispose();
  });
});

/* ------------------------------------------------------ a baked project --- */

const FIXTURE_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project');
const PROJECT_BASE = 'https://example.com/w1/fixture/1/';

function fixtureManifest(): BakedProjectManifest {
  return parseProjectManifest(JSON.parse(readFileSync(join(FIXTURE_DIR, 'project.json'), 'utf8')) as unknown);
}

/** The placement the fixture scene holds, as the loader receives it. */
const SOFA: DemoAsset = {
  id: PROJECT_FIXTURE.placement.sofa,
  type: PROJECT_FIXTURE.asset.boxSofa,
  asset: formatAssetRef(PROJECT_FIXTURE.projectId, PROJECT_FIXTURE.asset.boxSofa),
  variant: PROJECT_FIXTURE.variant.boxSofa,
  room: PROJECT_FIXTURE.room.living,
  position: { x: 2, y: 0, z: 4.2 },
  rotationY: 0,
};

/** A loader wired to the fixture bake, with the model transport recorded. */
function projectLoader(): { loader: AssetLoader; urls: string[]; manifest: BakedProjectManifest } {
  const manifest = fixtureManifest();
  const bank = projectBank(manifest, PROJECT_BASE);
  const urls: string[] = [];
  const modelSource = (request: ModelRequest): Promise<ModelOutcome> => {
    urls.push(request.url);
    return Promise.resolve({ group: new THREE.Group(), triangles: 0, warnings: [], bytes: 0 });
  };
  const loader = new AssetLoader([], {
    defaultLibrary: manifest.library.id,
    ceilingHeight: 2.7,
    catalogue: bank.catalogue,
    resolveFinish: bank.resolveFinish,
    projectMaterials: manifest.library.materials,
    modelUrl: (asset) => bank.modelUrl(asset),
    modelSource,
  });
  return { loader, urls, manifest };
}

describe('a project object, which has no builder', () => {
  test('resolves against the project library rather than the shipped one', () => {
    const { loader, manifest } = projectLoader();
    const asset = loader.resolve(SOFA);
    expect(asset?.archetypeId).toBe(PROJECT_FIXTURE.asset.boxSofa);
    expect(asset?.library).toBe(PROJECT_FIXTURE.projectId);
    expect(asset?.builder).toBeUndefined();
    expect(asset?.dims).toEqual(manifest.library.objects[0]!.dims);
    loader.dispose();
  });

  test("keeps the project's own finish ids on its slots", () => {
    const { loader } = projectLoader();
    // `resolveFinishId` would have dropped both: neither id is in the bundled
    // bank, and a dropped slot is an untextured sofa.
    expect(loader.resolve(SOFA)?.finishes).toEqual({
      frame: PROJECT_FIXTURE.material.oak,
      upholstery: PROJECT_FIXTURE.material.white,
    });
    loader.dispose();
  });

  test('shows a `dims` stand-in on the first frame, and is NOT counted as degraded', () => {
    const { loader, manifest } = projectLoader();
    const result = loader.load(SOFA);
    // Not a defect: a bake has no procedural body by design, so the notice
    // `BuildResult.degradedAssets` raises must stay down.
    expect(result.degraded).toBe(false);
    expect(result.group.userData['degraded']).toBe(PENDING_MODEL);
    expect(result.group.userData['assetId']).toBe(PROJECT_FIXTURE.placement.sofa);
    // The same group contract a built body gets, so `upgradeModels` finds it.
    expect(result.group.userData['modelState']).toBe('procedural');
    expect(result.group.name).toBe(PROJECT_FIXTURE.placement.sofa);

    const [width, height, depth] = manifest.library.objects[0]!.dims;
    const box = new THREE.Box3().setFromObject(result.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(width, 3);
    expect(size.y).toBeCloseTo(height, 3);
    expect(size.z).toBeCloseTo(depth, 3);
    // Standing on the floor at the placement, not floating at the origin.
    expect(box.min.y).toBeCloseTo(0, 3);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(SOFA.position.x, 3);
    loader.dispose();
  });

  test('fetches its GLB from the manifest folder', async () => {
    const { loader, urls } = projectLoader();
    const upgrade = await loader.upgrade(SOFA, new AbortController().signal);
    expect(urls).toEqual([`${PROJECT_BASE}obj/box-sofa@1.0.0.glb`]);
    expect(upgrade).toBeTruthy();
    loader.dispose();
  });

  test('a placement naming a library the project is not still degrades', () => {
    const { loader } = projectLoader();
    const result = loader.load({ ...SOFA, id: PLACEMENT.ghost, asset: `catalogue:jeex:${ARCHETYPE.sofa_3s}` });
    expect(result.degraded).toBe(true);
    expect(result.group.userData['degraded']).toBe('unknown-library');
    loader.dispose();
  });
});
