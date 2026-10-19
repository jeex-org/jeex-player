/**
 * What a layout issue IS, and the port that produces one.
 *
 * A layer of its own inside `layout/` (`.dependency-cruiser.cjs`), for the same
 * reason `scene/types.ts` is one inside `scene/`: the issue is the linter's
 * VOCABULARY, while the linter itself reads the object bank and sits three
 * layers higher. `SceneModel.apply` reports layout issues for a batch
 * (`ApplyBatch.lint`) and must be able to name the type without
 * reaching up to the module that computes them — the function itself is handed
 * in, the way registries are.
 *
 * Pure module: no `three`, no DOM.
 */

import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData, Vec2 } from '../scene/types.js';

/**
 * What a layout issue is ABOUT, named rather than numbered.
 *
 * The furniture layout rules are numbered 1-14 and rule 13 has no
 * implementation (it is a human review step), so the numbering had a hole in
 * it and `issue.rule === 7` told a consumer nothing. The names are the rule
 * module names, so an issue reads the way the rule is written down.
 *
 * | # | id |
 * |---|---|
 * | 1 | `inside-a-wall` |
 * | 2 | `no-interpenetration` |
 * | 3 | `door-clear-zone` |
 * | 4 | `door-swing-path` |
 * | 5 | `wall-hung` |
 * | 6 | `circulation` |
 * | 7 | `window-clearance` |
 * | 7a | `on-floor` |
 * | 7b | `ceiling-hung` |
 * | 7c | `height-fit` |
 * | 7d | `wall-facing` |
 * | 8 | `case-goods-on-a-wall` |
 * | 9 | `kitchen-run` |
 * | 10 | `seating-group` |
 * | 11 | `dining-tuck` |
 * | 12 | `bedroom` |
 * | 14 | `hall` |
 */
export type LayoutRule =
  | 'inside-a-wall'
  | 'no-interpenetration'
  | 'door-clear-zone'
  | 'door-swing-path'
  | 'wall-hung'
  | 'circulation'
  | 'window-clearance'
  | 'on-floor'
  | 'ceiling-hung'
  | 'height-fit'
  | 'wall-facing'
  | 'case-goods-on-a-wall'
  | 'kitchen-run'
  | 'seating-group'
  | 'dining-tuck'
  | 'bedroom'
  | 'hall';

/**
 * Every rule id, in report order (hard rules first, then the soft ones).
 *
 * `as const satisfies readonly LayoutRule[]` both ways round: a new member of
 * the union that is missing here fails `closed-sets.test.ts`, and a name here
 * that is not in the union fails to compile. It is also the sort key — a named
 * rule has no natural order of its own.
 */
export const LAYOUT_RULE_IDS = [
  'inside-a-wall',
  'no-interpenetration',
  'door-clear-zone',
  'door-swing-path',
  'wall-hung',
  'circulation',
  'window-clearance',
  'on-floor',
  'ceiling-hung',
  'height-fit',
  'wall-facing',
  'case-goods-on-a-wall',
  'kitchen-run',
  'seating-group',
  'dining-tuck',
  'bedroom',
  'hall',
] as const satisfies readonly LayoutRule[];

/** Report position of a rule id; `LAYOUT_RULE_IDS` is the order. */
export function layoutRuleOrder(rule: LayoutRule): number {
  return (LAYOUT_RULE_IDS as readonly LayoutRule[]).indexOf(rule);
}

export type LayoutIssue = {
  rule: LayoutRule;
  severity: 'error' | 'warning';
  /** Placement and opening ids the issue is about. */
  ids: string[];
  message: string;
  at: Vec2;
};

/**
 * The linter as its CALLERS see it: a scene and its solved plan in, issues out.
 *
 * `layout/layout-lint.lintLayout` is the implementation, and it is INJECTED
 * (`SceneModel`'s `lint` option) rather than imported, because it reads the
 * object bank and therefore lives above every layer that wants to call it. A
 * model built without one simply never lints (`ApplyBatch.lint` defaults to
 * `'off'`), which is the viewer's own case: it renders documents, it does not
 * review them.
 */
export type LayoutLinter = (scene: SceneData, plan: SolvedPlan) => readonly LayoutIssue[];
