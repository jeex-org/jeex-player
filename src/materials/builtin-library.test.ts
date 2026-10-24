/**
 * What binding the bundled finishes to library materials must leave alone:
 * a document's light-bake input hash, and the set of ids a room surface
 * accepts (the default-ceiling id is the object bank's, never a room finish).
 */

import { describe, expect, test } from 'bun:test';
import { shellInputsHash } from '../lightmap/shell-inputs.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { validateScene } from '../scene/scene-validator.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { draftOf } from '../shared/committed.js';
import { FINISH } from './finish-ids.js';
import { BUILTIN_DEFAULT_CEILING, BUILTIN_FINISHES } from './builtin-library.js';
import type { SceneData } from '../scene/types.js';

describe('bundled finishes as library materials', () => {
  test('the bake input hash of a bare scene on bundled finishes is the one it had before', async () => {
    expect(await shellInputsHash(lShapePlan)).toBe('sha256:ccd1392d5f309f2cf040a82b24966ba656e531ff0b1e3bc3c956be00cd1ca1c1');
  });

  test('the default-ceiling id is still refused on a wall', () => {
    const scene = draftOf(lShapePlan) as SceneData & { schemaVersion: string; finishes?: unknown };
    scene.schemaVersion = '2.3';
    scene.finishes = { rooms: { [L_SHAPE.room.a]: { walls: FINISH.plaster_white } } };
    expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).toThrow();
    expect(CATALOGUE_REGISTRIES.isFinish(FINISH.plaster_white)).toBe(false);
  });

  test('every binding pins a library version and paths under it', () => {
    for (const binding of [...BUILTIN_FINISHES.values(), ...(BUILTIN_DEFAULT_CEILING === null ? [] : [BUILTIN_DEFAULT_CEILING])]) {
      for (const map of Object.values(binding.material.maps)) {
        for (const path of Object.values(map?.files ?? {})) expect(path?.startsWith(`tex/${binding.material.versionId}/`)).toBe(true);
      }
    }
  });
});
