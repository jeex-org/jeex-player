/**
 * Room surfaces drawn by library materials, exported with their maps: the
 * project's materials from a project source, the bundled finishes from the
 * player's own `finish-maps/` folder (served by the test server, as beside a
 * built player). Real `TextureSource`s, real decoders, real exporters; the
 * project source answers generated images whose texels the tests know.
 */

import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { validateBytes } from 'gltf-validator';
import { exportGlb, type ExportDeps } from '../../src/app/export-gltf.js';
import { exportUsdz } from '../../src/app/export-usdz.js';
import type { ExportSurfaces } from '../../src/app/export-surfaces.js';
import { TextureSource } from '../../src/materials/texture-source.js';
import { builtinFolder } from '../../src/materials/builtin-folder.js';
import { createLogger } from '../../src/shared/logger.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { L_SHAPE } from '../../src/fixtures/plan-l-shape-ids.js';
import { draftOf } from '../../src/shared/committed.js';
import { GENERATOR_FLOOR, LIBRARY_MATERIALS, NATURAL_SCAN, TINTABLE_SCAN } from '../../src/fixtures/library-materials.js';
import { findFinish } from '../../src/materials/finish-catalogue.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import { firstFrameColour } from '../../src/materials/library-material.js';
import type { LibraryMaterial, ProjectMaterial } from '../../src/materials/finish-types.js';
import { SceneBuilder } from '../../src/geometry/scene-builder.js';
import { solvePlan } from '../../src/plan/plan-solver.js';
import type { SceneData } from '../../src/scene/types.js';

const ROOM = L_SHAPE.room;
const DARK_TINT = '#303030';
const WHITE_TINT = '#ffffff';

/* ------------------------------------------------------------ fixtures --- */

type Rgba = [number, number, number, number];

/** What each role of a project map holds, texel by texel (as the picture stands, top row first). */
const PICTURES: Record<string, (x: number, y: number, size: number) => Rgba> = {
  // Asymmetric: red grows to the right, green grows DOWN the picture.
  albedo: (x, y, size) => [Math.round((x * 255) / (size - 1)), Math.round((y * 255) / (size - 1)), 64, 255],
  normal: () => [128, 200, 255, 255],
  arm: () => [255, 180, 0, 255],
  // Varies along x only, so the tint check reads the same texel whatever the orientation.
  albedoTint: (x) => [40 + (x % 64), 60 + (x % 32), 90, 255],
  roughness: () => [0, 150, 0, 255],
};

const pngCache = new Map<string, ArrayBuffer>();

async function png(role: string, size: number): Promise<ArrayBuffer> {
  const key = `${role}|${size}`;
  const cached = pngCache.get(key);
  if (cached) return cached;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d')!;
  const data = new ImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) data.data.set(PICTURES[role]!(x, y, size), (y * size + x) * 4);
  }
  context.putImageData(data, 0, 0);
  const bytes = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  pngCache.set(key, bytes);
  return bytes;
}

/** A project source over generated images; `failing` roles answer 404; every URL asked for is recorded. */
function projectSource(failing: readonly string[] = []) {
  const fetched: string[] = [];
  const source = new TextureSource({
    baseUrl: 'https://project.test/',
    log: createLogger(() => undefined),
    maxAnisotropy: 1,
    fetch: async (url) => {
      fetched.push(url);
      const match = /\/([A-Za-z]+)\.(\d+)\.(webp|ktx2)$/.exec(url);
      if (!match || failing.includes(match[1]!)) return new Response(null, { status: 404 });
      return new Response(await png(match[1]!, Number(match[2])));
    },
  });
  return { source, fetched };
}

function builtinSource(): TextureSource {
  return new TextureSource({ baseUrl: builtinFolder(), log: createLogger(() => undefined), maxAnisotropy: 1 });
}

const lookup = (id: string) => findFinish(id, LIBRARY_MATERIALS) ?? findFinish(id);

function surfaces(options: { materials?: readonly ProjectMaterial[]; failing?: readonly string[]; builtin?: boolean } = {}) {
  const project = projectSource(options.failing);
  const value: ExportSurfaces = {
    surfaceMaterials: options.materials ?? LIBRARY_MATERIALS,
    findFinish: lookup,
    textures: { source: project.source, device: 'low', compressed: false },
    builtinTextures: options.builtin === false ? null : { source: builtinSource(), device: 'low', compressed: false },
  };
  return { value, fetched: project.fetched };
}

