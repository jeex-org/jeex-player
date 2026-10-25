/**
 * Planar graph (DCEL) over the wall centrelines: two half-edges per wall,
 * angular sorting at every node, face traversal and room assignment by anchor.
 *
 * ORIENTATION CONVENTION (the whole plan pipeline depends on it):
 * - Plan coordinates are `(x, z)`, `Y` is up.
 * - A loop is a ROOM when its `signedArea` is POSITIVE; for such a loop the
 *   inward normal of every edge is `leftN(d) = (-d.z, d.x)`. The single
 *   negative-area loop is the FACADE (the unbounded outer face), whose `leftN`
 *   therefore points away from the building.
 * - The half-edge travelling `a -> b` (the wall's own direction) carries
 *   `side: 'L'`, because the room it belongs to lies to the LEFT of `a -> b`.
 *   Its twin, travelling `b -> a`, carries `side: 'R'`.
 * - `next(h)` = take the twin of `h` at node `h.to`, then step to the PREVIOUS
 *   outgoing half-edge in ascending tangent-angle order. That walks faces in
 *   the positive (left-hand) direction.
 *
 * PRECONDITION: the input is a planar embedding — every geometric intersection
 * of two centrelines is a shared node. `assertPlanarEmbedding` enforces it
 * before any angular sorting, because the traversal above is meaningless when
 * two walls cross, overlap or touch away from a node.
 *
 * DETERMINISM: the graph is a function of the PLAN, never of the order the
 * document happens to list its nodes and walls in. The two places that order
 * could leak through — the tie-break of the angular fan at a node, and the
 * half-edge the face walk starts from — are both decided by ids
 * (`compareStart`). Ring determinism as a first-class property is credited to
 * OpenGeometry's `canonical_ring`; the code is our own.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError, boundDocumentText } from '../shared/errors.js';
import type { ArcDef, Bounds } from './plan-geometry.js';
import {
  EPS,
  EPS_PLANAR,
  MIN_INNER_RADIUS,
  arcFromChord,
  arcPoints,
  arcSegments,
  arcTangent,
  boundsOf,
  boundsOverlap,
  dist,
  pointInPolygon,
  segmentContact,
  signedArea,
} from './plan-geometry.js';
import { anglesEqual } from './tolerance.js';
import type { PlanNode, Room, Vec2, Wall } from '../scene/types.js';

export type HalfEdge = {
  wallId: string;
  side: 'L' | 'R';
  from: string;
  to: string;
  /** True when the travel direction matches the wall's own `a -> b`. */
  forward: boolean;
};

export type GraphFace = {
  edges: HalfEdge[];
  /** Centreline outline of the face; arcs are discretised. */
  polygon: Vec2[];
  signedArea: number;
};

export type PlanGraph = {
  nodes: Map<string, PlanNode>;
  walls: Map<string, Wall>;
  /** Positive-area faces only (room candidates); the facade is kept apart. */
  faces: GraphFace[];
  facade: GraphFace;
};

export type PlanErrorCode = 'DANGLING_NODE' | 'DISCONNECTED' | 'NO_ANCHOR' | 'MULTI_ANCHOR' | 'BAD_REF' | 'BAD_ARC' | 'NON_PLANAR';

export class PlanError extends ViewerLibError {
  declare readonly code: 'scene-invalid';
  /** Which plan invariant was broken; `detail.planCode` carries the same value. */
  readonly planCode: PlanErrorCode;

  constructor(message: string, planCode: PlanErrorCode) {
    // The plan is part of the document: its ids come back bounded, as in the
    // validator's and the schema's refusals (`boundDocumentText`). `OpError`
    // is not bounded: it quotes the caller's own operation and ids of a scene
    // that already passed validation.
    super('scene-invalid', boundDocumentText(message), { detail: { planCode } });
    this.name = 'PlanError';
    this.planCode = planCode;
  }
}

const keyOf = (h: HalfEdge): string => `${h.wallId}:${h.side}`;

/**
 * Total order on half-edges by `(from node id, wallId, side)` — the tuple that
 * identifies one of them without naming a position in any array.
 *
 * It is the only tie-break the graph uses, and it is what makes both the fan
 * around a node and the start of every face cycle a function of the plan.
 */
function compareStart(a: HalfEdge, b: HalfEdge): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.wallId !== b.wallId) return a.wallId < b.wallId ? -1 : 1;
  if (a.side === b.side) return 0;
  return a.side < b.side ? -1 : 1;
}

