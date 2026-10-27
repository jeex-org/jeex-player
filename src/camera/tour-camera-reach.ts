/**
 * Which tour camera a run along a checkpoint route has reached: the last one
 * at or behind it, so the mini-map in `tour` marks where the tour is rather
 * than where the walker last stood.
 *
 * A camera's place on the route is the length of the route's own path up to
 * the camera's point (`TourRoute.cameras`). The player rides a smoothed curve
 * through those points, and a chord is never longer than the arc it spans, so
 * this place is never past the player's own: a camera counts as reached no
 * later than the run gets there, and the last one exactly when it ends.
 *
 * Pure module: no DOM; `three` only through the route's vectors.
 */

import { tourNavigation } from '../navigation/tour-legs.js';
import { tourRouteOf, type TourRoute } from '../scene/tour-route.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData } from '../scene/types.js';

/** A run this close behind a camera along the route has reached it, metres. */
const REACHED_M = 1e-6;

/** Each camera's distance along `route`, in tour order; empty for a route without cameras. */
function stopsOf(route: TourRoute): number[] {
  const along = [0];
  for (let i = 1; i < route.path.length; i += 1) {
    const a = route.path[i - 1]!;
    const b = route.path[i]!;
    along.push(along[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return (route.cameras ?? []).map((at) => along[at] ?? 0);
}

export class TourCameraReach {
  /** The stops of the last document asked about; a new document or plan rebuilds them once. */
  private cached: { scene: SceneData; plan: SolvedPlan; stops: readonly number[] } | null = null;

  /** The camera reached at `distance` metres along `scene`'s tour (0-based), or `null` when its tour has no cameras. */
  reached(scene: SceneData, plan: SolvedPlan, distance: number): number | null {
    if (this.cached?.scene !== scene || this.cached.plan !== plan) {
      this.cached = { scene, plan, stops: stopsOf(tourRouteOf(scene, tourNavigation(plan, scene))) };
    }
    const { stops } = this.cached;
    if (stops.length === 0) return null;
    let reached = 0;
    stops.forEach((stop, index) => {
      if (stop <= distance + REACHED_M) reached = index;
    });
    return reached;
  }
}