/** The L-shape with project library floors (room a turned 30°) and tintable walls (a dark, b white). */
function dressed(): SceneData {
  const scene = draftOf(lShapePlan) as SceneData & { schemaVersion: string; finishes?: unknown };
  scene.schemaVersion = '2.3';
  scene.finishes = {
    rooms: {
      [ROOM.a]: { floor: { material: NATURAL_SCAN.id, rotation: 30 }, walls: { material: TINTABLE_SCAN.id, colour: DARK_TINT } },
      [ROOM.b]: { floor: NATURAL_SCAN.id, walls: { material: TINTABLE_SCAN.id, colour: WHITE_TINT } },
    },
  };
  return scene;
}

function deps(scene: SceneData, value: ExportSurfaces | null): ExportDeps {
  return { getScene: () => scene, getState: () => ({ sceneId: scene.id, rev: 1 }), getSurfaces: () => value };
}

/* ------------------------------------------------------------- reading --- */

type TextureRef = { index: number; texCoord?: number };
type Material = {
  name?: string;
  pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: TextureRef; metallicRoughnessTexture?: TextureRef };
  normalTexture?: TextureRef;
  occlusionTexture?: TextureRef;
};
type Gltf = {
  materials?: Material[];
  textures?: Array<{ source?: number }>;
  images?: Array<{ bufferView: number; mimeType: string }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  accessors?: Array<{ bufferView?: number; byteOffset?: number; count: number; type: string }>;
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; material?: number }> }>;
  nodes?: Array<{ name?: string; mesh?: number; extras?: Record<string, unknown> }>;
  extensionsUsed?: string[];
};

function chunks(buffer: ArrayBuffer): { json: Gltf; bin: Uint8Array } {
  const view = new DataView(buffer);
  let offset = 12;
  let json: Gltf = {};
  let bin = new Uint8Array(0);
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length))) as Gltf;
    else if (type === 0x004e4942) bin = new Uint8Array(buffer, offset + 8, length);
    offset += 8 + length;
  }
  return { json, bin };
}

async function glb(scene: SceneData, value: ExportSurfaces | null): Promise<{ buffer: ArrayBuffer; json: Gltf; bin: Uint8Array }> {
  const buffer = await (await exportGlb(deps(scene, value))).arrayBuffer();
  return { buffer, ...chunks(buffer) };
}

function imageBytes(json: Gltf, bin: Uint8Array, image: number): Uint8Array {
  const view = json.bufferViews![json.images![image]!.bufferView]!;
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

function imageOf(json: Gltf, texture: TextureRef | undefined): number | undefined {
  return texture === undefined ? undefined : json.textures?.[texture.index]?.source;
}

/** The texels of an encoded image as stored (top row first), with no colour conversion. */
async function texels(bytes: Uint8Array): Promise<{ width: number; height: number; at: (x: number, y: number) => Rgba }> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice()]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const { width, height } = bitmap;
  bitmap.close();
  return { width, height, at: (x, y) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)) as Rgba };
}

function readVec2(json: Gltf, bin: Uint8Array, accessorIndex: number): number[] {
  const accessor = json.accessors![accessorIndex]!;
  const view = json.bufferViews![accessor.bufferView!]!;
  const stride = view.byteStride ?? 8;
  const data = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0));
  const out: number[] = [];
  for (let element = 0; element < accessor.count; element += 1) {
    out.push(data.getFloat32(element * stride, true), data.getFloat32(element * stride + 4, true));
  }
  return out;
}

const materialNamed = (json: Gltf, name: string): Material[] => (json.materials ?? []).filter((material) => material.name === name);

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/* --------------------------------------------------------------- tests --- */

