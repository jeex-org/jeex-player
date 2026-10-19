/**
 * The checkpoint route derivation: what the tour rides when the document
 * carries cameras, and what it falls back to when it does not.
 */

import { describe, expect, test } from 'bun:test';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { threeCameraTour } from '../fixtures/tour-three-cameras.js';
import { sixCameraTour } from '../fixtures/tour-six-cameras.js';
import { apartmentScene } from '../demo/scene-data.js';
import { solvePlan } from '../plan/plan-solver.js';
import { isInDoorway, isNavigable, wallBodyAt, wallCrossings } from '../navigation/navigation.js';
import { tourNavigation } from '../navigation/tour-legs.js';
import { TOUR_SPLINE_STEP_M, checkpointPathOf, hasTourRoute, legIsLegal, tourRouteOf, type RouteGazeKey } from './tour-route.js';
import type { SceneData, Vec3 } from './types.js';
import type { TourCheckpoint } from './types.js';

/** Fixed ids for these tests, generated once offline. */
const ID = {
  camA: '01a12ff5-d95d-7934-8b69-922edfff7f7f',
  camB: '01a12ff5-d95e-7a17-b43a-d933b0ca1dcb',
  cam1: '01a12ff5-d95f-74c0-b6d0-557a0f577fb0',
  cam2: '01a12ff5-d960-7e2b-818a-b3cd10b425cb',
  cam3: '01a12ff5-d961-736d-b25a-0d21b14d0819',
  cam4: '01a12ff5-d962-7ef5-95cb-199448ec8753',
  camTwin: '01a12ff5-d963-76a5-939e-edacc9656655',
  camA2: '01a12ff5-d964-7ff9-bbbe-4d11568e01fd',
  camLiving: '01a12ff5-d965-709c-a205-b5a9d6f885f0',
  camBedroom: '01a12ff5-d966-7ee6-9b8e-2f5b9184f829',
  camKitchen: '01a12ff5-d967-7ee0-8cfc-77212d578719',
  windowAb: '01a12ff5-d968-74a8-b525-3d4f4fe176db',
} as const;

const CAM_A: TourCheckpoint = { id: ID.camA, position: { x: 1, y: 1.6, z: 1 }, yaw: 0, pitch: 0 };
const CAM_B: TourCheckpoint = { id: ID.camB, position: { x: 4, y: 1.7, z: 5 }, yaw: Math.PI / 2, pitch: -0.2 };

describe('tourRouteOf', () => {
  test('a document without checkpoints rides the authored autotour verbatim', () => {
    expect(tourRouteOf(lShapePlan)).toBe(lShapePlan.autotour);
    expect(hasTourRoute(lShapePlan)).toBe(false);
  });

  test('one checkpoint is no route: the authored autotour stays', () => {
    const scene = { ...lShapePlan, tourCheckpoints: [CAM_A] };
    expect(hasTourRoute(scene)).toBe(false);
    expect(tourRouteOf(scene)).toBe(scene.autotour);
  });

  test('two checkpoints derive a checkpoint route: path, direction keys and the authored speed', () => {
    const scene = { ...lShapePlan, tourCheckpoints: [CAM_A, CAM_B] };
    const route = tourRouteOf(scene);
    expect(route).not.toBe(scene.autotour);
    expect(route.kind).toBe('checkpoints');
    expect(route.speed).toBe(scene.autotour.speed);
    expect(route.zones).toBeUndefined();
    // The route starts ON the first camera and ends ON the last one.
    expect(route.path[0]).toEqual({ x: 1, y: 1.6, z: 1 });
    expect(route.path.at(-1)).toEqual({ x: 4, y: 1.7, z: 5 });
    // Each camera's key is its own DIRECTION, never a world point.
    const cameraKeys = (route.gaze ?? []).filter((key) => 'direction' in key);
    expect(cameraKeys).toEqual([
      { at: 0, direction: { yaw: 0, pitch: 0 } },
      { at: route.path.length - 1, direction: { yaw: Math.PI / 2, pitch: -0.2 } },
    ]);
    expect((route.gaze ?? []).some((key) => 'target' in key)).toBe(false);
  });

  test('an empty checkpoint list rides the authored autotour', () => {
    expect(tourRouteOf({ ...lShapePlan, tourCheckpoints: [] })).toBe(lShapePlan.autotour);
  });
});

