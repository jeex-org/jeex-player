/**
 * The walker on its own: the look angles, the keys and the entry pose.
 *
 * Collisions, doors and the scripted route are exercised end to end through
 * the controller (`camera-controller.test.ts`), because they only mean
 * anything against a real plan and a real gesture stream. What is here is the
 * part that has no camera around it: what a drag does to the head, what W
 * does to the feet, and where a walkthrough starts.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { WalkRig } from './walk-rig.js';
import { CAMERA_TUNING } from './camera-tuning.js';
import { EYE_HEIGHT_M } from '../navigation/navigation.js';
import { obstaclesFor } from '../assets/asset-footprint.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import type { SceneData } from '../scene/types.js';
import { cameraHarness, type CameraHarness } from '../fixtures/camera-harness.js';
import { fakeCanvas, stubPicker } from '../fixtures/stubs.js';

const { walk: WALK } = CAMERA_TUNING;
const FRAME = 1 / 60;

function rig(scene: SceneData = lShapePlan) {
  const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
  const plan = solvePlan(scene);
  const obstacles = obstaclesFor(scene);
  const hints: string[] = [];
  const picker = stubPicker();
  const walk = new WalkRig({
    camera,
    picker,
    scene: () => scene,
    plan: () => plan,
    obstacles: () => obstacles,
    furnitureCollisions: () => true,
    callbacks: {
      onHint: (message) => {
        hints.push(message);
      },
    },
  });
  return { walk, camera, plan, hints };
}

/** Where the walker is looking, as a unit vector. */
function gaze(built: ReturnType<typeof rig>): THREE.Vector3 {
  return built.walk.lookTarget().sub(built.camera.position).normalize();
}

describe('the look', () => {
  test('the gaze sits one fixed distance ahead of the eye', () => {
    const built = rig();
    built.camera.position.set(3, EYE_HEIGHT_M, 4);
    expect(built.walk.lookTarget().distanceTo(built.camera.position)).toBeCloseTo(WALK.gazeDistanceM, 6);
  });

  test('a drag only turns the head while a pointer is down', () => {
    const built = rig();
    built.walk.drag(100, 0);
    expect(built.walk.look.yaw).toBe(0);
    built.walk.press();
    built.walk.drag(100, 0);
    expect(built.walk.look.yaw).toBeCloseTo(100 * WALK.lookRadPerPx, 6);
    built.walk.release();
    built.walk.drag(100, 0);
    expect(built.walk.look.yaw).toBeCloseTo(100 * WALK.lookRadPerPx, 6);
  });

  test('the pitch stops short of straight up and straight down', () => {
    const built = rig();
    built.walk.press();
    for (let i = 0; i < 50; i += 1) built.walk.drag(0, 500);
    expect(built.walk.look.pitch).toBeCloseTo(WALK.pitchMax, 6);
    expect(gaze(built).y).toBeLessThan(1);
    for (let i = 0; i < 100; i += 1) built.walk.drag(0, -500);
    expect(built.walk.look.pitch).toBeCloseTo(WALK.pitchMin, 6);
    expect(gaze(built).y).toBeGreaterThan(-1);
  });

  test('syncFromCamera picks up whatever direction the camera was left facing', () => {
    const built = rig();
    built.camera.position.set(3, EYE_HEIGHT_M, 4);
    built.camera.lookAt(3, EYE_HEIGHT_M, 8);
    built.walk.syncFromCamera();
    const ahead = gaze(built);
    expect(ahead.z).toBeCloseTo(1, 5);
    expect(ahead.y).toBeCloseTo(0, 5);
  });
});

