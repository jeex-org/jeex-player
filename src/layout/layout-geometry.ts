/**
 * Convex-polygon OVERLAP for the layout linter: every body it reasons about —
 * a furniture footprint, a wall slab, a door clear zone, a door leaf — is one
 * convex quad in plan coordinates, and the single intersection test is a
 * separating-axis test that reports HOW DEEP the overlap is, so a wardrobe
 * standing flush against a wall face can be told apart from one sunk into it.
 *
 * The SHAPES themselves (`Obb`, `obbQuad`, `spanQuad`, `polylineSlice`) live in
 * `plan/plan-geometry.ts`: they are plan geometry, and keeping them here made
 * the plan layer and the door-swing solver reach up into `layout/` to build a
 * rectangle.
 *
 * Invariant: `overlapDepth(a, b) === 0` exactly when a separating axis exists;
 * otherwise it is the smallest translation (metres) that would separate them.
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, dot, leftN, norm, signedArea, spanQuad, sub } from '../plan/plan-geometry.js';
import type { Vec2 } from '../scene/types.js';

/** A polygon flatter than this has no usable centroid. */
const DEGENERATE_AREA = 1e-9;

/** Centre of a quad's vertices — good enough to report where an issue sits. */
export function quadCentre(quad: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const point of quad) {
    x += point.x;
    z += point.z;
  }
  const n = Math.max(1, quad.length);
  return { x: x / n, z: z / n };
}

/**
 * A room's representative point; concave rooms have centroids outside themselves.
 *
 * Shared by rule 6 (circulation) and by `free-space.ts`, which is why it lives
 * here rather than inside either of them.
 */
export function roomCentroid(poly: readonly Vec2[]): Vec2 {
  const area = signedArea(poly);
  if (Math.abs(area) < DEGENERATE_AREA) return quadCentre(poly);
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const w = a.x * b.z - a.z * b.x;
    cx += (a.x + b.x) * w;
    cz += (a.z + b.z) * w;
  }
  return { x: cx / (6 * area), z: cz / (6 * area) };
}

function projectOnAxis(poly: readonly Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of poly) {
    const value = dot(point, axis);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function axesOf(poly: readonly Vec2[]): Vec2[] {
  const axes: Vec2[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const edge = sub(poly[(i + 1) % poly.length]!, poly[i]!);
    if (Math.hypot(edge.x, edge.z) < EPS) continue;
    axes.push(norm(leftN(edge)));
  }
  return axes;
}

/**
 * Penetration depth of two convex polygons, metres; `0` when they are apart.
 *
 * The depth is what makes the linter usable on an authored plan: furniture is
 * placed flush against wall faces on purpose, so "touching" must not read as
 * "inside the wall". Callers compare the depth against a tolerance.
 */
export function overlapDepth(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  let smallest = Infinity;
  for (const axis of [...axesOf(a), ...axesOf(b)]) {
    const pa = projectOnAxis(a, axis);
    const pb = projectOnAxis(b, axis);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return 0;
    if (overlap < smallest) smallest = overlap;
  }
  return Number.isFinite(smallest) ? smallest : 0;
}

/** True when every vertex of `inner` lies inside `outer` grown by `pad` metres. */
export function quadContains(outer: readonly Vec2[], inner: readonly Vec2[], pad = 0): boolean {
  for (const axis of axesOf(outer)) {
    const po = projectOnAxis(outer, axis);
    const pi = projectOnAxis(inner, axis);
    if (pi.min < po.min - pad || pi.max > po.max + pad) return false;
  }
  return true;
}

/** Every segment of a polyline turned into a slab quad of half-width `half`. */
export function polylineSlabs(points: readonly Vec2[], half: number): Vec2[][] {
  const slabs: Vec2[][] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const edge = sub(b, a);
    const segment = Math.hypot(edge.x, edge.z);
    if (segment < EPS) continue;
    slabs.push(spanQuad(a, edge, [0, segment], [-half, half]));
  }
  return slabs;
}
