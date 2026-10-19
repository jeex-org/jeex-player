/**
 * What the tour's checkpoint route asks of the walkable space: a walk from one
 * camera to the next through the openings, a yes/no for a straight hop, and
 * how high a camera may glide at a point (under a door head).
 *
 * `scene/tour-route.ts` is the ONE derivation of the route the tour rides and
 * sits above this layer; it takes a `TourNavigation` as a parameter instead of
 * building one, so the derivation stays a pure function of its inputs and the
 * `jeex-viewer/ops` entry that exports it never pulls the router in. The
 * callers that own a solved plan — the camera director and the placement
 * overlay's trajectory — build it here, once per plan.
 *
 * The walk is the plan's own: walls and doorways, the room graph walk mode
 * routes over (`room-graph.ts`), furniture ignored. The tour camera is a point
 * on a rail that may stand above a table; a camera the author put over the
 * sofa must still be reachable.
 *
 * Openings: a leg crosses a wall ONLY inside an opening's width,
 * `OPENING_SIDE_MARGIN_M` clear of either jamb, and at a height inside the opening. Doors come first (the
 * room graph); a camera no door reaches is reached through a WINDOW between
 * two rooms, crossing at the window's centre. Every crossing is a PINNED
 * waypoint of the chain — the door's or the window's centre with the height
 * band a camera must keep there — so the spline the route fits through the
 * chain passes through the opening, not beside it.
 *
 * Pure module: no `three`, no DOM.
 */

import { buildRoomGraph, routeBetween, type RouteWaypoint } from './room-graph.js';
import { buildTravelPath } from './travel-path.js';
import {
  EYE_HEIGHT_M,
  canTraverse,
  clampToNavigation,
  doorwayAt,
  isInDoorway,
  isNavigable,
  wallBodyAt,
  wallCrossings,
} from './navigation.js';
import { effectiveOpening } from '../plan/plan-openings.js';
import type { SolvedPlan, WallCentreline } from '../plan/plan-solver.js';
import type { SceneData, Vec2, Vec3 } from '../scene/types.js';

/** How far below a door head the tour camera passes through the doorway, metres. */
export const DOOR_HEAD_CLEARANCE_M = 0.25;

/** Clearance a crossing keeps from either jamb of its opening, metres. */
export const OPENING_SIDE_MARGIN_M = 0.15;
/** Clearance a window crossing keeps from the sill and the head, metres. */
export const WINDOW_HEIGHT_MARGIN_M = 0.15;
/** How far either side of a window's centre its two approach points stand, metres (a door's standoff). */
const WINDOW_STANDOFF_M = 0.45;
/** How deep beyond the wall faces an opening's passage reaches, metres (the doorway slab of `navigation.ts`). */
const PASSAGE_HALF_DEPTH_M = 0.34;

/**
 * One waypoint of a tour leg. `opening` names the opening the waypoint frames
 * or crosses — a door's two standoffs and its centre, a window's two approach
 * points and its centre — and `low`/`high` the height band a camera must keep
 * there, metres. The CENTRE of an opening is `pinned`: it is where the leg
 * crosses the wall.
 */
export type TourWaypoint = RouteWaypoint & {
  opening?: string;
  pinned?: boolean;
  low?: number;
  high?: number;
};

/** One opening as the tour sees it: where along its wall, and the height band inside it. */
type TourOpening = { id: string; kind: 'door' | 'window'; t0: number; t1: number; low: number; high: number };

/** A window the tour may pass through: its centre, the approach point on either side, its band. */
type TourWindow = { opening: TourOpening; centre: Vec2; sides: readonly [Vec2, Vec2] };

export type TourNavigation = {
  /**
   * A chain from `from` to `to`, both ends included, through the doorways
   * between their rooms; when no door joins them, through ONE window between
   * two rooms (the shortest such walk). `null` when neither exists. An end
   * that stands off the walkable area (a camera against a wall) is joined to
   * its nearest walkable point first. Each crossing is a pinned waypoint.
   */
  route(from: Vec2, to: Vec2): TourWaypoint[] | null;
  /**
   * Whether the straight hop `a -> b` crosses walls only inside openings:
   * clear of both jambs by `OPENING_SIDE_MARGIN_M`, and at a height (read off
   * the hop where it meets the wall) inside the opening's band.
   */
  throughOpenings(a: Vec3, b: Vec3): boolean;
  /** Whether `point` stands in an opening's passage: the wall body at an opening, and the slab either side of it. */
  inOpening(point: Vec2): boolean;
  /** Whether the straight hop `a -> b` stays walkable and crosses walls only at doors. */
  clear(a: Vec2, b: Vec2): boolean;
  /**
   * `chain` (a `route` answer) as the smooth line walk mode would walk, dense
   * samples from its first point to its last — the fallback when a spline
   * through the chain would leave the walkable space.
   */
  smooth(chain: readonly RouteWaypoint[]): Vec2[];
  /** Whether a single point is walkable or inside a doorway passage. */
  walkable(point: Vec2): boolean;
  /** The highest a camera may glide at `point`: under the door head in a doorway, else unbounded. */
  ceilingAt(point: Vec2): number;
};

