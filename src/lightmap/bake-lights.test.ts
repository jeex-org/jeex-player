/**
 * The lights a bake takes, against the live scene they replace: the sun and
 * the sky of the player's own apartment rig (real three.js lights from
 * `createLightingContext`, with a stub renderer: Bun has no WebGL) aimed by
 * the player's own sun-shadow preparation, and the lamps of the scene built
 * by the player's own `SceneBuilder`. No number is retyped here: every
 * expected value is read off a live object.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { projectBank } from '../assets/project-catalogue.js';
import { projectLibraryOf } from '../assets/project-manifest.js';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import { apartmentScene } from '../demo/scene-data.js';
import { registriesFromLibrary } from '../scene/registries.js';
import { validateScene } from '../scene/scene-validator.js';
import { SceneBuilder } from '../geometry/scene-builder.js';
import { createGltfModelSource } from '../geometry/model-source.js';
import { LAMP_PROJECT_FIXTURE as LAMPS } from '../../tests/fixtures/project/fixture-ids.js';
import { createLightingContext } from '../lighting/lighting-context.js';
import type { LightingRenderer, LightingThree } from '../lighting/lighting-three.js';
import { solvePlan } from '../plan/plan-solver.js';
import { prepareSunShadow } from '../render/sun-shadow.js';
import type { SceneData } from '../scene/types.js';
import type { CollectedLampLight } from '../render/lamp-lights.js';
import { bakeLights, SHIPPED_BANK, type BakeBank } from './bake-lights.js';
import { judgeBakeLights, type BakeLights } from './bake-lights.schema.js';

/** The namespace the lighting standard builds with; PMREM answers a plain target. */
const STUB_THREE = {
  ...THREE,
  PMREMGenerator: class {
    fromEquirectangular(): THREE.WebGLRenderTarget {
      return new THREE.WebGLRenderTarget(4, 4);
    }
    dispose(): void {}
  },
} as unknown as LightingThree;

const STUB_RENDERER = {
  capabilities: { maxTextureSize: 4096 },
  shadowMap: { enabled: false, type: THREE.BasicShadowMap },
} as unknown as LightingRenderer;

type Live = { root: THREE.Group; sun: THREE.DirectionalLight; sky: THREE.HemisphereLight };

/** The scene as the player shows it: built, lit by the apartment rig, the sun aimed for its site. */
function live(scene: SceneData): Live {
  const plan = solvePlan(scene);
  const builder = new SceneBuilder(scene, plan);
  const root = builder.build().root;
  const stage = new THREE.Scene();
  stage.add(root);
  const rig = createLightingContext(STUB_THREE, STUB_RENDERER).createApartmentRig();
  rig.attach(stage);
  prepareSunShadow(root, scene, plan, rig);
  stage.updateMatrixWorld(true);
  const sun = stage.getObjectByName('jeex-lighting-sun') as THREE.DirectionalLight;
  const sky = stage.getObjectByName('jeex-lighting-sky') as THREE.HemisphereLight;
  return { root, sun, sky };
}

const rgb = (colour: THREE.Color, scale = 1): number[] => [colour.r * scale, colour.g * scale, colour.b * scale];

function expectClose(actual: readonly number[], expected: readonly number[], digits = 9): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
}

const SITED: SceneData = { ...apartmentScene, site: { northDeg: 30, sun: 'morning' } };
const demo = live(apartmentScene);
const lights = bakeLights(apartmentScene, SHIPPED_BANK);

