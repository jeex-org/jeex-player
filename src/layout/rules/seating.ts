/**
 * Rule 10 (soft): a sofa faces its TV at a comfortable distance and a floor
 * lamp stands beside the seat, not inside it.
 * Rule 11 (soft): a seat that may tuck (`surfaces.tuck`) sits at the host
 * with a knee space (`surfaces.kneeSpace`) nearest to it and faces it: its
 * front no further than 0.12 m off the edge, and no deeper under the top than
 * its own tuck depth. The facts, not
 * the archetype, say which objects are seats and which are tables.
 *
 * The tuck is measured along the CHAIR's own front, not along the line joining
 * the two centres: two chairs side by side at one long edge sit off-axis, and
 * the centre line then reads their diagonal instead of the tuck.
 *
 * Pure module: no `three`, no DOM.
 */

import { dist, dot, norm, sub } from '../../plan/plan-geometry.js';
import {
  boxCentre,
  boxGap,
  layoutIssue,
  pointToBox,
  positionOf,
  support,
  TOUCH_TOL_M,
  type LayoutIssue,
  type LayoutRuleModule,
  type LintContext,
} from './context.js';
import { ARCHETYPE } from '../../assets/catalogue-ids.js';

/** Sofa to TV distance window, metres. */
const SOFA_TV_M: readonly [number, number] = [2.0, 3.0];
/** The furthest a seat's front may stand off its table's edge, metres. */
const CHAIR_TUCK_MAX_M = 0.12;
/** How squarely a chair must look at its table: cosine of the angle between them. */
const FACING_COS = 0.7;

function ruleSeating(ctx: LintContext, out: LayoutIssue[]): void {
  for (const sofa of ctx.items.filter((item) => item.archetype === ARCHETYPE.sofa_3s)) {
    const tv = ctx.items.find((item) => item.archetype === ARCHETYPE.tv_unit && item.roomId === sofa.roomId);
    if (!tv) continue;
    const gap = dist(positionOf(sofa), positionOf(tv));
    if (gap >= SOFA_TV_M[0] && gap <= SOFA_TV_M[1]) continue;
    out.push(
      layoutIssue(
        'sofa_tv_distance',
        { placement: sofa.placement.id, tv: tv.placement.id, distance: gap, min: SOFA_TV_M[0], max: SOFA_TV_M[1] },
        { severity: 'warning', ids: [sofa.placement.id, tv.placement.id], at: positionOf(sofa) },
      ),
    );
  }
  const seats = ctx.items.filter((item) => item.box && (item.archetype === ARCHETYPE.sofa_3s || item.archetype === ARCHETYPE.armchair));
  for (const lamp of ctx.items.filter((item) => item.archetype === ARCHETYPE.lamp_floor && item.box)) {
    for (const seat of seats) {
      if (pointToBox(seat.box!, boxCentre(lamp.box!)) > 0) continue;
      out.push(
        layoutIssue(
          'floor_lamp_inside_seat',
          { placement: lamp.placement.id, seat: seat.placement.id },
          { severity: 'warning', ids: [lamp.placement.id, seat.placement.id], at: boxCentre(lamp.box!) },
        ),
      );
    }
  }
}

function ruleDining(ctx: LintContext, out: LayoutIssue[]): void {
  const tables = ctx.items.filter((item) => item.box && item.surfaces.kneeSpace);
  for (const chair of ctx.items.filter((item) => item.box && item.surfaces.tuck)) {
    const table = tables
      .filter((candidate) => candidate.roomId === chair.roomId)
      .sort((a, b) => boxGap(chair.box!, a.box!) - boxGap(chair.box!, b.box!))[0];
    if (!table) continue;
    const chairAt = boxCentre(chair.box!);
    const tableAt = boxCentre(table.box!);
    const gap = dot(sub(tableAt, chairAt), chair.front) - support(chair.box!, chair.front) - support(table.box!, chair.front);
    const deepest = -chair.surfaces.tuck!.depth;
    if (gap < deepest - TOUCH_TOL_M || gap > CHAIR_TUCK_MAX_M) {
      out.push(
        layoutIssue(
          'chair_tuck_distance',
          { placement: chair.placement.id, table: table.placement.id, gap, deepest, furthest: CHAIR_TUCK_MAX_M },
          { severity: 'warning', ids: [chair.placement.id, table.placement.id], at: chairAt },
        ),
      );
    }
    if (dot(chair.front, norm(sub(tableAt, chairAt))) < FACING_COS) {
      out.push(
        layoutIssue(
          'chair_not_facing_table',
          { placement: chair.placement.id, table: table.placement.id },
          { severity: 'warning', ids: [chair.placement.id, table.placement.id], at: chairAt },
        ),
      );
    }
  }
}

export const SEATING_GROUP: LayoutRuleModule = { id: 'seating-group', severity: 'warning', run: ruleSeating };
export const DINING_TUCK: LayoutRuleModule = { id: 'dining-tuck', severity: 'warning', run: ruleDining };
