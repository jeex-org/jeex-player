/**
 * The table of layout rules, hard ones first, in rule order.
 *
 * `layout-lint.ts` builds one `LintContext` and runs every entry over it. A new
 * rule is a new file plus one line here — no growing chain of hand-written
 * calls, and `layout/rules/index.test.ts` asserts that every `LayoutRule` of the
 * union has an entry, so a rule cannot be declared and then never run.
 *
 * Pure module: no `three`, no DOM.
 */

import { INSIDE_A_WALL, CASE_GOODS_ON_A_WALL } from './walls.js';
import { NO_INTERPENETRATION } from './overlap.js';
import { DOOR_CLEAR_ZONE, DOOR_SWING_PATH } from './doors.js';
import { WALL_HUNG } from './wall-hung.js';
import { CIRCULATION } from './circulation.js';
import { WINDOW_CLEARANCE } from './windows.js';
import { CEILING_HUNG, HEIGHT_FIT, ON_FLOOR, WALL_FACING } from './mount.js';
import { KITCHEN_RUN } from './kitchen.js';
import { SEATING_GROUP, DINING_TUCK } from './seating.js';
import { BEDROOM } from './bedroom.js';
import { HALL } from './hall.js';
import type { LayoutRuleModule } from './context.js';

export const LAYOUT_RULES: readonly LayoutRuleModule[] = [
  INSIDE_A_WALL,
  NO_INTERPENETRATION,
  DOOR_CLEAR_ZONE,
  DOOR_SWING_PATH,
  WALL_HUNG,
  CIRCULATION,
  WINDOW_CLEARANCE,
  ON_FLOOR,
  CEILING_HUNG,
  HEIGHT_FIT,
  WALL_FACING,
  CASE_GOODS_ON_A_WALL,
  KITCHEN_RUN,
  SEATING_GROUP,
  DINING_TUCK,
  BEDROOM,
  HALL,
];

export type { LayoutRuleModule } from './context.js';
