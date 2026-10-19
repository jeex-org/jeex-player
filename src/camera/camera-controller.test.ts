/**
 * The controller as an INTEGRATION: construction and reset, the mode
 * transitions, `flyToRoom`, a plan-level commit, hover, and what an asset swap
 * does to collision.
 *
 * What is deliberately NOT here any more: the behaviour of each rig. Orbit
 * input lives in `orbit-rig.test.ts`, walk input in `walk-rig.test.ts`, the
 * door gate in `walk-doors.test.ts` and scripted routes in
 * `travel-rig.test.ts` — where a reader looks for them, and where the file
 * they were in stops being the largest module in the repository. The harness
 * they all share is
 * `src/fixtures/camera-harness.ts`.
 *
 * The controller only needs a handful of DOM affordances, so it is driven by a
 * fake canvas and a minimal `window` stub instead of a real document. Picking
 * is not covered here: it lives in `picker.ts` and has its own tests.
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { draftOf } from '../shared/committed.js';
import * as THREE from 'three';
import { CameraController } from './camera-controller.js';
import { Picker } from '../geometry/picker.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan, spawnlessLShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { VARIANT } from '../assets/catalogue-ids.js';
import { isInDoorway, isNavigable } from '../navigation/navigation.js';
import { roomAt, roomCentre } from '../navigation/room-graph.js';
import { obstaclesFor } from '../assets/asset-footprint.js';
import { SceneModel, isApplyOk } from '../scene/scene-model.js';
import { cameraHarness, doorwayCentre, EYE_HEIGHT, expectPosition, FRAME } from '../fixtures/camera-harness.js';
import { fakeCanvas, fakeWindowHooks } from '../fixtures/stubs.js';
import type { SceneData } from '../scene/types.js';

/**
 * Bun has no `window`; some collaborators the controller drives (rig capability
 * probes) check for one before they decide what to do, and without the stub
 * every such test would measure the "no window" branch instead of the one it
 * means to.
 */
const fakeWindow = fakeWindowHooks();

/** Ids this file invents: the scenes it derives from the spawnless fixture, and a room no scene has. */
const ID = {
  spawnlessFlat: '01a12ffa-735e-7143-8c05-c0fa1e0a806c',
  noPoints: '01a12ffa-735f-78e8-8b9d-c9cf8893cd62',
  unknownRoom: '01a12ffa-7360-75d7-ad62-232c0f9cfb8b',
} as const;
beforeEach(fakeWindow.install);
afterEach(fakeWindow.restore);

// The spawn warning is read off the harness's own `onLog` sink
// (`cameraHarness().warnings`), one per harness, so nothing here patches a
// global and nothing leaks between tests.

describe('construction and reset', () => {
  test('starts in orbit mode at the presentation camera', () => {
    const { controller, camera } = cameraHarness();
    expect(controller.getMode()).toBe('orbit');
    const start = lShapePlan.presentationCamera;
    expectPosition(camera, start.position.x, start.position.y, start.position.z);
    const pose = controller.getPose();
    expect(pose.target.x).toBeCloseTo(start.target.x, 6);
    expect(pose.target.y).toBeCloseTo(start.target.y, 6);
    expect(pose.target.z).toBeCloseTo(start.target.z, 6);
  });

  test('subscribes to and releases the canvas events it uses', () => {
    const { controller, canvas } = cameraHarness();
    // The keys are here too: the harness passes the canvas itself as its own
    // key target (there is no shell root to resolve one from), and nothing
    // binds `window` any more.
    expect([...canvas.listeners.keys()].sort()).toEqual([
      'blur',
      'click',
      'contextmenu',
      'dblclick',
      'keydown',
      'keyup',
      'pointercancel',
      'pointerdown',
      'pointerleave',
      'pointermove',
      'pointerup',
      'wheel',
    ]);
    controller.dispose();
    for (const [, set] of canvas.listeners) expect(set.size).toBe(0);
  });

  test("interaction: 'none' never attaches CameraInput: the canvas gets no listeners at all", () => {
    const { controller, canvas } = cameraHarness({ interaction: 'none' });
    expect(canvas.listeners.size).toBe(0);
    // Both are safe even though nothing was ever attached.
    expect(() => controller.reset()).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
  });

  test('reset returns the camera to the presentation pose', () => {
    const { controller, camera } = cameraHarness();
    controller.setMode('walk');
    controller.update(FRAME);
    controller.reset();
    const start = lShapePlan.presentationCamera;
    expect(controller.getMode()).toBe('orbit');
    expectPosition(camera, start.position.x, start.position.y, start.position.z);
  });
});

