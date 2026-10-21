import * as THREE from 'three';
import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { TourPlayer, TOUR_TRACK_SPEED_FACTOR, type TourPose, type TourProgress, type TourState } from './tour-player.js';
import { GLIDE_MAX_STEP_M, GLIDE_SECONDS } from './pose-glide.js';
import { DEFAULT_TOUR_SPEED_MPS, tourRouteOf } from '../scene/tour-route.js';
import { threeCameraTour } from '../fixtures/tour-three-cameras.js';
import { tourNavigation } from '../navigation/tour-legs.js';
import { isInDoorway, isNavigable } from '../navigation/navigation.js';
import { solvePlan } from '../plan/plan-solver.js';
import { footprintOf } from '../assets/asset-footprint.js';
import { obbQuad } from '../plan/plan-geometry.js';
import { distanceToPolygon, pointInPolygon } from '../plan/plan-geometry.js';
import type { TourCheckpoint, Vec2 } from '../scene/types.js';

const plan = solvePlan(apartmentScene);

/**
 * Clearance the camera has to keep from a furniture footprint edge, metres.
 *
 * Not a body's clearance — the tour is a point on a rail and ignores collision
 * entirely — but enough that the run never grazes or enters a solid. The
 * tightest pass of this apartment's tour is the fillet round the living room's
 * floor lamp on the way back from the bay, about 0.26 m off its footprint.
 */
const CAMERA_CLEARANCE_M = 0.25;

/** Every room the tour is supposed to enter: the whole flat minus the WC. */
const TOURED_ROOMS = [
  DEMO.room.bathroom,
  DEMO.room.bedroom,
  DEMO.room.guestRoom,
  DEMO.room.hall,
  DEMO.room.kitchen,
  DEMO.room.living,
  DEMO.room.loggia,
  DEMO.room.study,
];

/** Ids of the tour cameras this file places itself. */
const CAM = {
  c1: '01a12ffa-7367-7ab6-892c-9abef2fcf694',
  c2: '01a12ffa-7368-7557-9bed-9f19a4a7698c',
  c3: '01a12ffa-7369-7f1c-9f28-fb0e8cb72b59',
  c4: '01a12ffa-736a-77f0-b736-167d556647a1',
  living: '01a12ffa-736b-7a55-821f-745e61e51901',
  bedroom: '01a12ffa-736c-71e4-9c52-b38c8a606200',
  kitchen: '01a12ffa-736d-72d4-89f5-7ee8795bda11',
} as const;

/** Furniture footprints of the demo apartment as plan quads, id kept for the failure message. */
const FOOTPRINTS = apartmentScene.assets.flatMap((asset) => {
  const footprint = footprintOf(asset);
  if (!footprint) return [];
  const quad = obbQuad({ x: asset.position.x, z: asset.position.z, hx: footprint.hx, hz: footprint.hz, angle: asset.rotationY ?? 0 });
  return [{ id: asset.id, quad }];
});

/** Distance from a plan point to a footprint edge; negative inside the footprint. */
function clearanceTo(quad: Vec2[], point: Vec2): number {
  const gap = distanceToPolygon(point, quad).distance;
  return pointInPolygon(point, quad) ? -gap : gap;
}

/** Room whose solved polygon contains the point, or `null` in a doorway or a wall. */
function roomAt(point: Vec2): string | null {
  return plan.rooms.find((room) => pointInPolygon(point, room.polygon))?.roomId ?? null;
}

/** Plays a whole run from the start of the route and returns every emitted pose. */
function playThrough(): Array<{ position: THREE.Vector3; target: THREE.Vector3 }> {
  const poses: Array<{ position: THREE.Vector3; target: THREE.Vector3 }> = [];
  const player = new TourPlayer(apartmentScene, (position, target) => poses.push({ position, target }), {
    onState: () => undefined,
    onProgress: () => undefined,
  });
  player.play();
  let guard = 0;
  while (player.getState() !== 'ended' && guard < 20000) {
    player.update(0.05);
    guard += 1;
  }
  expect(player.getState()).toBe('ended');
  return poses;
}

