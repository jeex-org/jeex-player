/**
 * The apartment as a graph of rooms joined by their doorways, and the shortest
 * walk from anywhere to a room's centre over it.
 *
 * A mini-map click asks for a room, not for a straight line: cutting the camera
 * through a wall would throw away the one thing a walkthrough is for. So the
 * plan is read as a graph — one node per room at its navigable centre, one node
 * per door-like opening that joins TWO rooms — and Dijkstra over it answers
 * with the doors to pass through. The entrance door joins a room to the street
 * and is therefore never an edge.
 *
 * Invariants (see `room-graph.test.ts`):
 * - a route's waypoints are all navigable or inside a doorway slab, and every
 *   leg passes `canTraverse` and clears the furniture, so the walk controller
 *   can follow the route with its ordinary collision rules and never stall;
 * - the door waypoints sit `DOOR_STANDOFF_M` before and after the door centre
 *   ALONG THE WALL NORMAL, so the camera squares up to the opening instead of
 *   clipping the jamb on a diagonal;
 * - a leg no straight line can make is retried through the centre of the room
 *   it crosses, then around the furniture on a coarse grid of standing points
 *   inside that room; if nothing gets through, the answer is `null` and the
 *   caller falls back to a fly-in (`hint.noClearPath`).
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, add, cross, dist, leftN, mul, norm, pointInPolygon, sub } from '../plan/plan-geometry.js';
import { ViewerLibError } from '../shared/errors.js';
import { EYE_HEIGHT_M, canTraverse, isNavigable, pathBlockedByFurniture, resolveNavigationTarget, type Obstacle } from './navigation.js';
import type { RoomFace, SolvedPlan, WallCentreline } from '../plan/plan-solver.js';
import type { SceneData, Vec2, Vec3 } from '../scene/types.js';

/** How far before and after a door centre a waypoint sits, metres. */
export const DOOR_STANDOFF_M = 0.45;

/** Two waypoints closer than this are one waypoint. */
const MERGE_M = 0.02;

/** Spacing of the standing points a blocked leg detours through, metres. */
const DETOUR_GRID_M = 0.4;
/** Clearance a detour point keeps from every furniture footprint, metres. */
const DETOUR_PAD_M = 0.12;
/** Cap on the detour candidates of one room; a huge open plan must stay cheap. */
const DETOUR_LIMIT = 400;

export type RoomGraphNode = {
  /** Room id for a room node, opening id for a door node. */
  id: string;
  kind: 'room' | 'door';
  /** Room centre, or the door centre on the wall centreline. */
  point: Vec2;
  /** The one room of a room node; both rooms of a door node. */
  roomIds: string[];
  /** Unit wall normal at a door node; absent on room nodes. */
  normal?: Vec2;
};

/** `[nodeIndex, nodeIndex, metres]`; every edge joins a room to one of its doors. */
export type RoomGraph = { nodes: RoomGraphNode[]; edges: Array<[number, number, number]> };

/**
 * One waypoint of a route. `door` is set on the TWO standoff points of a
 * doorway and names the opening they belong to, so a consumer that smooths the
 * route (`travel-path.ts`) knows which leg has to stay straight and square to
 * the wall. Every other waypoint is a plain point; callers that only read
 * `x`/`z` are unaffected.
 */
export type RouteWaypoint = Vec2 & { door?: string | undefined };

function v3(point: Vec2): Vec3 {
  return { x: point.x, y: EYE_HEIGHT_M, z: point.z };
}

/** Area centroid of a polygon; the bbox centre can fall outside an L-shape. */
function centroidOf(room: RoomFace): Vec2 {
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

/**
 * Point and unit tangent at arc length `t` on a discretised centreline.
 *
 * `polyline` is a chord approximation while `t` is measured in TRUE length
 * (arc length on a curved wall), so the position is mapped proportionally, the
 * same way `navigation.pointOnPolyline` reads it back.
 */
function pointAtLength(line: WallCentreline, t: number): { point: Vec2; tangent: Vec2 } | null {
  const points = line.polyline;
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) total += dist(points[i]!, points[i + 1]!);
  if (total < EPS) return null;
  const wanted = (t / Math.max(line.length, EPS)) * total;

  let travelled = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segment = dist(a, b);
    if (segment < EPS) continue;
    if (travelled + segment >= wanted || i + 2 === points.length) {
      const local = Math.min(1, Math.max(0, (wanted - travelled) / segment));
      return { point: add(a, mul(sub(b, a), local)), tangent: norm(sub(b, a)) };
    }
    travelled += segment;
  }
  return null;
}

