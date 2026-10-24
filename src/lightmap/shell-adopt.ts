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
 * A live mesh whose triangles no walk can see is two nodes in the file
 * (`shellParts`): its seen part, which it adopts as above, and its unseen
 * part, which becomes a CHILD mesh drawn with the live mesh's material as it
 * stands before the binding (so the bake's material never reaches it and it
 * keeps live lighting), a shallow copy of its `userData`, its shadow flags
 * and its current layers (the dollhouse cuts and restores whole subtrees).
 * The picker casts its registered meshes without their children, so the
 * parent answers raycasts for the child's triangles as its own (face indices
 * after its own) and the child answers none itself: picks land where they
 * landed on the live shell. A mesh whose seen part has no `TEXCOORD_1` keeps
 * its live geometry whole and gets no child.
 *
 * The file is accepted only when it describes the live shell exactly: the
 * same parts, and part for part, in order, the same contract
 * (`shell-contract.ts`) and finish value. The bake tool may split vertices,
 * so counts are never compared. A mismatch refuses the whole file before
 * anything changes; the caller keeps the live shell.
 *
 * The minted mesh names are not written onto the live meshes (the live
 * names are what the rest of the player knows them by): `named` maps each
 * file name to its live mesh, an unseen part's name to its child, which is
 * what the lightmap binding resolves.
 */

import * as THREE from 'three';
import { readGlbContainer } from '../geometry/glb-container.js';
import { LightBakeError } from './light-bake-error.js';
import { shellParts, type ShellEntry } from './shell-contract.js';
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
  const parts = shellParts(entries);
  if (meshes.length !== parts.length)
    throw refuse(`light bake shell has ${String(meshes.length)} meshes, the live shell ${String(parts.length)}`);
  const checked = parts.map((part, i) => {
    const node = gltf.nodes[i]!;
    const material = gltf.materials[gltf.meshes[node.mesh]!.primitives[0].material]!;
    if (canonicalJson(node.extras.jeex) !== canonicalJson(part.extras))
      throw refuse(`light bake shell node ${node.name} (${String(i)}) is not the live ${part.extras.kind}`, {
        node: node.name,
        index: i,
        expected: part.extras,
        actual: node.extras.jeex,
      });
    if (canonicalJson(material.extras.jeex) !== canonicalJson(part.entry.material))
      throw refuse(`light bake shell node ${node.name} (${String(i)}) wears another finish`, { node: node.name, index: i });
    const source = meshes[i]!.geometry;
    checkAttributes(source, node.name);
    return { part, name: node.name, source };
  });
  const plan = entries.map((entry) => {
    const own = checked.filter(({ part }) => part.entry === entry);
    const seen = own.find(({ part }) => !part.unseen);
    const unseen = own.find(({ part }) => part.unseen);
    const mesh = entry.mesh;
    if (!seen?.source.getAttribute('uv1')) return { mesh, seen, unseen, swap: null };
    const origin = entry.extras.origin;
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
      mesh,
      seen,
      unseen,
      swap: {
        geometry: rebasedGeometry(seen.source, origin),
        child: unseen ? unseenChild(mesh, rebasedGeometry(unseen.source, origin)) : null,
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
    if (step.child) attachUnseen(step.mesh, step.child);
    step.mesh.updateMatrixWorld();
  }

  const named = new Map<string, THREE.Mesh>();
  for (const { mesh, seen, unseen, swap } of plan) {
    if (seen) named.set(seen.name, mesh);
    if (unseen) {
      if (swap?.child) named.set(unseen.name, swap.child.mesh);
      else if (!seen) named.set(unseen.name, mesh);
    }
  }
  let adopted = true;
  return {
    named,
    restore() {
      if (!adopted) return;
      adopted = false;
      for (const step of swaps) {
        if (step.child) detachUnseen(step.mesh, step.child);
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

/** An adopted mesh's unseen part, and the raycast its parent answers for both with. */
type UnseenChild = { readonly mesh: THREE.Mesh; readonly raycast: THREE.Mesh['raycast'] };

/** The child that draws `parent`'s unseen part with the parent's current (live) material. */
function unseenChild(parent: THREE.Mesh, geometry: THREE.BufferGeometry): UnseenChild {
  const mesh = new THREE.Mesh(geometry, parent.material);
  mesh.userData = { ...parent.userData };
  mesh.castShadow = parent.castShadow;
  mesh.receiveShadow = parent.receiveShadow;
  mesh.layers.mask = parent.layers.mask;
  mesh.raycast = () => undefined;
  const raycast: THREE.Mesh['raycast'] = (raycaster, intersects) => {
    THREE.Mesh.prototype.raycast.call(parent, raycaster, intersects);
    const from = intersects.length;
    THREE.Mesh.prototype.raycast.call(mesh, raycaster, intersects);
    const own = parent.geometry;
    const offset = (own.index ? own.index.count : own.getAttribute('position').count) / 3;
    for (let k = from; k < intersects.length; k++) {
      const hit = intersects[k]!;
      hit.object = parent;
      if (hit.faceIndex !== undefined && hit.faceIndex !== null) hit.faceIndex += offset;
    }
  };
  return { mesh, raycast };
}

function attachUnseen(parent: THREE.Mesh, child: UnseenChild): void {
  parent.add(child.mesh);
  parent.raycast = child.raycast;
}

function detachUnseen(parent: THREE.Mesh, child: UnseenChild): void {
  child.mesh.removeFromParent();
  child.mesh.geometry.dispose();
  if (parent.raycast === child.raycast) Reflect.deleteProperty(parent, 'raycast');
}
