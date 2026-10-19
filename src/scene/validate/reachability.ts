/**
 * Points that fall outside every room and doorway: the one section that WARNS
 * instead of refusing.
 *
 * A navigation point, room camera or tour waypoint standing outside the flat is
 * a scene bug, but it is not unrepresentable: the viewer still renders, the
 * walk still clamps and the tour still flies. So it goes to the injected
 * `Logger` (the host's `onLog`, else the console) with the label and the
 * coordinates, and validation continues.
 *
 * Invariant: "inside" means inside a solved room polygon OR within half a wall
 * thickness plus `DOORWAY_MARGIN` of a door interval — a waypoint in a doorway
 * is legal, and the reveal is not part of either room's polygon.
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, pointInPolygon, projectOnPolyline } from '../../plan/plan-geometry.js';
import type { SolvedPlan } from '../../plan/plan-solver.js';
import type { Logger } from '../../shared/logger.js';
import type { ValidationContext } from './context.js';
import type { Vec2, Vec3 } from '../types.js';

/** Lateral tolerance around a door centreline when classifying a point, metres. */
const DOORWAY_MARGIN = 0.35;

function isInsideRoom(plan: SolvedPlan, point: Vec2): boolean {
  return plan.rooms.some((room) => pointInPolygon(point, room.polygon));
}

function isInDoorway(plan: SolvedPlan, point: Vec2): boolean {
  for (const line of plan.centrelines) {
    if (line.doors.length === 0) continue;
    const hit = projectOnPolyline(line.polyline, point);
    if (!hit || hit.distance > line.thickness / 2 + DOORWAY_MARGIN) continue;
    if (line.doors.some((door) => hit.t >= door.t0 - EPS && hit.t <= door.t1 + EPS)) return true;
  }
  return false;
}

function warnIfOutside(log: Logger, plan: SolvedPlan, label: string, point: Vec3): void {
  const flat: Vec2 = { x: point.x, z: point.z };
  if (isInsideRoom(plan, flat) || isInDoorway(plan, flat)) return;
  log.warn('point-outside-plan', `Scene validation warning: ${label} at (${point.x}, ${point.z}) is outside every room and doorway`, {
    label,
    x: point.x,
    z: point.z,
  });
}

/** Every authored point the walk or the tour will stand on, against the solved plan. */
export function checkReachablePoints(ctx: ValidationContext, plan: SolvedPlan): void {
  ctx.scene.navigation.points.forEach((point, index) => warnIfOutside(ctx.log, plan, `navigation point ${index}`, point));
  for (const roomId of Object.keys(ctx.scene.roomCameras)) {
    warnIfOutside(ctx.log, plan, `room camera ${roomId}`, ctx.scene.roomCameras[roomId]!.position);
  }
  ctx.scene.autotour.path.forEach((point, index) => warnIfOutside(ctx.log, plan, `autotour waypoint ${index}`, point));
}
