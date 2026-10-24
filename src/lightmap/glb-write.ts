/**
 * A minimal, deterministic binary glTF 2.0 writer for flat triangle meshes:
 * one root node per mesh, one primitive per mesh, float attributes, 32-bit
 * indices, untextured metallic-roughness materials and `extras` everywhere.
 *
 * Written here rather than through three's `GLTFExporter` because a shell
 * file must carry exactly the contract (`shell-extras.schema.ts`) and nothing
 * of a live scene's `userData`, and the same input must give the same bytes.
 *
 * Pure module: no `three`, no DOM.
 */

export type GlbMaterial = {
  readonly name?: string;
  /** Linear RGBA. */
  readonly baseColorFactor: readonly [number, number, number, number];
  readonly roughness: number;
  readonly metalness: number;
  readonly doubleSided: boolean;
  readonly extras: Record<string, unknown>;
};

export type GlbMesh = {
  readonly name: string;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uv0: Float32Array;
  readonly uv1?: Float32Array | undefined;
  readonly indices: Uint32Array;
  readonly material: number;
  readonly extras: Record<string, unknown>;
};

export type GlbDocument = {
  readonly assetExtras: Record<string, unknown>;
  readonly meshes: readonly GlbMesh[];
  readonly materials: readonly GlbMaterial[];
};

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const TRIANGLES = 4;

const pad4 = (length: number): number => (length + 3) & ~3;

/** The GLB bytes of `document`. */
export function writeGlb(document: GlbDocument): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];

  const view = (data: Float32Array | Uint32Array, target: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    const padded = pad4(bytes.byteLength);
    if (padded > bytes.byteLength) chunks.push(new Uint8Array(padded - bytes.byteLength));
    byteLength += padded;
    return bufferViews.length - 1;
  };

  const vector = (data: Float32Array, size: number, bounds: boolean): number => {
    const accessor: Record<string, unknown> = {
      bufferView: view(data, ARRAY_BUFFER),
      componentType: FLOAT,
      count: data.length / size,
      type: size === 3 ? 'VEC3' : 'VEC2',
    };
    if (bounds) {
      const min = Array.from({ length: size }, () => Infinity);
      const max = Array.from({ length: size }, () => -Infinity);
      for (let i = 0; i < data.length; i += size)
        for (let k = 0; k < size; k++) {
          min[k] = Math.min(min[k]!, data[i + k]!);
          max[k] = Math.max(max[k]!, data[i + k]!);
        }
      accessor['min'] = min;
      accessor['max'] = max;
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };

  const meshes = document.meshes.map((mesh) => {
    const attributes: Record<string, number> = {
      POSITION: vector(mesh.positions, 3, true),
      NORMAL: vector(mesh.normals, 3, false),
      TEXCOORD_0: vector(mesh.uv0, 2, false),
    };
    if (mesh.uv1) attributes['TEXCOORD_1'] = vector(mesh.uv1, 2, false);
    accessors.push({
      bufferView: view(mesh.indices, ELEMENT_ARRAY_BUFFER),
      componentType: UNSIGNED_INT,
      count: mesh.indices.length,
      type: 'SCALAR',
    });
    return { name: mesh.name, primitives: [{ attributes, indices: accessors.length - 1, material: mesh.material, mode: TRIANGLES }] };
  });

  const json = {
    asset: { version: '2.0', generator: 'jeex-viewer shell export', extras: document.assetExtras },
    scene: 0,
    scenes: [{ nodes: document.meshes.map((_, i) => i) }],
    nodes: document.meshes.map((mesh, i) => ({ name: mesh.name, mesh: i, extras: mesh.extras })),
    meshes,
    materials: document.materials.map((material) => ({
      ...(material.name !== undefined && { name: material.name }),
      pbrMetallicRoughness: {
        baseColorFactor: [...material.baseColorFactor],
        metallicFactor: material.metalness,
        roughnessFactor: material.roughness,
      },
      doubleSided: material.doubleSided,
      extras: material.extras,
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(text.byteLength);
  const total = 12 + 8 + jsonLength + 8 + byteLength;
  const out = new Uint8Array(total);
  const data = new DataView(out.buffer);
  data.setUint32(0, 0x46546c67, true); // 'glTF'
  data.setUint32(4, 2, true);
  data.setUint32(8, total, true);
  data.setUint32(12, jsonLength, true);
  data.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(text, 20);
  out.fill(0x20, 20 + text.byteLength, 20 + jsonLength);
  let at = 20 + jsonLength;
  data.setUint32(at, byteLength, true);
  data.setUint32(at + 4, 0x004e4942, true); // 'BIN\0'
  at += 8;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}