/** The two rooms on either side of each wall, `null` where the side is facade. */
function roomsPerWall(plan: SolvedPlan): Map<string, Array<string | null>> {
  const sides = new Map<string, Array<string | null>>();
  for (const face of plan.faces.values()) {
    const list = sides.get(face.wallId) ?? [];
    list.push(face.roomId);
    sides.set(face.wallId, list);
  }
  return sides;
}

/** Navigable centre of a room, with the obstacle list already derived. */
function centreWith(plan: SolvedPlan, scene: SceneData, roomId: string, obstacles: readonly Obstacle[]): Vec2 {
  const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
  if (!room) throw new ViewerLibError('bad-params', `room-graph: the plan has no room "${roomId}"`, { detail: { roomId } });
  const resolved = resolveNavigationTarget(plan, scene, v3(centroidOf(room)), obstacles);
  return { x: resolved.x, z: resolved.z };
}

/**
 * The room `point` stands in, or the one whose centroid is nearest to it when
 * it stands in none (a doorway slab, the site outside the flat). `null` only
 * for a plan with no rooms at all, where there is no room to name.
 *
 * This is how a scene that authored no `walkSpawn` still gets a spawn with a
 * direction: the first navigation point says where to stand, and the room it
 * lands in says which way to face.
 */
export function roomAt(plan: SolvedPlan, point: Vec2): string | null {
  const inside = plan.rooms.find((room) => pointInPolygon(point, room.polygon));
  if (inside) return inside.roomId;
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const room of plan.rooms) {
    const distance = dist(point, centroidOf(room));
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = room.roomId;
  }
  return best;
}

/**
 * The point walk mode aims at when it is asked for a room: the polygon centroid
 * pushed out of whatever furniture stands on it (`resolveNavigationTarget`).
 * Throws for a room the plan does not have — a caller that guessed an id must
 * hear about it rather than travel to the origin.
 */
export function roomCentre(plan: SolvedPlan, scene: SceneData, roomId: string, obstacles: readonly Obstacle[]): Vec2 {
  return centreWith(plan, scene, roomId, obstacles);
}

/**
 * Where a walkthrough begins, and which way it faces.
 *
 * `derived` marks a pose nobody authored. There is no such thing as a generic
 * entry pose — one apartment's coordinates are a spot inside a wall in any
 * other apartment — so a scene that authored
 * no `walkSpawn` gets one READ OFF THE PLAN:
 * stand on the first navigation point, face the centre of the room it is in.
 * The caller is expected to report a derived spawn once, naming the scene.
 *
 * `null` when the scene lists no navigation points either: then nothing in the
 * document says where a walkthrough could begin.
 */
export function walkSpawn(
  plan: SolvedPlan,
  scene: SceneData,
  obstacles: readonly Obstacle[],
): { position: Vec3; target: Vec3; derived: boolean } | null {
  const authored = scene.walkSpawn;
  if (authored) return { position: authored.position, target: authored.target, derived: false };
  const position = scene.navigation.points[0];
  if (!position) return null;
  const roomId = roomAt(plan, position);
  if (!roomId) return { position, target: position, derived: true };
  const centre = centreWith(plan, scene, roomId, obstacles);
  return { position, target: { x: centre.x, y: EYE_HEIGHT_M, z: centre.z }, derived: true };
}

/**
 * Rooms and the doors between them.
 *
 * `obstacles` is the furniture the routes must avoid, resolved by the caller
 * (`assets/asset-footprint.obstaclesFor`) — an empty list builds the graph on
 * the plan alone, which is what a scene with the furniture hidden wants.
 *
 * A door-like opening earns a node only when BOTH sides of its wall belong to a
 * room and the two are different: the entrance joins the hall to the street,
 * and a route may not offer to leave the flat.
 */
