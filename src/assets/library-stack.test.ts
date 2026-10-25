/**
 * The layered bank: the project library first, then offers, then the bundled
 * bank — for the resolver, the model and preview URLs, the materials, the
 * validator, a host's own validation and the light bake.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { libraryStack } from './library-stack.js';
import { isResolved, resolveAsset } from './asset-resolver.js';
import { ARCHETYPE } from './catalogue-ids.js';
import { CATALOGUE_REGISTRIES } from './catalogue-registries.js';
import { libraryOf, type ProjectLibraryManifest } from './project-manifest.js';
import { parseProjectLibrary, parseProjectManifest } from './project-manifest.schema.js';
import { variantsForPlacement } from './asset-variants.js';
import { bakeLights } from '../lightmap/bake-lights.js';
import { registriesFromLibrary } from '../scene/registries.js';
import { SceneModel } from '../scene/scene-model.js';
import { validateScene } from '../scene/scene-validator.js';
import type { DemoAsset, SceneData } from '../scene/types.js';
import { OFFERS_FIXTURE as OFFERS } from '../../tests/fixtures/offers/fixture-ids.js';
import { PROJECT_FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';

const OFFERS_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'offers');
const PROJECT_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project');
const read = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;

const OFFERS_BASE = 'https://cdn.example.com/catalogue/v3/';
const PROJECT_BASE = 'https://example.com/w1/fixture/1/';
const offers = (): ProjectLibraryManifest => parseProjectLibrary(read(OFFERS_DIR, 'library.json'));
const project = (): ProjectLibraryManifest => parseProjectManifest(read(PROJECT_DIR, 'project.json')).library;
const offersScene = (): SceneData => read(OFFERS_DIR, 'scene.json') as SceneData;

function placementOf(scene: SceneData, id: string): DemoAsset {
  const found = scene.assets.find((asset) => asset.id === id);
  if (!found) throw new Error(`no placement ${id}`);
  return found;
}

describe('libraryStack', () => {
  const stack = libraryStack({ library: project(), baseUrl: PROJECT_BASE }, { library: offers(), baseUrl: OFFERS_BASE });

  test('answers the project first, then offers, then the bundled bank', () => {
    expect(stack.catalogue(PROJECT_FIXTURE.asset.boxSofa)?.object.id).toBe(PROJECT_FIXTURE.asset.boxSofa);
    expect(stack.catalogue(OFFERS.asset.longSofa)?.object.id).toBe(OFFERS.asset.longSofa);
    expect(stack.catalogue(ARCHETYPE.armchair)?.object.id).toBe(ARCHETYPE.armchair);
    expect(stack.libraries).toEqual([PROJECT_FIXTURE.projectId, OFFERS.library]);
  });

  test('the resolver accepts an offers placement and its model comes from the offers folder', () => {
    const sofa = placementOf(offersScene(), OFFERS.placement.sofa);
    const result = resolveAsset(sofa, {
      catalogue: stack.catalogue,
      catalogueLibraries: stack.libraries,
      resolveFinish: stack.resolveFinish,
    });
    if (!isResolved(result)) throw new Error(JSON.stringify(result.failure));
    expect(result.asset.library).toBe(OFFERS.library);
    expect(stack.modelUrl(result.asset)).toBe(`${OFFERS_BASE}obj/box-sofa.glb`);
    // A project object still loads from the project folder.
    expect(stack.modelUrl({ archetypeId: PROJECT_FIXTURE.asset.boxSofa, model: 'obj/box-sofa@1.0.0.glb' })).toBe(
      `${PROJECT_BASE}obj/box-sofa@1.0.0.glb`,
    );
  });

  test('an offers asset keeps its own material', () => {
    const sofa = placementOf(offersScene(), OFFERS.placement.sofa);
    const result = resolveAsset(sofa, {
      catalogue: stack.catalogue,
      catalogueLibraries: stack.libraries,
      resolveFinish: stack.resolveFinish,
    });
    if (!isResolved(result)) throw new Error(JSON.stringify(result.failure));
    expect(result.asset.finishes['frame']).toBe(OFFERS.material.walnut);
    expect(stack.materials.map((material) => material.id)).toContain(OFFERS.material.walnut);
  });

  test('previews of offers resolve against the offers folder', () => {
    const library = offers();
    const [sofa] = library.objects;
    const withPreview = {
      ...library,
      objects: [{ ...sofa!, variants: sofa!.variants.map((v) => ({ ...v, preview: 'previews/a.webp' })) }],
    };
    const layered = libraryStack(null, { library: withPreview, baseUrl: OFFERS_BASE });
    const variants = variantsForPlacement(placementOf(offersScene(), OFFERS.placement.sofa), layered.variants);
    expect(variants).toHaveLength(20);
    expect(variants[0]?.preview).toBe(`${OFFERS_BASE}previews/a.webp`);
  });

  test('the validator accepts a scene naming offers, a bare scene included', () => {
    const bare = libraryStack(null, { library: offers(), baseUrl: OFFERS_BASE });
    expect(() => SceneModel.load(offersScene(), bare.registries)).not.toThrow();
    expect(() => validateScene(offersScene(), CATALOGUE_REGISTRIES)).toThrow(OFFERS.library);
  });

  test('a host validates the same way with parseProjectLibrary and libraryOf', () => {
    const registries = registriesFromLibrary(libraryOf(parseProjectLibrary(read(OFFERS_DIR, 'library.json'))), CATALOGUE_REGISTRIES);
    expect(() => validateScene(offersScene(), registries)).not.toThrow();
  });

  test('the light bake takes the stack and finds an offers lamp', () => {
    const bare = libraryStack(null, { library: offers(), baseUrl: OFFERS_BASE });
    const scene = offersScene();
    const lamp = { ...placementOf(scene, OFFERS.placement.vase), type: OFFERS.asset.tableLamp, asset: OFFERS.asset.tableLamp };
    const lit: SceneData = { ...scene, assets: scene.assets.map((asset) => (asset.id === lamp.id ? lamp : asset)) };
    expect(bakeLights(lit, bare).lamps.some((entry) => entry.id === OFFERS.placement.vase)).toBe(true);
  });
});
