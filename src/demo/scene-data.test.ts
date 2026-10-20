import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { footprintOf, obstaclesFor } from '../assets/asset-footprint.js';

import { EPS, arcFromChord, arcLength, dist, pointInPolygon, projectOnPolyline } from '../plan/plan-geometry.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import { solvePlan } from '../plan/plan-solver.js';
import { validateScene } from '../scene/scene-validator.js';
import { resolveSurfaceFinish } from '../materials/material-catalogue.js';
import {
  canTraverse,
  isInDoorway as navIsInDoorway,
  isNavigable as navIsNavigable,
  pathBlockedByFurniture,
  resolveNavigationTarget,
} from '../navigation/navigation.js';
import { countIssues, describeIssues, lintLayout } from '../layout/layout-lint.js';
import { applyPresetBatch } from '../scene/interior-presets.js';
import { SceneModel, isApplyOk } from '../scene/scene-model.js';
import { LEAF_REST_ANGLE_RAD, doorLeafQuad, doorSwings } from '../plan/door-swing.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { overlapDepth, polylineSlabs } from '../layout/layout-geometry.js';
import { obbQuad, polylineSlice } from '../plan/plan-geometry.js';
import { FINISH } from '../materials/finish-ids.js';
import { DEMO } from './demo-ids.js';
import { apartmentScene } from './scene-data.js';
import type { Vec2, Vec3, Wall } from '../scene/types.js';

const { room: ROOM, wall: WALL, opening: OPENING } = DEMO;
const ROOM_IDS: readonly string[] = Object.values(ROOM);

const plan: SolvedPlan = solvePlan(apartmentScene);
const nodeAt = (id: string): Vec2 => apartmentScene.nodes.find((node) => node.id === id)!.p;
const wallById = (id: string): Wall => apartmentScene.walls.find((wall) => wall.id === id)!;

/** Centreline length of a wall, arc length for curved walls. */
function wallLength(wall: Wall): number {
  const a = nodeAt(wall.a);
  const b = nodeAt(wall.b);
  if (!wall.arc) return dist(a, b);
  return arcLength(arcFromChord(a, b, wall.arc.radius, wall.arc.ccw));
}

function roomContaining(point: Vec3 | Vec2): string | null {
  const flat: Vec2 = { x: point.x, z: point.z };
  for (const room of plan.rooms) if (pointInPolygon(flat, room.polygon)) return room.roomId;
  return null;
}

/**
 * A tour waypoint may sit inside a door reveal instead of a room: within half
 * the wall thickness plus a small lateral margin of a door centreline and
 * inside the door's `t` interval.
 */
function isInDoorway(point: Vec3 | Vec2, margin = 0.35): boolean {
  const flat: Vec2 = { x: point.x, z: point.z };
  for (const line of plan.centrelines) {
    if (line.doors.length === 0) continue;
    const hit = projectOnPolyline(line.polyline, flat);
    if (!hit || hit.distance > line.thickness / 2 + margin) continue;
    if (line.doors.some((door) => hit.t >= door.t0 - EPS && hit.t <= door.t1 + EPS)) return true;
  }
  return false;
}

