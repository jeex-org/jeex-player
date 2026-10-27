/**
 * `solvePlan` turns the wall graph into everything the geometry and
 * navigation layers need: one `WallFace` per wall side, one `RoomFace` polygon
 * per room, and the wall centrelines with their doorway intervals.
 *
 * Invariants:
 * - every wall side becomes exactly one face, owned by one room or by the
 *   facade (`roomId === null`);
 * - opposite faces of a wall stay `thickness` apart, arcs included;
 * - `quadsArea(face.quads) === face.length * ceilingHeight - opening areas`;
 * - UVs stay continuous through the opening cuts of one face via
 *   `u = (face.t0 + t) / tile`.
 *
 * Ownership invariant: everything `solvePlan` returns is READONLY, properties
 * and arrays alike. The solved plan is committed state — `SceneModel` freezes
 * it and hands it to every consumer at once — so the type says what the runtime
 * already enforces, and `faces` is a `readonly-map.ts` view over a `FaceMap`
 * rather than the backing map.
 *
 * Pure module: no `three`, no DOM.
 */

import type { ArcDef, Bounds } from './plan-geometry.js';
import { EPS, arcLength, boundsOf, dist, dot, leftN, mul, norm, sub } from './plan-geometry.js';
import { clamp } from '../shared/math.js';
import type { GraphFace, HalfEdge, PlanGraph } from './plan-graph.js';
import { assignRooms, buildGraph, halfEdgeArc, halfEdgePoints } from './plan-graph.js';
import type { FaceOpening, FaceQuad } from './plan-openings.js';
import { faceQuads, openingsForFace } from './plan-openings.js';
import type { FaceEdgeInput } from './plan-offset.js';
import { offsetEdges } from './plan-offset.js';
import { readonlyMapView, type ReadonlyKeyed } from '../shared/readonly-map.js';
import { ownFloors, type PlanCaveat } from './floor-ownership.js';
import type { FaceKey, SceneData, Vec2, Wall, WallSide } from '../scene/types.js';
import { FaceMap, faceKey, isDoorLike } from '../scene/types.js';

export type WallFace = {
  /** Which face this is: `{ room, wallId, side }`, `room` omitted on the facade. */
  readonly key: FaceKey;
  readonly wallId: string;
  readonly side: WallSide;
  /** `null` for facade faces. */
  readonly roomId: string | null;
  /** Offset outline of the face in plan; arcs are discretised. */
  readonly polyline: readonly Vec2[];
  /** Distance from the face's own wall end to its start, after mitring. */
  readonly t0: number;
  /** Length of `polyline`; the `t` range of `openings` and `quads`. */
  readonly length: number;
  /** Concentric offset arc for curved walls. */
  readonly arc?: ArcDef | undefined;
  readonly openings: readonly FaceOpening[];
  readonly quads: readonly FaceQuad[];
  /** Unit normal pointing from the wall towards its room (or outwards). */
  readonly normal: Vec2;
};

/** A read-only view over a `FaceMap`: lookups by `FaceKey` value, iteration, no mutator. */
export type ReadonlyFaceMap<V> = ReadonlyKeyed<FaceKey, V>;

export type RoomFace = {
  readonly roomId: string;
  readonly polygon: readonly Vec2[];
  readonly loop: readonly WallFace[];
  readonly bbox: Bounds;
};

/** One doorway interval on a centreline, measured in true length units from `a`. */
export type CentrelineDoor = { readonly t0: number; readonly t1: number; readonly openingId: string };

export type WallCentreline = {
  readonly wallId: string;
  readonly thickness: number;
  /** Centreline from node `a` to node `b`; arcs are discretised. */
  readonly polyline: readonly Vec2[];
  /** True centreline length; `doors` are measured in these units from `a`. */
  readonly length: number;
  readonly doors: readonly CentrelineDoor[];
};

export type SolvedPlan = {
  readonly rooms: readonly RoomFace[];
  readonly facade: readonly WallFace[];
  /**
   * Every wall face by its `FaceKey` — the map a face arriving from outside
   * (a `set_material` target, a picked mesh, a `finishes.faces` entry) is
   * looked up in, by value. A read-only VIEW over the backing `FaceMap`: the
   * solved plan is committed state and no consumer may edit it
   * (`readonly-map.ts`).
   */
  readonly faces: ReadonlyFaceMap<WallFace>;
  readonly centrelines: readonly WallCentreline[];
  readonly bounds: Bounds;
  /** What the solver left as the source drew it (`floor-ownership.ts`); empty for a plan it settled. */
  readonly caveats: readonly PlanCaveat[];
};

