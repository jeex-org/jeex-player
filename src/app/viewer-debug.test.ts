/**
 * Smoke test for the `window.__viewerDebug` contract.
 *
 * `scripts/browser-check.ts` drives the viewer entirely through this surface,
 * so the SHAPE of it is the thing worth pinning: which keys exist, which of
 * them are gated behind the development capability, and that the read-only
 * getters project the model rather than the stubs.
 */

import type { SunShadow } from '../render/sun-shadow.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SceneModel } from '../scene/scene-model.js';
import { bayPlan, lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { ARCHETYPE } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { installViewerDebug, type ViewerDebugHost } from './viewer-debug.js';
import type { TourControls } from '../camera/tour-controls.js';
import { createMessages } from '../ui/messages.js';
import { stubBuilder, stubController, stubDirector, stubEditor } from '../fixtures/stubs.js';

/**
 * Ids this file invents: the two walls of the fake facade, a room no plan has,
 * and a preset no scene declares.
 */
const FAKE = {
  wallGood: '01a12ffa-e520-79e5-9e1d-24afaa01158b',
  wallBad: '01a12ffa-e521-71d3-ac65-86a90be685f9',
  ghostRoom: '01a12ffa-e522-7d09-8a7b-a64c8c1ea157',
  preset: '01a12ffa-e523-7f62-ac16-43b7981e4769',
} as const;

/** Every key the read-only half of the contract must always expose. */
const READ_ONLY_KEYS = [
  'assetModels',
  'surfaceMaterial',
  'assetMove',
  'assetVariant',
  'camera',
  'cameraLook',
  'children',
  'describeSelection',
  'doorAutomation',
  'doorScreenPoint',
  'doors',
  'finishTravel',
  'minimap',
  'minimapRoomPoint',
  'routeToRoom',
  'travelPath',
  'tourCameras',
  'faceWall',
  'facadeWall',
  'faces',
  'floorAt',
  'floorFinish',
  'floorPoint',
  'focusRoom',
  'furniture',
  'furnitureRendered',
  'planDrawing',
  'renderCamera',
  'mode',
  'navigable',
  'openingVariant',
  'openings',
  'plan',
  'presets',
  'applyPreset',
  'projectFloorPoint',
  'projectPoint',
  'revision',
  'rooms',
  'selectedFurniture',
  'selectedOpening',
  'selection',
  'selectionPoint',
  'sunShadow',
  'toggleDoor',
  'wallFinish',
  'wallJoints',
  'walkPost',
  'walkLighting',
];

/** The ones that change or export the draft, plus the two lazy layout reads. */
// `layoutIssues` and `suggestPlacement` are gated alongside the mutating trio:
// `layout-lint.ts` and `free-space.ts` are two sizeable lazy chunks (the
// second imports across into the first), armed together and only once the
// debug capability is confirmed on. Neither CHANGES anything —
// `suggestPlacement` is a query whose pose the caller feeds to `applyOps`
// itself — so they are gated for the BYTES, not for the mutation.
const CAPABILITY_KEYS = ['applyOps', 'completeness', 'exportScene', 'layoutIssues', 'loadScene', 'suggestPlacement'];

/**
 * A host whose every member is a getter, which is the contract now: the surface
 * is installed once and the parts under it are replaced by a Retry or a
 * `loadScene`, so nothing may be captured by value.
 */
function host(overrides: Partial<ViewerDebugHost> = {}): ViewerDebugHost {
  const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
  const messages = createMessages('en');
  // `getScene` derives from whichever `model` getter ends up in effect — the
  // default above or an override — so a test that swaps the model needs no
  // matching override of its own.
  const modelGetter = overrides.model ?? (() => model);
  return {
    model: modelGetter,
    getScene: () => modelGetter().toJSON(),
    messages: () => messages,
    // The read-only half is what most of this file asserts on; a test that
    // wants the authoring calls asks for them.
    capabilities: () => false,
    camera: () => undefined,
    renderCamera: () => undefined,
    viewport: () => ({ clientWidth: 800, clientHeight: 600 }),
    sceneRoot: () => undefined,
    sun: () => undefined,
    walkPost: () => undefined,
    walkLighting: () => undefined,
    director: () => stubDirector(),
    editor: () => stubEditor(),
    builder: () => stubBuilder(),
    minimap: () => ({ visible: false, camera: null, hoverRoom: null }),
    minimapRoomPoint: () => null,
    routeToRoom: () => null,
    travelPath: () => null,
    pickCamera: () => undefined,
    checkpointOverlay: () => undefined,
    selection: () => null,
    assetMove: () => null,
    furnitureVisible: () => true,
    doors: () => [],
    doorAutomation: () => ({ hold: [], release: [] }),
    toggleDoor: () => false,
    doorScreenPoint: () => null,
    loadScene: () => true,
    // `undefined` is a bare scene, which lints against the shipped object bank.
    projectLibrary: () => undefined,
    // `undefined` leaves `api.tour` unset, which is what a viewer with no camera
    // stack yet answers.
    tour: () => undefined,
    ...overrides,
  };
}

let hadWindow = false;
let previousWindow: unknown;

beforeEach(() => {
  hadWindow = 'window' in globalThis;
  previousWindow = Reflect.get(globalThis, 'window');
  if (!hadWindow) Reflect.set(globalThis, 'window', {});
});

afterEach(() => {
  if (hadWindow) Reflect.set(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('the installed surface', () => {
  test('installs exactly the read-only keys plus the capability keys', () => {
    const api = installViewerDebug({ ...host(), capabilities: () => true });
    expect(Object.keys(api).sort()).toEqual([...READ_ONLY_KEYS, ...CAPABILITY_KEYS].sort());
    expect(Reflect.get(globalThis, 'window')).toHaveProperty('__viewerDebug', api);
    for (const key of Object.keys(api)) {
      expect({ key, type: typeof (api as unknown as Record<string, unknown>)[key] }).toEqual({ key, type: 'function' });
    }
  });

  test('without the capability the mutating and exporting methods are absent', () => {
    const api = installViewerDebug({ ...host(), capabilities: () => false });
    expect(Object.keys(api).sort()).toEqual([...READ_ONLY_KEYS].sort());
    for (const key of CAPABILITY_KEYS) expect(api).not.toHaveProperty(key);
  });

  test('the capability follows a dev build or an explicit ?debug=1', () => {
    // The capability is a MOUNT OPTION now (`options.debug`), not a read of
    // the host page's query string: an embedded viewer must not expose its
    // authoring calls because the page around it happens to carry `?debug=1`.
    expect(Object.keys(installViewerDebug(host({ capabilities: () => true })))).toContain('applyOps');
    expect(Object.keys(installViewerDebug(host({ capabilities: () => false })))).not.toContain('applyOps');
  });
});

describe('the getters project the model', () => {
  test('finishes and revision come from the document, not from the stubs', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const api = installViewerDebug({ ...host({ model: () => model }), capabilities: () => true });
    expect(api.revision()).toBe(0);
    expect(api.rooms().sort()).toEqual([L_SHAPE.room.a, L_SHAPE.room.b].sort());
    expect(api.floorFinish(L_SHAPE.room.a)).toBe(FINISH.oak);
    expect(api.facadeWall()).toBe(FINISH.sand);
    api.applyOps!([{ op: 'set_material', target: L_SHAPE.room.a, material: FINISH.walnut }]);
    expect(api.revision()).toBe(1);
    expect(api.floorFinish(L_SHAPE.room.a)).toBe(FINISH.walnut);
    expect(api.exportScene!().finishes?.rooms?.[L_SHAPE.room.a]?.floor).toBe(FINISH.walnut);
  });

  test('plan DTOs are copies, so a caller cannot reach the frozen plan', () => {
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const api = installViewerDebug({ ...host({ model: () => model }), capabilities: () => true });
    const room = api.plan().rooms[0]!;
    room.bbox.minX = -99;
    room.polygon[0]!.x = -99;
    expect(api.plan().rooms[0]!.bbox.minX).not.toBe(-99);
    expect(api.plan().rooms[0]!.polygon[0]!.x).not.toBe(-99);
  });

  test('a facade face without a midpoint is dropped, not reported at a fabricated origin', () => {
    // `polylineMidpoint` answers null only for an empty polyline — a shape a
    // real solved plan never produces, so this is exercised with a minimal
    // fake model rather than trying to coax `solvePlan` into it.
    const fakeModel = {
      rev: 0,
      scene: new SceneModel(lShapePlan, CATALOGUE_REGISTRIES).scene,
      plan: {
        rooms: [],
        faces: new Map(),
        facade: [
          {
            key: { wallId: FAKE.wallGood, side: 'L' },
            wallId: FAKE.wallGood,
            polyline: [
              { x: 0, z: 0 },
              { x: 2, z: 0 },
            ],
            normal: { x: 0, z: -1 },
            length: 2,
          },
          {
            key: { wallId: FAKE.wallBad, side: 'L' },
            wallId: FAKE.wallBad,
            polyline: [],
            normal: { x: 0, z: -1 },
            length: 0,
          },
        ],
      },
      toJSON: () => ({}),
    } as unknown as SceneModel;
    const api = installViewerDebug(host({ model: () => fakeModel }));
    const facadeWalls = api.plan().facadeWalls;
    expect(facadeWalls.map((face) => face.face)).toEqual([{ wallId: FAKE.wallGood, side: 'L' }]);
  });

  test('floorAt names the room whose floor mesh is under a plan point', () => {
    const root = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 2));
    floor.position.set(0, -0.06, 0);
    floor.userData['surface'] = 'floor';
    floor.userData['roomId'] = L_SHAPE.room.a;
    // A ceiling on the same ray must not answer for the floor below it.
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2, 0.02, 2));
    ceiling.position.set(0, 2.6, 0);
    ceiling.userData['isCeiling'] = true;
    root.add(ceiling, floor);
    const api = installViewerDebug(host({ sceneRoot: () => root }));
    expect(api.floorAt(0, 0)).toBe(L_SHAPE.room.a);
    expect(api.floorAt(0.9, -0.9)).toBe(L_SHAPE.room.a);
    expect(api.floorAt(4, 0)).toBeNull();
    expect(installViewerDebug(host()).floorAt(0, 0)).toBeNull();
  });

  test('surfaceMaterial reports what a named surface is drawn with: its colour and which maps it samples', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: '#9a7b56' });
    const image = { width: 512, height: 512 };
    material.map = new THREE.Texture(image as never);
    material.aoMap = new THREE.Texture();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), material);
    floor.name = `floor-${L_SHAPE.room.a}`;
    root.add(floor);
    const api = installViewerDebug(host({ sceneRoot: () => root }));
    expect(api.surfaceMaterial(`floor-${L_SHAPE.room.a}`)).toEqual({
      colour: '#9a7b56',
      maps: ['map', 'aoMap'],
      mapSize: 512,
    });
    expect(api.surfaceMaterial('nothing-by-that-name')).toBeNull();
  });

  test('navigable and focusRoom pass the host answer through unchanged', () => {
    const api = installViewerDebug(
      host({
        director: () =>
          stubDirector({
            controller: stubController({ isNavigableAt: (x) => x > 0, canWalkTo: (_x, z) => z > 0 }),
            focusRoom: (roomId) => roomId === L_SHAPE.room.a,
          }),
      }),
    );
    expect(api.navigable(1, 1)).toEqual({ standable: true, reachable: true });
    expect(api.navigable(-1, -1)).toEqual({ standable: false, reachable: false });
    expect(api.focusRoom(L_SHAPE.room.a)).toBe(true);
    expect(api.focusRoom(FAKE.ghostRoom)).toBe(false);
  });

  test('sunShadow is null before a root and the sun state after', () => {
    expect(installViewerDebug(host()).sunShadow()).toBeNull();
    const state = { direction: [0, 1, 0] as const, azimuth: 0, elevation: 90, fit: null, draws: 3 };
    const sun = { state: () => state } as unknown as SunShadow;
    expect(installViewerDebug(host({ sun: () => sun })).sunShadow()).toEqual(state);
  });

  test('walkLighting is off without a stage and the controller state with one', () => {
    expect(installViewerDebug(host()).walkLighting()).toEqual({ state: 'off', stats: null });
    expect(installViewerDebug(host({ walkLighting: () => ({ state: 'baking', stats: null }) })).walkLighting().state).toBe('baking');
  });

  test('walkPost is off without a stage and the controller state with one', () => {
    expect(installViewerDebug(host()).walkPost()).toBe('off');
    expect(installViewerDebug(host({ walkPost: () => 'loading' })).walkPost()).toBe('loading');
  });

  test('furnitureRendered reads the built group, not the toggle the app believes', () => {
    const root = new THREE.Group();
    const furniture = new THREE.Group();
    furniture.name = 'demo-assets';
    root.add(furniture);
    const api = installViewerDebug(host({ sceneRoot: () => root, furnitureVisible: () => true }));
    expect(api.furniture()).toBe(true);
    expect(api.furnitureRendered()).toBe(true);
    furniture.visible = false;
    // A disagreement between the two is the shape of the rebuild bug.
    expect(api.furniture()).toBe(true);
    expect(api.furnitureRendered()).toBe(false);
  });

  test('furnitureRendered is null before a root exists', () => {
    expect(installViewerDebug(host()).furnitureRendered()).toBeNull();
  });

  test('finishTravel passes the host answer through unchanged', () => {
    const stopped = installViewerDebug(
      host({
        director: () => stubDirector({ controller: stubController({ finishTravel: () => false }) }),
      }),
    );
    expect(stopped.finishTravel()).toBe(false);
    const running = installViewerDebug(
      host({
        director: () => stubDirector({ controller: stubController({ finishTravel: () => true }) }),
      }),
    );
    expect(running.finishTravel()).toBe(true);
  });

  test('routeToRoom carries the door tag of every standoff waypoint', () => {
    // The tag is how a browser check NAMES the door a route crosses; without
    // it, a check that wants to shut one mid-route has to guess at the
    // apartment's geometry.
    const api = installViewerDebug(
      host({
        routeToRoom: () => [
          { x: 1, z: 2 },
          { x: 3, z: 4, door: L_SHAPE.opening.doorAb },
          { x: 5, z: 6, door: L_SHAPE.opening.doorAb },
        ],
      }),
    );
    expect(api.routeToRoom(L_SHAPE.room.b)).toEqual([
      { x: 1, z: 2 },
      { x: 3, z: 4, door: L_SHAPE.opening.doorAb },
      { x: 5, z: 6, door: L_SHAPE.opening.doorAb },
    ]);
    expect(installViewerDebug(host()).routeToRoom(L_SHAPE.room.b)).toBeNull();
  });
});

