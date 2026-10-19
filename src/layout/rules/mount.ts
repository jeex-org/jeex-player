/**
 * Where an object may be at all, by its anchor: rules 7a-7d, all hard.
 *
 * - `on-floor`: a floor item's footprint lies inside ONE room polygon — not
 *   outside the flat, not across a threshold into the next room — and it
 *   stands on the floor, or on a host's top when its facts allow
 *   (`surfaces.ts`).
 * - `ceiling-hung`: a ceiling item hangs inside a room that HAS a ceiling (a
 *   loggia has none), with its body under the ceiling plane and above its
 *   lowest allowed point.
 * - `height-fit`: a floor item is no taller than the ceiling; a wall item's
 *   body stays between the floor and the ceiling.
 * - `wall-facing`: a wall item faces into the room from the face it hangs on,
 *   within 1°.
 *
 * Every check is per item, so the drag tool asks exactly these functions
 * (`asset-legality.ts`). Pivots: a floor item at the floor centre of
 * its footprint, a wall item at the centre of its volume, a ceiling item at
 * the top of its body.
 *
 * Pure module: no `three`, no DOM.
 */

import { distanceToPolygon, pointInPolygon } from '../../plan/plan-geometry.js';
import { effectiveRoom, type Vec2 } from '../../scene/types.js';
import {
  TOUCH_TOL_M,
  faceLabel,
  nearestFace,
  positionOf,
  type LayoutIssue,
  type LayoutRuleModule,
  type LintContext,
  type LintItem,
} from './context.js';
import type { RoomFace } from '../../plan/plan-solver.js';
import { supportOf } from './surfaces.js';

/** How far off its face's inward normal a wall item may look, radians (1°). */
export const WALL_FACING_TOL_RAD = Math.PI / 180;

/** Whether every corner of `quad` lies in `polygon`, or within the touch tolerance of its boundary. */
function quadInside(quad: readonly Vec2[], polygon: readonly Vec2[]): boolean {
  for (const corner of quad) {
    if (pointInPolygon(corner, polygon)) continue;
    if (distanceToPolygon(corner, polygon).distance > TOUCH_TOL_M) return false;
  }
  return true;
}

function roomFace(ctx: LintContext, roomId: string | null): RoomFace | undefined {
  return roomId === null ? undefined : ctx.plan.rooms.find((room) => room.roomId === roomId);
}

function itemOnFloor(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  if (item.anchor !== 'floor' || !item.quad) return;
  const own = roomFace(ctx, item.roomId);
  if (own && quadInside(item.quad, own.polygon)) {
    // Off the floor only on a host's top, by the facts of both.
    if (item.y <= TOUCH_TOL_M || supportOf(item, ctx.items)) return;
    out.push({
      rule: 'on-floor',
      severity: 'error',
      ids: [item.placement.id],
      message: `${item.placement.id} stands ${item.y.toFixed(2)} m above the floor on no top that may hold it`,
      at: positionOf(item),
    });
    return;
  }
  const at = positionOf(item);
  out.push({
    rule: 'on-floor',
    severity: 'error',
    ids: [item.placement.id],
    message:
      item.roomId === null
        ? `${item.placement.id} stands outside every room`
        : `${item.placement.id} does not fit inside room ${item.roomId}: its footprint crosses the room's outline`,
    at,
  });
}

function ruleOnFloor(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) itemOnFloor(ctx, item, out);
}

function hasCeiling(ctx: LintContext, roomId: string): boolean {
  const room = ctx.scene.rooms.find((candidate) => candidate.id === roomId);
  return room !== undefined && effectiveRoom(room).kind !== 'loggia';
}

function itemCeilingHung(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  if (item.anchor !== 'ceiling' || !item.mount) return;
  const at = positionOf(item);
  const id = item.placement.id;
  if (item.roomId === null || !hasCeiling(ctx, item.roomId)) {
    out.push({
      rule: 'ceiling-hung',
      severity: 'error',
      ids: [id],
      message: item.roomId === null ? `${id} hangs outside every room` : `${id} hangs in ${item.roomId}, which has no ceiling`,
      at,
    });
    return;
  }
  const ceiling = ctx.scene.ceilingHeight;
  // The lowest point the body may reach: the archetype's own bottom mark when
  // it declares one, else the floor.
  const lowest = item.layout?.mount?.bottom ?? 0;
  if (item.mount.high > ceiling + TOUCH_TOL_M || item.mount.low < lowest - TOUCH_TOL_M) {
    out.push({
      rule: 'ceiling-hung',
      severity: 'error',
      ids: [id],
      message: `${id} spans ${item.mount.low.toFixed(2)}..${item.mount.high.toFixed(2)} m; it must hang between ${lowest.toFixed(2)} m and the ${ceiling.toFixed(2)} m ceiling`,
      at,
    });
  }
}

function ruleCeilingHung(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) itemCeilingHung(ctx, item, out);
}

function itemHeightFit(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  const ceiling = ctx.scene.ceilingHeight;
  const id = item.placement.id;
  if (item.anchor === 'floor') {
    const top = item.y + item.dims[1];
    // An object resting on a host stands on its top; the floor rule measures from where it stands.
    if (top <= ceiling + TOUCH_TOL_M) return;
    out.push({
      rule: 'height-fit',
      severity: 'error',
      ids: [id],
      message: `${id} is ${item.dims[1].toFixed(2)} m tall and does not fit under the ${ceiling.toFixed(2)} m ceiling`,
      at: positionOf(item),
    });
    return;
  }
  if (item.anchor !== 'wall' || !item.mount) return;
  if (item.mount.low >= -TOUCH_TOL_M && item.mount.high <= ceiling + TOUCH_TOL_M) return;
  out.push({
    rule: 'height-fit',
    severity: 'error',
    ids: [id],
    message: `${id} spans ${item.mount.low.toFixed(2)}..${item.mount.high.toFixed(2)} m, outside the wall's 0..${ceiling.toFixed(2)} m`,
    at: positionOf(item),
  });
}

function ruleHeightFit(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) itemHeightFit(ctx, item, out);
}

function itemWallFacing(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  if (item.anchor !== 'wall') return;
  const centre = positionOf(item);
  const near = nearestFace(ctx.plan, item.roomId, centre) ?? nearestFace(ctx.plan, null, centre);
  if (!near) return;
  const normal = near.face.normal;
  const cross = item.front.x * normal.z - item.front.z * normal.x;
  const dot = item.front.x * normal.x + item.front.z * normal.z;
  const off = Math.abs(Math.atan2(cross, dot));
  if (off <= WALL_FACING_TOL_RAD) return;
  out.push({
    rule: 'wall-facing',
    severity: 'error',
    ids: [item.placement.id, near.face.wallId],
    message: `${item.placement.id} is turned ${((off * 180) / Math.PI).toFixed(1)}° away from ${faceLabel(near.face)}`,
    at: centre,
  });
}

function ruleWallFacing(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) itemWallFacing(ctx, item, out);
}

export const ON_FLOOR: LayoutRuleModule = { id: 'on-floor', severity: 'error', run: ruleOnFloor, item: itemOnFloor };
export const CEILING_HUNG: LayoutRuleModule = { id: 'ceiling-hung', severity: 'error', run: ruleCeilingHung, item: itemCeilingHung };
export const HEIGHT_FIT: LayoutRuleModule = { id: 'height-fit', severity: 'error', run: ruleHeightFit, item: itemHeightFit };
export const WALL_FACING: LayoutRuleModule = { id: 'wall-facing', severity: 'error', run: ruleWallFacing, item: itemWallFacing };