/** Centreline length of a wall as travelled by `edge` (arc length for arcs). */
function travelLength(graph: PlanGraph, edge: HalfEdge, arc: ArcDef | undefined): number {
  if (arc) return arcLength(arc);
  return dist(graph.nodes.get(edge.from)!.p, graph.nodes.get(edge.to)!.p);
}

/** `angle` moved by whole turns into `[reference - PI, reference + PI)`. */
function unwrapNear(angle: number, reference: number): number {
  const turn = 2 * Math.PI;
  const delta = (((angle - reference + Math.PI) % turn) + turn) % turn;
  return reference + delta - Math.PI;
}

/**
 * Angular progress of `point` along `arc` from `arc.a0` in the sweep direction,
 * unwrapped towards `reference` (0 for the face start, |sweep| for its end).
 *
 * Mitred joint points do NOT lie on the offset circle when the neighbouring
 * wall is not tangent to the arc, so the angle has to come from `atan2` about
 * the centre and be unwrapped towards the end it belongs to. Wrapping it into
 * `[0, 2PI)` instead turns a start that sits a hair BEFORE `a0` into a full
 * turn, which collapses the face and loses its openings.
 */
function arcAngleAt(arc: ArcDef, point: Vec2, reference: number): number {
  const raw = Math.atan2(point.z - arc.centre.z, point.x - arc.centre.x) - arc.a0;
  return unwrapNear(raw * (Math.sign(arc.sweep) || 1), reference);
}

/**
 * Centreline window `[start, end]` of one face, measured from the travel start
 * of `edge`, after the joints have moved its endpoints.
 *
 * A mitre can push an endpoint past the wall end (the neighbour's offset line
 * cuts the arc outside its own sweep), which makes the face LONGER than its
 * wall: the window is extended, never wrapped. Each end is clamped to half a
 * sweep so a degenerate joint cannot invert it, and a window that still does
 * not grow falls back to the whole wall.
 */
function faceWindow(
  graph: PlanGraph,
  edge: HalfEdge,
  arc: ArcDef | undefined,
  wallLength: number,
  polyline: readonly Vec2[],
): { start: number; end: number } {
  const first = polyline[0]!;
  const last = polyline.at(-1)!;
  let start: number;
  let end: number;
  if (arc) {
    const sweep = Math.abs(arc.sweep);
    const half = sweep / 2;
    start = clamp(arcAngleAt(arc, first, 0), -half, half) * arc.radius;
    end = clamp(arcAngleAt(arc, last, sweep), half, sweep + half) * arc.radius;
  } else {
    const from = graph.nodes.get(edge.from)!.p;
    const dir = norm(sub(graph.nodes.get(edge.to)!.p, from));
    start = dot(sub(first, from), dir);
    end = dot(sub(last, from), dir);
  }
  if (end - start > EPS) return { start, end };
  return { start: 0, end: wallLength };
}

function faceNormal(graph: PlanGraph, edge: HalfEdge, arc: ArcDef | undefined, polyline: readonly Vec2[]): Vec2 {
  if (arc) {
    const mid = polyline[Math.floor(polyline.length / 2)]!;
    const radial = norm(sub(mid, arc.centre));
    // sweep > 0 keeps the centre on the left, i.e. on the face's own side.
    return mul(radial, -(Math.sign(arc.sweep) || 1));
  }
  const from = graph.nodes.get(edge.from)!.p;
  const to = graph.nodes.get(edge.to)!.p;
  return leftN(norm(sub(to, from)));
}

