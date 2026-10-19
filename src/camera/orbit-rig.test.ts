/**
 * The dollhouse rig on its own, with no controller and no input around it.
 *
 * Directions are PROJECTED, never argued about: every assertion reads where a
 * fixed world point landed on an
 * 800x600 viewport before and after the gesture, `+x` right and `+y` down as
 * on screen. A state-only assertion ("the camera moved") passes happily on an
 * inverted control, which is how the trackpad bug survived a full test suite.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { OrbitRig } from './orbit-rig.js';
import { CAMERA_TUNING } from './camera-tuning.js';
import { Picker } from '../geometry/picker.js';
import { CameraController } from './camera-controller.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { cameraHarness, type CameraHarness } from '../fixtures/camera-harness.js';
import { fakeCanvas, stubPicker } from '../fixtures/stubs.js';

const { orbit: ORBIT } = CAMERA_TUNING;
const FRAME = 1 / 60;

/** A rig looking at the origin from a few metres out, already settled. */
function rig(picker: Picker = stubPicker()): { rig: OrbitRig; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
  camera.position.set(6, 6, 6);
  const built = new OrbitRig({ camera, picker, callbacks: {} });
  built.reset(camera.position.clone(), new THREE.Vector3(0, 0, 0));
  settle(built);
  return { rig: built, camera };
}

function settle(target: OrbitRig, frames = 400): void {
  for (let i = 0; i < frames; i += 1) target.update(FRAME);
}

/** Viewport pixels of a world point, the way the renderer would place it. */
function screenOf(camera: THREE.PerspectiveCamera, point: THREE.Vector3): { x: number; y: number } {
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const ndc = point.clone().project(camera);
  return { x: (ndc.x + 1) * 400, y: (1 - ndc.y) * 300 };
}

type Motion = { centreX: number; centreY: number; nearX: number; nearY: number; radiusRatio: number };

/** Runs `act` and reports where the picture went, in screen pixels. */
function motion(built: { rig: OrbitRig; camera: THREE.PerspectiveCamera }, act: () => void): Motion {
  const centre = built.rig.target.clone();
  const back = built.camera.position.clone().sub(centre).setY(0).normalize();
  const near = centre.clone().addScaledVector(back, 3);
  const before = {
    centre: screenOf(built.camera, centre),
    near: screenOf(built.camera, near),
    radius: built.camera.position.distanceTo(centre),
  };
  act();
  settle(built.rig);
  return {
    centreX: screenOf(built.camera, centre).x - before.centre.x,
    centreY: screenOf(built.camera, centre).y - before.centre.y,
    nearX: screenOf(built.camera, near).x - before.near.x,
    nearY: screenOf(built.camera, near).y - before.near.y,
    radiusRatio: built.camera.position.distanceTo(built.rig.target) / before.radius,
  };
}

/** Pixels below which a motion is projection noise rather than a direction. */
const STILL = 1;

describe('the scene follows the fingers', () => {
  test('a drag right swings the near half of the scene right, target held', () => {
    const built = rig();
    const moved = motion(built, () => {
      built.rig.press(false);
      built.rig.drag(60, 0, 1, null);
    });
    expect(moved.nearX).toBeGreaterThan(STILL);
    expect(Math.abs(moved.centreX)).toBeLessThan(STILL);
    expect(moved.radiusRatio).toBeCloseTo(1, 6);
  });

  test('a drag down tips the rig without moving the target', () => {
    const built = rig();
    const down = motion(built, () => {
      built.rig.press(false);
      built.rig.drag(0, 60, 1, null);
    });
    const up = motion(built, () => {
      built.rig.press(false);
      built.rig.drag(0, -60, 1, null);
    });
    expect(down.nearY).not.toBeCloseTo(up.nearY, 1);
    expect(Math.abs(down.centreX) + Math.abs(down.centreY)).toBeLessThan(2 * STILL);
  });

  test('a pan carries the point under the pointer with it, on both axes', () => {
    const built = rig();
    const moved = motion(built, () => {
      built.rig.press(true);
      built.rig.drag(40, 25, 1, null);
    });
    expect(moved.centreX).toBeGreaterThan(STILL);
    expect(moved.centreY).toBeGreaterThan(STILL);
    expect(moved.radiusRatio).toBeCloseTo(1, 6);
  });

  test('a MOVE press (right button, Shift or Space: camera-input.ts) pans, and a release ends it', () => {
    const built = rig();
    const shifted = motion(built, () => {
      built.rig.press(true);
      built.rig.drag(40, 0, 1, null);
    });
    expect(shifted.centreX).toBeGreaterThan(STILL);
    const after = motion(built, () => {
      built.rig.release();
      built.rig.press(false);
      built.rig.drag(40, 0, 1, null);
    });
    expect(Math.abs(after.centreX)).toBeLessThan(STILL);
  });

  test('two fingers pan by their centroid and ignore the pointer that moved', () => {
    const built = rig();
    const ignored = motion(built, () => {
      built.rig.press(false);
      built.rig.drag(80, 0, 2, null);
    });
    expect(Math.abs(ignored.centreX)).toBeLessThan(STILL);
    const panned = motion(built, () => {
      built.rig.drag(80, 0, 2, { dx: 40, dy: 0 });
    });
    expect(panned.centreX).toBeGreaterThan(STILL);
  });

  test('a wheel forward zooms in, backward out, and neither pans', () => {
    const built = rig();
    const inwards = motion(built, () => {
      built.rig.zoom(-120);
    });
    expect(inwards.radiusRatio).toBeLessThan(1);
    expect(Math.abs(inwards.centreX) + Math.abs(inwards.centreY)).toBeLessThan(2 * STILL);
    const outwards = motion(built, () => {
      built.rig.zoom(120);
    });
    expect(outwards.radiusRatio).toBeGreaterThan(1);
  });

  test('fingers spreading come in: a pinch scale below one shortens the radius', () => {
    const built = rig();
    expect(
      motion(built, () => {
        built.rig.pinch(0.5);
      }).radiusRatio,
    ).toBeLessThan(1);
    expect(
      motion(built, () => {
        built.rig.pinch(2);
      }).radiusRatio,
    ).toBeGreaterThan(1);
  });
});

