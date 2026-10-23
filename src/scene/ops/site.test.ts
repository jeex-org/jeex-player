/**
 * `set_site`: sets or clears the plan's orientation and sun preset on a 2.3
 * document, through the pure applier and through `SceneModel.apply`.
 */

import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { lShapePlan } from '../../fixtures/plan-l-shape.js';
import { draftOf, type Draft } from '../../shared/committed.js';
import { applyOp, OpError, TOUCHED_SITE, type SceneOp } from '../scene-ops.js';
import { isApplyOk, SceneModel } from '../scene-model.js';
import type { SceneData, SceneSite } from '../types.js';

/** The L-shape plan as a 2.3 document, optionally with a site. */
function scene23(site?: SceneSite): SceneData {
  const base: SceneData = { ...structuredClone(lShapePlan), schemaVersion: '2.3' };
  return site === undefined ? base : { ...base, site };
}

function apply(scene: Draft<SceneData>, op: SceneOp): ReturnType<typeof applyOp> {
  return applyOp(scene, op, CATALOGUE_REGISTRIES);
}

function refusal(scene: Draft<SceneData>, op: unknown): string {
  try {
    apply(scene, op as SceneOp);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error('set_site was expected to be refused');
}

describe('set_site (pure applier)', () => {
  test('sets both fields, normalising north, and reports the site', () => {
    const scene = draftOf(scene23());
    const outcome = apply(scene, { op: 'set_site', northDeg: -90, sun: 'evening' });
    expect(scene.site).toEqual({ northDeg: 270, sun: 'evening' });
    expect(outcome.touched).toEqual([TOUCHED_SITE]);
    expect(outcome.summary).toBe('Site: north 270°, sun evening');
  });

  test('null clears one field and an omitted key keeps the other', () => {
    const scene = draftOf(scene23({ northDeg: 30, sun: 'noon' }));
    apply(scene, { op: 'set_site', sun: null });
    expect(scene.site).toEqual({ northDeg: 30 });
    apply(scene, { op: 'set_site', sun: 'morning' });
    expect(scene.site).toEqual({ northDeg: 30, sun: 'morning' });
  });

  test('clearing both removes site, never leaving an empty one', () => {
    const scene = draftOf(scene23({ northDeg: 30, sun: 'noon' }));
    const outcome = apply(scene, { op: 'set_site', northDeg: null, sun: null });
    expect('site' in scene).toBe(false);
    expect(outcome.summary).toBe('Site cleared');
    const half = draftOf(scene23({ sun: 'noon' }));
    apply(half, { op: 'set_site', sun: null });
    expect('site' in half).toBe(false);
  });

  test('north is stored in [0, 360): -90 → 270, 720 → 0, -0 → 0, a tiny negative never 360', () => {
    const north = (value: number): number | undefined => {
      const scene = draftOf(scene23());
      apply(scene, { op: 'set_site', northDeg: value });
      return scene.site?.northDeg;
    };
    expect(north(-90)).toBe(270);
    expect(north(720)).toBe(0);
    expect(Object.is(north(-0), 0)).toBe(true);
    for (const tiny of [-1e-14, -1e-13, -Number.MIN_VALUE]) {
      const value = north(tiny)!;
      expect(value >= 0 && value < 360).toBe(true);
    }
    expect(north(359.5)).toBe(359.5);
  });

  test('bad values are refused naming the field and change nothing', () => {
    const scene = draftOf(scene23({ northDeg: 30 }));
    for (const northDeg of [Number.NaN, Number.POSITIVE_INFINITY, '90']) {
      expect(refusal(scene, { op: 'set_site', northDeg })).toBe('set_site northDeg must be a finite number or null');
    }
    expect(refusal(scene, { op: 'set_site', sun: 'night' })).toBe("set_site sun must be 'morning', 'noon', 'evening' or null");
    expect(refusal(scene, { op: 'set_site' })).toBe('set_site needs northDeg or sun');
    expect(scene.site).toEqual({ northDeg: 30 });
  });

  test('a 2.2 document is refused naming the version, and no op raises it', () => {
    const old = draftOf(lShapePlan);
    expect(refusal(old, { op: 'set_site', sun: 'noon' })).toBe("set_site needs schemaVersion '2.3'; a 2.2 document carries no site");
    expect('site' in old).toBe(false);
    const scene = draftOf(scene23());
    apply(scene, { op: 'set_site', sun: 'noon' });
    expect(scene.schemaVersion).toBe('2.3');
  });
});

describe('set_site through SceneModel.apply', () => {
  test('commits a revision touching the site; an empty or 2.2 batch is refused and the document unchanged', () => {
    const model = SceneModel.load(scene23(), CATALOGUE_REGISTRIES);
    const result = model.apply({ baseRev: model.rev, ops: [{ op: 'set_site', northDeg: 45, sun: 'morning' }] });
    expect(isApplyOk(result) && result.touched).toEqual([TOUCHED_SITE]);
    expect(model.scene.site).toEqual({ northDeg: 45, sun: 'morning' });
    expect(model.scene.schemaVersion).toBe('2.3');

    const rev = model.rev;
    const empty = model.apply({ baseRev: rev, ops: [{ op: 'set_site' }] });
    expect(isApplyOk(empty)).toBe(false);
    expect(model.rev).toBe(rev);
    expect(model.scene.site).toEqual({ northDeg: 45, sun: 'morning' });

    const old = SceneModel.load(structuredClone(lShapePlan), CATALOGUE_REGISTRIES);
    const refused = old.apply({ baseRev: old.rev, ops: [{ op: 'set_site', sun: 'noon' }] });
    expect(isApplyOk(refused)).toBe(false);
    expect(old.scene.site).toBeUndefined();
  });
});
