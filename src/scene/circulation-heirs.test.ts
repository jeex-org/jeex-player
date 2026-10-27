/**
 * `strict-new` across a room merge, on a furnished flat as a plan recogniser
 * outlines it (`tests/fixtures/merged-kitchen/`): the furniture that left the
 * absorbed room's doors without free floor reports, after the merge, as a
 * blocked path in the survivor, a different wording about the same doors.
 */

import { describe, expect, test } from 'bun:test';
import FIXTURE from '../../tests/fixtures/merged-kitchen/merged-kitchen.json' with { type: 'json' };
import DINING from '../../tests/fixtures/merged-dining/merged-dining.json' with { type: 'json' };
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { lintLayout, type LayoutCatalogue, type LayoutFacts } from '../layout/layout-lint.js';
import { SceneModel, isApplyOk } from './scene-model.js';
import type { SceneOp } from './types.js';

type Fixture = { readonly scene: unknown; readonly ops: unknown; readonly facts: unknown };

/** The fixture's flat, linted with the layout facts its furniture was furnished with, by placement id. */
function model(fixture: Fixture = FIXTURE): SceneModel {
  const facts = fixture.facts as Record<string, Omit<LayoutFacts, 'layout'>>;
  const catalogue: LayoutCatalogue = (placement) => {
    const fact = facts[placement.id];
    return fact ? { layout: undefined, ...fact } : null;
  };
  return SceneModel.load(structuredClone(fixture.scene), CATALOGUE_REGISTRIES, undefined, {
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

describe("'strict-new' across a room merge, to doors a zone's floor serves", () => {
  test('4.1: removing the wall is accepted, and no door is short of floor: the dining zone is floor to walk on', () => {
    // Until a zone's floor counted as floor (`RoomFace.face`), these doors opened onto a cut-out zone and
    // reported as boxed in, before the edit and after it; the decision on those errors is pinned in issue-heirs.test.ts.
    const subject = model(DINING);
    const result = subject.apply({ baseRev: 0, ops: DINING.ops as SceneOp[], lint: 'strict-new' });

    if (!isApplyOk(result)) throw new Error(`expected a commit, got ${result.error}: ${result.message}`);
    expect(result.roomMerges?.length).toBe(1);
    expect((result.issues ?? []).filter((issue) => issue.rule === 'circulation')).toEqual([]);
  });
});