/** The wall's arc as travelled by `h`; `undefined` for straight walls. */
export function halfEdgeArc(graph: PlanGraph, h: HalfEdge): ArcDef | undefined {
  const wall = graph.walls.get(h.wallId);
  if (!wall?.arc) return undefined;
  const from = graph.nodes.get(h.from)!.p;
  const to = graph.nodes.get(h.to)!.p;
  // Reversing the chord keeps the same circle only if `ccw` flips as well.
  return arcFromChord(from, to, wall.arc.radius, h.forward ? wall.arc.ccw : !wall.arc.ccw);
}

/** Centreline points of `h`, start and end inclusive; arcs are discretised. */
export function halfEdgePoints(graph: PlanGraph, h: HalfEdge): Vec2[] {
  const from = graph.nodes.get(h.from)!.p;
  const to = graph.nodes.get(h.to)!.p;
  const arc = halfEdgeArc(graph, h);
  if (!arc) return [from, to];
  return arcPoints(arc, arcSegments(arc.radius, arc.sweep));
}

/** Tangent angle leaving `h.from`, used to sort half-edges around a node. */
function exitAngle(graph: PlanGraph, h: HalfEdge): number {
  const arc = halfEdgeArc(graph, h);
  if (arc) {
    const t = arcTangent(arc, arc.a0);
    return Math.atan2(t.z, t.x);
  }
  const from = graph.nodes.get(h.from)!.p;
  const to = graph.nodes.get(h.to)!.p;
  return Math.atan2(to.z - from.z, to.x - from.x);
}

/** One wall centreline prepared for the planarity sweep; arcs are discretised. */
type Centreline = {
  wallId: string;
  /** Node ids of the two ends, the only places this wall may be touched. */
  ends: [string, string];
  chords: Array<{ a: Vec2; b: Vec2; bounds: Bounds }>;
  bounds: Bounds;
};

function centrelineFor(nodes: Map<string, PlanNode>, wall: Wall): Centreline {
  const from = nodes.get(wall.a)!.p;
  const to = nodes.get(wall.b)!.p;
  let points: Vec2[] = [from, to];
  if (wall.arc) {
    const arc = arcFromChord(from, to, wall.arc.radius, wall.arc.ccw);
    points = arcPoints(arc, arcSegments(arc.radius, arc.sweep));
  }
  const chords = points.slice(0, -1).map((a, i) => {
    const b = points[i + 1]!;
    return { a, b, bounds: boundsOf([a, b]) };
  });
  return { wallId: wall.id, ends: [wall.a, wall.b], chords, bounds: boundsOf(points) };
}

const positionText = (p: Vec2): string => `(${p.x.toFixed(4)}, ${p.z.toFixed(4)})`;

/** Every contact between two centrelines must be one of their shared nodes. */
function assertPairPlanar(a: Centreline, b: Centreline, shared: Vec2[]): void {
  for (const first of a.chords) {
    for (const second of b.chords) {
      if (!boundsOverlap(first.bounds, second.bounds)) continue;
      const hit = segmentContact(first.a, first.b, second.a, second.b);
      if (!hit) continue;
      if (hit.overlap) {
        throw new PlanError(
          `Walls ${a.wallId} and ${b.wallId} overlap along their centrelines near ${positionText(hit.point)}`,
          'NON_PLANAR',
        );
      }
      if (shared.some((node) => dist(node, hit.point) <= EPS_PLANAR)) continue;
      throw new PlanError(`Walls ${a.wallId} and ${b.wallId} intersect at ${positionText(hit.point)} without a shared node`, 'NON_PLANAR');
    }
  }
}

/**
 * Reject anything the DCEL cannot represent: the face traversal is only valid
 * when every geometric intersection of two centrelines is a node of the graph.
 *
 * Rejected are proper crossings, collinear overlaps and T-junctions whose
 * touching point carries no shared node — including near misses inside
 * `EPS_PLANAR`, which a solver would otherwise turn into a sliver face.
 * Walls that share a node may touch there, but never overlap beyond it.
 *
 * O(n^2) over the walls (<= 100 in practice) behind a bounding-box pre-filter.
 */
