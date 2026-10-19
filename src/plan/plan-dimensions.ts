/**
 * Room labels and facade dimension chains as plan-drawing primitives: the two
 * things a printed floor plan carries
 * that the on-screen drawing did not.
 *
 * Invariants:
 * - `roomLabels` gives one label per solved room FACE, at a point strictly
 *   inside its polygon (never its centroid when the room is concave), with
 *   the shoelace area of that polygon;
 * - `facadeDimensions` gives one chain per maximal run of ADJACENT,
 *   same-direction facade faces in `plan.facade`'s own loop order, offset
 *   `FACADE_DIMENSION_OFFSET_M` outward, its value the sum of the run's face
 *   lengths — never a value invented independently of the solved geometry.
 *
 * Floor-plan importers commonly anchor a room label the same way (an
 * `interiorPoint(polygon)`). The fifteen lines are cheaper than a dependency
 * would be, so the label point below is computed locally.
 *
 * Pure module: no `three`, no DOM.
 */

import { DEFAULT_TOLERANCE } from './tolerance.js';
import { EPS_PLANAR, cross, distanceToPolygon, dot, leftN, norm, pointInPolygon, signedArea, sub } from './plan-geometry.js';
import { ViewerLibError } from '../shared/errors.js';
import type { SolvedPlan } from './plan-solver.js';
import type { Room, Vec2 } from '../scene/types.js';

/** A room name and area, anchored strictly inside its polygon. */
export type PlanLabel = {
  readonly kind: 'label';
  readonly roomId: string;
  readonly text: string;
  readonly area: number;
  readonly at: Vec2;
};

/** One facade dimension chain: `a -> b` along the wall, offset outward by `offset`. */
export type PlanDimension = {
  readonly kind: 'dimension';
  readonly a: Vec2;
  readonly b: Vec2;
  /** Perpendicular offset from the facade face to the dimension line, metres. */
  readonly offset: number;
  /** True length of the chain, metres, rounded to 2 decimals. */
  readonly value: number;
  /** Which side of `a -> b` (in the `leftN` sense) the chain is drawn on. */
  readonly side: 'L' | 'R';
};

/**
 * How far a facade dimension chain sits outside the wall it measures, metres.
 * Comfortably clear of the widest wall the demo apartment authors, and inside
 * the padding `plan-drawing.test.ts` already allows a door leaf.
 */
export const FACADE_DIMENSION_OFFSET_M = 0.35;

/** Below this a ring encloses no area worth labelling. */
const DEGENERATE_AREA = 1e-9;

/** Centroid of a ring by the shoelace formula, or `null` when it is degenerate. */
function centroidOf(polygon: readonly Vec2[]): Vec2 | null {
  let area = 0;
  let x = 0;
  let z = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const c = a.x * b.z - b.x * a.z;
    area += c;
    x += (a.x + b.x) * c;
    z += (a.z + b.z) * c;
  }
  if (Math.abs(area) < DEGENERATE_AREA) return null;
  return { x: x / (3 * area), z: z / (3 * area) };
}

/** Inside with clearance: on the boundary is not a usable label anchor. */
function strictlyInside(point: Vec2, polygon: readonly Vec2[]): boolean {
  return pointInPolygon(point, polygon) && distanceToPolygon(point, polygon).distance > EPS_PLANAR;
}

/**
 * A point strictly inside `polygon`: the centroid when it lands inside (every
 * convex room), else the first inside point among the midpoints from the
 * centroid to each vertex (a concave L or a bay), else the first vertex.
 *
 * A small local `interiorPoint` — see the module comment for why this is
 * computed here rather than imported.
 */
function labelPoint(polygon: readonly Vec2[]): Vec2 {
  if (polygon.length < 3) {
    throw new ViewerLibError('bad-params', 'labelPoint: a room polygon needs at least 3 vertices', { detail: { length: polygon.length } });
  }
  const centroid = centroidOf(polygon);
  if (centroid && strictlyInside(centroid, polygon)) return centroid;
  const from = centroid ?? polygon[0]!;
  for (const vertex of polygon) {
    const mid = { x: (from.x + vertex.x) / 2, z: (from.z + vertex.z) / 2 };
    if (strictlyInside(mid, polygon)) return mid;
  }
  return { x: polygon[0]!.x, z: polygon[0]!.z };
}

/** One label per solved room face, named from `rooms` and sized by the shoelace area of its own polygon. */
export function roomLabels(plan: SolvedPlan, rooms: readonly Room[]): PlanLabel[] {
  const byId = new Map(rooms.map((room) => [room.id, room] as const));
  const labels: PlanLabel[] = [];
  for (const face of plan.rooms) {
    if (face.polygon.length < 3) continue;
    const name = byId.get(face.roomId)?.name ?? face.roomId;
    labels.push({ kind: 'label', roomId: face.roomId, text: name, area: Math.abs(signedArea(face.polygon)), at: labelPoint(face.polygon) });
  }
  return labels;
}

/** Value rounded to 2 decimals, `-0` folded to `0`. */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

type Run = { start: Vec2; end: Vec2; length: number; dir: Vec2 | null; normal: Vec2 };

function closeRun(run: Run): PlanDimension {
  const dir = run.dir ?? norm(sub(run.end, run.start));
  const side: 'L' | 'R' = dot(leftN(dir), run.normal) >= 0 ? 'L' : 'R';
  return { kind: 'dimension', a: run.start, b: run.end, offset: FACADE_DIMENSION_OFFSET_M, value: round2(run.length), side };
}

/**
 * One dimension chain per maximal run of ADJACENT, same-direction faces in
 * `plan.facade`'s own loop order — adjacency matters, not just parallelism: a
 * facade loop visits its own boundary once, so two faces that happen to share
 * a direction but are not neighbours in the loop (the two ends of a U-shaped
 * plan, say) are never the same wall run and must not merge.
 *
 * An arced facade face (`face.arc`) never merges with a neighbour on either
 * side — it has no single direction — and gets its own chain across its
 * chord, offset from the chord's own normal.
 */
export function facadeDimensions(plan: SolvedPlan): PlanDimension[] {
  const out: PlanDimension[] = [];
  let run: Run | null = null;

  for (const face of plan.facade) {
    if (face.polyline.length < 2) continue;
    const start = face.polyline[0]!;
    const end = face.polyline.at(-1)!;
    const dir = face.arc ? null : norm(sub(end, start));

    if (run && run.dir && dir && Math.abs(cross(run.dir, dir)) <= DEFAULT_TOLERANCE.angular && dot(run.dir, dir) > 0) {
      run.end = end;
      run.length += face.length;
      continue;
    }
    if (run) out.push(closeRun(run));
    run = { start, end, length: face.length, dir, normal: face.normal };
  }
  if (run) out.push(closeRun(run));
  return out;
}
