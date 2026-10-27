/**
 * A door that opens onto a kept zone's floor (`tests/fixtures/kept-zone/`):
 * removing the wall between a living room and a kitchen keeps the living room
 * as a zone of the kitchen, and the terrace door that opened into the living
 * room now opens onto the zone, inside the kitchen's face.
 */

import { describe, expect, test } from 'bun:test';
import FIXTURE from '../../tests/fixtures/kept-zone/kept-zone.json' with { type: 'json' };
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { lintLayout, type LayoutCatalogue, type LayoutFacts } from '../layout/layout-lint.js';
import { SceneModel, isApplyOk } from './scene-model.js';
import type { SceneOp } from './types.js';

const facts = FIXTURE.facts as unknown as Record<string, Omit<LayoutFacts, 'layout'>>;
const catalogue: LayoutCatalogue = (placement) => {
  const fact = facts[placement.id];
  return fact ? { layout: undefined, ...fact } : null;
};

describe('a kept zone is still floor', () => {
  test('the terrace door that opened into the living room keeps its free floor once the living room is a zone: the edit is accepted', () => {
    const model = SceneModel.load(structuredClone(FIXTURE.scene), CATALOGUE_REGISTRIES, undefined, {
      lint: (scene, plan) => lintLayout(scene, plan, catalogue),
    });

    const result = model.apply({ baseRev: 0, ops: FIXTURE.ops as SceneOp[], lint: 'strict-new' });

    if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
    expect(result.roomMerges?.[0]?.kept).toBe('zone');
    // No door is newly short of floor: the only error is the one the flat already had.
    expect((result.issues ?? []).filter((issue) => issue.severity === 'error').map((issue) => issue.rule)).toEqual(['door-swing-path']);
  });
});
