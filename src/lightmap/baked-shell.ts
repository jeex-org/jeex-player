/**
 * Applies the light bake of an apartment to its live scene: the shipped shell
 * file in place of the live shell's geometry, then the lightmap on it.
 *
 * The order is the order of cost, and every step can refuse:
 * 1. the sidecar is judged, must name this scene and must carry the live
 *    scene's `shellInputsHash` (`shell-inputs.ts`), so a stale bake never
 *    fetches its shell file;
 * 2. the shell file's bytes must hash to the sidecar's `shellHash`
 *    (`light-bake-load.ts`), and the file's own `asset.extras.jeex` must name
 *    the same scene and digest; the file is judged against its contract
 *    (`shell-extras.schema.ts`), it must give no UV1 to the site or glazing,
 *    and the bindings must name exactly the file's meshes that have UV1 (a
 *    lit mesh left unbound would show live light inside a baked room);
 * 3. only then are the atlas pages fetched;
 * 4. the file must describe the live shell mesh for mesh
 *    (`shell-adopt.ts`), and every binding must fit (`lightmap-binding.ts`).
 * A refusal at any step leaves the live shell exactly as it was built, with
 * its live lighting, and is answered as `{ applied: false, error }`: the
 * bake is never half-applied and never applied to a revision it was not made
 * for. Errors that are not refusals (a defect) propagate.
 *
 * Shell meshes the bake does not bind (the site, glazing) carry no
 * `TEXCOORD_1` and keep their live material: a shell file that gives one of
 * them UV1 is refused before any page is fetched, and a binding that names
 * one of them is refused.
 *
 * Internal: no public option reaches this module yet.
 */

import type * as THREE from 'three';
import { createBuilderContext, type FinishLookup } from '../geometry/builder-context.js';
import type { ProjectMaterial } from '../materials/finish-types.js';
import { solvePlan } from '../plan/plan-solver.js';
import type { SceneData } from '../scene/types.js';
import type { LightBake } from './light-bake.js';
import { LightBakeError } from './light-bake-error.js';
import { loadLightBake } from './light-bake-load.js';
import type { FetchBytes } from './lightmap-page.js';
import { bindLightBake, type BoundLightBake } from './lightmap-binding.js';
import { adoptShippedShell, parseShellFile, type ShippedShell } from './shell-adopt.js';
import { shellEntries, type ShellEntry } from './shell-contract.js';
import { shellInputsHash } from './shell-inputs.js';

/** The name of the group `scene-builder.ts` builds the shell into. */
const SHELL_GROUP = 'parametric-shell';

export type BakedShellOptions = {
  readonly sidecarUrl: URL;
  readonly shellUrl: URL;
  /** The scene the live root was built from. */
  readonly scene: SceneData;
  /** The live scene root: the shell group and the furniture (whose lamps the bake lists). */
  readonly root: THREE.Object3D;
  readonly projectMaterials?: readonly ProjectMaterial[] | undefined;
  readonly findFinish?: FinishLookup | undefined;
  readonly fetchBytes?: FetchBytes | undefined;
};

export type BakedShellOutcome =
  | { readonly applied: true; readonly bake: LightBake; readonly bound: BoundLightBake; dispose(): void }
  | { readonly applied: false; readonly error: LightBakeError };

/** The live shell's contract, or a refusal when the shell holds a mesh the contract does not know. */
export function liveShellEntries(
  root: THREE.Object3D,
  scene: SceneData,
  options: Pick<BakedShellOptions, 'projectMaterials' | 'findFinish'> = {},
): ShellEntry[] {
  const shell = root.getObjectByName(SHELL_GROUP);
  if (!shell) throw new LightBakeError('shell', 'the live scene has no shell to bake onto');
  const ctx = createBuilderContext(scene, solvePlan(scene), options.findFinish, options.projectMaterials, null);
  return shellEntries(shell, scene, ctx);
}

/**
 * Refuses a judged sidecar made for another scene, or for another revision of
 * the live shell (`liveHash`), or that does not say which; run before the
 * shell file is fetched.
 */
