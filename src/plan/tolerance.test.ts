import { describe, expect, test } from 'bun:test';
import { DEFAULT_TOLERANCE, EPS, EPS_PLANAR, anglesEqual, pointsCoincident } from './tolerance.js';
import { EPS as GEOMETRY_EPS, EPS_PLANAR as GEOMETRY_EPS_PLANAR } from './plan-geometry.js';

describe('DEFAULT_TOLERANCE', () => {
  test('names the four questions the plan asks separately', () => {
    expect(DEFAULT_TOLERANCE).toEqual({ linear: 1e-6, planar: 1e-4, angular: 1e-3, merge: 0.005 });
  });

  test('a merge tolerance is looser than a coincidence tolerance', () => {
    // The importer snaps endpoints millimetres apart; the solver calls two
    // points equal only when they are the same point to survey precision.
    expect(DEFAULT_TOLERANCE.merge).toBeGreaterThan(DEFAULT_TOLERANCE.linear);
    expect(DEFAULT_TOLERANCE.merge).toBeGreaterThan(DEFAULT_TOLERANCE.planar);
    expect(DEFAULT_TOLERANCE.planar).toBeGreaterThan(DEFAULT_TOLERANCE.linear);
  });
});

describe('EPS re-export', () => {
  test('plan-geometry keeps handing out the same constants it always did', () => {
    // The regression that matters: none of the ~90 `EPS` call sites moved.
    expect(GEOMETRY_EPS).toBe(DEFAULT_TOLERANCE.linear);
    expect(GEOMETRY_EPS_PLANAR).toBe(DEFAULT_TOLERANCE.planar);
    expect(EPS).toBe(GEOMETRY_EPS);
    expect(EPS_PLANAR).toBe(GEOMETRY_EPS_PLANAR);
  });

  test('the values themselves are unchanged', () => {
    expect(EPS).toBe(1e-6);
    expect(EPS_PLANAR).toBe(1e-4);
  });
});

describe('anglesEqual', () => {
  test('is wrap-around aware', () => {
    expect(anglesEqual(0, 2 * Math.PI - 1e-4)).toBe(true);
    expect(anglesEqual(2 * Math.PI - 1e-4, 0)).toBe(true);
    expect(anglesEqual(-Math.PI, Math.PI)).toBe(true);
    expect(anglesEqual(0, 8 * Math.PI)).toBe(true);
  });

  test('separates angles further apart than the angular tolerance', () => {
    expect(anglesEqual(0, 2e-3)).toBe(false);
    expect(anglesEqual(0, Math.PI)).toBe(false);
    expect(anglesEqual(1, -1)).toBe(false);
  });

  test('the boundary is inclusive', () => {
    expect(anglesEqual(0, DEFAULT_TOLERANCE.angular)).toBe(true);
    expect(anglesEqual(0, DEFAULT_TOLERANCE.angular * 1.001)).toBe(false);
  });

  test('a caller may widen or tighten the tolerance', () => {
    const loose = { ...DEFAULT_TOLERANCE, angular: 0.5 };
    expect(anglesEqual(0, 0.4, loose)).toBe(true);
    const tight = { ...DEFAULT_TOLERANCE, angular: 1e-9 };
    expect(anglesEqual(0, 1e-6, tight)).toBe(false);
  });

  test('a non-finite angle is never equal to anything', () => {
    expect(anglesEqual(Number.NaN, 0)).toBe(false);
    expect(anglesEqual(0, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('pointsCoincident', () => {
  test('points inside the linear tolerance are one point', () => {
    expect(pointsCoincident({ x: 0, z: 0 }, { x: 5e-7, z: 0 })).toBe(true);
    expect(pointsCoincident({ x: 3, z: -2 }, { x: 3, z: -2 })).toBe(true);
  });

  test('points further apart are two points', () => {
    expect(pointsCoincident({ x: 0, z: 0 }, { x: 2e-6, z: 0 })).toBe(false);
    expect(pointsCoincident({ x: 0, z: 0 }, { x: 0, z: 1e-3 })).toBe(false);
  });

  test('the distance is euclidean, not per axis', () => {
    // 8e-7 on both axes is 1.13e-6 apart: two points, though each axis is inside.
    expect(pointsCoincident({ x: 0, z: 0 }, { x: 8e-7, z: 8e-7 })).toBe(false);
  });

  test('a caller may pass the merge tolerance of an importer', () => {
    const merging = { ...DEFAULT_TOLERANCE, linear: DEFAULT_TOLERANCE.merge };
    expect(pointsCoincident({ x: 0, z: 0 }, { x: 0.004, z: 0 }, merging)).toBe(true);
    expect(pointsCoincident({ x: 0, z: 0 }, { x: 0.006, z: 0 }, merging)).toBe(false);
  });
});