describe('bakeLights', () => {
  test('answers a document the schema accepts', () => {
    const verdict = judgeBakeLights(lights);
    expect(verdict.ok ? 'ok' : verdict.message).toBe('ok');
  });

  test('the sun travels the way the live rig aims it, for a scene without a site and with one', () => {
    for (const [scene, view] of [
      [apartmentScene, demo],
      [SITED, live(SITED)],
    ] as const) {
      const travel = view.sun.target.getWorldPosition(new THREE.Vector3()).sub(view.sun.getWorldPosition(new THREE.Vector3())).normalize();
      expectClose(bakeLights(scene, SHIPPED_BANK).sun.direction, travel.toArray());
    }
    expect(bakeLights(SITED, SHIPPED_BANK).sun.direction).not.toEqual(lights.sun.direction);
  });

  test('the sun has the live sun light’s colour and irradiance, with no interior factor', () => {
    expectClose(lights.sun.color, rgb(demo.sun.color));
    expect(lights.sun.strength).toBe(demo.sun.intensity);
  });

  test('an open up-facing plane under the sky receives the live hemisphere’s irradiance', () => {
    expectClose(
      lights.sky.upper.map((l) => Math.PI * l),
      rgb(demo.sky.color, demo.sky.intensity),
    );
    expectClose(
      lights.sky.lower.map((l) => Math.PI * l),
      rgb(demo.sky.groundColor, demo.sky.intensity),
    );
  });

  test('the live hemisphere light points straight up, the axis the sky splits at', () => {
    expectClose(demo.sky.getWorldPosition(new THREE.Vector3()).normalize().toArray(), [0, 1, 0]);
  });

  test('the sky split at the horizon gives the live hemisphere’s irradiance for every normal', () => {
    // E(n) = ∫ L(ω) max(0, n·ω) dω over the sphere, by midpoint quadrature; three's
    // hemisphere gives mix(ground, sky, (1 + n·up) / 2).
    const steps = 400;
    for (const tilt of [0, 40, 90, 130, 180]) {
      const t = (tilt * Math.PI) / 180;
      const normal = [Math.sin(t), Math.cos(t), 0] as const;
      const irradiance = [0, 0, 0];
      for (let i = 0; i < steps; i++) {
        const theta = ((i + 0.5) / steps) * Math.PI;
        for (let j = 0; j < steps * 2; j++) {
          const phi = ((j + 0.5) / (steps * 2)) * 2 * Math.PI;
          const w = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
          const cos = normal[0] * w[0]! + normal[1] * w[1]!;
          if (cos <= 0) continue;
          const radiance = w[1]! > 0 ? lights.sky.upper : lights.sky.lower;
          const solid = Math.sin(theta) * (Math.PI / steps) * (Math.PI / steps);
          for (let c = 0; c < 3; c++) irradiance[c]! += radiance[c]! * cos * solid;
        }
      }
      const weight = 0.5 * Math.cos(t) + 0.5;
      const expected = rgb(demo.sky.groundColor.clone().lerp(demo.sky.color, weight), demo.sky.intensity);
      irradiance.forEach((value, c) => expect(Math.abs(value - expected[c]!)).toBeLessThanOrEqual(1e-3 * expected[c]!));
    }
  });

  test('never lists a bank builder’s bulb: those stay live on a baked shell', () => {
    const bulbs: number[][] = [];
    demo.root.traverse((object) => {
      if ((object as THREE.Light).isLight) bulbs.push(object.getWorldPosition(new THREE.Vector3()).toArray());
    });
    expect(bulbs.length).toBeGreaterThan(0);
    expect(lights.lamps).toEqual([]);
    for (const lamp of lights.lamps) expect(bulbs).not.toContainEqual([...lamp.position]);
  });

  test('takes its lamps from the lamp-lights collector, on the scene built as the live view builds it, mapped field by field', () => {
    const lamp = (placementId: string, index: number, intensity: number): CollectedLampLight => ({
      placementId,
      index,
      position: [1 + index, 2.5, -3],
      colour: [1, 0.69, 0.37],
      lumens: 800,
      intensity,
      decay: 2,
      cutoff: 6,
      shadow: false,
    });
    const placement = apartmentScene.assets[0]!.id;
    const other = apartmentScene.assets[1]!.id;
    const seen: THREE.Object3D[] = [];
    let world: THREE.Vector3 | undefined;
    const answer = bakeLights(apartmentScene, SHIPPED_BANK, (root) => {
      seen.push(root);
      // World matrices are current when the collector runs: it answers world positions.
      world = new THREE.Vector3().setFromMatrixPosition(root.getObjectByName(placement)!.matrixWorld);
      return [lamp(placement, 0, 1.2), lamp(placement, 1, 3.4), lamp(other, 0, 2)];
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.name).toBe(apartmentScene.id);
    const { x, z } = apartmentScene.assets[0]!.position;
    expect([world!.x, world!.z]).toEqual([x, z]);
    expect(answer.lamps).toEqual([
      { id: placement, index: 0, position: [1, 2.5, -3], color: [1, 0.69, 0.37], intensity: 1.2, power: 4 * Math.PI * 1.2 },
      { id: placement, index: 1, position: [2, 2.5, -3], color: [1, 0.69, 0.37], intensity: 3.4, power: 4 * Math.PI * 3.4 },
      { id: other, index: 0, position: [1, 2.5, -3], color: [1, 0.69, 0.37], intensity: 2, power: 4 * Math.PI * 2 },
    ]);
  });

  test('the bank is a required argument: a call without one is refused, as a type error and at run time', () => {
    // @ts-expect-error -- the caller always names the bank the live view uses.
    expect(() => bakeLights(apartmentScene)).toThrow('bank');
  });

  test('a project bank needs its library too, as the live project view is given it', () => {
    // @ts-expect-error -- a catalogue without its library would refuse the project's placements.
    expect(() => bakeLights(apartmentScene, { catalogue: () => undefined })).toThrow('bank');
  });

  test('a project scene builds the same placements as the live project view', () => {
    const dir = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project');
    const manifest = parseProjectManifest(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as unknown);
    const scene = validateScene(
      JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as unknown,
      registriesFromLibrary(projectLibraryOf(manifest), CATALOGUE_REGISTRIES),
    );
    const bank = projectBank(manifest, 'https://example.com/project/');
    const options = { catalogue: bank.catalogue, catalogueLibrary: bank.defaultLibrary };
    const placements = (root: THREE.Object3D): unknown[] => {
      const found: unknown[] = [];
      root.traverse((object) => {
        if (object.userData['assetId'] !== undefined) found.push([object.userData['assetId'], object.userData['degraded'] ?? null]);
      });
      return found;
    };
    const shown = placements(new SceneBuilder(scene, solvePlan(scene), options).build().root);
    let baked: unknown[] = [];
    bakeLights(scene, options, (root) => {
      baked = placements(root);
      return [];
    });
    expect(shown).toHaveLength(scene.assets.length);
    expect(baked).toEqual(shown);
  });

  test('builds the placements with the bank it is given, as a project view does', () => {
    const lamped = (bank: BakeBank): number => {
      let built = 0;
      bakeLights(apartmentScene, bank, (root) => {
        root.traverse((object) => {
          if (object.userData['assetId'] !== undefined && object.userData['degraded'] === undefined) built += 1;
        });
        return [];
      });
      return built;
    };
    expect(lamped(SHIPPED_BANK)).toBe(apartmentScene.assets.length);
    expect(lamped({ catalogue: () => undefined, catalogueLibrary: apartmentScene.id })).toBe(0);
  });

  test('refuses to answer while three’s colour management is off: the standard’s colours would stay sRGB', () => {
    THREE.ColorManagement.enabled = false;
    try {
      expect(() => bakeLights(apartmentScene, SHIPPED_BANK)).toThrow('colour management');
    } finally {
      THREE.ColorManagement.enabled = true;
    }
  });

  test('two calls give the same document', () => {
    const again: BakeLights = bakeLights(apartmentScene, SHIPPED_BANK);
    expect(again).toEqual(lights);
    expect(JSON.stringify(again)).toBe(JSON.stringify(lights));
  });
});

describe('a ceiling lamp in a bake built without models', () => {
  test('its bulb sits where the live view hangs it, before and after the model whose measured top is dims[1] arrives', async () => {
    const dir = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project-lamps');
    const base = 'https://lamps.test/bake/';
    const manifest = parseProjectManifest(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as unknown);
    const scene = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as SceneData;
    const bank = projectBank(manifest, base);
    const fetch = ((url: string) =>
      Promise.resolve(
        new Response(readFileSync(join(dir, url.slice(base.length))), { status: 200 }),
      )) as unknown as typeof globalThis.fetch;
    const builder = new SceneBuilder(scene, solvePlan(scene), {
      catalogue: bank.catalogue,
      catalogueLibrary: bank.defaultLibrary,
      resolveFinish: bank.resolveFinish,
      projectMaterials: manifest.library.materials,
      modelUrl: (asset) => bank.modelUrl(asset),
      modelSource: createGltfModelSource({ fetch }),
    });
    const root = builder.build().root;
    const pendant = (): { bulb: THREE.Vector3; body: THREE.Object3D } => {
      const group = root.getObjectByName(LAMPS.placement.pendant)!;
      root.updateMatrixWorld(true);
      let light: THREE.PointLight | undefined;
      group.traverse((child) => {
        if ((child as THREE.PointLight).isPointLight) light = child as THREE.PointLight;
      });
      return { bulb: light!.getWorldPosition(new THREE.Vector3()), body: light!.parent! };
    };
    const before = pendant();
    await builder.upgradeModels(new AbortController().signal);
    const after = pendant();
    // The precondition the bake relies on: the arrived model's measured top in its own frame is the catalogue height.
    // (`hangFromCeiling` stands a body at minus its top.)
    const dims = manifest.library.objects.find((object) => object.id === LAMPS.asset.pendant)!.dims;
    expect(after.body).not.toBe(before.body);
    expect(after.body.name).toBe(`${LAMPS.variant.pendant}-gltf`);
    expect(-after.body.position.y).toBeCloseTo(dims[1], 4);
    const baked = bakeLights(scene, { catalogue: bank.catalogue, catalogueLibrary: bank.defaultLibrary });
    const lamp = baked.lamps.find((entry) => entry.id === LAMPS.placement.pendant)!;
    expect(new THREE.Vector3(...lamp.position).distanceTo(before.bulb)).toBeLessThan(1e-6);
    expect(new THREE.Vector3(...lamp.position).distanceTo(after.bulb)).toBeLessThan(1e-6);
    builder.dispose();
  });
});