const cache = new WeakMap<SolvedPlan, TourNavigation>();

function at(point: Vec2): Vec3 {
  return { x: point.x, y: EYE_HEIGHT_M, z: point.z };
}

/**
 * The tour's view of `plan`, memoised per solved plan: a drag rebuilds the
 * trajectory every frame and the room graph only changes with the plan.
 */
export function tourNavigation(plan: SolvedPlan, scene: SceneData): TourNavigation {
  const known = cache.get(plan);
  if (known) return known;
  const graph = buildRoomGraph(plan, scene, []);
  const openings = openingsByWall(scene);
  const heads = new Map(scene.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => [opening.id, opening.head] as const)));
  const windows = windowsOf(plan, openings);
  const inside = (point: Vec2): Vec2 => {
    if (isNavigable(plan, at(point))) return { x: point.x, z: point.z };
    const clamped = clampToNavigation(plan, scene.ceilingHeight, at(point));
    return { x: clamped.x, z: clamped.z };
  };
  const ceilingAt = (point: Vec2): number => {
    const door = doorwayAt(plan, point);
    const head = door === null ? undefined : heads.get(door);
    return head === undefined ? Number.POSITIVE_INFINITY : head - DOOR_HEAD_CLEARANCE_M;
  };
  const doorRoute = (from: Vec2, to: Vec2): TourWaypoint[] | null => {
    const start = inside(from);
    const goal = inside(to);
    const walk = routeBetween(graph, plan, start, goal, []);
    if (!walk) return null;
    const chain: TourWaypoint[] = [{ x: from.x, z: from.z }];
    if (Math.hypot(start.x - from.x, start.z - from.z) > 1e-6) chain.push(start);
    chain.push(...pinDoors(walk.slice(1, -1), (id) => bandOf(openings, id)));
    if (Math.hypot(goal.x - to.x, goal.z - to.z) > 1e-6) chain.push(goal);
    chain.push({ x: to.x, z: to.z });
    return chain;
  };
  const windowRoute = (from: Vec2, to: Vec2): TourWaypoint[] | null => {
    let best: { chain: TourWaypoint[]; length: number } | null = null;
    for (const pane of windows) {
      for (const [near, far] of [pane.sides, [pane.sides[1], pane.sides[0]] as const]) {
        const before = doorRoute(from, near);
        const after = before && doorRoute(far, to);
        if (!before || !after) continue;
        const band = { opening: pane.opening.id, low: pane.opening.low, high: pane.opening.high };
        const chain: TourWaypoint[] = [
          ...before.slice(0, -1),
          { x: near.x, z: near.z, ...band },
          { x: pane.centre.x, z: pane.centre.z, ...band, pinned: true },
          { x: far.x, z: far.z, ...band },
          ...after.slice(1),
        ];
        const length = chainLength(chain);
        if (!best || length < best.length) best = { chain, length };
      }
    }
    return best?.chain ?? null;
  };
  const navigation: TourNavigation = {
    route: (from, to) => doorRoute(from, to) ?? windowRoute(from, to),
    throughOpenings(a, b) {
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      return wallCrossings(plan, a, b).every(({ centreline, point, t }) => {
        const opening = openingAt(openings, centreline, t, OPENING_SIDE_MARGIN_M);
        if (!opening) return false;
        const y = span < 1e-9 ? a.y : a.y + (b.y - a.y) * (Math.hypot(point.x - a.x, point.z - a.z) / span);
        return y >= opening.low - 1e-6 && y <= opening.high + 1e-6;
      });
    },
    inOpening(point) {
      const hit = wallBodyAt(plan, point, PASSAGE_HALF_DEPTH_M);
      return hit !== null && openingAt(openings, hit.centreline, hit.t, 0) !== null;
    },
    clear: (a, b) => canTraverse(plan, at(a), at(b)),
    smooth: (chain) => buildTravelPath(chain, (a, b) => canTraverse(plan, at(a), at(b))).points,
    walkable: (point) => isNavigable(plan, at(point)) || isInDoorway(plan, at(point)),
    ceilingAt,
  };
  cache.set(plan, navigation);
  return navigation;
}

/**
 * A door walk with each door's crossing pinned: the router hands out the two
 * standoff points of a door; its centre (the midpoint, on the wall's
 * centreline) goes between them, and all three carry the door's band.
 */
