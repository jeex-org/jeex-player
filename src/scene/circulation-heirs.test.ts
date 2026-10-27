/**
 * `strict-new` across a room merge, on a furnished flat as a plan recogniser
 * outlines it (`tests/fixtures/merged-kitchen/`): the furniture that left the
 * absorbed room's doors without free floor reports, after the merge, as a
 * blocked path in the survivor, a different wording about the same doors.
 */

import { describe, expect, test } from 'bun:test';
import FIXTURE from '../../tests/fixtures/merged-kitchen/merged-kitchen.json' with { type: 'json' };
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { lintLayout, type LayoutCatalogue, type LayoutFacts } from '../layout/layout-lint.js';
import { SceneModel, isApplyOk } from './scene-model.js';
import type { SceneOp } from './types.js';

const facts = FIXTURE.facts as unknown as Record<string, Omit<LayoutFacts, 'layout'>>;
/** The layout facts the furniture was linted with where it was furnished, by placement id. */
const catalogue: LayoutCatalogue = (placement) => {
  const fact = facts[placement.id];
  return fact ? { layout: undefined, ...fact } : null;
};

function model(): SceneModel {
  return SceneModel.load(structuredClone(FIXTURE.scene), CATALOGUE_REGISTRIES, undefined, {
    lint: (scene, plan) => lintLayout(scene, plan, catalogue),
  });
}

describe("'strict-new' across a room merge", () => {
  test('removing the walls is accepted: the blocked path names only doors the merged room already had blocked', () => {
    const subject = model();
    const result = subject.apply({ baseRev: 0, ops: FIXTURE.ops as SceneOp[], lint: 'strict-new' });

    if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
    expect(result.roomMerges?.length).toBe(1);
    // Still reported, as information.
    expect(result.issues?.some((issue) => issue.rule === 'circulation' && issue.message.startsWith('no 0.80 m path'))).toBe(true);
  });
});