/** Checkpoints around an L: two sharp corners a straight polyline would kink at. */
const L_TOUR: TourCheckpoint[] = [
  { id: ID.cam1, position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 },
  { id: ID.cam2, position: { x: 0, y: 1.6, z: 4 }, yaw: Math.PI / 2, pitch: 0 },
  { id: ID.cam3, position: { x: 4, y: 1.4, z: 4 }, yaw: 0, pitch: 0 },
  { id: ID.cam4, position: { x: 4, y: 1.8, z: 7 }, yaw: Math.PI, pitch: 0 },
];

function direction(a: Vec3, b: Vec3): Vec3 {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length };
}

describe('checkpointPathOf', () => {
  test('the spline passes THROUGH every checkpoint, in tour order', () => {
    const { path, at } = checkpointPathOf(L_TOUR);
    expect(at).toHaveLength(L_TOUR.length);
    for (const [index, checkpoint] of L_TOUR.entries()) expect(path[at[index]!]).toEqual(checkpoint.position);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test('it is smooth: no corner between neighbouring samples, the checkpoints included', () => {
    const { path } = checkpointPathOf(L_TOUR);
    let sharpest = 0;
    for (let index = 1; index < path.length - 1; index += 1) {
      const incoming = direction(path[index - 1]!, path[index]!);
      const outgoing = direction(path[index]!, path[index + 1]!);
      const cos = incoming.x * outgoing.x + incoming.y * outgoing.y + incoming.z * outgoing.z;
      sharpest = Math.max(sharpest, Math.acos(Math.min(1, cos)));
    }
    // A polyline through these cameras turns 90° at cam-2 and cam-3; the
    // spline sampled every decimetre turns a few degrees per sample.
    expect(sharpest).toBeLessThan((10 / 180) * Math.PI);
  });

  test('samples are about TOUR_SPLINE_STEP_M apart', () => {
    const { path } = checkpointPathOf(L_TOUR);
    for (let index = 1; index < path.length; index += 1) {
      const step = Math.hypot(path[index]!.x - path[index - 1]!.x, path[index]!.z - path[index - 1]!.z);
      expect(step).toBeLessThan(TOUR_SPLINE_STEP_M * 1.6);
    }
  });

  test('height never overshoots the two cameras of its span', () => {
    const { path, at } = checkpointPathOf(L_TOUR);
    for (let span = 0; span < L_TOUR.length - 1; span += 1) {
      const low = Math.min(L_TOUR[span]!.position.y, L_TOUR[span + 1]!.position.y);
      const high = Math.max(L_TOUR[span]!.position.y, L_TOUR[span + 1]!.position.y);
      for (let index = at[span]!; index <= at[span + 1]!; index += 1) {
        expect(path[index]!.y).toBeGreaterThanOrEqual(low);
        expect(path[index]!.y).toBeLessThanOrEqual(high);
      }
    }
  });

  test('two cameras on one spot collapse into one point and share it', () => {
    const twin = { ...L_TOUR[1]!, id: ID.camTwin };
    const { path, at } = checkpointPathOf([L_TOUR[0]!, L_TOUR[1]!, twin, L_TOUR[2]!]);
    expect(at[1]).toBe(at[2]);
    expect(path.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))).toBe(true);
  });

  test('every camera on one spot is no trajectory: the authored route stays', () => {
    const scene = { ...lShapePlan, tourCheckpoints: [CAM_A, { ...CAM_A, id: ID.camA2 }] };
    expect(tourRouteOf(scene)).toBe(scene.autotour);
  });
});