export function assertPlanarEmbedding(nodes: readonly PlanNode[], walls: readonly Wall[]): void {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const lines = walls.filter((wall) => nodeMap.has(wall.a) && nodeMap.has(wall.b)).map((wall) => centrelineFor(nodeMap, wall));
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i]!;
      const b = lines[j]!;
      if (!boundsOverlap(a.bounds, b.bounds)) continue;
      const shared = a.ends.filter((id) => b.ends.includes(id)).map((id) => nodeMap.get(id)!.p);
      assertPairPlanar(a, b, shared);
    }
  }
}

/** Phase 1: every node by id, with finite coordinates and no duplicate. */
function indexNodes(nodes: readonly PlanNode[]): Map<string, PlanNode> {
  const nodeMap = new Map<string, PlanNode>();
  for (const n of nodes) {
    if (nodeMap.has(n.id)) throw new PlanError(`Duplicate node id ${n.id}`, 'BAD_REF');
    if (!Number.isFinite(n.p.x) || !Number.isFinite(n.p.z)) {
      throw new PlanError(`Node ${n.id} has non-finite coordinates`, 'BAD_REF');
    }
    nodeMap.set(n.id, n);
  }
  return nodeMap;
}

/**
 * Phase 2: every wall by id, with both endpoints resolved and its arc proven
 * offsettable — an inner face below `MIN_INNER_RADIUS` collapses instead of
 * offsetting, which makes the plan impossible rather than merely ugly.
 */
function indexWalls(nodeMap: ReadonlyMap<string, PlanNode>, walls: readonly Wall[]): Map<string, Wall> {
  const wallMap = new Map<string, Wall>();
  for (const w of walls) {
    if (wallMap.has(w.id)) throw new PlanError(`Duplicate wall id ${w.id}`, 'BAD_REF');
    if (!nodeMap.has(w.a)) throw new PlanError(`Wall ${w.id} references unknown node ${w.a}`, 'BAD_REF');
    if (!nodeMap.has(w.b)) throw new PlanError(`Wall ${w.id} references unknown node ${w.b}`, 'BAD_REF');
    if (w.a === w.b) throw new PlanError(`Wall ${w.id} starts and ends at node ${w.a}`, 'BAD_REF');
    const chord = dist(nodeMap.get(w.a)!.p, nodeMap.get(w.b)!.p);
    if (chord < EPS) throw new PlanError(`Wall ${w.id} has zero length`, 'BAD_REF');
    if (w.arc) assertArcOffsettable(w, chord);
    wallMap.set(w.id, w);
  }
  return wallMap;
}

/** The arc half of phase 2: a radius that carries the chord AND the thickness. */
function assertArcOffsettable(wall: Wall, chord: number): void {
  const arc = wall.arc!; // the caller only asks about a wall that has one
  if (!(arc.radius > 0) || arc.radius < chord / 2 - EPS) {
    throw new PlanError(`Wall ${wall.id} arc radius ${arc.radius} is below half its chord ${(chord / 2).toFixed(4)}`, 'BAD_ARC');
  }
  // The inner face is a concentric arc of R - thickness/2; below the
  // minimum it collapses instead of offsetting, so the plan is impossible.
  const innerRadius = Math.max(arc.radius, chord / 2) - wall.thickness / 2;
  if (innerRadius < MIN_INNER_RADIUS - EPS) {
    throw new PlanError(
      `Wall ${wall.id} arc radius ${arc.radius} with thickness ${wall.thickness} leaves an inner radius of ` +
        `${innerRadius.toFixed(4)}, below the ${MIN_INNER_RADIUS} m minimum`,
      'BAD_ARC',
    );
  }
}

/** The half-edge index of one plan: both directions of every wall, and each node's fan. */
type HalfEdgeIndex = {
  readonly halfEdges: Map<string, HalfEdge>;
  /** Half-edges leaving each node, sorted by exit angle — the face traversal's order. */
  readonly outgoing: Map<string, HalfEdge[]>;
};

/**
 * Phase 4: two half-edges per wall, fanned out of each node and sorted by exit
 * angle.
 *
 * The sort is what makes the face traversal deterministic, and the degree check
 * is what makes it terminate: a node with one wall has no "next" edge to turn
 * onto, so the walk would run off the end of the plan.
 *
 * The fan is sorted TWICE on purpose. `wallMap` iterates in document order, so
 * an angular sort alone would hand the document's wall order to any pair of
 * exit angles it considers equal. Sorting by `wallId` first makes the array the
 * angular sort sees a function of the plan; the angular sort is stable, so a
 * tie inside `DEFAULT_TOLERANCE.angular` keeps that canonical order instead.
 */
