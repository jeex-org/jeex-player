/**
 * The track's corner rounding and eased heights: the geometry contract the
 * route derivation builds on, apart from any plan.
 */

import { describe, expect, test } from 'bun:test';
import { cornerReach, easedHeights, roundCorners, TRACK_CORNER_MAX_M } from './tour-track.js';
import type { Vec2 } from './types.js';

const STEP = 0.1;

/** The largest heading change per metre between neighbouring hops: the track's tightest curvature, rad/m. */
function tightest(points: readonly Vec2[]): number {
  let worst = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const c = points[index + 1]!;
    const turn = Math.abs(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z));
    const wrapped = Math.min(turn, 2 * Math.PI - turn);
    worst = Math.max(worst, wrapped / ((Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z)) / 2));
  }
  return worst;
}

describe('roundCorners', () => {
  /** A right-angle corner between two four-metre straights. */
  const L_SHAPE: Vec2[] = [
    { x: 0, z: 0 },
    { x: 0, z: 4 },
    { x: 4, z: 4 },
  ];

  test('a through corner (a camera) is passed exactly, on a curve no tighter than half a metre of radius', () => {
    const through = [true, true, true];
    const track = roundCorners(L_SHAPE, through, cornerReach(L_SHAPE, through), STEP);
    expect(track.points[track.at[1]!]).toEqual({ x: 0, z: 4 });
    expect(track.points[0]).toEqual({ x: 0, z: 0 });
    expect(track.points.at(-1)).toEqual({ x: 4, z: 4 });
    // The bare polyline turns 90° on the spot; the rounded track bends at most 2 rad/m.
    expect(tightest(track.points)).toBeLessThan(2);
  });

  test('a cut corner (a walk waypoint) is rounded off inside the corner, never further than its reach', () => {
    const through = [true, false, true];
    const reach = cornerReach(L_SHAPE, through);
    expect(reach[1]).toEqual({ before: TRACK_CORNER_MAX_M, after: TRACK_CORNER_MAX_M });
    const track = roundCorners(L_SHAPE, through, reach, STEP);
    expect(tightest(track.points)).toBeLessThan(1.5);
    // Inside the corner: x never negative, z never past the outgoing straight.
    for (const point of track.points) {
      expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      expect(point.z).toBeLessThanOrEqual(4 + 1e-9);
    }
    const [first, last] = track.span[1]!;
    expect(track.points[first]).toEqual({ x: 0, z: 4 - TRACK_CORNER_MAX_M });
    expect(track.points[last]!.x).toBeCloseTo(TRACK_CORNER_MAX_M, 9);
  });

  test('a short straight into a doorway leaves the turn a long arm on its open side', () => {
    // Standoff 0.45 m before a door centre that sits on a straight crossing.
    const controls: Vec2[] = [
      { x: -3, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 0.45 },
      { x: 0, z: 0.9 },
    ];
    const reach = cornerReach(controls, [true, false, true, true]);
    expect(reach[1]!.before).toBe(TRACK_CORNER_MAX_M);
    // The door centre takes no rounding, so the standoff may use nearly the whole 0.45 m.
    expect(reach[1]!.after).toBeCloseTo(0.405, 9);
    expect(reach[2]).toEqual({ before: 0, after: 0 });
  });

  test('a through corner that turns back stays sharp: the run stops there instead', () => {
    const controls: Vec2[] = [
      { x: 0, z: 0 },
      { x: 0, z: 3 },
      { x: 0.2, z: 0 },
    ];
    expect(cornerReach(controls, [true, true, true])[1]).toEqual({ before: 0, after: 0 });
  });

  test('zero reach is the bare polyline', () => {
    const track = roundCorners(
      L_SHAPE,
      [true, false, true],
      L_SHAPE.map(() => ({ before: 0, after: 0 })),
      STEP,
    );
    expect(track.points[track.at[1]!]).toEqual({ x: 0, z: 4 });
    expect(track.span[1]).toEqual([track.at[1]!, track.at[1]!]);
  });
});

describe('easedHeights', () => {
  const straight = Array.from({ length: 41 }, (_, index) => ({ x: 0, z: index * 0.1 }));

  test('eases from camera to camera with no vertical jolt at either end', () => {
    const heights = easedHeights(straight, 1.2, 1.8, [], []);
    expect(heights[0]).toBe(1.2);
    expect(heights.at(-1)).toBe(1.8);
    // Flat at both cameras, steepest in the middle.
    expect(heights[1]! - heights[0]!).toBeLessThan(1e-3);
    expect(heights.at(-1)! - heights.at(-2)!).toBeLessThan(1e-3);
    expect(heights[21]! - heights[20]!).toBeGreaterThan(0.02);
  });

  test('keeps under a door head where one applies, and starts the dip smoothly', () => {
    const high = straight.map((point) => (point.z >= 1.8 && point.z <= 2.2 ? 1.5 : Number.POSITIVE_INFINITY));
    const heights = easedHeights(straight, 1.7, 1.7, [], high);
    straight.forEach((point, index) => {
      if (point.z >= 1.8 && point.z <= 2.2) expect(heights[index]!).toBeLessThanOrEqual(1.5 + 1e-9);
    });
    // The largest step between samples stays small: no step down at the door.
    const steps = heights.slice(1).map((y, index) => Math.abs(y - heights[index]!));
    expect(Math.max(...steps)).toBeLessThan(0.05);
  });
});