describe('the keys', () => {
  test('the movement keys are taken, everything else is left to the page', () => {
    const built = rig();
    for (const code of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) {
      expect(built.walk.keyDown(code)).toBe(true);
      built.walk.keyUp(code);
    }
    for (const code of ['tab', 'f', '/', 'shift']) expect(built.walk.keyDown(code)).toBe(false);
  });

  test('W walks the way the walker is looking, S the other way', () => {
    const built = rig();
    built.camera.position.set(3, EYE_HEIGHT_M, 4);
    built.walk.syncFromCamera();
    const ahead = gaze(built).clone();
    built.walk.keyDown('w');
    const before = built.camera.position.clone();
    for (let i = 0; i < 10; i += 1) built.walk.update(FRAME);
    const moved = built.camera.position.clone().sub(before);
    expect(moved.length()).toBeGreaterThan(0);
    expect(moved.normalize().dot(ahead)).toBeGreaterThan(0.99);
  });

  test('shift is the run speed, not a direction', () => {
    const walked = rig();
    walked.camera.position.set(3, EYE_HEIGHT_M, 4);
    walked.walk.syncFromCamera();
    walked.walk.keyDown('w');
    const start = walked.camera.position.clone();
    for (let i = 0; i < 10; i += 1) walked.walk.update(FRAME);
    const slow = walked.camera.position.distanceTo(start);

    const ran = rig();
    ran.camera.position.set(3, EYE_HEIGHT_M, 4);
    ran.walk.syncFromCamera();
    ran.walk.keyDown('w');
    ran.walk.keyDown('shift');
    const from = ran.camera.position.clone();
    for (let i = 0; i < 10; i += 1) ran.walk.update(FRAME);
    expect(ran.camera.position.distanceTo(from)).toBeGreaterThan(slow);
  });

  test('a key released, or focus lost, stops the walker', () => {
    const built = rig();
    built.camera.position.set(3, EYE_HEIGHT_M, 4);
    built.walk.keyDown('w');
    built.walk.keyUp('w');
    const before = built.camera.position.clone();
    for (let i = 0; i < 10; i += 1) built.walk.update(FRAME);
    expect(built.camera.position.distanceTo(before)).toBeCloseTo(0, 6);

    built.walk.keyDown('w');
    built.walk.clearKeys();
    for (let i = 0; i < 10; i += 1) built.walk.update(FRAME);
    expect(built.camera.position.distanceTo(before)).toBeCloseTo(0, 6);
  });

  test('the walker never walks out of the flat, however long the key is held', () => {
    const built = rig();
    built.camera.position.set(3, EYE_HEIGHT_M, 4);
    built.walk.syncFromCamera();
    built.walk.keyDown('w');
    for (let i = 0; i < 600; i += 1) built.walk.update(FRAME);
    expect(built.walk.isNavigableAt(built.camera.position.x, built.camera.position.z)).toBe(true);
    expect(built.camera.position.y).toBeCloseTo(EYE_HEIGHT_M, 6);
  });
});

