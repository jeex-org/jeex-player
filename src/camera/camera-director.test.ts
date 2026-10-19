/**
 * Contract tests for the camera director: who drives the camera when a mode
 * button, a room focus or the tour button is pressed.
 *
 * The director is the seam where the controller's current pose becomes the
 * tour's lead-in leg, so it is driven here with a real `CameraController` and a
 * real `TourPlayer` over the L-shape fixture; only the UI and the dollhouse —
 * pure sinks from the director's side — are stubbed.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { draftOf } from '../shared/committed.js';
import * as THREE from 'three';
import { CameraController } from './camera-controller.js';
import { CameraDirector, type DirectorChrome } from './camera-director.js';
import { TourPlayer } from './tour-player.js';
import { GLIDE_SECONDS } from './pose-glide.js';
import { planViewPose } from './plan-view-pose.js';
import { fieldOfViewFor } from './camera-tuning.js';
import { Picker } from '../geometry/picker.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { DOOR_ANIMATION_MS, DoorStates, type DoorCentre } from '../doors/door-state.js';
import { DoorAnimator } from '../doors/door-animator.js';
import { pointAt } from '../plan/door-swing.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { SceneData } from '../scene/types.js';
import { isInDoorway, isNavigable } from '../navigation/navigation.js';
import { createMessages } from '../ui/messages.js';
import { fakeCanvas, fakeWindowHooks } from '../fixtures/stubs.js';

/** The director's own catalogue, so an assertion reads the copy the UI got. */
const { t } = createMessages('en');

/** Ids this file invents: tour cameras, a barricade placement and a room no scene has. */
const ID = {
  camA: '01a12ffa-7361-73f4-a29e-255c3833d947',
  camB: '01a12ffa-7362-7144-a925-7ff259bbcfd3',
  camC: '01a12ffa-7363-780f-9f7c-6927d0822417',
  camNear: '01a12ffa-7364-79d6-bf81-078629bacd15',
  barricade: '01a12ffa-7365-7eaf-9f6b-a0a750561a4f',
  unknownRoom: '01a12ffa-7366-74b5-91fd-afe32efcf31a',
};

/**
 * Bun has no `window`; some collaborators the controller drives (rig
 * capability probes) check for one before they decide what to do, and without
 * the stub every such path would take the "no window" branch.
 */
const fakeWindow = fakeWindowHooks();
beforeEach(fakeWindow.install);
afterEach(fakeWindow.restore);

function harness(options: { pauseOnInput?: boolean; scene?: SceneData; wireInput?: boolean } = {}) {
  const scene = options.scene ?? lShapePlan;
  const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
  const canvasStub = fakeCanvas();
  const canvas = canvasStub as unknown as HTMLCanvasElement;
  const plan = solvePlan(scene);
  const hints: string[] = [];
  const controller = new CameraController(camera, canvas, scene, plan, new Picker(canvas), {
    keys: canvas,
    // Manual input reaches the director only where a suite asks for it
    // (`wireInput`), as `mountCameraDirector` wires it.
    onManualInput: () => {
      if (options.wireInput) director.handleManualInput();
    },
    onCameraStep: (to) => (options.wireInput ? director.stepCamera(to) : false),
    onHint: (message) => {
      hints.push(message);
    },
  });
  const poses: Array<{ position: THREE.Vector3; target: THREE.Vector3 }> = [];
  const tour = new TourPlayer(
    scene,
    (position, target) => {
      poses.push({ position: position.clone(), target: target.clone() });
      controller.setPose(position, target);
    },
    { onState: () => undefined, onProgress: () => undefined },
  );
  const shell: string[] = [];
  const planModeCalls: string[] = [];
  const uiPlanModes: string[] = [];
  const modeButtons: string[] = [];
  const ui = {
    setTourState: () => undefined,
    setTourProgress: () => undefined,
    setHint: (message: string) => {
      hints.push(message);
    },
    setModeButtons: (mode: string) => {
      modeButtons.push(mode);
    },
    setPlanMode: (mode: string) => {
      uiPlanModes.push(mode);
    },
    wakeControls: () => undefined,
  } satisfies DirectorChrome;
  let keepExteriors = false;
  const dollhouse = {
    setState: (state: string) => {
      shell.push(state);
    },
    setKeepExteriors: (keep: boolean) => {
      keepExteriors = keep;
    },
  } as unknown as Dollhouse;
  // The plan-mode host as the composition root wires it: one call, and the
  // render camera plus the render switch follow from it (`plan-modes.ts`).
  const runtime = { camera: camera as THREE.Camera, renderEnabled: true };
  // Fitted like `plan-modes.ts` fits the L-shape at 4:3: straight down, north up.
  const top = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 100);
  top.up.set(0, 0, -1);
  top.position.set(5, 40, 4);
  top.lookAt(5, 0, 4);
  top.updateProjectionMatrix();
  let planMode = 'orbit';
  const planModes = {
    setMode(mode: string): void {
      planModeCalls.push(mode);
      planMode = mode;
      runtime.renderEnabled = mode !== 'plan2d';
      runtime.camera = mode === 'plan3d' ? top : camera;
    },
    viewPose() {
      return planMode === 'plan2d' || planMode === 'plan3d' ? planViewPose(top, camera.aspect) : null;
    },
  };
  const walkCameras: Array<{ index: number | null; count: number }> = [];
  const director = new CameraDirector({
    onWalkCamera: (reported) => walkCameras.push(reported),
    controller,
    tour,
    ui,
    dollhouse,
    planModes,
    messages: createMessages('en'),
    scene: () => scene,
    plan: () => plan,
    camera: () => camera,
    pauseOnInput: options.pauseOnInput,
  });
  return {
    director,
    walkCameras,
    controller,
    tour,
    camera,
    plan,
    scene,
    poses,
    shell,
    planModes,
    planModeCalls,
    uiPlanModes,
    runtime,
    top,
    hints,
    modeButtons,
    canvas: canvasStub,
    keepExteriors: () => keepExteriors,
  };
}

describe('hints are keys until the director speaks them', () => {
  test('the director turns a key into words with ITS catalogue, not a process-wide one', () => {
    const { director, hints } = harness();
    director.hint('hint.doorClosed');
    expect(hints.at(-1)).toBe('The door is closed · hover it to open');
  });

  test('setLocale reaches the camera stack: the next hint is in the new language', () => {
    const { director, hints } = harness();
    director.retranslate(createMessages('ru'));
    director.hint('hint.doorClosed');
    expect(hints.at(-1)).toBe('Дверь закрыта · наведите на неё, чтобы открыть');
  });

  test('two directors in two languages answer the same key differently at once', () => {
    const english = harness();
    const russian = harness();
    russian.director.retranslate(createMessages('ru'));
    english.director.hint('hint.arrivedInstantly', { name: 'Kitchen' });
    russian.director.hint('hint.arrivedInstantly', { name: 'Кухня' });
    expect(english.hints.at(-1)).toBe('Jumped to Kitchen');
    expect(russian.hints.at(-1)).toBe('Перенос в Кухня');
  });
});

