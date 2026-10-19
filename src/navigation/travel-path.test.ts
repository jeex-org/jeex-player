/**
 * The curve a scripted travel follows: string-pulled, corner-rounded, and
 * resampled at equal arc length.
 *
 * Every case here is a hand-checked polyline, because the point of the module
 * is geometric: the samples are what the camera's position IS, so an error of
 * a centimetre is an error the user sees.
 */

import { describe, expect, test } from 'bun:test';
import { TRAVEL_SAMPLE_M, TURN_RADIUS_M, buildTravelPath, pointAt, tangentAt } from './travel-path.js';
import type { Vec2 } from '../scene/types.js';

/** Nothing is ever in the way. */
const OPEN = (): boolean => true;

/** Distance from a point to a segment. */
function toSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const span = dx * dx + dz * dz;
  const t = span < 1e-12 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / span));
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

/**
 * An L-shaped corridor `width` wide around the two legs: wide enough for the
 * corner to be rounded, too narrow for the diagonal to be pulled straight.
 */
function corridor(legs: Vec2[], width: number) {
  const inside = (point: Vec2): boolean => legs.some((_, i) => i + 1 < legs.length && toSegment(point, legs[i]!, legs[i + 1]!) <= width);
  return (a: Vec2, b: Vec2): boolean => {
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      if (!inside({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
    }
    return true;
  };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Heading of a segment, radians. */
function heading(a: Vec2, b: Vec2): number {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

/** Biggest turn between two consecutive samples, degrees. */
function maxTurnDeg(points: Vec2[]): number {
  let worst = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    let turn = heading(points[i]!, points[i + 1]!) - heading(points[i - 1]!, points[i]!);
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    worst = Math.max(worst, Math.abs(turn));
  }
  return (worst * 180) / Math.PI;
}

/** Distance from `point` to the closest place on the sampled path. */
function distanceToPath(points: Vec2[], point: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const span = dx * dx + dz * dz;
    const t = span < 1e-12 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / span));
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t)));
  }
  return best;
}

describe('buildTravelPath: sampling', () => {
  test('samples are equally spaced, first is the start and last is the goal', () => {
    const path = buildTravelPath(
      [
        { x: 0, z: 0 },
        { x: 3, z: 0 },
        { x: 3, z: 3 },
      ],
      OPEN,
    );
    expect(path.points.length).toBeGreaterThan(20);
    expect(path.points[0]!.x).toBeCloseTo(0, 6);
    expect(path.points[0]!.z).toBeCloseTo(0, 6);
    expect(path.points.at(-1)!.x).toBeCloseTo(3, 6);
    expect(path.points.at(-1)!.z).toBeCloseTo(3, 6);
    for (let i = 0; i + 2 < path.points.length; i += 1) {
      expect(distance(path.points[i]!, path.points[i + 1]!)).toBeCloseTo(TRAVEL_SAMPLE_M, 3);
    }
    // The tail is whatever is left over, never longer than a full step.
    expect(distance(path.points.at(-2)!, path.points.at(-1)!)).toBeLessThanOrEqual(TRAVEL_SAMPLE_M + 1e-9);
  });

  test('`at` is the cumulative distance of every sample and ends at `length`', () => {
    const path = buildTravelPath(
      [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
        { x: 2, z: 2 },
      ],
      OPEN,
    );
    expect(path.at.length).toBe(path.points.length);
    expect(path.at[0]).toBe(0);
    expect(path.at.at(-1)).toBeCloseTo(path.length, 9);
    for (let i = 0; i + 1 < path.at.length; i += 1) {
      expect(path.at[i + 1]! - path.at[i]!).toBeCloseTo(distance(path.points[i]!, path.points[i + 1]!), 9);
    }
  });
});

describe('buildTravelPath: corners', () => {
  test('a right-angle corner is rounded inside the turn radius and turns gently', () => {
    const corner = { x: 3, z: 0 };
    const legs = [{ x: 0, z: 0 }, corner, { x: 3, z: 3 }];
    const path = buildTravelPath(legs, corridor(legs, 0.95));
    // Every sample is either on one of the two legs or inside the cut.
    for (const sample of path.points) {
      const onFirstLeg = Math.abs(sample.z) < 1e-9;
      const onSecondLeg = Math.abs(sample.x - 3) < 1e-9;
      if (onFirstLeg || onSecondLeg) continue;
      expect(distance(sample, corner)).toBeLessThanOrEqual(TURN_RADIUS_M + 1e-9);
    }
    expect(maxTurnDeg(path.points)).toBeLessThanOrEqual(12);
    // Rounding shortens: never longer than the polyline it came from.
    expect(path.length).toBeLessThan(6);
    expect(path.length).toBeGreaterThan(5.4);
  });

  test('a corner whose surroundings are blocked stays sharp', () => {
    const corner = { x: 2, z: 0 };
    const route = [{ x: 0, z: 0 }, corner, { x: 2, z: 2 }];
    // Only movement ALONG the two legs is allowed: every rounded corner leaves
    // them, and the string pull may not cut the corner either.
    const onLeg = (point: Vec2): 'first' | 'second' | null => {
      if (Math.abs(point.z) < 1e-6 && point.x >= -1e-6 && point.x <= 2 + 1e-6) return 'first';
      if (Math.abs(point.x - 2) < 1e-6 && point.z >= -1e-6 && point.z <= 2 + 1e-6) return 'second';
      return null;
    };
    const clear = (a: Vec2, b: Vec2): boolean => {
      const legA = onLeg(a);
      return legA !== null && legA === onLeg(b);
    };
    const path = buildTravelPath(route, clear);
    expect(distanceToPath(path.points, corner)).toBeLessThan(0.001);
    // Both legs are 2 m, a whole number of samples, so the corner IS a sample.
    expect(path.points.some((sample) => distance(sample, corner) < 0.001)).toBe(true);
    expect(path.length).toBeCloseTo(4, 6);
  });
});

