/**
 * Plan geometry primitives: 2D vector algebra, line intersection, polygon
 * queries and circular-arc discretisation for the plan solver.
 *
 * Conventions (shared by every `plan-*` module):
 * - Plan coordinates are `(x, z)` metres, `Y` is up, angles are radians.
 * - `leftN(d) = (-d.z, d.x)` is the left-hand normal of a direction. A closed
 *   loop has POSITIVE `signedArea` exactly when `leftN` of every edge points
 *   into the loop, so room loops are always positively oriented.
 * - Arc angles are measured as `p = centre + radius * (cos t, sin t)`, so a
 *   POSITIVE sweep turns from `+x` towards `+z` and keeps its centre on the
 *   left of travel. Seen from above (looking down `-Y`) that reads clockwise,
 *   which is why `WallArc.ccw = true` maps to a NEGATIVE sweep and makes the
 *   arc bulge to the LEFT of the chord `a -> b`.
 *
 * Pure module: no `three`, no DOM.
 */

import { clamp01 } from '../shared/math.js';
import { EPS, EPS_PLANAR } from './tolerance.js';
import type { Vec2 } from '../scene/types.js';

/**
 * The two comparison tolerances live in `tolerance.ts`, which names all four of
 * them and their units; they are re-exported here because every `plan-*` module
 * already imports its primitives from this file.
 */
export { EPS, EPS_PLANAR };

/** Sagitta budget for arc discretisation, in metres. */
export const ARC_TOL = 0.005;

/**
 * Smallest inner offset radius a curved wall may keep, in metres. Below it the
 * concentric offset degenerates and the face, its UVs and its openings become
 * meaningless, so the plan is rejected instead of repaired.
 */
export const MIN_INNER_RADIUS = 0.05;

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function mul(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, z: a.z * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

/** 2D cross product (the `y` component of the 3D cross product). */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.z - a.z * b.x;
}

export function len(a: Vec2): number {
  return Math.hypot(a.x, a.z);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Unit vector; a zero-length input is returned unchanged. */
export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: a.x, z: a.z } : { x: a.x / l, z: a.z / l };
}

/** Left-hand normal: the inward normal of a positively oriented loop edge. */
export function leftN(d: Vec2): Vec2 {
  return { x: -d.z, z: d.x };
}

/**
 * Intersection of the infinite lines `p + t*d` and `q + s*e`.
 * Returns `null` when the directions are parallel (|cross| < EPS).
 */
export function lineIntersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const denom = cross(d, e);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(q, p), e) / denom;
  return add(p, mul(d, t));
}

/** Shoelace area; positive when `leftN` of every edge points into the loop. */
export function signedArea(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

/** Closest point on the segment `a-b` to `pt`, plus its parameter in [0, 1]. */
/**
 * Closest point of the segment `a-b` to `pt`, with its parameter `t` in
 * `[0, 1]`. The single implementation used by polygon distance, navigation and
 * the validator.
 */
export function closestOnSegment(pt: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS * EPS) return { point: { x: a.x, z: a.z }, t: 0 };
  const t = clamp01(dot(sub(pt, a), ab) / l2);
  return { point: add(a, mul(ab, t)), t };
}

/** Even-odd point-in-polygon; points on the boundary count as inside. */
export function pointInPolygon(pt: Vec2, poly: readonly Vec2[]): boolean {
  if (poly.length < 3) return false;
  // The boundary test is `closestOnSegment` inlined: the same arithmetic,
  // without three allocations per edge (a drag's legality mask asks this
  // tens of thousands of times per frame).
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz;
    const t = l2 < EPS * EPS ? 0 : clamp01(((pt.x - a.x) * abx + (pt.z - a.z) * abz) / l2);
    // Squared, not `Math.hypot`: the same test, and the mask's hottest line.
    const dx = a.x + abx * t - pt.x;
    const dz = a.z + abz * t - pt.z;
    if (dx * dx + dz * dz <= EPS * EPS) return true;
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > pt.z !== b.z > pt.z) {
      const xAt = a.x + ((pt.z - a.z) * (b.x - a.x)) / (b.z - a.z);
      if (pt.x < xAt) inside = !inside;
    }
  }
  return inside;
}

