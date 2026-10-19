/**
 * Walk-mode collision and routing on solved plan data: room polygons, wall
 * centrelines with their door intervals, and furniture footprints.
 *
 * Invariant: navigation reads PLAN DATA and nothing else. Rooms come from
 * `SolvedPlan.rooms[].polygon` (already offset inwards by half the wall
 * thickness) and passages from `SolvedPlan.centrelines`; furniture arrives as
 * an `Obstacle[]` the caller resolved (`assets/asset-footprint.ts`), because
 * asking the object bank how big a sofa is would make the walk depend on the
 * catalogue four layers above it (a `navigation -> assets` dependency).
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, add, closestOnSegment, cross, dist, distanceToPolygon, len, mul, norm, pointInPolygon, sub } from '../plan/plan-geometry.js';
import type { RoomFace, SolvedPlan, WallCentreline } from '../plan/plan-solver.js';
import type { SceneData, Vec2, Vec3 } from '../scene/types.js';

export type Obstacle = { x: number; z: number; hx: number; hz: number; cos: number; sin: number };

/** Minimum clearance from a room boundary for a point to count as walkable, metres. */
const ROOM_MARGIN = 0.2;
/** Distance a clamped point is pushed inside the room boundary, metres. */
const WALL_PAD = 0.35;
/** Half-depth of the passable slab around a door opening, metres. */
const DOORWAY_HALF_DEPTH = 0.34;
/** Shrink applied to each side of a door interval before allowing a crossing, metres. */
const DOOR_SHRINK = 0.12;
/** Samples taken along a candidate walk segment. */
const TRAVERSE_SAMPLES = 24;
/** Steps of `WALL_PAD` taken towards a room centroid when the inward normal misses. */
const CENTROID_STEPS = 6;
/**
 * Standing eye height of the walker, metres.
 *
 * The one measurement walk mode, the router (`room-graph.ts`) and every leg
 * clearance test share: a route proved at one height and walked at another is a
 * route that can be blocked by a beam the walker never sees.
 */
export const EYE_HEIGHT_M = 1.65;

/** Eye height limits inside a room: floor clearance and headroom, metres. */
const EYE_MIN = 1.15;
const EYE_HEADROOM = 0.45;

type PolylineHit = {
  /** Perpendicular distance from the query point to the polyline. */
  distance: number;
  /** Position along the centreline in TRUE length units (arc length for arcs). */
  t: number;
  closest: Vec2;
};

/**
 * Projects `pt` onto a discretised centreline.
 *
 * `polyline` is a chord approximation, while `length` (and the door intervals
 * measured against it) is the true arc length, so the chord position is mapped
 * proportionally: `t = length * cumulativeChord / totalChord`.
 */
function pointOnPolyline(pt: Vec2, polyline: readonly Vec2[], length: number): PolylineHit | null {
  if (polyline.length < 2) return null;
  let total = 0;
  for (let i = 0; i + 1 < polyline.length; i += 1) total += dist(polyline[i]!, polyline[i + 1]!);
  if (total < EPS) return null;

  let best: PolylineHit | null = null;
  let travelled = 0;
  for (let i = 0; i + 1 < polyline.length; i += 1) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const segment = dist(a, b);
    const hit = closestOnSegment(pt, a, b);
    const distance = dist(pt, hit.point);
    if (!best || distance < best.distance) {
      best = { distance, t: (length * (travelled + hit.t * segment)) / total, closest: hit.point };
    }
    travelled += segment;
  }
  return best;
}

/** Intersection point of the segments `a-b` and `c-d`, or `null` when they miss or are parallel. */
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const ac = sub(c, a);
  const t = cross(ac, s) / denom;
  const u = cross(ac, r) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return add(a, mul(r, t));
}

/** One point at which a straight walk crosses a wall centreline. */
export type Crossing = {
  readonly centreline: WallCentreline;
  /** Where the two lines met, in plan metres. */
  readonly point: Vec2;
  /** Travel of that point along the centreline, in true length units from `a`. */
  readonly t: number;
};

