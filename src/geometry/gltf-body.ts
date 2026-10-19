/**
 * Turns a parsed GLB scene into a furniture BODY: the same thing a procedural
 * builder returns, dressed in the same finishes, measured against the same
 * catalogue dims.
 *
 * This is where the catalogue conventions for delivered models are enforced — and
 * "enforced" means REPORTED, never corrected. A model whose bounding box
 * disagrees with `dims` is a defect of the library, and stretching it here
 * would hide the defect behind a wrong-looking sofa; a material nobody bound
 * keeps whatever the supplier shipped. Nothing in this module throws: a valid
 * GLB always yields a body, and everything that is off comes back in
 * `warnings` for the loader to report.
 *
 * Two ways a material binds to a finish slot, in this order:
 *   1. `materialSlots` from the catalogue entry — `{ slot: "glTF material name" }`;
 *   2. the name convention — a material NAMED after a slot dresses that slot.
 * A material bound by neither is reported as `unbound-material:<name>`.
 *
 * A BAKED variant (`ResolvedAsset.baked`) skips both: its GLB renders with the materials it shipped, nothing is swapped and nothing is
 * reported unbound. The bbox, pivot and shadow handling stay the same.
 *
 * Front is -Z at zero rotation, exactly as the scene contract has it, so a GLB
 * body needs none of the half turn `asset-loader` gives a procedural one (the
 * builders author their fronts at +Z).
 */

import * as THREE from 'three';
import type { FinishRegistry } from '../assets/asset-finishes.js';
import type { ModelOutcome, ModelRequest } from './model-source.js';
import { countTriangles } from './model-source.js';

/** Relative bbox deviation a delivered model is allowed against its catalogue `dims`. */
const BBOX_TOLERANCE = 0.02;

/** How far off the floor a pivot may sit before it stops being "the centre of the floor footprint", metres. */
const PIVOT_TOLERANCE = 0.005;

/** Inverts `materialSlots` into the lookup the meshes are walked with: material name -> slot. */
function slotsByMaterialName(materialSlots: Readonly<Record<string, string>> | undefined): Map<string, string> {
  const bySlot = new Map<string, string>();
  for (const [slot, materialName] of Object.entries(materialSlots ?? {})) bySlot.set(materialName, slot);
  return bySlot;
}

/** The worst relative deviation between the model's bbox and the catalogue dims, as whole percent. */
function bboxDeviation(size: THREE.Vector3, dims: ModelRequest['dims']): number {
  const measured = [size.x, size.y, size.z];
  let worst = 0;
  for (const axis of [0, 1, 2]) {
    const expected = dims[axis]!;
    if (expected <= 0) continue;
    worst = Math.max(worst, Math.abs(measured[axis]! - expected) / expected);
  }
  return Math.round(worst * 100);
}

/** Everything the catalogue conventions promise about the geometry, checked and reported. */
function checkConventions(group: THREE.Group, request: ModelRequest): string[] {
  const warnings: string[] = [];
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return ['empty-model'];
  const size = box.getSize(new THREE.Vector3());
  const deviation = bboxDeviation(size, request.dims);
  if (deviation > BBOX_TOLERANCE * 100) warnings.push(`bbox-off-by-${deviation}`);
  const centredX = Math.abs(box.min.x + box.max.x) <= PIVOT_TOLERANCE;
  const centredZ = Math.abs(box.min.z + box.max.z) <= PIVOT_TOLERANCE;
  if (Math.abs(box.min.y) > PIVOT_TOLERANCE || !centredX || !centredZ) warnings.push('pivot-off-floor');
  return warnings;
}

/** The finish material for one glTF material, or `undefined` when nothing binds it. */
function boundFinish(
  name: string,
  slots: Map<string, string>,
  finishes: FinishRegistry,
  placementFinishes: Readonly<Record<string, string>>,
): THREE.Material | undefined {
  const slot = slots.get(name) ?? name;
  const finishId = placementFinishes[slot];
  return finishId ? finishes.get(finishId) : undefined;
}

/** How a GLB body is dressed. */
export type GltfBodyOptions = {
  /** The variant is baked: keep every shipped material, report none unbound. */
  readonly baked?: boolean | undefined;
};

/**
 * Dresses a parsed GLB scene as a body of `request`'s placement.
 *
 * `scene` is the caller's own clone (`model-source.ts` hands out one per
 * placement), so the materials swapped in here never reach the cached parse.
 */
export function prepareGltfBody(
  scene: THREE.Group,
  request: ModelRequest,
  finishes: FinishRegistry,
  placementFinishes: Readonly<Record<string, string>>,
  options: GltfBodyOptions = {},
): ModelOutcome {
  const warnings = checkConventions(scene, request);
  const slots = slotsByMaterialName(request.materialSlots);
  const unbound = new Set<string>();

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (options.baked) return;
    const applied = (Array.isArray(child.material) ? child.material : [child.material]).map((material) => {
      const bound = boundFinish(material.name, slots, finishes, placementFinishes);
      if (!bound) unbound.add(material.name);
      return bound ?? material;
    });
    child.material = Array.isArray(child.material) ? applied : applied[0]!;
  });

  for (const name of [...unbound].sort()) warnings.push(`unbound-material:${name}`);
  // `bytes: 0` — this function DRESSES a container someone else fetched; the
  // transfer was charged to the project budget by the source that made it
  // (`model-source.ts`), and charging it twice would stop a bake early.
  return { group: scene, triangles: countTriangles(scene), warnings, bytes: 0 };
}
