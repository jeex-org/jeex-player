/**
 * The camera, navigation, autotour and tour-checkpoint operations:
 * what each one writes, what it refuses, and what `remove` does.
 */

import { describe, expect, test } from 'bun:test';
import { opDraft, rejectsOp } from '../../fixtures/op-drafts.js';
import { applyOp } from '../scene-ops.js';
import { OpError, TOUCHED_AUTOTOUR, TOUCHED_NAVIGATION, TOUCHED_TOUR_CHECKPOINTS, touchedCamera } from './context.js';
import { TOUR_CHECKPOINT_HEIGHT_MARGIN_M, TOUR_CHECKPOINT_HEIGHT_MIN_M, TOUR_CHECKPOINT_NAME_MAX, TOUR_PITCH_LIMIT_RAD } from './limits.js';
import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { L_SHAPE } from '../../fixtures/plan-l-shape-ids.js';
import type { SceneOp } from '../types.js';

const { a: ROOM_A, b: ROOM_B } = L_SHAPE.room;

/** Checkpoint ids these tests create, and a room nobody has, minted offline. */
const NEW = {
  living: '01a12ff3-0a4d-7564-ad39-01408d9a8977',
  high: '01a12ff3-0a4e-70a0-8e78-c1ab94464814',
  blank: '01a12ff3-0a4f-7250-abf3-617a1c90054d',
  ghost: '01a12ff3-0a50-7722-a764-925278bf45c5',
} as const;

/** A well-formed UUID of version 4: the right shape, the wrong version. */
const UUID_V4 = '3b241101-e2bb-4255-8caf-4136c566a962';

const POSE = { position: { x: 1, y: 1.6, z: 2 }, target: { x: 3, y: 1.4, z: 4 } };

describe('set_camera', () => {
  test('sets the presentation camera', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'set_camera', target: 'presentation', pose: POSE }, CATALOGUE_REGISTRIES);
    expect(scene.presentationCamera).toEqual(POSE);
    expect(outcome.touched).toEqual([touchedCamera('presentation')]);
    expect(outcome.summary).toContain('presentation');
  });

  test('sets the walk-mode spawn camera', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'set_camera', target: 'walkSpawn', pose: POSE }, CATALOGUE_REGISTRIES);
    expect(scene.walkSpawn).toEqual(POSE);
    expect(outcome.touched).toEqual([touchedCamera('walkSpawn')]);
  });

  test('sets an existing room camera', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'set_camera', target: { room: ROOM_A }, pose: POSE }, CATALOGUE_REGISTRIES);
    expect(scene.roomCameras[ROOM_A]).toEqual(POSE);
    expect(outcome.touched).toEqual([touchedCamera({ room: ROOM_A })]);
  });

  test('rejects an unknown room, for a set and for a remove', () => {
    expect(rejectsOp(opDraft(), { op: 'set_camera', target: { room: NEW.ghost }, pose: POSE })).toContain(`Unknown room ${NEW.ghost}`);
    expect(rejectsOp(opDraft(), { op: 'set_camera', target: { room: NEW.ghost }, remove: true })).toContain(`Unknown room ${NEW.ghost}`);
  });

  test('remove: true deletes the walk spawn', () => {
    const scene = opDraft();
    expect(scene.walkSpawn).toBeDefined();
    const outcome = applyOp(scene, { op: 'set_camera', target: 'walkSpawn', remove: true }, CATALOGUE_REGISTRIES);
    expect(scene.walkSpawn).toBeUndefined();
    expect(outcome.touched).toEqual([touchedCamera('walkSpawn')]);
  });

  test('remove: true deletes a room camera', () => {
    const scene = opDraft();
    expect(scene.roomCameras[ROOM_B]).toBeDefined();
    const outcome = applyOp(scene, { op: 'set_camera', target: { room: ROOM_B }, remove: true }, CATALOGUE_REGISTRIES);
    expect(scene.roomCameras[ROOM_B]).toBeUndefined();
    expect(outcome.touched).toEqual([touchedCamera({ room: ROOM_B })]);
  });

  test('remove: true on the presentation camera is refused', () => {
    expect(rejectsOp(opDraft(), { op: 'set_camera', target: 'presentation', remove: true })).toContain('presentation camera is required');
  });

  test('rejects non-finite coordinates', () => {
    const bad = { position: { x: Number.NaN, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
    expect(rejectsOp(opDraft(), { op: 'set_camera', target: 'presentation', pose: bad })).toContain('finite coordinates');
  });

  test('rejects a set with neither a pose nor a removal', () => {
    expect(rejectsOp(opDraft(), { op: 'set_camera', target: 'walkSpawn' })).toContain('needs a pose');
  });
});