describe('mode transitions', () => {
  test('tour mode reports the view on screen, never the unseeded walk look angles', () => {
    // The tour asks for `getPose()` to build its lead-in leg. Answering with
    // the walk look direction — yaw and pitch are 0 until walk mode seeds them,
    // i.e. "4 m due south, level" for any camera — pointed the whole fly-in at
    // empty sky and opened the run on a blank screen.
    const { controller } = cameraHarness();
    const orbitTarget = controller.getPose().target.clone();
    controller.setMode('tour');
    expect(controller.getPose().target.distanceTo(orbitTarget)).toBeLessThan(1e-6);

    const flown = new THREE.Vector3(5, 1.4, 6);
    controller.setPose(new THREE.Vector3(2, 1.6, 2), flown);
    expect(controller.getPose().target.distanceTo(flown)).toBeLessThan(1e-6);
  });

  test('walk snaps to a navigable spawn at eye height', () => {
    const { controller, camera } = cameraHarness();
    const plan = solvePlan(lShapePlan);
    expect(isNavigable(plan, camera.position)).toBe(false);
    controller.setMode('walk');
    expect(controller.getMode()).toBe('walk');
    // The fixture's authored `walkSpawn` stands on its first navigation point.
    const spawn = lShapePlan.navigation.points[0]!;
    expectPosition(camera, spawn.x, EYE_HEIGHT, spawn.z);
    expect(isNavigable(plan, camera.position)).toBe(true);
  });

  /**
   * The spawn of a scene that authored none.
   *
   * Guards against a fixed fallback such as `{ x: 3.2, y: 1.2, z: 3.0 }` — a
   * spot in the DEMO flat's lounge, which in any other apartment is a point
   * inside a wall or outside the building. There is no such thing as a generic entry pose, so the pose
   * is read off the plan and the omission is reported.
   */
  describe('a scene with no authored walk spawn', () => {
    /** The spawnless fixture with its first navigation point moved off room A's centre. */
    const OFF_CENTRE = { x: 1.4, y: 0, z: 6.2 };
    const derivedScene: SceneData = {
      ...spawnlessLShapePlan,
      id: ID.spawnlessFlat,
      navigation: { points: [OFF_CENTRE, ...spawnlessLShapePlan.navigation.points.slice(1)] },
    };

    test('stands on the first navigation point and faces the centre of its room', () => {
      const { controller, camera } = cameraHarness({ scene: derivedScene });
      controller.setMode('walk');
      expectPosition(camera, OFF_CENTRE.x, EYE_HEIGHT, OFF_CENTRE.z);

      // Room A holds the point, so its navigable centre is what the walker
      // turns to: the gaze and the centre must lie on the same bearing.
      const centre = roomCentre(
        solvePlan(derivedScene),
        derivedScene,
        roomAt(solvePlan(derivedScene), OFF_CENTRE)!,
        obstaclesFor(derivedScene),
      );
      const wanted = Math.atan2(centre.x - OFF_CENTRE.x, centre.z - OFF_CENTRE.z);
      const gaze = controller.getPose().target.clone().sub(camera.position);
      expect(Math.atan2(gaze.x, gaze.z)).toBeCloseTo(wanted, 6);
      expect(gaze.y).toBeCloseTo(0, 6);
    });

    test('says so once, naming the scene, however often walk mode is entered', () => {
      const { controller, warnings } = cameraHarness({ scene: derivedScene });
      controller.setMode('walk');
      controller.setMode('orbit');
      controller.setMode('walk');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('walkspawn-derived');
      expect(warnings[0]?.detail).toEqual({ sceneId: ID.spawnlessFlat, derived: true });
      expect(warnings[0]?.message).toContain('walkSpawn');
    });

    test('a scene that authored one is used as authored, and says nothing', () => {
      const authored: SceneData = { ...derivedScene, walkSpawn: { position: { x: 2, y: 1.6, z: 6 }, target: { x: 5, y: 1.3, z: 6 } } };
      const { controller, camera, warnings } = cameraHarness({ scene: authored });
      controller.setMode('walk');
      expectPosition(camera, 2, EYE_HEIGHT, 6);
      expect(controller.getPose().target.x).toBeGreaterThan(camera.position.x);
      expect(warnings).toEqual([]);
    });

    test('a room camera is not a walk spawn: the pose is still derived, and reported', () => {
      // Before schema 2.0 a room camera under the id `living` doubled as the
      // walk entry; ids are UUIDs now, so only `walkSpawn` is authored.
      const withRoomCamera: SceneData = {
        ...derivedScene,
        roomCameras: {
          ...derivedScene.roomCameras,
          [L_SHAPE.room.a]: { position: { x: 2, y: 1.6, z: 6 }, target: { x: 5, y: 1.3, z: 6 } },
        },
      };
      const { controller, camera, warnings } = cameraHarness({ scene: withRoomCamera });
      controller.setMode('walk');
      expectPosition(camera, OFF_CENTRE.x, EYE_HEIGHT, OFF_CENTRE.z);
      expect(warnings[0]?.detail).toEqual({ sceneId: ID.spawnlessFlat, derived: true });
    });

    test('a scene with nothing to derive from leaves the camera where it stands', () => {
      const empty: SceneData = { ...derivedScene, id: ID.noPoints, navigation: { points: [] } };
      const { controller, camera, warnings } = cameraHarness({ scene: empty });
      const before = camera.position.clone();
      controller.setMode('walk');
      expect(camera.position.distanceTo(before)).toBeCloseTo(0, 6);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.detail).toEqual({ sceneId: ID.noPoints, derived: false });
    });
  });

  test('walk keeps a camera that already stands on navigable floor', () => {
    const { controller, camera } = cameraHarness();
    const spawn = lShapePlan.navigation.points[2]!;
    camera.position.set(spawn.x, EYE_HEIGHT, spawn.z);
    controller.setMode('walk');
    expectPosition(camera, spawn.x, EYE_HEIGHT, spawn.z);
  });

  test('switching back to orbit keeps the camera in place and orbits what it looks at', () => {
    const { controller, camera } = cameraHarness();
    controller.setMode('walk');
    const walkPosition = camera.position.clone();
    controller.update(FRAME);
    controller.setMode('orbit');
    expect(controller.getMode()).toBe('orbit');
    expectPosition(camera, walkPosition.x, walkPosition.y, walkPosition.z);
    const target = controller.getPose().target;
    expect(camera.position.distanceTo(target)).toBeGreaterThan(0);
  });
});

