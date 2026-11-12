/**
 * Rule 12 (soft): a double bed has its head against a wall and a nightstand on
 * each side, in line with the head; a wardrobe keeps its door swing clear.
 *
 * Pure module: no `three`, no DOM.
 */

import { dist, dot, mul, sub } from '../../plan/plan-geometry.js';
import { overlapDepth, quadCentre } from '../layout-geometry.js';
import { spanQuad } from '../../plan/plan-geometry.js';
import { TOUCH_TOL_M, boxCentre, layoutIssue, nearestFace, type LayoutIssue, type LayoutRuleModule, type LintContext } from './context.js';
import { ARCHETYPE } from '../../assets/catalogue-ids.js';

/** Free run a wardrobe front needs, metres. */
const WARDROBE_FRONT_M = 0.9;
/** How far the head of a bed may stand off its wall, metres. */
const BED_HEAD_GAP_M = 0.1;
/** How near a nightstand must be to count as this bed's, metres. */
const NIGHTSTAND_REACH_M = 2.0;
/** How far the two nightstands may be out of line with the head, metres. */
const NIGHTSTAND_ALIGN_M = 0.05;

function ruleBedroom(ctx: LintContext, out: LayoutIssue[]): void {
  for (const bed of ctx.items.filter((item) => item.box && item.archetype === ARCHETYPE.bed_double)) {
    const centre = boxCentre(bed.box!);
    const head = sub(centre, mul(bed.front, bed.box!.hz));
    const near = nearestFace(ctx.plan, bed.roomId, head);
    if (near && near.distance > BED_HEAD_GAP_M) {
      out.push(
        layoutIssue(
          'bed_head_off_wall',
          { placement: bed.placement.id, distance: near.distance },
          { severity: 'warning', ids: [bed.placement.id], at: centre },
        ),
      );
    }
    const stands = ctx.items.filter(
      (item) =>
        item.box &&
        item.archetype === ARCHETYPE.nightstand &&
        item.roomId === bed.roomId &&
        dist(boxCentre(item.box), centre) < NIGHTSTAND_REACH_M,
    );
    if (stands.length < 2) {
      out.push(
        layoutIssue(
          'double_bed_nightstands',
          { placement: bed.placement.id, count: stands.length },
          { severity: 'warning', ids: [bed.placement.id, ...stands.map((item) => item.placement.id)], at: centre },
        ),
      );
    } else {
      const offsets = stands.map((item) => dot(sub(boxCentre(item.box!), head), bed.front));
      const spread = Math.max(...offsets) - Math.min(...offsets);
      if (spread > NIGHTSTAND_ALIGN_M) {
        out.push(
          layoutIssue(
            'nightstands_out_of_line',
            { placement: bed.placement.id, spread },
            { severity: 'warning', ids: stands.map((item) => item.placement.id), at: centre },
          ),
        );
      }
    }
  }
  for (const wardrobe of ctx.items.filter((item) => item.box && item.archetype === ARCHETYPE.wardrobe)) {
    const zone = spanQuad(
      boxCentre(wardrobe.box!),
      { x: -wardrobe.front.z, z: wardrobe.front.x },
      [-wardrobe.box!.hx, wardrobe.box!.hx],
      [-(wardrobe.box!.hz + WARDROBE_FRONT_M), -wardrobe.box!.hz],
    );
    for (const item of ctx.items) {
      if (!item.quad || item === wardrobe) continue;
      if (overlapDepth(item.quad, zone) <= TOUCH_TOL_M) continue;
      out.push(
        layoutIssue(
          'wardrobe_front_blocked',
          { placement: item.placement.id, wardrobe: wardrobe.placement.id, depth: WARDROBE_FRONT_M },
          { severity: 'warning', ids: [wardrobe.placement.id, item.placement.id], at: quadCentre(zone) },
        ),
      );
    }
  }
}

export const BEDROOM: LayoutRuleModule = { id: 'bedroom', severity: 'warning', run: ruleBedroom };
