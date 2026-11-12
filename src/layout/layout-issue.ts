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
 * Every issue carries a stable `code` and typed `params`
 * (`layout-issue-codes.ts`, the same layer), and every rule builds its issue
 * through `layoutIssue`, which takes the rule from the code and renders the
 * English `message` from the code and params.
 *
 * Pure module: no `three`, no DOM.
 */

import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData, Vec2 } from '../scene/types.js';
import {
  circulationSentence,
  renderLayoutIssue,
  type LayoutIssueCode,
  type LayoutIssueDetail,
  type LayoutIssueParams,
} from './layout-issue-codes.js';

export { circulationSentence };

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

/**
 * One issue. `code` and `params` say WHAT it is in values a host can translate
 * (`layout-issue-codes.ts`); `message` is the English sentence rendered from
 * them, never written by hand.
 */
export type LayoutIssue = {
  rule: LayoutRule;
  severity: 'error' | 'warning';
  /** Placement and opening ids the issue is about. */
  ids: string[];
  message: string;
  at: Vec2;
} & LayoutIssueDetail;

/** The rule each code belongs to: a code says what is wrong, the rule which check found it. */
const RULE_OF_CODE = {
  object_inside_wall: 'inside-a-wall',
  objects_overlap: 'no-interpenetration',
  mounted_objects_overlap: 'no-interpenetration',
  door_clear_zone_blocked: 'door-clear-zone',
  door_leaf_hits_wall: 'door-swing-path',
  door_leaf_hits_object: 'door-swing-path',
  wall_hung_off_face: 'wall-hung',
  wall_hung_past_face_end: 'wall-hung',
  wall_hung_across_opening: 'wall-hung',
  wall_hung_centre_height: 'wall-hung',
  wall_hung_bottom_height: 'wall-hung',
  door_no_free_floor: 'circulation',
  doors_not_connected: 'circulation',
  main_zone_unreachable: 'circulation',
  window_blocked: 'window-clearance',
  raised_without_support: 'on-floor',
  floor_object_outside_rooms: 'on-floor',
  floor_object_crosses_room: 'on-floor',
  ceiling_object_outside_rooms: 'ceiling-hung',
  ceiling_object_without_ceiling: 'ceiling-hung',
  ceiling_object_out_of_band: 'ceiling-hung',
  object_taller_than_ceiling: 'height-fit',
  wall_object_out_of_height: 'height-fit',
  wall_object_turned: 'wall-facing',
  case_good_off_wall: 'case-goods-on-a-wall',
  wall_cabinet_outside_base_run: 'kitchen-run',
  hood_off_hob_centre: 'kitchen-run',
  sofa_tv_distance: 'seating-group',
  floor_lamp_inside_seat: 'seating-group',
  chair_tuck_distance: 'dining-tuck',
  chair_not_facing_table: 'dining-tuck',
  bed_head_off_wall: 'bedroom',
  double_bed_nightstands: 'bedroom',
  nightstands_out_of_line: 'bedroom',
  wardrobe_front_blocked: 'bedroom',
  coat_rack_in_door_swing: 'hall',
  mirror_off_host_centre: 'hall',
  entrance_axis_blocked: 'hall',
} as const satisfies Record<LayoutIssueCode, LayoutRule>;

/**
 * The one way a rule builds an issue: its code and params, with the rule taken
 * from the code and the message rendered from both, so neither can disagree
 * with the code.
 */
export function layoutIssue<C extends LayoutIssueCode>(
  code: C,
  params: LayoutIssueParams[C],
  where: Pick<LayoutIssue, 'severity' | 'ids' | 'at'>,
): LayoutIssue {
  const detail = { code, params } as LayoutIssueDetail;
  return {
    rule: RULE_OF_CODE[code],
    severity: where.severity,
    ids: where.ids,
    message: renderLayoutIssue(code, params),
    at: where.at,
    ...detail,
  };
}

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

/** Which of rule 6's sentences `issue` is, or `null` for any other issue. */
export function circulationSentenceOf(issue: Pick<LayoutIssue, 'rule' | 'message'>): 'no-floor' | 'no-path' | 'main-zone' | null {
  if (issue.rule !== 'circulation') return null;
  if (/^no \d+\.\d+ m path from /.test(issue.message)) return 'no-path';
  if (/ has no \d+\.\d+ m of free floor in front of it inside /.test(issue.message)) return 'no-floor';
  if (issue.message.startsWith('the main zone of ')) return 'main-zone';
  return null;
}
