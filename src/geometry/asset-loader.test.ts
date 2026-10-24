import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { AssetLoader, PENDING_MODEL } from './asset-loader.js';
import { listCatalogueObjects } from '../assets/asset-catalogue.js';
import { ARCHETYPE, VARIANT } from '../assets/catalogue-ids.js';
import { projectBank } from '../assets/project-catalogue.js';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import type { BakedProjectManifest } from '../assets/project-manifest.js';
import { apartmentScene } from '../demo/scene-data.js';
import type { DemoAsset } from '../scene/types.js';
import type { ModelOutcome, ModelRequest } from './model-source.js';
import { PROJECT_FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';
import { HANGING, hangingManifest, modelFrameBox } from '../fixtures/hanging-pendant.js';
import { LAMP_PROJECT_FIXTURE as LAMPS } from '../../tests/fixtures/project/fixture-ids.js';
import { ARTIFICIAL_LIGHT_KEY, isArtificialLight } from '../assets/artificial-light.js';

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
    // The built-in bank has no UUID, and its vocabulary id never leaves the player.
    expect('assetLibrary' in group.userData).toBe(false);
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

/** A library UUID no bank declares. */
const OTHER_LIBRARY = '01a12fed-dda2-7f13-a6c4-0d58b2e9c731';

/** The placement the fixture scene holds, as the loader receives it. */
const SOFA: DemoAsset = {
  id: PROJECT_FIXTURE.placement.sofa,
  type: PROJECT_FIXTURE.asset.boxSofa,
  asset: PROJECT_FIXTURE.asset.boxSofa,
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

  test('tags the placement with the library UUID the document names for it', () => {
    const { loader } = projectLoader();
    expect(loader.load(SOFA).group.userData['assetLibrary']).toBe(PROJECT_FIXTURE.projectId);
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
    const result = loader.load({ ...SOFA, id: PLACEMENT.ghost, asset: ARCHETYPE.sofa_3s, library: OTHER_LIBRARY });
    expect(result.degraded).toBe(true);
    expect(result.group.userData['degraded']).toBe('unknown-library');
    loader.dispose();
  });
});

/* ------------------------------------------- ceiling bodies hang (1.052 m pendant) --- */

function hangingLoader(): AssetLoader {
  const manifest = hangingManifest();
  const bank = projectBank(manifest, PROJECT_BASE);
  return new AssetLoader([], {
    defaultLibrary: manifest.library.id,
    ceilingHeight: HANGING.ceiling,
    catalogue: bank.catalogue,
    resolveFinish: bank.resolveFinish,
    modelUrl: (asset) => bank.modelUrl(asset),
    modelSource: () => Promise.resolve({ group: modelFrameBox(HANGING.dims), triangles: 12, warnings: [], bytes: 0 }),
  });
}

const HANGING_PLACEMENT: DemoAsset = {
  id: HANGING.placement,
  type: HANGING.archetype,
  asset: HANGING.archetype,
  variant: HANGING.variant,
  position: { x: 5.5, y: 0, z: 7.06 },
};

function worldBox(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

describe('a ceiling body no builder made hangs from the ceiling plane', () => {
  test('the stand-in box has its top at the ceiling and hangs its own height down', () => {
    const loader = hangingLoader();
    const { group } = loader.load(HANGING_PLACEMENT);
    expect(group.position.y).toBe(HANGING.ceiling);
    const box = worldBox(group);
    expect(box.max.y).toBeCloseTo(HANGING.ceiling, 3);
    expect(box.min.y).toBeCloseTo(HANGING.ceiling - HANGING.dims[1], 3);
    loader.dispose();
  });

  test('the GLB body lands in the same world box as its stand-in, not 2.65 to 3.70 m', async () => {
    const loader = hangingLoader();
    const { group } = loader.load(HANGING_PLACEMENT);
    const standIn = worldBox(group);
    const upgrade = await loader.upgrade(HANGING_PLACEMENT, new AbortController().signal);
    if (!upgrade) throw new Error('the pendant should have a model');
    for (const child of [...group.children]) child.removeFromParent();
    group.add(upgrade.body);
    const glb = worldBox(group);
    expect(glb.max.y).toBeCloseTo(HANGING.ceiling, 3);
    expect(glb.min.y).toBeCloseTo(1.598, 3);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(glb.min[axis]).toBeCloseTo(standIn.min[axis], 3);
      expect(glb.max[axis]).toBeCloseTo(standIn.max[axis], 3);
    }
    loader.dispose();
  });

  test('a bank pendant, which its builder draws hanging, keeps its body and world box exactly', () => {
    const loader = new AssetLoader([], { ceilingHeight: HANGING.ceiling });
    const { group } = loader.load({ id: PLACEMENT.pendant, type: 'pendant', position: { x: 1, y: 0, z: 2 } });
    const body = group.children[0]!;
    expect(body.position.toArray()).toEqual([0, 0, 0]);
    const box = worldBox(group);
    // Measured on the builder before non-builder bodies were offset.
    expect(box.min.toArray().map((value) => Number(value.toFixed(6)))).toEqual([0.82, 1.59784, 1.82]);
    expect(box.max.toArray().map((value) => Number(value.toFixed(6)))).toEqual([1.18, 2.65, 2.18]);
    loader.dispose();
  });
});

