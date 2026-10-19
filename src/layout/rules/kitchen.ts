/**
 * Rule 9 (soft): a wall cabinet stays inside the base run under it, and an
 * extractor hood sits over the centre of its hob.
 *
 * "Which archetypes are base units" is a catalogue fact
 * (`layout.kitchenBase`). The worktop is the MERGED run of the base units on
 * one face, so a cabinet may bridge the joint between the hob and the counter
 * beside it.
 *
 * Pure module: no `three`, no DOM.
 */

import { dist, dot, sub } from '../../plan/plan-geometry.js';
import {
  faceLabel,
  faceSpan,
  nearestFace,
  positionOf,
  type LayoutIssue,
  type LayoutRuleModule,
  type LintContext,
  type LintItem,
} from './context.js';
import type { WallFace } from '../../plan/plan-solver.js';
import { sameFace } from '../../scene/types.js';
import { ARCHETYPE } from '../../assets/catalogue-ids.js';

/** Two base units this close along a face count as one continuous worktop. */
const WORKTOP_JOINT_M = 0.05;
/** How far a cabinet may hang past the end of the base run, metres. */
const CABINET_SLACK_M = 0.05;
/** How far off the hob centre a hood may sit before it is worth reporting, metres. */
const HOOD_OFFSET_M = 0.06;

type Span = { face: WallFace; t0: number; t1: number };

function spanOf(ctx: LintContext, item: LintItem): Span | null {
  const centre = positionOf(item);
  const near = nearestFace(ctx.plan, item.roomId, centre);
  if (!near) return null;
  const [t0, t1] = faceSpan(item, near.face, centre);
  return { face: near.face, t0, t1 };
}

function ruleKitchen(ctx: LintContext, out: LayoutIssue[]): void {
  const bases = ctx.items.filter((item) => item.layout?.kitchenBase === true).map((item) => ({ item, span: spanOf(ctx, item) }));

  for (const item of ctx.items) {
    if (item.archetype !== ARCHETYPE.cabinet_wall) continue;
    const span = spanOf(ctx, item);
    if (!span) continue;
    const runs: Array<[number, number]> = bases
      .filter((base) => base.span !== null && sameFace(base.span.face.key, span.face.key))
      .map((base) => [base.span!.t0, base.span!.t1] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const run of runs) {
      const last = merged.at(-1);
      if (last && run[0] - last[1] <= WORKTOP_JOINT_M) last[1] = Math.max(last[1], run[1]);
      else merged.push([...run]);
    }
    if (merged.some(([t0, t1]) => span.t0 >= t0 - CABINET_SLACK_M && span.t1 <= t1 + CABINET_SLACK_M)) continue;
    out.push({
      rule: 'kitchen-run',
      severity: 'warning',
      ids: [item.placement.id],
      message: `${item.placement.id} (${span.t0.toFixed(2)}..${span.t1.toFixed(2)} on ${faceLabel(span.face)}) is not inside the base run`,
      at: positionOf(item),
    });
  }

  for (const hood of ctx.items.filter((item) => item.archetype === ARCHETYPE.hood_extractor)) {
    const hoodAt = positionOf(hood);
    const hob = ctx.items
      .filter((item) => item.archetype === ARCHETYPE.cooker && item.roomId === hood.roomId)
      .sort((a, b) => dist(positionOf(a), hoodAt) - dist(positionOf(b), hoodAt))[0];
    if (!hob) continue;
    const hobAt = positionOf(hob);
    const offset = Math.hypot(hobAt.x - hoodAt.x, hobAt.z - hoodAt.z);
    // The hood sits against the wall, the hob a little in front of it; only the
    // sideways offset matters, so the gap is measured along the wall run.
    const along = { x: -hood.front.z, z: hood.front.x };
    const sideways = Math.abs(dot(sub(hobAt, hoodAt), along));
    if (sideways <= HOOD_OFFSET_M) continue;
    out.push({
      rule: 'kitchen-run',
      severity: 'warning',
      ids: [hood.placement.id, hob.placement.id],
      message: `${hood.placement.id} sits ${sideways.toFixed(2)} m off the centre of ${hob.placement.id} (total ${offset.toFixed(2)} m)`,
      at: hoodAt,
    });
  }
}

export const KITCHEN_RUN: LayoutRuleModule = { id: 'kitchen-run', severity: 'warning', run: ruleKitchen };
