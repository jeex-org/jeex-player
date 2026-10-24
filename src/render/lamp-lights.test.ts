import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { projectBank } from '../assets/project-catalogue.js';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import { modelFrameBox } from '../fixtures/hanging-pendant.js';
import { FURNITURE_GROUP_NAME, SceneBuilder } from '../geometry/scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { draftOf, type Draft } from '../shared/committed.js';
import type { SceneData } from '../scene/types.js';
import { LAMP_PROJECT_FIXTURE as LAMPS } from '../../tests/fixtures/project/fixture-ids.js';
import { collectLampLights } from './lamp-lights.js';
import { tintArtificialLights } from './light-temperature.js';

const DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project-lamps');
const BANK_LAMP = '01a16c46-c3ca-70cf-8408-271b40589a58';

type Editable = { library: { objects: Array<{ variants: Array<Record<string, unknown>> }> } };

/** The lamp fixture through a real builder; every GLB is a box of the variant's dims in the model frame. */
function lampScene(options: { edit?: (manifest: Editable) => void; place?: (scene: Draft<SceneData>) => void } = {}) {
  const raw = JSON.parse(readFileSync(join(DIR, 'project.json'), 'utf8')) as Editable;
  options.edit?.(raw);
  const manifest = parseProjectManifest(raw);
  const scene = draftOf(JSON.parse(readFileSync(join(DIR, 'scene.json'), 'utf8')) as SceneData);
  options.place?.(scene);
  const bank = projectBank(manifest, 'https://lamps.test/bake/');
  const builder = new SceneBuilder(scene, solvePlan(scene), {
    catalogue: bank.catalogue,
    catalogueLibrary: bank.defaultLibrary,
    resolveFinish: bank.resolveFinish,
    projectMaterials: manifest.library.materials,
    modelUrl: (asset) => bank.modelUrl(asset),
    modelSource: (request) => Promise.resolve({ group: modelFrameBox(request.dims), triangles: 12, warnings: [], bytes: 0 }),
  });
  const { root } = builder.build();
  return { builder, root };
}

const linear = (hex: string): readonly [number, number, number] => new THREE.Color(hex).toArray() as [number, number, number];

