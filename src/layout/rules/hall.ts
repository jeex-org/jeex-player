/**
 * Rule 14 (soft): the hall stays walkable — a coat rack clear of every door
 * swing, a mirror centred over the piece it belongs to, and the axis from the
 * front door into the flat left free.
 *
 * Pure module: no `three`, no DOM.
 */

import { dist, dot, sub } from '../../plan/plan-geometry.js';
import { overlapDepth, quadCentre } from '../layout-geometry.js';
import { doorSweepQuads } from '../../plan/door-swing.js';
import {
  TOUCH_TOL_M,
  boxCentre,
  pointToBox,
  positionOf,
  sideZone,
  type LayoutIssue,
  type LayoutRuleModule,
  type LintContext,
} from './context.js';
import { ARCHETYPE } from '../../assets/catalogue-ids.js';

/** A coat rack must keep this clear of every door sweep, metres. */
const COAT_RACK_CLEAR_M = 0.6;
/** How far off the centre of its host a mirror may hang, metres. */
const MIRROR_OFFSET_M = 0.25;
/** The entrance axis: how much of the opening width it spans, and how far it reaches, metres. */
const ENTRANCE_AXIS_SPAN = 0.7;
const ENTRANCE_AXIS_DEPTH_M = 1.5;
/** Archetypes a wall mirror is expected to hang over. */
const MIRROR_HOSTS: ReadonlySet<string> = new Set([
  ARCHETYPE.console_hall,
  ARCHETYPE.cabinet_shoe,
  ARCHETYPE.dresser,
  ARCHETYPE.vanity_sink,
]);

function ruleHall(ctx: LintContext, out: LayoutIssue[]): void {
  for (const rack of ctx.items.filter((item) => item.box && item.archetype === ARCHETYPE.coat_rack)) {
    for (const door of ctx.doors) {
      if (!door.swing) continue;
      let closest = Infinity;
      for (const quad of doorSweepQuads(door.swing)) {
        for (const corner of quad) closest = Math.min(closest, pointToBox(rack.box!, corner));
      }
      if (closest >= COAT_RACK_CLEAR_M) continue;
      out.push({
        rule: 'hall',
        severity: 'warning',
        ids: [rack.placement.id, door.openingId],
        message: `${rack.placement.id} stands ${closest.toFixed(2)} m from the swing of ${door.openingId}`,
        at: boxCentre(rack.box!),
      });
    }
  }

  const hosts = ctx.items.filter((item) => item.box && MIRROR_HOSTS.has(item.archetype));
  for (const mirror of ctx.items.filter((item) => item.archetype === ARCHETYPE.mirror_round)) {
    const centre = positionOf(mirror);
    if (hosts.length === 0) continue;
    const host = hosts
      .filter((item) => item.roomId === mirror.roomId)
      .sort((a, b) => dist(boxCentre(a.box!), centre) - dist(boxCentre(b.box!), centre))[0];
    if (!host) continue;
    const sideways = Math.abs(dot(sub(boxCentre(host.box!), centre), { x: -mirror.front.z, z: mirror.front.x }));
    if (sideways <= MIRROR_OFFSET_M) continue;
    out.push({
      rule: 'hall',
      severity: 'warning',
      ids: [mirror.placement.id, host.placement.id],
      message: `${mirror.placement.id} is ${sideways.toFixed(2)} m off the centre of ${host.placement.id}`,
      at: centre,
    });
  }

  const entrance = ctx.doors.find((door) => door.wall.openings?.some((opening) => opening.id === door.openingId && opening.entrance));
  if (!entrance) return;
  for (const side of entrance.sides) {
    const axis = sideZone(entrance, side.normal, entrance.width * ENTRANCE_AXIS_SPAN, ENTRANCE_AXIS_DEPTH_M);
    for (const item of ctx.items) {
      if (!item.quad) continue;
      if (overlapDepth(item.quad, axis) <= TOUCH_TOL_M) continue;
      out.push({
        rule: 'hall',
        severity: 'warning',
        ids: [entrance.openingId, item.placement.id],
        message: `${item.placement.id} stands on the axis from ${entrance.openingId} into ${side.roomId}`,
        at: quadCentre(axis),
      });
    }
  }
}

export const HALL: LayoutRuleModule = { id: 'hall', severity: 'warning', run: ruleHall };