export function buildRoomGraph(plan: SolvedPlan, scene: SceneData, obstacles: readonly Obstacle[]): RoomGraph {
  const nodes: RoomGraphNode[] = [];
  const edges: Array<[number, number, number]> = [];
  const roomIndex = new Map<string, number>();

  for (const room of plan.rooms) {
    roomIndex.set(room.roomId, nodes.length);
    nodes.push({ id: room.roomId, kind: 'room', point: centreWith(plan, scene, room.roomId, obstacles), roomIds: [room.roomId] });
  }

  const sides = roomsPerWall(plan);
  const openingsById = new Map(scene.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => [opening.id, opening] as const)));

  for (const line of plan.centrelines) {
    const pair = (sides.get(line.wallId) ?? []).filter((id): id is string => id !== null);
    const [roomA, roomB] = [...new Set(pair)];
    if (!roomA || !roomB) continue;
    const a = roomIndex.get(roomA);
    const b = roomIndex.get(roomB);
    if (a === undefined || b === undefined) continue;

    for (const door of line.doors) {
      if (openingsById.get(door.openingId)?.entrance === true) continue;
      const at = pointAtLength(line, (door.t0 + door.t1) / 2);
      if (!at) continue;
      const index = nodes.length;
      nodes.push({ id: door.openingId, kind: 'door', point: at.point, roomIds: [roomA, roomB], normal: leftN(at.tangent) });
      edges.push([a, index, dist(nodes[a]!.point, at.point)], [b, index, dist(nodes[b]!.point, at.point)]);
    }
  }

  return { nodes, edges };
}

/** Neighbour lists of `graph`, built once per route. */
function adjacency(graph: RoomGraph): Array<Array<[number, number]>> {
  const list: Array<Array<[number, number]>> = graph.nodes.map(() => []);
  for (const [a, b, weight] of graph.edges) {
    list[a]?.push([b, weight]);
    list[b]?.push([a, weight]);
  }
  return list;
}

/** Cheapest chain of node indices from `start` to `goal`, or `null`. */
function shortestPath(graph: RoomGraph, start: number, goal: number): number[] | null {
  const cost = graph.nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = graph.nodes.map(() => -1);
  const settled = graph.nodes.map(() => false);
  const neighbours = adjacency(graph);
  cost[start] = 0;

  // Linear scan for the cheapest open node: a flat has tens of nodes, and a
  // heap here would be more code than the whole search.
  for (;;) {
    let current = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cost.length; i += 1) {
      if (settled[i] || cost[i]! >= best) continue;
      best = cost[i]!;
      current = i;
    }
    if (current < 0) break;
    if (current === goal) break;
    settled[current] = true;
    for (const [next, weight] of neighbours[current] ?? []) {
      const candidate = cost[current]! + weight;
      if (candidate >= cost[next]!) continue;
      cost[next] = candidate;
      previous[next] = current;
    }
  }

  if (!Number.isFinite(cost[goal]!)) return null;
  const path: number[] = [];
  for (let node = goal; node >= 0; node = previous[node]!) {
    path.unshift(node);
    if (node === start) return path;
  }
  return null;
}

/** The room node the walk starts from: the room `from` stands in, else the nearest. */
function startNode(graph: RoomGraph, plan: SolvedPlan, from: Vec2): number {
  const inside = plan.rooms.find((room) => pointInPolygon(from, room.polygon));
  if (inside) {
    const index = graph.nodes.findIndex((node) => node.kind === 'room' && node.id === inside.roomId);
    if (index >= 0) return index;
  }
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  graph.nodes.forEach((node, index) => {
    if (node.kind !== 'room') return;
    const distance = dist(from, node.point);
    if (distance >= bestDistance) return;
    bestDistance = distance;
    best = index;
  });
  return best;
}