describe('exportGlb with the mounted viewer’s texture sources', () => {
  test('a project library floor carries albedo, normal and one ARM image for occlusion and metallic-roughness, on texture set 0', async () => {
    const { json, bin } = await glb(dressed(), surfaces().value);
    const floors = materialNamed(json, NATURAL_SCAN.id);
    expect(floors.length).toBeGreaterThan(0);
    for (const floor of floors) {
      const pbr = floor.pbrMetallicRoughness!;
      expect(pbr.baseColorTexture).toBeDefined();
      expect(floor.normalTexture).toBeDefined();
      expect(floor.occlusionTexture).toBeDefined();
      expect(imageOf(json, floor.occlusionTexture)).toBe(imageOf(json, pbr.metallicRoughnessTexture));
      for (const ref of [pbr.baseColorTexture, floor.normalTexture, floor.occlusionTexture, pbr.metallicRoughnessTexture]) {
        expect(ref!.texCoord ?? 0).toBe(0);
      }
    }
    // The normal map is written with its green turned for a mesh without tangents (glTF's convention over the stored image).
    const normal = await texels(imageBytes(json, bin, imageOf(json, floors[0]!.normalTexture)!));
    expect(normal.at(3, 3)[1]).toBeCloseTo(255 - 200, -0.5);
  }, 90_000);

  test('every image is written once, and two rooms on a material with a separate roughness map share one metallic-roughness image', async () => {
    const { json, bin } = await glb(dressed(), surfaces().value);
    const digests = await Promise.all(
      (json.images ?? []).map(async (_, index) => {
        const hash = await crypto.subtle.digest('SHA-256', imageBytes(json, bin, index).slice());
        return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
      }),
    );
    expect(digests.length).toBeGreaterThan(0);
    expect(new Set(digests).size).toBe(digests.length);
    const walls = materialNamed(json, TINTABLE_SCAN.id);
    expect(walls.length).toBe(2);
    const packed = new Set(walls.map((wall) => imageOf(json, wall.pbrMetallicRoughness?.metallicRoughnessTexture)));
    expect(packed.size).toBe(1);
    expect([...packed][0]).toBeDefined();
  }, 90_000);

  test('every colour factor is in range: a dark tint is written as is, a white one as a derived image with a white factor', async () => {
    const { json, bin } = await glb(dressed(), surfaces().value);
    for (const material of json.materials ?? []) {
      for (const channel of material.pbrMetallicRoughness?.baseColorFactor ?? []) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
    const walls = materialNamed(json, TINTABLE_SCAN.id);
    const gain = 1 / srgbToLinear(0.5);
    const dark = new THREE.Color(DARK_TINT);
    const darkWall = walls.find((wall) => (wall.pbrMetallicRoughness?.baseColorFactor ?? [1])[0]! < 1)!;
    expect(darkWall).toBeDefined();
    const darkFactor = darkWall.pbrMetallicRoughness!.baseColorFactor!;
    for (const [index, channel] of [dark.r, dark.g, dark.b].entries()) expect(darkFactor[index]).toBeCloseTo(channel * gain, 4);

    const whiteWall = walls.find((wall) => wall !== darkWall)!;
    expect((whiteWall.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]).slice(0, 3)).toEqual([1, 1, 1]);
    const derived = await texels(imageBytes(json, bin, imageOf(json, whiteWall.pbrMetallicRoughness!.baseColorTexture)!));
    const source = PICTURES['albedoTint']!;
    for (const x of [0, 17, 63, 200]) {
      const expected = source(x, 0, derived.width)
        .slice(0, 3)
        .map((value) => Math.round(linearToSrgb(Math.min(1, srgbToLinear(value / 255) * gain)) * 255));
      const actual = derived.at(x, 5).slice(0, 3);
      for (const [index, value] of expected.entries()) expect(Math.abs(actual[index]! - value)).toBeLessThanOrEqual(1);
    }
  }, 90_000);

  test('maps that cannot be had leave the surfaces flat and every factor still in range; the validator finds no error', async () => {
    const { buffer, json } = await glb(dressed(), surfaces({ failing: ['albedo', 'albedoTint', 'normal', 'arm', 'roughness'] }).value);
    const whiteWall = materialNamed(json, TINTABLE_SCAN.id).find((wall) => wall.pbrMetallicRoughness?.baseColorTexture === undefined);
    expect(whiteWall).toBeDefined();
    for (const material of json.materials ?? []) {
      for (const channel of material.pbrMetallicRoughness?.baseColorFactor ?? []) expect(channel).toBeLessThanOrEqual(1);
    }
    const report = (await validateBytes(new Uint8Array(buffer), { maxIssues: 0, writeTimestamp: false, format: 'glb' })) as {
      issues: { numErrors: number; messages: Array<{ code: string; severity: number }> };
    };
    expect(report.issues.messages.filter((entry) => entry.severity === 0).map((entry) => entry.code)).toEqual([]);
  }, 90_000);

  test('a colour map that failed keeps the first-frame colour while the normal and ARM maps are written', async () => {
    const { json } = await glb(dressed(), surfaces({ failing: ['albedo'] }).value);
    const floor = materialNamed(json, NATURAL_SCAN.id)[0]!;
    expect(floor.pbrMetallicRoughness?.baseColorTexture).toBeUndefined();
    expect(floor.normalTexture).toBeDefined();
    expect(floor.occlusionTexture).toBeDefined();
    const colour = firstFrameColour({ id: NATURAL_SCAN.id, material: (NATURAL_SCAN as { library: LibraryMaterial }).library, rotation: 0 });
    const factor = floor.pbrMetallicRoughness!.baseColorFactor!;
    for (const [index, channel] of [colour.r, colour.g, colour.b].entries()) expect(factor[index]).toBeCloseTo(channel, 4);
  }, 90_000);

  test('a KTX2 material is exported flat and none of its maps is asked for', async () => {
    const library = (NATURAL_SCAN as { library: LibraryMaterial }).library;
    const ktx2: ProjectMaterial = {
      ...NATURAL_SCAN,
      library: {
        ...library,
        maps: Object.fromEntries(
          Object.entries(library.maps).map(([role, map]) => [
            role,
            {
              ...map,
              files: Object.fromEntries(Object.entries(map.files).map(([size, path]) => [size, path.replace('.webp', '.ktx2')])),
            },
          ]),
        ),
      },
    };
    const { value, fetched } = surfaces({ materials: [ktx2, ...LIBRARY_MATERIALS.filter((entry) => entry.id !== NATURAL_SCAN.id)] });
    const { json } = await glb(dressed(), value);
    expect(fetched.filter((url) => url.endsWith('.ktx2'))).toEqual([]);
    const floor = materialNamed(json, NATURAL_SCAN.id)[0]!;
    expect(floor.pbrMetallicRoughness?.baseColorTexture).toBeUndefined();
    expect(floor.normalTexture).toBeUndefined();
    expect(floor.occlusionTexture).toBeUndefined();
  }, 90_000);

  test('the exported image is the decoded map as the live view samples it: no flip added', async () => {
    const { json, bin } = await glb(dressed(), surfaces().value);
    const floor = materialNamed(json, NATURAL_SCAN.id)[0]!;
    const albedo = await texels(imageBytes(json, bin, imageOf(json, floor.pbrMetallicRoughness!.baseColorTexture)!));
    const size = albedo.width;
    // The live view decodes the picture bottom row first (`imageOrientation: 'flipY'`) and samples it with
    // `flipY = false`; the stored image is that bitmap, so its row y is the picture's row size-1-y.
    for (const [x, y] of [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ] as const) {
      expect(albedo.at(x, y).slice(0, 3)).toEqual(PICTURES['albedo']!(x, size - 1 - y, size).slice(0, 3));
    }
  }, 90_000);

  test('texture coordinates are the live ones: the material matrix applied to the metre coordinates, for every mesh sharing a material', async () => {
    const scene = dressed();
    const value = surfaces().value;
    const { json, bin } = await glb(scene, value);
    const live = new SceneBuilder(scene, solvePlan(scene), {
      surfaceMaterials: value.surfaceMaterials,
      findFinish: lookup,
      textures: value.textures!,
      builtinTextures: value.builtinTextures!,
    });
    const { root } = live.build();
    await live.mapsSettled();
    const liveByKey = new Map<string, THREE.Mesh[]>();
    const keyOf = (name: string | undefined, extras: Record<string, unknown> | undefined): string =>
      `${name ?? ''}|${JSON.stringify(extras?.['face'] ?? null)}`;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshStandardMaterial;
      if (material.map === null || material.map.matrixAutoUpdate) return;
      const key = keyOf(object.name, object.userData);
      liveByKey.set(key, [...(liveByKey.get(key) ?? []), object]);
    });
    const shared = new Map<THREE.Material, number>();
    let compared = 0;
    for (const node of json.nodes ?? []) {
      const list = liveByKey.get(keyOf(node.name, node.extras));
      if (node.mesh === undefined || !list || list.length === 0) continue;
      const mesh = list.shift()!;
      const matrix = (mesh.material as THREE.MeshStandardMaterial).map!.matrix.elements;
      shared.set(mesh.material as THREE.Material, (shared.get(mesh.material as THREE.Material) ?? 0) + 1);
      const metres = mesh.geometry.getAttribute('uv');
      const exported = readVec2(json, bin, json.meshes![node.mesh]!.primitives[0]!.attributes['TEXCOORD_0']!);
      expect(exported.length).toBe(metres.count * 2);
      for (let index = 0; index < metres.count; index += 1) {
        const u = metres.getX(index);
        const v = metres.getY(index);
        expect(exported[index * 2]).toBeCloseTo(matrix[0] * u + matrix[3] * v + matrix[6], 4);
        expect(exported[index * 2 + 1]).toBeCloseTo(matrix[1] * u + matrix[4] * v + matrix[7], 4);
      }
      compared += 1;
    }
    expect(compared).toBeGreaterThan(4);
    expect(Math.max(...shared.values())).toBeGreaterThan(1);
    // No texture transform on a library surface's maps (generated legacy finishes keep theirs).
    const libraryRefs = [...materialNamed(json, NATURAL_SCAN.id), ...materialNamed(json, TINTABLE_SCAN.id)].flatMap((material) => [
      material.pbrMetallicRoughness?.baseColorTexture,
      material.pbrMetallicRoughness?.metallicRoughnessTexture,
      material.normalTexture,
      material.occlusionTexture,
    ]);
    expect(libraryRefs.filter((ref) => (ref as { extensions?: unknown } | undefined)?.extensions !== undefined)).toEqual([]);
    live.dispose();
  }, 90_000);

  test('a project material under a bundled id wins over the bundled library material', async () => {
    const generator: ProjectMaterial = { ...GENERATOR_FLOOR, id: FINISH.oak };
    const scene = draftOf(lShapePlan) as SceneData;
    const { json } = await glb(scene, surfaces({ materials: [generator] }).value);
    expect(materialNamed(json, FINISH.oak)).toEqual([]);
  }, 90_000);

  test('re-exporting the same textured document is byte-for-byte identical', async () => {
    const value = surfaces().value;
    const first = new Uint8Array((await glb(dressed(), value)).buffer);
    const second = new Uint8Array((await glb(dressed(), value)).buffer);
    let at = -1;
    for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
      if (first[index] !== second[index]) {
        at = index;
        break;
      }
    }
    expect({ length: second.length, firstDifference: at }).toEqual({ length: first.length, firstDifference: -1 });
  }, 90_000);
});