/**
 * Walks every crossing of the straight segment `from -> to` with a wall
 * centreline and hands each to `visit`; a `visit` that answers `true` stops the
 * walk and becomes the result.
 *
 * The ONE traversal: `crossesClosedDoor` and `canTraverse` both ask a yes/no
 * question of the same nested loop over `plan.centrelines` and its segments,
 * written once so the two predicates cannot drift apart.
 *
 * A crossing whose travel cannot be measured is skipped rather than reported:
 * `pointOnPolyline` only answers `null` for a polyline with no segments, and a
 * polyline with no segments has nothing to intersect.
 */
function forEachCrossedCentreline(plan: SolvedPlan, from: Vec2, to: Vec2, visit: (crossing: Crossing) => boolean): boolean {
  for (const centreline of plan.centrelines) {
    for (let i = 0; i + 1 < centreline.polyline.length; i += 1) {
      const point = segmentsIntersect(from, to, centreline.polyline[i]!, centreline.polyline[i + 1]!);
      if (!point) continue;
      const at = pointOnPolyline(point, centreline.polyline, centreline.length);
      if (!at) continue;
      if (visit({ centreline, point, t: at.t })) return true;
    }
  }
  return false;
}

/**
 * Every crossing of the straight segment `from -> to` with a wall centreline,
 * in no particular order. The tour's checkpoint route judges each one against
 * the wall's openings (`tour-legs.ts`), which `canTraverse`'s yes/no cannot
 * answer: a window is not a door, but a leg may still pass through one.
 */
export function wallCrossings(plan: SolvedPlan, from: Vec2, to: Vec2): Crossing[] {
  const crossings: Crossing[] = [];
  forEachCrossedCentreline(plan, from, to, (crossing) => {
    crossings.push(crossing);
    return false;
  });
  return crossings;
}

/**
 * The wall whose BODY holds `point` (within half its thickness of the
 * centreline, plus `reach` beyond either face), with the point's travel along
 * it, or `null` in open space. Where two walls meet, the nearer centreline
 * answers.
 */
export function wallBodyAt(plan: SolvedPlan, point: Vec2, reach = 0): { centreline: WallCentreline; t: number } | null {
  let best: { centreline: WallCentreline; t: number; distance: number } | null = null;
  for (const centreline of plan.centrelines) {
    const hit = pointOnPolyline(point, centreline.polyline, centreline.length);
    if (!hit || hit.distance > centreline.thickness / 2 + reach) continue;
    if (!best || hit.distance < best.distance) best = { centreline, t: hit.t, distance: hit.distance };
  }
  return best ? { centreline: best.centreline, t: best.t } : null;
}

/** True when `t` falls inside a door interval of `centreline`, shrunk by `shrink` on each side. */
function inDoorInterval(centreline: WallCentreline, t: number, shrink = 0): boolean {
  return doorIntervalAt(centreline, t, shrink) !== null;
}

/** The door interval `t` falls in, shrunk by `shrink` on each side, or `null`. */
function doorIntervalAt(centreline: WallCentreline, t: number, shrink = 0): WallCentreline['doors'][number] | null {
  return centreline.doors.find((door) => t > door.t0 + shrink && t < door.t1 - shrink) ?? null;
}

/**
 * True when the straight walk `from -> to` passes through the doorway of a door
 * that is closed (or closing).
 *
 * `closed` is the view state of the leaves (`door-state.ts`), never the
 * document: a closed door changes what the walker may do, not what the
 * apartment IS. Only crossings INSIDE a door interval are considered — the
 * solid wall beside it is `canTraverse`'s business — and only the intervals
 * whose `openingId` the caller named, so a passage (which has no door state)
 * can never block anything.
 */
export function crossesClosedDoor(plan: SolvedPlan, closed: ReadonlySet<string>, from: Vec3, to: Vec3): boolean {
  if (closed.size === 0) return false;
  return forEachCrossedCentreline(plan, from, to, ({ centreline, t }) => {
    const door = doorIntervalAt(centreline, t);
    return door !== null && closed.has(door.openingId);
  });
}

/** True when the point lies inside a room polygon with at least `margin` clearance. */
export function isNavigable(plan: SolvedPlan, point: Vec3, margin = ROOM_MARGIN): boolean {
  for (const room of plan.rooms) {
    if (!pointInPolygon(point, room.polygon)) continue;
    if (distanceToPolygon(point, room.polygon).distance >= margin) return true;
  }
  return false;
}