describe('tour player', () => {
  test('progresses, pauses, resumes, ends, and resets', () => {
    const states: string[] = [];
    const poses: Array<{ position: THREE.Vector3; target: THREE.Vector3 }> = [];
    const player = new TourPlayer(apartmentScene, (position, target) => poses.push({ position, target }), {
      onState: (state) => states.push(state),
      onProgress: () => undefined,
    });

    expect(player.getState()).toBe('ready');
    expect(player.getDuration()).toBeGreaterThan(30);

    player.play();
    player.update(0.5);
    expect(player.getState()).toBe('playing');
    expect(poses.length).toBe(1);

    player.pause();
    const pausedAt = player.getElapsed();
    player.update(1);
    expect(player.getElapsed()).toBe(pausedAt);

    player.play();
    player.update(player.getDuration());
    expect(player.getState()).toBe('ended');
    expect(states).toEqual(['playing', 'paused', 'playing', 'ended']);

    player.stop();
    expect(player.getState()).toBe('ready');
    expect(player.getElapsed()).toBe(0);
  });

  test('single run keeps moving, stays at eye level indoors, and passes through doorways', () => {
    const recorder: { pose: { position: THREE.Vector3; target: THREE.Vector3 } | null } = { pose: null };
    const player = new TourPlayer(
      apartmentScene,
      (position, target) => {
        recorder.pose = { position, target };
      },
      {
        onState: () => undefined,
        onProgress: () => undefined,
      },
    );

    player.play();
    let sawEyeLevel = false;
    let passedBedroomDoor = false;
    let gazedAtTvWall = false;
    // A route that doubles back (kitchen, study) has a short low-displacement
    // window at each U-turn, so a single slow step is normal; a stall is a long
    // run of them. Measured as consecutive sub-threshold steps, excluding the
    // ease-in and the final hold on the closing view.
    let stall = 0;
    let longestStall = 0;
    let previous: THREE.Vector3 | null = null;
    let guard = 0;
    while (player.getState() !== 'ended' && guard < 3000) {
      player.update(0.2);
      guard += 1;
      const pose = recorder.pose;
      if (!pose) break;
      if (Math.abs(pose.position.y - 1.6) < 0.01) sawEyeLevel = true;
      // Waypoint 35 of the demo tour: the centre of the bedroom door.
      if (pose.position.distanceTo(new THREE.Vector3(7.7, 1.6, 5.2)) < 0.45) passedBedroomDoor = true;
      // Gaze key at waypoint 5: the media unit on the living room's west wall.
      if (pose.target.distanceTo(new THREE.Vector3(0.36, 1.0, 6.0)) < 1.2) gazedAtTvWall = true;
      const settling = player.getDuration() - player.getElapsed() < 0.5;
      if (previous && pose.position.y < 3 && previous.y < 3 && guard > 15 && !settling) {
        stall = pose.position.distanceTo(previous) < 0.08 ? stall + 1 : 0;
        longestStall = Math.max(longestStall, stall);
      }
      previous = pose.position.clone();
    }

    expect(sawEyeLevel).toBe(true);
    expect(passedBedroomDoor).toBe(true);
    expect(gazedAtTvWall).toBe(true);
    expect(longestStall).toBeLessThanOrEqual(3);
    expect(player.getState()).toBe('ended');
  });

  test('the smoothed run enters every room of the flat except the WC', () => {
    // Measured on the SMOOTHED path, not the authored waypoints: the corner
    // fillets are what the viewer actually flies, and they are free to cut a
    // room's only waypoint short.
    const visited = new Set<string>();
    for (const pose of playThrough()) {
      const room = roomAt({ x: pose.position.x, z: pose.position.z });
      if (room) visited.add(room);
    }
    expect([...visited].sort()).toEqual([...TOURED_ROOMS].sort());
  });

  test('the smoothed run never grazes a furniture footprint', () => {
    // The tour ignores collision, so nothing but the route data keeps the
    // camera out of the sofa. Fillets included: a corner cut is exactly how a
    // clean-looking polyline ends up inside the dining set.
    let worst = { clearance: Number.POSITIVE_INFINITY, id: '', at: '' };
    for (const pose of playThrough()) {
      const point = { x: pose.position.x, z: pose.position.z };
      for (const { id, quad } of FOOTPRINTS) {
        const clearance = clearanceTo(quad, point);
        if (clearance < worst.clearance) {
          worst = { clearance, id, at: `${point.x.toFixed(2)}, ${point.z.toFixed(2)}` };
        }
      }
    }
    // The message is the report: a failure names the object and the plan point.
    expect({ id: worst.id, at: worst.at, clear: worst.clearance >= CAMERA_CLEARANCE_M }).toEqual({
      id: worst.id,
      at: worst.at,
      clear: true,
    });
  });

  test('replaying from the final pose does not jump to the start of the path', () => {
    const recorder: { pose: { position: THREE.Vector3; target: THREE.Vector3 } | null } = { pose: null };
    const player = new TourPlayer(
      apartmentScene,
      (position, target) => {
        recorder.pose = { position, target };
      },
      {
        onState: () => undefined,
        onProgress: () => undefined,
      },
    );

    player.play();
    player.update(player.getDuration());
    expect(player.getState()).toBe('ended');
    const finalPose = recorder.pose!;

    player.play(finalPose);
    player.update(0.05);
    expect(recorder.pose!.position.distanceTo(finalPose.position)).toBeLessThan(0.05);
  });

  test('a lead-in pose eases into the tour instead of snapping', () => {
    const recorder: { pose: { position: THREE.Vector3; target: THREE.Vector3 } | null } = { pose: null };
    const player = new TourPlayer(
      apartmentScene,
      (position, target) => {
        recorder.pose = { position, target };
      },
      {
        onState: () => undefined,
        onProgress: () => undefined,
      },
    );

    const away = { position: new THREE.Vector3(2, 5, 3), target: new THREE.Vector3(8, 1, 5) };
    player.play(away);
    player.update(1.2);
    expect(recorder.pose).not.toBeNull();
    const movedAwayFromStart = recorder.pose!.position.distanceTo(away.position) > 0.05;
    // Still easing: 1.2 s in, the pose has not snapped onto the route's first waypoint.
    const first = apartmentScene.autotour.path[0]!;
    const notYetOnRoute = recorder.pose!.position.distanceTo(new THREE.Vector3(first.x, first.y, first.z)) > 0.5;
    expect(movedAwayFromStart).toBe(true);
    expect(notYetOnRoute).toBe(true);
  });
});