/** True when nothing in `obstacles` covers `point`, with `pad` to spare. */
function standable(obstacles: readonly Obstacle[], point: Vec2, pad: number): boolean {
  return !obstacles.some((obstacle) => {
    const dx = point.x - obstacle.x;
    const dz = point.z - obstacle.z;
    const lx = dx * obstacle.cos - dz * obstacle.sin;
    const lz = dx * obstacle.sin + dz * obstacle.cos;
    return Math.abs(lx) <= obstacle.hx + pad && Math.abs(lz) <= obstacle.hz + pad;
  });
}

/**
 * Standing points inside one room, coarse grid, furniture excluded.
 *
 * This is what turns "retry via the room centre" into a rule that
 * survives a furnished flat: a sofa and a dining table sit ON the line between
 * a room's centre and its door, and a single fallback point cannot get round
 * them. The grid is generated only for a leg that is actually blocked.
 */
function detourCandidates(plan: SolvedPlan, roomId: string, obstacles: readonly Obstacle[]): Vec2[] {
  const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
  if (!room) return [];
  const points: Vec2[] = [];
  for (let x = room.bbox.minX + DETOUR_GRID_M / 2; x <= room.bbox.maxX && points.length < DETOUR_LIMIT; x += DETOUR_GRID_M) {
    for (let z = room.bbox.minZ + DETOUR_GRID_M / 2; z <= room.bbox.maxZ && points.length < DETOUR_LIMIT; z += DETOUR_GRID_M) {
      const point = { x, z };
      if (!pointInPolygon(point, room.polygon)) continue;
      if (!isNavigable(plan, v3(point))) continue;
      if (!standable(obstacles, point, DETOUR_PAD_M)) continue;
      points.push(point);
    }
  }
  return points;
}

/**
 * Waypoints from `from` to the centre of `toRoomId`, or `null` when no chain of
 * clear legs gets there.
 *
 * `obstacles` is the furniture the walk collides with (`obstaclesFor`); an
 * empty list routes on the plan alone, which is what a scene with the furniture
 * hidden wants.
 */
export function routeToRoom(
  graph: RoomGraph,
  plan: SolvedPlan,
  from: Vec2,
  toRoomId: string,
  obstacles: readonly Obstacle[] = [],
): RouteWaypoint[] | null {
  const goal = graph.nodes.findIndex((node) => node.kind === 'room' && node.id === toRoomId);
  if (goal < 0) return null;
  return routeThrough(graph, plan, from, goal, graph.nodes[goal]!.point, obstacles);
}

/**
 * Waypoints from `from` to the point `to` itself — not to its room's centre —
 * or `null` when no chain of clear legs gets there. The goal room is the one
 * `to` stands in (the nearest one when it stands in none), the doors on the
 * way are the ones `routeToRoom` would take, and the last waypoint IS `to`.
 *
 * The tour's checkpoint route joins two cameras with this
 * (`tour-legs.ts`): a camera is a point, and walking to the middle of its room
 * first would be a detour nobody asked for.
 */
export function routeBetween(
  graph: RoomGraph,
  plan: SolvedPlan,
  from: Vec2,
  to: Vec2,
  obstacles: readonly Obstacle[] = [],
): RouteWaypoint[] | null {
  const goal = startNode(graph, plan, to);
  if (goal < 0) return null;
  return routeThrough(graph, plan, from, goal, { x: to.x, z: to.z }, obstacles);
}