function solveFace(graph: PlanGraph, face: GraphFace, roomId: string | null, ceiling: number): { faces: WallFace[]; polygon: Vec2[] } {
  const arcs = face.edges.map((edge) => halfEdgeArc(graph, edge));
  const inputs: FaceEdgeInput[] = face.edges.map((edge, i) => {
    const wall = graph.walls.get(edge.wallId)!;
    return {
      wallId: edge.wallId,
      side: edge.side,
      p: graph.nodes.get(edge.from)!.p,
      q: graph.nodes.get(edge.to)!.p,
      offset: wall.thickness / 2,
      arc: arcs[i],
    };
  });

  const offsets = offsetEdges(inputs);
  const faces: WallFace[] = [];
  const polygon: Vec2[] = [];

  offsets.forEach((offset, i) => {
    const edge = face.edges[i]!;
    const wall = graph.walls.get(edge.wallId)!;
    const centreArc = arcs[i];
    const wallLength = travelLength(graph, edge, centreArc);
    const { start, end } = faceWindow(graph, edge, centreArc, wallLength, offset.polyline);
    const span = end - start;
    // Arc faces are shorter or longer than their centreline; map t proportionally.
    const scale = offset.length / span;
    const openings = openingsForFace(wall, wallLength, edge.side, start, span, ceiling).map((o) => ({
      ...o,
      t0: o.t0 * scale,
      t1: o.t1 * scale,
    }));
    const wallFace: WallFace = {
      key: faceKey(roomId, edge.wallId, edge.side),
      wallId: edge.wallId,
      side: edge.side,
      roomId,
      polyline: offset.polyline,
      t0: start * scale,
      length: offset.length,
      arc: offset.arc,
      openings,
      quads: faceQuads(offset.length, ceiling, openings),
      normal: faceNormal(graph, edge, centreArc, offset.polyline),
    };
    faces.push(wallFace);

    for (const point of offset.polyline) {
      const previous = polygon.at(-1);
      if (previous && dist(previous, point) <= EPS) continue;
      polygon.push(point);
    }
  });

  while (polygon.length > 1 && dist(polygon[0]!, polygon.at(-1)!) <= EPS) polygon.pop();
  return { faces, polygon };
}

function centrelineOf(graph: PlanGraph, wall: Wall): WallCentreline {
  const edge: HalfEdge = { wallId: wall.id, side: 'L', from: wall.a, to: wall.b, forward: true };
  const arc = halfEdgeArc(graph, edge);
  return {
    wallId: wall.id,
    thickness: wall.thickness,
    polyline: halfEdgePoints(graph, edge),
    length: travelLength(graph, edge, arc),
    doors: (wall.openings ?? [])
      .filter((opening) => isDoorLike(opening.type))
      .map((opening) => ({
        t0: opening.center - opening.width / 2,
        t1: opening.center + opening.width / 2,
        openingId: opening.id,
      })),
  };
}

export function solvePlan(scene: Pick<SceneData, 'nodes' | 'walls' | 'rooms' | 'ceilingHeight'>): SolvedPlan {
  const graph = buildGraph(scene.nodes, scene.walls);
  const assigned = assignRooms(graph, scene.rooms);

  const faces = new FaceMap<WallFace>();
  const rooms: RoomFace[] = [];
  for (const graphFace of graph.faces) {
    const room = assigned.get(graphFace)!;
    const solvedFace = solveFace(graph, graphFace, room.id, scene.ceilingHeight);
    for (const wallFace of solvedFace.faces) faces.set(wallFace.key, wallFace);
    rooms.push({
      roomId: room.id,
      polygon: solvedFace.polygon,
      loop: solvedFace.faces,
      bbox: boundsOf(solvedFace.polygon),
    });
  }

  // A room the wall graph does not close around (`Room.polygon`) is solved from
  // the outline its source supplied: the same `RoomFace` shape, with an empty
  // `loop` because it bounds no wall side. Everything that reads a room's
  // AREA — navigation, the floor slab, the reachability check — works from
  // `polygon` and gets a real answer; everything that reads its wall FACES
  // gets an honest nothing.
  const zoneIds = new Set<string>();
  for (const room of scene.rooms) {
    if (room.polygon === undefined) continue;
    rooms.push({ roomId: room.id, polygon: room.polygon, loop: [], bbox: boundsOf(room.polygon) });
    zoneIds.add(room.id);
  }
  // Each piece of floor to one room: a face's room gives up the zones lying in it.
  const owned = zoneIds.size > 0 ? ownFloors(rooms, zoneIds) : { rooms, caveats: [] };

  const outer = solveFace(graph, graph.facade, null, scene.ceilingHeight);
  for (const wallFace of outer.faces) faces.set(wallFace.key, wallFace);

  const extent: Vec2[] = [...outer.polygon];
  for (const node of graph.nodes.values()) extent.push(node.p);
  for (const room of owned.rooms) extent.push(...room.polygon);

  return {
    rooms: owned.rooms,
    facade: outer.faces,
    // The backing map goes out of scope here, so the view is the only handle.
    faces: readonlyMapView(faces),
    centrelines: scene.walls.map((wall) => centrelineOf(graph, wall)),
    bounds: boundsOf(extent),
    caveats: owned.caveats,
  };
}
