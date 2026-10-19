/**
 * Objects that combine by position:
 * a lamp standing on a table's top, a chair tucked under its knee space.
 *
 * Both are catalogue facts of the two objects (`LintItem.surfaces`), never a
 * guess from names or sizes: an object without `onSurface` stands on nothing,
 * a host without `top` holds nothing, a seat without `tuck` goes under
 * nothing, a host without `kneeSpace` lets nothing under.
 *
 * `no-interpenetration` (`overlap.ts`) asks these predicates before it calls
 * an overlap; `on-floor` (`mount.ts`) asks `supportOf` for an object off the
 * floor; `dining-tuck` (`seating.ts`) reads the same tuck geometry; the drag
 * (`asset-pose.ts`) asks `topUnder` where an object would rise to.
 *
 * Pure module: no `three`, no DOM.
 */

import { dot } from '../../plan/plan-geometry.js';
import { quadContains } from '../layout-geometry.js';
import { TOUCH_TOL_M, support, type LintItem } from './context.js';
import type { KneeSide } from '../../assets/asset-types.js';
import { mirroredSide } from '../../scene/mirror.js';
import type { Vec2 } from '../../scene/types.js';

/** How far inside a top's edge a standing footprint must stay, metres. */
export const TOP_INSET_M = 0.02;
/** How far a seat's front may look off a knee side's inward normal: 30°. */
export const TUCK_FACING_COS = Math.cos(Math.PI / 6);

/** The height a host's top stands at, `null` for an object that holds nothing. */
export function topHeight(host: LintItem): number | null {
  const top = host.surfaces.top;
  return top && host.anchor === 'floor' && host.quad ? host.y + top.y : null;
}

/** Whether `quad` lies on `host`'s top, `TOP_INSET_M` inside its edge. */
export function onTop(host: LintItem, quad: readonly Vec2[]): boolean {
  return host.quad !== null && quadContains(host.quad, quad, -TOP_INSET_M);
}

/** True when `item` stands on `host`'s top: allowed to, at its height, fully inside it. */
export function standsOn(item: LintItem, host: LintItem): boolean {
  if (!item.surfaces.onSurface || !item.quad || item.placement.id === host.placement.id) return false;
  const height = topHeight(host);
  return height !== null && Math.abs(item.y - height) <= TOUCH_TOL_M && onTop(host, item.quad);
}

/** The item `item` stands on among `items`, `null` when it stands on none. */
export function supportOf(item: LintItem, items: readonly LintItem[]): LintItem | null {
  for (const host of items) if (standsOn(item, host)) return host;
  return null;
}

/** The highest top among `items` that would hold `quad`, with its height. */
export function topUnder(items: readonly LintItem[], quad: readonly Vec2[], skip: string): { host: LintItem; y: number } | null {
  let best: { host: LintItem; y: number } | null = null;
  for (const host of items) {
    if (host.placement.id === skip) continue;
    const y = topHeight(host);
    if (y === null || (best && best.y >= y) || !onTop(host, quad)) continue;
    best = { host, y };
  }
  return best;
}

/**
 * The OUTWARD normal of one side of `host` in plan. Sides are named in the
 * builder frame: `front` is the side the unmirrored object faces,
 * `right` the builder's +X; a mirror moves them (`mirroredSide`). The one
 * place that turns a side name into a direction.
 */
export function sideNormal(host: LintItem, named: KneeSide): Vec2 {
  // Sides are read in the unmirrored builder frame, after the mirror moved them: `host.front`
  // already looks the way a `z` mirror turned it, so it is turned back first.
  const mirror = host.placement.mirror;
  const side = mirroredSide(named, mirror);
  const front = mirror?.z === true ? { x: -host.front.x, z: -host.front.z } : host.front;
  // The builder's +X, a quarter turn from its front (−Z) seen from above.
  const right: Vec2 = { x: -front.z, z: front.x };
  if (side === 'front') return front;
  if (side === 'back') return { x: -front.x, z: -front.z };
  if (side === 'right') return right;
  return { x: -right.x, z: -right.z };
}

/** How far `item`'s footprint reaches into `host`'s across the side whose outward normal is `normal`, metres. */
export function entryDepth(item: LintItem, host: LintItem, normal: Vec2): number {
  const edge = dot({ x: host.box!.x, z: host.box!.z }, normal) + support(host.box!, normal);
  let deepest = -Infinity;
  for (const corner of item.quad!) deepest = Math.max(deepest, edge - dot(corner, normal));
  return deepest;
}

/**
 * True when `item` is tucked under `host`: both on the floor, the seat
 * low enough for the knee space, facing the host across a listed side within
 * 30°, and no deeper in than its own `tuck.depth` (and the host's knee depth).
 */
export function tucksUnder(item: LintItem, host: LintItem): boolean {
  const tuck = item.surfaces.tuck;
  const knee = host.surfaces.kneeSpace;
  if (!tuck || !knee || !item.box || !item.quad || !host.box) return false;
  if (item.y > TOUCH_TOL_M || host.y > TOUCH_TOL_M || tuck.height > knee.height + 1e-9) return false;
  const limit = Math.min(tuck.depth, knee.depth ?? Infinity) + TOUCH_TOL_M;
  return knee.sides.some((side) => {
    const normal = sideNormal(host, side);
    // Facing the host: the seat's front looks along the side's inward normal.
    if (-dot(item.front, normal) < TUCK_FACING_COS) return false;
    return entryDepth(item, host, normal) <= limit;
  });
}
