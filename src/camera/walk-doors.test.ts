/**
 * The door negotiation, on its own.
 *
 * The two sets are easy to confuse and the difference is the whole feature: a
 * CLOSED door is a wait, a LOCKED one is a refusal. These tests pin which
 * question each answer comes from, and that the refusal is said once rather
 * than sixty times a second.
 */

import { describe, expect, test } from 'bun:test';
import { DoorNegotiator, type DoorCallbacks } from './walk-doors.js';
import { CAMERA_TUNING } from './camera-tuning.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { EYE_HEIGHT_M } from '../navigation/navigation.js';
import type { MessageKey } from '../ui/messages.js';
import * as THREE from 'three';
import { CameraController } from './camera-controller.js';
import { DOOR_ANIMATION_MS, DOOR_AUTO_OPEN_M, DOOR_PASSABLE_T, DoorStates, doorAutomation } from '../doors/door-state.js';
import { EYE_HEIGHT, FRAME, cameraHarness, type CameraHarness } from '../fixtures/camera-harness.js';
import { keysOf } from '../fixtures/stubs.js';

const PLAN = solvePlan(lShapePlan);
/** A door id no scene has. */
const UNKNOWN_DOOR = '01a12ffa-7371-7028-8df4-914a3d25002f';
/** A step straight through `doorAb`, the partition door of the fixture. */
const THROUGH = {
  from: { x: 5.5, y: EYE_HEIGHT_M, z: 2.5 },
  to: { x: 6.5, y: EYE_HEIGHT_M, z: 2.5 },
};

function negotiator(callbacks: Partial<DoorCallbacks> = {}, suspended = false) {
  const hints: MessageKey[] = [];
  const doors = new DoorNegotiator({
    plan: () => PLAN,
    callbacks: {
      onHint: (message) => {
        hints.push(message);
      },
      ...callbacks,
    },
    suspended: () => suspended,
  });
  return { doors, hints };
}

describe('the two sets', () => {
  test('a viewer that tracks no door state is blocked by nothing', () => {
    const { doors } = negotiator();
    expect(doors.closed().size).toBe(0);
    expect(doors.locked().size).toBe(0);
    expect(doors.inTheWay(doors.closed(), THROUGH.from, THROUGH.to)).toEqual([]);
  });

  test('with no lockedDoors of its own, everything closed counts as locked', () => {
    const { doors } = negotiator({ closedDoors: () => new Set([L_SHAPE.opening.doorAb]) });
    expect([...doors.locked()]).toEqual([L_SHAPE.opening.doorAb]);
  });

  test('a door that is closed but not locked is a wait, not a refusal', () => {
    const { doors } = negotiator({
      closedDoors: () => new Set([L_SHAPE.opening.doorAb]),
      lockedDoors: () => new Set<string>(),
    });
    expect(doors.inTheWay(doors.closed(), THROUGH.from, THROUGH.to)).toEqual([L_SHAPE.opening.doorAb]);
    expect(doors.inTheWay(doors.locked(), THROUGH.from, THROUGH.to)).toEqual([]);
  });

  test('only the doors actually crossed are named, one by one', () => {
    const { doors } = negotiator({ closedDoors: () => new Set([L_SHAPE.opening.doorAb, L_SHAPE.opening.doorEntry]) });
    expect(doors.inTheWay(doors.closed(), THROUGH.from, THROUGH.to)).toEqual([L_SHAPE.opening.doorAb]);
  });

  test('a step that crosses nothing asks no further questions', () => {
    const { doors } = negotiator({ closedDoors: () => new Set([L_SHAPE.opening.doorAb]) });
    const along = { x: 5.5, y: EYE_HEIGHT_M, z: 1.5 };
    expect(doors.inTheWay(doors.closed(), THROUGH.from, along)).toEqual([]);
  });
});

describe('insisting on a latch', () => {
  test('a viewer with no automation cannot release anything', () => {
    const { doors } = negotiator({ closedDoors: () => new Set([L_SHAPE.opening.doorAb]) });
    expect(doors.automated).toBe(false);
    expect(doors.rearm([L_SHAPE.opening.doorAb])).toBe(false);
  });

  test('one door coming off the latch is enough for the walk to go on', () => {
    const rearmed: string[] = [];
    const { doors } = negotiator({
      rearmDoor: (id) => {
        rearmed.push(id);
        return id === L_SHAPE.opening.doorAb;
      },
    });
    expect(doors.automated).toBe(true);
    expect(doors.rearm([L_SHAPE.opening.doorEntry, L_SHAPE.opening.doorAb])).toBe(true);
    // Every door named is insisted on, not just up to the first success.
    expect(rearmed).toEqual([L_SHAPE.opening.doorEntry, L_SHAPE.opening.doorAb]);
  });

  test('a door the viewer does not know is not released', () => {
    const { doors } = negotiator({ rearmDoor: () => false });
    expect(doors.rearm([UNKNOWN_DOOR])).toBe(false);
  });
});

