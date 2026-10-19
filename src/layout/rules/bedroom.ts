/**
 * Rule 12 (soft): a double bed has its head against a wall and a nightstand on
 * each side, in line with the head; a wardrobe keeps its door swing clear.
 *
 * Pure module: no `three`, no DOM.
 */

import { dist, dot, mul, sub } from '../../plan/plan-geometry.js';
import { overlapDepth, quadCentre } from '../layout-geometry.js';
import { spanQuad } from '../../plan/plan-geometry.js';
import { TOUCH_TOL_M, boxCentre, nearestFace, type LayoutIssue, type LayoutRuleModule, type LintContext } from './context.js';
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
      out.push({
        rule: 'bedroom',
        severity: 'warning',
        ids: [bed.placement.id],
        message: `the head of ${bed.placement.id} stands ${near.distance.toFixed(2)} m off the wall`,
        at: centre,
      });
    }
    const stands = ctx.items.filter(
      (item) =>
        item.box &&
        item.archetype === ARCHETYPE.nightstand &&
        item.roomId === bed.roomId &&
        dist(boxCentre(item.box), centre) < NIGHTSTAND_REACH_M,
    );
    if (stands.length < 2) {
      out.push({
        rule: 'bedroom',
        severity: 'warning',
        ids: [bed.placement.id, ...stands.map((item) => item.placement.id)],
        message: `${bed.placement.id} has ${stands.length} nightstand(s); a double bed takes one on each side`,
        at: centre,
      });
    } else {
      const offsets = stands.map((item) => dot(sub(boxCentre(item.box!), head), bed.front));
      const spread = Math.max(...offsets) - Math.min(...offsets);
      if (spread > NIGHTSTAND_ALIGN_M) {
        out.push({
          rule: 'bedroom',
          severity: 'warning',
          ids: stands.map((item) => item.placement.id),
          message: `the nightstands of ${bed.placement.id} are ${spread.toFixed(2)} m out of line with the bed head`,
          at: centre,
        });
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
      out.push({
        rule: 'bedroom',
        severity: 'warning',
        ids: [wardrobe.placement.id, item.placement.id],
        message: `${item.placement.id} stands in the ${WARDROBE_FRONT_M} m the doors of ${wardrobe.placement.id} need`,
        at: quadCentre(zone),
      });
    }
  }
}

export const BEDROOM: LayoutRuleModule = { id: 'bedroom', severity: 'warning', run: ruleBedroom };