describe('update', () => {
  test('an idle orbit frame leaves the camera where reset put it', () => {
    const { controller, camera } = cameraHarness();
    const before = camera.position.clone();
    for (let i = 0; i < 30; i += 1) controller.update(FRAME);
    expectPosition(camera, before.x, before.y, before.z, 5);
  });

  test('an idle walk frame does not move the camera', () => {
    const { controller, camera } = cameraHarness();
    controller.setMode('walk');
    const before = camera.position.clone();
    for (let i = 0; i < 30; i += 1) controller.update(FRAME);
    expectPosition(camera, before.x, before.y, before.z);
  });
});

describe('flyToRoom', () => {
  for (const [name, roomId] of Object.entries(L_SHAPE.room)) {
    test(`room ${name}: the orbit target becomes its roomCameras target`, () => {
      const { controller, camera } = cameraHarness();
      expect(controller.flyToRoom(roomId)).toBe(true);
      expect(controller.getMode()).toBe('orbit');
      for (let i = 0; i < 400; i += 1) controller.update(FRAME);
      const room = lShapePlan.roomCameras[roomId]!;
      const target = controller.getPose().target;
      expect(target.x).toBeCloseTo(room.target.x, 5);
      expect(target.y).toBeCloseTo(room.target.y, 5);
      expect(target.z).toBeCloseTo(room.target.z, 5);
      // The rig clamps radius to [MIN_RADIUS, MAX_RADIUS] and pitch to [0.3, 1.45],
      // so the position lands on the clamped orbit sphere around that target.
      const authored = new THREE.Vector3(room.position.x, room.position.y, room.position.z);
      const wantedRadius = THREE.MathUtils.clamp(authored.distanceTo(target), 2.2, 46);
      expect(camera.position.distanceTo(target)).toBeCloseTo(wantedRadius, 3);
    });
  }

  test('the camera ends up inside the room it flew to', () => {
    const { controller, camera } = cameraHarness();
    controller.flyToRoom(L_SHAPE.room.a);
    for (let i = 0; i < 400; i += 1) controller.update(FRAME);
    const room = lShapePlan.roomCameras[L_SHAPE.room.a]!;
    const authored = new THREE.Vector3(room.position.x, room.position.y, room.position.z);
    expect(camera.position.distanceTo(authored)).toBeLessThan(0.4);
  });

  test('an unknown room id is rejected and leaves the camera alone', () => {
    const { controller, camera } = cameraHarness();
    const before = camera.position.clone();
    expect(controller.flyToRoom(ID.unknownRoom)).toBe(false);
    controller.update(FRAME);
    expectPosition(camera, before.x, before.y, before.z, 5);
  });
});