/** The shared body of the two routers: the doors to `goal`, then the last leg to `goalPoint`. */
function routeThrough(
  graph: RoomGraph,
  plan: SolvedPlan,
  from: Vec2,
  goal: number,
  goalPoint: Vec2,
  obstacles: readonly Obstacle[],
): RouteWaypoint[] | null {
  const start = startNode(graph, plan, from);
  if (start < 0) return null;
  const path = start === goal ? [start] : shortestPath(graph, start, goal);
  if (!path) return null;

  // Waypoints, and for each leg the room it runs inside — the room a blocked
  // leg is allowed to detour through. A leg THROUGH a doorway has no such room.
  const points: RouteWaypoint[] = [{ x: from.x, z: from.z }];
  const legRooms: Array<RoomGraphNode | null> = [];
  let room = graph.nodes[path[0]!]!;

  for (let i = 1; i < path.length; i += 1) {
    const node = graph.nodes[path[i]!]!;
    if (node.kind === 'room') {
      room = node;
      continue;
    }
    const normal = node.normal ?? { x: 1, z: 0 };
    const one: RouteWaypoint = { ...add(node.point, mul(normal, DOOR_STANDOFF_M)), door: node.id };
    const other: RouteWaypoint = { ...sub(node.point, mul(normal, DOOR_STANDOFF_M)), door: node.id };
    const previous = points.at(-1)!;
    const near = dist(previous, one) <= dist(previous, other) ? one : other;
    const far = near === one ? other : one;
    points.push(near);
    legRooms.push(room);
    points.push(far);
    legRooms.push(null);
  }
  points.push(goalPoint);
  legRooms.push(graph.nodes[goal]!);

  const clear = (a: Vec2, b: Vec2): boolean => canTraverse(plan, v3(a), v3(b)) && !pathBlockedByFurniture(obstacles, v3(a), v3(b));

  const route: RouteWaypoint[] = [points[0]!];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = route.at(-1)!;
    const b = points[i + 1]!;
    if (dist(a, b) <= MERGE_M) continue;
    const leg = walkLeg({ plan, obstacles, clear }, a, b, legRooms[i] ?? null);
    if (!leg) return null;
    route.push(...leg);
  }
  return route.length >= 2 ? route : null;
}

/** What a leg strategy may read while it looks for a way through. */
type LegContext = {
  readonly plan: SolvedPlan;
  readonly obstacles: readonly Obstacle[];
  /** True when the straight run `a -> b` is walkable and unobstructed. */
  readonly clear: (a: Vec2, b: Vec2) => boolean;
};

/**
 * One way of getting from `a` to `b`: the runs to try, in preference order,
 * each as the INTERMEDIATE points between the two ends. An empty run is the
 * straight line.
 *
 * `through` is the room a blocked leg may detour inside. It is `null` for a leg
 * that runs THROUGH a doorway, which has no room of its own to wander in —
 * which is why a doorway leg is the one that can fail the whole route.
 */
type LegStrategy = {
  readonly name: string;
  readonly runs: (ctx: LegContext, a: Vec2, b: Vec2, through: RoomGraphNode | null) => ReadonlyArray<readonly Vec2[]>;
};

/**
 * How a leg is attempted, IN ORDER: straight first, then one detour inside the
 * room the leg belongs to. The first run that is clear on every hop wins; when
 * none is, the route does not exist.
 *
 * The room's own representative point leads the detour pool and the grid
 * candidates follow it, but they are ONE pool sorted by total detour length —
 * splitting them into two strategies would change which route is chosen,
 * because a nearby grid point can be cheaper than a distant centroid.
 */
const LEG_STRATEGIES: readonly LegStrategy[] = [
  { name: 'straight', runs: () => [[]] },
  {
    name: 'one detour inside the room',
    runs: (ctx, a, b, through) => {
      if (!through) return [];
      // A candidate too close to either end would merge into the neighbour it
      // stands on and leave the leg exactly as blocked as it was.
      return [through.point, ...detourCandidates(ctx.plan, through.id, ctx.obstacles)]
        .filter((point) => dist(a, point) > MERGE_M && dist(point, b) > MERGE_M)
        .sort((one, other) => dist(a, one) + dist(one, b) - (dist(a, other) + dist(other, b)))
        .map((point) => [point]);
    },
  },
];

/** The waypoints one leg contributes, or `null` when no strategy gets there. */
function walkLeg(ctx: LegContext, a: Vec2, b: Vec2, through: RoomGraphNode | null): RouteWaypoint[] | null {
  for (const strategy of LEG_STRATEGIES) {
    for (const via of strategy.runs(ctx, a, b, through)) {
      const hops = [a, ...via, b];
      if (hops.every((point, index) => index === 0 || ctx.clear(hops[index - 1]!, point))) return [...via, b];
    }
  }
  return null;
}