function buildHalfEdges(graph: PlanGraph, nodeMap: ReadonlyMap<string, PlanNode>, wallMap: ReadonlyMap<string, Wall>): HalfEdgeIndex {
  const halfEdges = new Map<string, HalfEdge>();
  const outgoing = new Map<string, HalfEdge[]>();
  for (const n of nodeMap.keys()) outgoing.set(n, []);
  for (const w of wallMap.values()) {
    const forward: HalfEdge = { wallId: w.id, side: 'L', from: w.a, to: w.b, forward: true };
    const backward: HalfEdge = { wallId: w.id, side: 'R', from: w.b, to: w.a, forward: false };
    halfEdges.set(keyOf(forward), forward);
    halfEdges.set(keyOf(backward), backward);
    outgoing.get(w.a)!.push(forward);
    outgoing.get(w.b)!.push(backward);
  }

  const angles = new Map<string, number>();
  for (const h of halfEdges.values()) angles.set(keyOf(h), exitAngle(graph, h));
  const angleOf = (h: HalfEdge): number => angles.get(keyOf(h))!; // filled for every half-edge just above

  for (const [id, list] of outgoing) {
    if (list.length < 2) {
      throw new PlanError(`Node ${id} has degree ${list.length}; every node needs at least two walls`, 'DANGLING_NODE');
    }
    list.sort(compareStart);
    list.sort((a, b) => (anglesEqual(angleOf(a), angleOf(b)) ? 0 : angleOf(a) - angleOf(b)));
  }
  return { halfEdges, outgoing };
}

/** Phase 5: one plan, not two — a flood fill over the node graph must reach every node. */
function assertConnected(nodeMap: ReadonlyMap<string, PlanNode>, outgoing: ReadonlyMap<string, HalfEdge[]>): void {
  const seen = new Set<string>();
  const queue = [nodeMap.keys().next().value as string];
  seen.add(queue[0]!);
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const h of outgoing.get(current)!) {
      if (!seen.has(h.to)) {
        seen.add(h.to);
        queue.push(h.to);
      }
    }
  }
  if (seen.size !== nodeMap.size) {
    throw new PlanError('Wall graph is disconnected; every wall must belong to one plan', 'DISCONNECTED');
  }
}

/**
 * Phase 6: walk every half-edge cycle into a face, and separate the ONE
 * negatively oriented one — the outside of the plan — from the rooms.
 *
 * Fills `graph.faces` and `graph.facade` in place, because a face's polygon is
 * built with `halfEdgePoints`, which reads the graph it belongs to.
 *
 * A cycle is a CYCLE: which of its half-edges the walk happened to enter it by
 * is an artefact of `halfEdges` iteration, i.e. of the document's wall order.
 * Every cycle is therefore rotated onto its `compareStart` minimum before its
 * polygon is built, and `graph.faces` is ordered by that same minimum — so the
 * room polygons, their vertex numbering and the room order all come out of the
 * plan alone.
 */
function traverseFaces(graph: PlanGraph, index: HalfEdgeIndex): void {
  const { halfEdges, outgoing } = index;
  const twinOf = (h: HalfEdge): HalfEdge => halfEdges.get(`${h.wallId}:${h.side === 'L' ? 'R' : 'L'}`)!;
  const nextOf = (h: HalfEdge): HalfEdge => {
    const list = outgoing.get(h.to)!;
    const twin = twinOf(h);
    const at = list.findIndex((e) => e.side === twin.side && e.wallId === twin.wallId);
    return list[(at - 1 + list.length) % list.length]!;
  };

  const visited = new Set<string>();
  const negatives: GraphFace[] = [];
  for (const start of halfEdges.values()) {
    if (visited.has(keyOf(start))) continue;
    const walk: HalfEdge[] = [];
    let current = start;
    do {
      visited.add(keyOf(current));
      walk.push(current);
      current = nextOf(current);
      if (walk.length > halfEdges.size + 1) {
        throw new PlanError('Face traversal did not close; the wall graph is malformed', 'DISCONNECTED');
      }
    } while (keyOf(current) !== keyOf(start));

    // Rotate the closed cycle onto its canonical first half-edge; the cyclic
    // order — and with it the geometry — is untouched.
    let at = 0;
    for (let i = 1; i < walk.length; i += 1) {
      if (compareStart(walk[i]!, walk[at]!) < 0) at = i;
    }
    const edges = [...walk.slice(at), ...walk.slice(0, at)];

    const polygon: Vec2[] = [];
    for (const h of edges) {
      const points = halfEdgePoints(graph, h);
      for (let i = 0; i < points.length - 1; i += 1) polygon.push(points[i]!);
    }
    const face: GraphFace = { edges, polygon, signedArea: signedArea(polygon) };
    if (face.signedArea > EPS) graph.faces.push(face);
    else negatives.push(face);
  }

  if (negatives.length !== 1) {
    throw new PlanError(
      `Expected exactly one outer face, found ${negatives.length}; the plan is disconnected or degenerate`,
      'DISCONNECTED',
    );
  }
  // `edges[0]` exists: a face is a closed cycle, so it has at least one edge.
  graph.faces.sort((a, b) => compareStart(a.edges[0]!, b.edges[0]!));
  graph.facade = negatives[0]!;
}