describe('setScene: a plan-level commit re-seeds the controller', () => {
  /** The fixture's entrance door lives on wall `wSA`; removing it closes that doorway. */
  function withoutEntrance(): SceneData {
    const scene = draftOf(lShapePlan);
    const wall = scene.walls.find((candidate) => candidate.id === L_SHAPE.wall.wSA)!;
    wall.openings = (wall.openings ?? []).filter((opening) => opening.id !== L_SHAPE.opening.doorEntry);
    return scene;
  }

  test('the doorway the controller can walk through follows the committed plan', () => {
    const { controller } = cameraHarness();
    const doorway = doorwayCentre(solvePlan(lShapePlan), L_SHAPE.wall.wSA);
    expect(doorway).not.toBeNull();
    expect(
      controller.isNavigableAt(doorway!.x, doorway!.z) || isInDoorway(solvePlan(lShapePlan), { x: doorway!.x, y: 1.65, z: doorway!.z }),
    ).toBe(true);

    const closed = withoutEntrance();
    const closedPlan = solvePlan(closed);
    controller.setScene(closed, closedPlan);
    expect(isInDoorway(closedPlan, { x: doorway!.x, y: 1.65, z: doorway!.z })).toBe(false);
    // The controller answers from the CURRENT plan, not the one it was built with.
    expect(controller.canWalkTo(doorway!.x, doorway!.z)).toBe(false);
  });

  test('obstacles and the orbit home come from the new document', () => {
    const { controller, camera } = cameraHarness();
    const moved = draftOf(lShapePlan);
    moved.presentationCamera = { position: { x: 1, y: 9, z: 2 }, target: { x: 3, y: 0, z: 3 } };
    moved.assets = [];
    controller.setScene(moved, solvePlan(moved));
    controller.reset();
    expectPosition(camera, 1, 9, 2, 6);
    // With no furniture left, a straight walk across the room is unobstructed.
    controller.setMode('walk');
    const room = solvePlan(moved).rooms.find((candidate) => candidate.roomId === L_SHAPE.room.a)!;
    const centre = { x: (room.bbox.minX + room.bbox.maxX) / 2, z: (room.bbox.minZ + room.bbox.maxZ) / 2 };
    expect(controller.isNavigableAt(centre.x, centre.z)).toBe(true);
  });

  test('the clamped eye height survives: EYE_HEIGHT does not overwrite it', () => {
    const { controller, camera } = cameraHarness();
    controller.setMode('walk');
    const low = draftOf(lShapePlan);
    low.ceilingHeight = 2;
    controller.setScene(low, solvePlan(low));
    // 2.00 m ceiling minus the 0.45 m headroom `clampToNavigation` keeps: the
    // clamp lowers the eye, and putting EYE_HEIGHT back pushed it through the
    // ceiling the clamp had just rescued it from.
    expect(camera.position.y).toBeCloseTo(1.55, 6);
    expect(camera.position.y).toBeLessThan(EYE_HEIGHT);
  });

  test('a walk destination from the previous plan is dropped', () => {
    const { controller, camera } = cameraHarness();
    controller.setMode('walk');
    const before = camera.position.clone();
    controller.setScene(lShapePlan, solvePlan(lShapePlan));
    for (let i = 0; i < 30; i += 1) controller.update(FRAME);
    // Nothing is chasing a stale target, so the camera holds its (clamped) pose.
    expect(camera.position.y).toBeCloseTo(EYE_HEIGHT, 6);
    expect(Math.hypot(camera.position.x - before.x, camera.position.z - before.z)).toBeLessThan(1.5);
  });
});