describe('apartmentScene plan', () => {
  test('is schema 2.2 in metres with a 2.65 m ceiling', () => {
    expect(apartmentScene.schemaVersion).toBe('2.2');
    expect(apartmentScene.units).toBe('m');
    expect(apartmentScene.ceilingHeight).toBe(2.65);
    expect(apartmentScene.id).toBe(DEMO.scene);
  });

  test('solves into exactly the ten rooms of the programme', () => {
    expect(plan.rooms).toHaveLength(10);
    expect(plan.rooms.map((room) => room.roomId).sort()).toEqual([...ROOM_IDS].sort());
    for (const room of plan.rooms) expect(room.polygon.length).toBeGreaterThanOrEqual(4);
  });

  test('every room anchor is strictly inside its own solved polygon', () => {
    for (const room of apartmentScene.rooms) {
      expect(roomContaining(room.anchor)).toBe(room.id);
    }
  });

  test('the two loggias are marked as loggias, every other room is not', () => {
    const loggias = apartmentScene.rooms.filter((room) => room.kind === 'loggia').map((room) => room.id);
    expect(loggias.sort()).toEqual([ROOM.loggiaNorth, ROOM.loggiaWest].sort());
  });

  test('bearing-central carries two faces 0.38 m apart', () => {
    const faces = [...plan.faces.values()].filter((face) => face.wallId === WALL.bearingCentral);
    expect(faces).toHaveLength(2);
    expect(faces.map((face) => face.roomId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([ROOM.kitchen, ROOM.living].sort());
    // The wall runs north–south at x = 2.20, so the faces are two parallel
    // lines whose x differ by the full thickness.
    const [left, right] = faces as [(typeof faces)[number], (typeof faces)[number]];
    for (const face of faces) {
      for (const point of face.polyline) expect(Math.abs(point.x - face.polyline[0]!.x)).toBeLessThan(1e-6);
    }
    expect(Math.abs(left.polyline[0]!.x - right.polyline[0]!.x)).toBeCloseTo(0.38, 6);
    expect(wallById(WALL.bearingCentral).thickness).toBe(0.38);
    expect(wallById(WALL.bearingCentral).role).toBe('bearing');
  });

  test('the living room loop contains the semicircular bay', () => {
    const living = plan.rooms.find((room) => room.roomId === ROOM.living)!;
    const curved = living.loop.filter((face) => face.arc);
    expect(curved).toHaveLength(1);
    expect(curved[0]!.wallId).toBe(WALL.bayLiving);
    // Room side of a 0.30 wall on a 1.60 radius arc.
    expect(curved[0]!.arc!.radius).toBeCloseTo(1.45, 6);
    // The bay bulges north beyond the straight part of the facade.
    expect(living.bbox.minZ).toBeLessThan(0.0);
  });

  test('wall thicknesses follow the facade / bearing / partition scheme', () => {
    const allowed: Record<string, number> = { facade: 0.3, bearing: 0.38, partition: 0.1 };
    for (const wall of apartmentScene.walls) {
      expect(wall.role).toBeDefined();
      expect(wall.thickness).toBeCloseTo(allowed[wall.role!]!, 6);
    }
  });

  test('every wall centreline is at least 0.5 m long', () => {
    for (const wall of apartmentScene.walls) {
      expect(wallLength(wall)).toBeGreaterThanOrEqual(0.5 - EPS);
    }
  });

  test('openings keep 0.1 m of wall at both ends and never overlap', () => {
    for (const wall of apartmentScene.walls) {
      const length = wallLength(wall);
      const spans = (wall.openings ?? [])
        .map((opening) => ({ id: opening.id, t0: opening.center - opening.width / 2, t1: opening.center + opening.width / 2 }))
        .sort((left, right) => left.t0 - right.t0);
      for (const span of spans) {
        expect(span.t0).toBeGreaterThanOrEqual(0.1 - EPS);
        expect(span.t1).toBeLessThanOrEqual(length - 0.1 + EPS);
      }
      for (let i = 1; i < spans.length; i += 1) {
        expect(spans[i]!.t0).toBeGreaterThanOrEqual(spans[i - 1]!.t1 - EPS);
      }
    }
  });

  test('doors start at the floor and windows sit at sill height', () => {
    for (const wall of apartmentScene.walls) {
      for (const opening of wall.openings ?? []) {
        if (opening.type === 'door') {
          expect(opening.sill ?? 0).toBe(0);
          expect(opening.head!).toBeGreaterThanOrEqual(2.05);
          expect(opening.head!).toBeLessThanOrEqual(2.15);
          expect(opening.width).toBeGreaterThanOrEqual(0.7);
        } else {
          expect(opening.sill!).toBeGreaterThanOrEqual(0.85);
          expect(opening.sill!).toBeLessThanOrEqual(0.9);
          expect(opening.head!).toBeGreaterThanOrEqual(2.2);
          expect(opening.head!).toBeLessThanOrEqual(2.3);
        }
        expect(opening.head!).toBeLessThanOrEqual(apartmentScene.ceilingHeight);
      }
    }
  });

  test('the entrance door is flagged in the data, not guessed from its id', () => {
    const openings = apartmentScene.walls.flatMap((wall) => wall.openings ?? []);
    const entrances = openings.filter((opening) => opening.entrance === true);
    expect(entrances.map((opening) => opening.id)).toEqual([OPENING.doorEntrance]);
  });

  test('walk mode has an authored spawn inside the plan', () => {
    const spawn = apartmentScene.walkSpawn;
    expect(spawn).toBeDefined();
    expect(Number.isFinite(spawn!.position.x) && Number.isFinite(spawn!.position.z)).toBe(true);
    expect(Number.isFinite(spawn!.target.x) && Number.isFinite(spawn!.target.z)).toBe(true);
    // Kept in step with the living-room camera it replaced.
    expect(spawn!.position.x).toBeCloseTo(apartmentScene.roomCameras[ROOM.living]!.position.x, 6);
    expect(spawn!.position.z).toBeCloseTo(apartmentScene.roomCameras[ROOM.living]!.position.z, 6);
  });

  test('the rooms of the photo programme have their windows and doors', () => {
    const openingIds = apartmentScene.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => opening.id));
    for (const id of [
      OPENING.windowLivingBay,
      OPENING.windowStudy,
      OPENING.windowBedroomEast,
      OPENING.windowKitchenSouth,
      OPENING.doorEntrance,
      OPENING.doorKitchenLoggia,
      OPENING.doorGuestLoggia,
      OPENING.doorLivingHall,
      OPENING.doorGuestHall,
      OPENING.doorStudy,
      OPENING.doorBedroom,
      OPENING.doorCloset,
      OPENING.doorBathroom,
    ]) {
      expect(openingIds).toContain(id);
    }
  });
});