describe('the tour button', () => {
  test('eases out of the view on screen instead of turning to face nothing', () => {
    // The lead-in pose must be read while the controller is still in orbit
    // mode. Read after `setMode('tour')` it fell through to the walk look
    // angles — 0/0 until walk mode seeds them — and the tour flew its whole
    // dive gazing 4 m due south of the camera, at empty sky.
    const { director, tour, poses } = harness();
    const start = lShapePlan.presentationCamera;
    const orbitTarget = new THREE.Vector3(start.target.x, start.target.y, start.target.z);
    const dueSouth = new THREE.Vector3(start.position.x, start.position.y, start.position.z + 4);

    director.toggleTour();
    tour.update(0.05);

    const first = poses[0]!;
    expect(first.position.distanceTo(new THREE.Vector3(start.position.x, start.position.y, start.position.z))).toBeLessThan(0.3);
    expect(first.target.distanceTo(orbitTarget)).toBeLessThan(0.3);
    expect(first.target.distanceTo(dueSouth)).toBeGreaterThan(1);
  });

  test('the fly-in from the presentation view is a dive, not a crawl', () => {
    // Without a zone of its own the lead-in inherited the FIRST authored zone —
    // the slowest, indoor one — and a twenty-metre approach took half a minute.
    const { director, tour } = harness();
    const start = lShapePlan.presentationCamera;
    const approach = new THREE.Vector3(start.position.x, start.position.y, start.position.z).distanceTo(
      new THREE.Vector3(lShapePlan.autotour.path[0]!.x, lShapePlan.autotour.path[0]!.y, lShapePlan.autotour.path[0]!.z),
    );

    const standing = tour.getDuration();
    director.toggleTour();
    const withLead = tour.getDuration();
    // The extra time the lead-in costs, against walking the same metres.
    expect(withLead - standing).toBeLessThan(approach / (lShapePlan.autotour.speed ?? 1.4));
  });

  test('a second press pauses the run and leaves it resumable', () => {
    const { director, tour } = harness();
    director.toggleTour();
    tour.update(0.5);
    expect(tour.getState()).toBe('playing');
    director.toggleTour();
    expect(tour.getState()).toBe('paused');
    director.toggleTour();
    expect(tour.getState()).toBe('playing');
  });

  test('playback runs against the dollhouse shell', () => {
    const { director, shell } = harness();
    director.toggleTour();
    expect(shell.at(-1)).toBe('dollhouse');
  });
});

describe('engageTour', () => {
  test('puts the camera in tour mode without starting or pausing playback', () => {
    const { director, controller, tour } = harness();
    const from = director.engageTour();
    expect(controller.getMode()).toBe('tour');
    expect(tour.getState()).toBe('ready');
    expect(from).not.toBeNull();

    // A running clip survives a second engage: an external `seek` must not
    // pause the run it is scrubbing.
    tour.play();
    director.engageTour();
    expect(tour.getState()).toBe('playing');
  });

  test('answers with the pose to fly in from, and with null once engaged', () => {
    const { director, controller } = harness();
    const pose = controller.getPose();
    const from = director.engageTour();
    expect(from!.position.distanceTo(pose.position)).toBeLessThan(1e-6);
    // Already in tour mode: there is no outside view left to ease out of.
    expect(director.engageTour()).toBeNull();
  });

  test('the mode buttons still pause the tour, unlike engageTour', () => {
    const { director, tour } = harness();
    director.toggleTour();
    expect(tour.getState()).toBe('playing');
    director.setMode('orbit');
    expect(tour.getState()).toBe('paused');
  });
});

describe('the tour opens the doors on its route (doors.autoOpen: false)', () => {
  /**
   * The fixture's autotour walks (3, 4) -> (6, 2.5) -> (8, 2.5), i.e. straight
   * through the partition door `doorAb`. Door centres come from the plan rather than from built
   * geometry: the auto-open test is about metres, not meshes.
   */
  function doorCentres(): DoorCentre[] {
    const wall = lShapePlan.walls.find((candidate) => candidate.id === L_SHAPE.wall.wPart)!;
    return (wall.openings ?? []).map((opening) => {
      const { point } = pointAt(lShapePlan, wall, opening.center);
      return { id: opening.id, center: { x: point.x, y: 1.05, z: point.z } };
    });
  }

  function doorHarness() {
    const base = harness();
    const centres = doorCentres();
    const states = new DoorStates(centres.map((door) => door.id));
    const animator = new DoorAnimator({
      states,
      // No geometry in this harness: the leaves have their own tests.
      group: () => null,
      doors: () => centres,
      camera: () => base.camera,
      scriptedCamera: () => base.controller.getMode() === 'tour' || base.controller.isTravelling(),
    });
    return { ...base, states, animator, centre: centres[0]!.center };
  }

  test('a closed door on the route is open by the time the camera reaches it', () => {
    const { director, tour, camera, states, animator, centre } = doorHarness();
    states.close(L_SHAPE.opening.doorAb, 0);
    animator.update(DOOR_ANIMATION_MS);
    expect(states.get(L_SHAPE.opening.doorAb)!.phase).toBe('closed');

    director.toggleTour();
    let closest = Number.POSITIVE_INFINITY;
    let phaseWhenClose: string | null = null;
    for (let frame = 1; frame <= 2400; frame += 1) {
      tour.update(1 / 60);
      const now = DOOR_ANIMATION_MS + (frame * 1000) / 60;
      animator.update(now);
      const distance = Math.hypot(camera.position.x - centre.x, camera.position.z - centre.z);
      closest = Math.min(closest, distance);
      if (distance < 1 && phaseWhenClose === null) phaseWhenClose = states.get(L_SHAPE.opening.doorAb)!.phase;
    }
    expect(closest).toBeLessThan(1);
    expect(phaseWhenClose).not.toBeNull();
    expect(phaseWhenClose).not.toBe('closed');
    // And it is left open behind the camera, never shut again.
    expect(states.get(L_SHAPE.opening.doorAb)!.phase).toBe('open');
  });

  test('outside the tour the same approach leaves the door shut', () => {
    const { controller, camera, states, animator, centre } = doorHarness();
    states.close(L_SHAPE.opening.doorAb, 0);
    animator.update(DOOR_ANIMATION_MS);
    controller.setMode('walk');
    camera.position.set(centre.x - 0.4, 1.65, centre.z);
    camera.lookAt(centre.x, 1.65, centre.z);
    camera.updateMatrixWorld(true);
    animator.update(DOOR_ANIMATION_MS + 16);
    expect(states.get(L_SHAPE.opening.doorAb)!.phase).toBe('closed');
  });
});