/** Every sample of `path` stands on walkable ground or in a doorway passage, never in a wall. */
function offGround(scene: SceneData, path: readonly Vec3[]): Vec3[] {
  const plan = solvePlan(scene);
  return path.filter((point) => !isNavigable(plan, point) && !isInDoorway(plan, point));
}

describe('a walk through the flat', () => {
  const plan = solvePlan(threeCameraTour);
  const navigation = tourNavigation(plan, threeCameraTour);
  const cameras = threeCameraTour.tourCheckpoints!;
  const route = tourRouteOf(threeCameraTour, navigation);

  test('the diagnosis flat: no sample of the route lies inside a wall or off the walkable area', () => {
    expect(route.kind).toBe('checkpoints');
    expect(offGround(threeCameraTour, route.path)).toEqual([]);
  });

  test('without the navigation the bare spline cut through the partition (the defect this pins)', () => {
    expect(offGround(threeCameraTour, tourRouteOf(threeCameraTour).path).length).toBeGreaterThan(0);
  });

  test('the leg from the bedroom camera to the living-room camera passes through the inner door', () => {
    const { path, at } = checkpointPathOf(cameras, navigation);
    // The partition is x = 4 and the door spans z 2.15..3.05: where the leg
    // crosses the partition it is inside the door, clear of both jambs.
    const leg = path.slice(at[0], at[1]! + 1);
    const crossing = leg.findIndex((point, index) => index > 0 && (leg[index - 1]!.x - 4) * (point.x - 4) <= 0);
    expect(crossing).toBeGreaterThan(0);
    const z = (leg[crossing - 1]!.z + leg[crossing]!.z) / 2;
    expect(z).toBeGreaterThan(2.15 + 0.12);
    expect(z).toBeLessThan(3.05 - 0.12);
    // And under the door head (2.1 m), not through the lintel.
    expect(leg[crossing]!.y).toBeLessThan(2.1);
  });

  test('the route starts on camera 1, ends on the last camera, and at[i] lands on every camera', () => {
    const { path, at } = checkpointPathOf(cameras, navigation);
    expect(path[0]).toEqual(cameras[0]!.position);
    expect(path.at(-1)).toEqual(cameras.at(-1)!.position);
    for (const [index, camera] of cameras.entries()) expect(path[at[index]!]).toEqual(camera.position);
    expect(route.path[0]).toEqual(cameras[0]!.position);
    expect(route.path.at(-1)).toEqual(cameras.at(-1)!.position);
  });

  test("between the cameras the gaze is the level travel look, framed by each camera's own direction", () => {
    const keys = route.gaze ?? [];
    const kinds = keys.map((key: RouteGazeKey) => ('direction' in key ? 'camera' : 'travel' in key ? 'travel' : 'target'));
    // Two long legs: camera, travel, travel, camera, travel, travel, camera.
    expect(kinds).toEqual(['camera', 'travel', 'travel', 'camera', 'travel', 'travel', 'camera']);
    expect(keys.map((key) => key.at)).toEqual([...keys.map((key) => key.at)].sort((a, b) => a - b));
  });

  test('the demo apartment: a three-room walk stays on walkable ground and passes every camera', () => {
    const demoCameras: TourCheckpoint[] = [
      { id: ID.camLiving, position: { x: 4.4, y: 1.55, z: 2.4 }, yaw: 0.5, pitch: -0.3 },
      { id: ID.camBedroom, position: { x: 11.9, y: 1.6, z: 8.4 }, yaw: Math.PI, pitch: -0.2 },
      { id: ID.camKitchen, position: { x: 1.1, y: 1.5, z: 5.2 }, yaw: -Math.PI / 2, pitch: -0.4 },
    ];
    const scene = { ...apartmentScene, tourCheckpoints: demoCameras };
    const demoPlan = solvePlan(scene);
    const { path, at } = checkpointPathOf(demoCameras, tourNavigation(demoPlan, scene));
    expect(offGround(scene, path)).toEqual([]);
    for (const [index, camera] of demoCameras.entries()) expect(path[at[index]!]).toEqual(camera.position);
  });
});

