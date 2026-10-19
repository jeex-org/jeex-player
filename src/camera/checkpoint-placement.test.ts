/**
 * Where a new tour camera stands: always on navigable floor, at eye height,
 * with a level pitch — the three things the orbit-target placement got wrong
 * (a camera inside the partition wall, staring −35° at the floor).
 */

import { describe, expect, test } from 'bun:test';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { solvePlan } from '../plan/plan-solver.js';
import { EYE_HEIGHT_M, isNavigable } from '../navigation/navigation.js';
import { TOUR_PITCH_LIMIT_RAD } from '../scene/types.js';
import {
  LEVEL_PITCH_RAD,
  STEP_BACK_M,
  canStand,
  framePose,
  poseFromDrop,
  poseFromEye,
  poseFromOrbit,
  standOn,
  type PlacementContext,
} from './checkpoint-placement.js';

const context: PlacementContext = { plan: solvePlan(lShapePlan), scene: lShapePlan, obstacles: [] };

const onFloor = (point: { x: number; z: number }): boolean => isNavigable(context.plan, { x: point.x, y: EYE_HEIGHT_M, z: point.z });

describe('standOn', () => {
  test('a point inside the partition wall is pulled into a room', () => {
    const spot = standOn(context, { x: 6, z: 1 });
    expect(onFloor(spot)).toBe(true);
    expect(Math.abs(spot.x - 6)).toBeLessThan(1.5);
  });

  test('a navigable point stays where it is', () => {
    expect(standOn(context, { x: 3, z: 3 })).toEqual({ x: 3, z: 3 });
  });

  test('a point outside the flat is pulled in', () => {
    expect(onFloor(standOn(context, { x: -4, z: 20 }))).toBe(true);
  });
});

describe('poseFromOrbit («Add from current view» in orbit)', () => {
  test('looking at the partition wall still lands on navigable floor, at eye height, level', () => {
    // The original repro: the reset view's target sits in the partition wall (clear of its door).
    const pose = poseFromOrbit(context, { position: { x: 6, y: 9, z: 14 }, target: { x: 6, y: 0, z: 1 }, centre: null }, []);
    expect(canStand(context.plan, pose.position)).toBe(true);
    expect(pose.position.y).toBe(EYE_HEIGHT_M);
    expect(pose.pitch).toBe(LEVEL_PITCH_RAD);
    // Never the orbit's own −35° tilt.
    expect(pose.pitch).toBeGreaterThan(-(10 / 180) * Math.PI);
    expect(pose.pitch).toBeLessThan(-(5 / 180) * Math.PI);
  });

  test('steps back toward the author and faces the looked-at point', () => {
    // Author south of room A's middle, looking north at (3, 0, 3).
    const pose = poseFromOrbit(context, { position: { x: 3, y: 6, z: 12 }, target: { x: 3, y: 0, z: 3 }, centre: null }, []);
    expect(pose.position.x).toBeCloseTo(3, 9);
    expect(pose.position.z).toBeCloseTo(3 + STEP_BACK_M, 9);
    expect(pose.yaw).toBeCloseTo(Math.PI, 9);
  });

  test('the screen-centre floor point wins over the orbit target', () => {
    const pose = poseFromOrbit(
      context,
      { position: { x: 3, y: 6, z: 12 }, target: { x: 8, y: 0, z: 2 }, centre: { x: 3, y: 0, z: 3 } },
      [],
    );
    expect(pose.position.x).toBeCloseTo(3, 9);
  });

  test('a second add from the same view steps off the first, still on the floor', () => {
    const view = { position: { x: 3, y: 6, z: 12 }, target: { x: 3, y: 0, z: 3 }, centre: null };
    const first = poseFromOrbit(context, view, []);
    const second = poseFromOrbit(context, view, [{ id: 'cam-1', ...first }]);
    expect(Math.hypot(second.position.x - first.position.x, second.position.z - first.position.z)).toBeGreaterThan(0.5);
    expect(onFloor(second.position)).toBe(true);
  });
});

describe('poseFromEye («Add from current view» in walk and look-through)', () => {
  test('copies the eye exactly', () => {
    const pose = poseFromEye(3.15, { position: { x: 2, y: 1.5, z: 3 }, target: { x: 2, y: 1.5, z: 7 } });
    expect(pose).toEqual({ position: { x: 2, y: 1.5, z: 3 }, yaw: 0, pitch: 0 });
  });

  test('clamps the pitch and the height to what a checkpoint may carry', () => {
    const pose = poseFromEye(2.4, { position: { x: 2, y: 3, z: 3 }, target: { x: 2, y: -5, z: 3.1 } });
    expect(pose.pitch).toBe(-TOUR_PITCH_LIMIT_RAD);
    expect(pose.position.y).toBeCloseTo(2.2, 9);
  });
});

describe('poseFromDrop (click-to-place)', () => {
  test('a click lands on navigable floor at eye height, level, along the fallback yaw', () => {
    const pose = poseFromDrop(context, { x: 6, z: 1 }, null, 1);
    expect(canStand(context.plan, pose.position)).toBe(true);
    expect(pose.position.y).toBe(EYE_HEIGHT_M);
    expect(pose.pitch).toBe(LEVEL_PITCH_RAD);
    expect(pose.yaw).toBe(1);
  });

  test('click-and-drag aims toward the release point; a tiny drag does not', () => {
    expect(poseFromDrop(context, { x: 3, z: 3 }, { x: 5, z: 3 }, 0).yaw).toBeCloseTo(Math.PI / 2, 9);
    expect(poseFromDrop(context, { x: 3, z: 3 }, { x: 3.1, z: 3 }, 0.25).yaw).toBe(0.25);
  });
});

describe('framePose', () => {
  test('frames from behind and above, looking at the camera', () => {
    const frame = framePose({ id: 'a', position: { x: 3, y: 1.6, z: 3 }, yaw: 0, pitch: 0 });
    expect(frame.position.z).toBeLessThan(3);
    expect(frame.position.y).toBeGreaterThan(1.6);
    expect(frame.target).toMatchObject({ x: 3, z: 3 });
  });
});