describe('the tour walks through a rest-closed door and leaves it shut behind', () => {
  function doorCentres(): DoorCentre[] {
    const wall = lShapePlan.walls.find((candidate) => candidate.id === L_SHAPE.wall.wPart)!;
    return (wall.openings ?? []).map((opening) => {
      const { point } = pointAt(lShapePlan, wall, opening.center);
      return { id: opening.id, center: { x: point.x, y: 1.05, z: point.z } };
    });
  }

  test('open before the camera is a metre away, shut again three metres past it', () => {
    const base = harness();
    const centres = doorCentres();
    const states = new DoorStates(centres.map((door) => door.id));
    const animator = new DoorAnimator({
      states,
      group: () => null,
      doors: () => centres,
      camera: () => base.camera,
      scriptedCamera: () => base.controller.getMode() === 'tour' || base.controller.isTravelling(),
      // The composition root's rule with `doors.autoOpen` on.
      autoOpen: () => true,
      walkerCamera: () => ['walk', 'tour'].includes(base.controller.getMode()),
    });
    const centre = centres[0]!.center;
    states.close(L_SHAPE.opening.doorAb, 0);
    animator.update(DOOR_ANIMATION_MS);
    expect(states.get(L_SHAPE.opening.doorAb)!.phase).toBe('closed');

    base.director.toggleTour();
    let now = DOOR_ANIMATION_MS;
    let phaseAtOneMetre: string | null = null;
    for (let frame = 1; frame <= 2400; frame += 1) {
      base.tour.update(1 / 60);
      now = DOOR_ANIMATION_MS + (frame * 1000) / 60;
      animator.update(now);
      const distance = Math.hypot(base.camera.position.x - centre.x, base.camera.position.z - centre.z);
      if (distance < 1 && phaseAtOneMetre === null) phaseAtOneMetre = states.get(L_SHAPE.opening.doorAb)!.phase;
    }
    expect(phaseAtOneMetre).not.toBeNull();
    expect(['opening', 'open']).toContain(phaseAtOneMetre!);
    expect(states.get(L_SHAPE.opening.doorAb)).toMatchObject({ rest: 'closed', auto: true });

    // The fixture's route ends 2 m past the door, inside the close radius, so
    // the camera is walked the last metre by hand: the leaf follows the eye.
    base.camera.position.set(centre.x + 3, 1.65, centre.z);
    base.camera.lookAt(centre.x + 4, 1.65, centre.z);
    base.camera.updateMatrixWorld(true);
    animator.update((now += 16));
    expect(states.get(L_SHAPE.opening.doorAb)!.phase).toBe('closing');
    animator.update(now + DOOR_ANIMATION_MS);
    expect(states.get(L_SHAPE.opening.doorAb)).toMatchObject({ phase: 'closed', rest: 'closed', auto: false, armed: true });
  });
});

describe('pauseOnInput', () => {
  test('by default scene input pauses the run and hands the camera over', () => {
    const { director, controller, tour } = harness();
    director.toggleTour();
    director.handleManualInput();
    expect(tour.getState()).toBe('paused');
    expect(controller.getMode()).toBe('orbit');
  });

  test('false makes input a no-op while the tour is engaged', () => {
    // A scroll-driven embed owns the camera: a wheel event over the canvas must
    // not wrestle it away from the page's own scroll handler.
    const { director, controller, tour } = harness({ pauseOnInput: false });
    director.toggleTour();
    director.handleManualInput();
    expect(tour.getState()).toBe('playing');
    expect(controller.getMode()).toBe('tour');
  });

  test('a grab that hands the tour over tells the chrome it left the tour', () => {
    // The tour chrome is on screen only in `tour`; the chrome learns the mode
    // from `setPlanMode`, so a hand-over that skipped it left the bar standing.
    const { director, tour, uiPlanModes } = harness();
    director.toggleTour();
    director.handleManualInput();
    expect(tour.getState()).toBe('paused');
    expect(uiPlanModes.at(-1)).toBe('orbit');
  });

  test('false still hands over when the tour was never engaged', () => {
    const { director, controller } = harness({ pauseOnInput: false });
    director.setMode('walk');
    director.handleManualInput();
    expect(controller.getMode()).toBe('walk');
  });
});

describe('setMotion (reduced motion)', () => {
  test('forwards to the controller: focusRoom lands the camera in one call under instant motion', () => {
    const { director, controller, camera } = harness();
    director.setMotion(true);
    expect(director.focusRoom(L_SHAPE.room.b)).toBe(true);
    const afterFirstFrame = camera.position.clone();
    controller.update(1 / 60);
    expect(camera.position.distanceTo(afterFirstFrame)).toBeLessThan(1e-6);
  });

  test('off by default: focusRoom still animates, the camera is not yet at rest after one frame', () => {
    const { director, controller, camera } = harness();
    expect(director.focusRoom(L_SHAPE.room.b)).toBe(true);
    const start = camera.position.clone();
    controller.update(1 / 60);
    expect(camera.position.distanceTo(start)).toBeGreaterThan(1e-6);
  });
});

describe('the plan modes', () => {
  test('setMode("plan3d") installs an orthographic camera looking straight down, north up', () => {
    const { director, runtime, top, keepExteriors, shell } = harness();

    director.setMode('plan3d');

    expect(runtime.camera).toBe(top);
    expect(runtime.camera).toBeInstanceOf(THREE.OrthographicCamera);
    const forward = new THREE.Vector3();
    top.getWorldDirection(forward);
    expect(forward.x).toBeCloseTo(0, 6);
    expect(forward.y).toBeCloseTo(-1, 6);
    expect(forward.z).toBeCloseTo(0, 6);
    // North (-Z) is up on screen, so the camera's own up axis is -Z.
    expect(top.up.z).toBeCloseTo(-1, 6);
    // Ceilings off, every exterior wall kept: nothing hides anything from above.
    expect(shell.at(-1)).toBe('dollhouse');
    expect(keepExteriors()).toBe(true);
  });

  test('a plan mode takes every input away from the rig', () => {
    const { director, controller, camera } = harness();
    const before = camera.position.clone();

    director.setMode('plan3d');
    controller.update(0.2);
    // Pointer, wheel and keys are all inert while a plan mode is on.
    expect(controller.getMode()).toBe('plan3d');
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);

    director.setMode('plan2d');
    controller.update(0.2);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);
  });

  test('setMode("plan2d") switches the render loop off and shows the overlay', () => {
    const { director, runtime, camera, planModeCalls } = harness();

    director.setMode('plan2d');
    expect(runtime.renderEnabled).toBe(false);
    expect(planModeCalls).toContain('plan2d');
    // The perspective camera stays installed under the opaque overlay.
    expect(runtime.camera).toBe(camera);

    director.setMode('orbit');
    expect(runtime.renderEnabled).toBe(true);
  });

  test('returning to 360 restores the perspective camera and the orbit pose', () => {
    const { director, controller, camera, runtime, keepExteriors } = harness();
    director.setMode('orbit');
    controller.update(0.1);
    const pose = controller.getPose();

    director.setMode('plan3d');
    director.setMode('orbit');
    controller.update(0.1);

    expect(runtime.camera).toBe(camera);
    expect(keepExteriors()).toBe(false);
    expect(controller.getMode()).toBe('orbit');
    expect(controller.getPose().position.distanceTo(pose.position)).toBeLessThan(1e-6);
    expect(controller.getPose().target.distanceTo(pose.target)).toBeLessThan(1e-6);
  });

  test('a walk pose survives a detour through the drawing', () => {
    const { director, controller, camera } = harness();
    director.setMode('walk');
    controller.update(0.1);
    const walkAt = camera.position.clone();

    director.setMode('plan2d');
    director.setMode('walk');
    controller.update(0.1);

    expect(controller.getMode()).toBe('walk');
    expect(camera.position.distanceTo(walkAt)).toBeLessThan(1e-6);
  });

  test('the tour button and a reset both leave the plan modes behind', () => {
    const { director, planModeCalls, uiPlanModes, runtime } = harness();
    director.setMode('plan2d');
    director.toggleTour();
    expect(planModeCalls.at(-1)).toBe('tour');
    expect(uiPlanModes.at(-1)).toBe('tour');
    expect(runtime.renderEnabled).toBe(true);

    director.setMode('plan3d');
    director.reset();
    expect(planModeCalls.at(-1)).toBe('orbit');
    expect(runtime.renderEnabled).toBe(true);
  });
});