/** True when the point lies inside a doorway passage (wall body around a door opening). */
export function isInDoorway(plan: SolvedPlan, point: Vec3): boolean {
  return doorwayAt(plan, point) !== null;
}

/**
 * The opening whose doorway passage (wall body around a door opening) holds
 * the point, or `null`. `isInDoorway` asks the same question as a yes/no; the
 * tour route needs the id, because a camera gliding through a door must pass
 * under THAT door's head (`tour-legs.ts`).
 */
export function doorwayAt(plan: SolvedPlan, point: Vec2): string | null {
  for (const centreline of plan.centrelines) {
    const hit = pointOnPolyline(point, centreline.polyline, centreline.length);
    if (!hit) continue;
    if (hit.distance > centreline.thickness / 2 + DOORWAY_HALF_DEPTH) continue;
    const door = doorIntervalAt(centreline, hit.t);
    if (door) return door.openingId;
  }
  return null;
}

/** Room whose polygon boundary is closest to the point, with that closest point. */
function nearestRoom(plan: SolvedPlan, point: Vec3): { room: RoomFace; closest: Vec2; distance: number } | null {
  let best: { room: RoomFace; closest: Vec2; distance: number } | null = null;
  for (const room of plan.rooms) {
    const hit = distanceToPolygon(point, room.polygon);
    if (!best || hit.distance < best.distance) best = { room, closest: hit.closest, distance: hit.distance };
  }
  return best;
}

/** Clamps eye height into the room volume and pulls stray points back inside a room. */
export function clampToNavigation(plan: SolvedPlan, ceilingHeight: number, point: Vec3): Vec3 {
  const y = Math.min(ceilingHeight - EYE_HEADROOM, Math.max(EYE_MIN, point.y));
  // Only a point the movement check would accept may pass through untouched:
  // "inside the raw polygon" also covers the ROOM_MARGIN band that
  // `isNavigable` rejects, which is what made clamped positions sticky.
  if (isNavigable(plan, point) || isInDoorway(plan, point)) return { ...point, y };

  const nearest = nearestRoom(plan, point);
  if (!nearest) return { ...point, y };
  const { room, closest } = nearest;

  const centre = polygonCentroid(room);
  const toCentre = norm(sub(centre, closest));
  // The point sits outside, so its own direction to the boundary IS the inward
  // normal there: perpendicular on an edge, radial at a vertex of a curved wall.
  const away = sub(closest, point);
  const inward = len(away) > EPS ? norm(away) : toCentre;
  const candidate = add(closest, mul(inward, WALL_PAD));
  if (isNavigable(plan, { x: candidate.x, y, z: candidate.z })) return { x: candidate.x, y, z: candidate.z };

  // Corners and mitred joints, where the inward normal still leaves the polygon:
  // walk from the boundary towards the room centroid until the point is
  // navigable, and settle on the centroid when nothing on the way is.
  const reach = dist(closest, centre);
  for (let step = 1; step <= CENTROID_STEPS && WALL_PAD * step < reach; step += 1) {
    const along = add(closest, mul(toCentre, WALL_PAD * step));
    if (isNavigable(plan, { x: along.x, y, z: along.z })) return { x: along.x, y, z: along.z };
  }
  return { x: centre.x, y, z: centre.z };
}

/** Area centroid of a room polygon; the bbox centre can fall outside an L-shape. */
function polygonCentroid(room: RoomFace): Vec2 {
  let area = 0;
  let cx = 0;
  let cz = 0;
  const poly = room.polygon;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const w = cross(a, b);
    area += w;
    cx += (a.x + b.x) * w;
    cz += (a.z + b.z) * w;
  }
  if (Math.abs(area) < EPS) {
    return { x: (room.bbox.minX + room.bbox.maxX) / 2, z: (room.bbox.minZ + room.bbox.maxZ) / 2 };
  }
  return { x: cx / (3 * area), z: cz / (3 * area) };
}

