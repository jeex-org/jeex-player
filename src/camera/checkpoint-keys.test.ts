/**
 * The keyboard nudges' key map and pose arithmetic, and the idle commit that
 * turns a burst of presses into one edit.
 */

import { describe, expect, test } from 'bun:test';
import { IdleCommit, applyNudge, nudgeFor, type Scheduler } from './checkpoint-keys.js';
import { TOUR_PITCH_LIMIT_RAD } from '../scene/types.js';

const CAM = { id: '01a12ffa-7372-7cac-b636-7cfe05d89ce8', position: { x: 1, y: 1.6, z: 1 }, yaw: 0, pitch: 0 };
const DEG5 = (5 / 180) * Math.PI;

describe('nudgeFor', () => {
  test('the documented key map', () => {
    expect(nudgeFor('ArrowUp', false)).toMatchObject({ kind: 'pose', forward: 0.1 });
    expect(nudgeFor('ArrowUp', true)).toMatchObject({ kind: 'pose', forward: 0.5 });
    expect(nudgeFor('ArrowLeft', false)).toMatchObject({ kind: 'pose', right: -0.1 });
    expect(nudgeFor('Q', false)).toMatchObject({ kind: 'pose', turn: DEG5 });
    expect(nudgeFor('e', false)).toMatchObject({ kind: 'pose', turn: -DEG5 });
    expect(nudgeFor('r', false)).toMatchObject({ kind: 'pose', tilt: DEG5 });
    expect(nudgeFor('f', false)).toMatchObject({ kind: 'pose', tilt: -DEG5 });
    expect(nudgeFor('PageUp', false)).toMatchObject({ kind: 'pose', lift: 0.1 });
    expect(nudgeFor('PageDown', false)).toMatchObject({ kind: 'pose', lift: -0.1 });
    expect(nudgeFor('Delete', false)).toEqual({ kind: 'delete' });
    expect(nudgeFor('Escape', false)).toEqual({ kind: 'deselect' });
    expect(nudgeFor('w', false)).toBeNull();
  });
});

describe('applyNudge', () => {
  const pose = (key: string): ReturnType<typeof nudgeFor> & { kind: 'pose' } =>
    nudgeFor(key, false) as ReturnType<typeof nudgeFor> & { kind: 'pose' };

  test('«up» moves away from the author and «right» moves right on screen, whatever the camera faces', () => {
    // Author looking along -Z (yaw PI): screen-right is +X.
    const up = applyNudge(CAM, pose('ArrowUp'), Math.PI, 3);
    expect(up.position.z).toBeCloseTo(0.9, 9);
    const right = applyNudge(CAM, pose('ArrowRight'), Math.PI, 3);
    expect(right.position.x).toBeCloseTo(1.1, 9);
    expect(right.position.z).toBeCloseTo(1, 9);
  });

  test('clamps tilt and height', () => {
    const tilted = applyNudge({ ...CAM, pitch: TOUR_PITCH_LIMIT_RAD }, pose('r'), 0, 3);
    expect(tilted.pitch).toBe(TOUR_PITCH_LIMIT_RAD);
    const high = applyNudge({ ...CAM, position: { x: 1, y: 2.75, z: 1 } }, pose('PageUp'), 0, 3);
    expect(high.position.y).toBeCloseTo(2.8, 9);
  });
});

describe('IdleCommit', () => {
  test('a burst commits once, after the last touch; flush commits now; drop forgets', () => {
    const runs: Array<() => void> = [];
    const schedule: Scheduler = (run) => {
      runs.push(run);
      return () => {
        runs.splice(runs.indexOf(run), 1);
      };
    };
    let commits = 0;
    const idle = new IdleCommit(() => (commits += 1), schedule);
    idle.touch();
    idle.touch();
    idle.touch();
    expect(runs).toHaveLength(1);
    runs[0]!();
    expect(commits).toBe(1);
    idle.touch();
    idle.flush();
    expect(commits).toBe(2);
    idle.touch();
    idle.drop();
    expect(runs).toHaveLength(0);
    expect(commits).toBe(2);
  });
});