/* ---------------------------------------------------------------- USDZ --- */

/** The stored entries of a USDZ (fflate writes them uncompressed), by name. */
function zipEntries(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const view = new DataView(buffer);
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 30 <= buffer.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 30, nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, new Uint8Array(buffer, start, size));
    offset = start + size;
  }
  return entries;
}

describe('exportUsdz with the mounted viewer’s texture sources', () => {
  test('the floor reads occlusion, roughness and metallic from one ARM file, and its normal map turns green like the GLB', async () => {
    const scene = dressed();
    const buffer = await (await exportUsdz(deps(scene, surfaces().value))).arrayBuffer();
    const entries = zipEntries(buffer);
    const usda = new TextDecoder().decode([...entries.entries()].find(([name]) => name.endsWith('.usda'))![1]);
    expect([...entries.keys()].filter((name) => name.startsWith('textures/')).length).toBeGreaterThan(0);
    // Each `def Material` block: its texture files by map type.
    const blocks = usda.split(/def Material "/).slice(1);
    const filesOf = (block: string): Record<string, string> =>
      Object.fromEntries(
        [...block.matchAll(/def Shader "Texture_\d+_(\w+)"[\s\S]*?asset inputs:file = @([^@]+)@/g)].map((match) => [match[1]!, match[2]!]),
      );
    const textured = blocks
      .map((block) => filesOf(block))
      .filter((files) => files['occlusion'] !== undefined && files['normal'] !== undefined);
    expect(textured.length).toBeGreaterThan(0);
    for (const files of textured) {
      expect(files['roughness']).toBe(files['occlusion']);
      expect(files['metallic']).toBe(files['occlusion']);
    }
    const project = textured.find((files) => {
      const bytes = entries.get(files['normal']!);
      return bytes !== undefined && bytes.length < 20_000;
    });
    expect(project).toBeDefined();
    const normal = await texels(entries.get(project!['normal']!)!);
    expect(normal.at(3, 3)[1]).toBeCloseTo(255 - 200, -0.5);
  }, 120_000);
});