/** True when a straight walk from `from` to `to` stays inside rooms and only crosses walls at doors. */
export function canTraverse(plan: SolvedPlan, from: Vec3, to: Vec3): boolean {
  // A door slab intentionally fails the room-margin test; without this a
  // step-by-step walk stops on the threshold and can never cross a doorway.
  if (!isNavigable(plan, to) && !isInDoorway(plan, to)) return false;
  for (let step = 1; step <= TRAVERSE_SAMPLES; step += 1) {
    const t = step / TRAVERSE_SAMPLES;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y, z: from.z + (to.z - from.z) * t };
    // Doorway slabs bridge the gap between two room polygons.
    if (!isNavigable(plan, point) && !isInDoorway(plan, point)) return false;
  }
  // A wall may only be crossed at a door, and not on its very edge.
  const throughWall = forEachCrossedCentreline(plan, from, to, ({ centreline, t }) => !inDoorInterval(centreline, t, DOOR_SHRINK));
  if (throughWall) return false;
  return true;
}

function insideObstacle(obstacle: Obstacle, x: number, z: number, pad = 0): boolean {
  const dx = x - obstacle.x;
  const dz = z - obstacle.z;
  const lx = dx * obstacle.cos - dz * obstacle.sin;
  const lz = dx * obstacle.sin + dz * obstacle.cos;
  return Math.abs(lx) <= obstacle.hx + pad && Math.abs(lz) <= obstacle.hz + pad;
}

/**
 * True when the straight path between two points passes through furniture.
 *
 * Analytic slab test in each obstacle's local frame, not point sampling: a
 * short grazing intersection between two samples would slip through.
 */
export function pathBlockedByFurniture(obstacles: readonly Obstacle[], from: Vec3, to: Vec3): boolean {
  return obstacles.some((obstacle) => segmentHitsObstacle(obstacle, from, to));
}

/** Slab (Liang-Barsky) intersection of `from -> to` with one oriented box. */
function segmentHitsObstacle(obstacle: Obstacle, from: Vec3, to: Vec3): boolean {
  const local = (x: number, z: number): Vec2 => {
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    return { x: dx * obstacle.cos - dz * obstacle.sin, z: dx * obstacle.sin + dz * obstacle.cos };
  };
  const a = local(from.x, from.z);
  const b = local(to.x, to.z);
  const d = { x: b.x - a.x, z: b.z - a.z };
  let tMin = 0;
  let tMax = 1;
  for (const axis of ['x', 'z'] as const) {
    const half = axis === 'x' ? obstacle.hx : obstacle.hz;
    const origin = a[axis];
    const delta = d[axis];
    if (Math.abs(delta) < EPS) {
      if (Math.abs(origin) > half) return false;
      continue;
    }
    const t0 = (-half - origin) / delta;
    const t1 = (half - origin) / delta;
    tMin = Math.max(tMin, Math.min(t0, t1));
    tMax = Math.min(tMax, Math.max(t0, t1));
    if (tMin > tMax) return false;
  }
  return true;
}

/** Pushes a walk target out of furniture so taps on a sofa land next to it. */
export function resolveNavigationTarget(plan: SolvedPlan, scene: SceneData, point: Vec3, obstacles: readonly Obstacle[]): Vec3 {
  let resolved = { x: point.x, y: point.y, z: point.z };
  for (const obstacle of obstacles) {
    if (!insideObstacle(obstacle, resolved.x, resolved.z, 0.16)) continue;
    const dx = resolved.x - obstacle.x;
    const dz = resolved.z - obstacle.z;
    const lx = dx * obstacle.cos - dz * obstacle.sin;
    const lz = dx * obstacle.sin + dz * obstacle.cos;
    const penX = obstacle.hx - Math.abs(lx);
    const penZ = obstacle.hz - Math.abs(lz);
    const nextLx = penX < penZ ? Math.sign(lx || 1) * (obstacle.hx + 0.22) : lx;
    const nextLz = penZ <= penX ? Math.sign(lz || 1) * (obstacle.hz + 0.22) : lz;
    resolved = {
      x: obstacle.x + nextLx * obstacle.cos + nextLz * obstacle.sin,
      y: resolved.y,
      z: obstacle.z - nextLx * obstacle.sin + nextLz * obstacle.cos,
    };
  }
  if (!isNavigable(plan, resolved)) return { ...point };
  return clampToNavigation(plan, scene.ceilingHeight, resolved);
}