/**
 * A real picker over an 800x600 canvas that sees a floor at `y = 0` and, when
 * asked, a wall standing across `z = -2` — the two kinds of hit a zoom can
 * close in on.
 */
function pickerOver(options: { wall?: boolean } = {}): Picker {
  const picker = new Picker(fakeCanvas());
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60));
  floor.rotation.x = -Math.PI / 2;
  floor.userData['surface'] = 'floor';
  root.add(floor);
  if (options.wall) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 0.2));
    wall.position.set(0, 1.5, -2);
    wall.userData['surface'] = 'wall';
    root.add(wall);
  }
  root.updateMatrixWorld(true);
  picker.register(root);
  return picker;
}

/** The world point a picker hit under `pixel`, read off the settled camera. */
function hitUnder(picker: Picker, camera: THREE.PerspectiveCamera, pixel: { x: number; y: number }): THREE.Vector3 {
  camera.updateMatrixWorld(true);
  const hit = picker.pickSelection(pixel.x, pixel.y, camera);
  if (!hit) throw new Error(`nothing under ${pixel.x},${pixel.y}`);
  return hit.point.clone();
}

/** Pixels a point may drift off the cursor over a whole zoom: projection noise, not a direction. */
const HELD = 0.5;

describe('zoom toward the point under the cursor', () => {
  const CURSOR = { x: 610, y: 430 };

  test('a wheel in keeps the floor point under the cursor under it, and still comes in', () => {
    const picker = pickerOver();
    const built = rig(picker);
    const point = hitUnder(picker, built.camera, CURSOR);
    const radius = built.camera.position.distanceTo(built.rig.target);
    for (let notch = 0; notch < 3; notch += 1) built.rig.zoom(-120, CURSOR);
    settle(built.rig);
    const landed = screenOf(built.camera, point);
    expect(Math.hypot(landed.x - CURSOR.x, landed.y - CURSOR.y)).toBeLessThan(HELD);
    expect(built.camera.position.distanceTo(built.rig.target) / radius).toBeLessThan(0.8);
  });

  test('a wheel out keeps the point under the cursor too, and goes out', () => {
    const picker = pickerOver();
    const built = rig(picker);
    const point = hitUnder(picker, built.camera, CURSOR);
    const radius = built.camera.position.distanceTo(built.rig.target);
    built.rig.zoom(200, CURSOR);
    settle(built.rig);
    const landed = screenOf(built.camera, point);
    expect(Math.hypot(landed.x - CURSOR.x, landed.y - CURSOR.y)).toBeLessThan(HELD);
    expect(built.camera.position.distanceTo(built.rig.target) / radius).toBeGreaterThan(1.2);
  });

  test('a wall under the cursor is what the zoom closes in on, and the camera never passes it', () => {
    const picker = pickerOver({ wall: true });
    const built = rig(picker);
    const pixel = screenOf(built.camera, new THREE.Vector3(1, 2, -1.9));
    const point = hitUnder(picker, built.camera, pixel);
    expect(point.z).toBeCloseTo(-1.9, 3);
    for (let notch = 0; notch < 40; notch += 1) built.rig.zoom(-240, pixel);
    settle(built.rig);
    const landed = screenOf(built.camera, point);
    expect(Math.hypot(landed.x - pixel.x, landed.y - pixel.y)).toBeLessThan(HELD);
    // Scaled about the hit, the camera closes in on the wall from its own side.
    expect(built.camera.position.z).toBeGreaterThan(-1.9);
  });

  test('with nothing under the cursor it closes in on the level of the target instead', () => {
    const picker = new Picker(fakeCanvas());
    const built = rig(picker);
    const ray = new THREE.Raycaster();
    built.camera.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2((CURSOR.x / 800) * 2 - 1, 1 - (CURSOR.y / 600) * 2), built.camera);
    const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -built.rig.target.y), new THREE.Vector3());
    if (!point) throw new Error('the cursor ray misses the target level');
    built.rig.zoom(-240, CURSOR);
    settle(built.rig);
    const landed = screenOf(built.camera, point);
    expect(Math.hypot(landed.x - CURSOR.x, landed.y - CURSOR.y)).toBeLessThan(HELD);
  });

  test('a pinch closes in on the point between the fingers', () => {
    const picker = pickerOver();
    const built = rig(picker);
    const point = hitUnder(picker, built.camera, CURSOR);
    built.rig.pinch(0.6, CURSOR);
    settle(built.rig);
    const landed = screenOf(built.camera, point);
    expect(Math.hypot(landed.x - CURSOR.x, landed.y - CURSOR.y)).toBeLessThan(HELD);
  });

  test('at a distance clamp the zoom does nothing at all: no radius, no slide', () => {
    const picker = pickerOver();
    const built = rig(picker);
    for (let i = 0; i < 60; i += 1) built.rig.zoom(-500, CURSOR);
    settle(built.rig);
    const target = built.rig.target.clone();
    const position = built.camera.position.clone();
    built.rig.zoom(-500, CURSOR);
    settle(built.rig);
    expect(built.rig.target.distanceTo(target)).toBeLessThan(1e-9);
    expect(built.camera.position.distanceTo(position)).toBeLessThan(1e-6);
    expect(built.camera.position.distanceTo(built.rig.target)).toBeGreaterThanOrEqual(ORBIT.minRadiusM - 1e-6);
  });
});

