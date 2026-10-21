/**
 * The motion of a checkpoint run as a viewer sees it, frame by frame
 * (smoothing and the speed setting): played through
 * `TourPlayer` at 60 fps on real flats, read back from the poses it emits.
 */

import * as THREE from 'three';
import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import { sixCameraTour } from '../fixtures/tour-six-cameras.js';
import { threeCameraTour } from '../fixtures/tour-three-cameras.js';
import { tourNavigation } from '../navigation/tour-legs.js';
import { solvePlan } from '../plan/plan-solver.js';
import { TourPlayer, TOUR_TRACK_SPEED_FACTOR } from './tour-player.js';
import { DEFAULT_TOUR_SPEED_MPS } from '../scene/tour-route.js';
import { MAX_PITCH_RATE, MAX_YAW_RATE } from './tour-motion.js';
import type { SceneData } from '../scene/types.js';

const FRAME = 1 / 60;
const DEG = 180 / Math.PI;

/** Ids of the tour cameras this file places itself. */
const CAM = {
  c1: '01a12ffa-736e-7434-8b6e-f0f46304d363',
  c2: '01a12ffa-736f-74bc-89e8-9a88d8f86221',
  c3: '01a12ffa-7370-7111-95f7-7931809d00eb',
} as const;

type Frame = { yaw: number; pitch: number; distance: number; position: THREE.Vector3 };

function playerOf(scene: SceneData, frames: Frame[]): TourPlayer {
  let distance = 0;
  const player = new TourPlayer(
    scene,
    (position, target) => {
      const look = target.clone().sub(position).normalize();
      frames.push({ yaw: Math.atan2(look.x, look.z), pitch: Math.asin(look.y), distance, position: position.clone() });
    },
    {
      onState: () => undefined,
      onProgress: (progress) => {
        distance = progress.distance;
        const last = frames.at(-1);
        if (last) last.distance = progress.distance;
      },
    },
    tourNavigation(solvePlan(scene), scene),
  );
  // A cut onto camera 1: the opening glide is a straight line of its own (pose-glide.test.ts).
  player.setMotionInstant(true);
  return player;
}

/** A whole run, frame by frame. */
function ride(scene: SceneData): Frame[] {
  const frames: Frame[] = [];
  const player = playerOf(scene, frames);
  player.play();
  for (let guard = 0; player.getState() !== 'ended' && guard < 60 * 300; guard += 1) player.update(FRAME);
  expect(player.getState()).toBe('ended');
  return frames;
}

function rates(frames: readonly Frame[], read: (frame: Frame) => number, wrap: boolean): number[] {
  return frames.slice(1).map((frame, index) => {
    const change = read(frame) - read(frames[index]!);
    return (wrap ? Math.atan2(Math.sin(change), Math.cos(change)) : change) / FRAME;
  });
}

function largestJump(values: readonly number[]): number {
  return values.slice(1).reduce((worst, value, index) => Math.max(worst, Math.abs(value - values[index]!)), 0);
}

const FLATS: Array<readonly [string, SceneData]> = [
  ['the six-camera walk through the demo flat', { ...apartmentScene, tourCheckpoints: [...sixCameraTour] }],
  ['the three-camera diagnosis flat', threeCameraTour],
];

