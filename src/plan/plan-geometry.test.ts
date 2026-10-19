import { describe, expect, test } from 'bun:test';
import {
  ARC_TOL,
  EPS,
  add,
  arcFromChord,
  arcLength,
  arcPoints,
  arcSegments,
  boundsOf,
  cross,
  dist,
  distanceToPolygon,
  dot,
  leftN,
  len,
  lineIntersect,
  mul,
  norm,
  pointInPolygon,
  polylineLength,
  polylineMidpoint,
  segmentContact,
  signedArea,
  sub,
} from './plan-geometry.js';
import type { Vec2 } from '../scene/types.js';

/** Unit square walked so that `leftN` of every edge direction points inside. */
const UNIT_SQUARE = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
  { x: 1, z: 1 },
  { x: 0, z: 1 },
];

/** L-shape: 4x4 block with the (2..4, 2..4) quadrant cut away. */
const L_SHAPE = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 2 },
  { x: 2, z: 2 },
  { x: 2, z: 4 },
  { x: 0, z: 4 },
];

describe('vector helpers', () => {
  test('sub, add, mul, dot, cross, len, dist, norm', () => {
    expect(sub({ x: 3, z: 5 }, { x: 1, z: 2 })).toEqual({ x: 2, z: 3 });
    expect(add({ x: 3, z: 5 }, { x: 1, z: 2 })).toEqual({ x: 4, z: 7 });
    expect(mul({ x: 3, z: 5 }, 2)).toEqual({ x: 6, z: 10 });
    expect(dot({ x: 3, z: 5 }, { x: 1, z: 2 })).toBe(13);
    expect(cross({ x: 1, z: 0 }, { x: 0, z: 1 })).toBe(1);
    expect(len({ x: 3, z: 4 })).toBe(5);
    expect(dist({ x: 1, z: 1 }, { x: 4, z: 5 })).toBe(5);
    const n = norm({ x: 0, z: -4 });
    expect(n.x).toBeCloseTo(0, 12);
    expect(n.z).toBeCloseTo(-1, 12);
  });

  test('leftN(d) is (-d.z, d.x)', () => {
    expect(leftN({ x: 1, z: 0 }).x).toBeCloseTo(0, 12);
    expect(leftN({ x: 1, z: 0 }).z).toBe(1);
    expect(leftN({ x: 0, z: 1 })).toEqual({ x: -1, z: 0 });
  });

  test('tolerances are the documented budgets', () => {
    expect(EPS).toBe(1e-6);
    expect(ARC_TOL).toBe(0.005);
  });
});

describe('signedArea', () => {
  test('is positive exactly when leftN of each edge points inside', () => {
    expect(signedArea(UNIT_SQUARE)).toBeCloseTo(1, 12);
    // Every edge of the positively oriented square has its inward normal = leftN.
    for (let i = 0; i < UNIT_SQUARE.length; i += 1) {
      const p = UNIT_SQUARE[i]!;
      const q = UNIT_SQUARE[(i + 1) % UNIT_SQUARE.length]!;
      const mid = mul(add(p, q), 0.5);
      const probe = add(mid, mul(leftN(norm(sub(q, p))), 0.1));
      expect(pointInPolygon(probe, UNIT_SQUARE)).toBe(true);
    }
  });

  test('flips sign with the walk direction', () => {
    expect(signedArea([...UNIT_SQUARE].reverse())).toBeCloseTo(-1, 12);
  });

  test('matches the L-shape area', () => {
    expect(signedArea(L_SHAPE)).toBeCloseTo(12, 12);
  });
});

describe('pointInPolygon', () => {
  test('a point in the notch of an L-shape is outside', () => {
    expect(pointInPolygon({ x: 3, z: 3 }, L_SHAPE)).toBe(false);
    expect(pointInPolygon({ x: 1, z: 3 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 3, z: 1 }, L_SHAPE)).toBe(true);
  });

  test('points on the boundary count as inside', () => {
    expect(pointInPolygon({ x: 2, z: 0 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 4, z: 2 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 2, z: 3 }, L_SHAPE)).toBe(true);
  });

  test('far away points are outside', () => {
    expect(pointInPolygon({ x: -1, z: -1 }, L_SHAPE)).toBe(false);
    expect(pointInPolygon({ x: 10, z: 2 }, L_SHAPE)).toBe(false);
  });
});