// ---- legs cross walls only through openings ---------------------------------

/** One place where the route meets a wall centreline, judged against the scene's own openings. */
type WallHit = { wall: string; opening: string | null; y: number; at: number; x: number; z: number };

/**
 * Every wall the route crosses, told by the SCENE's openings (not the
 * navigation under test): which opening, if any, holds the crossing clear of
 * both jambs by the required 0.15 m, and at what height the route crosses.
 */
function wallHits(scene: SceneData, path: readonly Vec3[]): WallHit[] {
  const plan = solvePlan(scene);
  const hits: WallHit[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    for (const { centreline, point, t } of wallCrossings(plan, a, b)) {
      // A sample ON the centreline (a pinned crossing) ends one hop and starts
      // the next: count it once, on the hop it ends.
      if (Math.hypot(point.x - a.x, point.z - a.z) < 1e-9 && index > 1) continue;
      const wall = scene.walls.find((candidate) => candidate.id === centreline.wallId)!;
      const opening = (wall.openings ?? []).find((candidate) => Math.abs(t - candidate.center) < candidate.width / 2 - 0.15);
      const y = a.y + (b.y - a.y) * (span > 0 ? Math.hypot(point.x - a.x, point.z - a.z) / span : 0);
      hits.push({ wall: wall.id, opening: opening?.id ?? null, y, at: index, x: point.x, z: point.z });
    }
  }
  return hits;
}

/** Samples inside a wall body where the wall has no opening. */
function inSolidWall(scene: SceneData, path: readonly Vec3[]): Vec3[] {
  const plan = solvePlan(scene);
  return path.filter((point) => {
    const hit = wallBodyAt(plan, point);
    if (!hit) return false;
    const wall = scene.walls.find((candidate) => candidate.id === hit.centreline.wallId)!;
    return !(wall.openings ?? []).some((opening) => Math.abs(hit.t - opening.center) < opening.width / 2);
  });
}

/** The sharpest turn between neighbouring hops within `reach` samples of `index`, radians. */
function sharpestTurnNear(path: readonly Vec3[], index: number, reach = 2): number {
  let sharpest = 0;
  for (let at = Math.max(1, index - reach); at <= Math.min(path.length - 2, index + reach); at += 1) {
    const before = direction(path[at - 1]!, path[at]!);
    const after = direction(path[at]!, path[at + 1]!);
    const dot = before.x * after.x + before.y * after.y + before.z * after.z;
    sharpest = Math.max(sharpest, Math.acos(Math.min(1, Math.max(-1, dot))));
  }
  return sharpest;
}

/** `lShapePlan` with its partition's openings replaced. */
function lShapeWithPartition(openings: NonNullable<SceneData['walls'][number]['openings']>): SceneData {
  return { ...lShapePlan, walls: lShapePlan.walls.map((wall) => (wall.id === L_SHAPE.wall.wPart ? { ...wall, openings } : wall)) };
}

const PARTITION_DOOR = lShapePlan.walls.find((wall) => wall.id === L_SHAPE.wall.wPart)!.openings![0]!;
const PARTITION_WINDOW = { id: ID.windowAb, type: 'window', center: 4, width: 1, sill: 0.9, head: 2.1 } as const;
/** A camera in room A and one in room B, high up, looking around. */
const A_TO_B: TourCheckpoint[] = [
  { id: ID.camA, position: { x: 3, y: 1.6, z: 4 }, yaw: Math.PI / 2, pitch: 0 },
  { id: ID.camB, position: { x: 8, y: 2.4, z: 2 }, yaw: 0, pitch: -0.3 },
];