/** A player over the demo route with a pose recorder and event logs. */
function makePlayer(): {
  player: TourPlayer;
  pose: () => { position: THREE.Vector3; target: THREE.Vector3 } | null;
  states: TourState[];
  progress: TourProgress[];
} {
  const recorder: { pose: { position: THREE.Vector3; target: THREE.Vector3 } | null } = { pose: null };
  const states: TourState[] = [];
  const progress: TourProgress[] = [];
  const player = new TourPlayer(
    apartmentScene,
    (position, target) => {
      recorder.pose = { position: position.clone(), target: target.clone() };
    },
    {
      onState: (state) => states.push(state),
      onProgress: (value) => progress.push(value),
    },
  );
  return { player, pose: () => recorder.pose, states, progress };
}

/** Route distance at every tenth of the run; the fingerprint of the authored route. */
function routeFingerprint(player: TourPlayer): number[] {
  const out: number[] = [];
  for (let step = 0; step <= 10; step += 1) {
    player.seek(step / 10);
    out.push(player.progress().distance);
  }
  return out;
}

describe('tour player seeking', () => {
  test('timeAt inverts distanceAt over the whole route', () => {
    const { player } = makePlayer();
    const length = player.length();
    expect(length).toBeGreaterThan(10);
    for (let step = 0; step <= 20; step += 1) {
      const distance = (step / 20) * length;
      expect(Math.abs(player.distanceAt(player.timeAt(distance)) - distance)).toBeLessThan(0.05);
    }
  });

  test('seek(0.5) places the pose at half the route and reports it while paused', () => {
    const { player, pose, progress } = makePlayer();
    player.seek(0.5);
    expect(player.getState()).toBe('paused');
    const emitted = progress.at(-1)!;
    expect(emitted.fraction).toBeCloseTo(0.5, 3);
    expect(emitted.distance).toBeCloseTo(0.5 * player.length(), 3);
    expect(emitted.length).toBeCloseTo(player.length(), 6);
    const half = pose()!.position.clone();

    // The same fraction always lands on the same point of the route. A quarter
    // in, the tour is in the living room beside the bay, far from the hall it
    // is in at half way.
    player.seek(0.25);
    expect(pose()!.position.distanceTo(half)).toBeGreaterThan(0.5);
    player.seek(0.5);
    expect(pose()!.position.distanceTo(half)).toBeLessThan(1e-6);
  });

  test('seekDistance and seekTime agree with seek', () => {
    const { player, pose } = makePlayer();
    player.seek(0.42);
    const byFraction = pose()!.position.clone();
    const elapsed = player.progress().elapsed;

    player.seek(0);
    player.seekDistance(0.42 * player.length());
    expect(pose()!.position.distanceTo(byFraction)).toBeLessThan(1e-6);

    player.seek(0);
    player.seekTime(elapsed);
    expect(pose()!.position.distanceTo(byFraction)).toBeLessThan(0.05);
  });

  test('seek clamps to the route and saturates the fraction at 1', () => {
    const { player } = makePlayer();
    player.seek(-3);
    expect(player.progress().distance).toBe(0);
    player.seek(4);
    expect(player.progress().fraction).toBeCloseTo(1, 6);
    expect(player.progress().distance).toBeCloseTo(player.length(), 6);
  });

  test('the tour state table holds', () => {
    const { player } = makePlayer();
    expect(player.getState()).toBe('ready');
    player.pause();
    expect(player.getState()).toBe('ready');
    player.seek(0.2);
    expect(player.getState()).toBe('paused');

    // paused -> playing resumes from the seeked distance, with no approach
    const distance = player.progress().distance;
    player.play();
    expect(player.getState()).toBe('playing');
    expect(player.progress().distance).toBeCloseTo(distance, 6);

    player.seek(0.3);
    expect(player.getState()).toBe('playing');
    player.pause();
    expect(player.getState()).toBe('paused');
    player.play();
    expect(player.getState()).toBe('playing');

    // seek(1) while playing ends the run; while paused it stays paused
    player.seek(1);
    expect(player.getState()).toBe('ended');
    player.seek(0.5);
    expect(player.getState()).toBe('paused');
    player.seek(1);
    expect(player.getState()).toBe('paused');

    player.stop();
    expect(player.getState()).toBe('ready');
    expect(player.progress().distance).toBe(0);
  });

  test('pose and progress are emitted on every seek in every state', () => {
    const { player, progress, pose } = makePlayer();
    progress.length = 0;
    player.seek(0.1); // ready -> paused
    const first = pose()!.position.clone();
    player.seek(0.2); // paused
    player.play();
    player.seek(0.3); // playing
    player.seek(1); // playing -> ended
    player.seek(0.4); // ended -> paused
    expect(progress.length).toBe(5);
    expect(progress.map((entry) => entry.state)).toEqual(['paused', 'paused', 'playing', 'ended', 'paused']);
    expect(pose()!.position.distanceTo(first)).toBeGreaterThan(0.5);
  });
});

