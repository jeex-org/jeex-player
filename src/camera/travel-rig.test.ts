/**
 * The scripted route, in the two parts that can be tested without a camera:
 * how a route is merged into waypoints, and how the speed eases at its ends.
 *
 * Everything the rig does WITH those — the curve, the door waits, the gaze —
 * is driven end to end through the controller in `camera-controller.test.ts`,
 * because it only means anything against a real plan.
 */

import { describe, expect, test } from 'bun:test';
import { mergeTravelRoute, travelEase } from './travel-rig.js';
import { CAMERA_TUNING } from './camera-tuning.js';
import * as THREE from 'three';
import { CameraController } from './camera-controller.js';
import { DOOR_ANIMATION_MS, DOOR_AUTO_CLOSE_M, DOOR_PASSABLE_T, DoorStates, doorAutomation, doorsToAutoOpen } from '../doors/door-state.js';
import { tangentAt } from '../navigation/travel-path.js';
import { EYE_HEIGHT, FRAME, TRAVEL_SPEED, cameraHarness, type CameraHarness } from '../fixtures/camera-harness.js';
import { fakeCanvas, keysOf } from '../fixtures/stubs.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';

describe('mergeTravelRoute: the merge never drops a door tag', () => {
  const CAMERA = { x: 5.5, z: 2.5 };

  test('a standoff point inside the merge radius of the camera survives, tag and all', () => {
    // Exactly the case the router hands over when the walker taps while
    // standing in the doorway's own approach: the near standoff is 0.05 m
    // away, well inside `travel.mergeM`. Dropped, the tagged PAIR is gone and
    // `travel-path.ts` has no doorway leg to keep straight any more.
    const route = mergeTravelRoute(CAMERA, [
      { x: 5.55, y: 0, z: 2.5, door: L_SHAPE.opening.doorAb },
      { x: 6.45, y: 0, z: 2.5, door: L_SHAPE.opening.doorAb },
      { x: 7.95, y: 0, z: 3.195 },
    ]);
    expect(route[0]).toEqual(CAMERA);
    expect(route.filter((point) => point.door === L_SHAPE.opening.doorAb)).toHaveLength(2);
    expect(route).toHaveLength(4);
  });

  test('an untagged waypoint inside the radius of a tagged one is the one that goes', () => {
    const route = mergeTravelRoute(CAMERA, [
      { x: 6.45, y: 0, z: 2.5, door: L_SHAPE.opening.doorAb },
      { x: 6.5, y: 0, z: 2.5 },
      { x: 7.95, y: 0, z: 3.195 },
    ]);
    expect(route.map((point) => point.door ?? null)).toEqual([null, L_SHAPE.opening.doorAb, null]);
    expect(route[1]!.x).toBeCloseTo(6.45, 6);
  });

  test('a tagged waypoint inside the radius of an untagged one takes its place', () => {
    // The mirror of `travel-path.merged`: of a merged pair the tagged side is
    // the survivor, wherever it sits in the pair.
    const route = mergeTravelRoute(CAMERA, [
      { x: 6.4, y: 0, z: 2.5 },
      { x: 6.45, y: 0, z: 2.5, door: L_SHAPE.opening.doorAb },
      { x: 7.95, y: 0, z: 3.195 },
    ]);
    expect(route.map((point) => point.door ?? null)).toEqual([null, L_SHAPE.opening.doorAb, null]);
    expect(route[1]!.x).toBeCloseTo(6.45, 6);
  });

  test('untagged waypoints still merge as they always did', () => {
    const route = mergeTravelRoute(CAMERA, [
      { x: 5.55, y: 0, z: 2.5 },
      { x: 7.95, y: 0, z: 3.195 },
    ]);
    expect(route).toHaveLength(2);
    expect(route[1]!.x).toBeCloseTo(7.95, 6);
  });
});