/** Distance from `pt` to the polygon BOUNDARY (inside or outside alike). */
export function distanceToPolygon(pt: Vec2, poly: readonly Vec2[]): { distance: number; closest: Vec2 } {
  let best = Number.POSITIVE_INFINITY;
  let closest: Vec2 = poly[0] ?? { x: pt.x, z: pt.z };
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const hit = closestOnSegment(pt, a, b).point;
    const d = dist(pt, hit);
    if (d < best) {
      best = d;
      closest = hit;
    }
  }
  return { distance: best, closest };
}

export type PolylineHit = {
  /** Travel along the polyline in TRUE length units (arc length for arcs). */
  t: number;
  /** Perpendicular distance from the query point to the polyline. */
  distance: number;
  closest: Vec2;
};

/**
 * Projects a plan point onto a discretised polyline: the closest point, its
 * travel distance from the start, and the gap. `null` when there is no
 * polyline to project onto (fewer than two points, or a degenerate one).
 *
 * `length` is the TRUE length the caller measures along the line — a chorded
 * arc is shorter than its arc length, so the chord position is mapped
 * proportionally. Omitted means "the chord length is the true length", which is
 * exact for a straight run.
 *
 * The single implementation: the validator classifies a point against a wall
 * centreline with it, the layout rules measure a fixture along a wall face with
 * it, so the two cannot disagree about the degenerate case.
 */
export function projectOnPolyline(points: readonly Vec2[], point: Vec2, length?: number): PolylineHit | null {
  if (points.length < 2) return null;
  let chord = 0;
  for (let i = 0; i + 1 < points.length; i += 1) chord += dist(points[i + 1]!, points[i]!);
  if (chord < EPS) return null;
  const scale = (length ?? chord) / chord;

  let best: PolylineHit | null = null;
  let travelled = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segment = dist(b, a);
    if (segment < EPS) continue;
    const hit = closestOnSegment(point, a, b);
    const distance = dist(point, hit.point);
    if (!best || distance < best.distance) {
      best = { t: (travelled + hit.t * segment) * scale, distance, closest: hit.point };
    }
    travelled += segment;
  }
  return best;
}

/** Oriented box in plan: centre, half-extents before rotation, yaw in radians. */
export type Obb = { x: number; z: number; hx: number; hz: number; angle: number };

/**
 * Corners of an oriented box, counter-clockwise in plan.
 *
 * A yaw of `angle` sends the box's local `+x` to `(cos, sin)` in `(x, z)`,
 * matching `navigation.insideObstacle`, so a footprint quad and the walk
 * collision box are the same rectangle.
 */
export function obbQuad(box: Obb): Vec2[] {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const ax: Vec2 = { x: cos, z: sin };
  const az: Vec2 = { x: -sin, z: cos };
  return [
    { x: box.x - ax.x * box.hx - az.x * box.hz, z: box.z - ax.z * box.hx - az.z * box.hz },
    { x: box.x + ax.x * box.hx - az.x * box.hz, z: box.z + ax.z * box.hx - az.z * box.hz },
    { x: box.x + ax.x * box.hx + az.x * box.hz, z: box.z + ax.z * box.hx + az.z * box.hz },
    { x: box.x - ax.x * box.hx + az.x * box.hz, z: box.z - ax.z * box.hx + az.z * box.hz },
  ];
}

/**
 * Rectangle spanned by two ranges of a local frame: `alongRange` metres along
 * `along` and `acrossRange` metres along its left normal, both measured from
 * `origin`. Door clear zones, window bands and door leaves are all this shape.
 */
export function spanQuad(origin: Vec2, along: Vec2, alongRange: readonly [number, number], acrossRange: readonly [number, number]): Vec2[] {
  const u = norm(along);
  const v = leftN(u);
  const corner = (a: number, b: number): Vec2 => add(origin, add(mul(u, a), mul(v, b)));
  return [
    corner(alongRange[0], acrossRange[0]),
    corner(alongRange[1], acrossRange[0]),
    corner(alongRange[1], acrossRange[1]),
    corner(alongRange[0], acrossRange[1]),
  ];
}