describe('the approach phase', () => {
  test('leaves the authored route length, duration and samples untouched', () => {
    const { player } = makePlayer();
    const length = player.length();
    const duration = player.getDuration();
    const before = routeFingerprint(player);
    player.stop();

    player.play({ position: new THREE.Vector3(2, 5, 3), target: new THREE.Vector3(8, 1, 5) });
    expect(player.length()).toBeCloseTo(length, 6);
    expect(player.getDuration()).toBeCloseTo(duration, 6);
    expect(routeFingerprint(player)).toEqual(before);
  });

  test('reports fraction 0 until it reaches the route, then hands over', () => {
    const { player, pose } = makePlayer();
    const away = { position: new THREE.Vector3(2, 5, 3), target: new THREE.Vector3(8, 1, 5) };
    player.play(away);
    player.update(0.4);
    expect(player.progress().fraction).toBe(0);
    expect(player.progress().elapsed).toBe(0);
    expect(pose()!.position.distanceTo(away.position)).toBeGreaterThan(0);

    let elapsed = 0;
    while (player.progress().fraction === 0 && elapsed < 60) {
      player.update(0.1);
      elapsed += 0.1;
    }
    // A fly-in, not a second tour: it lands within its own budget.
    expect(elapsed).toBeLessThan(12);
    expect(player.getState()).toBe('playing');
  });

  test('a seek cancels the approach and jumps onto the route', () => {
    const { player, pose } = makePlayer();
    player.play({ position: new THREE.Vector3(2, 5, 3), target: new THREE.Vector3(8, 1, 5) });
    player.update(0.4);
    player.seek(0.5);
    expect(player.progress().fraction).toBeCloseTo(0.5, 3);
    const half = pose()!.position.clone();
    player.update(0.05);
    expect(pose()!.position.distanceTo(half)).toBeLessThan(0.5);
  });
});

describe('DEFAULT_TOUR_SPEED_MPS', () => {
  test('is the cruise speed a route uses when it authors no speed of its own', () => {
    const longRunScene = {
      ...apartmentScene,
      autotour: {
        path: [
          { x: 0, y: 1.6, z: 0 },
          { x: 40, y: 1.6, z: 0 },
        ],
        gaze: [],
      },
    };
    let elapsed = 0;
    const player = new TourPlayer(longRunScene, () => undefined, {
      onState: () => undefined,
      onProgress: (progress) => {
        elapsed = progress.elapsed;
      },
    });
    player.play();
    // Well past the start ramp, so the run is at cruise speed: distance
    // covered in one second should match DEFAULT_TOUR_SPEED_MPS closely.
    for (let i = 0; i < 100; i += 1) player.update(0.05);
    const distanceAtFiveSeconds = player.distanceAt(elapsed);
    player.update(1);
    const distanceOneSecondLater = player.distanceAt(player.progress().elapsed);
    expect(distanceOneSecondLater - distanceAtFiveSeconds).toBeCloseTo(DEFAULT_TOUR_SPEED_MPS, 1);
  });
});

describe('setRoute', () => {
  test('preserves the fraction and the state', () => {
    const { player } = makePlayer();
    player.seek(0.4);
    player.play();
    expect(player.getState()).toBe('playing');
    player.setRoute(apartmentScene.autotour);
    expect(player.getState()).toBe('playing');
    expect(player.progress().fraction).toBeCloseTo(0.4, 3);
  });
});

describe('a checkpoint tour', () => {
  /** Four cameras around two corners; camera 3 looks back the way the tour came. */
  const CHECKPOINTS = [
    { id: CAM.c1, position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 },
    { id: CAM.c2, position: { x: 0, y: 1.6, z: 3 }, yaw: Math.PI / 2, pitch: -0.1 },
    { id: CAM.c3, position: { x: 3, y: 1.6, z: 3 }, yaw: -Math.PI / 2, pitch: 0 },
    { id: CAM.c4, position: { x: 3, y: 1.6, z: 6 }, yaw: 0, pitch: 0.1 },
  ];
  const scene = { ...apartmentScene, tourCheckpoints: CHECKPOINTS };

  function run(): Array<{ position: THREE.Vector3; target: THREE.Vector3 }> {
    const poses: Array<{ position: THREE.Vector3; target: THREE.Vector3 }> = [];
    const player = new TourPlayer(scene, (position, target) => poses.push({ position: position.clone(), target: target.clone() }), {
      onState: () => undefined,
      onProgress: () => undefined,
    });
    player.play();
    for (let guard = 0; player.getState() !== 'ended' && guard < 20000; guard += 1) player.update(1 / 60);
    return poses;
  }

  test('stands on every camera and sees what that camera sees', () => {
    const poses = run();
    for (const checkpoint of CHECKPOINTS) {
      const at = new THREE.Vector3(checkpoint.position.x, checkpoint.position.y, checkpoint.position.z);
      const nearest = poses.reduce((best, pose) => (pose.position.distanceTo(at) < best.position.distanceTo(at) ? pose : best));
      expect(nearest.position.distanceTo(at)).toBeLessThan(0.08);
      const look = nearest.target.clone().sub(nearest.position).normalize();
      const want = new THREE.Vector3(
        Math.sin(checkpoint.yaw) * Math.cos(checkpoint.pitch),
        Math.sin(checkpoint.pitch),
        Math.cos(checkpoint.yaw) * Math.cos(checkpoint.pitch),
      );
      expect(look.angleTo(want)).toBeLessThan((6 / 180) * Math.PI);
    }
  });

  test('never jumps: position and look direction change a little every frame', () => {
    const poses = run();
    let fastestTurn = 0;
    let longestStep = 0;
    for (let index = 1; index < poses.length; index += 1) {
      const previous = poses[index - 1]!;
      const pose = poses[index]!;
      longestStep = Math.max(longestStep, pose.position.distanceTo(previous.position));
      const a = previous.target.clone().sub(previous.position).normalize();
      const b = pose.target.clone().sub(pose.position).normalize();
      fastestTurn = Math.max(fastestTurn, a.angleTo(b));
    }
    // 60 fps at the demo's cruise speed; a gaze that snapped or passed through
    // the camera on camera 3's turn-around would turn tens of degrees in a frame.
    expect(longestStep).toBeLessThan(0.1);
    expect(fastestTurn).toBeLessThan((4 / 180) * Math.PI);
  });
});