describe('travelToRoom: what a mini-map click does in each mode', () => {
  const FRAME = 1 / 60;

  /** Runs frames until the scripted route ends, or `frames` have gone by. */
  function settle(controller: CameraController, frames = 2400): void {
    for (let i = 0; i < frames && controller.isTravelling(); i += 1) controller.update(FRAME);
  }

  test('in walk mode the camera WALKS to the room, through the doorway', () => {
    const { director, controller, camera } = harness();
    director.setMode('walk');
    camera.position.set(3, 1.65, 4);
    const route = director.routeToRoom(L_SHAPE.room.b);
    expect(route).not.toBeNull();
    expect(route!.length).toBeGreaterThan(2);

    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.isTravelling()).toBe(true);
    settle(controller);
    const end = route!.at(-1)!;
    expect(Math.hypot(camera.position.x - end.x, camera.position.z - end.z)).toBeLessThan(0.6);
    expect(controller.getMode()).toBe('walk');
  });

  test('travelPath reports the curve without moving anything', () => {
    const { director, controller, camera } = harness();
    director.setMode('walk');
    camera.position.set(3, 1.65, 4);
    const before = camera.position.clone();
    const route = director.routeToRoom(L_SHAPE.room.b)!;
    let polyline = 0;
    for (let i = 1; i < route.length; i += 1) polyline += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.z - route[i - 1]!.z);

    const path = director.travelPath(L_SHAPE.room.b)!;
    expect(path).not.toBeNull();
    expect(path.points.length).toBeGreaterThan(20);
    // Rounding and string-pulling shorten the polyline; they never lengthen it.
    expect(path.length).toBeLessThanOrEqual(polyline + 1e-6);
    expect(path.length).toBeGreaterThan(polyline * 0.85);
    expect(camera.position.distanceTo(before)).toBe(0);
    expect(controller.isTravelling()).toBe(false);
    expect(director.travelPath(ID.unknownRoom)).toBeNull();
  });

  test('the walk is continuous: no leg is a jump', () => {
    const { director, controller, camera } = harness();
    director.setMode('walk');
    camera.position.set(3, 1.65, 4);
    director.travelToRoom(L_SHAPE.room.b);
    let previous = camera.position.clone();
    let longest = 0;
    for (let i = 0; i < 2400 && controller.isTravelling(); i += 1) {
      controller.update(FRAME);
      longest = Math.max(longest, camera.position.distanceTo(previous));
      previous = camera.position.clone();
    }
    expect(longest).toBeLessThan(0.25);
  });

  test('in tour mode the run is paused, walk takes over, and the camera travels', () => {
    const { director, controller, tour, modeButtons } = harness();
    director.toggleTour();
    tour.update(0.5);
    expect(tour.getState()).toBe('playing');

    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(tour.getState()).toBe('paused');
    expect(controller.getMode()).toBe('walk');
    expect(modeButtons.at(-1)).toBe('walk');
    expect(controller.isTravelling()).toBe(true);
  });

  test('in 360 the room is flown to, exactly as a room focus', () => {
    const { director, controller } = harness();
    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.getMode()).toBe('orbit');
    expect(controller.isTravelling()).toBe(false);
  });

  test('in a plan mode the room is flown to as well', () => {
    const { director, controller } = harness();
    director.setMode('plan2d');
    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.getMode()).toBe('orbit');
  });

  test('clicking the room you already stand in does not route, and hints it', () => {
    const { director, controller, camera, hints } = harness();
    director.setMode('walk');
    camera.position.set(3, 1.65, 4); // room A's anchor: inside room A
    expect(director.travelToRoom(L_SHAPE.room.a)).toBe(true);
    expect(controller.isTravelling()).toBe(false);
    expect(hints.at(-1)).toBe(t('hint.alreadyHere', { name: 'Room A' }));
    expect(controller.getMode()).toBe('walk');
  });

  test('clicking a DIFFERENT room from the one you stand in still routes there', () => {
    const { director, controller, camera } = harness();
    director.setMode('walk');
    camera.position.set(3, 1.65, 4); // inside room A
    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.isTravelling()).toBe(true);
  });

  test('the already-here click still applies after a tour click switches to walk', () => {
    const { director, controller, camera, tour, hints } = harness();
    // Standing in room A's spot before the tour engages, so the pose the tour
    // hands to walk when it pauses is inside room A.
    camera.position.set(3, 1.65, 4);
    director.toggleTour();
    tour.update(0.001);
    controller.setPose(new THREE.Vector3(3, 1.65, 4), new THREE.Vector3(3.2, 1.2, 3));

    expect(director.travelToRoom(L_SHAPE.room.a)).toBe(true);
    expect(controller.getMode()).toBe('walk');
    expect(controller.isTravelling()).toBe(false);
    expect(hints.at(-1)).toBe(t('hint.alreadyHere', { name: 'Room A' }));
  });

  test('a room the scene does not have is refused, not travelled to', () => {
    const { director, controller } = harness();
    director.setMode('walk');
    expect(director.travelToRoom(ID.unknownRoom)).toBe(false);
    expect(controller.isTravelling()).toBe(false);
  });

  test('no clear path falls back to the fly-in and says so', () => {
    // A slab of furniture over the doorway: no leg of any route gets through.
    const blocked = draftOf(lShapePlan);
    blocked.assets.push({
      id: ID.barricade,
      type: 'wardrobe',
      position: { x: 6, y: 0, z: 2.5 },
      collision: { hx: 2.4, hz: 1.6 },
      material: FINISH.plaster_white,
    });
    const { director, controller, camera, hints } = harness({ scene: blocked });
    director.setMode('walk');
    camera.position.set(3, 1.65, 6);
    expect(director.routeToRoom(L_SHAPE.room.b)).toBeNull();

    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.isTravelling()).toBe(false);
    expect(hints.at(-1)).toBe(t('hint.noClearPath'));
    // `flyToRoom` is an orbit move: the fallback says which room, in 360.
    expect(controller.getMode()).toBe('orbit');
  });

  test('the route respects the furniture only while the walker collides with it', () => {
    const blocked = draftOf(lShapePlan);
    blocked.assets.push({
      id: ID.barricade,
      type: 'wardrobe',
      position: { x: 6, y: 0, z: 2.5 },
      collision: { hx: 2.4, hz: 1.6 },
      material: FINISH.plaster_white,
    });
    const { director, controller, camera } = harness({ scene: blocked });
    director.setMode('walk');
    camera.position.set(3, 1.65, 6);
    expect(director.routeToRoom(L_SHAPE.room.b)).toBeNull();
    // Furniture hidden: it no longer blocks the walker, so it may not block the route.
    controller.setFurnitureCollision(false);
    expect(director.routeToRoom(L_SHAPE.room.b)).not.toBeNull();
  });
});