describe('distanceToPolygon', () => {
  test('an outside point next to an edge projects onto that edge', () => {
    const hit = distanceToPolygon({ x: 2, z: -0.5 }, UNIT_SQUARE);
    expect(hit.distance).toBeCloseTo(Math.hypot(1, 0.5), 12);
    expect(hit.closest.x).toBeCloseTo(1, 12);
    expect(hit.closest.z).toBeCloseTo(0, 12);
  });

  test('an outside point beside an edge span projects perpendicularly', () => {
    const hit = distanceToPolygon({ x: 0.5, z: -0.25 }, UNIT_SQUARE);
    expect(hit.distance).toBeCloseTo(0.25, 12);
    expect(hit.closest).toEqual({ x: 0.5, z: 0 });
  });

  test('an outside point past a corner projects onto the vertex', () => {
    const hit = distanceToPolygon({ x: -0.3, z: -0.4 }, UNIT_SQUARE);
    expect(hit.distance).toBeCloseTo(0.5, 12);
    expect(hit.closest.x).toBeCloseTo(0, 12);
    expect(hit.closest.z).toBeCloseTo(0, 12);
  });

  test('an inside point reports the distance to the nearest wall', () => {
    const hit = distanceToPolygon({ x: 0.2, z: 0.5 }, UNIT_SQUARE);
    expect(hit.distance).toBeCloseTo(0.2, 12);
    expect(hit.closest).toEqual({ x: 0, z: 0.5 });
  });
});

describe('lineIntersect', () => {
  test('returns the crossing of two skew lines', () => {
    const hit = lineIntersect({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 3, z: -2 }, { x: 0, z: 1 });
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(3, 12);
    expect(hit!.z).toBeCloseTo(0, 12);
  });

  test('returns null for parallel lines', () => {
    expect(lineIntersect({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 2, z: 0 })).toBeNull();
    expect(lineIntersect({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 5, z: 0 }, { x: -1, z: 0 })).toBeNull();
  });
});

describe('boundsOf', () => {
  test('covers every vertex', () => {
    expect(boundsOf(L_SHAPE)).toEqual({ minX: 0, maxX: 4, minZ: 0, maxZ: 4 });
  });
});

describe('arc discretisation', () => {
  test('a 180-degree arc of radius 2 needs 23 chords at a 5 mm sagitta', () => {
    expect(arcSegments(2, Math.PI)).toBe(23);
    expect(arcSegments(2, -Math.PI)).toBe(23);
  });

  test('never drops below two chords', () => {
    expect(arcSegments(0.4, 0.01)).toBe(2);
  });

  test('a looser tolerance needs fewer chords', () => {
    expect(arcSegments(2, Math.PI, 0.02)).toBeLessThan(arcSegments(2, Math.PI, ARC_TOL));
  });
});

describe('arcFromChord', () => {
  test('a chord of 2 with radius 1 is a half circle', () => {
    const arc = arcFromChord({ x: -1, z: 0 }, { x: 1, z: 0 }, 1, false);
    expect(arc.centre.x).toBeCloseTo(0, 12);
    expect(arc.centre.z).toBeCloseTo(0, 12);
    expect(arc.radius).toBe(1);
    expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI, 12);
    expect(arcLength(arc)).toBeCloseTo(Math.PI, 12);
  });

  test('ccw makes the arc bulge to the left of a -> b (centre on the right)', () => {
    const a = { x: -1, z: 0 };
    const b = { x: 1, z: 0 };
    const bulgeLeft = arcFromChord(a, b, 1, true);
    const bulgeRight = arcFromChord(a, b, 1, false);
    // leftN of the chord direction (1, 0) is (0, 1).
    expect(arcPoints(bulgeLeft, 2)[1]!.z).toBeCloseTo(1, 12);
    expect(arcPoints(bulgeRight, 2)[1]!.z).toBeCloseTo(-1, 12);
    expect(bulgeLeft.sweep).toBeLessThan(0);
    expect(bulgeRight.sweep).toBeGreaterThan(0);
  });

  test('reversing the chord and the ccw flag keeps the same circle', () => {
    const a = { x: 2, z: 0 };
    const b = { x: 6, z: 0 };
    const fwd = arcFromChord(a, b, 2, false);
    const back = arcFromChord(b, a, 2, true);
    expect(back.centre.x).toBeCloseTo(fwd.centre.x, 12);
    expect(back.centre.z).toBeCloseTo(fwd.centre.z, 12);
    expect(back.sweep).toBeCloseTo(-fwd.sweep, 12);
    expect(arcLength(back)).toBeCloseTo(arcLength(fwd), 12);
  });

  test('a shallow arc keeps the minor sweep', () => {
    const arc = arcFromChord({ x: 0, z: 0 }, { x: 2, z: 0 }, 10, false);
    expect(Math.abs(arc.sweep)).toBeCloseTo(2 * Math.asin(0.1), 12);
    expect(arcLength(arc)).toBeCloseTo(10 * 2 * Math.asin(0.1), 12);
  });
});

