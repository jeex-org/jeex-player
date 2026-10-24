/**
 * The rule table itself: every `LayoutRule` of the union is in it, exactly
 * once, with the severity the rules reference gives it — and the archetype
 * facts the rules read come from the catalogue, not from a table in the linter.
 *
 * A rule that is declared and never dispatched is invisible: the scene lints
 * clean because nobody asked the question. This is the test that would catch
 * that.
 */

import { describe, expect, test } from 'bun:test';
import { LAYOUT_RULES } from './index.js';
import type { LayoutRule } from './context.js';
import { lintLayout } from '../layout-lint.js';
import { findObject, listCatalogueObjects } from '../../assets/asset-catalogue.js';
import { ARCHETYPE } from '../../assets/catalogue-ids.js';
import { lShapePlan } from '../../fixtures/plan-l-shape.js';
import { solvePlan } from '../../plan/plan-solver.js';

/**
 * Every `LayoutRule`, as values. A new member of the union fails to compile
 * here, which is what makes the coverage assertion below mean something.
 */
const EVERY_RULE: Readonly<Record<LayoutRule, 'error' | 'warning'>> = {
  'inside-a-wall': 'error',
  'no-interpenetration': 'error',
  'door-clear-zone': 'error',
  'door-swing-path': 'error',
  'wall-hung': 'error',
  circulation: 'error',
  'window-clearance': 'error',
  'on-floor': 'error',
  'ceiling-hung': 'error',
  'height-fit': 'error',
  'wall-facing': 'error',
  'case-goods-on-a-wall': 'warning',
  'kitchen-run': 'warning',
  'seating-group': 'warning',
  'dining-tuck': 'warning',
  bedroom: 'warning',
  hall: 'warning',
};

describe('LAYOUT_RULES', () => {
  test('every rule of the union has exactly one entry', () => {
    const ids: readonly string[] = LAYOUT_RULES.map((rule) => rule.id);
    expect([...ids].sort()).toEqual(Object.keys(EVERY_RULE).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('each entry carries the severity the rules reference gives it, and is runnable', () => {
    for (const rule of LAYOUT_RULES) {
      expect({ rule: rule.id, severity: rule.severity }).toEqual({ rule: rule.id, severity: EVERY_RULE[rule.id] });
      expect(typeof rule.run).toBe('function');
    }
  });

  test('hard rules run before soft ones', () => {
    const severities = LAYOUT_RULES.map((rule) => rule.severity);
    expect(severities.indexOf('warning')).toBe(severities.lastIndexOf('error') + 1);
  });

  test('every issue a rule raises is tagged with that rule and its severity', () => {
    const plan = solvePlan(lShapePlan);
    for (const rule of LAYOUT_RULES) {
      const raised: ReturnType<typeof lintLayout> = [];
      rule.run({ items: [], solids: [], doors: [], plan, scene: lShapePlan }, raised);
      for (const issue of raised) {
        expect({ id: issue.rule, severity: issue.severity }).toEqual({ id: rule.id, severity: rule.severity });
      }
    }
  });
});

describe('archetype layout facts live in the catalogue', () => {
  test('the case goods and base units the rules read are catalogue entries, not hard-coded ids', () => {
    const caseGoods = listCatalogueObjects()
      .filter((object) => object.layout?.caseGood)
      .map((object) => object.id);
    expect([...caseGoods].sort()).toEqual(
      [
        ARCHETYPE.bookshelf,
        ARCHETYPE.cabinet_shoe,
        ARCHETYPE.cabinet_tall,
        ARCHETYPE.console_hall,
        ARCHETYPE.cooker,
        ARCHETYPE.counter_run,
        ARCHETYPE.dresser,
        ARCHETYPE.fridge_tall,
        ARCHETYPE.tv_unit,
        ARCHETYPE.vanity_sink,
        ARCHETYPE.wardrobe,
      ].sort(),
    );
    const bases = listCatalogueObjects()
      .filter((object) => object.layout?.kitchenBase)
      .map((object) => object.id);
    expect([...bases].sort()).toEqual([ARCHETYPE.cooker, ARCHETYPE.counter_run].sort());
  });

  test('the mounting heights and blocking heights survived the move', () => {
    expect(findObject(ARCHETYPE.art_framed)?.layout?.mount).toEqual({ centre: 1.5 });
    expect(findObject(ARCHETYPE.mirror_round)?.layout?.mount).toEqual({ centre: 1.6 });
    expect(findObject(ARCHETYPE.cabinet_wall)?.layout?.mount).toEqual({ bottom: 1.45 });
    expect(findObject(ARCHETYPE.counter_run)?.layout?.blockingHeight).toBe(0.92);
    // Was 0.92; now the island's built worktop top, pinned on the geometry in `asset-bank-fit.test.ts`.
    expect(findObject(ARCHETYPE.island_kitchen)?.layout?.blockingHeight).toBe(0.94);
  });

  test('every layout fact names a real archetype, so no dead row can hide in a table', () => {
    for (const object of listCatalogueObjects()) {
      if (!object.layout) continue;
      expect({ id: object.id, resolves: findObject(object.id)?.id }).toEqual({ id: object.id, resolves: object.id });
    }
  });

  test('a mounting height only makes sense on a wall-anchored archetype', () => {
    for (const object of listCatalogueObjects()) {
      if (!object.layout?.mount) continue;
      expect({ id: object.id, anchor: object.anchor }).toEqual({ id: object.id, anchor: 'wall' });
    }
  });
});