describe('clamps', () => {
  test('the radius never leaves its bounds, however hard the gesture pulls', () => {
    const built = rig();
    for (let i = 0; i < 50; i += 1) built.rig.zoom(-500);
    settle(built.rig);
    expect(built.camera.position.distanceTo(built.rig.target)).toBeGreaterThanOrEqual(ORBIT.minRadiusM - 1e-6);
    for (let i = 0; i < 50; i += 1) built.rig.zoom(500);
    settle(built.rig);
    expect(built.camera.position.distanceTo(built.rig.target)).toBeLessThanOrEqual(ORBIT.maxRadiusM + 1e-6);
  });

  test('the polar angle stops at its two bounds, never under the floor', () => {
    const built = rig();
    /** The angle down from straight overhead, radians: the rig's own phi. */
    const phi = (): number => {
      const offset = built.camera.position.clone().sub(built.rig.target);
      return Math.acos(offset.y / offset.length());
    };
    built.rig.press(false);
    // Dragging DOWN slides the picture down, which lifts the rig towards
    // straight overhead: it stops at phiMin and never passes it.
    for (let i = 0; i < 50; i += 1) built.rig.drag(0, 200, 1, null);
    settle(built.rig);
    expect(phi()).toBeCloseTo(ORBIT.phiMin, 2);
    // And dragging up brings it down to the horizon, stopping at phiMax with
    // the camera still above the floor its target sits on.
    for (let i = 0; i < 100; i += 1) built.rig.drag(0, -200, 1, null);
    settle(built.rig);
    expect(phi()).toBeCloseTo(ORBIT.phiMax, 2);
    expect(built.camera.position.y).toBeGreaterThan(built.rig.target.y);
  });
});

