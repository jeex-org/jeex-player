/**
 * Rule 3 (hard): a door keeps a clear zone on every side that owns a room.
 * Rule 4 (hard): a leaf sweeps through neither a wall nor an object.
 *
 * The swept quads come from `door-swing.ts`, the same authority
 * `opening-kinds.ts` builds the rendered leaf from, so a leaf the linter
 * clears is the leaf the viewer draws.
 *
 * Pure module: no `three`, no DOM.
 */

import { overlapDepth, quadCentre } from '../layout-geometry.js';
import { doorSweepQuads } from '../../plan/door-swing.js';
import {
  DOOR_CLEAR_M,
  DOOR_CLEAR_SPAN,
  TOUCH_TOL_M,
  apart,
  sideZone,
  type DoorZone,
  type LayoutIssue,
  type LayoutRuleModule,
  type LintContext,
  type LintItem,
} from './context.js';
import type { Vec2 } from '../../scene/types.js';

/** One clear zone: the door, the side's room, and the rectangle. */
type ClearZone = { door: DoorZone; roomId: string; quad: Vec2[] };
/** One door's swept leaf. */
type Sweep = { door: DoorZone & { swing: NonNullable<DoorZone['swing']> }; quads: Vec2[][] };

/**
 * The zones are a function of the doors alone, and a drag judges one object
 * against the same doors hundreds of times: they are built once per door list
 * (`lintContext` builds a new list per lint, so a lint never reads a stale one).
 */
const zoneCache = new WeakMap<readonly DoorZone[], { clear: ClearZone[]; sweeps: Sweep[] }>();

function zonesOf(doors: readonly DoorZone[]): { clear: ClearZone[]; sweeps: Sweep[] } {
  const cached = zoneCache.get(doors);
  if (cached) return cached;
  const clear: ClearZone[] = [];
  const sweeps: Sweep[] = [];
  for (const door of doors) {
    for (const side of door.sides) {
      clear.push({ door, roomId: side.roomId, quad: sideZone(door, side.normal, door.width * DOOR_CLEAR_SPAN, DOOR_CLEAR_M) });
    }
    if (door.swing) sweeps.push({ door: door as Sweep['door'], quads: doorSweepQuads(door.swing) });
  }
  const zones = { clear, sweeps };
  zoneCache.set(doors, zones);
  return zones;
}

function clearIssue(zone: ClearZone, item: LintItem): LayoutIssue | null {
  if (!item.quad || apart(item.quad, zone.quad)) return null;
  const depth = overlapDepth(item.quad, zone.quad);
  if (depth <= TOUCH_TOL_M) return null;
  return {
    rule: 'door-clear-zone',
    severity: 'error',
    ids: [zone.door.openingId, item.placement.id],
    message: `${item.placement.id} stands in the clear zone of ${zone.door.openingId} (${zone.roomId} side)`,
    at: quadCentre(zone.quad),
  };
}

function ruleDoorClearance(ctx: LintContext, out: LayoutIssue[]): void {
  for (const zone of zonesOf(ctx.doors).clear) {
    for (const item of ctx.items) {
      const issue = clearIssue(zone, item);
      if (issue) out.push(issue);
    }
  }
}

function itemDoorClearance(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  for (const zone of zonesOf(ctx.doors).clear) {
    const issue = clearIssue(zone, item);
    if (issue) out.push(issue);
  }
}

/** Whether a leaf's sweep passes through an item's footprint. */
function sweepHits(sweep: Sweep, item: LintItem): boolean {
  const quad = item.quad;
  if (!quad) return false;
  return sweep.quads.some((leaf) => !apart(leaf, quad) && overlapDepth(leaf, quad) > TOUCH_TOL_M);
}

function swingIssue(sweep: Sweep, id: string): LayoutIssue {
  return {
    rule: 'door-swing-path',
    severity: 'error',
    ids: [sweep.door.openingId, id],
    message: `the leaf of ${sweep.door.openingId} sweeps through ${id}`,
    at: sweep.door.swing.pivot,
  };
}

function ruleDoorSwing(ctx: LintContext, out: LayoutIssue[]): void {
  for (const sweep of zonesOf(ctx.doors).sweeps) {
    const hitWall = new Set<string>();
    for (const quad of sweep.quads) {
      for (const wall of ctx.solids) if (overlapDepth(quad, wall.quad) > TOUCH_TOL_M) hitWall.add(wall.wallId);
    }
    for (const wallId of hitWall) {
      out.push({
        rule: 'door-swing-path',
        severity: 'error',
        ids: [sweep.door.openingId, wallId],
        message: `the leaf of ${sweep.door.openingId} sweeps through wall ${wallId}`,
        at: sweep.door.swing.pivot,
      });
    }
    for (const item of ctx.items) if (sweepHits(sweep, item)) out.push(swingIssue(sweep, item.placement.id));
  }
}

function itemDoorSwing(ctx: LintContext, item: LintItem, out: LayoutIssue[]): void {
  for (const sweep of zonesOf(ctx.doors).sweeps) if (sweepHits(sweep, item)) out.push(swingIssue(sweep, item.placement.id));
}

export const DOOR_CLEAR_ZONE: LayoutRuleModule = {
  id: 'door-clear-zone',
  severity: 'error',
  run: ruleDoorClearance,
  item: itemDoorClearance,
};
export const DOOR_SWING_PATH: LayoutRuleModule = { id: 'door-swing-path', severity: 'error', run: ruleDoorSwing, item: itemDoorSwing };
