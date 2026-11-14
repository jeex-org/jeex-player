/**
 * Rule 1 (hard): nothing stands inside a wall.
 * Rule 8 (soft): a case good belongs against one.
 *
 * Both measure an item against the wall body — the first for penetration, the
 * second for the gap behind its back plane — so they share this file.
 * "Which archetypes are case goods" is a fact of the object bank, read off
 * `CatalogueObject.layout.caseGood`; the linter keeps no membership table.
 *
 * Pure module: no `three`, no DOM.
 */

import { mul, sub } from '../../plan/plan-geometry.js';
import { overlapDepth } from '../layout-geometry.js';
import {
  TOUCH_TOL_M,
  apart,
  boxCentre,
  layoutIssue,
  nearestFace,
  type LayoutIssue,
  type LayoutRuleModule,
  type LintContext,
  type LintItem,
} from './context.js';

/** A case good's back may sit this far off its wall face, metres (rule 8). */
const CASE_GOOD_GAP_M = 0.05;

function itemInWall(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  if (!item.quad) return;
  let worst = { depth: 0, wallId: '' };
  for (const solid of ctx.solids) {
    if (apart(item.quad, solid.quad)) continue;
    const depth = overlapDepth(item.quad, solid.quad);
    if (depth > worst.depth) worst = { depth, wallId: solid.wallId };
  }
  if (worst.depth <= TOUCH_TOL_M) return;
  out.push(
    layoutIssue(
      'object_inside_wall',
      { placement: item.placement.id, wall: worst.wallId, depth: worst.depth },
      { severity: 'error', ids: [item.placement.id, worst.wallId], at: boxCentre(item.box!) },
    ),
  );
}

function ruleWalls(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) itemInWall(ctx, item, out);
}

function ruleCaseGoods(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) {
    if (!item.box || item.layout?.caseGood !== true) continue;
    const centre = boxCentre(item.box);
    const back = sub(centre, mul(item.front, item.box.hz));
    const near = nearestFace(ctx.plan, item.roomId, back) ?? nearestFace(ctx.plan, null, back);
    if (!near) continue;
    if (near.distance <= CASE_GOOD_GAP_M) continue;
    out.push(
      layoutIssue(
        'case_good_off_wall',
        { placement: item.placement.id, distance: near.distance },
        { severity: 'warning', ids: [item.placement.id], at: centre },
      ),
    );
  }
}

export const INSIDE_A_WALL: LayoutRuleModule = { id: 'inside-a-wall', severity: 'error', run: ruleWalls, item: itemInWall };
export const CASE_GOODS_ON_A_WALL: LayoutRuleModule = { id: 'case-goods-on-a-wall', severity: 'warning', run: ruleCaseGoods };