describe('buildTravelPath: doors', () => {
  /** A doorway on the wall at z = 2, its standoff points 0.45 m either side. */
  const near = { x: 3, z: 1.55, door: 'door-ab' };
  const far = { x: 3, z: 2.45, door: 'door-ab' };

  test('the middle of the doorway leg is crossed straight and square', () => {
    const path = buildTravelPath([{ x: 0, z: 0 }, near, far, { x: 6, z: 4 }], OPEN);
    // The wall is crossed on the straight band the two fillets leave behind:
    // dead on the standoff line, so the camera goes through square.
    const between = path.points.filter((sample) => sample.z > 1.95 && sample.z < 2.05);
    expect(between.length).toBeGreaterThan(1);
    for (const sample of between) {
      const cross = (far.x - near.x) * (sample.z - near.z) - (far.z - near.z) * (sample.x - near.x);
      expect(Math.abs(cross)).toBeLessThanOrEqual(1e-6);
    }
  });

  test('a door standoff point is never pulled out of the route', () => {
    // Without the tag the string pull would take both of them: the way round
    // is clear here, and only the door marking keeps the crossing square.
    const path = buildTravelPath([{ x: 2, z: 1 }, near, far, { x: 4, z: 3 }], OPEN);
    expect(distanceToPath(path.points, near)).toBeLessThan(0.15);
    expect(distanceToPath(path.points, far)).toBeLessThan(0.15);
    const crossing = path.points.filter((sample) => sample.z > 1.95 && sample.z < 2.05);
    expect(crossing.length).toBeGreaterThan(1);
    for (const sample of crossing) expect(Math.abs(sample.x - 3)).toBeLessThan(0.001);
  });
});

describe('buildTravelPath: string pull', () => {
  test('a zig-zag of clear waypoints collapses to the straight line', () => {
    const route = [
      { x: 0, z: 0 },
      { x: 1, z: 0.4 },
      { x: 2, z: -0.3 },
      { x: 3, z: 0.5 },
      { x: 4, z: 0 },
    ];
    const path = buildTravelPath(route, OPEN);
    expect(path.length).toBeCloseTo(4, 3);
    for (const sample of path.points) expect(Math.abs(sample.z)).toBeLessThan(0.001);
  });

  test('a waypoint no straight line replaces is kept', () => {
    const detour = { x: 1, z: 2 };
    const route = [{ x: 0, z: 0 }, detour, { x: 2, z: 0 }];
    // The direct line home is blocked; only the two legs are walkable.
    const clear = (a: Vec2, b: Vec2): boolean => !(Math.abs(a.z) < 1e-9 && Math.abs(b.z) < 1e-9);
    const path = buildTravelPath(route, clear);
    expect(distanceToPath(path.points, detour)).toBeLessThan(TURN_RADIUS_M);
    expect(path.length).toBeGreaterThan(3.5);
  });
});

describe('pointAt and tangentAt', () => {
  const path = buildTravelPath(
    [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
    ],
    OPEN,
  );

  test('reads the start, the goal and everything between', () => {
    expect(pointAt(path, 0)).toEqual({ x: 0, z: 0 });
    const end = pointAt(path, path.length);
    expect(end.x).toBeCloseTo(4, 6);
    expect(end.z).toBeCloseTo(0, 6);
    expect(pointAt(path, 1.5).x).toBeCloseTo(1.5, 6);
  });

  test('clamps outside its own length', () => {
    expect(pointAt(path, -1).x).toBeCloseTo(0, 6);
    expect(pointAt(path, path.length + 1).x).toBeCloseTo(4, 6);
  });

  test('the tangent is the unit direction of travel', () => {
    const tangent = tangentAt(path, 2);
    expect(tangent.x).toBeCloseTo(1, 6);
    expect(tangent.z).toBeCloseTo(0, 6);
    expect(Math.hypot(tangent.x, tangent.z)).toBeCloseTo(1, 9);
    expect(tangentAt(path, 0).x).toBeCloseTo(1, 6);
    expect(tangentAt(path, path.length).x).toBeCloseTo(1, 6);
  });

  test('a corner turns the tangent from one leg onto the other', () => {
    const legs = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 3 },
    ];
    const turned = buildTravelPath(legs, corridor(legs, 0.95));
    expect(tangentAt(turned, 0.5).x).toBeCloseTo(1, 3);
    expect(tangentAt(turned, turned.length - 0.5).z).toBeCloseTo(1, 3);
  });
});

describe('degenerate routes', () => {
  test('a single point is a path of zero length', () => {
    const path = buildTravelPath([{ x: 1, z: 2 }], OPEN);
    expect(path.length).toBe(0);
    expect(path.points).toEqual([{ x: 1, z: 2 }]);
    expect(pointAt(path, 5)).toEqual({ x: 1, z: 2 });
    expect(Math.hypot(tangentAt(path, 0).x, tangentAt(path, 0).z)).toBeCloseTo(1, 9);
  });

  test('repeated waypoints do not become zero-length samples', () => {
    const path = buildTravelPath(
      [
        { x: 0, z: 0 },
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ],
      OPEN,
    );
    expect(path.length).toBeCloseTo(1, 6);
    for (let i = 0; i + 2 < path.points.length; i += 1) {
      expect(distance(path.points[i]!, path.points[i + 1]!)).toBeCloseTo(TRAVEL_SAMPLE_M, 6);
    }
  });
});
