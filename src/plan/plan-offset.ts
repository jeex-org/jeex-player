/**
 * Offsets a face loop inward by a PER-EDGE amount (each wall's own half
 * thickness) and resolves the joints.
 *
 * Invariant: the offset of an edge is its centreline moved by `offset` along
 * `leftN(direction of travel)`, so a positively oriented room loop moves into
 * the room and the negatively oriented facade loop moves out of the building.
 *
 * Joint rules:
 * - intersect the two offset LINES (not the classic equal-offset mitre);
 * - parallel offsets at different distances produce two vertices, a `jog`;
 * - a mitre further than `MITER_LIMIT_FACTOR * max(offset)` from the node is
 *   replaced by two vertices, a `bevel`;
 * - an arc offsets to a concentric arc of radius `R -/+ offset` and joins its
 *   neighbours through the tangents at its own ends (`arc`); an inner radius
 *   below `MIN_INNER_RADIUS` is an impossible wall and raises `BAD_ARC`, never
 *   an EPS-radius repair.
 *
 * Pure module: no `three`, no DOM.
 */

import type { ArcDef } from './plan-geometry.js';
import {
  EPS,
  MIN_INNER_RADIUS,
  add,
  arcPointAt,
  arcPoints,
  arcSegments,
  arcTangent,
  dist,
  leftN,
  lineIntersect,
  mul,
  norm,
  polylineLength,
  sub,
} from './plan-geometry.js';
import { PlanError } from './plan-graph.js';
import type { Vec2 } from '../scene/types.js';

/** A mitre is cut once it reaches this multiple of the larger offset. */
export const MITER_LIMIT_FACTOR = 4;

export type FaceEdgeInput = {
  wallId: string;
  side: 'L' | 'R';
  /** Centreline start, in the travel direction of this face. */
  p: Vec2;
  /** Centreline end, in the travel direction of this face. */
  q: Vec2;
  /** Half the wall thickness. */
  offset: number;
  /** Centreline arc, already expressed in the travel direction of this face. */
  arc?: ArcDef | undefined;
};

export type OffsetVertex = Vec2 & {
  /** Index of the edge AFTER which this vertex sits. */
  afterEdge: number;
  kind: 'miter' | 'jog' | 'bevel' | 'arc';
};

export type OffsetEdge = {
  wallId: string;
  side: 'L' | 'R';
  /** Offset geometry from joint to joint; arcs are discretised. */
  polyline: Vec2[];
  /** Summed chord length of `polyline`; the face's `t` parameterisation. */
  length: number;
  /** Concentric offset arc, when the wall is curved. */
  arc?: ArcDef | undefined;
};

type Prepared = { start: Vec2; end: Vec2; dirStart: Vec2; dirEnd: Vec2; arc?: ArcDef | undefined };

function prepare(edge: FaceEdgeInput): Prepared {
  if (edge.arc) {
    // sweep > 0 keeps the centre on the left, so the inward offset shrinks R.
    const sign = Math.sign(edge.arc.sweep) || 1;
    const radius = edge.arc.radius - sign * edge.offset;
    // An impossible offset is a broken plan, never an EPS-radius repair.
    if (radius < MIN_INNER_RADIUS - EPS) {
      throw new PlanError(
        `Wall ${edge.wallId} side ${edge.side} offsets its arc radius ${edge.arc.radius} to ${radius.toFixed(4)}, ` +
          `below the ${MIN_INNER_RADIUS} m minimum`,
        'BAD_ARC',
      );
    }
    const arc: ArcDef = { centre: edge.arc.centre, radius, a0: edge.arc.a0, sweep: edge.arc.sweep };
    const a1 = arc.a0 + arc.sweep;
    return {
      start: arcPointAt(arc, arc.a0),
      end: arcPointAt(arc, a1),
      dirStart: arcTangent(arc, arc.a0),
      dirEnd: arcTangent(arc, a1),
      arc,
    };
  }
  const dir = norm(sub(edge.q, edge.p));
  const shift = mul(leftN(dir), edge.offset);
  return { start: add(edge.p, shift), end: add(edge.q, shift), dirStart: dir, dirEnd: dir, arc: undefined };
}

function vertex(p: Vec2, afterEdge: number, kind: OffsetVertex['kind']): OffsetVertex {
  return { x: p.x, z: p.z, afterEdge, kind };
}

/** Vertices generated at the joint that follows `edges[index]`. */
function jointAfter(edges: FaceEdgeInput[], prepared: Prepared[], index: number): OffsetVertex[] {
  const next = (index + 1) % edges.length;
  const before = prepared[index]!;
  const after = prepared[next]!;
  const node = edges[index]!.q;
  const curved = before.arc !== undefined || after.arc !== undefined;
  const single = curved ? 'arc' : 'miter';

  const hit = lineIntersect(before.end, before.dirEnd, after.start, after.dirStart);
  if (hit === null) {
    if (dist(before.end, after.start) <= EPS) return [vertex(before.end, index, single)];
    return [vertex(before.end, index, 'jog'), vertex(after.start, index, 'jog')];
  }

  const limit = MITER_LIMIT_FACTOR * Math.max(edges[index]!.offset, edges[next]!.offset);
  if (dist(hit, node) > limit) {
    return [vertex(before.end, index, 'bevel'), vertex(after.start, index, 'bevel')];
  }
  return [vertex(hit, index, single)];
}

function jointsOf(edges: FaceEdgeInput[]): OffsetVertex[][] {
  const prepared = edges.map((edge) => prepare(edge));
  return edges.map((_, i) => jointAfter(edges, prepared, i));
}

/**
 * Corner sequence of the offset loop. Arc interior points are NOT included —
 * use `offsetEdges` when the full outline is needed.
 */
export function offsetLoop(edges: FaceEdgeInput[]): OffsetVertex[] {
  if (edges.length < 2) return [];
  return jointsOf(edges).flat();
}

/** Per-edge offset polyline, running from the previous joint to the next one. */
export function offsetEdges(edges: FaceEdgeInput[]): OffsetEdge[] {
  if (edges.length < 2) return [];
  const prepared = edges.map((edge) => prepare(edge));
  const joints = jointsOf(edges);
  return edges.map((edge, i) => {
    const start = joints[(i - 1 + edges.length) % edges.length]!.at(-1)!;
    const end = joints[i]![0]!;
    const arc = prepared[i]!.arc;
    const polyline: Vec2[] = [{ x: start.x, z: start.z }];
    if (arc) {
      const inner = arcPoints(arc, arcSegments(arc.radius, arc.sweep));
      for (let k = 1; k < inner.length - 1; k += 1) polyline.push(inner[k]!);
    }
    polyline.push({ x: end.x, z: end.z });
    return { wallId: edge.wallId, side: edge.side, polyline, length: polylineLength(polyline), arc };
  });
}