function pinDoors(walk: readonly RouteWaypoint[], band: (id: string) => { low: number; high: number }): TourWaypoint[] {
  const out: TourWaypoint[] = [];
  for (let index = 0; index < walk.length; index += 1) {
    const point = walk[index]!;
    const next = walk[index + 1];
    if (point.door === undefined) {
      out.push(point);
      continue;
    }
    const door = { opening: point.door, ...band(point.door) };
    out.push({ ...point, ...door });
    if (next?.door !== point.door) continue;
    out.push({ x: (point.x + next.x) / 2, z: (point.z + next.z) / 2, door: point.door, ...door, pinned: true });
  }
  return out;
}

/** Every opening of every wall, along its wall, with the band a camera keeps inside it. */
function openingsByWall(scene: SceneData): Map<string, TourOpening[]> {
  const byWall = new Map<string, TourOpening[]>();
  for (const wall of scene.walls) {
    byWall.set(
      wall.id,
      (wall.openings ?? []).map((opening) => {
        const { sill, head } = effectiveOpening(opening, scene.ceilingHeight);
        const glazed = opening.type === 'window';
        const low = glazed ? sill + WINDOW_HEIGHT_MARGIN_M : 0;
        const high = glazed ? head - WINDOW_HEIGHT_MARGIN_M : head - DOOR_HEAD_CLEARANCE_M;
        const middle = (sill + head) / 2;
        return {
          id: opening.id,
          kind: glazed ? 'window' : 'door',
          t0: opening.center - opening.width / 2,
          t1: opening.center + opening.width / 2,
          low: low <= high ? low : middle,
          high: low <= high ? high : middle,
        };
      }),
    );
  }
  return byWall;
}

/** The band of the opening `id`; a door the scene does not name is unbounded. */
function bandOf(openings: ReadonlyMap<string, readonly TourOpening[]>, id: string): { low: number; high: number } {
  for (const list of openings.values()) {
    const found = list.find((opening) => opening.id === id);
    if (found) return { low: found.low, high: found.high };
  }
  return { low: 0, high: Number.POSITIVE_INFINITY };
}

/** The opening of `centreline`'s wall that `t` falls in, `margin` clear of both jambs, or `null`. */
function openingAt(
  openings: ReadonlyMap<string, readonly TourOpening[]>,
  centreline: WallCentreline,
  t: number,
  margin: number,
): TourOpening | null {
  return openings.get(centreline.wallId)?.find((opening) => t > opening.t0 + margin && t < opening.t1 - margin) ?? null;
}

/**
 * The windows a leg may pass through: those with a room on BOTH sides. A
 * facade window opens onto the street, and a camera is never routed outside.
 */
function windowsOf(plan: SolvedPlan, openings: ReadonlyMap<string, readonly TourOpening[]>): TourWindow[] {
  const windows: TourWindow[] = [];
  for (const centreline of plan.centrelines) {
    for (const opening of openings.get(centreline.wallId) ?? []) {
      if (opening.kind !== 'window') continue;
      const along = pointAlong(centreline, (opening.t0 + opening.t1) / 2);
      if (!along) continue;
      const normal = { x: -along.direction.z, z: along.direction.x };
      const sides = [-1, 1].map((sign) => ({
        x: along.point.x + normal.x * WINDOW_STANDOFF_M * sign,
        z: along.point.z + normal.z * WINDOW_STANDOFF_M * sign,
      }));
      if (!sides.every((side) => isNavigable(plan, at(side)))) continue;
      windows.push({ opening, centre: along.point, sides: [sides[0]!, sides[1]!] });
    }
  }
  return windows;
}

/** The point at travel `t` (true length units from `a`) of a centreline, and the unit direction there. */
function pointAlong(centreline: WallCentreline, t: number): { point: Vec2; direction: Vec2 } | null {
  const polyline = centreline.polyline;
  let total = 0;
  for (let index = 0; index + 1 < polyline.length; index += 1) total += flat(polyline[index]!, polyline[index + 1]!);
  if (total < 1e-9 || centreline.length < 1e-9) return null;
  let remaining = (t / centreline.length) * total;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const a = polyline[index]!;
    const b = polyline[index + 1]!;
    const segment = flat(a, b);
    if (segment < 1e-9) continue;
    if (remaining <= segment || index + 2 === polyline.length) {
      const u = Math.min(1, Math.max(0, remaining / segment));
      return {
        point: { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u },
        direction: { x: (b.x - a.x) / segment, z: (b.z - a.z) / segment },
      };
    }
    remaining -= segment;
  }
  return null;
}

function flat(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function chainLength(chain: readonly Vec2[]): number {
  let length = 0;
  for (let index = 1; index < chain.length; index += 1) length += flat(chain[index - 1]!, chain[index]!);
  return length;
}
