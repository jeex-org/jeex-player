/**
 * A stand-in for the bake tool's UV1 step, for tests: reads an exported shell
 * file, splits every lit mesh into separate triangles (so vertex counts
 * change, as a real unwrap's seams make them) and gives each mesh a chart in
 * its own rect of one atlas page: triangle `t` of a mesh fills a small
 * right triangle in cell `t` of a grid inside the rect. Names, node order,
 * materials and every `extras` object are written back unchanged; the site
 * and glazing get no UV1, like the real tool does.
 *
 * Deterministic: the same file gives the same bytes and the same rects.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { writeGlb, type GlbMaterial, type GlbMesh } from '../lightmap/glb-write.js';
import type { LightBake } from '../lightmap/light-bake.js';
import { BAKE_LIGHTS_RECIPE, BAKE_SKY_HEMISPHERE_RECIPE } from '../lightmap/bake-lights.schema.js';
import { LIGHTING_STANDARD_VERSION } from '../lighting/lighting-standard.js';
import type { ShellGltf, ShellNodeExtras } from '../lightmap/shell-extras.schema.js';

export type UnwrapRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export type Unwrapped = {
  readonly glb: ArrayBuffer;
  /** The chart rect of every node given UV1, by node name, in texels of the page. */
  readonly rects: ReadonlyMap<string, UnwrapRect>;
};

/** The JSON chunk of a GLB. */
export function glbJson(bytes: ArrayBuffer): ShellGltf {
  const length = new DataView(bytes).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length))) as ShellGltf;
}

/** Whether the bake lights a mesh of this kind (it gets UV1 and a binding). */
export function isLit(extras: ShellNodeExtras): boolean {
  return extras.kind !== 'site' && !(extras.kind === 'opening' && extras.opening === 'glass') && extras.visible;
}

/**
 * Unwraps `bytes` into a `page` × `page` atlas with `cell`-texel rects laid
 * out row by row; `lights` picks the meshes that get UV1 (by default the ones
 * the real tool lights).
 */
export async function standInUnwrap(
  bytes: ArrayBuffer,
  page = 512,
  cell = 16,
  lights: (extras: ShellNodeExtras) => boolean = isLit,
): Promise<Unwrapped> {
  const json = glbJson(bytes);
  const scene = (await new GLTFLoader().parseAsync(bytes.slice(0), '')).scene;
  const rects = new Map<string, UnwrapRect>();
  const perRow = Math.floor(page / cell);
  let slot = 0;
  const meshes: GlbMesh[] = (scene.children as THREE.Mesh[]).map((mesh, i) => {
    const node = json.nodes[i]!;
    const extras = node.extras.jeex;
    const lit = lights(extras);
    const geometry = lit ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const count = position.count;
    const out: GlbMesh = {
      name: node.name,
      positions: Float32Array.from({ length: count * 3 }, (_, k) => position.getComponent(Math.floor(k / 3), k % 3)),
      normals: Float32Array.from({ length: count * 3 }, (_, k) => normal.getComponent(Math.floor(k / 3), k % 3)),
      uv0: Float32Array.from({ length: count * 2 }, (_, k) => uv.getComponent(Math.floor(k / 2), k % 2)),
      indices: lit
        ? Uint32Array.from({ length: count }, (_, k) => k)
        : Uint32Array.from(geometry.getIndex()?.array ?? Array.from({ length: count }, (_, k) => k)),
      material: json.meshes[node.mesh]!.primitives[0].material,
      extras: node.extras,
    };
    if (!lit) return out;
    const rect = { x: (slot % perRow) * cell, y: Math.floor(slot / perRow) * cell, w: cell, h: cell };
    slot += 1;
    rects.set(node.name, rect);
    const triangles = count / 3;
    const grid = Math.max(1, Math.ceil(Math.sqrt(triangles)));
    const step = (cell - 2) / grid;
    const uv1 = new Float32Array(count * 2);
    for (let t = 0; t < triangles; t++) {
      const u = rect.x + 1 + (t % grid) * step;
      const v = rect.y + 1 + Math.floor(t / grid) * step;
      const corners = [
        [u, v],
        [u + step * 0.9, v],
        [u, v + step * 0.9],
      ];
      for (let k = 0; k < 3; k++) uv1.set([corners[k]![0]! / page, corners[k]![1]! / page], (t * 3 + k) * 2);
    }
    return { ...out, uv1 };
  });
  const materials: GlbMaterial[] = json.materials.map((material) => {
    const pbr = (
      material as unknown as { pbrMetallicRoughness: { baseColorFactor: number[]; metallicFactor: number; roughnessFactor: number } }
    ).pbrMetallicRoughness;
    return {
      baseColorFactor: pbr.baseColorFactor as unknown as [number, number, number, number],
      roughness: pbr.roughnessFactor,
      metalness: pbr.metallicFactor,
      doubleSided: (material as { doubleSided?: boolean }).doubleSided === true,
      extras: material.extras,
    };
  });
  return { glb: writeGlb({ assetExtras: json.asset.extras, meshes, materials }), rects };
}

/**
 * A sidecar for an unwrapped file: `calibration`'s contract and page (the
 * page stretched to `page` texels), one binding per lit mesh, no lamps, the
 * lights recipe of an apartment bake, and the digests of this file and scene.
 * Its sun and sky stay the calibration's: the page's light means nothing for
 * the apartment, the fixture exercises the shell path only.
 */
export async function standInSidecar(
  file: Unwrapped,
  calibration: LightBake,
  sceneId: string,
  shellInputsHash: string,
  page = 512,
): Promise<LightBake> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', file.glb));
  return {
    ...calibration,
    sceneId,
    shellHash: `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    shellInputsHash,
    lights: { recipe: BAKE_LIGHTS_RECIPE, standardVersion: LIGHTING_STANDARD_VERSION, skyRecipe: BAKE_SKY_HEMISPHERE_RECIPE },
    pages: [{ ...calibration.pages[0]!, width: page, height: page }],
    bindings: [...file.rects].map(([node, rect]) => ({ node, page: 0, rect })),
    lamps: [],
  };
}