/**
 * The part of a polyline between two travel distances, in the same true-length
 * units `projectOnPolyline` reports. Used to cut the door voids out of a wall
 * centreline before the wall is turned into solid slabs.
 */
export function polylineSlice(points: readonly Vec2[], length: number, t0: number, t1: number): Vec2[] {
  if (points.length < 2 || t1 - t0 <= EPS) return [];
  let chord = 0;
  for (let i = 0; i + 1 < points.length; i += 1) chord += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z);
  if (chord < EPS) return [];
  const scale = chord / Math.max(EPS, length);
  const from = Math.max(0, t0 * scale);
  const to = Math.min(chord, t1 * scale);
  if (to - from <= EPS) return [];

  const out: Vec2[] = [];
  let travelled = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const edge = sub(b, a);
    const segment = Math.hypot(edge.x, edge.z);
    if (segment < EPS) continue;
    const start = Math.max(from, travelled);
    const end = Math.min(to, travelled + segment);
    if (end - start > EPS) {
      const p0 = add(a, mul(edge, (start - travelled) / segment));
      const p1 = add(a, mul(edge, (end - travelled) / segment));
      if (out.length === 0) out.push(p0);
      out.push(p1);
    }
    travelled += segment;
  }
  return out.length >= 2 ? out : [];
}

/**
 * Overlap of `b` with `a`, both grown by `tol`. The bounding-box pre-filter of
 * the O(n^2) planarity sweep.
 */
export function boundsOverlap(a: Bounds, b: Bounds, tol: number = EPS_PLANAR): boolean {
  return a.minX - tol <= b.maxX && b.minX - tol <= a.maxX && a.minZ - tol <= b.maxZ && b.minZ - tol <= a.maxZ;
}

export type SegmentContact = {
  /** Where the two segments meet; the middle of the run for an overlap. */
  point: Vec2;
  /** True when they share a run longer than `tol`, not just a point. */
  overlap: boolean;
};

/**
 * Middle of the collinear run `b1-b2` shares with `a1-a2`, or `null` when `b`
 * does not lie on `a`'s line or meets it in at most a point.
 */
function collinearRun(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2, tol: number): Vec2 | null {
  const d = sub(a2, a1);
  const length = len(d);
  if (length <= tol) return null;
  const u = mul(d, 1 / length);
  if (Math.abs(cross(u, sub(b1, a1))) > tol) return null;
  if (Math.abs(cross(u, sub(b2, a1))) > tol) return null;
  const t1 = dot(sub(b1, a1), u);
  const t2 = dot(sub(b2, a1), u);
  const low = Math.max(0, Math.min(t1, t2));
  const high = Math.min(length, Math.max(t1, t2));
  if (high - low <= tol) return null;
  return add(a1, mul(u, (low + high) / 2));
}

/**
 * Contact between two segments: a proper crossing, a touch, a near miss inside
 * `tol`, or a collinear run. `null` when they stay further than `tol` apart.
 *
 * Distance, not strict incidence, decides: a plan authored a tenth of a
 * millimetre off a node is a T-junction, not a gap.
 */
export function segmentContact(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2, tol: number = EPS_PLANAR): SegmentContact | null {
  const run = collinearRun(a1, a2, b1, b2, tol) ?? collinearRun(b1, b2, a1, a2, tol);
  if (run) return { point: run, overlap: true };

  const d = sub(a2, a1);
  const e = sub(b2, b1);
  const denom = cross(d, e);
  if (Math.abs(denom) > EPS * EPS) {
    const w = sub(b1, a1);
    const t = cross(w, e) / denom;
    const s = cross(w, d) / denom;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return { point: add(a1, mul(d, t)), overlap: false };
  }

  let best = Number.POSITIVE_INFINITY;
  let closest: Vec2 | null = null;
  const probes: Array<[Vec2, Vec2, Vec2]> = [
    [a1, b1, b2],
    [a2, b1, b2],
    [b1, a1, a2],
    [b2, a1, a2],
  ];
  for (const [point, s1, s2] of probes) {
    const hit = closestOnSegment(point, s1, s2).point;
    const gap = dist(point, hit);
    if (gap < best) {
      best = gap;
      closest = mul(add(point, hit), 0.5);
    }
  }
  return closest && best <= tol ? { point: closest, overlap: false } : null;
}

