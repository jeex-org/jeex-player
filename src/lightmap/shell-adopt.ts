/**
 * Puts a shipped shell file in place of the live shell's geometry, as one
 * transaction.
 *
 * Only meshes the file gives `TEXCOORD_1` (the ones the bake lights) take
 * the file's geometry; the others (the site, glazing) are checked like the
 * rest and keep their live geometry, which is also what name lookups such as
 * the sun shadow's `site-ground` rely on.
 *
 * The live shell keeps every mesh OBJECT: its material, its `userData` (the
 * picking, painting and dollhouse contract, callbacks included), its parent
 * (an opening part stays in its opening group) and its registrations in the
 * paint, the picker and the dollhouse. What changes is the geometry, which
 * now comes from the file with its `TEXCOORD_1`, and the transform, which
 * puts the node's origin (`extras.jeex.origin`) where the file says: the
 * vertices are shifted by the opposite, so the world result is the file's.
 *
 * The file is accepted only when it describes the live shell exactly: the
 * same number of meshes, and mesh for mesh, in order, the same contract
 * (`shell-contract.ts`) and finish value. The bake tool may split vertices,
 * so counts are never compared. A mismatch refuses the whole file before
 * anything changes; the caller keeps the live shell.
 *
 * The minted mesh names are not written onto the live meshes (the live
 * names are what the rest of the player knows them by): `named` maps each
 * file name to its live mesh, which is what the lightmap binding resolves.
 */

import * as THREE from 'three';
import { readGlbContainer } from '../geometry/glb-container.js';
import { LightBakeError } from './light-bake-error.js';
import type { ShellEntry } from './shell-contract.js';
import { judgeShellGltf, type ShellGltf } from './shell-extras.schema.js';
import { canonicalJson } from './shell-inputs.js';

/** A judged and parsed shell file: its JSON and its meshes in node order. */
export type ShippedShell = { readonly gltf: ShellGltf; readonly meshes: readonly THREE.Mesh[]; dispose(): void };

/** An adopted shell: the file's names over the live meshes, and the undo. */
export type AdoptedShell = { readonly named: ReadonlyMap<string, THREE.Mesh>; restore(): void };

const refuse = (message: string, detail?: Record<string, unknown>): LightBakeError =>
  new LightBakeError('shell', message, detail ? { detail } : undefined);

/** Judges the shell file's JSON and parses its meshes. */
export async function parseShellFile(bytes: ArrayBuffer, label: string): Promise<ShippedShell> {
  let document: unknown;
  try {
    document = readGlbContainer(bytes, label);
  } catch (error) {
    throw new LightBakeError('shell', `light bake shell ${label} is not a GLB`, { cause: error });
  }
  const verdict = judgeShellGltf(document);
  if (!verdict.ok) throw refuse(`light bake shell ${label}: ${verdict.message}`);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  let scene: THREE.Group;
  try {
    scene = (await new GLTFLoader().parseAsync(bytes, '')).scene;
  } catch (error) {
    throw new LightBakeError('shell', `light bake shell ${label} could not be parsed`, { cause: error });
  }
  const meshes = scene.children as THREE.Mesh[];
  if (meshes.length !== verdict.value.nodes.length || meshes.some((mesh) => !mesh.isMesh))
    throw refuse(`light bake shell ${label}: the parsed scene does not have one mesh per node`);
  return {
    gltf: verdict.value,
    meshes,
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
  };
}

/** Refuses decoded attributes that are not one finite value set per vertex. */
function checkAttributes(geometry: THREE.BufferGeometry, name: string): void {
  const position = geometry.getAttribute('position');
  const count = position.count;
  for (const attribute of ['normal', 'uv', 'uv1']) {
    const other = geometry.getAttribute(attribute) as THREE.BufferAttribute | undefined;
    if (other && other.count !== count) throw refuse(`light bake shell node ${name}: ${attribute} does not have one value per vertex`);
  }
  const index = geometry.getIndex();
  if (index && (index.count % 3 !== 0 || Array.from(index.array).some((i) => i >= count)))
    throw refuse(`light bake shell node ${name}: its indices do not make triangles of its vertices`);
  for (const attribute of ['position', 'normal', 'uv', 'uv1']) {
    const data = geometry.getAttribute(attribute) as THREE.BufferAttribute | undefined;
    if (data && !data.array.every((value: number) => Number.isFinite(value)))
      throw refuse(`light bake shell node ${name}: ${attribute} is not finite`);
  }
}