describe('a checkpoint tour through the flat', () => {
  const scene = threeCameraTour;
  const cameras = scene.tourCheckpoints!;
  const tourPlan = solvePlan(scene);
  const navigation = tourNavigation(tourPlan, scene);

  /** Unit look direction of a checkpoint's yaw/pitch. */
  function lookOf(camera: TourCheckpoint): THREE.Vector3 {
    return new THREE.Vector3(
      Math.sin(camera.yaw) * Math.cos(camera.pitch),
      Math.sin(camera.pitch),
      Math.cos(camera.yaw) * Math.cos(camera.pitch),
    );
  }

  /** Yaw and pitch of a pose's gaze. */
  function aimOf(pose: { position: THREE.Vector3; target: THREE.Vector3 }): { yaw: number; pitch: number } {
    const look = pose.target.clone().sub(pose.position).normalize();
    return { yaw: Math.atan2(look.x, look.z), pitch: Math.asin(look.y) };
  }

  function angleGap(a: number, b: number): number {
    return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  }

  function makeRun(options: { instant?: boolean; pose?: () => { position: THREE.Vector3; target: THREE.Vector3 } } = {}): {
    player: TourPlayer;
    poses: Array<{ position: THREE.Vector3; target: THREE.Vector3 }>;
  } {
    const poses: Array<{ position: THREE.Vector3; target: THREE.Vector3 }> = [];
    const player = new TourPlayer(
      scene,
      (position, target) => poses.push({ position: position.clone(), target: target.clone() }),
      { onState: () => undefined, onProgress: () => undefined, pose: options.pose },
      navigation,
    );
    if (options.instant) player.setMotionInstant(true);
    return { player, poses };
  }

  /** Camera `index`'s place, as a vector. */
  function placeOf(index: number): THREE.Vector3 {
    const { position } = cameras[index]!;
    return new THREE.Vector3(position.x, position.y, position.z);
  }

  /** Camera 1's own pose: standing there, looking its way. */
  const onCameraOne = (): { position: THREE.Vector3; target: THREE.Vector3 } => ({
    position: placeOf(0),
    target: placeOf(0).add(lookOf(cameras[0]!)),
  });

  /** The presentation view the Tour button is pressed from: far outside, high up. */
  const outside = { position: new THREE.Vector3(4, 9, -6), target: new THREE.Vector3(4, 0, 2.5) };

  function playToEnd(player: TourPlayer, from = outside): void {
    player.play(from);
    for (let guard = 0; player.getState() !== 'ended' && guard < 20000; guard += 1) player.update(1 / 60);
    expect(player.getState()).toBe('ended');
  }

  test('the run opens with a one-second glide from the current view to camera 1, a straight eased line', () => {
    const { player, poses } = makeRun();
    player.play(outside);
    const frame = 1 / 60;
    const frames = Math.round(GLIDE_SECONDS / frame);
    for (let index = 0; index < frames - 1; index += 1) player.update(frame);
    // The whole glide belongs to the opening: the route has not started.
    expect(player.progress().fraction).toBe(0);
    expect(player.getElapsed()).toBe(0);
    const glide = poses.slice();
    expect(glide).toHaveLength(frames - 1);
    // It starts ON the view it was entered from, and eases in and out: the
    // first and last steps are short, the middle ones long.
    expect(glide[0]!.position.distanceTo(outside.position)).toBeLessThan(0.05);
    const step = (index: number): number => glide[index + 1]!.position.distanceTo(glide[index]!.position);
    const middle = Math.floor(glide.length / 2);
    expect(step(0)).toBeLessThan(step(middle) / 5);
    expect(step(glide.length - 2)).toBeLessThan(step(middle) / 5);
    // A straight line from the view to camera 1, nothing beside it.
    const line = new THREE.Line3(outside.position, placeOf(0));
    for (const pose of glide)
      expect(line.closestPointToPoint(pose.position, true, new THREE.Vector3()).distanceTo(pose.position)).toBeLessThan(1e-6);
    // The last frame of the second lands on camera 1's exact pose.
    player.update(frame);
    const landed = poses.at(-1)!;
    expect(landed.position.distanceTo(placeOf(0))).toBeLessThan(1e-3);
    expect(angleGap(aimOf(landed).yaw, cameras[0]!.yaw)).toBeLessThan(1e-3);
    expect(Math.abs(aimOf(landed).pitch - cameras[0]!.pitch)).toBeLessThan(1e-3);
  });

  test("the look turns with the glide: from the view it was entered with to camera 1's, along the short arc", () => {
    const { player, poses } = makeRun();
    player.play(outside);
    for (let t = 0; t < GLIDE_SECONDS - 1e-6; t += 1 / 60) player.update(1 / 60);
    const start = aimOf(outside);
    const end = { yaw: cameras[0]!.yaw, pitch: cameras[0]!.pitch };
    const turn = angleGap(start.yaw, end.yaw);
    for (const pose of poses) {
      // Never swings the long way round: each yaw is within the short arc.
      const aim = aimOf(pose);
      expect(angleGap(aim.yaw, start.yaw) + angleGap(aim.yaw, end.yaw)).toBeLessThan(turn + 1e-6);
    }
  });

  test('a slow frame slows the glide instead of jumping it: no drawn step is longer than GLIDE_MAX_STEP_M', () => {
    // The presentation view of a real flat: about 24 m from camera 1.
    const far = { position: placeOf(0).add(new THREE.Vector3(2, 14, 19)), target: placeOf(0) };
    expect(far.position.distanceTo(placeOf(0))).toBeGreaterThan(23);
    const { player, poses } = makeRun();
    player.play(far);
    // Frames at the runtime's delta clamp (20 fps and slower): a plain one-second
    // ease would move the camera 1.8 m in one of them.
    const frame = 0.05;
    for (let guard = 0; poses.length === 0 || poses.at(-1)!.position.distanceTo(placeOf(0)) > 1e-3; guard += 1) {
      expect(guard).toBeLessThan(400);
      player.update(frame);
    }
    const steps = poses.map((pose, index) => (index === 0 ? 0 : pose.position.distanceTo(poses[index - 1]!.position)));
    expect(Math.max(...steps)).toBeLessThanOrEqual(GLIDE_MAX_STEP_M + 1e-9);
    // Still one straight eased glide, only longer than a second.
    expect(poses.length).toBeGreaterThan(GLIDE_SECONDS / frame);
    const line = new THREE.Line3(far.position, placeOf(0));
    // The landing frame hands its leftover seconds to the route, so it may stand a hair past camera 1.
    for (const pose of poses.slice(0, -1))
      expect(line.closestPointToPoint(pose.position, true, new THREE.Vector3()).distanceTo(pose.position)).toBeLessThan(1e-6);
  });

  test('at 60 fps the same glide is untouched: exactly GLIDE_SECONDS long', () => {
    const far = { position: placeOf(0).add(new THREE.Vector3(2, 14, 19)), target: placeOf(0) };
    const { player, poses } = makeRun();
    player.play(far);
    const frames = Math.round(GLIDE_SECONDS * 60);
    for (let index = 0; index < frames; index += 1) player.update(1 / 60);
    expect(poses[frames - 1]!.position.distanceTo(placeOf(0))).toBeLessThan(1e-3);
    expect(poses[frames - 2]!.position.distanceTo(placeOf(0))).toBeGreaterThan(1e-3);
  });

  test('under reduced motion the entry is a plain cut on the first frame', () => {
    const { player, poses } = makeRun({ instant: true });
    player.play(outside);
    player.update(1 / 60);
    expect(poses).toHaveLength(1);
    expect(poses[0]!.position.distanceTo(placeOf(0))).toBeLessThan(1e-9);
    expect(angleGap(aimOf(poses[0]!).yaw, cameras[0]!.yaw)).toBeLessThan(1e-3);
  });

  test('a camera already on camera 1, looking its way, needs no glide: the ride starts at once', () => {
    const { player, poses } = makeRun();
    player.play(onCameraOne());
    player.update(1 / 60);
    expect(player.progress().distance).toBeGreaterThan(0);
    expect(poses[0]!.position.distanceTo(placeOf(0))).toBeLessThan(0.05);
  });

  test('play() without a pose glides from where the camera is, read from the host', () => {
    const { player, poses } = makeRun({ pose: () => outside });
    player.play();
    player.update(1 / 60);
    expect(poses[0]!.position.distanceTo(outside.position)).toBeLessThan(0.05);
    expect(player.progress().fraction).toBe(0);
  });

  test("the gaze at each camera is that camera's exact pose (1e-3 rad)", () => {
    const route = tourRouteOf(scene, navigation);
    const { player, poses } = makeRun();
    const along = [0];
    for (let index = 1; index < route.path.length; index += 1) {
      const a = route.path[index - 1]!;
      const b = route.path[index]!;
      along.push(along[index - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    const cameraKeys = (route.gaze ?? []).filter((key) => 'direction' in key);
    expect(cameraKeys).toHaveLength(cameras.length);
    for (const [index, camera] of cameras.entries()) {
      player.seekDistance(along[cameraKeys[index]!.at]!);
      const pose = poses.at(-1)!;
      expect(pose.position.distanceTo(new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z))).toBeLessThan(1e-6);
      expect(angleGap(aimOf(pose).yaw, camera.yaw)).toBeLessThan(1e-3);
      expect(Math.abs(aimOf(pose).pitch - camera.pitch)).toBeLessThan(1e-3);
    }
  });

  test('the ride stays on walkable ground, never aims under the floor, and ends on the last camera in its pose', () => {
    const { player, poses } = makeRun();
    // Entered on camera 1: the glide (the one deliberate straight line) is not part of the ride.
    playToEnd(player, onCameraOne());
    for (const pose of poses) {
      expect(isNavigable(tourPlan, pose.position) || isInDoorway(tourPlan, pose.position)).toBe(true);
      expect(pose.target.y).toBeGreaterThanOrEqual(0);
    }
    const last = poses.at(-1)!;
    const camera = cameras.at(-1)!;
    expect(last.position.distanceTo(new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z))).toBeLessThan(1e-9);
    expect(angleGap(aimOf(last).yaw, camera.yaw)).toBeLessThan(1e-3);
    expect(Math.abs(aimOf(last).pitch - camera.pitch)).toBeLessThan(1e-3);
  });

  test('between the cameras the view is level and looks along the travel direction', () => {
    const route = tourRouteOf(scene, navigation);
    const keys = route.gaze ?? [];
    const { player, poses } = makeRun();
    const along = [0];
    for (let index = 1; index < route.path.length; index += 1) {
      const a = route.path[index - 1]!;
      const b = route.path[index]!;
      along.push(along[index - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    // Midway between each pair of travel keys: pitch 0, yaw along the path.
    let checked = 0;
    for (let index = 0; index + 1 < keys.length; index += 1) {
      if (!('travel' in keys[index]!) || !('travel' in keys[index + 1]!)) continue;
      const middle = (along[keys[index]!.at]! + along[keys[index + 1]!.at]!) / 2;
      player.seekDistance(middle);
      const pose = poses.at(-1)!;
      expect(Math.abs(aimOf(pose).pitch)).toBeLessThan(1e-6);
      player.seekDistance(middle + 0.3);
      const ahead = poses.at(-1)!.position.clone().sub(pose.position);
      // The look reads a one-metre stride ahead; the local tangent may bend away from it on a curve.
      expect(angleGap(aimOf(pose).yaw, Math.atan2(ahead.x, ahead.z))).toBeLessThan((20 / 180) * Math.PI);
      checked += 1;
    }
    expect(checked).toBe(cameras.length - 1);
  });

  test('never jumps, and a leg that turns back turns through the short arc and slows at the turn', () => {
    // The demo flat: the bedroom is a dead end, so the run turns back at its camera.
    const demoCameras: TourCheckpoint[] = [
      { id: CAM.living, position: { x: 4.4, y: 1.55, z: 2.4 }, yaw: 0.5, pitch: -0.3 },
      { id: CAM.bedroom, position: { x: 11.9, y: 1.6, z: 8.4 }, yaw: Math.PI, pitch: -0.2 },
      { id: CAM.kitchen, position: { x: 1.1, y: 1.5, z: 5.2 }, yaw: -Math.PI / 2, pitch: -0.4 },
    ];
    const demo = { ...apartmentScene, tourCheckpoints: demoCameras };
    const poses: Array<{ position: THREE.Vector3; target: THREE.Vector3 }> = [];
    const player = new TourPlayer(
      demo,
      (position, target) => poses.push({ position: position.clone(), target: target.clone() }),
      {
        onState: () => undefined,
        onProgress: () => undefined,
      },
      tourNavigation(plan, demo),
    );
    player.setMotionInstant(true);
    player.play();
    for (let guard = 0; player.getState() !== 'ended' && guard < 20000; guard += 1) player.update(1 / 60);
    let fastestTurn = 0;
    let longestStep = 0;
    let slowestNearBedroom = Number.POSITIVE_INFINITY;
    const bedroom = new THREE.Vector3(11.9, 1.6, 8.4);
    for (let index = 1; index < poses.length; index += 1) {
      const previous = poses[index - 1]!;
      const pose = poses[index]!;
      const step = pose.position.distanceTo(previous.position);
      longestStep = Math.max(longestStep, step);
      if (pose.position.distanceTo(bedroom) < 0.05) slowestNearBedroom = Math.min(slowestNearBedroom, step);
      const a = previous.target.clone().sub(previous.position).normalize();
      const b = pose.target.clone().sub(pose.position).normalize();
      fastestTurn = Math.max(fastestTurn, a.angleTo(b));
    }
    expect(longestStep).toBeLessThan(0.1);
    expect(fastestTurn).toBeLessThan((4 / 180) * Math.PI);
    // Through the turnaround the run comes to a standstill on the camera (under 1 cm a frame at 60 fps).
    expect(slowestNearBedroom).toBeLessThan(0.01);
  });
});

describe('a checkpoint run eases in and out', () => {
  /** A straight 6 m track: no turn, no turnaround zone, cruise all the way. */
  const CHECKPOINTS = [
    { id: CAM.c1, position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 },
    { id: CAM.c2, position: { x: 0, y: 1.6, z: 3 }, yaw: 0, pitch: 0 },
    { id: CAM.c3, position: { x: 0, y: 1.6, z: 6 }, yaw: 0, pitch: 0 },
  ];
  const FRAME = 1 / 120;
  const cruise = (apartmentScene.autotour.speed ?? DEFAULT_TOUR_SPEED_MPS) * TOUR_TRACK_SPEED_FACTOR;

  function player(): TourPlayer {
    return new TourPlayer({ ...apartmentScene, tourCheckpoints: CHECKPOINTS }, () => undefined, {
      onState: () => undefined,
      onProgress: () => undefined,
    });
  }

  /** Standing on camera 1, looking its way: no glide, the ride is the first thing that moves. */
  const onFirst = (): TourPose => ({ position: new THREE.Vector3(0, 1.6, 0), target: new THREE.Vector3(0, 1.6, 1) });

  /** The speed MEASURED over one frame, as a share of the cruise speed. */
  function measuredFactor(run: TourPlayer): number {
    const before = run.progress().distance;
    run.update(FRAME);
    return (run.progress().distance - before) / (cruise * FRAME);
  }

  function advance(run: TourPlayer, seconds: number): void {
    for (let clock = 0; clock < seconds - 1e-9; clock += FRAME) run.update(FRAME);
  }

  test('from a standstill: about 0 at t = 0, one half at 0.25 s, full speed from 0.5 s', () => {
    const run = player();
    run.play(onFirst());
    expect(measuredFactor(run)).toBeLessThan(0.01);
    advance(run, 0.25 - 2 * FRAME);
    expect(measuredFactor(run)).toBeCloseTo(0.5, 1);
    advance(run, 0.25);
    expect(measuredFactor(run)).toBeCloseTo(1, 2);
  });

  test('into the last camera: mirrored, landing exactly on its pose with no overshoot', () => {
    const run = player();
    run.play(onFirst());
    const samples: Array<{ t: number; d: number }> = [];
    let clock = 0;
    while (run.getState() !== 'ended' && clock < 30) {
      run.update(FRAME);
      clock += FRAME;
      samples.push({ t: clock, d: run.progress().distance });
    }
    const length = run.length();
    expect(Math.max(...samples.map((sample) => sample.d))).toBeLessThanOrEqual(length + 1e-9);
    const arrival = samples.find((sample) => sample.d >= length - 1e-9)!;
    const speedAt = (t: number): number => {
      const index = samples.findIndex((sample) => sample.t >= t - 1e-9);
      return (samples[index + 1]!.d - samples[index]!.d) / (cruise * FRAME);
    };
    expect(speedAt(arrival.t - 0.5 - 2 * FRAME)).toBeCloseTo(1, 1);
    expect(speedAt(arrival.t - 0.25)).toBeCloseTo(0.5, 1);
    expect(speedAt(arrival.t - 2 * FRAME)).toBeLessThan(0.01);
  });

  test('a resume and a play after a seek ease in again; a pause stops at once', () => {
    const run = player();
    run.play(onFirst());
    advance(run, 1.5);
    run.pause();
    const held = run.progress().distance;
    run.update(FRAME);
    expect(run.progress().distance).toBe(held);
    run.play();
    expect(measuredFactor(run)).toBeLessThan(0.01);
    advance(run, 0.5);
    expect(measuredFactor(run)).toBeCloseTo(1, 2);
    run.pause();
    run.seekDistance(1);
    run.play();
    expect(measuredFactor(run)).toBeLessThan(0.01);
  });

  test('a run shorter than a second of travel scales both ramps down and still ends exactly on its last camera', () => {
    // Half a metre: about 0.4 s of travel, so each ramp is cut to about 0.2 s.
    const poses: THREE.Vector3[] = [];
    const short = new TourPlayer(
      { ...apartmentScene, tourCheckpoints: [CHECKPOINTS[0]!, { ...CHECKPOINTS[1]!, position: { x: 0, y: 1.6, z: 0.5 } }] },
      (position) => poses.push(position.clone()),
      { onState: () => undefined, onProgress: () => undefined },
    );
    expect(short.length()).toBeCloseTo(0.5, 6);
    short.play(onFirst());
    for (let guard = 0; short.getState() !== 'ended' && guard < 2000; guard += 1) short.update(FRAME);
    expect(short.getState()).toBe('ended');
    expect(poses.at(-1)!.distanceTo(new THREE.Vector3(0, 1.6, 0.5))).toBeLessThan(1e-9);
    // Monotone along the track: never past the camera and back.
    for (let index = 1; index < poses.length; index += 1) expect(poses[index]!.z).toBeGreaterThanOrEqual(poses[index - 1]!.z - 1e-12);
    expect(Math.max(...poses.map((pose) => pose.z))).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});