describe('apartmentScene contents', () => {
  test('every floor material resolves in the surface catalogue', () => {
    // The resolver is exercised by validateScene; keep the id list explicit here.
    const floors: readonly string[] = [FINISH.oak, FINISH.stone, FINISH.ceramic_light];
    for (const room of apartmentScene.rooms) {
      expect(resolveSurfaceFinish(room.floorMaterial)).not.toBeNull();
      expect(floors).toContain(room.floorMaterial);
    }
    expect(apartmentScene.rooms.find((room) => room.id === ROOM.bathroom)!.floorMaterial).toBe(FINISH.stone);
    for (const id of [ROOM.loggiaWest, ROOM.loggiaNorth]) {
      expect(apartmentScene.rooms.find((room) => room.id === id)!.floorMaterial).toBe(FINISH.ceramic_light);
    }
  });

  test('every asset names its room and sits inside it', () => {
    for (const asset of apartmentScene.assets) {
      expect(ROOM_IDS).toContain(asset.room!);
      expect({ id: asset.id, room: roomContaining(asset.position) }).toEqual({ id: asset.id, room: asset.room ?? null });
    }
  });

  test('every room is furnished', () => {
    for (const id of ROOM_IDS) {
      expect(apartmentScene.assets.filter((asset) => asset.room === id).length).toBeGreaterThanOrEqual(3);
    }
  });

  test('room cameras cover all ten rooms at eye height, inside their room', () => {
    expect(Object.keys(apartmentScene.roomCameras).sort()).toEqual([...ROOM_IDS].sort());
    for (const [roomId, camera] of Object.entries(apartmentScene.roomCameras)) {
      expect(camera.position.y).toBeCloseTo(1.6, 6);
      expect({ roomId, room: roomContaining(camera.position) }).toEqual({ roomId, room: roomId });
    }
  });

  test('from the living spawn, the lounge and the hall doorway are reachable past the furniture', () => {
    // Walk mode drops the camera on `roomCameras.living`; a tap that cannot be
    // reached is refused, so the spawn must not be boxed in by the dining set.
    const spawn = {
      x: apartmentScene.roomCameras[ROOM.living]!.position.x,
      y: 1.65,
      z: apartmentScene.roomCameras[ROOM.living]!.position.z,
    };
    const obstacles = obstaclesFor(apartmentScene);
    const reachable = (target: Vec3): boolean => {
      const resolved = resolveNavigationTarget(plan, apartmentScene, target, obstacles);
      return canTraverse(plan, spawn, resolved) && !pathBlockedByFurniture(obstacles, spawn, resolved);
    };
    expect({ lounge: reachable({ x: 3.6, y: 1.65, z: 2.0 }), hall: reachable({ x: 5.9, y: 1.65, z: 6.2 }) }).toEqual({
      lounge: true,
      hall: true,
    });
  });

  test('every navigation point is inside a room and every room has one', () => {
    const covered = new Set<string>();
    for (const point of apartmentScene.navigation.points) {
      const room = roomContaining(point);
      expect({ point, room }).toEqual({ point, room: room ?? 'outside' });
      expect(room).not.toBeNull();
      covered.add(room!);
    }
    expect([...covered].sort()).toEqual([...ROOM_IDS].sort());
  });

  test('every autotour waypoint is inside a room or in a doorway', () => {
    for (const [index, point] of apartmentScene.autotour.path.entries()) {
      expect(point.y).toBeCloseTo(1.6, 6);
      const ok = roomContaining(point) !== null || isInDoorway(point);
      expect({ index, point, ok }).toEqual({ index, point, ok: true });
    }
  });

  test('every autotour waypoint would be a legal place to stand in walk mode', () => {
    // The same test the walk camera applies: inside a room polygon with the
    // room margin, or inside a door slab. `isInDoorway` above is the scene
    // file's own reading of the plan; this one is `navigation.ts` itself, so a
    // waypoint the viewer would refuse cannot pass review.
    for (const [index, point] of apartmentScene.autotour.path.entries()) {
      const ok = navIsNavigable(plan, point) || navIsInDoorway(plan, point);
      expect({ index, point, ok }).toEqual({ index, point, ok: true });
    }
  });

  test('every consecutive autotour leg is walkable past the furniture', () => {
    // The tour player ignores collision: nothing stops the camera gliding
    // through the dining table, so the route data is the only guard. A leg has
    // to clear both the plan (walls crossed only at doors) and the furniture
    // footprints, so a re-lay of the furniture cannot move a sofa into the route.
    const obstacles = obstaclesFor(apartmentScene);
    const path = apartmentScene.autotour.path;
    for (let index = 0; index + 1 < path.length; index += 1) {
      const from = path[index]!;
      const to = path[index + 1]!;
      const leg = `${index}->${index + 1}`;
      expect({
        leg,
        plan: canTraverse(plan, from, to),
        furniture: !pathBlockedByFurniture(obstacles, from, to),
      }).toEqual({ leg, plan: true, furniture: true });
    }
  });

  test('the autotour visits hall, living, guest room, kitchen, study and bedroom', () => {
    const visited = apartmentScene.autotour.path.map((point) => roomContaining(point)).filter((room): room is string => room !== null);
    for (const id of [ROOM.hall, ROOM.living, ROOM.guestRoom, ROOM.kitchen, ROOM.study, ROOM.bedroom]) {
      expect(visited).toContain(id);
    }
    // The tour dips into the bay, which reaches north of the straight facade.
    expect(apartmentScene.autotour.path.some((point) => roomContaining(point) === ROOM.living && point.z < 0.55)).toBe(true);
  });

  test('gaze keys and speed zones reference real waypoints and slow down in small rooms', () => {
    const last = apartmentScene.autotour.path.length - 1;
    for (const gaze of apartmentScene.autotour.gaze) {
      expect(gaze.at).toBeGreaterThanOrEqual(0);
      expect(gaze.at).toBeLessThanOrEqual(last);
    }
    const zones = apartmentScene.autotour.zones ?? [];
    for (const zone of zones) {
      expect(zone.at).toBeGreaterThanOrEqual(0);
      expect(zone.at).toBeLessThanOrEqual(last);
      expect(zone.speed).toBeGreaterThan(0);
    }
    const kitchenZone = zones.find((zone) => roomContaining(apartmentScene.autotour.path[zone.at]!) === ROOM.kitchen);
    const livingZone = zones.find((zone) => roomContaining(apartmentScene.autotour.path[zone.at]!) === ROOM.living);
    expect(kitchenZone!.speed).toBeLessThan(livingZone!.speed);
  });

  test('validateScene accepts the apartment', () => {
    expect(validateScene(apartmentScene, CATALOGUE_REGISTRIES)).toBe(apartmentScene);
  });
});

