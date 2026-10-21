/**
 * Which room of a solved plan a point stands in.
 *
 * One lookup for everything that asks it: the layout linter and the editing
 * tools for furniture, and the viewer's anonymous room-time measurement.
 * It lives in the plan layer, beside the polygons it reads, so a caller that
 * only needs the answer does not pull the whole linter into its bundle.
 *
 * Pure module: no `three`, no DOM.
 */

import { pointInPolygon } from './plan-geometry.js';
import type { SolvedPlan } from './plan-solver.js';
import type { Vec2 } from '../scene/types.js';

/** The room a plan point stands in, `null` outside every room polygon. */
export function roomOf(plan: SolvedPlan, point: Vec2): string | null {
  for (const room of plan.rooms) {
    // The bounding box first: a drag's mask asks this for thousands of points.
    const box = room.bbox;
    if (point.x < box.minX || point.x > box.maxX || point.z < box.minZ || point.z > box.maxZ) continue;
    if (pointInPolygon(point, room.polygon)) return room.roomId;
  }
  return null;
}