export function verifiedSidecar(bake: LightBake, scene: SceneData, liveHash: string): void {
  if (bake.sceneId !== scene.id)
    throw new LightBakeError('shell', `light bake ${bake.bakeId} belongs to another scene`, {
      detail: { expected: scene.id, actual: bake.sceneId },
    });
  if (bake.shellInputsHash === undefined)
    throw new LightBakeError('shell', `light bake ${bake.bakeId} does not say which scene inputs its shell was built from`);
  if (bake.shellInputsHash !== liveHash)
    throw new LightBakeError('shell', `light bake ${bake.bakeId} was made for another revision of the shell`, {
      detail: { expected: liveHash, actual: bake.shellInputsHash },
    });
}

/**
 * The shell file of `bake`, judged and parsed, once its digests agree with
 * the live scene's `liveHash` (`verifiedSidecar` is checked again); refuses
 * otherwise.
 */
export async function verifiedShellFile(bake: LightBake, bytes: ArrayBuffer, scene: SceneData, liveHash: string): Promise<ShippedShell> {
  verifiedSidecar(bake, scene, liveHash);
  const shipped = await parseShellFile(bytes, `of bake ${bake.bakeId}`);
  const asset = shipped.gltf.asset.extras.jeex;
  if (asset.shellInputsHash !== bake.shellInputsHash || asset.sceneId !== scene.id) {
    shipped.dispose();
    throw new LightBakeError('shell', `light bake ${bake.bakeId}: the shell file and the sidecar disagree on the shell`, {
      detail: { sidecar: bake.shellInputsHash, file: asset.shellInputsHash },
    });
  }
  const litNodes = shipped.gltf.nodes.filter((node) => shipped.gltf.meshes[node.mesh]!.primitives[0].attributes.TEXCOORD_1 !== undefined);
  const lit = litNodes.map((node) => node.name);
  const stayLive = litNodes
    .filter(({ extras: { jeex } }) => jeex.kind === 'site' || (jeex.kind === 'opening' && jeex.opening === 'glass'))
    .map((node) => node.name);
  if (stayLive.length > 0) {
    shipped.dispose();
    throw new LightBakeError('shell', `light bake ${bake.bakeId}: its shell gives UV1 to the site or glazing, which stay live`, {
      detail: { nodes: stayLive.slice(0, 8) },
    });
  }
  const bound = new Set(bake.bindings.map((binding) => binding.node));
  const unbound = lit.filter((name) => !bound.has(name));
  if (unbound.length > 0 || bound.size !== lit.length) {
    shipped.dispose();
    throw new LightBakeError('binding', `light bake ${bake.bakeId}: its bindings are not exactly the shell meshes it lit`, {
      detail: { unbound: unbound.slice(0, 8), lit: lit.length, bound: bound.size },
    });
  }
  return shipped;
}

/** Loads the apartment's light bake and applies it, or leaves the live shell as it is. */
export async function applyBakedShell(options: BakedShellOptions): Promise<BakedShellOutcome> {
  const { scene, root } = options;
  let shipped: ShippedShell | null = null;
  try {
    const entries = liveShellEntries(root, scene, options);
    const liveHash = await shellInputsHash(scene, options.projectMaterials);
    const loaded = await loadLightBake(options.sidecarUrl, options.shellUrl, options.fetchBytes, {
      checkSidecar: (bake) => verifiedSidecar(bake, scene, liveHash),
      checkShell: async (bake, bytes) => {
        shipped = await verifiedShellFile(bake, bytes, scene, liveHash);
      },
    });
    const file = shipped as ShippedShell | null;
    if (!file) throw new LightBakeError('shell', 'the shell file was not checked');
    let adopted: ReturnType<typeof adoptShippedShell>;
    try {
      adopted = adoptShippedShell(entries, file);
    } catch (error) {
      loaded.dispose();
      throw error;
    }
    let bound: BoundLightBake;
    try {
      bound = bindLightBake(
        root,
        loaded.bake,
        loaded.pages.map((page) => page.texture),
        adopted.named,
      );
    } catch (error) {
      adopted.restore();
      loaded.dispose();
      throw error;
    }
    let live = true;
    return {
      applied: true,
      bake: loaded.bake,
      bound,
      dispose() {
        if (!live) return;
        live = false;
        bound.unbind();
        adopted.restore();
        loaded.dispose();
      },
    };
  } catch (error) {
    if (error instanceof LightBakeError) return { applied: false, error };
    throw error;
  } finally {
    (shipped as ShippedShell | null)?.dispose();
  }
}
