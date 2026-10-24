/**
 * `exportShellForBake`: the apartment shell of a scene as a shell file for a
 * light bake (`shell-extras.schema.ts` is the contract).
 *
 * The shell is built by the player's own builders, exactly as a live view
 * builds it, origins inside the rooms included; then every mesh's world
 * matrix is applied to its vertices and normals, so each node of the file has
 * an identity transform and its origin travels in `extras.jeex.origin`. Only
 * `TEXCOORD_0` is written: the bake tool adds `TEXCOORD_1`.
 *
 * Mesh ids belong to the shell file, not to the scene (which has no id per
 * wall side, nor one for a floor apart from its ceiling), so the caller, who
 * owns the file, supplies `mintId`; the player mints nothing. A minted id
 * must be a UUID v7 and new to this export.
 *
 * The finishes are a required option: the caller names the ones the live
 * view paints with (`SHIPPED_FINISHES`, or `projectFinishes` of the project's
 * materials, the live project view's own composition).
 *
 * Internal module: the bake tool imports it from source in a browser. It is
 * not part of the package's exports.
 */

import * as THREE from 'three';
import { createBuilderContext, type FinishLookup } from '../geometry/builder-context.js';
import { OpeningBuilder } from '../geometry/opening-builder.js';
import { ShellBuilder } from '../geometry/shell-builder.js';
import { rebaseShellOrigins } from '../geometry/shell-origins.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import type { ProjectFinishes } from '../materials/project-finishes.js';
import { solvePlan } from '../plan/plan-solver.js';
import { isUuidV7, type SceneData } from '../scene/types.js';
import { ViewerLibError } from '../shared/errors.js';
import { writeGlb, type GlbMaterial, type GlbMesh } from './glb-write.js';
import { shellEntries, type ShellEntry } from './shell-contract.js';
import { canonicalJson, shellInputsHash } from './shell-inputs.js';

/** The bundled finishes, for a scene the live view paints without a project. */
export const SHIPPED_FINISHES = Object.freeze({ shipped: true } as const);

export type ShellExportOptions = {
  /** Mints one UUID v7 per mesh; the caller owns the ids. */
  readonly mintId: () => string;
  /**
   * The finishes the live view paints the scene with: `SHIPPED_FINISHES`, or
   * `projectFinishes(manifest.library.materials)` for a project. Required, so
   * an export never falls back to finishes the live view does not use.
   */
  readonly finishes: typeof SHIPPED_FINISHES | ProjectFinishes;
};

function finishOptions(finishes: ShellExportOptions['finishes'] | undefined): {
  findFinish?: FinishLookup;
  projectMaterials?: readonly ProjectMaterial[];
} {
  if (finishes === SHIPPED_FINISHES) return {};
  if (finishes !== null && typeof finishes === 'object' && 'findFinish' in finishes && typeof finishes.findFinish === 'function')
    return { findFinish: finishes.findFinish, projectMaterials: finishes.projectMaterials };
  throw new ViewerLibError('bad-params', 'shell export: name the finishes the live view paints with (SHIPPED_FINISHES or projectFinishes)');
}

export type ShellExport = {
  /** The GLB bytes. */
  readonly glb: ArrayBuffer;
  readonly shellInputsHash: string;
  /** The minted name of every node, in node order. */
  readonly names: readonly string[];
};

/** World-space attributes of one mesh, its transform applied. */
export function worldAttributes(mesh: THREE.Mesh): Pick<GlbMesh, 'positions' | 'normals' | 'uv0' | 'indices'> {
  const geometry = mesh.geometry.clone();
  try {
    geometry.applyMatrix4(mesh.matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const count = position.count;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uv0 = new Float32Array(count * 2);
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < count; i++) {
      positions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
      normals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
      if (uv) uv0.set([uv.getX(i), uv.getY(i)], i * 2);
    }
    const index = geometry.getIndex();
    const indices = index
      ? Uint32Array.from({ length: index.count }, (_, i) => index.getX(i))
      : Uint32Array.from({ length: count }, (_, i) => i);
    // A mirrored world matrix flips the winding; keep every triangle front-facing as drawn.
    if (mesh.matrixWorld.determinant() < 0)
      for (let i = 0; i + 2 < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    return { positions, normals, uv0, indices };
  } finally {
    geometry.dispose();
  }
}

function glbMaterialOf(entry: ShellEntry): GlbMaterial {
  const material = entry.mesh.material as THREE.MeshStandardMaterial;
  return {
    baseColorFactor: [...entry.albedo, 1],
    roughness: material.roughness ?? 1,
    metalness: material.metalness ?? 0,
    doubleSided: material.side === THREE.DoubleSide,
    extras: { jeex: entry.material },
  };
}

/** Builds the shell of `scene` and writes it as a shell file. */
export async function exportShellForBake(scene: SceneData, options: ShellExportOptions): Promise<ShellExport> {
  const { findFinish, projectMaterials } = finishOptions(options.finishes);
  const plan = solvePlan(scene);
  const ctx = createBuilderContext(scene, plan, findFinish, projectMaterials, null);
  const shellBuilder = new ShellBuilder(ctx);
  const openingBuilder = new OpeningBuilder(ctx);
  const shell = new THREE.Group();
  shell.name = 'parametric-shell';
  try {
    shellBuilder.build(shell);
    openingBuilder.build(shell);
    rebaseShellOrigins(shell, plan, scene.ceilingHeight);
    const entries = shellEntries(shell, scene, ctx);

    const materials: GlbMaterial[] = [];
    const materialIndex = new Map<string, number>();
    const names = new Set<string>();
    const meshes: GlbMesh[] = entries.map((entry) => {
      const name = options.mintId();
      if (!isUuidV7(name)) throw new ViewerLibError('bad-params', `shell export: minted id ${JSON.stringify(name)} is not a UUID v7`);
      if (names.has(name)) throw new ViewerLibError('bad-params', `shell export: minted id ${name} was minted twice`);
      names.add(name);
      const glbMaterial = glbMaterialOf(entry);
      const key = canonicalJson(glbMaterial);
      let material = materialIndex.get(key);
      if (material === undefined) {
        material = materials.push(glbMaterial) - 1;
        materialIndex.set(key, material);
      }
      return { name, ...worldAttributes(entry.mesh), material, extras: { jeex: entry.extras } };
    });

    const hash = await shellInputsHash(scene, projectMaterials);
    const glb = writeGlb({ assetExtras: { jeex: { format: 1, sceneId: scene.id, shellInputsHash: hash } }, meshes, materials });
    return { glb, shellInputsHash: hash, names: [...names] };
  } finally {
    openingBuilder.dispose();
    shellBuilder.dispose();
  }
}