describe('flights', () => {
  test('flyTo lands on the pose it was given', () => {
    const built = rig();
    const target = new THREE.Vector3(3, 0, -2);
    built.rig.flyTo(new THREE.Vector3(3, 8, 8), target, 1);
    settle(built.rig);
    expect(built.rig.target.distanceTo(target)).toBeLessThan(0.01);
    expect(built.camera.position.distanceTo(new THREE.Vector3(3, 8, 8))).toBeLessThan(0.2);
  });

  test('a gesture outranks the flight it interrupts', () => {
    const built = rig();
    built.rig.flyTo(new THREE.Vector3(20, 20, 20), new THREE.Vector3(9, 0, 9), 4);
    built.rig.update(FRAME * 10);
    built.rig.press(false);
    built.rig.drag(30, 0, 1, null);
    const targetAfterGrab = built.rig.target.clone();
    settle(built.rig);
    // The tween is dead: the target it was carrying towards (9, 0, 9) is not
    // where the rig ends up.
    expect(built.rig.target.distanceTo(targetAfterGrab)).toBeLessThan(1e-6);
  });

  test('a pinch outranks the flight too, and keeps the point it closed in on', () => {
    const picker = pickerOver();
    const built = rig(picker);
    built.rig.flyTo(new THREE.Vector3(20, 20, 20), new THREE.Vector3(9, 0, 9), 4);
    built.rig.update(FRAME * 10);
    built.rig.pinch(0.7, { x: 610, y: 430 });
    const targetAfterPinch = built.rig.target.clone();
    settle(built.rig);
    expect(built.rig.target.distanceTo(targetAfterPinch)).toBeLessThan(1e-6);
  });

  test('a focus closes in on the point, keeping the bearing it already had', () => {
    const built = rig();
    const before = built.camera.position.clone().sub(built.rig.target).setY(0).normalize();
    const radiusBefore = built.camera.position.distanceTo(built.rig.target);
    built.rig.focusAt(new THREE.Vector3(1, 0, 1));
    settle(built.rig);
    expect(built.rig.target.x).toBeCloseTo(1, 6);
    expect(built.rig.target.y).toBeCloseTo(ORBIT.focusHeightM, 6);
    expect(built.camera.position.distanceTo(built.rig.target)).toBeLessThan(radiusBefore);
    const after = built.camera.position.clone().sub(built.rig.target).setY(0).normalize();
    expect(after.dot(before)).toBeGreaterThan(0.99);
  });

  test('a flight never pulls the camera closer than the minimum radius', () => {
    const built = rig();
    const target = new THREE.Vector3(0, 0, 0);
    built.rig.flyTo(new THREE.Vector3(0.1, 0.1, 0.1), target, 0.5);
    settle(built.rig);
    expect(built.camera.position.distanceTo(built.rig.target)).toBeGreaterThanOrEqual(ORBIT.minRadiusM - 1e-6);
  });
});

describe('syncFromCamera', () => {
  test('the rig picks up wherever the camera was left, and does not snap back', () => {
    const built = rig();
    built.camera.position.set(2, 3, 4);
    built.rig.setTarget(new THREE.Vector3(2, 1, 0));
    built.rig.syncFromCamera();
    built.rig.update(FRAME);
    // One frame of smoothing only, so the camera is still essentially where it
    // was put rather than back on the old sphere.
    expect(built.camera.position.distanceTo(new THREE.Vector3(2, 3, 4))).toBeLessThan(0.2);
  });

  test('a camera inside the minimum radius is pushed back out to it', () => {
    const built = rig();
    built.rig.setTarget(new THREE.Vector3(0, 0, 0));
    built.camera.position.set(0.2, 0.2, 0.2);
    built.rig.syncFromCamera();
    settle(built.rig);
    expect(built.camera.position.distanceTo(built.rig.target)).toBeCloseTo(ORBIT.minRadiusM, 3);
  });
});

// ---------------------------------------------------------------------------
// Through the CONTROLLER.
//
// The block below came out of `camera-controller.test.ts`, which was 1837 lines
// because it owned the behaviour of all three rigs.
// It stays a controller-level test — a gesture reaches the rig through
// `CameraInput` and `CameraController`, and asserting the rig's own methods
// would prove a wiring no production path uses — but it lives with the rig it
// is about.
// ---------------------------------------------------------------------------

/**
 * The one rule for 360-mode input: THE SCENE FOLLOWS THE FINGERS.
 *
 * Directions are not argued about here, they are PROJECTED: every assertion
 * reads where a fixed world point landed on the 800x600 fake canvas before and
 * after the gesture (`+x` right, `+y` down, as on screen). Two points carry the
 * whole rule, and the orbit radius carries the third channel:
 *
 *   centre — the orbit target itself. A pan carries it with the fingers; a
 *            rotation and a zoom leave it dead centre, so it is also the test
 *            for "this gesture must not pan".
 *   near   — 3 m in front of the target, i.e. below it on screen: the point a
 *            rotation swings sideways and a pan carries along with everything
 *            else.
 *   radius — camera to target. Only a zoom may change it.
 */