describe('arcPoints', () => {
  test('returns n + 1 points that start and end on the chord ends', () => {
    const a = { x: 2, z: 0 };
    const b = { x: 6, z: 0 };
    const arc = arcFromChord(a, b, 2, false);
    const n = arcSegments(arc.radius, arc.sweep);
    const pts = arcPoints(arc, n);
    expect(pts.length).toBe(n + 1);
    expect(pts[0]!.x).toBeCloseTo(a.x, 9);
    expect(pts[0]!.z).toBeCloseTo(a.z, 9);
    expect(pts[n]!.x).toBeCloseTo(b.x, 9);
    expect(pts[n]!.z).toBeCloseTo(b.z, 9);
  });

  test('every point sits on the circle', () => {
    const arc = arcFromChord({ x: 2, z: 0 }, { x: 6, z: 0 }, 2, false);
    for (const p of arcPoints(arc, 12)) {
      expect(dist(p, arc.centre)).toBeCloseTo(2, 12);
    }
  });

  test('the sagitta of the emitted chords stays inside ARC_TOL', () => {
    const arc = arcFromChord({ x: 2, z: 0 }, { x: 6, z: 0 }, 2, false);
    const pts = arcPoints(arc, arcSegments(arc.radius, arc.sweep));
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const mid = mul(add(pts[i]!, pts[i + 1]!), 0.5);
      expect(arc.radius - dist(mid, arc.centre)).toBeLessThanOrEqual(ARC_TOL + 1e-12);
    }
  });
});

describe('polylineMidpoint', () => {
  test('an empty polyline has no midpoint', () => {
    expect(polylineMidpoint([])).toBeNull();
  });

  test('a single point is its own midpoint', () => {
    expect(polylineMidpoint([{ x: 2, z: -3 }])).toEqual({ x: 2, z: -3 });
  });

  test('a degenerate polyline falls back to its first point', () => {
    const repeated = [
      { x: 1, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 1 },
    ];
    expect(polylineMidpoint(repeated)).toEqual({ x: 1, z: 1 });
  });

  test('halves a straight segment', () => {
    const mid = polylineMidpoint([
      { x: 0, z: 0 },
      { x: 4, z: 0 },
    ])!;
    expect(mid.x).toBeCloseTo(2, 12);
    expect(mid.z).toBeCloseTo(0, 12);
  });

  test('measures by arc length, not by vertex count', () => {
    // 9 m of run then 1 m: the midpoint sits at 5 m, inside the first leg.
    const mid = polylineMidpoint([
      { x: 0, z: 0 },
      { x: 9, z: 0 },
      { x: 9, z: 1 },
    ])!;
    expect(mid.x).toBeCloseTo(5, 12);
    expect(mid.z).toBeCloseTo(0, 12);
  });

  test('lands on the corner when the two legs are equal', () => {
    const mid = polylineMidpoint([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 2 },
    ])!;
    expect(mid.x).toBeCloseTo(2, 12);
    expect(mid.z).toBeCloseTo(0, 12);
  });

  test('sits half the total length away along the path', () => {
    const points = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 4 },
    ];
    const mid = polylineMidpoint(points)!;
    expect(polylineLength([points[0]!, points[1]!, mid])).toBeCloseTo(polylineLength(points) / 2, 9);
  });
});

describe('segmentContact', () => {
  const v = (x: number, z: number): Vec2 => ({ x, z });

  test('two segments crossing in their interiors report the crossing point', () => {
    const hit = segmentContact(v(0, 0), v(4, 4), v(0, 4), v(4, 0))!;
    expect(hit).not.toBeNull();
    expect(hit.overlap).toBe(false);
    expect(hit.point.x).toBeCloseTo(2, 9);
    expect(hit.point.z).toBeCloseTo(2, 9);
  });

  test('a T-touch reports the touching point, not an overlap', () => {
    const hit = segmentContact(v(0, 0), v(4, 0), v(2, 0), v(2, 3))!;
    expect(hit.overlap).toBe(false);
    expect(hit.point.x).toBeCloseTo(2, 9);
    expect(hit.point.z).toBeCloseTo(0, 9);
  });

  test('collinear segments sharing more than a point report an overlap', () => {
    const hit = segmentContact(v(0, 0), v(4, 0), v(2, 0), v(6, 0))!;
    expect(hit.overlap).toBe(true);
    expect(hit.point.x).toBeCloseTo(3, 9);
    expect(hit.point.z).toBeCloseTo(0, 9);
  });

  test('collinear segments meeting head to head at one point are not an overlap', () => {
    expect(segmentContact(v(0, 0), v(4, 0), v(0, 0), v(-6, 0))!.overlap).toBe(false);
  });

  test('a gap inside EPS_PLANAR counts as contact', () => {
    const hit = segmentContact(v(0, 0), v(4, 0), v(2, -5e-5), v(2, -2))!;
    expect(hit).not.toBeNull();
    expect(hit.point.x).toBeCloseTo(2, 6);
  });

  test('a gap of one millimetre is no contact', () => {
    expect(segmentContact(v(0, 0), v(4, 0), v(2, -1e-3), v(2, -2))).toBeNull();
  });

  test('parallel segments a millimetre apart never touch', () => {
    expect(segmentContact(v(0, 0), v(4, 0), v(0, 1e-3), v(4, 1e-3))).toBeNull();
  });

  test('parallel segments inside the tolerance overlap', () => {
    const hit = segmentContact(v(0, 0), v(4, 0), v(1, 5e-5), v(3, 5e-5))!;
    expect(hit.overlap).toBe(true);
  });

  test('disjoint segments report nothing', () => {
    expect(segmentContact(v(0, 0), v(1, 0), v(2, 0), v(3, 0))).toBeNull();
  });
});