describe('set_navigation', () => {
  test('replaces the waypoints', () => {
    const scene = opDraft();
    const points = [
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
    ];
    const outcome = applyOp(scene, { op: 'set_navigation', points }, CATALOGUE_REGISTRIES);
    expect(scene.navigation.points).toEqual(points);
    expect(outcome.touched).toEqual([TOUCHED_NAVIGATION]);
    expect(outcome.summary).toBe('Navigation set to 2 points');
  });

  test('rejects an empty list', () => {
    expect(rejectsOp(opDraft(), { op: 'set_navigation', points: [] })).toContain('at least one point');
  });

  test('rejects a non-finite point', () => {
    expect(rejectsOp(opDraft(), { op: 'set_navigation', points: [{ x: Number.NaN, y: 0, z: 0 }] })).toContain('finite coordinates');
  });
});

describe('set_autotour', () => {
  test('replaces the path', () => {
    const scene = opDraft();
    const path = [
      { x: 0, y: 1.6, z: 0 },
      { x: 1, y: 1.6, z: 1 },
      { x: 2, y: 1.6, z: 2 },
    ];
    const outcome = applyOp(scene, { op: 'set_autotour', path }, CATALOGUE_REGISTRIES);
    expect(scene.autotour.path).toEqual(path);
    // Existing gaze referred to an index still inside the new, longer path.
    expect(scene.autotour.gaze).toEqual([{ at: 1, target: { x: 4.15, y: 1.5, z: 0 } }]);
    expect(outcome.touched).toEqual([TOUCHED_AUTOTOUR]);
  });

  test('rejects a path shorter than 2 points', () => {
    expect(rejectsOp(opDraft(), { op: 'set_autotour', path: [{ x: 0, y: 0, z: 0 }] })).toContain('at least 2 points');
  });

  test('rejects an explicit gaze.at outside the effective path', () => {
    expect(rejectsOp(opDraft(), { op: 'set_autotour', gaze: [{ at: 99, target: { x: 0, y: 0, z: 0 } }] })).toContain(
      'gaze.at 99 is outside the path',
    );
  });

  test('rejects an explicit zones.at outside the effective path', () => {
    expect(rejectsOp(opDraft(), { op: 'set_autotour', zones: [{ at: 99, speed: 1 }] })).toContain('zones.at 99 is outside the path');
  });

  test('shrinking the path below an EXISTING zone index is refused, not silently ignored', () => {
    // lShapePlan authors zones: [{ at: 2, speed: 0.9 }]; a path of 2 points
    // (indices 0..1) leaves that reference dangling.
    const shortPath = [
      { x: 0, y: 1.6, z: 0 },
      { x: 1, y: 1.6, z: 1 },
    ];
    expect(rejectsOp(opDraft(), { op: 'set_autotour', path: shortPath })).toBe('set_autotour zones.at 2 is outside the path');
  });

  test('clamps speed to the 0.3..3 m/s range', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_autotour', speed: 99 }, CATALOGUE_REGISTRIES);
    expect(scene.autotour.speed).toBe(3);
    applyOp(scene, { op: 'set_autotour', speed: -1 }, CATALOGUE_REGISTRIES);
    expect(scene.autotour.speed).toBe(0.3);
  });

  test('rejects a request that changes nothing', () => {
    expect(rejectsOp(opDraft(), { op: 'set_autotour' })).toContain('needs at least one field');
  });
});

