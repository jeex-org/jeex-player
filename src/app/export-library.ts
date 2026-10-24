/**
 * The library-dressed room surfaces of an export graph, made writable by
 * `GLTFExporter` and `USDZExporter` exactly as the live view draws them.
 *
 * A library material samples its maps through ONE hand-set texture matrix
 * (`materials/library-uv.ts`: metres turned by the grain angle and the finish
 * rotation, then divided by the tile per axis). Neither writer reads a
 * texture matrix, and glTF's own transform (translate, rotate, scale) cannot
 * express a scale applied after a rotation with a non-square tile, so the
 * matrix is baked into a copy of each surface's texture coordinates and the
 * views are reset to identity. Then:
 *
 * 1. one view per image content and colour space, so each image (and each
 *    normal map the GLB writer turns) is written once, also when two library
 *    versions ship the same map;
 * 2. a separate roughness map and the metalness map packed once per pair into
 *    one image (G roughness, B metalness, as three's writer packs per
 *    material), filling both slots;
 * 3. a colour factor above 1 (a tint times its recipe gain) multiplied into a
 *    derived colour image, clamped, with a white factor: glTF's
 *    `baseColorFactor` lies in [0, 1]; a flat colour above 1 is clamped;
 * 4. for USDZ only, the normal maps with their green turned: the stored image
 *    is the live bitmap, which holds the picture bottom row first, and the
 *    USD writer, unlike the glTF one, has no correction for that.
 *
 * Everything runs over the throwaway export graph; the live view's materials
 * and views are never touched. Browser-only (canvas), like the writers.
 */

import * as THREE from 'three';

type Slot = 'map' | 'normalMap' | 'aoMap' | 'roughnessMap' | 'metalnessMap';
const SLOTS: readonly Slot[] = ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap'];

export type LibraryMapsOptions = {
  /** Turn the green channel of library normal maps (the USDZ writer). */
  readonly turnNormalGreen?: boolean;
};

/** A material whose maps are sampled through a hand-set matrix: a library surface's. */
function libraryMatrix(material: THREE.Material): THREE.Matrix3 | null {
  if (!(material instanceof THREE.MeshStandardMaterial)) return null;
  for (const slot of SLOTS) {
    const texture = material[slot];
    if (texture !== null && !texture.matrixAutoUpdate) return texture.matrix.clone();
  }
  return null;
}

/** Every mesh of `graph`, in traversal order: the order the writers walk it in. */
function meshesOf(graph: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  graph.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

/** `source` with its `uv` replaced by `matrix × uv`; every other attribute shared. */
function bakedGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix3): THREE.BufferGeometry {
  const baked = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) baked.setAttribute(name, attribute);
  const uv = source.getAttribute('uv');
  const e = matrix.elements;
  const out = new Float32Array(uv.count * 2);
  for (let index = 0; index < uv.count; index += 1) {
    const u = uv.getX(index);
    const v = uv.getY(index);
    out[index * 2] = e[0] * u + e[3] * v + e[6];
    out[index * 2 + 1] = e[1] * u + e[4] * v + e[7];
  }
  baked.setAttribute('uv', new THREE.BufferAttribute(out, 2));
  baked.morphAttributes = source.morphAttributes;
  baked.morphTargetsRelative = source.morphTargetsRelative;
  baked.setIndex(source.index);
  for (const group of source.groups) baked.addGroup(group.start, group.count, group.materialIndex);
  baked.setDrawRange(source.drawRange.start, source.drawRange.count);
  baked.userData = source.userData;
  baked.name = source.name;
  return baked;
}