describe('applyPreset before the editor exists', () => {
  test('answers not_ready with the messages.ts copy, instead of forging a validation failure', () => {
    const api = installViewerDebug(host({ editor: () => undefined }));
    expect(api.applyPreset(FAKE.preset)).toEqual({ error: 'not_ready', message: createMessages('en').t('error.notReady') });
  });
});

describe('the roles are read per call, never captured', () => {
  test('the surface follows a host whose parts have all been replaced', () => {
    // The contract that made the roles worth splitting: the stage is rebuilt by
    // Retry, the mount by every document, and the shell by both — so a surface
    // that captured `model`, `messages`, `viewport`, `tour` or `capabilities`
    // at install time answers for a viewer that is no longer there. Every part
    // below is swapped AFTER the install, and every reading has to move.
    let model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    let viewport = { clientWidth: 800, clientHeight: 600 };
    let capabilities = false;
    let tour: TourControls | undefined;

    const api = installViewerDebug(
      host({
        model: () => model,
        viewport: () => viewport,
        capabilities: () => capabilities,
        tour: () => tour,
      }),
    );
    const firstRooms = api.rooms();
    expect(api.revision()).toBe(0);
    expect(api.tour).toBeUndefined();

    // A different document, a rebuilt shell, a capability turned on, a camera
    // stack that now exists.
    model = new SceneModel(bayPlan, CATALOGUE_REGISTRIES);
    viewport = { clientWidth: 320, clientHeight: 240 };
    capabilities = true;
    tour = { progress: () => null } as unknown as TourControls;

    expect(api.rooms()).not.toEqual(firstRooms);
    expect(api.rooms()).toEqual(bayPlan.rooms.map((room) => room.id));
    // `plan()` reads the new model's solved plan, not the installed one.
    expect(
      api
        .plan()
        .rooms.map((room) => room.id)
        .sort(),
    ).toEqual([...bayPlan.rooms.map((room) => room.id)].sort());
  });

  test('suggestPlacement answers a pose once the lazy layout chunk lands, and changes nothing', async () => {
    // Two facts in one test, because they are the contract: the accessor is
    // SYNCHRONOUS and answers `null` until its module resolves (like
    // `layoutIssues` answering `[]`), and it is a QUERY — the revision after
    // it is the revision before it.
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
    const api = installViewerDebug({ ...host({ model: () => model }), capabilities: () => true });
    const revisionBefore = api.revision();
    // Both dynamic imports are armed at install. Wait on the MECHANISM that
    // produces the answer rather than on a fixed number of microtasks: the
    // module has to land in the registry and then the `.then` that fills the
    // cache has to run.
    await import('../layout/free-space.js');
    for (let tick = 0; tick < 50 && api.suggestPlacement!(ARCHETYPE.sofa_3s) === null; tick += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    const pose = api.suggestPlacement!(ARCHETYPE.sofa_3s);
    expect(pose).not.toBeNull();
    expect(pose!.roomId).toBe(L_SHAPE.room.a);
    expect(pose!.position.y).toBe(0);
    expect(['sampled', 'room-centre']).toContain(pose!.how);
    expect(api.revision()).toBe(revisionBefore);
    // A named room is honoured, and an unknown one falls back without throwing.
    expect(api.suggestPlacement!(ARCHETYPE.sofa_3s, L_SHAPE.room.b)!.roomId).toBe(L_SHAPE.room.b);
    expect(api.suggestPlacement!(ARCHETYPE.sofa_3s, FAKE.ghostRoom)!.roomId).toBe(L_SHAPE.room.a);
  });

  test('the authoring half is decided at INSTALL, because it installs members', () => {
    // `capabilities` is a getter like the rest, but the gate it opens adds
    // METHODS to the returned object, so it is read once — the surface is
    // re-installed per document, which is when the option could have changed.
    let capabilities = false;
    const api = installViewerDebug(host({ capabilities: () => capabilities }));
    capabilities = true;
    expect('applyOps' in api).toBe(false);
    expect('applyOps' in installViewerDebug(host({ capabilities: () => capabilities }))).toBe(true);
  });
});