const CHECKPOINT = { id: NEW.living, position: { x: 2, y: 1.6, z: 3 }, yaw: 0.4, pitch: -0.1 };

describe('set_tour_checkpoints', () => {
  test('replaces the whole ordered list', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'set_tour_checkpoints', checkpoints: [CHECKPOINT] }, CATALOGUE_REGISTRIES);
    expect(scene.tourCheckpoints).toEqual([CHECKPOINT]);
    expect(outcome.touched).toEqual([TOUCHED_TOUR_CHECKPOINTS]);
    expect(outcome.summary).toContain('1 checkpoint');
  });

  test('an empty list clears the field, and the summary says so even with a speed', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_tour_checkpoints', checkpoints: [CHECKPOINT] }, CATALOGUE_REGISTRIES);
    const outcome = applyOp(scene, { op: 'set_tour_checkpoints', checkpoints: [] }, CATALOGUE_REGISTRIES);
    expect(scene.tourCheckpoints).toBeUndefined();
    expect(outcome.summary).toContain('checkpoints cleared');

    const other = opDraft();
    applyOp(other, { op: 'set_tour_checkpoints', checkpoints: [CHECKPOINT] }, CATALOGUE_REGISTRIES);
    const both = applyOp(other, { op: 'set_tour_checkpoints', checkpoints: [], speed: 1 }, CATALOGUE_REGISTRIES);
    expect(other.tourCheckpoints).toBeUndefined();
    expect(both.summary).toContain('checkpoints cleared');
    expect(both.summary).toContain('speed');
    // The speed lives on `autotour`, so the op says it touched that too.
    expect(both.touched).toEqual([TOUCHED_TOUR_CHECKPOINTS, TOUCHED_AUTOTOUR]);
  });

  test('clamps height into the floor..ceiling band and pitch to ±TOUR_PITCH_LIMIT_RAD', () => {
    const scene = opDraft();
    applyOp(
      scene,
      {
        op: 'set_tour_checkpoints',
        checkpoints: [
          { ...CHECKPOINT, position: { x: 2, y: 99, z: 3 }, pitch: 5 },
          { ...CHECKPOINT, id: NEW.high, position: { x: 3, y: -1, z: 4 }, pitch: -5 },
        ],
      },
      CATALOGUE_REGISTRIES,
    );
    expect(scene.tourCheckpoints![0]!.position.y).toBe(3.15 - TOUR_CHECKPOINT_HEIGHT_MARGIN_M);
    expect(scene.tourCheckpoints![0]!.pitch).toBe(TOUR_PITCH_LIMIT_RAD);
    expect(scene.tourCheckpoints![1]!.position.y).toBe(TOUR_CHECKPOINT_HEIGHT_MIN_M);
    expect(scene.tourCheckpoints![1]!.pitch).toBe(-TOUR_PITCH_LIMIT_RAD);
  });

  test('normalises yaw into (-PI, PI]', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_tour_checkpoints', checkpoints: [{ ...CHECKPOINT, yaw: 3 * Math.PI }] }, CATALOGUE_REGISTRIES);
    expect(scene.tourCheckpoints![0]!.yaw).toBeCloseTo(Math.PI, 10);
  });

  test('keeps the autotour speed when the op carries one', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_tour_checkpoints', checkpoints: [CHECKPOINT], speed: 99 }, CATALOGUE_REGISTRIES);
    expect(scene.autotour.speed).toBe(3);
    expect(scene.tourCheckpoints).toHaveLength(1);
  });

  /** The `OpError` a two-checkpoint list whose second id is `id` raises, or a test failure. */
  function idRefusal(id: unknown): OpError {
    const op = { op: 'set_tour_checkpoints', checkpoints: [CHECKPOINT, { ...CHECKPOINT, id }] } as unknown as SceneOp;
    try {
      applyOp(opDraft(), op, CATALOGUE_REGISTRIES);
    } catch (error) {
      if (error instanceof OpError) return error;
      throw error;
    }
    throw new Error('set_tour_checkpoints was expected to refuse an id');
  }

  test('a missing checkpoint id or one that is not a UUID v7 is invalid_id: the viewer mints none', () => {
    const field = 'checkpoints[1].id';
    expect(idRefusal(undefined).detail).toEqual({ reason: 'invalid_id', field, id: null, op: 'set_tour_checkpoints' });
    expect(idRefusal(UUID_V4).detail).toEqual({ reason: 'invalid_id', field, id: UUID_V4, op: 'set_tour_checkpoints' });
  });

  test('an id the list repeats, or another entity already claims, is duplicate_id', () => {
    expect(idRefusal(NEW.living).detail).toEqual({
      reason: 'duplicate_id',
      field: 'checkpoints[1].id',
      id: NEW.living,
      op: 'set_tour_checkpoints',
    });
    // One namespace across every kind: a checkpoint may not take a room's UUID.
    const refused = (() => {
      try {
        applyOp(opDraft(), { op: 'set_tour_checkpoints', checkpoints: [{ ...CHECKPOINT, id: ROOM_A }] }, CATALOGUE_REGISTRIES);
      } catch (error) {
        if (error instanceof OpError) return error;
        throw error;
      }
      throw new Error('set_tour_checkpoints was expected to refuse a room id');
    })();
    expect(refused.detail).toEqual({ reason: 'duplicate_id', field: 'checkpoints[0].id', id: ROOM_A, op: 'set_tour_checkpoints' });
  });

  test('the checkpoints being replaced do not claim the ids of their successors', () => {
    const scene = opDraft();
    applyOp(scene, { op: 'set_tour_checkpoints', checkpoints: [CHECKPOINT] }, CATALOGUE_REGISTRIES);
    applyOp(scene, { op: 'set_tour_checkpoints', checkpoints: [{ ...CHECKPOINT, yaw: 0.2 }] }, CATALOGUE_REGISTRIES);
    expect(scene.tourCheckpoints!.map((checkpoint) => checkpoint.id)).toEqual([NEW.living]);
  });

  test('rejects non-finite poses', () => {
    expect(
      rejectsOp(opDraft(), { op: 'set_tour_checkpoints', checkpoints: [{ ...CHECKPOINT, position: { x: Number.NaN, y: 1.6, z: 1 } }] }),
    ).toContain('finite coordinates');
    expect(rejectsOp(opDraft(), { op: 'set_tour_checkpoints', checkpoints: [{ ...CHECKPOINT, yaw: Number.NaN }] })).toContain(
      'finite look angles',
    );
  });

  test('trims a name, drops a blank one, and refuses one past TOUR_CHECKPOINT_NAME_MAX', () => {
    const scene = opDraft();
    applyOp(
      scene,
      {
        op: 'set_tour_checkpoints',
        checkpoints: [
          { ...CHECKPOINT, name: '  Living room entrance  ' },
          { ...CHECKPOINT, id: NEW.blank, name: '   ' },
        ],
      },
      CATALOGUE_REGISTRIES,
    );
    expect(scene.tourCheckpoints![0]!.name).toBe('Living room entrance');
    expect(scene.tourCheckpoints![1]).not.toHaveProperty('name');
    expect(
      rejectsOp(opDraft(), {
        op: 'set_tour_checkpoints',
        checkpoints: [{ ...CHECKPOINT, name: 'x'.repeat(TOUR_CHECKPOINT_NAME_MAX + 1) }],
      }),
    ).toContain(`longer than ${TOUR_CHECKPOINT_NAME_MAX}`);
    // Exactly at the limit is a name, not an error.
    const edge = opDraft();
    applyOp(
      edge,
      { op: 'set_tour_checkpoints', checkpoints: [{ ...CHECKPOINT, name: 'x'.repeat(TOUR_CHECKPOINT_NAME_MAX) }] },
      CATALOGUE_REGISTRIES,
    );
    expect(edge.tourCheckpoints![0]!.name).toHaveLength(TOUR_CHECKPOINT_NAME_MAX);
  });
});