describe('collectLampLights', () => {
  test('two lamps, in placement order, with the units and world positions of their facts', () => {
    const { builder, root } = lampScene();
    const entries = collectLampLights(root);
    expect(
      entries.map((entry) => ({
        ...entry,
        intensity: Number(entry.intensity.toFixed(9)),
        position: entry.position.map((v) => Number(v.toFixed(6))),
      })),
    ).toEqual([
      {
        placementId: LAMPS.placement.tableLamp,
        index: 0,
        position: [1, 0.443, 1],
        colour: linear('#ffd9a4'),
        lumens: 400,
        intensity: 1.2,
        decay: 2,
        cutoff: 3,
        shadow: false,
      },
      {
        placementId: LAMPS.placement.pendant,
        index: 0,
        // The pendant hangs from the 2.65 m ceiling; its bulb is 0.989 m under it.
        position: [2.5, 1.661, 2],
        colour: linear('#ffd9a4'),
        lumens: 600,
        intensity: 1.8,
        decay: 2,
        cutoff: 5.2,
        shadow: false,
      },
    ]);
    builder.dispose();
  });

  test('a light temperature does not reach the collected colour', () => {
    const { builder, root } = lampScene();
    tintArtificialLights(root, 2700);
    expect(collectLampLights(root).map((entry) => entry.colour)).toEqual([linear('#ffd9a4'), linear('#ffd9a4')]);
    builder.dispose();
  });

  test('bank bulbs are skipped: only fact lights are collected', () => {
    const { builder, root } = lampScene({
      place: (scene) => {
        scene.assets.push({ id: BANK_LAMP, type: 'lamp', position: { x: 3.5, y: 0, z: 3 }, rotationY: 0 });
      },
    });
    let bulbs = 0;
    root.traverse((child) => {
      if ((child as THREE.PointLight).isPointLight) bulbs += 1;
    });
    expect(bulbs).toBe(3);
    expect(collectLampLights(root).map((entry) => entry.placementId)).toEqual([LAMPS.placement.tableLamp, LAMPS.placement.pendant]);
    builder.dispose();
  });

  test('after the GLB upgrade the entries are the same, positions within 1e-6', async () => {
    const { builder, root } = lampScene();
    const before = collectLampLights(root);
    const pass = await builder.upgradeModels(new AbortController().signal);
    expect(pass.upgraded).toBe(2);
    const after = collectLampLights(root);
    expect(after.map(({ position: _p, ...rest }) => rest)).toEqual(before.map(({ position: _p, ...rest }) => rest));
    after.forEach((entry, i) => {
      for (const axis of [0, 1, 2]) expect(Math.abs(entry.position[axis]! - before[i]!.position[axis]!)).toBeLessThan(1e-6);
    });
    builder.dispose();
  });

  test('a placement mirrored on x gives the mirrored world position', () => {
    const { builder, root } = lampScene({
      edit: (manifest) => {
        manifest.library.objects[0]!.variants[0]!['lights'] = [
          { kind: 'point', position: [0.2, 0.443, 0], colour: '#ffd9a4', lumens: 400, cutoff: 3 },
        ];
      },
      place: (scene) => {
        scene.assets.find((asset) => asset.id === LAMPS.placement.tableLamp)!.mirror = { x: true };
      },
    });
    expect(collectLampLights(root)[0]!.position[0]).toBeCloseTo(1 - 0.2, 6);
    builder.dispose();
  });

  test("indexes follow the variant's lights within a placement", () => {
    const bulb = { kind: 'point', position: [0, 0.443, 0], colour: '#ffd9a4', lumens: 400, cutoff: 3 };
    const { builder, root } = lampScene({
      edit: (manifest) => {
        manifest.library.objects[0]!.variants[0]!['lights'] = [bulb, { ...bulb, lumens: 200, shadow: true }];
      },
    });
    const table = collectLampLights(root).filter((entry) => entry.placementId === LAMPS.placement.tableLamp);
    expect(table.map((entry) => ({ index: entry.index, lumens: entry.lumens, shadow: entry.shadow }))).toEqual([
      { index: 0, lumens: 400, shadow: false },
      { index: 1, lumens: 200, shadow: true },
    ]);
    expect(root.getObjectByName(FURNITURE_GROUP_NAME)).toBeDefined();
    builder.dispose();
  });

  test('forged tags are skipped: only a point light whose tag fields have the right types', () => {
    const { builder, root } = lampScene();
    const fact = { source: 'fact', placementId: LAMPS.placement.tableLamp, index: 0, lumens: 400, cutoff: 3, shadow: false };
    // A GLB's node extras land in userData unfiltered, so a plain node can carry both tags.
    const forged = new THREE.Object3D();
    forged.userData = { assetId: 'forged', lampLight: fact, artificialLight: { colour: [1, 1, 1] } };
    root.add(forged);
    const badFields: Array<Record<string, unknown>> = [
      { lumens: '400' },
      { lumens: Number.POSITIVE_INFINITY },
      { cutoff: Number.NaN },
      { index: 0.5 },
      { shadow: 'yes' },
      { placementId: 7 },
    ];
    for (const bad of badFields) {
      const light = new THREE.PointLight();
      light.userData = { assetId: 'forged', lampLight: { ...fact, ...bad }, artificialLight: { colour: [1, 1, 1] } };
      root.add(light);
    }
    const badColour = new THREE.PointLight();
    badColour.userData = { assetId: 'forged', lampLight: fact, artificialLight: { colour: ['1', 1, 1] } };
    root.add(badColour);
    expect(collectLampLights(root).map((entry) => entry.placementId)).toEqual([LAMPS.placement.tableLamp, LAMPS.placement.pendant]);
    builder.dispose();
  });
});
