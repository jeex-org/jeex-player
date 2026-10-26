import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AssetLoader } from './asset-loader.js';
import { createGltfModelSource } from './model-source.js';
import { projectBank } from '../assets/project-catalogue.js';
import { variantsForPlacement } from '../assets/asset-variants.js';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import type { BakedProjectManifest } from '../assets/project-manifest.js';
import type { DemoAsset } from '../scene/types.js';

/**
 * A library variant drawn from its own GLB renders with the materials the GLB
 * ships, in a project scene whose library declares materials and whose object
 * names them as its finishes, exactly as a library export writes it.
 *
 * The GLB is the committed box-sofa fixture with its two materials rewritten
 * into physical ones (a brushed `metal` and a lacquered `top` behind
 * `KHR_materials_clearcoat`), parsed by the real model source with `fetch`
 * faked, so the real `GLTFLoader` builds the materials the loader must keep.
 */

/** Ids of this file's one-object project. */
const ID = {
  project: '01a16e0a-54e2-720a-af73-f238624f09bc',
  bake: '01a16e0a-54e2-720b-ad06-b2928c44f48a',
  workspace: '01a16e0a-54e2-720c-bc31-23af99ee2651',
  archetype: '01a16e0a-54e2-720d-8550-d84fe86e9ff6',
  variant: '01a16e0a-54e2-720e-94ec-cd5ce463b511',
  brass: '01a16e0a-54e2-720f-8a5e-c74963d2b463',
  oak: '01a16e0a-54e2-7210-b55b-f9eb9633e78f',
  placement: '01a16e0a-54e2-7211-af5c-21f0fe98e32f',
} as const;

const PROJECT_BASE = 'https://example.com/w1/side-table/1/';
const MODEL = 'obj/side-table@1.0.0.glb';

/** What the GLB ships: the values the drawn meshes must still carry. */
const SHIPPED = {
  metal: { metalness: 0.9, roughness: 0.3 },
  top: { metalness: 0, roughness: 0.28, clearcoat: 0.35, clearcoatRoughness: 0.22 },
} as const;

const CHUNK_JSON = 0x4e4f534a;

/** The committed fixture with its materials replaced by `metal` and `top`. */
function physicalGlb(): ArrayBuffer {
  const fixture = new Uint8Array(readFileSync('tests/fixtures/project/obj/box-sofa@1.0.0.glb'));
  const view = new DataView(fixture.buffer, fixture.byteOffset, fixture.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(fixture.subarray(20, 20 + jsonLength))) as Record<string, unknown>;
  const bin = fixture.subarray(20 + jsonLength);
  json['materials'] = [
    {
      name: 'metal',
      pbrMetallicRoughness: {
        baseColorFactor: [0.72, 0.55, 0.3, 1],
        metallicFactor: SHIPPED.metal.metalness,
        roughnessFactor: SHIPPED.metal.roughness,
      },
    },
    {
      name: 'top',
      pbrMetallicRoughness: {
        baseColorFactor: [0.4, 0.28, 0.18, 1],
        metallicFactor: SHIPPED.top.metalness,
        roughnessFactor: SHIPPED.top.roughness,
      },
      extensions: {
        KHR_materials_clearcoat: { clearcoatFactor: SHIPPED.top.clearcoat, clearcoatRoughnessFactor: SHIPPED.top.clearcoatRoughness },
      },
    },
  ];
  json['extensionsUsed'] = ['KHR_materials_clearcoat'];
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array((encoded.byteLength + 3) & ~3).fill(0x20);
  jsonChunk.set(encoded);
  const total = 12 + 8 + jsonChunk.byteLength + bin.byteLength;
  const glb = new Uint8Array(total);
  const out = new DataView(glb.buffer);
  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, total, true);
  out.setUint32(12, jsonChunk.byteLength, true);
  out.setUint32(16, CHUNK_JSON, true);
  glb.set(jsonChunk, 20);
  // The BIN chunk follows unchanged, its own length and type included.
  glb.set(bin, 20 + jsonChunk.byteLength);
  return glb.buffer;
}