describe('apartmentScene layout', () => {
  const issues = lintLayout(apartmentScene, plan);

  test('the furniture layout breaks no hard rule and no soft rule', () => {
    // The message is the report: a failure prints exactly what to move.
    expect(describeIssues(issues)).toBe('0 error(s), 0 warning(s)');
    expect(countIssues(issues)).toEqual({ errors: 0, warnings: 0, byRule: {} });
  });

  test('every resting door leaf clears the walls and the furniture', () => {
    const solids = plan.centrelines.flatMap((line) => {
      const cuts = [...line.doors].sort((left, right) => left.t0 - right.t0);
      const runs: Array<[number, number]> = [];
      let cursor = 0;
      for (const cut of cuts) {
        if (cut.t0 - cursor > 1e-4) runs.push([cursor, cut.t0]);
        cursor = Math.max(cursor, cut.t1);
      }
      if (line.length - cursor > 1e-4) runs.push([cursor, line.length]);
      return runs.flatMap(([t0, t1]) => polylineSlabs(polylineSlice(line.polyline, line.length, t0, t1), line.thickness / 2));
    });
    const footprints = apartmentScene.assets.flatMap((asset) => {
      const footprint = footprintOf(asset);
      if (!footprint) return [];
      return [obbQuad({ x: asset.position.x, z: asset.position.z, hx: footprint.hx, hz: footprint.hz, angle: asset.rotationY ?? 0 })];
    });

    for (const swing of doorSwings(apartmentScene, plan, openingFrameWidth)) {
      const leaf = doorLeafQuad(swing, LEAF_REST_ANGLE_RAD);
      const wall = solids.find((quad) => overlapDepth(leaf, quad) > 0.02);
      const object = footprints.find((quad) => overlapDepth(leaf, quad) > 0.02);
      expect({ door: swing.openingId, wall: wall !== undefined, object: object !== undefined }).toEqual({
        door: swing.openingId,
        wall: false,
        object: false,
      });
    }
  });

  test('every door names the jamb it hangs on and the side it opens to', () => {
    const doors = apartmentScene.walls.flatMap((wall) => (wall.openings ?? []).filter((opening) => opening.type === 'door'));
    expect(doors.length).toBeGreaterThanOrEqual(10);
    for (const door of doors) {
      expect({ id: door.id, hinge: door.hinge, swing: door.swing }).toEqual({ id: door.id, hinge: door.hinge!, swing: door.swing! });
      expect(['a', 'b']).toContain(door.hinge!);
      expect(['in', 'out']).toContain(door.swing!);
    }
  });
});

describe('apartmentScene interiors', () => {
  test('the four presets are the ones the panel offers, in order', () => {
    expect(apartmentScene.interiors?.map((preset) => preset.id)).toEqual(Object.values(DEMO.preset));
  });

  // The whole point of the footprint rule in the preset tables: a preset
  // dresses the flat, it never re-lays it. Apply, then lint.
  test('the layout linter stays at 0/0 under every preset', () => {
    for (const preset of apartmentScene.interiors ?? []) {
      const model = new SceneModel(apartmentScene, CATALOGUE_REGISTRIES);
      const result = applyPresetBatch(model, preset.id);
      expect({ preset: preset.id, ok: isApplyOk(result) }).toEqual({ preset: preset.id, ok: true });
      const issues = lintLayout(model.scene, model.plan);
      expect({ preset: preset.id, issues: describeIssues(issues) }).toEqual({ preset: preset.id, issues: '0 error(s), 0 warning(s)' });
    }
  });
});