describe('a checkpoint run moves smoothly', () => {
  /*
   * Thresholds. The gaze's rates are capped by the speed profile at
   * `MAX_YAW_RATE` (75°/s) and `MAX_PITCH_RATE` (30°/s); a margin of 2°/s
   * covers the frame-sampled read. The change of a rate between two frames
   * at 60 fps is bounded by the 100°/s² gaze acceleration (1.7°/s per frame)
   * plus the speed changing under it: 5°/s per frame for yaw and 3°/s for
   * pitch, against a measured 3.4 and 2.1 here and, before the smoothing,
   * 10.2 to 6029 for yaw (a 100° snap) and 4.6 for pitch. The along-track speed changes by at most 1 m/s² (the profile)
   * plus the track ramps' 5 m/s² peak at a standstill: 0.1 m/s per frame.
   */
  test.each(FLATS)('%s: the gaze turns and tilts within its rates, and no rate or speed jumps', (_, scene) => {
    const frames = ride(scene);
    const yaw = rates(frames, (frame) => frame.yaw, true);
    const pitch = rates(frames, (frame) => frame.pitch, false);
    const speed = rates(frames, (frame) => frame.distance, false);
    expect(Math.max(...yaw.map((value) => Math.abs(value)))).toBeLessThan(MAX_YAW_RATE * DEG + 2);
    expect(Math.max(...pitch.map((value) => Math.abs(value)))).toBeLessThan(MAX_PITCH_RATE * DEG + 2);
    expect(largestJump(yaw) * DEG).toBeLessThan(5);
    expect(largestJump(pitch) * DEG).toBeLessThan(3);
    expect(largestJump(speed)).toBeLessThan(0.1);
  });

  test('the run comes to a standstill where the track turns back on a camera, then leaves it', () => {
    // The kitchen is a dead end: the walk turns back on its camera.
    const frames = ride({ ...apartmentScene, tourCheckpoints: [...sixCameraTour] });
    const kitchen = new THREE.Vector3(1.2, 1.5, 1.2);
    const index = frames.reduce(
      (best, frame, at) => (frame.position.distanceTo(kitchen) < frames[best]!.position.distanceTo(kitchen) ? at : best),
      0,
    );
    expect(frames[index]!.position.distanceTo(kitchen)).toBeLessThan(0.01);
    const step = (at: number): number => frames[at + 1]!.distance - frames[at]!.distance;
    // Within a frame or two of the turn the run crawls under 6 cm/s.
    expect(Math.min(...[-2, -1, 0, 1].map((offset) => step(index + offset)))).toBeLessThan(0.001);
    // Half a second either side it moves at walking pace again.
    expect(step(index - 30)).toBeGreaterThan(0.004);
    expect(step(index + 30)).toBeGreaterThan(0.004);
  });
});

describe('the speed setting', () => {
  /** A straight six-metre track: no turn slows it, so every frame runs at the setting's cruise. */
  const STRAIGHT = {
    ...apartmentScene,
    tourCheckpoints: [
      { id: CAM.c1, position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 },
      { id: CAM.c2, position: { x: 0, y: 1.6, z: 3 }, yaw: 0, pitch: 0 },
      { id: CAM.c3, position: { x: 0, y: 1.6, z: 6 }, yaw: 0, pitch: 0 },
    ],
  };
  const cruise = (apartmentScene.autotour.speed ?? DEFAULT_TOUR_SPEED_MPS) * TOUR_TRACK_SPEED_FACTOR;
  const onFirst = { position: new THREE.Vector3(0, 1.6, 0), target: new THREE.Vector3(0, 1.6, 1) };

  function straight(): TourPlayer {
    return new TourPlayer(STRAIGHT, () => undefined, { onState: () => undefined, onProgress: () => undefined });
  }

  /** Metres covered by the next frame. */
  function step(player: TourPlayer): number {
    const before = player.progress().distance;
    player.update(FRAME);
    return player.progress().distance - before;
  }

  function advance(player: TourPlayer, seconds: number): void {
    for (let clock = 0; clock < seconds - 1e-9; clock += FRAME) player.update(FRAME);
  }

  test('the clip keeps its 1x clock: duration, elapsed and seeks never change with the setting', () => {
    const player = straight();
    const duration = player.getDuration();
    player.seekTime(2);
    const distance = player.progress().distance;
    player.setSpeed(2);
    expect(player.progress()).toMatchObject({ duration, elapsed: 2, distance, speed: 2 });
    player.setSpeed(0.5);
    expect(player.getDuration()).toBe(duration);
    player.seekTime(2);
    expect(player.progress().distance).toBe(distance);
  });

  test('a change mid-play never moves the camera and eases the speed over half a second', () => {
    const player = straight();
    player.play(onFirst);
    advance(player, 1);
    const before = step(player);
    expect(before / FRAME).toBeCloseTo(cruise, 6);
    const held = player.progress().distance;
    player.setSpeed(2);
    expect(player.progress().distance).toBe(held);
    // The first frame after the change is barely faster; half a second later it runs at twice the pace.
    expect(step(player) / before).toBeLessThan(1.01);
    advance(player, 0.5);
    expect(step(player) / before).toBeCloseTo(2, 6);
  });

  test('the ramps stay half a second of wall-clock time, and a 2x run ends in about half the time', () => {
    const wall = (speed: 0.5 | 1 | 2): { half: number; full: number; seconds: number } => {
      const player = straight();
      player.setSpeed(speed);
      player.play(onFirst);
      advance(player, 0.25 - FRAME);
      const half = step(player) / (cruise * speed * FRAME);
      advance(player, 0.25);
      const full = step(player) / (cruise * speed * FRAME);
      let frames = 0.5 / FRAME + 1;
      for (; player.getState() === 'playing' && frames < 60 * 60; frames += 1) player.update(FRAME);
      return { half, full, seconds: frames * FRAME };
    };
    const [slow, normal, fast] = [wall(0.5), wall(1), wall(2)];
    for (const run of [slow, normal, fast]) {
      expect(run.half).toBeCloseTo(0.5, 1);
      expect(run.full).toBeCloseTo(1, 2);
    }
    // Motion time halves with the factor; the two 0.5 s ramps and the end hold do not scale.
    expect(fast.seconds).toBeLessThan(normal.seconds * 0.6);
    expect(slow.seconds).toBeGreaterThan(normal.seconds * 1.7);
  });
});

