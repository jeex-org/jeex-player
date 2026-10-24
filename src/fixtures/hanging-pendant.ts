/**
 * A 1.052 m pendant under a 2.65 m ceiling, exported as a PROJECT object: the
 * fixture the ceiling-hanging tests of the loader and the builder share.
 */

import * as THREE from 'three';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import type { BakedProjectManifest } from '../assets/project-manifest.js';

/**
 * A pendant exported as a PROJECT object: the bank's pendant archetype, with
 * no builder, a 1.052 m drop and a GLB in the model frame (floor-footprint
 * centre, lowest point at y = 0). The ids are the archetype's, its variant's,
 * its GLB's and a scene's placement of it; the bake's own ids are this file's.
 */
export const HANGING = {
  placement: '01a15f1b-dbbd-7657-ab60-6f840ab91f11',
  archetype: '01a12fdf-14e8-7bc8-8007-8ba4894f374a',
  variant: '01a12fdf-1566-718d-a0d1-1055062a232e',
  model: 'obj/01a16b52-e62c-75e9-8d38-c4cac720ace2.glb',
  project: '01a16c46-c3ca-70c9-abaf-ba952f079984',
  bake: '01a16c46-c3ca-70ca-87ab-c8741b3e804c',
  workspace: '01a16c46-c3ca-70cb-bdca-7f44ecf4688e',
  ceiling: 2.65,
  dims: [0.36, 1.052, 0.36] as const,
} as const;

/** The one-object bake the hanging pendant is drawn from. */
export function hangingManifest(): BakedProjectManifest {
  return parseProjectManifest({
    format: 'jeex-project',
    formatVersion: 2,
    projectId: HANGING.project,
    bakeId: HANGING.bake,
    bakedAt: '2026-10-24T00:00:00.000Z',
    scene: 'scene.json',
    library: {
      manifestVersion: '1.0',
      id: HANGING.project,
      publisher: HANGING.workspace,
      license: 'CC0-1.0',
      objects: [
        {
          id: HANGING.archetype,
          name: 'Pendant lamp',
          category: 'lighting/pendants',
          dims: [...HANGING.dims],
          anchor: 'ceiling',
          wallSnap: false,
          clearance: 0,
          tags: [],
          model: HANGING.model,
          slots: [],
          defaultFinishes: {},
          primarySlot: 'shade',
          variants: [
            {
              id: HANGING.variant,
              name: 'Pendant',
              version: '1.0.0',
              dims: [...HANGING.dims],
              pricing: { model: 'free' },
              model: HANGING.model,
            },
          ],
          defaultVariant: HANGING.variant,
        },
      ],
      materials: [],
    },
    rights: { workspaceId: HANGING.workspace, perpetual: true, assets: [] },
    generator: { name: 'test', version: '1' },
  });
}

/** A GLB stand-in of `dims` in the model frame: centred in x/z, from y = 0 up. */
export function modelFrameBox(dims: readonly [number, number, number]): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), new THREE.MeshStandardMaterial());
  mesh.position.y = dims[1] / 2;
  group.add(mesh);
  return group;
}