export function boundsOf(poly: readonly Vec2[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Chord count for an arc whose sagitta must stay within `tol`:
 * `max(2, ceil(|sweep| / (2 * acos(1 - tol / R))))`.
 */
export function arcSegments(radius: number, sweep: number, tol: number = ARC_TOL): number {
  const r = Math.abs(radius);
  if (!(r > EPS)) return 2;
  const ratio = Math.min(1, Math.max(-1, 1 - tol / r));
  const step = 2 * Math.acos(ratio);
  if (!(step > EPS)) return 2;
  return Math.max(2, Math.ceil(Math.abs(sweep) / step));
}

export type ArcDef = { centre: Vec2; radius: number; a0: number; sweep: number };

/**
 * Minor arc running `a -> b` on a circle of `radius`.
 * `ccw: true` bulges to the LEFT of `a -> b` (centre on the right, sweep < 0);
 * `ccw: false` bulges to the right (centre on the left, sweep > 0).
 */
export function arcFromChord(a: Vec2, b: Vec2, radius: number, ccw: boolean): ArcDef {
  const chord = dist(a, b);
  const r = Math.max(radius, chord / 2);
  const mid = mul(add(a, b), 0.5);
  const dir = norm(sub(b, a));
  const half = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
  // `ccw` puts the centre on the right of a -> b, i.e. along -leftN.
  const toCentre = mul(leftN(dir), ccw ? -half : half);
  const centre = add(mid, toCentre);
  const magnitude = 2 * Math.asin(Math.min(1, chord / (2 * r)));
  return {
    centre,
    radius: r,
    a0: Math.atan2(a.z - centre.z, a.x - centre.x),
    sweep: ccw ? -magnitude : magnitude,
  };
}

/** `n + 1` points from the arc start to the arc end inclusive. */
export function arcPoints(arc: ArcDef, n: number): Vec2[] {
  const count = Math.max(1, Math.round(n));
  const out: Vec2[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = arc.a0 + (arc.sweep * i) / count;
    out.push({ x: arc.centre.x + arc.radius * Math.cos(t), z: arc.centre.z + arc.radius * Math.sin(t) });
  }
  return out;
}

export function arcLength(arc: ArcDef): number {
  return Math.abs(arc.sweep) * arc.radius;
}

/** Unit tangent of the arc at parameter `t` (radians), pointing along `sweep`. */
export function arcTangent(arc: ArcDef, t: number): Vec2 {
  const s = Math.sign(arc.sweep) || 1;
  return { x: -Math.sin(t) * s, z: Math.cos(t) * s };
}

/** Point on the arc at parameter `t` (radians). */
export function arcPointAt(arc: ArcDef, t: number): Vec2 {
  return { x: arc.centre.x + arc.radius * Math.cos(t), z: arc.centre.z + arc.radius * Math.sin(t) };
}

/** Summed chord length of a polyline. */
export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) total += dist(points[i]!, points[i + 1]!);
  return total;
}

/**
 * Point half-way along a polyline BY ARC LENGTH, not by vertex index — the
 * label anchor of a wall or a route leg. `null` for an empty polyline; a
 * polyline shorter than `EPS` falls back to its first point.
 */
export function polylineMidpoint(points: readonly Vec2[]): Vec2 | null {
  const first = points[0];
  if (!first) return null;
  if (points.length === 1) return { x: first.x, z: first.z };
  const half = polylineLength(points) / 2;
  if (half <= EPS) return { x: first.x, z: first.z };
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const step = dist(a, b);
    if (walked + step >= half) {
      const k = step > EPS ? (half - walked) / step : 0;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
    walked += step;
  }
  const last = points.at(-1)!;
  return { x: last.x, z: last.z };
}