describe('orbit input direction', () => {
  /** Frames enough for the position smoothing in `updateOrbit` to converge. */
  function settleController(controller: CameraController): void {
    for (let i = 0; i < 400; i += 1) controller.update(FRAME);
  }

  /** Runs `act` and reports where the picture went, in screen pixels. */
  function controllerMotion(built: CameraHarness, act: () => void): Motion {
    settleController(built.controller);
    const centre = built.controller.getPose().target.clone();
    const back = built.camera.position.clone().sub(centre).setY(0).normalize();
    const near = centre.clone().addScaledVector(back, 3);
    const before = {
      centre: screenOf(built.camera, centre),
      near: screenOf(built.camera, near),
      radius: built.camera.position.distanceTo(centre),
    };
    act();
    settleController(built.controller);
    const after = {
      centre: screenOf(built.camera, centre),
      near: screenOf(built.camera, near),
      radius: built.camera.position.distanceTo(built.controller.getPose().target),
    };
    return {
      centreX: after.centre.x - before.centre.x,
      centreY: after.centre.y - before.centre.y,
      nearX: after.near.x - before.near.x,
      nearY: after.near.y - before.near.y,
      radiusRatio: after.radius / before.radius,
    };
  }

  function fire(canvas: ReturnType<typeof fakeCanvas>, type: string, event: unknown): void {
    for (const handler of canvas.listeners.get(type) ?? []) handler(event);
  }

  /**
   * One wheel event with the fields the handler reads, defaults for the rest.
   * The pointer defaults to the middle of the 800x600 canvas, where a zoom
   * toward the cursor and a zoom toward the target are the same zoom.
   */
  function wheel(built: CameraHarness, init: Partial<WheelEvent>): Motion {
    return controllerMotion(built, () =>
      fire(built.canvas, 'wheel', {
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        clientX: 400,
        clientY: 300,
        shiftKey: false,
        ctrlKey: false,
        preventDefault: () => undefined,
        ...init,
      }),
    );
  }

  /** A press-move-release drag, one or two pointers, from the middle of the canvas. */
  function drag(built: CameraHarness, init: { dx: number; dy: number; button?: number; shiftKey?: boolean; pointers?: number }): Motion {
    const common = { button: init.button ?? 0, shiftKey: init.shiftKey ?? false };
    const ids = init.pointers === 2 ? [51, 52] : [51];
    return controllerMotion(built, () => {
      ids.forEach((pointerId, index) =>
        fire(built.canvas, 'pointerdown', { pointerId, clientX: 400 + index * 80, clientY: 300, ...common }),
      );
      ids.forEach((pointerId, index) =>
        fire(built.canvas, 'pointermove', { pointerId, clientX: 400 + index * 80 + init.dx, clientY: 300 + init.dy, ...common }),
      );
      ids.forEach((pointerId) => fire(built.canvas, 'pointerup', { pointerId }));
    });
  }

  /** Pixels below which a motion is projection noise rather than a direction. */
  /** A channel that must not move, in pixels (the outer STILL is the same). */

  test('a horizontal two-finger swipe pans with the fingers and does not zoom', () => {
    const built = cameraHarness();
    // Natural scrolling: fingers to the LEFT arrive as `deltaX > 0`.
    const left = wheel(built, { deltaX: 60 });
    expect(left.centreX).toBeLessThan(-STILL);
    expect(Math.abs(left.centreY)).toBeLessThan(STILL);
    expect(left.radiusRatio).toBeCloseTo(1, 6);
    const right = wheel(built, { deltaX: -60 });
    expect(right.centreX).toBeGreaterThan(STILL);
    expect(right.radiusRatio).toBeCloseTo(1, 6);
  });

  test('a diagonal swipe pans on both axes and still does not zoom', () => {
    // Guards against zooming while panning: a trackpad reports a sideways
    // swipe with a deltaY of its own, which must not zoom.
    const built = cameraHarness();
    const leftAndUp = wheel(built, { deltaX: 60, deltaY: 20 });
    expect(leftAndUp.centreX).toBeLessThan(-STILL);
    expect(leftAndUp.centreY).toBeLessThan(-STILL);
    expect(leftAndUp.radiusRatio).toBeCloseTo(1, 6);
  });

  test('a shift swipe pans with the fingers and does not zoom', () => {
    const built = cameraHarness();
    // Fingers UP arrive as `deltaY > 0`; the picture must go up with them.
    const up = wheel(built, { deltaY: 60, shiftKey: true });
    expect(up.centreY).toBeLessThan(-STILL);
    expect(up.radiusRatio).toBeCloseTo(1, 6);
    const down = wheel(built, { deltaY: -60, shiftKey: true });
    expect(down.centreY).toBeGreaterThan(STILL);
    expect(down.radiusRatio).toBeCloseTo(1, 6);
  });

  test('Firefox rewrites shift+wheel onto deltaX; the pan is still vertical', () => {
    // Firefox reports the shift-pan gesture as `deltaX` with a `deltaY` of
    // zero. Read literally that panned the scene sideways on Firefox and
    // vertically everywhere else, from one and the same finger movement.
    const built = cameraHarness();
    const up = wheel(built, { deltaX: 60, shiftKey: true });
    expect(up.centreY).toBeLessThan(-STILL);
    expect(Math.abs(up.centreX)).toBeLessThan(STILL);
    expect(up.radiusRatio).toBeCloseTo(1, 6);
    const down = wheel(built, { deltaX: -60, shiftKey: true });
    expect(down.centreY).toBeGreaterThan(STILL);
    expect(Math.abs(down.centreX)).toBeLessThan(STILL);
    expect(down.radiusRatio).toBeCloseTo(1, 6);
  });

  test('a shift+wheel that kept its deltaY is untouched, diagonal included', () => {
    // Chromium and Safari: `deltaY` is the gesture, and a stray `deltaX` on a
    // diagonal still pans on both axes. The Firefox rule must not steal that.
    const built = cameraHarness();
    const diagonal = wheel(built, { deltaX: 60, deltaY: 60, shiftKey: true });
    expect(diagonal.centreY).toBeLessThan(-STILL);
    expect(diagonal.centreX).toBeLessThan(-STILL);
    expect(diagonal.radiusRatio).toBeCloseTo(1, 6);
  });

  test('a vertical wheel zooms and does not pan', () => {
    const built = cameraHarness();
    const inward = wheel(built, { deltaY: -120 });
    expect(inward.radiusRatio).toBeLessThan(0.95);
    expect(Math.hypot(inward.centreX, inward.centreY)).toBeLessThan(STILL);
    const outward = wheel(built, { deltaY: 120 });
    expect(outward.radiusRatio).toBeGreaterThan(1.05);
    expect(Math.hypot(outward.centreX, outward.centreY)).toBeLessThan(STILL);
  });

  test('a wheel off-centre zooms toward the point under the cursor, not the screen centre', () => {
    const built = cameraHarness();
    settleController(built.controller);
    const cursor = { x: 620, y: 410 };
    const ray = new THREE.Raycaster();
    built.camera.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2((cursor.x / 800) * 2 - 1, 1 - (cursor.y / 600) * 2), built.camera);
    const level = built.controller.getPose().target.y;
    const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -level), new THREE.Vector3());
    if (!point) throw new Error('the cursor ray misses the target level');
    const inward = wheel(built, { deltaY: -120, clientX: cursor.x, clientY: cursor.y });
    expect(inward.radiusRatio).toBeLessThan(0.95);
    const landed = screenOf(built.camera, point);
    expect(Math.hypot(landed.x - cursor.x, landed.y - cursor.y)).toBeLessThan(STILL);
  });

  test('a two-finger pinch closes in on the point between the fingers', () => {
    const built = cameraHarness();
    settleController(built.controller);
    // Fingers at 540 and 580; the right one moves out to 620, so the pinch
    // happens around their new midpoint, 580. One move: a two-finger drag's
    // first move carries no centroid, so nothing pans.
    const middle = { x: 580, y: 380 };
    const ray = new THREE.Raycaster();
    built.camera.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2((middle.x / 800) * 2 - 1, 1 - (middle.y / 600) * 2), built.camera);
    const level = built.controller.getPose().target.y;
    const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -level), new THREE.Vector3());
    if (!point) throw new Error('the pinch centre misses the target level');
    const apart = controllerMotion(built, () => {
      fire(built.canvas, 'pointerdown', { pointerId: 71, clientX: 540, clientY: middle.y, button: 0, shiftKey: false });
      fire(built.canvas, 'pointerdown', { pointerId: 72, clientX: 580, clientY: middle.y, button: 0, shiftKey: false });
      fire(built.canvas, 'pointermove', { pointerId: 72, clientX: 620, clientY: middle.y, button: 0, shiftKey: false });
      fire(built.canvas, 'pointerup', { pointerId: 71 });
      fire(built.canvas, 'pointerup', { pointerId: 72 });
    });
    expect(apart.radiusRatio).toBeLessThan(0.95);
    const landed = screenOf(built.camera, point);
    expect(Math.hypot(landed.x - middle.x, landed.y - middle.y)).toBeLessThan(STILL);
  });

  test('a ctrl+wheel pinch zooms only, however much stray deltaX it carries', () => {
    const built = cameraHarness();
    const apart = wheel(built, { deltaX: -150, deltaY: -40, ctrlKey: true });
    expect(apart.radiusRatio).toBeLessThan(0.95);
    expect(Math.hypot(apart.centreX, apart.centreY)).toBeLessThan(STILL);
    const together = wheel(built, { deltaX: 150, deltaY: 40, ctrlKey: true });
    expect(together.radiusRatio).toBeGreaterThan(1.05);
    expect(Math.hypot(together.centreX, together.centreY)).toBeLessThan(STILL);
  });

  test('line and page deltas are read as pixels, not as pixels-worth-of-lines', () => {
    // Firefox reports a mouse wheel in LINES and a page scroll in PAGES.
    const lines = wheel(cameraHarness(), { deltaY: -4, deltaMode: 1 });
    const pixels = wheel(cameraHarness(), { deltaY: -64 });
    expect(lines.radiusRatio).toBeCloseTo(pixels.radiusRatio, 6);
    const pages = wheel(cameraHarness(), { deltaX: 1, deltaMode: 2 });
    const pagePixels = wheel(cameraHarness(), { deltaX: 600 });
    expect(pages.centreX).toBeCloseTo(pagePixels.centreX, 6);
  });

  test('a drag rotates the scene with the pointer, around a target that stays put', () => {
    const built = cameraHarness();
    const right = drag(built, { dx: 80, dy: 0 });
    // The near half of the turntable follows the pointer (OrbitControls
    // convention), while the target it spins around holds the screen centre.
    expect(right.nearX).toBeGreaterThan(STILL);
    expect(Math.hypot(right.centreX, right.centreY)).toBeLessThan(STILL);
    expect(right.radiusRatio).toBeCloseTo(1, 6);
    const left = drag(built, { dx: -80, dy: 0 });
    expect(left.nearX).toBeLessThan(-STILL);
  });

  test('a vertical drag tips the rig up and down without moving the target', () => {
    const built = cameraHarness();
    const beforeY = built.camera.position.y;
    const down = drag(built, { dx: 0, dy: 60 });
    // Dragging down raises the eye towards the overhead view, the convention
    // OrbitControls uses and the one this viewer keeps.
    expect(built.camera.position.y).toBeGreaterThan(beforeY);
    expect(Math.hypot(down.centreX, down.centreY)).toBeLessThan(STILL);
    expect(down.radiusRatio).toBeCloseTo(1, 6);
    drag(built, { dx: 0, dy: -60 });
    expect(built.camera.position.y).toBeCloseTo(beforeY, 4);
  });

  test('a shift-drag pans with the pointer on both axes', () => {
    const built = cameraHarness();
    const right = drag(built, { dx: 80, dy: 0, shiftKey: true });
    expect(right.centreX).toBeGreaterThan(STILL);
    expect(right.radiusRatio).toBeCloseTo(1, 6);
    const down = drag(built, { dx: 0, dy: 60, shiftKey: true });
    expect(down.centreY).toBeGreaterThan(STILL);
    expect(down.radiusRatio).toBeCloseTo(1, 6);
  });

  test('a right-button drag pans with the pointer', () => {
    const built = cameraHarness();
    const down = drag(built, { dx: 0, dy: 60, button: 2 });
    expect(down.centreY).toBeGreaterThan(STILL);
    const right = drag(built, { dx: 80, dy: 0, button: 2 });
    expect(right.centreX).toBeGreaterThan(STILL);
  });

  test('a drag with Space held pans like the right button, and without it rotates again', () => {
    const built = cameraHarness();
    const space = (type: string): void => fire(built.canvas, type, { key: ' ', target: built.canvas, preventDefault: () => undefined });
    space('keydown');
    const down = drag(built, { dx: 0, dy: 60 });
    expect(down.centreY).toBeGreaterThan(STILL);
    expect(down.radiusRatio).toBeCloseTo(1, 6);
    const right = drag(built, { dx: 80, dy: 0 });
    expect(right.centreX).toBeGreaterThan(STILL);
    space('keyup');
    const rotated = drag(built, { dx: 80, dy: 0 });
    expect(Math.hypot(rotated.centreX, rotated.centreY)).toBeLessThan(STILL);
    expect(rotated.nearX).toBeGreaterThan(STILL);
  });

  test('WASD and the arrows pan the model, and the page keeps no scroll for them', () => {
    const built = cameraHarness();
    /** Holds `key` for half a second of frames. */
    const hold = (key: string): Motion =>
      controllerMotion(built, () => {
        let prevented = 0;
        fire(built.canvas, 'keydown', {
          key,
          preventDefault: () => {
            prevented += 1;
          },
        });
        expect(prevented).toBe(1);
        for (let i = 0; i < 30; i += 1) built.controller.update(FRAME);
        fire(built.canvas, 'keyup', { key });
      });
    // W takes the view forward: the old centre comes down towards the viewer.
    const forward = hold('w');
    expect(forward.centreY).toBeGreaterThan(STILL);
    expect(forward.radiusRatio).toBeCloseTo(1, 6);
    // D goes right: the old centre slides left.
    expect(hold('d').centreX).toBeLessThan(-STILL);
    expect(hold('ArrowLeft').centreX).toBeGreaterThan(STILL);
    expect(hold('ArrowDown').centreY).toBeLessThan(-STILL);
  });

  test('a key let go (or focus lost) stops the key pan', () => {
    const built = cameraHarness();
    fire(built.canvas, 'keydown', { key: 'w', preventDefault: () => undefined });
    fire(built.canvas, 'blur', {});
    const still = controllerMotion(built, () => {
      for (let i = 0; i < 30; i += 1) built.controller.update(FRAME);
    });
    expect(Math.hypot(still.centreX, still.centreY)).toBeLessThan(STILL);
  });

  test('a two-pointer drag pans with the fingers', () => {
    const built = cameraHarness();
    const down = drag(built, { dx: 0, dy: 60, pointers: 2 });
    expect(down.centreY).toBeGreaterThan(STILL);
    const right = drag(built, { dx: 80, dy: 0, pointers: 2 });
    expect(right.centreX).toBeGreaterThan(STILL);
  });

  test('a two-pointer drag pans by the CENTROID, not once per finger', () => {
    // Two fingers moving together in LOCKSTEP, over many incremental
    // `pointermove` events (as real touch input fires, one event per finger),
    // must pan the same total distance as a one-pointer shift-drag of the same
    // travel — not ~2x it, which is what panning by each pointer's own `dx`/`dy`
    // would do.
    const built = cameraHarness();
    const STEPS = 20;
    const twoPointer = controllerMotion(built, () => {
      fire(built.canvas, 'pointerdown', { pointerId: 81, clientX: 400, clientY: 300, button: 0, shiftKey: false });
      fire(built.canvas, 'pointerdown', { pointerId: 82, clientX: 460, clientY: 300, button: 0, shiftKey: false });
      for (let s = 1; s <= STEPS; s += 1) {
        fire(built.canvas, 'pointermove', { pointerId: 81, clientX: 400 + (120 * s) / STEPS, clientY: 300, button: 0, shiftKey: false });
        fire(built.canvas, 'pointermove', { pointerId: 82, clientX: 460 + (120 * s) / STEPS, clientY: 300, button: 0, shiftKey: false });
      }
      fire(built.canvas, 'pointerup', { pointerId: 81 });
      fire(built.canvas, 'pointerup', { pointerId: 82 });
    });
    const onePointer = drag(built, { dx: 120, dy: 0, shiftKey: true });
    expect(twoPointer.centreX).toBeGreaterThan(STILL);
    expect(Math.abs(twoPointer.centreX / onePointer.centreX - 1)).toBeLessThan(0.05);
  });

  test('two fingers spreading zoom in, two fingers closing zoom out', () => {
    const built = cameraHarness();
    const apart = controllerMotion(built, () => {
      fire(built.canvas, 'pointerdown', { pointerId: 61, clientX: 380, clientY: 300, button: 0, shiftKey: false });
      fire(built.canvas, 'pointerdown', { pointerId: 62, clientX: 420, clientY: 300, button: 0, shiftKey: false });
      fire(built.canvas, 'pointermove', { pointerId: 61, clientX: 300, clientY: 300, button: 0, shiftKey: false });
      fire(built.canvas, 'pointermove', { pointerId: 62, clientX: 500, clientY: 300, button: 0, shiftKey: false });
      fire(built.canvas, 'pointerup', { pointerId: 61 });
      fire(built.canvas, 'pointerup', { pointerId: 62 });
    });
    expect(apart.radiusRatio).toBeLessThan(0.95);
  });

  test('a wheel still counts as manual input in every mode, and only 360 and walk take it from the page', () => {
    const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
    const canvas = fakeCanvas();
    let manual = 0;
    const controller = new CameraController(
      camera,
      canvas as unknown as HTMLCanvasElement,
      lShapePlan,
      solvePlan(lShapePlan),
      new Picker(canvas),
      {
        keys: canvas as unknown as HTMLElement,
        onManualInput: () => {
          manual += 1;
        },
        onHint: () => undefined,
      },
    );
    expect(controller.getMode()).toBe('orbit');
    let prevented = 0;
    const wheels = (): void => {
      for (const init of [{ deltaX: 40 }, { deltaY: -40 }, { deltaY: -40, ctrlKey: true }]) {
        fire(canvas, 'wheel', {
          deltaX: 0,
          deltaY: 0,
          deltaMode: 0,
          shiftKey: false,
          ctrlKey: false,
          preventDefault: () => {
            prevented += 1;
          },
          ...init,
        });
      }
    };
    wheels();
    expect(manual).toBe(3);
    expect(prevented).toBe(3);
    // Walk acts on the wheel too now (a step), so it is consumed there as well;
    // the tour leaves it to the page, and still hands the camera over.
    controller.setMode('walk');
    wheels();
    expect(manual).toBe(6);
    expect(prevented).toBe(6);
    controller.setMode('tour');
    wheels();
    expect(manual).toBe(9);
    expect(prevented).toBe(6);
  });
});