describe('a recording carries the ramps', () => {
  const SIX = { ...apartmentScene, tourCheckpoints: [...sixCameraTour] };

  /**
   * What `capture.frames` does with the player, without a renderer: frame `i`
   * at `seekTime(i × speed / fps)`, `round(duration / speed × fps) + 1` frames.
   */
  function record(speed: 0.5 | 1 | 2, fps: number): { duration: number; positions: THREE.Vector3[] } {
    const frames: Frame[] = [];
    const player = playerOf(SIX, frames);
    const duration = player.getDuration();
    const count = Math.round((duration / speed) * fps) + 1;
    const positions: THREE.Vector3[] = [];
    for (let index = 0; index < count; index += 1) {
      player.seekTime((index * speed) / fps);
      positions.push(frames.at(-1)!.position.clone());
    }
    return { duration, positions };
  }

  /** Metres between consecutive frames. */
  function steps(positions: readonly THREE.Vector3[]): number[] {
    return positions.slice(1).map((position, index) => position.distanceTo(positions[index]!));
  }

  test('the reported duration is the live 1x run, ramps and end hold included', () => {
    const live = ride(SIX).length * FRAME;
    const frames: Frame[] = [];
    const duration = playerOf(SIX, frames).getDuration();
    // The live count adds the cut onto camera 1 and the frame that crosses the end (measured 2.2 frames).
    expect(Math.abs(duration - live)).toBeLessThan(3 * FRAME);
    // Without the ramps it would be half a second short of the run.
    expect(Math.abs(duration - 0.5 - live)).toBeGreaterThan(0.4);
  });

  test.each([
    [0.5, 30],
    [1, 30],
    [2, 30],
    [2, 24],
  ] as const)('at %sx and %s fps: the formula count, starting and ending at a standstill like the live run', (speed, fps) => {
    const { duration, positions } = record(speed, fps);
    expect(positions.length).toBe(Math.round((duration / speed) * fps) + 1);
    const moved = steps(positions);
    // The cruise step for scale: about 1.2 m/s × speed / fps.
    const cruise = Math.max(...moved);
    expect(cruise).toBeGreaterThan(0.02);
    // The first step leaves camera 1 from a standstill: guards against a clip that starts at full cruise.
    expect(moved[0]!).toBeLessThan(cruise * 0.1);
    // The last step that still moves lands on the last camera barely moving: no jump into the end hold.
    const lastMoving = moved.findLastIndex((step) => step > 1e-9);
    expect(moved[lastMoving]!).toBeLessThan(cruise * 0.1);
    // The end hold follows it, and the clip ends on the last camera.
    expect(lastMoving).toBeLessThan(moved.length - 1);
    const last = sixCameraTour.at(-1)!.position;
    expect(positions.at(-1)!.distanceTo(new THREE.Vector3(last.x, last.y, last.z))).toBeLessThan(1e-6);
  });

  test('deterministic per speed: two recordings are identical, frame for frame', () => {
    for (const speed of [0.5, 1, 2] as const) {
      const first = record(speed, 25).positions;
      const second = record(speed, 25).positions;
      expect(second.length).toBe(first.length);
      second.forEach((position, index) => expect(position.equals(first[index]!)).toBe(true));
    }
  });
});
