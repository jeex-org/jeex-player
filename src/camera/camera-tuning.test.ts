/**
 * The camera feel, as data.
 *
 * `CAMERA_TUNING` is the one place an interaction literal may live, so the
 * tests here are about its SHAPE and its internal consistency — a clamp whose
 * bounds crossed, or a rate that went negative, inverts a control without
 * failing anything else.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CAMERA_TUNING } from './camera-tuning.js';
import { EYE_HEIGHT_M } from '../navigation/navigation.js';

const HERE = import.meta.dirname;
/** `src/`: the whole tree the height must not be re-declared anywhere in. */
const SRC = resolve(HERE, '..');

/** Every non-test `.ts` under `src/`, as a path relative to `src/`. */
function modulesUnderSrc(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...modulesUnderSrc(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) found.push(relative(SRC, path));
  }
  return found;
}

describe('CAMERA_TUNING', () => {
  test('the orbit clamps are ordered and its rates are positive', () => {
    const { orbit } = CAMERA_TUNING;
    expect(orbit.phiMin).toBeLessThan(orbit.phiMax);
    expect(orbit.minRadiusM).toBeLessThan(orbit.maxRadiusM);
    expect(orbit.startRadiusM).toBeGreaterThanOrEqual(orbit.minRadiusM);
    expect(orbit.startRadiusM).toBeLessThanOrEqual(orbit.maxRadiusM);
    expect(orbit.startPhiRad).toBeGreaterThan(orbit.phiMin);
    expect(orbit.startPhiRad).toBeLessThan(orbit.phiMax);
    for (const rate of [orbit.dragRadPerPx, orbit.panScalePerRadius, orbit.zoomRatePerPx, orbit.focusMinRadiusM, orbit.focusDurationS]) {
      expect(rate).toBeGreaterThan(0);
    }
    // A smoothing share outside (0, 1] either freezes the rig or overshoots it.
    expect(orbit.smoothing).toBeGreaterThan(0);
    expect(orbit.smoothing).toBeLessThanOrEqual(1);
    expect(orbit.focusRadiusFactor).toBeGreaterThan(0);
    expect(orbit.focusRadiusFactor).toBeLessThanOrEqual(1);
  });

  test('the walk pitch clamp straddles the horizon and the speeds are ordered', () => {
    const { walk } = CAMERA_TUNING;
    expect(walk.pitchMin).toBeLessThan(0);
    expect(walk.pitchMax).toBeGreaterThan(0);
    expect(walk.lookRadPerPx).toBeGreaterThan(0);
    expect(walk.pitchRadPerPx).toBeGreaterThan(0);
    expect(walk.speedMps).toBeGreaterThan(0);
    expect(walk.runSpeedMps).toBeGreaterThan(walk.speedMps);
    expect(walk.gazeDistanceM).toBeGreaterThan(0);
  });

  test('a double tap is the faster of the two approach rates', () => {
    const { tap } = CAMERA_TUNING;
    expect(tap.doubleRate).toBeGreaterThan(tap.singleRate);
    expect(tap.doubleWindowMs).toBeGreaterThan(0);
    expect(tap.doubleRadiusM).toBeGreaterThan(0);
  });

  test('the portrait field of view is the wider one', () => {
    const { fov } = CAMERA_TUNING;
    expect(fov.portrait).toBeGreaterThan(fov.wide);
    expect(fov.portraitAspect).toBeGreaterThan(0);
    expect(fov.portraitAspect).toBeLessThan(1);
    expect(fov.eyeLevelBoost).toBeGreaterThan(0);
    expect(fov.boostSpanM).toBeGreaterThan(0);
    // The boost is fully blended in by the time the camera is at eye height,
    // so walk mode always gets the whole of it and never a fraction that
    // depends on the ceiling.
    expect(fov.boostTopM - fov.boostSpanM).toBeGreaterThanOrEqual(EYE_HEIGHT_M);
    expect(fov.boostTopM).toBeGreaterThan(fov.boostSpanM);
  });

  test('a scripted travel eases at its ends without ever stopping', () => {
    const { travel } = CAMERA_TUNING;
    expect(travel.speedMps).toBeGreaterThan(0);
    expect(travel.easeFloor).toBeGreaterThan(0);
    expect(travel.easeFloor).toBeLessThan(1);
    expect(travel.easeSpan).toBeGreaterThan(0);
    expect(travel.easeSpan).toBeLessThanOrEqual(0.5);
    expect(travel.lookTauS).toBeGreaterThan(0);
    // The route gives up on a door well after the push that could open it.
    expect(travel.doorWaitS).toBeGreaterThan(CAMERA_TUNING.walk.doorPushS);
  });

  test('a wheel line is worth more than a wheel pixel', () => {
    expect(CAMERA_TUNING.wheel.linePx).toBeGreaterThan(1);
    expect(CAMERA_TUNING.wheel.pageFallbackPx).toBeGreaterThan(CAMERA_TUNING.wheel.linePx);
    expect(CAMERA_TUNING.pointer.dragThresholdPx).toBeGreaterThan(0);
    expect(CAMERA_TUNING.hover.heartbeatMs).toBeGreaterThan(0);
    expect(CAMERA_TUNING.maxFrameStepS).toBeGreaterThan(0);
  });

  test('the record is frozen: a mode may read the feel, never retune it', () => {
    expect(Object.isFrozen(CAMERA_TUNING)).toBe(true);
    expect(Object.isFrozen(CAMERA_TUNING.orbit)).toBe(true);
  });
});

describe('EYE_HEIGHT_M', () => {
  test('is a standing eye height, and the walker stands below the boost span', () => {
    expect(EYE_HEIGHT_M).toBeGreaterThan(1.2);
    expect(EYE_HEIGHT_M).toBeLessThan(2);
  });

  test('lives in navigation.ts alone: nothing re-declares the height', () => {
    // The router tested its legs at its own copy of 1.65 while the walk rig
    // snapped to another; the two are the same measurement and drifting them
    // apart would let a route be proved at a height the camera never stands at.
    const redeclared = modulesUnderSrc()
      .filter((name) => name !== 'navigation/navigation.ts')
      .filter((name) => new RegExp(`=\\s*${EYE_HEIGHT_M}\\b`).test(readFileSync(resolve(SRC, name), 'utf8')));
    expect(redeclared).toEqual([]);
  });
});