describe('a second click on the same room while travelling: instant arrival', () => {
  const FRAME = 1 / 60;

  function settle(controller: CameraController, frames = 2400): void {
    for (let i = 0; i < frames && controller.isTravelling(); i += 1) controller.update(FRAME);
  }

  test('the same room again finishes the route instantly and hints it', () => {
    const { director, controller, camera, hints } = harness();
    director.setMode('walk');
    camera.position.set(3, 1.65, 4);
    const path = director.travelPath(L_SHAPE.room.b)!;
    const end = path.points.at(-1)!;

    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.isTravelling()).toBe(true);
    controller.update(FRAME);
    // A single 60 Hz frame in has not reached a goal several metres away.
    expect(Math.hypot(camera.position.x - end.x, camera.position.z - end.z)).toBeGreaterThan(0.05);

    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.isTravelling()).toBe(false);
    expect(Math.hypot(camera.position.x - end.x, camera.position.z - end.z)).toBeLessThan(0.01);
    expect(hints.at(-1)).toBe(t('hint.arrivedInstantly', { name: 'Room B' }));
    expect(controller.getMode()).toBe('walk');
  });

  test('a different room during travel replaces the route instead of finishing it', () => {
    const { director, controller, camera } = harness();
    director.setMode('walk');
    camera.position.set(3, 1.65, 4);
    const pathToB = director.travelPath(L_SHAPE.room.b)!;
    const endOfB = pathToB.points.at(-1)!;

    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    // A full second in, well clear of the start, so the route BACK to room A
    // is a real one and not a merged no-op.
    for (let i = 0; i < 60; i += 1) controller.update(FRAME);
    const midway = camera.position.clone();

    expect(director.travelToRoom(L_SHAPE.room.a)).toBe(true);
    expect(controller.isTravelling()).toBe(true);
    // The route was replaced, not finished on the spot: the camera is still
    // near where the first leg left it, nowhere near room B's centre.
    expect(camera.position.distanceTo(midway)).toBeLessThan(0.5);
    expect(Math.hypot(camera.position.x - endOfB.x, camera.position.z - endOfB.z)).toBeGreaterThan(0.5);
  });

  test('travellingTo does not linger after a route ends normally', () => {
    const { director, controller, camera } = harness();
    director.setMode('walk');
    camera.position.set(3, 1.65, 4);
    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    settle(controller);
    expect(controller.isTravelling()).toBe(false);

    // A brand new travel, this time to room A.
    expect(director.travelToRoom(L_SHAPE.room.a)).toBe(true);
    expect(controller.isTravelling()).toBe(true);
    controller.update(FRAME);
    const midway = camera.position.clone();

    // A click on the room the PREVIOUS travel went to must not finish
    // today's route: `travellingTo` tracks the current one, not history.
    expect(director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(controller.isTravelling()).toBe(true);
    expect(camera.position.distanceTo(midway)).toBeLessThan(0.5);
  });
});