/**
 * The wall graph of one plan, in SIX phases, in this order — each of them a
 * function above with a one-line summary of what it proves.
 *
 * The order is the point: a phase may assume everything the phases before it
 * checked and nothing else. Phase 3 (`assertPlanarEmbedding`) has to run after
 * the two indexes and before any traversal, because a non-planar input is
 * unrepresentable as half-edge cycles and would be "repaired" downstream
 * instead of rejected here.
 */
export function buildGraph(nodes: readonly PlanNode[], walls: readonly Wall[]): PlanGraph {
  const nodeMap = indexNodes(nodes);
  const wallMap = indexWalls(nodeMap, walls);
  assertPlanarEmbedding(nodes, walls);

  const graph: PlanGraph = {
    nodes: nodeMap,
    walls: wallMap,
    faces: [],
    facade: { edges: [], polygon: [], signedArea: 0 },
  };

  const index = buildHalfEdges(graph, nodeMap, wallMap);
  assertConnected(nodeMap, index.outgoing);
  traverseFaces(graph, index);
  return graph;
}

/**
 * The ATTACHED rooms whose anchor lies inside each positive face, index for
 * index with `graph.faces`, in the order `rooms` lists them. Detached rooms
 * (`Room.polygon`) are left out here, so no caller can count them by mistake.
 *
 * The one grouping `assignRooms` judges and the commit-time room merge
 * (`scene/room-merge.ts`) acts on: a face with several anchors is a
 * `MULTI_ANCHOR` refusal here and a merge candidate there, and the two cannot
 * drift apart.
 */
export function anchorsPerFace<R extends Room>(graph: PlanGraph, rooms: readonly R[]): R[][] {
  const attached = rooms.filter((room) => room.polygon === undefined);
  return graph.faces.map((face) => attached.filter((r) => pointInPolygon(r.anchor, face.polygon)));
}

/**
 * Match every positive face with the single room whose `anchor` lies inside it.
 * Exactly one anchor per face and one face per room, or a `PlanError`.
 *
 * A room carrying its own `polygon` is DETACHED: the wall graph does not close
 * around it, so it claims no face and is not required to be inside one
 * (`Room.polygon`). It is left out of the matching entirely rather than
 * excused afterwards — an anchor that stays in the running would still make a
 * face it happens to sit in report `MULTI_ANCHOR` against the room that
 * legitimately owns it.
 */
export function assignRooms(graph: PlanGraph, rooms: readonly Room[]): Map<GraphFace, Room> {
  const attached = rooms.filter((room) => room.polygon === undefined);
  const matches = anchorsPerFace(graph, attached);

  for (let i = 0; i < graph.faces.length; i += 1) {
    if (matches[i]!.length > 1) {
      const ids = matches[i]!.map((r) => r.id).join(', ');
      throw new PlanError(`Room face ${i} contains several room anchors: ${ids}`, 'MULTI_ANCHOR');
    }
  }

  const assigned = new Map<GraphFace, Room>();
  const used = new Set<string>();
  for (let i = 0; i < graph.faces.length; i += 1) {
    const found = matches[i]![0];
    if (!found) {
      throw new PlanError(`Room face ${i} contains no room anchor`, 'NO_ANCHOR');
    }
    assigned.set(graph.faces[i]!, found);
    used.add(found.id);
  }

  for (const r of attached) {
    if (!used.has(r.id)) {
      throw new PlanError(`Room ${r.id} anchor (${r.anchor.x}, ${r.anchor.z}) is not inside any face`, 'NO_ANCHOR');
    }
  }
  return assigned;
}