describe('saying it is shut', () => {
  test('a held key explains itself once, not sixty times a second', () => {
    const { doors, hints } = negotiator();
    expect(doors.refuse()).toBe(true);
    expect(doors.refuse()).toBe(false);
    expect(hints).toEqual(['hint.doorClosed']);
  });

  test('a deliberate tap always answers, whatever the throttle says', () => {
    const { doors, hints } = negotiator();
    doors.refuse();
    expect(doors.refuse(true)).toBe(true);
    expect(hints).toHaveLength(2);
  });

  test('the throttle is the tuned one, not a frame count', () => {
    expect(CAMERA_TUNING.walk.doorHintThrottleMs).toBeGreaterThan(1000 / 60);
  });

  test('a scripted route walks into closed doors on purpose and says nothing', () => {
    const { doors, hints } = negotiator({}, true);
    expect(doors.refuse(true)).toBe(false);
    expect(hints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Through the CONTROLLER — moved out of `camera-controller.test.ts`.
//
// `walk-doors.ts` decides whether a leaf blocks a step; these two blocks are
// the same rule seen from the walker: a shut door stops the walk and a
// rest-closed one opens as the walker arrives.
// ---------------------------------------------------------------------------

describe('closed doors block the walk', () => {
  /** One walk step long enough to cross the wall, short of the furniture beyond it. */
  const WALK_STEP_S = 0.3;

  /** Standing in room A, half a metre west of `doorAb`, looking east through it. */
  function facingTheDoor(controller: CameraController, camera: THREE.PerspectiveCamera): void {
    camera.position.set(5.5, EYE_HEIGHT, 2.5);
    camera.lookAt(6.5, EYE_HEIGHT, 2.5);
    controller.setMode('walk');
  }

  test('a step through a closed door is rejected and the hint fires', () => {
    const closed = new Set([L_SHAPE.opening.doorAb]);
    const { controller, camera, hints, canvas } = cameraHarness({ closedDoors: () => closed });
    const fire = keysOf(canvas);
    facingTheDoor(controller, camera);
    fire('keydown', { key: 'w', preventDefault: () => undefined });
    controller.update(WALK_STEP_S);
    expect(camera.position.x).toBeCloseTo(5.5, 6);
    expect(hints.at(-1)).toBe('hint.doorClosed');
  });

  test('the same step walks through once the door is open', () => {
    const closed = new Set<string>();
    const { controller, camera, hints, canvas } = cameraHarness({ closedDoors: () => closed });
    const fire = keysOf(canvas);
    facingTheDoor(controller, camera);
    fire('keydown', { key: 'w', preventDefault: () => undefined });
    controller.update(WALK_STEP_S);
    expect(camera.position.x).toBeGreaterThan(6);
    expect(hints).not.toContain('hint.doorClosed');
  });

  test('a walk target beyond a closed door is unreachable, and reachable again after', () => {
    const closed = new Set([L_SHAPE.opening.doorAb]);
    const { controller, camera } = cameraHarness({ closedDoors: () => closed });
    facingTheDoor(controller, camera);
    // Just past the doorway, short of the dining table room B is furnished with.
    expect(controller.isNavigableAt(6.6, 2.5)).toBe(true);
    expect(controller.canWalkTo(6.6, 2.5)).toBe(false);
    closed.clear();
    expect(controller.canWalkTo(6.6, 2.5)).toBe(true);
  });

  test('with no door state at all nothing is blocked', () => {
    const { controller, camera, canvas } = cameraHarness();
    const fire = keysOf(canvas);
    facingTheDoor(controller, camera);
    fire('keydown', { key: 'w', preventDefault: () => undefined });
    controller.update(WALK_STEP_S);
    expect(camera.position.x).toBeGreaterThan(6);
  });
});

describe('a rest-closed door opens as the walker arrives', () => {
  /** `doorAb` of the fixture: the partition door at x = 6, on the line z = 2.5. */
  const DOOR = { id: L_SHAPE.opening.doorAb, center: { x: 6, y: 1.05, z: 2.5 } };
  /** Where the walk starts: four metres west of the leaf, on the same line. */
  const START = { x: 2, z: 2.5 };

  /** One door of the scene, shut and armed, exactly as the automation finds it. */
  function shutDoor(): DoorStates {
    const states = new DoorStates([DOOR.id]);
    states.close(DOOR.id, 0);
    states.release(DOOR.id, 0);
    states.update(DOOR_ANIMATION_MS);
    return states;
  }

  /**
   * A walker in room A, facing east through the door with `w` held down and
   * the furniture out of the way. The keyboard stub has to be in place BEFORE
   * the controller subscribes, so the harness is built here.
   */
  function walkingAtTheDoor(options: Parameters<typeof cameraHarness>[0]): CameraHarness {
    const built = cameraHarness(options);
    const fire = keysOf(built.canvas);
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.camera.lookAt(DOOR.center.x + 1, EYE_HEIGHT, START.z);
    built.controller.setMode('walk');
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.controller.setFurnitureCollision(false);
    fire('keydown', { key: 'w', preventDefault: () => undefined });
    return built;
  }

  test('the walker reaches the far side, and never crosses a leaf still in the way', () => {
    const states = shutDoor();
    const built = walkingAtTheDoor({
      closedDoors: () => states.blockingIds(),
      lockedDoors: () => states.latchedIds(),
    });

    let now = DOOR_ANIMATION_MS;
    let openedAt: number | null = null;
    const forward = new THREE.Vector3();
    for (let frame = 0; frame < 600 && built.camera.position.x < DOOR.center.x + 0.5; frame += 1) {
      built.controller.update(FRAME);
      now += FRAME * 1000;
      // The animator's frame, stubbed: the pose decides, the machine advances.
      built.camera.getWorldDirection(forward);
      const pose = { x: built.camera.position.x, z: built.camera.position.z };
      const { hold, release } = doorAutomation([DOOR], states.list(), pose, { x: forward.x, z: forward.z });
      for (const id of hold) states.hold(id, now);
      for (const id of release) states.release(id, now);
      states.update(now);
      const door = states.get(DOOR.id)!;
      if (openedAt === null && door.phase === 'opening') openedAt = Math.hypot(pose.x - DOOR.center.x, pose.z - DOOR.center.z);
      // The one hard rule: the doorway is wood until the leaf is out of it.
      if (pose.x >= DOOR.center.x - 0.05) expect(door.t).toBeGreaterThanOrEqual(DOOR_PASSABLE_T);
    }

    expect(openedAt).not.toBeNull();
    expect(openedAt!).toBeLessThanOrEqual(DOOR_AUTO_OPEN_M + 0.05);
    expect(built.camera.position.x).toBeGreaterThan(DOOR.center.x + 0.4);
    // Walking up to a door that opens itself is never announced as a refusal.
    expect(built.hints).not.toContain('hint.doorClosed');
  });

  test('a tap beyond it is accepted, and refused once the door is latched shut', () => {
    const states = shutDoor();
    const built = cameraHarness({
      closedDoors: () => states.blockingIds(),
      lockedDoors: () => states.latchedIds(),
    });
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.controller.setMode('walk');
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.controller.setFurnitureCollision(false);
    expect(built.controller.canWalkTo(6.6, 2.5)).toBe(true);

    // Held open by the automation, then shut by hand: latched, and the way is
    // closed again — the walker would only stall at the leaf.
    states.hold(DOOR.id, DOOR_ANIMATION_MS);
    states.update(2 * DOOR_ANIMATION_MS);
    states.toggle(DOOR.id, 2 * DOOR_ANIMATION_MS);
    expect(states.get(DOOR.id)).toMatchObject({ phase: 'closing', armed: false });
    expect(built.controller.canWalkTo(6.6, 2.5)).toBe(false);
  });

  test('with the automation off the same walk is refused with the hint', () => {
    const states = shutDoor();
    // `doors.autoOpen: false` is wired as the pre-automation pair of sets.
    const built = walkingAtTheDoor({
      closedDoors: () => states.closedIds(),
      lockedDoors: () => states.closedIds(),
    });

    for (let frame = 0; frame < 600 && built.camera.position.x < DOOR.center.x + 0.5; frame += 1) {
      built.controller.update(FRAME);
    }
    expect(built.camera.position.x).toBeLessThan(DOOR.center.x);
    expect(built.hints).toContain('hint.doorClosed');
    expect(built.controller.canWalkTo(6.6, 2.5)).toBe(false);
  });
});