describe('the entry pose', () => {
  test('an authored walkSpawn is used exactly as authored', () => {
    const scene: SceneData = { ...lShapePlan, walkSpawn: { position: { x: 2, y: 1.6, z: 6 }, target: { x: 5, y: 1.3, z: 6 } } };
    const built = rig(scene);
    built.walk.spawn();
    expect(built.camera.position.x).toBeCloseTo(2, 6);
    expect(built.camera.position.y).toBeCloseTo(EYE_HEIGHT_M, 6);
    expect(built.camera.position.z).toBeCloseTo(6, 6);
    // Facing +x, level: the authored target says which way, not just where.
    const ahead = gaze(built);
    expect(ahead.x).toBeCloseTo(1, 5);
    expect(ahead.y).toBeCloseTo(0, 6);
  });

  test('a target on top of the spawn keeps the heading the camera arrived with', () => {
    // `atan2(0, 0)` is "due north" and means nothing; the direction the camera
    // was already facing is the honest answer.
    const spawn = { x: 3, y: 1.6, z: 4 };
    const scene: SceneData = { ...lShapePlan, walkSpawn: { position: spawn, target: spawn } };
    const built = rig(scene);
    built.camera.position.set(3, EYE_HEIGHT_M, 4);
    built.camera.lookAt(6, EYE_HEIGHT_M, 4);
    built.walk.syncFromCamera();
    built.walk.spawn();
    expect(gaze(built).x).toBeCloseTo(1, 5);
  });

  test('the spawn always lands the eye at standing height', () => {
    const built = rig();
    built.camera.position.set(0, 20, 0);
    built.walk.spawn();
    expect(built.camera.position.y).toBeCloseTo(EYE_HEIGHT_M, 6);
    expect(built.walk.look.pitch).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Through the CONTROLLER — moved out of `camera-controller.test.ts`.
// ---------------------------------------------------------------------------

describe('walk input direction', () => {
  // Street View / touch-panorama convention (the input-direction rule: the
  // scene follows the fingers): a walk-mode drag moves
  // the picture WITH the pointer on both axes, same rule as 360. Verified on
  // the world-space forward vector (`getPose().target - camera.position`),
  // not on `look.yaw`/`look.pitch` directly: the sign convention of those
  // fields is exactly what a reader could get backwards by inspection alone.
  function fire(canvas: ReturnType<typeof fakeCanvas>, type: string, event: unknown): void {
    for (const handler of canvas.listeners.get(type) ?? []) handler(event);
  }

  function forwardOf(built: CameraHarness): THREE.Vector3 {
    return built.controller.getPose().target.clone().sub(built.camera.position).normalize();
  }

  /** A press-move-release drag in walk mode, one pointer from the canvas centre. */
  function walkDrag(built: CameraHarness, dx: number, dy: number): void {
    fire(built.canvas, 'pointerdown', { pointerId: 71, clientX: 400, clientY: 300, button: 0, shiftKey: false });
    fire(built.canvas, 'pointermove', { pointerId: 71, clientX: 400 + dx, clientY: 300 + dy, button: 0, shiftKey: false });
    fire(built.canvas, 'pointerup', { pointerId: 71 });
  }

  test('a rightward drag turns the viewer left: forward swings towards screen-right', () => {
    const built = cameraHarness();
    built.controller.setMode('walk');
    const before = forwardOf(built);
    walkDrag(built, 48, 0);
    const after = forwardOf(built);
    // The camera's own "right" (cross(forward, up) at yaw 0) is world -X here,
    // so forward swinging towards +X is the viewer turning towards ITS left —
    // which is what puts a point ahead onto the RIGHT of the screen, matching
    // the pointer. cross(before, after).y > 0 is exactly that swing.
    const cross = before.clone().cross(after);
    expect(cross.y).toBeGreaterThan(1e-6);
    // And the reverse drag undoes it, so this is a sign check, not a fluke of
    // the seeded yaw.
    const leftBuilt = cameraHarness();
    leftBuilt.controller.setMode('walk');
    const beforeLeft = forwardOf(leftBuilt);
    walkDrag(leftBuilt, -48, 0);
    const afterLeft = forwardOf(leftBuilt);
    expect(beforeLeft.clone().cross(afterLeft).y).toBeLessThan(-1e-6);
  });

  test('a downward drag raises the forward vector, the viewer looks up', () => {
    const built = cameraHarness();
    built.controller.setMode('walk');
    const beforeY = forwardOf(built).y;
    walkDrag(built, 0, 48);
    const afterY = forwardOf(built).y;
    expect(afterY).toBeGreaterThan(beforeY);
    const upBuilt = cameraHarness();
    upBuilt.controller.setMode('walk');
    const beforeUpY = forwardOf(upBuilt).y;
    walkDrag(upBuilt, 0, -48);
    const afterUpY = forwardOf(upBuilt).y;
    expect(afterUpY).toBeLessThan(beforeUpY);
  });
});

// ---------------------------------------------------------------------------
// Moving by hand:
// a MOVE drag (Space, Shift or the right button held at the press), two
// fingers, a pinch, and the wheel.
// ---------------------------------------------------------------------------

describe('moving by hand, on the rig', () => {
  /** A walker in the middle of room A (x 0..6, z 0..8), facing -z: the wall at z = 0 ahead. */
  function facingTheWall(): ReturnType<typeof rig> {
    const built = rig();
    built.camera.position.set(3, EYE_HEIGHT_M, 4);
    built.walk.look.yaw = Math.PI;
    return built;
  }

  test('a MOVE press walks instead of turning the head', () => {
    const built = facingTheWall();
    built.walk.press(true);
    built.walk.drag(0, 100);
    expect(built.walk.look.yaw).toBe(Math.PI);
    expect(built.walk.look.pitch).toBe(0);
    // Pulled towards the viewer by 100 px: one metre forward, towards the wall.
    expect(built.camera.position.z).toBeCloseTo(4 - 100 * WALK.dragMoveMPerPx, 6);
    expect(built.camera.position.x).toBeCloseTo(3, 6);
  });

  test('a MOVE drag sideways steps the other way, so the floor follows the pointer', () => {
    const built = facingTheWall();
    built.walk.press(true);
    built.walk.drag(100, 0);
    // Facing -z, screen-right is world +x: drag right, step LEFT (-x).
    expect(built.camera.position.x).toBeCloseTo(3 - 100 * WALK.dragMoveMPerPx, 6);
    expect(built.walk.look.yaw).toBe(Math.PI);
  });

  test('no pointer down, no move; a release ends the move', () => {
    const built = facingTheWall();
    built.walk.drag(0, 100);
    built.walk.press(true);
    built.walk.release();
    built.walk.drag(0, 100);
    expect(built.camera.position.z).toBeCloseTo(4, 6);
  });

  test('two fingers move by their centroid and never turn the head', () => {
    const built = facingTheWall();
    built.walk.press();
    built.walk.drag(80, 0, 2, null);
    expect(built.walk.look.yaw).toBe(Math.PI);
    built.walk.drag(80, 0, 2, { dx: 0, dy: 50 });
    expect(built.walk.look.yaw).toBe(Math.PI);
    expect(built.camera.position.z).toBeCloseTo(4 - 50 * WALK.dragMoveMPerPx, 6);
  });

  test('a pinch apart walks forward, together walks back', () => {
    const built = facingTheWall();
    built.walk.pinch(0.5);
    expect(built.camera.position.z).toBeCloseTo(4 - Math.log(2) * WALK.pinchMPerLog, 6);
    built.walk.pinch(2);
    expect(built.camera.position.z).toBeCloseTo(4, 6);
  });

  test('a wheel step glides out over a few frames, and reduced motion lands it at once', () => {
    const built = facingTheWall();
    built.walk.step(WALK.wheelStepM);
    expect(built.camera.position.z).toBeCloseTo(4, 6);
    for (let i = 0; i < 60; i += 1) built.walk.update(FRAME);
    const glided = 4 - built.camera.position.z;
    expect(glided).toBeGreaterThan(WALK.wheelStepM - WALK.arriveM);
    expect(glided).toBeLessThanOrEqual(WALK.wheelStepM + 1e-9);

    const instant = facingTheWall();
    instant.walk.setMotionInstant(true);
    instant.walk.step(WALK.wheelStepM);
    expect(instant.camera.position.z).toBeCloseTo(4 - WALK.wheelStepM, 6);
  });

  test('a wall ends the wheel: however many steps, the walker stays in the room', () => {
    const built = facingTheWall();
    for (let notch = 0; notch < 30; notch += 1) {
      built.walk.step(WALK.wheelStepM);
      for (let i = 0; i < 6; i += 1) built.walk.update(FRAME);
    }
    for (let i = 0; i < 120; i += 1) built.walk.update(FRAME);
    const stopped = built.camera.position.clone();
    expect(stopped.z).toBeGreaterThan(0);
    expect(built.walk.isNavigableAt(stopped.x, stopped.z)).toBe(true);
    // The glide is over, not pushing at the wall for ever.
    for (let i = 0; i < 30; i += 1) built.walk.update(FRAME);
    expect(built.camera.position.distanceTo(stopped)).toBeCloseTo(0, 9);
  });
});

describe('moving by hand, through the controller: directions by projection', () => {
  function fire(canvas: ReturnType<typeof fakeCanvas>, type: string, event: unknown): void {
    for (const handler of canvas.listeners.get(type) ?? []) handler(event);
  }

  /** Viewport pixels of a world point on the harness's 800x600 canvas. */
  function screenOf(camera: THREE.PerspectiveCamera, point: THREE.Vector3): { x: number; y: number } {
    camera.updateMatrixWorld(true);
    const ndc = point.clone().project(camera);
    return { x: (ndc.x + 1) * 400, y: (1 - ndc.y) * 300 };
  }

  /** Walk mode in room A, facing -z; `ahead` is a floor point 2.5 m in front. */
  function walking(): { built: CameraHarness; ahead: THREE.Vector3 } {
    const built = cameraHarness();
    built.camera.position.set(3, EYE_HEIGHT_M, 5);
    built.camera.lookAt(3, EYE_HEIGHT_M, 0);
    built.controller.setMode('walk');
    built.controller.update(FRAME);
    return { built, ahead: new THREE.Vector3(3, 0, 2.5) };
  }

  /** A press-move-release from the canvas centre, with Space held unless `button`/`shiftKey` say otherwise. */
  function moveDrag(built: CameraHarness, dx: number, dy: number, init: { button?: number; shiftKey?: boolean } = {}): void {
    const space = init.button === undefined && init.shiftKey === undefined;
    const key = (type: string): void => fire(built.canvas, type, { key: ' ', target: built.canvas, preventDefault: () => undefined });
    if (space) key('keydown');
    const common = { button: init.button ?? 0, shiftKey: init.shiftKey ?? false };
    fire(built.canvas, 'pointerdown', { pointerId: 91, clientX: 400, clientY: 300, ...common });
    fire(built.canvas, 'pointermove', { pointerId: 91, clientX: 400 + dx, clientY: 300 + dy, ...common });
    fire(built.canvas, 'pointerup', { pointerId: 91 });
    if (space) key('keyup');
    built.controller.update(FRAME);
  }

  function wheel(built: CameraHarness, init: Partial<WheelEvent>, prevented = { count: 0 }): void {
    fire(built.canvas, 'wheel', {
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
      preventDefault: () => {
        prevented.count += 1;
      },
      ...init,
    });
  }

  test('Space + drag down: the floor comes down with the pointer and the walker goes forward', () => {
    const { built, ahead } = walking();
    const before = screenOf(built.camera, ahead);
    const forward = built.controller.getPose().target.sub(built.camera.position).normalize();
    moveDrag(built, 0, 60);
    const after = screenOf(built.camera, ahead);
    expect(after.y - before.y).toBeGreaterThan(1);
    expect(built.camera.position.z).toBeLessThan(5);
    // The head did not turn.
    const still = built.controller.getPose().target.sub(built.camera.position).normalize();
    expect(still.dot(forward)).toBeCloseTo(1, 9);
  });

  test('Space + drag right: the floor slides right with the pointer', () => {
    const { built, ahead } = walking();
    const before = screenOf(built.camera, ahead);
    moveDrag(built, 60, 0);
    expect(screenOf(built.camera, ahead).x - before.x).toBeGreaterThan(1);
  });

  test('the right button and Shift are the same move as Space', () => {
    for (const init of [{ button: 2 }, { shiftKey: true }]) {
      const { built, ahead } = walking();
      const before = screenOf(built.camera, ahead);
      moveDrag(built, 0, 60, init);
      expect(screenOf(built.camera, ahead).y - before.y).toBeGreaterThan(1);
    }
  });

  test('without the modifier the same drag only looks (the walker stays put)', () => {
    const { built } = walking();
    fire(built.canvas, 'pointerdown', { pointerId: 92, clientX: 400, clientY: 300, button: 0, shiftKey: false });
    fire(built.canvas, 'pointermove', { pointerId: 92, clientX: 400, clientY: 360, button: 0, shiftKey: false });
    fire(built.canvas, 'pointerup', { pointerId: 92 });
    built.controller.update(FRAME);
    expect(built.camera.position.z).toBeCloseTo(5, 9);
  });

  test('the wheel steps: forward takes the page scroll and walks forward, backward walks back', () => {
    const { built, ahead } = walking();
    const prevented = { count: 0 };
    const before = screenOf(built.camera, ahead);
    wheel(built, { deltaY: -100 }, prevented);
    for (let i = 0; i < 60; i += 1) built.controller.update(FRAME);
    expect(prevented.count).toBe(1);
    expect(5 - built.camera.position.z).toBeGreaterThan(CAMERA_TUNING.walk.wheelStepM - CAMERA_TUNING.walk.arriveM);
    expect(screenOf(built.camera, ahead).y).toBeGreaterThan(before.y);
    wheel(built, { deltaY: 100 });
    for (let i = 0; i < 60; i += 1) built.controller.update(FRAME);
    expect(built.camera.position.z).toBeCloseTo(5, 1);
  });

  test('a trackpad pinch (ctrl wheel) steps the same way', () => {
    const { built } = walking();
    wheel(built, { deltaY: -100, ctrlKey: true });
    for (let i = 0; i < 60; i += 1) built.controller.update(FRAME);
    expect(built.camera.position.z).toBeLessThan(5 - 0.4);
  });

  test('a sideways swipe strafes with the fingers', () => {
    const { built, ahead } = walking();
    const before = screenOf(built.camera, ahead);
    // Natural scrolling: fingers to the RIGHT arrive as deltaX < 0.
    wheel(built, { deltaX: -100 });
    for (let i = 0; i < 60; i += 1) built.controller.update(FRAME);
    expect(screenOf(built.camera, ahead).x - before.x).toBeGreaterThan(1);
  });

  test('+ narrows the field of view, - widens it, and a mode switch puts it back', () => {
    const { built } = walking();
    const base = built.camera.fov;
    const key = (k: string): void => fire(built.canvas, 'keydown', { key: k, preventDefault: () => undefined });
    key('+');
    built.controller.update(FRAME);
    expect(built.camera.fov).toBeCloseTo(base - CAMERA_TUNING.walk.fovStepDeg, 6);
    key('-');
    key('-');
    built.controller.update(FRAME);
    expect(built.camera.fov).toBeCloseTo(base + CAMERA_TUNING.walk.fovStepDeg, 6);
    for (let i = 0; i < 40; i += 1) key('=');
    built.controller.update(FRAME);
    expect(built.camera.fov).toBeCloseTo(CAMERA_TUNING.walk.fovMinDeg, 6);
    built.controller.setMode('orbit');
    built.controller.setMode('walk');
    built.controller.update(FRAME);
    expect(built.camera.fov).toBeCloseTo(base, 6);
  });

  test('+ and - count as manual input, so a camera step in flight stops on them like on any other key', () => {
    let manual = 0;
    const built = cameraHarness({ onManualInput: () => (manual += 1) });
    built.camera.position.set(3, EYE_HEIGHT_M, 5);
    built.controller.setMode('walk');
    const key = (k: string): void => fire(built.canvas, 'keydown', { key: k, preventDefault: () => undefined });
    key('+');
    key('-');
    expect(manual).toBe(2);
  });
});

describe('the floor ring and click-to-walk', () => {
  /** A navigable floor the picker answers for, like the builder's own slab. */
  function floorMesh(): THREE.Mesh {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.userData['navigable'] = true;
    floor.userData['surface'] = 'floor';
    floor.updateMatrixWorld(true);
    return floor;
  }

  /** Walk mode in room A, looking down at the floor 2 m ahead (the canvas centre). */
  function lookingAtTheFloor(): CameraHarness {
    const built = cameraHarness();
    built.picker.register(floorMesh());
    built.controller.setFurnitureCollision(false);
    built.camera.position.set(3, EYE_HEIGHT_M, 5);
    built.camera.lookAt(3, 0, 3);
    built.controller.setMode('walk');
    built.camera.position.set(3, EYE_HEIGHT_M, 5);
    built.camera.updateMatrixWorld(true);
    return built;
  }

  function hoverCentre(built: CameraHarness): void {
    for (const handler of built.canvas.listeners.get('pointermove') ?? []) handler({ pointerId: 5, clientX: 400, clientY: 300 });
    built.controller.update(FRAME);
    built.camera.updateMatrixWorld(true);
  }

  test('over the floor the ring stands where a click would walk', () => {
    const built = lookingAtTheFloor();
    hoverCentre(built);
    expect(built.controller.floorRing.visible).toBe(true);
    const at = built.controller.floorRing.object.position;
    expect(at.x).toBeCloseTo(3, 1);
    expect(at.z).toBeLessThan(5);
    expect(at.y).toBeGreaterThan(0);
    expect(at.y).toBeLessThan(0.05);
  });

  test('over a wall standing in front of the floor it hides', () => {
    const built = lookingAtTheFloor();
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
    wall.position.set(3, 1, 4);
    wall.userData['surface'] = 'wall';
    wall.updateMatrixWorld(true);
    built.picker.register(wall);
    hoverCentre(built);
    expect(built.controller.floorRing.visible).toBe(false);
  });

  test('outside the flat (no navigable floor) it hides', () => {
    const built = lookingAtTheFloor();
    // Look out past the wall at z = 0: the floor mesh goes on, the flat does not.
    built.camera.lookAt(3, 0, -3);
    built.camera.updateMatrixWorld(true);
    built.controller.update(FRAME);
    built.camera.lookAt(3, 0, -3);
    hoverCentre(built);
    expect(built.controller.floorRing.visible).toBe(false);
  });

  test('a press, the pointer leaving and 360 mode all put it away', () => {
    const built = lookingAtTheFloor();
    hoverCentre(built);
    expect(built.controller.floorRing.visible).toBe(true);
    for (const handler of built.canvas.listeners.get('pointerdown') ?? []) handler({ pointerId: 6, clientX: 400, clientY: 300, button: 0 });
    expect(built.controller.floorRing.visible).toBe(false);
    for (const handler of built.canvas.listeners.get('pointerup') ?? []) handler({ pointerId: 6 });
    hoverCentre(built);
    for (const handler of built.canvas.listeners.get('pointerleave') ?? []) handler({});
    expect(built.controller.floorRing.visible).toBe(false);
    hoverCentre(built);
    built.controller.setMode('orbit');
    hoverCentre(built);
    expect(built.controller.floorRing.visible).toBe(false);
  });

  test('the ring is never a pick target itself', () => {
    const built = lookingAtTheFloor();
    const hits: THREE.Intersection[] = [];
    built.controller.floorRing.object.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
  });

  test('under reduced motion a click on the floor cuts there instead of gliding', () => {
    const built = lookingAtTheFloor();
    built.controller.setMotionInstant(true);
    for (const handler of built.canvas.listeners.get('click') ?? []) handler({ clientX: 400, clientY: 300 });
    // No frame has run: the walker is already there.
    expect(built.camera.position.z).toBeLessThan(3.2);
    expect(built.camera.position.z).toBeGreaterThan(2.8);
  });
});