describe('legs cross walls only through openings', () => {
  test('the diagnosis flat: every wall crossing lies inside an opening, and no sample stands in solid wall', () => {
    const route = tourRouteOf(threeCameraTour, tourNavigation(solvePlan(threeCameraTour), threeCameraTour));
    const hits = wallHits(threeCameraTour, route.path);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((hit) => hit.opening === null)).toEqual([]);
    expect(inSolidWall(threeCameraTour, route.path)).toEqual([]);
  });

  test.each([
    [
      'three cameras',
      [
        { id: ID.camLiving, position: { x: 4.4, y: 1.55, z: 2.4 }, yaw: 0.5, pitch: -0.3 },
        { id: ID.camBedroom, position: { x: 11.9, y: 1.6, z: 8.4 }, yaw: Math.PI, pitch: -0.2 },
        { id: ID.camKitchen, position: { x: 1.1, y: 1.5, z: 5.2 }, yaw: -Math.PI / 2, pitch: -0.4 },
      ],
    ],
    // The rounded corners of six legs, three turnarounds and a corridor.
    ['six cameras', sixCameraTour],
  ] as const)(
    'the demo apartment, %s: every wall crossing lies inside an opening, and no sample stands in solid wall',
    (_, demoCameras) => {
      const scene = { ...apartmentScene, tourCheckpoints: [...demoCameras] };
      const route = tourRouteOf(scene, tourNavigation(solvePlan(scene), scene));
      const hits = wallHits(scene, route.path);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.filter((hit) => hit.opening === null)).toEqual([]);
      expect(inSolidWall(scene, route.path)).toEqual([]);
      expect(offGround(scene, route.path)).toEqual([]);
    },
  );

  test('a room reachable only by a window is entered through the window centre, inside its height', () => {
    const scene = lShapeWithPartition([PARTITION_WINDOW]);
    const { path } = checkpointPathOf(A_TO_B, tourNavigation(solvePlan(scene), scene));
    const hits = wallHits(scene, path);
    expect(hits.map((hit) => hit.opening)).toEqual([ID.windowAb]);
    const [hit] = hits;
    expect(Math.abs(hit!.z - 4)).toBeLessThan(0.05);
    // Camera B stands at 2.4 m, above the window head (2.1): the crossing is
    // clamped inside the window, never through the wall above it.
    expect(hit!.y).toBeGreaterThanOrEqual(0.9);
    expect(hit!.y).toBeLessThanOrEqual(2.1 - 0.15 + 1e-6);
    expect(inSolidWall(scene, path)).toEqual([]);
  });

  test('a room with a door never uses a window, even one in the same wall', () => {
    const scene = lShapeWithPartition([PARTITION_DOOR, PARTITION_WINDOW]);
    const { path } = checkpointPathOf(A_TO_B, tourNavigation(solvePlan(scene), scene));
    expect(wallHits(scene, path).map((hit) => hit.opening)).toEqual([L_SHAPE.opening.doorAb]);
  });

  test('the curve stays smooth through a pinned crossing: no kink at the door or the window', () => {
    for (const openings of [[PARTITION_DOOR], [PARTITION_WINDOW]]) {
      const scene = lShapeWithPartition(openings);
      const { path } = checkpointPathOf(A_TO_B, tourNavigation(solvePlan(scene), scene));
      const [hit] = wallHits(scene, path);
      // A kink would be a turn of tens of degrees between two 10 cm hops;
      // the spline's continuous tangent turns a few degrees at most.
      expect(sharpestTurnNear(path, hit!.at)).toBeLessThan((10 / 180) * Math.PI);
    }
  });

  test('the leg check refuses a hop through solid wall and accepts the derived legs', () => {
    const scene = lShapeWithPartition([PARTITION_WINDOW]);
    const navigation = tourNavigation(solvePlan(scene), scene);
    expect(legIsLegal(checkpointPathOf(A_TO_B, navigation).path, navigation)).toBe(true);
    expect(legIsLegal([A_TO_B[0]!.position, { x: 5, y: 1.6, z: 1.5 }, { x: 7, y: 1.6, z: 1.5 }, A_TO_B[1]!.position], navigation)).toBe(
      false,
    );
  });
});
