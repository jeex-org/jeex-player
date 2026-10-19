/**
 * Rule 2 (hard): two solids never occupy the same place.
 *
 * Objects combine only by their catalogue facts (`surfaces.ts`): an
 * `onSurface` object stands on a host's
 * `top`, fully inside it, and a `tuck` seat goes under a host's `kneeSpace`.
 * Two floor objects whose height bands do not meet (a lamp on a top above a
 * seat tucked under it) do not collide either. Wall and ceiling pieces are
 * compared among themselves by their mounted bodies (`LintItem.mount`).
 *
 * Pure module: no `three`, no DOM.
 */

import { overlapDepth, quadCentre } from '../layout-geometry.js';
import { TOUCH_TOL_M, apart, boxCentre, type LayoutIssue, type LayoutRuleModule, type LintContext, type LintItem } from './context.js';
import { standsOn, tucksUnder } from './surfaces.js';

/** True when two floor items may share plan space by their facts or by height. */
function combine(a: LintItem, b: LintItem): boolean {
  if (standsOn(a, b) || standsOn(b, a) || tucksUnder(a, b) || tucksUnder(b, a)) return true;
  // Stacked: one band ends where the other starts (what stands on a top above a seat tucked under it).
  if (a.y >= b.y + b.dims[1] - TOUCH_TOL_M || b.y >= a.y + a.dims[1] - TOUCH_TOL_M) return true;
  // A seat tucked under some host reaches no higher than its tuck height inside that host.
  const raised = a.y > b.y ? a : b;
  const low = raised === a ? b : a;
  return raised.surfaces.onSurface === true && low.surfaces.tuck !== undefined && low.surfaces.tuck.height <= raised.y + TOUCH_TOL_M;
}

/** The issue two items raise, or `null` when they may share the place. */
function pairIssue(a: LintItem, b: LintItem): LayoutIssue | null {
  if (a.quad && b.quad) {
    if (apart(a.quad, b.quad)) return null;
    const depth = overlapDepth(a.quad, b.quad);
    if (depth <= TOUCH_TOL_M) return null;
    if (combine(a, b)) return null;
    return {
      rule: 'no-interpenetration',
      severity: 'error',
      ids: [a.placement.id, b.placement.id],
      message: `${a.placement.id} and ${b.placement.id} overlap by ${depth.toFixed(2)} m`,
      at: quadCentre([boxCentre(a.box!), boxCentre(b.box!)]),
    };
  }
  return mountIssue(a, b);
}

/**
 * Two wall pieces, or two ceiling pieces, in one place: their plan bodies
 * overlap AND so do their height bands, so a
 * mirror above a towel rail on the same face is fine and a picture sunk into
 * a mirror is not. A wall piece and a ceiling piece never meet here.
 */
function mountIssue(a: LintItem, b: LintItem): LayoutIssue | null {
  if (!a.mount || !b.mount || a.anchor !== b.anchor) return null;
  const vertical = Math.min(a.mount.high, b.mount.high) - Math.max(a.mount.low, b.mount.low);
  if (vertical <= TOUCH_TOL_M) return null;
  if (apart(a.mount.quad, b.mount.quad)) return null;
  const depth = overlapDepth(a.mount.quad, b.mount.quad);
  if (depth <= TOUCH_TOL_M) return null;
  return {
    rule: 'no-interpenetration',
    severity: 'error',
    ids: [a.placement.id, b.placement.id],
    message: `${a.placement.id} and ${b.placement.id} overlap by ${depth.toFixed(2)} m on the ${a.anchor}`,
    at: quadCentre([quadCentre(a.mount.quad), quadCentre(b.mount.quad)]),
  };
}

function ruleOverlap(ctx: LintContext, out: LayoutIssue[]): void {
  const items = ctx.items;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const issue = pairIssue(items[i]!, items[j]!);
      if (issue) out.push(issue);
    }
  }
}

function itemOverlap(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  for (const other of ctx.items) {
    if (other.placement.id === item.placement.id) continue;
    const issue = pairIssue(item, other);
    if (issue) out.push(issue);
  }
}

export const NO_INTERPENETRATION: LayoutRuleModule = { id: 'no-interpenetration', severity: 'error', run: ruleOverlap, item: itemOverlap };