/* ---------------------------------------------------------- lamp lights --- */

const LAMP_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project-lamps');

type Editable = { library: { objects: Array<{ variants: Array<Record<string, unknown>> }> } };

/** The lamp fixture's manifest, with an optional edit, parsed the way a mount parses it. */
function lampManifest(edit?: (manifest: Editable) => void): BakedProjectManifest {
  const raw = JSON.parse(readFileSync(join(LAMP_DIR, 'project.json'), 'utf8')) as Editable;
  edit?.(raw);
  return parseProjectManifest(raw);
}

function lampLoader(edit?: (manifest: Editable) => void): AssetLoader {
  const manifest = lampManifest(edit);
  const bank = projectBank(manifest, PROJECT_BASE);
  return new AssetLoader([], {
    defaultLibrary: manifest.library.id,
    ceilingHeight: 2.65,
    catalogue: bank.catalogue,
    resolveFinish: bank.resolveFinish,
    projectMaterials: manifest.library.materials,
    modelUrl: (asset) => bank.modelUrl(asset),
    modelSource: () => Promise.resolve({ group: modelFrameBox([0.3, 0.52, 0.3]), triangles: 12, warnings: [], bytes: 0 }),
  });
}

const TABLE_LAMP: DemoAsset = {
  id: LAMPS.placement.tableLamp,
  type: LAMPS.asset.tableLamp,
  asset: LAMPS.asset.tableLamp,
  variant: LAMPS.variant.tableLamp,
  position: { x: 1, y: 0, z: 1 },
  rotationY: 0,
};

const PENDANT: DemoAsset = {
  id: LAMPS.placement.pendant,
  type: LAMPS.asset.pendant,
  asset: LAMPS.asset.pendant,
  variant: LAMPS.variant.pendant,
  position: { x: 2.5, y: 0, z: 2 },
  rotationY: 0,
};

function lightsUnder(root: THREE.Object3D): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];
  root.traverse((child) => {
    if ((child as THREE.PointLight).isPointLight) lights.push(child as THREE.PointLight);
  });
  return lights;
}

/** The first table-lamp variant's `lights`, replaced. */
const withTableLights =
  (lights: readonly Record<string, unknown>[]) =>
  (manifest: Editable): void => {
    manifest.library.objects[0]!.variants[0]!['lights'] = lights;
  };

const BULB = { kind: 'point', position: [0, 0.443, 0], colour: '#ffd9a4', lumens: 400, cutoff: 3 } as const;