describe('travelEase: one steady walk with a lean at each end', () => {
  const { travel } = CAMERA_TUNING;

  test('full speed through the middle of a long path', () => {
    expect(travelEase(5, 10)).toBeCloseTo(1, 6);
  });

  test('never zero, or the eased end would take forever', () => {
    expect(travelEase(0, 10)).toBeCloseTo(travel.easeFloor, 6);
    expect(travelEase(10, 10)).toBeCloseTo(travel.easeFloor, 6);
    expect(travelEase(0.0001, 10)).toBeGreaterThan(0);
  });

  test('the two ends are mirror images', () => {
    for (const s of [0.1, 0.3, 0.5]) {
      expect(travelEase(s, 10)).toBeCloseTo(travelEase(10 - s, 10), 6);
    }
  });

  test('a short path eases over a share of itself, so the middle is still full speed', () => {
    // A 1 m hop cannot spend `travel.easeM` at each end and have anything left.
    expect(travelEase(0.5, 1)).toBeCloseTo(1, 6);
    expect(travelEase(0, 1)).toBeCloseTo(travel.easeFloor, 6);
  });

  test('a path with no length at all is not eased, it is over', () => {
    expect(travelEase(0, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Through the CONTROLLER — moved out of `camera-controller.test.ts`.
//
// A scripted route is the travel rig's whole subject: `walkAlong`, the latch a
// closed door puts on it, the escape an intentional key press is, and the two
// ways a route ends.
// ---------------------------------------------------------------------------

describe('walkAlong: the scripted route of a mini-map click', () => {
  /** Two clear legs inside room A of the fixture, well away from the sofa. */
  const LEGS = [
    { x: 4.5, y: 0, z: 2 },
    { x: 4.5, y: 0, z: 4.4 },
  ];

  function fireCanvas(canvas: ReturnType<typeof fakeCanvas>, type: string, event: unknown): void {
    for (const handler of canvas.listeners.get(type) ?? []) handler(event);
  }

  function walking(): CameraHarness {
    const built = cameraHarness();
    built.controller.setMode('walk');
    built.camera.position.set(1.5, EYE_HEIGHT, 2);
    return built;
  }

  /** Runs frames until the route ends; answers how many it took. */
  function settle(controller: CameraController, frames = 1800): number {
    for (let i = 0; i < frames; i += 1) {
      controller.update(FRAME);
      if (!controller.isTravelling()) return i;
    }
    return frames;
  }

  test('a two-leg route is walked to its end', () => {
    const { controller, camera } = walking();
    expect(controller.walkAlong(LEGS)).toBe(true);
    expect(controller.isTravelling()).toBe(true);
    expect(settle(controller)).toBeLessThan(1800);
    expect(camera.position.distanceTo(new THREE.Vector3(LEGS[1]!.x, EYE_HEIGHT, LEGS[1]!.z))).toBeLessThan(0.3);
  });

  /** Every camera position of one travel, first frame to last. */
  function trace(harnessed: CameraHarness, route: Array<{ x: number; y: number; z: number }>): THREE.Vector3[] {
    const points: THREE.Vector3[] = [harnessed.camera.position.clone()];
    harnessed.controller.walkAlong(route);
    for (let i = 0; i < 1800 && harnessed.controller.isTravelling(); i += 1) {
      harnessed.controller.update(FRAME);
      points.push(harnessed.camera.position.clone());
    }
    return points;
  }

  test('a waypoint a straight line can replace is cut, not visited', () => {
    // Both legs are clear of the sofa, so is the diagonal: the curve takes it
    // rather than turning twice (`travel-path.ts` string pull).
    const { controller, camera } = walking();
    const corner = new THREE.Vector3(LEGS[0]!.x, EYE_HEIGHT, LEGS[0]!.z);
    controller.walkAlong(LEGS);
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 1800 && controller.isTravelling(); i += 1) {
      controller.update(FRAME);
      closest = Math.min(closest, camera.position.distanceTo(corner));
    }
    expect(closest).toBeGreaterThan(1);
  });

  test('a waypoint nothing can replace is rounded, not skipped', () => {
    // The sofa stands on the diagonal, so the corner has to be taken; the
    // curve still passes within a turn radius of it.
    const built = cameraHarness();
    built.controller.setMode('walk');
    built.camera.position.set(1.5, EYE_HEIGHT, 7);
    const corner = new THREE.Vector3(4.5, EYE_HEIGHT, 7);
    const points = trace(built, [
      { x: 4.5, y: 0, z: 7 },
      { x: 4.5, y: 0, z: 3 },
    ]);
    let closest = Number.POSITIVE_INFINITY;
    for (const point of points) closest = Math.min(closest, point.distanceTo(corner));
    expect(closest).toBeLessThan(0.9);
    expect(points.at(-1)!.distanceTo(new THREE.Vector3(4.5, EYE_HEIGHT, 3))).toBeLessThan(0.05);
  });

  test('the step is the same all the way down a straight route', () => {
    const built = cameraHarness();
    built.controller.setMode('walk');
    built.camera.position.set(4.5, EYE_HEIGHT, 1);
    const points = trace(built, [{ x: 4.5, y: 0, z: 7 }]);
    const steady = TRAVEL_SPEED * FRAME;

    let travelled = 0;
    const middle: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      const step = points[i]!.distanceTo(points[i - 1]!);
      travelled += step;
      if (travelled > 1 && travelled < 5) middle.push(step);
    }
    expect(middle.length).toBeGreaterThan(100);
    for (const step of middle) expect(Math.abs(step / steady - 1)).toBeLessThan(0.02);

    // Both ends ease: the first and last frames cover less ground than the middle.
    expect(points[1]!.distanceTo(points[0]!)).toBeLessThan(steady * 0.9);
    expect(points.at(-1)!.distanceTo(points.at(-2)!)).toBeLessThan(steady * 0.9);
  });

  test('an L-shaped route never stops at the corner', () => {
    const built = cameraHarness();
    built.controller.setMode('walk');
    built.camera.position.set(1.5, EYE_HEIGHT, 7);
    let done = 0;
    const points: THREE.Vector3[] = [built.camera.position.clone()];
    built.controller.walkAlong(
      [
        { x: 4.5, y: 0, z: 7 },
        { x: 4.5, y: 0, z: 3 },
      ],
      () => {
        done += 1;
      },
    );
    for (let i = 0; i < 1800 && built.controller.isTravelling(); i += 1) {
      built.controller.update(FRAME);
      points.push(built.camera.position.clone());
    }
    // Every frame but the last moves; the last one lands exactly on the goal.
    for (let i = 1; i + 1 < points.length; i += 1) {
      expect(points[i]!.distanceTo(points[i - 1]!)).toBeGreaterThan(TRAVEL_SPEED * FRAME * 0.1);
    }
    expect(done).toBe(1);
  });

  test('the walk is continuous and stays at eye height', () => {
    const { controller, camera } = walking();
    controller.walkAlong(LEGS);
    let previous = camera.position.clone();
    let longest = 0;
    for (let i = 0; i < 1800 && controller.isTravelling(); i += 1) {
      controller.update(FRAME);
      expect(camera.position.y).toBeCloseTo(EYE_HEIGHT, 6);
      longest = Math.max(longest, camera.position.distanceTo(previous));
      previous = camera.position.clone();
    }
    // At the run rate a 60 Hz step is a few centimetres; a teleport is metres.
    expect(longest).toBeLessThan(0.25);
  });

  test('the gaze turns onto the direction of travel', () => {
    const { controller, camera } = cameraHarness();
    // Facing due north (-z) when the route starts; the leg runs east (+x).
    camera.position.set(1.5, EYE_HEIGHT, 2);
    camera.lookAt(1.5, EYE_HEIGHT, -4);
    controller.setMode('walk');
    camera.position.set(1.5, EYE_HEIGHT, 2);
    controller.walkAlong([LEGS[0]!]);
    for (let i = 0; i < 120; i += 1) controller.update(FRAME);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    expect(forward.x).toBeGreaterThan(0.7);
    expect(Math.abs(forward.y)).toBeLessThan(0.1);
  });

  test('onDone fires once, when the route ends', () => {
    const { controller } = walking();
    let done = 0;
    controller.walkAlong(LEGS, () => {
      done += 1;
    });
    settle(controller);
    expect(done).toBe(1);
    for (let i = 0; i < 60; i += 1) controller.update(FRAME);
    expect(done).toBe(1);
  });

  test('a press on the scene cancels the route and hands the camera back', () => {
    const { controller, camera, canvas } = walking();
    let done = 0;
    controller.walkAlong(LEGS, () => {
      done += 1;
    });
    for (let i = 0; i < 20; i += 1) controller.update(FRAME);
    expect(controller.isTravelling()).toBe(true);

    fireCanvas(canvas, 'pointerdown', { pointerId: 7, clientX: 400, clientY: 300, button: 0 });
    expect(controller.isTravelling()).toBe(false);
    expect(done).toBe(1);

    const stopped = camera.position.clone();
    for (let i = 0; i < 60; i += 1) controller.update(FRAME);
    expect(camera.position.distanceTo(stopped)).toBeLessThan(1e-6);
  });

  test('a WASD key cancels the route', () => {
    const { controller, canvas } = walking();
    controller.walkAlong(LEGS);
    for (let i = 0; i < 20; i += 1) controller.update(FRAME);
    keysOf(canvas)('keydown', { key: 'w', preventDefault: () => undefined });
    expect(controller.isTravelling()).toBe(false);
  });

  test('outside walk mode there is nothing to walk along', () => {
    const { controller } = cameraHarness();
    let done = 0;
    expect(
      controller.walkAlong(LEGS, () => {
        done += 1;
      }),
    ).toBe(false);
    expect(controller.isTravelling()).toBe(false);
    expect(done).toBe(0);
  });

  test('a mode switch ends the route', () => {
    const { controller } = walking();
    let done = 0;
    controller.walkAlong(LEGS, () => {
      done += 1;
    });
    controller.update(FRAME);
    controller.setMode('orbit');
    expect(controller.isTravelling()).toBe(false);
    expect(done).toBe(1);
  });

  test('a closed door on the way is open before the camera reaches it', () => {
    // The partition door of the fixture, shut, with the travel aimed through
    // it. `DoorAnimator` does exactly this every frame while `isTravelling()`.
    const doors = [
      { id: L_SHAPE.opening.doorAb, center: { x: 6, y: 1.05, z: 2.5 } },
      { id: L_SHAPE.opening.doorEntry, center: { x: 1.25, y: 1.05, z: 0 } },
    ];
    const states = new DoorStates(doors.map((door) => door.id));
    let now = 0;
    for (const door of doors) states.close(door.id, now);
    now += DOOR_ANIMATION_MS;
    states.update(now);
    expect(states.get(L_SHAPE.opening.doorAb)!.phase).toBe('closed');

    const built = cameraHarness({ closedDoors: () => states.closedIds() });
    built.camera.position.set(4.5, EYE_HEIGHT, 2.5);
    built.camera.lookAt(6, EYE_HEIGHT, 2.5);
    built.controller.setMode('walk');
    built.camera.position.set(4.5, EYE_HEIGHT, 2.5);

    let phaseAtOneMetre: string | null = null;
    built.controller.walkAlong([
      { x: 5.5, y: 0, z: 2.5, door: L_SHAPE.opening.doorAb },
      { x: 6.5, y: 0, z: 2.5, door: L_SHAPE.opening.doorAb },
      { x: 6.8, y: 0, z: 4.2 },
    ]);
    expect(built.controller.isTravelling()).toBe(true);
    const forward = new THREE.Vector3();
    for (let i = 0; i < 1800 && built.controller.isTravelling(); i += 1) {
      built.controller.update(FRAME);
      now += FRAME * 1000;
      built.camera.getWorldDirection(forward);
      const at = { x: built.camera.position.x, z: built.camera.position.z };
      for (const id of doorsToAutoOpen(doors, at, { x: forward.x, z: forward.z }, states.closedIds())) states.open(id, now);
      states.update(now);
      if (phaseAtOneMetre === null && Math.hypot(at.x - 6, at.z - 2.5) <= 1) {
        phaseAtOneMetre = states.get(L_SHAPE.opening.doorAb)!.phase;
      }
    }
    expect(phaseAtOneMetre).not.toBeNull();
    expect(['opening', 'open']).toContain(phaseAtOneMetre!);
    // Nothing else opens itself: the entrance is nowhere near the route.
    expect(states.get(L_SHAPE.opening.doorEntry)!.phase).toBe('closed');
    // And the travel went through instead of stalling in front of the leaf.
    expect(built.camera.position.x).toBeGreaterThan(6.5);
  });

  test('a route with nothing to walk answers false and reports itself done', () => {
    const { controller, camera } = walking();
    let done = 0;
    expect(
      controller.walkAlong([{ x: camera.position.x, y: 0, z: camera.position.z }], () => {
        done += 1;
      }),
    ).toBe(false);
    expect(done).toBe(1);
  });
});

describe('a latch is escapable by intent', () => {
  /** `doorAb` of the fixture: the partition door at x = 6, on the line z = 2.5. */
  const DOOR = { id: L_SHAPE.opening.doorAb, center: { x: 6, y: 1.05, z: 2.5 } };
  /** Half a metre west of the leaf: inside the close radius, and staying there. */
  const START = { x: 5.5, z: 2.5 };

  /** A door shut BY HAND right in the walker's face: latched, and never released. */
  function latchedDoor(): DoorStates {
    const states = new DoorStates([DOOR.id]);
    states.close(DOOR.id, 0);
    states.update(DOOR_ANIMATION_MS);
    expect([...states.latchedIds()]).toEqual([DOOR.id]);
    return states;
  }

  /** The viewer as `viewer-api` wires it with `doors.autoOpen` on. */
  function wiring(states: DoorStates): Parameters<typeof cameraHarness>[0] {
    return {
      closedDoors: () => states.blockingIds(),
      lockedDoors: () => states.latchedIds(),
      rearmDoor: (openingId) => states.rearm(openingId),
    };
  }

  /** One frame of `DoorAnimator`, stubbed: the pose decides, the machine advances. */
  function animate(built: CameraHarness, states: DoorStates, now: number): void {
    const forward = new THREE.Vector3();
    built.camera.getWorldDirection(forward);
    const pose = { x: built.camera.position.x, z: built.camera.position.z };
    const { hold, release } = doorAutomation([DOOR], states.list(), pose, { x: forward.x, z: forward.z });
    for (const id of hold) states.hold(id, now);
    for (const id of release) states.release(id, now);
    states.update(now);
  }

  test('pushing at the leaf takes the latch off, without ever leaving the close radius', () => {
    // The small-room case: the release radius (2.6 m) is a pose
    // the room may not contain, so the walker would be shut in for good.
    const states = latchedDoor();
    const built = cameraHarness(wiring(states));
    const fire = keysOf(built.canvas);
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.camera.lookAt(DOOR.center.x + 1, EYE_HEIGHT, START.z);
    built.controller.setMode('walk');
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.controller.setFurnitureCollision(false);
    fire('keydown', { key: 'w', preventDefault: () => undefined });

    let now = DOOR_ANIMATION_MS;
    let furthest = 0;
    for (let frame = 0; frame < 400 && built.camera.position.x < DOOR.center.x + 0.4; frame += 1) {
      built.controller.update(FRAME);
      now += FRAME * 1000;
      animate(built, states, now);
      furthest = Math.max(furthest, Math.hypot(built.camera.position.x - DOOR.center.x, built.camera.position.z - DOOR.center.z));
    }
    expect(built.camera.position.x).toBeGreaterThan(DOOR.center.x + 0.4);
    expect(furthest).toBeLessThan(DOOR_AUTO_CLOSE_M);
    // A latch the walker pushed their way out of was never a refusal.
    expect(built.hints).not.toContain('hint.doorClosed');
  });

  test('with the automation off the same push is refused, as a wall should be', () => {
    const states = latchedDoor();
    const built = cameraHarness({
      closedDoors: () => states.closedIds(),
      lockedDoors: () => states.closedIds(),
      // `doors.autoOpen: false`: there is no latch to release.
      rearmDoor: () => false,
    });
    const fire = keysOf(built.canvas);
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.camera.lookAt(DOOR.center.x + 1, EYE_HEIGHT, START.z);
    built.controller.setMode('walk');
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.controller.setFurnitureCollision(false);
    fire('keydown', { key: 'w', preventDefault: () => undefined });

    for (let frame = 0; frame < 200; frame += 1) built.controller.update(FRAME);
    expect(built.camera.position.x).toBeLessThan(DOOR.center.x);
    expect(states.get(DOOR.id)!.armed).toBe(false);
    expect(built.hints).toContain('hint.doorClosed');
  });

  test('a tap through a latched door takes the latch off and is accepted', () => {
    const states = latchedDoor();
    const built = cameraHarness(wiring(states));
    // A floor to tap on: the harness picker is empty, and only a mesh marked
    // navigable answers `Picker.floorPoint`.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.userData['navigable'] = true;
    floor.updateMatrixWorld(true);
    built.picker.register(floor);

    // Looking DOWN at the floor a metre beyond the leaf, so the middle of the
    // canvas is the point being tapped.
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.camera.lookAt(DOOR.center.x + 1, 0, START.z);
    built.controller.setMode('walk');
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.camera.updateMatrixWorld(true);
    built.controller.setFurnitureCollision(false);

    // The pure query still answers honestly: as things stand the way is shut.
    expect(built.controller.canWalkTo(DOOR.center.x + 1, START.z)).toBe(false);

    for (const handler of built.canvas.listeners.get('click') ?? []) {
      handler({ clientX: 400, clientY: 300 });
    }
    expect(states.get(DOOR.id)!.armed).toBe(true);
    expect(built.hints).not.toContain('hint.doorClosed');

    // And the tap is a real destination: the walker sets off, the automation
    // opens the door it re-armed, and the way is clear again.
    let now = DOOR_ANIMATION_MS;
    for (let frame = 0; frame < 400 && built.camera.position.x < DOOR.center.x + 0.4; frame += 1) {
      built.controller.update(FRAME);
      now += FRAME * 1000;
      animate(built, states, now);
    }
    expect(built.camera.position.x).toBeGreaterThan(DOOR.center.x + 0.4);
  });

  test('a travel held at a latched door re-arms it by waiting, and completes', () => {
    // The whole latched-door story end to end: the user shuts a door on a running
    // route, the walker waits at the leaf, the wait itself takes the latch off
    // and the automation opens the door — no hint, no cancelled route.
    const states = new DoorStates([DOOR.id]);
    const built = cameraHarness(wiring(states));
    built.camera.position.set(4.5, EYE_HEIGHT, 2.5);
    built.camera.lookAt(DOOR.center.x, EYE_HEIGHT, 2.5);
    built.controller.setMode('walk');
    built.camera.position.set(4.5, EYE_HEIGHT, 2.5);
    built.controller.setFurnitureCollision(false);
    let done = 0;
    expect(
      built.controller.walkAlong(
        [
          { x: 5.5, y: 0, z: 2.5, door: DOOR.id },
          { x: 6.5, y: 0, z: 2.5, door: DOOR.id },
          { x: 6.8, y: 0, z: 4.2 },
        ],
        () => {
          done += 1;
        },
      ),
    ).toBe(true);

    let now = 0;
    let waited = 0;
    let previous = built.camera.position.clone();
    for (let frame = 0; frame < 600 && built.controller.isTravelling(); frame += 1) {
      // Shut by hand a quarter of the way there, from inside the close radius:
      // the automation cannot hand this latch back on distance alone.
      if (frame === 20) states.close(DOOR.id, now);
      built.controller.update(FRAME);
      now += FRAME * 1000;
      animate(built, states, now);
      if (built.camera.position.distanceTo(previous) < 1e-9 && frame > 20) waited += 1;
      previous = built.camera.position.clone();
    }
    expect(waited).toBeGreaterThan(10);
    expect(built.camera.position.x).toBeGreaterThan(DOOR.center.x + 0.4);
    expect(done).toBe(1);
    expect(built.hints).not.toContain('hint.doorClosed');
  });

  test('with the automation off the same tap is refused with the hint', () => {
    const states = latchedDoor();
    const built = cameraHarness({
      closedDoors: () => states.closedIds(),
      lockedDoors: () => states.closedIds(),
      rearmDoor: () => false,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.userData['navigable'] = true;
    floor.updateMatrixWorld(true);
    built.picker.register(floor);
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.camera.lookAt(DOOR.center.x + 1, 0, START.z);
    built.controller.setMode('walk');
    built.camera.position.set(START.x, EYE_HEIGHT, START.z);
    built.camera.updateMatrixWorld(true);
    built.controller.setFurnitureCollision(false);

    for (const handler of built.canvas.listeners.get('click') ?? []) {
      handler({ clientX: 400, clientY: 300 });
    }
    expect(states.get(DOOR.id)!.armed).toBe(false);
    expect(built.hints).toContain('hint.doorClosed');
    for (let frame = 0; frame < 120; frame += 1) built.controller.update(FRAME);
    expect(built.camera.position.x).toBeLessThan(DOOR.center.x);
  });
});

describe('a door latched shut mid-travel holds the walker', () => {
  /** `doorAb` of the fixture: the partition door at x = 6, on the line z = 2.5. */
  const DOOR = { id: L_SHAPE.opening.doorAb, center: { x: 6, z: 2.5 } };
  /** Through the doorway and on into room B, the way `room-graph` tags it. */
  const ROUTE = [
    { x: 5.5, y: 0, z: 2.5, door: DOOR.id },
    { x: 6.5, y: 0, z: 2.5, door: DOOR.id },
    { x: 6.8, y: 0, z: 4.2 },
  ];

  /** A walker in room A, on the door's line, with a route through it running. */
  function travelling(options: Parameters<typeof cameraHarness>[0]): CameraHarness & { done: () => number } {
    const built = cameraHarness(options);
    built.camera.position.set(4.5, EYE_HEIGHT, 2.5);
    built.camera.lookAt(6, EYE_HEIGHT, 2.5);
    built.controller.setMode('walk');
    built.camera.position.set(4.5, EYE_HEIGHT, 2.5);
    built.controller.setFurnitureCollision(false);
    let done = 0;
    expect(
      built.controller.walkAlong(ROUTE, () => {
        done += 1;
      }),
    ).toBe(true);
    return { ...built, done: () => done };
  }

  /**
   * Runs the travel, shutting the door through the HUD at `closeAtFrame`, and
   * reports what the walker did about it. The door machine is advanced every
   * frame exactly as `DoorAnimator` advances it.
   */
  function run(built: CameraHarness, states: DoorStates, closeAtFrame: number, frames: number): { crossedShut: boolean; furthest: number } {
    let now = 0;
    let crossedShut = false;
    let furthest = built.camera.position.x;
    for (let frame = 0; frame < frames; frame += 1) {
      if (frame === closeAtFrame) states.close(DOOR.id, now);
      built.controller.update(FRAME);
      now += FRAME * 1000;
      states.update(now);
      furthest = Math.max(furthest, built.camera.position.x);
      // The one hard rule: the doorway is wood until the leaf is out of it.
      if (built.camera.position.x > DOOR.center.x && states.get(DOOR.id)!.t < DOOR_PASSABLE_T) crossedShut = true;
    }
    return { crossedShut, furthest };
  }

  test('with the automation on, the walker waits at the leaf instead of walking through it', () => {
    const states = new DoorStates([DOOR.id]);
    const built = travelling({
      closedDoors: () => states.blockingIds(),
      lockedDoors: () => states.latchedIds(),
    });
    // 15 frames in the camera is about a quarter of the way there, well short
    // of the leaf: the shove happens under a running route, as a HUD click on
    // a door the camera is walking towards does.
    const { crossedShut, furthest } = run(built, states, 15, 180);
    expect(crossedShut).toBe(false);
    expect(furthest).toBeLessThan(DOOR.center.x);
    expect(states.get(DOOR.id)!.armed).toBe(false);
  });

  test('nothing opens it, so the route ends with the hint after the wait', () => {
    const states = new DoorStates([DOOR.id]);
    const built = travelling({
      closedDoors: () => states.blockingIds(),
      lockedDoors: () => states.latchedIds(),
    });
    // 2 s of waiting at 60 Hz, plus the walk up to the leaf and the swing.
    run(built, states, 15, 260);
    expect(built.controller.isTravelling()).toBe(false);
    expect(built.done()).toBe(1);
    expect(built.hints.at(-1)).toBe('hint.doorClosed');
  });

  test('with the automation off the scripted fallback holds it too', () => {
    // `doors.autoOpen: false` is wired as the pre-automation pair of sets, and
    // `door-animator.autoOpen` does not reopen what the user just latched.
    const states = new DoorStates([DOOR.id]);
    const built = travelling({
      closedDoors: () => states.closedIds(),
      lockedDoors: () => states.closedIds(),
    });
    const { crossedShut, furthest } = run(built, states, 15, 260);
    expect(crossedShut).toBe(false);
    expect(furthest).toBeLessThan(DOOR.center.x);
    expect(built.controller.isTravelling()).toBe(false);
    expect(built.done()).toBe(1);
    expect(built.hints.at(-1)).toBe('hint.doorClosed');
  });

  test('a door that opens again lets the travel finish, and it only ended once', () => {
    const states = new DoorStates([DOOR.id]);
    const built = travelling({
      closedDoors: () => states.blockingIds(),
      lockedDoors: () => states.latchedIds(),
    });
    let now = 0;
    for (let frame = 0; frame < 400 && built.controller.isTravelling(); frame += 1) {
      if (frame === 15) states.close(DOOR.id, now);
      // Half a second of waiting and the user opens it again by hand.
      if (frame === 90) states.open(DOOR.id, now);
      built.controller.update(FRAME);
      now += FRAME * 1000;
      states.update(now);
    }
    expect(built.controller.isTravelling()).toBe(false);
    expect(built.done()).toBe(1);
    expect(built.camera.position.x).toBeGreaterThan(DOOR.center.x);
    expect(built.hints).not.toContain('hint.doorClosed');
  });
});

describe('finishTravel: a second click on the same room jumps there', () => {
  /** Two clear legs inside room A of the fixture, well away from the sofa. */
  const LEGS = [
    { x: 4.5, y: 0, z: 2 },
    { x: 4.5, y: 0, z: 4.4 },
  ];

  function walking(): CameraHarness {
    const built = cameraHarness();
    built.controller.setMode('walk');
    built.camera.position.set(1.5, EYE_HEIGHT, 2);
    return built;
  }

  test('jumps to the end of the path, ends the route, fires onDone once', () => {
    const { controller, camera } = walking();
    const goal = new THREE.Vector3(LEGS[1]!.x, EYE_HEIGHT, LEGS[1]!.z);
    let done = 0;
    controller.walkAlong(LEGS, () => {
      done += 1;
    });
    for (let i = 0; i < 10; i += 1) controller.update(FRAME);
    expect(controller.isTravelling()).toBe(true);
    // Ten frames of a 1.8 m/s walk have not reached a goal a few metres away.
    expect(camera.position.distanceTo(goal)).toBeGreaterThan(0.05);

    expect(controller.finishTravel()).toBe(true);
    expect(camera.position.distanceTo(goal)).toBeLessThan(0.001);
    expect(controller.isTravelling()).toBe(false);
    expect(done).toBe(1);

    // A second call has nothing left to finish.
    expect(controller.finishTravel()).toBe(false);
    expect(done).toBe(1);
  });

  test('the yaw ends on the final tangent heading, pitch level', () => {
    const { controller, camera } = walking();
    // The path is a pure query: read the same curve `walkAlong` will build,
    // from the same starting pose, to know the heading `finishTravel` owes.
    const path = controller.travelPathFor(LEGS)!;
    const tangent = tangentAt(path, path.length);
    const expectedYaw = Math.atan2(tangent.x, tangent.z);

    controller.walkAlong(LEGS);
    controller.update(FRAME);
    controller.finishTravel();

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    expect(Math.atan2(forward.x, forward.z)).toBeCloseTo(expectedYaw, 3);
    expect(Math.abs(forward.y)).toBeLessThan(1e-6);
  });

  test('nothing to finish outside a travel', () => {
    const { controller } = walking();
    expect(controller.finishTravel()).toBe(false);
  });

  test('outside walk mode there is still nothing to finish', () => {
    const { controller } = cameraHarness();
    expect(controller.finishTravel()).toBe(false);
  });
});

describe('flyTo ends an active route', () => {
  /** Two clear legs inside room A of the fixture, well away from the sofa. */
  const LEGS = [
    { x: 4.5, y: 0, z: 2 },
    { x: 4.5, y: 0, z: 4.4 },
  ];

  function walking(): CameraHarness {
    const built = cameraHarness();
    built.controller.setMode('walk');
    built.camera.position.set(1.5, EYE_HEIGHT, 2);
    return built;
  }

  test('a scripted walk is cancelled, onDone fires exactly once', () => {
    const { controller } = walking();
    let done = 0;
    controller.walkAlong(LEGS, () => {
      done += 1;
    });
    controller.update(FRAME);
    expect(controller.isTravelling()).toBe(true);

    controller.flyTo(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 0, 0));
    expect(controller.isTravelling()).toBe(false);
    expect(done).toBe(1);

    // A route that had already ended is untouched: no second onDone.
    controller.flyTo(new THREE.Vector3(1, 5, 1), new THREE.Vector3(0, 0, 0));
    expect(done).toBe(1);
  });

  test('flyToRoom (the fallback fly-in) cancels a route the same way', () => {
    const { controller } = walking();
    let done = 0;
    controller.walkAlong(LEGS, () => {
      done += 1;
    });
    controller.update(FRAME);
    expect(controller.isTravelling()).toBe(true);

    expect(controller.flyToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.isTravelling()).toBe(false);
    expect(done).toBe(1);
  });

  test('walking again afterwards works: the route state was left clean', () => {
    const { controller } = walking();
    let done = 0;
    controller.walkAlong(LEGS, () => {
      done += 1;
    });
    controller.update(FRAME);
    controller.flyTo(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 0, 0));

    controller.setMode('walk');
    expect(
      controller.walkAlong(LEGS, () => {
        done += 1;
      }),
    ).toBe(true);
    expect(controller.isTravelling()).toBe(true);
  });
});

describe('reduced motion: scripted travel is instant', () => {
  /** Two clear legs inside room A of the fixture, well away from the sofa. */
  const LEGS = [
    { x: 4.5, y: 0, z: 2 },
    { x: 4.5, y: 0, z: 4.4 },
  ];

  function walking(): CameraHarness {
    const built = cameraHarness();
    built.controller.setMode('walk');
    built.camera.position.set(1.5, EYE_HEIGHT, 2);
    return built;
  }

  test('setMotionInstant(true) makes walkAlong land in the SAME call, one frame, not a curve advanced over many', () => {
    const { controller, camera } = walking();
    let done = 0;
    controller.setMotionInstant(true);
    expect(controller.walkAlong(LEGS, () => (done += 1))).toBe(true);
    // Already arrived: nothing left to advance, and onDone already fired.
    expect(controller.isTravelling()).toBe(false);
    expect(done).toBe(1);
    expect(camera.position.distanceTo(new THREE.Vector3(LEGS[1]!.x, EYE_HEIGHT, LEGS[1]!.z))).toBeLessThan(0.05);
  });

  test('setMotionInstant(false) is the ordinary animated walk, over many frames', () => {
    const { controller } = walking();
    controller.setMotionInstant(false);
    expect(controller.walkAlong(LEGS)).toBe(true);
    expect(controller.isTravelling()).toBe(true);
  });

  test('flyTo lands in one call under instant motion: no tween left running', () => {
    const { controller, camera } = cameraHarness();
    controller.setMotionInstant(true);
    const target = new THREE.Vector3(1, 0, 1);
    controller.flyTo(new THREE.Vector3(4, 2, 4), target);
    controller.update(FRAME);
    // A tween in progress would still be moving on the next frame; a jump
    // would not, because `orbit.reset` already put the pose exactly there.
    const before = camera.position.clone();
    controller.update(FRAME);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
  });

  test('flyToRoom is instant the same way flyTo is (it delegates to it)', () => {
    const { controller, camera } = cameraHarness();
    controller.setMotionInstant(true);
    expect(controller.flyToRoom(L_SHAPE.room.b)).toBe(true);
    const afterFirstFrame = camera.position.clone();
    controller.update(FRAME);
    expect(camera.position.distanceTo(afterFirstFrame)).toBeLessThan(1e-6);
  });

  test('turning instant motion back off restores the animated fly-to', () => {
    const { controller, camera } = cameraHarness();
    controller.setMotionInstant(true);
    controller.setMotionInstant(false);
    controller.flyTo(new THREE.Vector3(4, 2, 4), new THREE.Vector3(1, 0, 1));
    const start = camera.position.clone();
    controller.update(FRAME);
    // Still under way: an animated flight does not land on its first frame.
    expect(camera.position.distanceTo(start)).toBeGreaterThan(1e-6);
  });
});
