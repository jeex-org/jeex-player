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
 * (`asset-legality.ts`) exactly as the linter does, from both sides: a
 * dragged pendant is judged where it would hang, and a dragged host is
 * refused when an `overHost` pendant that passes in the committed scene would
 * fail with the host at its new pose (not over a top, or too close to one). A
 * pendant that already fails refuses nothing: it is the pendant's issue, not
 * the move's. `head-room` is a warning and refuses nothing.
 *
 * Pure module: no `three`, no DOM.
 */

import { obbQuad, yawBox } from '../../plan/plan-geometry.js';
import { effectiveAsset } from '../../scene/types.js';
import { layoutIssue, positionOf, type LayoutIssue, type LayoutRuleModule, type LintContext, type LintItem } from './context.js';
import { topHeight, topUnder } from './surfaces.js';

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

/** The `over-host` issue of one `overHost` pendant against the floor pieces in `items`, `null` when it passes. */
function pendantIssue(item: LintItem, items: readonly LintItem[]): LayoutIssue | null {
  if (item.anchor !== 'ceiling' || !item.mount || !item.surfaces.overHost) return null;
  const id = item.placement.id;
  const at = positionOf(item);
  const under = topOver(item, items);
  if (!under) return layoutIssue('ceiling_object_not_over_host', { placement: id }, { severity: 'error', ids: [id], at });
  const gap = item.mount.low - under.y;
  if (gap >= OVER_HOST_GAP_M - LIMIT_EPS_M) return null;
  const host = under.host.placement.id;
  return layoutIssue(
    'ceiling_object_too_close_to_host',
    { placement: id, host, gap, min: OVER_HOST_GAP_M },
    { severity: 'error', ids: [id, host], at },
  );
}

/**
 * `host` as it stands in the committed scene: the same body at its committed
 * position and yaw; `null` for a piece the scene does not carry yet (one being
 * placed).
 */
function committedHost(ctx: LintContext, host: LintItem): LintItem | null {
  const placement = ctx.scene.assets.find((asset) => asset.id === host.placement.id);
  if (!placement || !host.box) return null;
  const angle = effectiveAsset(placement).rotationY;
  const box = yawBox(placement.position.x, placement.position.z, host.box.hx, host.box.hz, angle);
  return { ...host, placement, y: placement.position.y, angle, box, quad: obbQuad(box) };
}

/**
 * The host side: every `overHost` pendant in `ctx` that passes with `host` where
 * the committed scene has it and fails with `host` at its new pose.
 */
function strandedBy(ctx: LintContext, host: LintItem, out: LayoutIssue[]): void {
  if (topHeight(host) === null) return;
  const rest = ctx.items.filter((other) => other.placement.id !== host.placement.id);
  const before = committedHost(ctx, host);
  const after = [...rest, host];
  for (const pendant of rest) {
    if (pendantIssue(pendant, before ? [...rest, before] : rest) !== null) continue;
    const issue = pendantIssue(pendant, after);
    if (issue) out.push(issue);
  }
}

function itemOverHost(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  if (item.anchor === 'floor') {
    strandedBy(ctx, item, out);
    return;
  }
  const issue = pendantIssue(item, ctx.items);
  if (issue) out.push(issue);
}

function ruleOverHost(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) {
    const issue = pendantIssue(item, ctx.items);
    if (issue) out.push(issue);
  }
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