describe('lamp lights are built on the first body', () => {
  test('the stand-in of the table lamp holds exactly one tagged PointLight with the authored values', () => {
    const loader = lampLoader();
    const { group } = loader.load(TABLE_LAMP);
    const body = group.children[0]!;
    const lights = lightsUnder(group);
    expect(lights).toHaveLength(1);
    const light = lights[0]!;
    // A child of the BODY, never of the placement group.
    expect(light.parent).toBe(body);
    expect(light.name).toBe(`${LAMPS.placement.tableLamp}-light`);
    expect(isArtificialLight(light)).toBe(true);
    expect(light.intensity).toBeCloseTo(1.2, 9);
    expect(light.distance).toBe(3);
    expect(light.decay).toBe(2);
    expect(light.position.toArray()).toEqual([0, 0.443, 0]);
    const authored = new THREE.Color('#ffd9a4');
    expect(light.color.toArray()).toEqual(authored.toArray());
    expect(light.userData[ARTIFICIAL_LIGHT_KEY]).toEqual({ colour: authored.toArray() });
    loader.dispose();
  });

  test('a variant without lights gets no light', () => {
    const { loader } = projectLoader();
    expect(lightsUnder(loader.load(SOFA).group)).toEqual([]);
    loader.dispose();
  });

  test('three lights are named in array order, the first without a number', () => {
    const loader = lampLoader(withTableLights([BULB, { ...BULB, position: [0.1, 0.4, 0] }, { ...BULB, position: [-0.1, 0.4, 0] }]));
    const names = lightsUnder(loader.load(TABLE_LAMP).group).map((light) => light.name);
    const id = LAMPS.placement.tableLamp;
    expect(names).toEqual([`${id}-light`, `${id}-light-2`, `${id}-light-3`]);
    loader.dispose();
  });

  test('every fact light carries its source tag; the pendant reads index 0, 600 lm, cutoff 5.2, no shadow', () => {
    const loader = lampLoader();
    const [light] = lightsUnder(loader.load(PENDANT).group);
    expect(light!.userData['lampLight']).toEqual({
      source: 'fact',
      placementId: LAMPS.placement.pendant,
      index: 0,
      lumens: 600,
      cutoff: 5.2,
      shadow: false,
    });
    expect(light!.intensity).toBeCloseTo(1.8, 9);
    loader.dispose();
  });

  test('a shadow hint is carried on the light and never cast in this release', () => {
    const loader = lampLoader(withTableLights([{ ...BULB, shadow: true }]));
    const [light] = lightsUnder(loader.load(TABLE_LAMP).group);
    expect(light!.castShadow).toBe(false);
    expect((light!.userData['lampLight'] as { shadow: boolean }).shadow).toBe(true);
    loader.dispose();
  });

  test('a mirrored placement mirrors its light with the body', () => {
    const loader = lampLoader(withTableLights([{ ...BULB, position: [0.2, 0.443, 0] }]));
    const plain = loader.load(TABLE_LAMP).group;
    const mirrored = loader.load({ ...TABLE_LAMP, mirror: { x: true } }).group;
    const inGroup = (group: THREE.Group): THREE.Vector3 => {
      group.updateMatrixWorld(true);
      return group.worldToLocal(lightsUnder(group)[0]!.getWorldPosition(new THREE.Vector3()));
    };
    expect(inGroup(plain).x).toBeCloseTo(0.2, 6);
    expect(inGroup(mirrored).x).toBeCloseTo(-0.2, 6);
    expect(inGroup(mirrored).y).toBeCloseTo(0.443, 6);
    loader.dispose();
  });

  test('a ceiling lamp hangs its light with its body: the pendant bulb sits 0.989 m under the ceiling', () => {
    const loader = lampLoader();
    const { group } = loader.load(PENDANT);
    group.updateMatrixWorld(true);
    expect(lightsUnder(group)[0]!.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(2.65 - 0.989, 6);
    loader.dispose();
  });
});

describe('no light without a fact', () => {
  test('a bank lamp keeps exactly its builder bulb, which carries no fact tag', () => {
    const loader = new AssetLoader([], {});
    const lights = lightsUnder(loader.load({ id: PLACEMENT.probe, type: 'lamp', position: origin }).group);
    expect(lights).toHaveLength(1);
    expect(lights[0]!.userData['lampLight']).toBeUndefined();
    expect(isArtificialLight(lights[0]!)).toBe(true);
    loader.dispose();
  });

  test('a lit variant that falls back to the failure placeholder holds no light', () => {
    const loader = lampLoader();
    const result = loader.load({ ...TABLE_LAMP, id: PLACEMENT.ghost, library: OTHER_LIBRARY });
    expect(result.degraded).toBe(true);
    expect(lightsUnder(result.group)).toEqual([]);
    loader.dispose();
  });
});