/** The file's geometry in the frame of a node standing at `origin`: the attributes the player reads, nothing else. */
function rebasedGeometry(source: THREE.BufferGeometry, origin: readonly [number, number, number]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'uv1']) {
    const attribute = source.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (attribute) geometry.setAttribute(name, attribute.clone());
  }
  const index = source.getIndex();
  if (index) geometry.setIndex(index.clone());
  geometry.translate(-origin[0], -origin[1], -origin[2]);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Checks `shipped` against the live shell's `entries` and, only when every
 * mesh matches, swaps the geometry in. Throws a `LightBakeError` and changes
 * nothing otherwise.
 */
export function adoptShippedShell(entries: readonly ShellEntry[], shipped: ShippedShell): AdoptedShell {
  const { gltf, meshes } = shipped;
  if (meshes.length !== entries.length)
    throw refuse(`light bake shell has ${String(meshes.length)} meshes, the live shell ${String(entries.length)}`);
  const plan = entries.map((entry, i) => {
    const node = gltf.nodes[i]!;
    const material = gltf.materials[gltf.meshes[node.mesh]!.primitives[0].material]!;
    if (canonicalJson(node.extras.jeex) !== canonicalJson(entry.extras))
      throw refuse(`light bake shell node ${node.name} (${String(i)}) is not the live ${entry.extras.kind}`, {
        node: node.name,
        index: i,
        expected: entry.extras,
        actual: node.extras.jeex,
      });
    if (canonicalJson(material.extras.jeex) !== canonicalJson(entry.material))
      throw refuse(`light bake shell node ${node.name} (${String(i)}) wears another finish`, { node: node.name, index: i });
    const mesh = entry.mesh;
    const source = meshes[i]!.geometry;
    checkAttributes(source, node.name);
    if (!source.getAttribute('uv1')) return { name: node.name, mesh, swap: null };
    const origin = node.extras.jeex.origin;
    const parent = mesh.parent;
    const local = new THREE.Matrix4().makeTranslation(origin[0], origin[1], origin[2]);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      local.premultiply(parent.matrixWorld.clone().invert());
    }
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    local.decompose(position, quaternion, scale);
    return {
      name: node.name,
      mesh,
      swap: {
        geometry: rebasedGeometry(source, origin),
        transform: { position, quaternion, scale },
        before: {
          geometry: mesh.geometry,
          position: mesh.position.clone(),
          quaternion: mesh.quaternion.clone(),
          scale: mesh.scale.clone(),
        },
      },
    };
  });
  const swaps = plan.flatMap(({ mesh, swap }) => (swap ? [{ mesh, ...swap }] : []));

  for (const step of swaps) {
    step.mesh.geometry = step.geometry;
    step.mesh.position.copy(step.transform.position);
    step.mesh.quaternion.copy(step.transform.quaternion);
    step.mesh.scale.copy(step.transform.scale);
    step.mesh.updateMatrixWorld();
  }

  let adopted = true;
  return {
    named: new Map(plan.map((step) => [step.name, step.mesh])),
    restore() {
      if (!adopted) return;
      adopted = false;
      for (const step of swaps) {
        if (step.mesh.geometry === step.geometry) {
          step.mesh.geometry = step.before.geometry;
          step.mesh.position.copy(step.before.position);
          step.mesh.quaternion.copy(step.before.quaternion);
          step.mesh.scale.copy(step.before.scale);
          step.mesh.updateMatrixWorld();
        }
        step.geometry.dispose();
      }
    },
  };
}
