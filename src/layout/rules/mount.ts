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
  issueFace,
  layoutIssue,
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
    out.push(
      layoutIssue(
        'raised_without_support',
        { placement: item.placement.id, height: item.y },
        { severity: 'error', ids: [item.placement.id], at: positionOf(item) },
      ),
    );
    return;
  }
  const at = positionOf(item);
  const where = { severity: 'error' as const, ids: [item.placement.id], at };
  out.push(
    item.roomId === null
      ? layoutIssue('floor_object_outside_rooms', { placement: item.placement.id }, where)
      : layoutIssue('floor_object_crosses_room', { placement: item.placement.id, room: item.roomId }, where),
  );
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
    const where = { severity: 'error' as const, ids: [id], at };
    out.push(
      item.roomId === null
        ? layoutIssue('ceiling_object_outside_rooms', { placement: id }, where)
        : layoutIssue('ceiling_object_without_ceiling', { placement: id, room: item.roomId }, where),
    );
    return;
  }
  const ceiling = ctx.scene.ceilingHeight;
  // The lowest point the body may reach: the archetype's own bottom mark when
  // it declares one, else the floor.
  const lowest = item.layout?.mount?.bottom ?? 0;
  if (item.mount.high > ceiling + TOUCH_TOL_M || item.mount.low < lowest - TOUCH_TOL_M) {
    out.push(
      layoutIssue(
        'ceiling_object_out_of_band',
        { placement: id, low: item.mount.low, high: item.mount.high, lowest, ceiling },
        { severity: 'error', ids: [id], at },
      ),
    );
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
    out.push(
      layoutIssue(
        'object_taller_than_ceiling',
        { placement: id, height: item.dims[1], ceiling },
        { severity: 'error', ids: [id], at: positionOf(item) },
      ),
    );
    return;
  }
  if (item.anchor !== 'wall' || !item.mount) return;
  if (item.mount.low >= -TOUCH_TOL_M && item.mount.high <= ceiling + TOUCH_TOL_M) return;
  out.push(
    layoutIssue(
      'wall_object_out_of_height',
      { placement: id, low: item.mount.low, high: item.mount.high, ceiling },
      { severity: 'error', ids: [id], at: positionOf(item) },
    ),
  );
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
  out.push(
    layoutIssue(
      'wall_object_turned',
      { placement: item.placement.id, face: issueFace(near.face), degrees: (off * 180) / Math.PI },
      { severity: 'error', ids: [item.placement.id, near.face.wallId], at: centre },
    ),
  );
}

function ruleWallFacing(ctx: LintContext, out: LayoutIssue[]): void {
  for (const item of ctx.items) itemWallFacing(ctx, item, out);
}

export const ON_FLOOR: LayoutRuleModule = { id: 'on-floor', severity: 'error', run: ruleOnFloor, item: itemOnFloor };
export const CEILING_HUNG: LayoutRuleModule = { id: 'ceiling-hung', severity: 'error', run: ruleCeilingHung, item: itemCeilingHung };
export const HEIGHT_FIT: LayoutRuleModule = { id: 'height-fit', severity: 'error', run: ruleHeightFit, item: itemHeightFit };
export const WALL_FACING: LayoutRuleModule = { id: 'wall-facing', severity: 'error', run: ruleWallFacing, item: itemWallFacing };