describe('hover', () => {
  function hoverHarness() {
    const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
    const canvas = fakeCanvas();
    const hovers: Array<{ x: number; y: number }> = [];
    const controller = new CameraController(
      camera,
      canvas as unknown as HTMLCanvasElement,
      lShapePlan,
      solvePlan(lShapePlan),
      new Picker(canvas),
      {
        keys: canvas as unknown as HTMLElement,
        onManualInput: () => undefined,
        onHint: () => undefined,
        onHover: (_pick, x, y) => {
          hovers.push({ x, y });
        },
      },
    );
    const fire = (type: string, event: unknown): void => {
      for (const handler of canvas.listeners.get(type) ?? []) handler(event);
    };
    return { controller, canvas, hovers, fire };
  }

  test('a move is reported once, on the next frame, not once per event', () => {
    const { controller, hovers, fire } = hoverHarness();
    fire('pointermove', { pointerId: 1, clientX: 100, clientY: 120 });
    fire('pointermove', { pointerId: 1, clientX: 101, clientY: 121 });
    expect(hovers).toEqual([]);
    controller.update(FRAME);
    expect(hovers).toEqual([{ x: 101, y: 121 }]);
    // A resting pointer is re-tested on a slow heartbeat, not every frame.
    controller.update(FRAME);
    expect(hovers.length).toBe(1);
  });

  test('nothing is hovered while a drag is in progress', () => {
    const { controller, hovers, fire } = hoverHarness();
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 120, button: 0 });
    fire('pointermove', { pointerId: 1, clientX: 140, clientY: 160 });
    controller.update(FRAME);
    expect(hovers).toEqual([]);
  });

  test('the tour hovers nothing: the affordances belong to orbit and walk', () => {
    const { controller, hovers, fire } = hoverHarness();
    controller.setMode('tour');
    fire('pointermove', { pointerId: 1, clientX: 100, clientY: 120 });
    controller.update(FRAME);
    expect(hovers).toEqual([]);
  });

  test('leaving the canvas reports "nothing" once and stops the heartbeat', () => {
    const { controller, hovers, fire } = hoverHarness();
    fire('pointermove', { pointerId: 1, clientX: 100, clientY: 120 });
    controller.update(FRAME);
    fire('pointerleave', { pointerId: 1 });
    expect(hovers.length).toBe(2);
    controller.update(FRAME);
    expect(hovers.length).toBe(2);
  });
});

describe('refreshObstacles: an asset swap changes what the camera collides with', () => {
  /** Room B of the fixture, on a straight line 0.55 m south of the table. */
  const FROM = { x: 6.5, z: 3.05 };
  const TO = { x: 9.5, z: 3.05 };

  test('a bigger variant blocks a walk that was clear before the commit', () => {
    const { controller, camera } = cameraHarness();
    controller.setMode('walk');
    camera.position.set(FROM.x, EYE_HEIGHT, FROM.z);
    // The authored dining table is 0.95 m deep, so this line clears it.
    expect(controller.canWalkTo(TO.x, TO.z)).toBe(true);

    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const result = model.apply({
      baseRev: 0,
      // The round variant carries its own `dims` (1.2 x 1.2), so it is deeper.
      ops: [{ op: 'replace_asset_variant', assetId: L_SHAPE.asset.table, variant: VARIANT.table_dining_round_oak }],
    });
    expect(isApplyOk(result)).toBe(true);

    // An incremental swap never goes through `setScene`; without this call the
    // controller kept colliding with the footprint of the object that is gone.
    controller.refreshObstacles(model.scene);
    expect(controller.canWalkTo(TO.x, TO.z)).toBe(false);
  });

  test('the plan is untouched, so walkability itself does not change', () => {
    const { controller } = cameraHarness();
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    controller.refreshObstacles(model.scene);
    expect(controller.isNavigableAt(TO.x, TO.z)).toBe(true);
  });

  test('a furniture-only commit ends a running travel, onDone once', () => {
    // The curve was proved clear against the obstacles this call replaces; the
    // new footprint may stand on the rest of it, so the route ends here the
    // same way `setScene` ends one.
    const { controller, camera } = cameraHarness();
    controller.setMode('walk');
    camera.position.set(1.5, EYE_HEIGHT, 2);
    let done = 0;
    expect(
      controller.walkAlong(
        [
          { x: 4.5, y: 0, z: 2 },
          { x: 4.5, y: 0, z: 4.4 },
        ],
        () => {
          done += 1;
        },
      ),
    ).toBe(true);
    for (let i = 0; i < 20; i += 1) controller.update(FRAME);
    expect(controller.isTravelling()).toBe(true);

    controller.refreshObstacles(new SceneModel(lShapePlan, CATALOGUE_REGISTRIES).scene);
    expect(controller.isTravelling()).toBe(false);
    expect(done).toBe(1);

    // And the camera stays where the commit caught it, instead of finishing a
    // route nothing has re-proved.
    const stopped = camera.position.clone();
    for (let i = 0; i < 60; i += 1) controller.update(FRAME);
    expect(camera.position.distanceTo(stopped)).toBeLessThan(1e-6);
  });
});
