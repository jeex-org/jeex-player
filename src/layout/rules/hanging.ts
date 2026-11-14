/**
 * Where over the floor a ceiling piece may hang: rule 7e, hard, and rule 15,
 * soft.
 *
 * - `over-host`: a ceiling piece whose facts say `overHost` (a long-drop
 *   dining pendant) hangs with its plan centre over a host's top, and its
 *   lowest point at least `OVER_HOST_GAP_M` above that top. A host is any
 *   floor piece whose facts state a `top`, the same fact `onSurface` reads,
 *   at its scale and pose; its top counts `TOP_INSET_M` inside its edge, as
 *   for what stands on it. Over two tops, the higher one is measured.
 * - `head-room`: any ceiling piece whose plan centre is over no host's top
 *   reaches no lower than `HEAD_ROOM_M` above the floor, or is warned about.
 *   Over a top, a person does not walk under it.
 *
 * `over-host` judges one item against the rest, so the drag asks it
 * (`asset-legality.ts`) exactly as the linter does. `head-room` is a warning
 * and refuses nothing.
 *
 * Pure module: no `three`, no DOM.
 */

import { layoutIssue, positionOf, type LayoutIssue, type LayoutRuleModule, type LintContext, type LintItem } from './context.js';
import { topUnder } from './surfaces.js';

/** How far above a host's top an `overHost` piece's lowest point must stay, metres. */
export const OVER_HOST_GAP_M = 0.45;
/** The head room a ceiling piece over open floor leaves, metres above the floor. */
export const HEAD_ROOM_M = 2.0;
/** A limit met to the last float bit is met: a gap computed as the limit passes. */
const LIMIT_EPS_M = 1e-9;

/** The host top under `item`'s plan centre, the highest when there are several, `null` over none. */
function topOver(item: LintItem, items: readonly LintItem[]): { host: LintItem; y: number } | null {
  return topUnder(items, [positionOf(item)], item.placement.id);
}

function itemOverHost(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  if (item.anchor !== 'ceiling' || !item.mount || !item.surfaces.overHost) return;
  const id = item.placement.id;
  const at = positionOf(item);
  const under = topOver(item, ctx.items);
  if (!under) {
    out.push(layoutIssue('ceiling_object_not_over_host', { placement: id }, { severity: 'error', ids: [id], at }));
    return;
  }
  const gap = item.mount.low - under.y;
  if (gap >= OVER_HOST_GAP_M - LIMIT_EPS_M) return;
  const host = under.host.placement.id;
  out.push(
    layoutIssue(
      'ceiling_object_too_close_to_host',
      { placement: id, host, gap, min: OVER_HOST_GAP_M },
      { severity: 'error', ids: [id, host], at },
    ),
  );
}

function ruleOverHost(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) itemOverHost(ctx, item, out);
}

function ruleHeadRoom(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) {
    if (item.anchor !== 'ceiling' || !item.mount) continue;
    if (item.mount.low >= HEAD_ROOM_M - LIMIT_EPS_M || topOver(item, ctx.items)) continue;
    const id = item.placement.id;
    out.push(
      layoutIssue(
        'ceiling_object_low_head_room',
        { placement: id, lowest: item.mount.low, min: HEAD_ROOM_M },
        { severity: 'warning', ids: [id], at: positionOf(item) },
      ),
    );
  }
}

export const OVER_HOST: LayoutRuleModule = { id: 'over-host', severity: 'error', run: ruleOverHost, item: itemOverHost };
export const HEAD_ROOM: LayoutRuleModule = { id: 'head-room', severity: 'warning', run: ruleHeadRoom };