describe('every way a travel is taken away from the director', () => {
  const FRAME = 1 / 60;

  /** A capturing `window`, in place before the controller subscribes to it. */
  /**
   * A director a quarter of a second into a travel to room B, with the
   * director's OWN `onDone` counted: it is the callback that clears
   * `travellingTo`, so "fired exactly once" and "the director forgot the room"
   * are the same statement.
   */
  function travelling() {
    const built = harness();
    // Keys go to the CANVAS here, not to `window`: the harness passes the
    // canvas itself as its own key target, matching a real page where a canvas
    // outside a shell root is its own key target too.
    const fire = (type: string, event: unknown): void => {
      for (const handler of [...(built.canvas.listeners.get(type) ?? [])]) handler(event);
    };
    const controller = built.controller;
    const walkAlong = controller.walkAlong.bind(controller);
    let done = 0;
    controller.walkAlong = (points, onDone) =>
      walkAlong(points, () => {
        done += 1;
        onDone?.();
      });
    built.director.setMode('walk');
    built.camera.position.set(3, 1.65, 4);
    expect(built.director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    for (let i = 0; i < 15; i += 1) controller.update(FRAME);
    expect(controller.isTravelling()).toBe(true);
    expect(done).toBe(0);
    return { ...built, fire, done: () => done };
  }

  function fireCanvas(built: ReturnType<typeof travelling>, type: string, event: unknown): void {
    for (const handler of built.canvas.listeners.get(type) ?? []) handler(event);
  }

  /** Every input runs the same way out: the route ends, once, and stays ended. */
  function expectEnded(built: ReturnType<typeof travelling>): void {
    expect(built.controller.isTravelling()).toBe(false);
    expect(built.done()).toBe(1);
    for (let i = 0; i < 60; i += 1) built.controller.update(FRAME);
    expect(built.done()).toBe(1);
    // And the director is free again: the same room is a fresh WALK, not the
    // instant arrival a `travellingTo` left standing would have made of it.
    built.director.setMode('walk');
    expect(built.director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(built.controller.isTravelling()).toBe(true);
    expect(built.hints.at(-1)).toBe(t('hint.travelling', { name: 'Room B' }));
  }

  test('a pointerdown on the scene ends it', () => {
    const built = travelling();
    fireCanvas(built, 'pointerdown', { pointerId: 3, clientX: 400, clientY: 300, button: 0 });
    expectEnded(built);
  });

  test('a wheel ends it, and is a step of its own: the walker glides on from where the route stopped', () => {
    const built = travelling();
    let prevented = 0;
    fireCanvas(built, 'wheel', {
      deltaX: 0,
      deltaY: -120,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
      preventDefault: () => {
        prevented += 1;
      },
    });
    // The route is over at once; what moves the camera now is the wheel step.
    expect(built.controller.isTravelling()).toBe(false);
    const stopped = built.camera.position.clone();
    for (let i = 0; i < 30; i += 1) built.controller.update(FRAME);
    expect(built.camera.position.distanceTo(stopped)).toBeGreaterThan(0.1);
    expect(prevented).toBe(1);
    expectEnded(built);
  });

  test('a WASD key ends it', () => {
    const built = travelling();
    built.fire('keydown', { key: 'w', preventDefault: () => undefined });
    expectEnded(built);
  });

  test('a switch to a plan mode ends it', () => {
    const built = travelling();
    built.director.setMode('plan2d');
    expectEnded(built);
  });

  test('a furniture-only commit ends it', () => {
    const built = travelling();
    built.controller.refreshObstacles(built.scene);
    expectEnded(built);
  });
});

describe('a scripted route opens the doors on its way', () => {
  const FRAME = 1 / 60;

  function doorCentres(): DoorCentre[] {
    const wall = lShapePlan.walls.find((candidate) => candidate.id === L_SHAPE.wall.wPart)!;
    return (wall.openings ?? []).map((opening) => {
      const { point } = pointAt(lShapePlan, wall, opening.center);
      return { id: opening.id, center: { x: point.x, y: 1.05, z: point.z } };
    });
  }

  test('a closed door on a mini-map route is open by the time the camera reaches it', () => {
    const base = harness();
    const centres = doorCentres();
    const states = new DoorStates(centres.map((door) => door.id));
    const animator = new DoorAnimator({
      states,
      group: () => null,
      doors: () => centres,
      camera: () => base.camera,
      // Exactly the composition root's rule: the tour, or a scripted walk.
      scriptedCamera: () => base.controller.getMode() === 'tour' || base.controller.isTravelling(),
    });
    // The controller refuses to cross a shut door, so the route must open it.
    base.controller.setMode('walk');
    base.camera.position.set(3, 1.65, 4);
    states.close(L_SHAPE.opening.doorAb, 0);
    animator.update(DOOR_ANIMATION_MS);
    expect(states.get(L_SHAPE.opening.doorAb)!.phase).toBe('closed');

    expect(base.director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    const centre = centres[0]!.center;
    let phaseWhenClose: string | null = null;
    for (let frame = 1; frame <= 2400 && base.controller.isTravelling(); frame += 1) {
      base.controller.update(FRAME);
      animator.update(DOOR_ANIMATION_MS + (frame * 1000) / 60);
      const distance = Math.hypot(base.camera.position.x - centre.x, base.camera.position.z - centre.z);
      if (distance < 1 && phaseWhenClose === null) phaseWhenClose = states.get(L_SHAPE.opening.doorAb)!.phase;
    }
    expect(phaseWhenClose).not.toBeNull();
    expect(phaseWhenClose).not.toBe('closed');
    expect(states.get(L_SHAPE.opening.doorAb)!.phase).toBe('open');
    // And it arrived: a stalled route would have timed out short of room B.
    expect(base.camera.position.x).toBeGreaterThan(6.2);
  });
});

describe('walk is the user-driven tour', () => {
  /** Two cameras in room A, one in room B behind the partition door. */
  const cameras = [
    { id: ID.camA, position: { x: 3, y: 1.6, z: 4 }, yaw: Math.PI / 2, pitch: -0.1 },
    { id: ID.camB, position: { x: 8, y: 1.6, z: 2.5 }, yaw: 0, pitch: 0.05 },
    { id: ID.camC, position: { x: 2, y: 1.5, z: 6.5 }, yaw: Math.PI, pitch: 0 },
  ];
  const withCameras: SceneData = { ...lShapePlan, tourCheckpoints: cameras };
  const first = new THREE.Vector3(3, 1.6, 4);

  /** Runs `seconds` of frames the way the stage does: the controller, then the director's walk step. */
  function run(h: ReturnType<typeof harness>, seconds: number): void {
    for (let clock = 0; clock < seconds; clock += 1 / 60) {
      h.controller.update(1 / 60);
      h.director.updateTour(1 / 60);
    }
  }

  /** Runs frames until the walk stops moving the camera on its own (bounded). */
  function settle(h: ReturnType<typeof harness>): void {
    let last = h.camera.position.clone();
    let still = 0;
    for (let frame = 0; frame < 60 * 60 && still < 30; frame += 1) {
      run(h, 1 / 60);
      still = h.camera.position.distanceTo(last) < 1e-9 ? still + 1 : 0;
      last = h.camera.position.clone();
    }
  }

  /** Whether the camera stands on `camera`'s exact pose: its place, its yaw and its pitch. */
  function standsOn(h: ReturnType<typeof harness>, camera: (typeof cameras)[number]): void {
    expect(h.camera.position.distanceTo(new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z))).toBeLessThan(1e-6);
    const look = h.camera.getWorldDirection(new THREE.Vector3());
    expect(Math.atan2(Math.sin(Math.atan2(look.x, look.z) - camera.yaw), Math.cos(Math.atan2(look.x, look.z) - camera.yaw))).toBeCloseTo(
      0,
      4,
    );
    expect(Math.asin(look.y)).toBeCloseTo(camera.pitch, 4);
  }

  function entered(): ReturnType<typeof harness> {
    const h = harness({ scene: withCameras, wireInput: true });
    h.director.setMode('walk');
    settle(h);
    return h;
  }

  test('entering walk glides to camera 1 in about a second and STOPS there, on its exact pose', () => {
    const h = harness({ scene: withCameras });
    h.director.setMode('walk');
    run(h, GLIDE_SECONDS / 2);
    // Half way through the glide: neither where it started nor on camera 1.
    expect(h.camera.position.distanceTo(first)).toBeGreaterThan(0.1);
    run(h, GLIDE_SECONDS / 2 + 2 / 60);
    standsOn(h, cameras[0]!);
    // Nothing rides on: two more seconds and the walker still stands there.
    run(h, 2);
    standsOn(h, cameras[0]!);
    expect(h.controller.getMode()).toBe('walk');
    expect(h.director.walkCamera()).toEqual({ index: 0, count: 3 });
    expect(h.walkCameras).toEqual([{ index: 0, count: 3 }]);
  });

  test('the walk hint names the camera keys on the first frame of a walk with cameras, and only there', () => {
    const h = harness({ scene: withCameras });
    h.director.setMode('walk');
    expect(h.hints).not.toContain(t('hint.walkCameras'));
    run(h, 1 / 60);
    expect(h.hints.at(-1)).toBe(t('hint.walkCameras'));
    const plain = harness();
    plain.director.setMode('walk');
    run(plain, 0.5);
    expect(plain.hints).not.toContain(t('hint.walkCameras'));
  });

  test('under reduced motion the entry is a cut to camera 1', () => {
    const h = harness({ scene: withCameras });
    h.director.setMotion(true);
    h.director.setMode('walk');
    run(h, 1 / 60);
    standsOn(h, cameras[0]!);
  });

  test('a step walks the leg to the next camera through the door, on walkable ground, and stops on its pose', () => {
    const h = entered();
    expect(h.director.stepCamera('next')).toBe(true);
    const ridden: THREE.Vector3[] = [];
    for (let frame = 0; frame < 60 * 30 && h.director.walkCamera().index !== 1; frame += 1) {
      run(h, 1 / 60);
      ridden.push(h.camera.position.clone());
    }
    standsOn(h, cameras[1]!);
    expect(h.director.walkCamera()).toEqual({ index: 1, count: 3 });
    // Walked, not cut: many frames, every one on the floor or in a doorway.
    expect(ridden.length).toBeGreaterThan(60);
    for (const point of ridden) expect(isNavigable(h.plan, point) || isInDoorway(h.plan, point)).toBe(true);
  });

  test('previous, first and last go where they say; the ends refuse and keep the walker', () => {
    const h = entered();
    expect(h.director.stepCamera('previous')).toBe(false);
    expect(h.director.stepCamera('last')).toBe(true);
    settle(h);
    standsOn(h, cameras[2]!);
    expect(h.director.stepCamera('next')).toBe(false);
    expect(h.director.stepCamera(7)).toBe(false);
    expect(h.director.stepCamera('first')).toBe(true);
    settle(h);
    standsOn(h, cameras[0]!);
    expect(h.walkCameras.map((camera) => camera.index)).toEqual([0, 2, 0]);
  });

  test('a manual input cancels a step where it stands; the current camera stays, so «next» aims at the same camera again', () => {
    const h = entered();
    h.director.stepCamera('next');
    run(h, 1);
    const standing = h.camera.position.clone();
    expect(standing.distanceTo(first)).toBeGreaterThan(0.2);
    h.director.handleManualInput();
    run(h, 1);
    expect(h.camera.position.distanceTo(standing)).toBeLessThan(1e-6);
    expect(h.director.walkCamera().index).toBe(0);
    expect(h.director.stepCamera('next')).toBe(true);
    settle(h);
    standsOn(h, cameras[1]!);
  });

  test('a step to the camera the walker stands on, looking its way, is over at once; one turned away turns back onto it', () => {
    const h = entered();
    expect(h.director.stepCamera('first')).toBe(true);
    // Nothing in flight: a manual input has nothing to cancel, and the pose did not move.
    run(h, 1 / 60);
    standsOn(h, cameras[0]!);
    h.controller.setPose(h.camera.position.clone(), h.camera.position.clone().add(new THREE.Vector3(0, 0, -1)));
    h.director.stepCamera('first');
    run(h, GLIDE_SECONDS + 2 / 60);
    standsOn(h, cameras[0]!);
  });

  test('asking for the camera a step already goes to does not restart it (an auto-repeating key)', () => {
    const h = entered();
    h.director.stepCamera('next');
    run(h, 1);
    const travelled = h.camera.position.distanceTo(first);
    h.director.stepCamera('next');
    run(h, 0.1);
    // A restart would sit still in a fresh ease-in; the walk goes on at speed.
    expect(h.camera.position.distanceTo(first)).toBeGreaterThan(travelled + 0.05);
  });

  test('the step keys step without counting as manual input; PageDown is «next»', () => {
    const h = entered();
    const press = (key: string): void => {
      for (const handler of h.canvas.listeners.get('keydown') ?? [])
        handler({ key, target: h.canvas, composedPath: () => [], preventDefault: () => undefined });
    };
    press('PageDown');
    settle(h);
    standsOn(h, cameras[1]!);
    press('End');
    settle(h);
    standsOn(h, cameras[2]!);
    press('Home');
    settle(h);
    standsOn(h, cameras[0]!);
  });

  test('a leg shorter than a second of travel still ends exactly on the target pose (section 7)', () => {
    const near = [cameras[0]!, { id: ID.camNear, position: { x: 3, y: 1.6, z: 4.7 }, yaw: 0, pitch: -0.2 }];
    const h = harness({ scene: { ...lShapePlan, tourCheckpoints: near } });
    h.director.setMode('walk');
    settle(h);
    h.director.stepCamera('next');
    settle(h);
    standsOn(h, near[1]!);
  });

  test('a walker standing on no camera goes to camera 1 with either «next» or «previous»', () => {
    const h = harness({ scene: withCameras });
    h.director.enterWalkAt({ position: new THREE.Vector3(4, 1.6, 6), target: new THREE.Vector3(4, 1.6, 7) });
    expect(h.director.walkCamera().index).toBeNull();
    expect(h.director.stepCamera('previous')).toBe(true);
    settle(h);
    standsOn(h, cameras[0]!);
  });

  test('from the tour a step pauses the run, switches to walk and steps', () => {
    const h = harness({ scene: withCameras });
    h.director.toggleTour();
    run(h, GLIDE_SECONDS + 1);
    expect(h.director.stepCamera(2)).toBe(true);
    expect(h.controller.getMode()).toBe('walk');
    expect(h.tour.getState()).toBe('paused');
    settle(h);
    standsOn(h, cameras[2]!);
  });

  test('from the tour a mini-map room click walks to the room: the walk entry glide neither fights the travel nor hides its hint', () => {
    const h = harness({ scene: withCameras });
    h.director.toggleTour();
    run(h, GLIDE_SECONDS + 1);
    const route = h.director.routeToRoom(L_SHAPE.room.b);
    expect(route).not.toBeNull();
    expect(h.director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(h.controller.getMode()).toBe('walk');
    const travelling = h.hints.at(-1);
    run(h, 1 / 60);
    expect(h.hints.at(-1)).toBe(travelling);
    settle(h);
    const end = route!.at(-1)!;
    expect(Math.hypot(h.camera.position.x - end.x, h.camera.position.z - end.z)).toBeLessThan(0.6);
    expect(h.director.walkCamera().index).toBeNull();
  });

  test('a step during a room travel stops the travel where it stands, so only the step moves the camera', () => {
    const h = entered();
    expect(h.director.travelToRoom(L_SHAPE.room.b)).toBe(true);
    expect(h.controller.isTravelling()).toBe(true);
    run(h, 0.5);
    expect(h.director.stepCamera('last')).toBe(true);
    expect(h.controller.isTravelling()).toBe(false);
    settle(h);
    standsOn(h, cameras[2]!);
    expect(h.director.walkCamera().index).toBe(2);
  });

  test('a step makes its camera current on the frame it lands on the pose, not after the clip end hold', () => {
    const h = entered();
    expect(h.director.stepCamera('next')).toBe(true);
    const target = new THREE.Vector3(cameras[1]!.position.x, cameras[1]!.position.y, cameras[1]!.position.z);
    for (let frame = 0; frame < 60 * 30 && h.camera.position.distanceTo(target) > 1e-6; frame += 1) run(h, 1 / 60);
    expect(h.camera.position.distanceTo(target)).toBeLessThan(1e-6);
    expect(h.director.walkCamera().index).toBe(1);
  });

  test('no step outside walk and tour: there is no walker to send', () => {
    const h = harness({ scene: withCameras });
    expect(h.director.stepCamera('next')).toBe(false);
    expect(h.controller.getMode()).toBe('orbit');
  });

  test('another mode stops the entry glide; asking for walk while it glides changes nothing', () => {
    const h = harness({ scene: withCameras });
    h.director.setMode('walk');
    run(h, 0.3);
    const at = h.camera.position.clone();
    h.director.setMode('walk');
    run(h, 1 / 60);
    expect(h.camera.position.distanceTo(at)).toBeGreaterThan(1e-4);
    h.director.setMode('orbit');
    expect(h.tour.getState()).toBe('ready');
    expect(h.director.walkCamera().index).toBeNull();
  });

  test('a document without a checkpoint route keeps the walk entry it always had', () => {
    const h = harness();
    h.director.setMode('walk');
    run(h, 0.5);
    expect(h.poses).toEqual([]);
    expect(h.director.walkCamera()).toEqual({ index: null, count: 0 });
  });

  test('entering the tour again starts over from camera 1 with a glide, never resumes mid-track', () => {
    const h = harness({ scene: withCameras });
    h.director.toggleTour();
    for (let clock = 0; clock < GLIDE_SECONDS + 2; clock += 1 / 60) h.director.updateTour(1 / 60);
    expect(h.tour.progress().fraction).toBeGreaterThan(0);
    // A grab pauses the run and hands the camera to orbit.
    h.director.handleManualInput();
    expect(h.tour.getState()).toBe('paused');
    h.director.toggleTour();
    expect(h.tour.getState()).toBe('playing');
    h.director.updateTour(1 / 60);
    expect(h.tour.progress().fraction).toBe(0);
    for (let clock = 0; clock < GLIDE_SECONDS; clock += 1 / 60) h.director.updateTour(1 / 60);
    expect(h.camera.position.distanceTo(first)).toBeLessThan(0.05);
  });
});

describe('entering walk or the tour from a plan mode starts from the top view on screen', () => {
  const cameras = [
    { id: ID.camA, position: { x: 3, y: 1.6, z: 4 }, yaw: Math.PI / 2, pitch: -0.1 },
    { id: ID.camB, position: { x: 8, y: 1.6, z: 2.5 }, yaw: 0, pitch: 0 },
  ];
  const withCameras: SceneData = { ...lShapePlan, tourCheckpoints: cameras };
  const first = new THREE.Vector3(3, 1.6, 4);
  /** The hidden 360 pose a plan mode freezes: far outside the flat, so a walk entry would also spawn. */
  const hidden = { position: new THREE.Vector3(30, 12, 30), target: new THREE.Vector3(5, 0, 4) };

  function run(h: ReturnType<typeof harness>, seconds: number): void {
    for (let clock = 0; clock < seconds - 1e-9; clock += 1 / 60) {
      h.controller.update(1 / 60);
      h.director.updateTour(1 / 60);
    }
  }

  function inPlanMode(from: 'plan2d' | 'plan3d'): ReturnType<typeof harness> {
    const h = harness({ scene: withCameras });
    h.controller.setPose(hidden.position, hidden.target);
    h.director.setMode(from);
    return h;
  }

  for (const from of ['plan3d', 'plan2d'] as const) {
    test(`walk from ${from}: the first frame is the top view, never the hidden 360 pose, then a one-second glide to camera 1`, () => {
      const h = inPlanMode(from);
      const start = planViewPose(h.top, h.camera.aspect);
      h.director.setMode('walk');
      run(h, 1 / 60);
      expect(h.camera.position.distanceTo(start.position)).toBeLessThan(0.05);
      expect(h.camera.position.distanceTo(hidden.position)).toBeGreaterThan(10);
      // Looking straight down, north up — the picture the plan mode showed.
      expect(h.camera.getWorldDirection(new THREE.Vector3()).y).toBeLessThan(-0.99);
      // The field of view of that first frame is the one the stand-in was fitted with, not the eye-level one of a walk spawn.
      expect(h.camera.fov).toBeCloseTo(fieldOfViewFor(h.camera.aspect, start.position.y), 3);
      run(h, GLIDE_SECONDS / 2);
      expect(h.camera.position.distanceTo(start.position)).toBeGreaterThan(0.5);
      expect(h.camera.position.distanceTo(first)).toBeGreaterThan(0.5);
      run(h, GLIDE_SECONDS / 2);
      expect(h.camera.position.distanceTo(first)).toBeLessThan(0.05);
      expect(h.controller.getMode()).toBe('walk');
    });
  }

  test('the tour from plan3d glides from the top view too', () => {
    const h = inPlanMode('plan3d');
    const start = planViewPose(h.top, h.camera.aspect);
    h.director.toggleTour();
    run(h, 1 / 60);
    expect(h.camera.position.distanceTo(start.position)).toBeLessThan(0.05);
    run(h, GLIDE_SECONDS);
    expect(h.camera.position.distanceTo(first)).toBeLessThan(0.05);
  });

  test('from orbit nothing changes: the glide starts from the orbit pose itself', () => {
    const h = harness({ scene: withCameras });
    h.controller.setPose(hidden.position, hidden.target);
    h.director.setMode('walk');
    run(h, 1 / 60);
    expect(h.camera.position.distanceTo(hidden.position)).toBeLessThan(0.05);
  });
});

describe('enterWalkAt (the look-through entry)', () => {
  const withCameras: SceneData = {
    ...lShapePlan,
    tourCheckpoints: [
      { id: ID.camA, position: { x: 3, y: 1.6, z: 4 }, yaw: Math.PI / 2, pitch: -0.1 },
      { id: ID.camB, position: { x: 8, y: 1.6, z: 2.5 }, yaw: 0, pitch: 0 },
    ],
  };

  test('stands in walk EXACTLY at the pose — no entry glide, no spawn, the full shell', () => {
    const h = harness({ scene: withCameras });
    const eye = new THREE.Vector3(8, 1.2, 2.5);
    h.director.enterWalkAt({ position: eye, target: new THREE.Vector3(9, 1.2, 2.5) });
    expect(h.controller.getMode()).toBe('walk');
    expect(h.camera.position.distanceTo(eye)).toBeLessThan(1e-9);
    // A pose that is no camera's place leaves the walk with no current camera.
    expect(h.director.walkCamera().index).toBeNull();
    const forward = h.camera.getWorldDirection(new THREE.Vector3());
    expect(forward.x).toBeCloseTo(1, 9);
    expect(h.shell.at(-1)).toBe('full');
    // The walk look was seeded from the pose: a frame without input keeps it.
    h.controller.update(1 / 60);
    expect(h.camera.getWorldDirection(new THREE.Vector3()).x).toBeCloseTo(1, 6);
  });

  test("standing on a tour camera makes it the walk's current camera", () => {
    const h = harness({ scene: withCameras });
    h.director.enterWalkAt({ position: new THREE.Vector3(8, 1.6, 2.5), target: new THREE.Vector3(8, 1.6, 3.5) });
    expect(h.director.walkCamera()).toEqual({ index: 1, count: 2 });
  });
});

describe('an explicit choice of 360 is a Reset camera', () => {
  /** The pose Reset camera lands on, read off a fresh director. */
  function resetPose(): { position: THREE.Vector3; target: THREE.Vector3 } {
    const { director, controller } = harness();
    director.reset();
    controller.update(0.1);
    return controller.getPose();
  }

  function expectPose(actual: { position: THREE.Vector3; target: THREE.Vector3 }, expected: typeof actual): void {
    expect(actual.position.distanceTo(expected.position)).toBeLessThan(1e-6);
    expect(actual.target.distanceTo(expected.target)).toBeLessThan(1e-6);
  }

  test('from walk, selectMode("orbit") ends on the Reset pose', () => {
    const home = resetPose();
    const { director, controller } = harness();
    director.selectMode('walk');
    for (let frame = 0; frame < 120; frame++) director.updateTour(1 / 60);
    controller.update(0.1);
    director.selectMode('orbit');
    controller.update(0.1);
    expect(controller.getMode()).toBe('orbit');
    expectPose(controller.getPose(), home);
  });

  test('from a playing tour, selectMode("orbit") stops the run and ends on the Reset pose', () => {
    const home = resetPose();
    const { director, controller, tour } = harness();
    director.toggleTour();
    for (let frame = 0; frame < 120; frame++) director.updateTour(1 / 60);
    director.selectMode('orbit');
    controller.update(0.1);
    expect(tour.getState()).not.toBe('playing');
    expectPose(controller.getPose(), home);
  });

  test('from the top view, and from a 360 the visitor moved, it is the Reset pose too', () => {
    const home = resetPose();
    const { director, controller } = harness();
    director.selectMode('plan3d');
    director.selectMode('orbit');
    controller.update(0.1);
    expectPose(controller.getPose(), home);

    controller.setPose(new THREE.Vector3(2, 1.6, 2), new THREE.Vector3(3, 1.2, 3));
    director.selectMode('orbit');
    controller.update(0.1);
    expectPose(controller.getPose(), home);
  });

  test('a grab that takes over a running tour lands in 360 WITHOUT a reset', () => {
    const home = resetPose();
    const { director, controller, tour } = harness();
    director.toggleTour();
    for (let frame = 0; frame < 120; frame++) director.updateTour(1 / 60);
    const grabbed = controller.getPose();
    director.handleManualInput();
    controller.update(0.1);
    expect(tour.getState()).toBe('paused');
    expect(controller.getMode()).toBe('orbit');
    expect(controller.getPose().position.distanceTo(grabbed.position)).toBeLessThan(1e-3);
    expect(controller.getPose().position.distanceTo(home.position)).toBeGreaterThan(0.5);
  });

  test('other explicit choices keep their own entry: selectMode("walk") is setMode("walk")', () => {
    const a = harness();
    const b = harness();
    a.director.selectMode('walk');
    b.director.setMode('walk');
    a.controller.update(0.1);
    b.controller.update(0.1);
    expectPose(a.controller.getPose(), b.controller.getPose());
  });
});
