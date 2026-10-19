import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { SceneBuilder, FURNITURE_GROUP_NAME } from '../../src/geometry/scene-builder.js';
import { solvePlan } from '../../src/plan/plan-solver.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { L_SHAPE } from '../../src/fixtures/plan-l-shape-ids.js';
import type { AsyncModelSource } from '../../src/geometry/model-source.js';
import type { SceneData } from '../../src/scene/types.js';
import { SceneModel } from '../../src/scene/scene-model.js';
import { CATALOGUE_REGISTRIES } from '../../src/assets/catalogue-registries.js';
import { ARCHETYPE, VARIANT } from '../../src/assets/catalogue-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import { ViewerLibError } from '../../src/shared/errors.js';

/**
 * The progressive upgrade, end to end on a real scene graph: the first build
 * is procedural, the GLB arrives afterwards and takes the body's place inside
 * the SAME group, and a failure leaves the procedural body exactly where it
 * was.
 *
 * The scene is the L-shape fixture with one bed added — the demo apartment is
 * deliberately left alone, and `bed_double` is the archetype whose slots
 * include `frame`, which is the fixture GLB's second material and therefore
 * the one that binds by the slot-name convention.
 */

const PLACEMENT_ID = '01a12ffa-de4c-7b72-a4f4-b29ebb96e852';
const MODEL_URL = '/tests/fixtures/project/obj/box-sofa@1.0.0.glb';

const scene: SceneData = {
  ...lShapePlan,
  assets: [
    {
      id: PLACEMENT_ID,
      type: 'bed',
      asset: ARCHETYPE.bed_double,
      position: { x: 3, y: 0, z: 4 },
      rotationY: Math.PI / 2,
      room: L_SHAPE.room.a,
    },
  ],
};

function furnitureGroup(root: THREE.Group): THREE.Group {
  const furniture = root.getObjectByName(FURNITURE_GROUP_NAME);
  const group = furniture?.getObjectByName(PLACEMENT_ID);
  if (!(group instanceof THREE.Group)) throw new Error(`no group for ${PLACEMENT_ID}`);
  return group;
}

function bodyName(group: THREE.Group): string {
  return group.children[0]?.name ?? '';
}

type BuilderOptions = ConstructorParameters<typeof SceneBuilder>[2];

function newBuilder(options: BuilderOptions): SceneBuilder {
  return new SceneBuilder(scene, solvePlan(scene), options);
}

describe('progressive GLB upgrade', () => {
  test('the first build is procedural and the GLB replaces it in place', async () => {
    const builder = newBuilder({ modelUrl: () => MODEL_URL });
    try {
      const built = builder.build();
      const group = furnitureGroup(built.root);
      const before = { ...group.userData };
      const transform = group.matrix.clone();
      expect(group.userData['modelState']).toBe('procedural');
      expect(bodyName(group)).toBe(`${VARIANT.bed_double_linen}-procedural`);

      const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
      builder.bindModel(model, () => undefined);
      const result = await builder.upgradeModels(new AbortController().signal);
      expect(result).toEqual({ upgraded: 1, failed: 0 });
      // The upgrade is geometry, never a document edit: no revision, no op.
      expect(model.rev).toBe(0);

      expect(group.userData['modelState']).toBe('gltf');
      expect(bodyName(group)).toBe(`${VARIANT.bed_double_linen}-gltf`);
      expect(group.children).toHaveLength(1);
      // Everything the selection and layout contracts read is untouched.
      for (const key of [
        'assetId',
        'assetRef',
        'archetypeId',
        'variantId',
        'variantName',
        'category',
        'dims',
        'anchor',
        'clearance',
        'pricing',
        'roomId',
        'collision',
      ]) {
        expect({ key, value: group.userData[key] }).toEqual({ key, value: before[key] });
      }
      expect(group.matrix.equals(transform)).toBe(true);
    } finally {
      builder.dispose();
    }
  });

  test('the loaded body wears the placement finishes it can bind, and reports the rest', async () => {
    const builder = newBuilder({ modelUrl: () => MODEL_URL });
    try {
      const built = builder.build();
      await builder.upgradeModels(new AbortController().signal);
      const group = furnitureGroup(built.root);
      const names: string[] = [];
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && !Array.isArray(child.material)) names.push(child.material.name);
      });
      // `frame` is a slot of `bed_double`, so the GLB material of that name is
      // repainted; `seat` is not, so it keeps the supplier's own material.
      expect(names).toContain(FINISH.oak_natural);
      expect(names).toContain('seat');
      expect(group.userData['modelWarnings']).toContain('unbound-material:seat');
    } finally {
      builder.dispose();
    }
  });

  test('a failing source keeps the procedural body and counts the failure', async () => {
    const failing: AsyncModelSource = () => Promise.reject(new ViewerLibError('scene-load', 'no model today'));
    const builder = newBuilder({ modelUrl: () => MODEL_URL, modelSource: failing });
    try {
      const built = builder.build();
      const result = await builder.upgradeModels(new AbortController().signal);
      expect(result).toEqual({ upgraded: 0, failed: 1 });
      const group = furnitureGroup(built.root);
      expect(group.userData['modelState']).toBe('failed');
      expect(bodyName(group)).toBe(`${VARIANT.bed_double_linen}-procedural`);
    } finally {
      builder.dispose();
    }
  });

  test('a library with no baseUrl has nothing to upgrade and fetches nothing', async () => {
    let asked = 0;
    const counting: AsyncModelSource = () => {
      asked += 1;
      return Promise.reject(new ViewerLibError('internal', 'should never be asked'));
    };
    const builder = newBuilder({ modelSource: counting });
    try {
      const built = builder.build();
      const result = await builder.upgradeModels(new AbortController().signal);
      expect({ asked, result }).toEqual({ asked: 0, result: { upgraded: 0, failed: 0 } });
      expect(furnitureGroup(built.root).userData['modelState']).toBe('procedural');
    } finally {
      builder.dispose();
    }
  });

  test('an abort stops the pass without rejecting or half-swapping a body', async () => {
    const controller = new AbortController();
    const builder = newBuilder({ modelUrl: () => MODEL_URL });
    try {
      const built = builder.build();
      controller.abort();
      const result = await builder.upgradeModels(controller.signal);
      expect(result).toEqual({ upgraded: 0, failed: 0 });
      expect(furnitureGroup(built.root).userData['modelState']).toBe('procedural');
    } finally {
      builder.dispose();
    }
  });
});