/** The pixels of a texture's image as stored, read through a 2D canvas (at `width` × `height`, its own size by default). */
function pixelsOf(texture: THREE.Texture, width?: number, height?: number): ImageData {
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = width ?? image.width;
  canvas.height = height ?? image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * A key per image content: two textures whose stored pixels are equal get the
 * same key, whatever their source (two library versions may ship the same
 * map). A compressed texture, whose pixels a canvas cannot read, is keyed by
 * its source. A hash picks the candidates; equal keys need equal bytes.
 */
function contentKeys(): (texture: THREE.Texture) => string {
  const bySource = new Map<string, string>();
  const byHash = new Map<string, Array<{ readonly data: Uint8ClampedArray; readonly key: string }>>();
  return (texture) => {
    const known = bySource.get(texture.source.uuid);
    if (known !== undefined) return known;
    if (texture instanceof THREE.CompressedTexture) return texture.source.uuid;
    const { data, width, height } = pixelsOf(texture);
    const hash = `${width}x${height}:${fnv1a(data)}`;
    const bucket = byHash.get(hash) ?? [];
    byHash.set(hash, bucket);
    const same = bucket.find((entry) => equalBytes(entry.data, data));
    const key = same?.key ?? `${hash}:${bucket.length}`;
    if (same === undefined) bucket.push({ data, key });
    bySource.set(texture.source.uuid, key);
    return key;
  };
}

/** FNV-1a over `bytes`, as eight hex digits. */
function fnv1a(bytes: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function equalBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** A repeat-wrapped texture over `data`, sampled like the view it derives from. */
function derivedTexture(data: ImageData, like: THREE.Texture, colorSpace: THREE.ColorSpace): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.wrapS = like.wrapS;
  texture.wrapT = like.wrapT;
  texture.minFilter = like.minFilter;
  texture.magFilter = like.magFilter;
  texture.colorSpace = colorSpace;
  texture.channel = like.channel;
  return texture;
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Each texel of an sRGB image times `factor` in linear light, clamped to 1; alpha kept. */
function tinted(texture: THREE.Texture, factor: THREE.Color): ImageData {
  const data = pixelsOf(texture);
  const table = [factor.r, factor.g, factor.b].map((channel) =>
    Uint8ClampedArray.from({ length: 256 }, (_, value) => Math.round(linearToSrgb(Math.min(1, srgbToLinear(value / 255) * channel)) * 255)),
  );
  for (let index = 0; index < data.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) data.data[index + channel] = table[channel]![data.data[index + channel]!]!;
  }
  return data;
}

/** G from `roughness`, B from `metalness` (255 where either is absent), R 0, alpha 255, at the roughness map's size. */
function packed(metalness: THREE.Texture | null, roughness: THREE.Texture | null): ImageData {
  const reference = (roughness ?? metalness)!.image as { width: number; height: number };
  const { width, height } = reference;
  const rough = roughness === null ? null : pixelsOf(roughness, width, height);
  const metal = metalness === null ? null : pixelsOf(metalness, width, height);
  const out = new ImageData(width, height);
  for (let index = 0; index < out.data.length; index += 4) {
    out.data[index + 1] = rough === null ? 255 : rough.data[index + 1]!;
    out.data[index + 2] = metal === null ? 255 : metal.data[index + 2]!;
    out.data[index + 3] = 255;
  }
  return out;
}

/** Green turned (`255 - g`), everything else kept. */
function greenTurned(texture: THREE.Texture): ImageData {
  const data = pixelsOf(texture);
  for (let index = 1; index < data.data.length; index += 4) data.data[index] = 255 - data.data[index]!;
  return data;
}

/**
 * Prepares the library surfaces of `graph` for a writer (module header) and
 * answers the disposal of everything it made. Call it on the export's own
 * graph, after its maps have settled.
 */
export function prepareLibraryMaps(graph: THREE.Object3D, options: LibraryMapsOptions = {}): () => void {
  const meshes = meshesOf(graph);
  const made: Array<{ dispose(): void }> = [];

  // 1. Every library material's matrix BEFORE any mesh is baked: wall faces and
  //    ceilings share one material across many meshes.
  const matrices = new Map<THREE.MeshStandardMaterial, THREE.Matrix3>();
  for (const mesh of meshes) {
    const material = mesh.material;
    if (Array.isArray(material) || matrices.has(material as THREE.MeshStandardMaterial)) continue;
    const matrix = libraryMatrix(material);
    if (matrix !== null) matrices.set(material as THREE.MeshStandardMaterial, matrix);
  }

  // 2. Bake, one copy per (geometry, material).
  const baked = new Map<THREE.BufferGeometry, Map<THREE.Material, THREE.BufferGeometry>>();
  for (const mesh of meshes) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    const matrix = matrices.get(material);
    if (matrix === undefined || mesh.geometry.getAttribute('uv') === undefined) continue;
    const byMaterial = baked.get(mesh.geometry) ?? new Map<THREE.Material, THREE.BufferGeometry>();
    baked.set(mesh.geometry, byMaterial);
    let geometry = byMaterial.get(material);
    if (geometry === undefined) {
      geometry = bakedGeometry(mesh.geometry, matrix);
      byMaterial.set(material, geometry);
      made.push(geometry);
    }
    mesh.geometry = geometry;
  }

  // 3. Only now: identity transforms, one view per image and colour space;
  //    images are told apart by their pixels, since two library versions may
  //    ship the same map.
  const canonical = new Map<string, THREE.Texture>();
  const contentKey = contentKeys();
  const keyOf = (texture: THREE.Texture): string => `${contentKey(texture)}|${texture.colorSpace}`;
  for (const material of matrices.keys()) {
    for (const slot of SLOTS) {
      const texture = material[slot];
      if (texture === null) continue;
      texture.matrix.identity();
      const key = keyOf(texture);
      const first = canonical.get(key) ?? texture;
      canonical.set(key, first);
      material[slot] = first;
    }
  }

  // 4. Separate metalness and roughness images packed once per pair.
  const packs = new Map<string, THREE.Texture>();
  for (const material of matrices.keys()) {
    const { metalnessMap, roughnessMap } = material;
    if (metalnessMap === roughnessMap) continue;
    const key = `${metalnessMap?.source.uuid ?? '-'}|${roughnessMap?.source.uuid ?? '-'}`;
    let pack = packs.get(key);
    if (pack === undefined) {
      pack = derivedTexture(packed(metalnessMap, roughnessMap), (roughnessMap ?? metalnessMap)!, THREE.NoColorSpace);
      packs.set(key, pack);
      made.push(pack);
    }
    material.metalnessMap = pack;
    material.roughnessMap = pack;
  }

  // 5. Colour factors within [0, 1].
  const tints = new Map<string, THREE.Texture>();
  for (const mesh of meshes) {
    const material = mesh.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    const colour = material.color;
    if (Math.max(colour.r, colour.g, colour.b) <= 1) continue;
    const map = matrices.has(material) ? material.map : null;
    if (map === null) {
      colour.setRGB(Math.min(1, colour.r), Math.min(1, colour.g), Math.min(1, colour.b));
      continue;
    }
    const key = `${map.source.uuid}|${colour.r.toFixed(6)}|${colour.g.toFixed(6)}|${colour.b.toFixed(6)}`;
    let tint = tints.get(key);
    if (tint === undefined) {
      tint = derivedTexture(tinted(map, colour), map, THREE.SRGBColorSpace);
      tints.set(key, tint);
      made.push(tint);
    }
    material.map = tint;
    colour.setRGB(1, 1, 1);
  }

  // 6. USDZ: normal maps with their green turned, once per image.
  if (options.turnNormalGreen === true) {
    const turned = new Map<string, THREE.Texture>();
    for (const material of matrices.keys()) {
      const normal = material.normalMap;
      if (normal === null) continue;
      let texture = turned.get(normal.source.uuid);
      if (texture === undefined) {
        texture = derivedTexture(greenTurned(normal), normal, THREE.NoColorSpace);
        turned.set(normal.source.uuid, texture);
        made.push(texture);
      }
      material.normalMap = texture;
    }
  }

  return () => {
    for (const thing of made) thing.dispose();
  };
}