/** A one-object project: generator materials, and the object naming them as its finishes on both layers. */
function manifest(): BakedProjectManifest {
  return parseProjectManifest({
    format: 'jeex-project',
    formatVersion: 2,
    projectId: ID.project,
    bakeId: ID.bake,
    bakedAt: '2026-10-24T00:00:00.000Z',
    scene: 'scene.json',
    library: {
      manifestVersion: '1.0',
      id: ID.project,
      publisher: ID.workspace,
      license: 'CC0-1.0',
      objects: [
        {
          id: ID.archetype,
          name: 'Side table',
          category: 'furniture/dining-tables',
          dims: [2.1, 0.85, 0.95],
          anchor: 'floor',
          wallSnap: false,
          clearance: 0.4,
          tags: [],
          model: MODEL,
          slots: ['metal', 'top'],
          defaultFinishes: { metal: ID.brass, top: ID.oak },
          primarySlot: 'top',
          variants: [
            {
              id: ID.variant,
              name: 'Brass and oak',
              version: '1.0.0',
              finishes: { metal: ID.brass, top: ID.oak },
              pricing: { model: 'free' },
              model: MODEL,
            },
          ],
          defaultVariant: ID.variant,
        },
      ],
      materials: [
        { id: ID.brass, name: 'Brass', apply: ['metal'], generator: { kind: 'painted_plaster', tone: '#b08d57', seed: 3 }, tile: 2.4 },
        { id: ID.oak, name: 'Oak', apply: ['furniture'], generator: { kind: 'plank_floor', tone: '#b5855a', seed: 1 }, tile: 3.2 },
      ],
    },
    rights: {
      workspaceId: ID.workspace,
      perpetual: true,
      assets: [{ assetId: ID.archetype, variantId: ID.variant, version: '1.0.0', access: 'free' }],
    },
    generator: { name: 'test', version: '1' },
  });
}

/** The loader wired the way a mounted project wires it, served the physical GLB. */
function projectLoader(): AssetLoader {
  const project = manifest();
  const bank = projectBank(project, PROJECT_BASE);
  const body = physicalGlb();
  const fetchGlb = (() => Promise.resolve(new Response(body.slice(0), { status: 200 }))) as unknown as typeof fetch;
  return new AssetLoader([], {
    defaultLibrary: project.library.id,
    ceilingHeight: 2.7,
    catalogue: bank.catalogue,
    resolveFinish: bank.resolveFinish,
    projectMaterials: project.library.materials,
    modelUrl: (asset) => bank.modelUrl(asset),
    modelSource: createGltfModelSource({ fetch: fetchGlb }),
  });
}

const PLACEMENT: DemoAsset = {
  id: ID.placement,
  type: ID.archetype,
  asset: ID.archetype,
  variant: ID.variant,
  position: { x: 0, y: 0, z: 0 },
};

/** Every drawn material of a body, by its glTF name. */
function materialsOf(body: THREE.Object3D): Map<string, THREE.MeshStandardMaterial> {
  const byName = new Map<string, THREE.MeshStandardMaterial>();
  body.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of [child.material].flat() as THREE.MeshStandardMaterial[]) byName.set(material.name, material);
  });
  return byName;
}

async function upgradedMaterials(placement: DemoAsset): Promise<Map<string, THREE.MeshStandardMaterial>> {
  const loader = projectLoader();
  const upgrade = await loader.upgrade(placement, new AbortController().signal);
  expect(upgrade).toBeTruthy();
  return materialsOf(upgrade!.body);
}

describe('a library variant drawn from its GLB keeps the materials it ships', () => {
  test('metal and clearcoat survive a project library that declares materials', async () => {
    const drawn = await upgradedMaterials(PLACEMENT);
    expect([...drawn.keys()].sort()).toEqual(['metal', 'top']);
    const metal = drawn.get('metal')!;
    expect({ metalness: metal.metalness, roughness: metal.roughness }).toEqual(SHIPPED.metal);
    const top = drawn.get('top') as THREE.MeshPhysicalMaterial;
    expect(top).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect({
      metalness: top.metalness,
      roughness: top.roughness,
      clearcoat: top.clearcoat,
      clearcoatRoughness: top.clearcoatRoughness,
    }).toEqual(SHIPPED.top);
  });

  test('a placement finish override or material shortcut changes none of them', async () => {
    for (const placement of [
      { ...PLACEMENT, finishes: { metal: ID.oak, top: ID.brass } },
      { ...PLACEMENT, material: ID.brass },
    ]) {
      const drawn = await upgradedMaterials(placement);
      expect(drawn.get('metal')!.metalness).toBe(SHIPPED.metal.metalness);
      expect((drawn.get('top') as THREE.MeshPhysicalMaterial).clearcoat).toBe(SHIPPED.top.clearcoat);
    }
  });

  test('reports no unbound material', async () => {
    const upgrade = await projectLoader().upgrade(PLACEMENT, new AbortController().signal);
    expect(upgrade!.warnings.filter((warning) => warning.startsWith('unbound-material'))).toEqual([]);
  });

  test('the Replace picker still describes the variant with its declared finishes', () => {
    const [variant] = variantsForPlacement(PLACEMENT, projectBank(manifest(), PROJECT_BASE).variants);
    expect(variant?.finishes).toEqual({ metal: ID.brass, top: ID.oak });
  });
});
