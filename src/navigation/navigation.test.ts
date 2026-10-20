import { describe, expect, test } from 'bun:test';
import { footprintOf, obstaclesFor } from '../assets/asset-footprint.js';
import { draftOf } from '../shared/committed.js';
import { bayPlan, lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { ARCHETYPE } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { solvePlan } from '../plan/plan-solver.js';
import type { DemoAsset } from '../scene/types.js';
import {
  canTraverse,
  clampToNavigation,
  crossesClosedDoor,
  doorwayAt,
  isInDoorway,
  isNavigable,
  pathBlockedByFurniture,
  resolveNavigationTarget,
} from './navigation.js';

/** Ids of the openings and placements the tests make up. */
const LOCAL = {
  innerWindow: '01a12ff8-a80e-79bc-b7b3-09571c54a799',
  passageAb: '01a12ff8-a80f-7124-987c-e0879645cb9d',
  rug: '01a12ff8-a810-792a-9522-beee8a381683',
  placed: '01a12ff8-a811-71c5-9ea4-3d2668286705',
  library: '01a12ff8-a812-7d3b-8a64-f19e2c07b5d6',
} as const;

const lShape = solvePlan(lShapePlan);
const bay = solvePlan(bayPlan);

/** Distance from a plan point to the boundary of the room polygon that owns it. */
function clearance(plan: ReturnType<typeof solvePlan>, point: { x: number; z: number }): number {
  let best = Number.POSITIVE_INFINITY;
  for (const room of plan.rooms) {
    for (let i = 0; i < room.polygon.length; i += 1) {
      const a = room.polygon[i]!;
      const b = room.polygon[(i + 1) % room.polygon.length]!;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz;
      const t = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * abx + (point.z - a.z) * abz) / l2));
      best = Math.min(best, Math.hypot(point.x - (a.x + abx * t), point.z - (a.z + abz * t)));
    }
  }
  return best;
}

describe('polygon navigation', () => {
  test('accepts points inside a room polygon and rejects the L cut-out', () => {
    // Room A spans (0.15, 0.15)..(5.95, 7.85) with a 0.10 jog at z = 5.
    expect(isNavigable(lShape, { x: 3, y: 0, z: 4 })).toBe(true);
    expect(isNavigable(lShape, { x: 8, y: 0, z: 2.5 })).toBe(true);
    // The notch of the L: outside both room polygons.
    expect(isNavigable(lShape, { x: 8, y: 0, z: 6.5 })).toBe(false);
    // Outside the facade entirely.
    expect(isNavigable(lShape, { x: 12, y: 0, z: 2.5 })).toBe(false);
  });

  test('erodes the polygon by the room margin', () => {
    // 0.10 inside room A's south face: inside the polygon, closer than ROOM_MARGIN.
    expect(isNavigable(lShape, { x: 3, y: 0, z: 0.25 })).toBe(false);
    expect(isNavigable(lShape, { x: 3, y: 0, z: 0.25 }, 0.05)).toBe(true);
    // Just past the eroded band.
    expect(isNavigable(lShape, { x: 3, y: 0, z: 0.4 })).toBe(true);
  });

  test('respects the jog of the partition wall', () => {
    // Room A steps from x = 5.95 (z < 5) to x = 5.85 (z > 5).
    expect(isNavigable(lShape, { x: 5.7, y: 0, z: 3 })).toBe(true);
    expect(isNavigable(lShape, { x: 5.7, y: 0, z: 6 })).toBe(false);
  });

  test('follows the curved wall of the bay', () => {
    // Room polygon arc: radius 1.85 around (2, 0).
    expect(isNavigable(bay, { x: 2, y: 0, z: -1 })).toBe(true);
    expect(isNavigable(bay, { x: 2, y: 0, z: -1.6 })).toBe(true);
    // Inside the polygon but within ROOM_MARGIN of the arc.
    expect(isNavigable(bay, { x: 2, y: 0, z: -1.75 })).toBe(false);
    // Outside the arc: in the wall body / behind the facade.
    expect(isNavigable(bay, { x: 2, y: 0, z: -1.95 })).toBe(false);
    // Behind the arc on the diagonal, where a bbox test would still say "inside".
    expect(isNavigable(bay, { x: 0.4, y: 0, z: -1.4 })).toBe(false);
  });

  test('names the doorway a point stands in, and nothing outside one', () => {
    expect(doorwayAt(lShape, { x: 6, z: 2.5 })).toBe(L_SHAPE.opening.doorAb);
    expect(doorwayAt(lShape, { x: 6, z: 4.5 })).toBeNull();
    expect(doorwayAt(lShape, { x: 3, z: 2.5 })).toBeNull();
  });

  test('recognizes doorways on straight and curved walls', () => {
    // Door of the 0.10 partition: centre 2.5, width 0.9 along w-part (x = 6).
    expect(isInDoorway(lShape, { x: 6, y: 1.65, z: 2.5 })).toBe(true);
    expect(isInDoorway(lShape, { x: 6, y: 1.65, z: 4.5 })).toBe(false);
    // Too far from the centreline to be in the passage.
    expect(isInDoorway(lShape, { x: 6.6, y: 1.65, z: 2.5 })).toBe(false);
    // Door of bay-s: t = 2 measured from (4, 4) towards (0, 4).
    expect(isInDoorway(bay, { x: 2, y: 1.65, z: 4 })).toBe(true);
    expect(isInDoorway(bay, { x: 3.4, y: 1.65, z: 4 })).toBe(false);
    // Windows are not doorways: window-a-south sits at t = 4.15 on w-s-a.
    expect(isInDoorway(lShape, { x: 4.15, y: 1.65, z: 0 })).toBe(false);
  });

  test('walks through a door and stops at a closed partition', () => {
    expect(canTraverse(lShape, { x: 5.5, y: 1.65, z: 2.5 }, { x: 6.5, y: 1.65, z: 2.5 })).toBe(true);
    expect(canTraverse(lShape, { x: 5.5, y: 1.65, z: 1.0 }, { x: 6.5, y: 1.65, z: 1.0 })).toBe(false);
  });

  test('does not treat a window as a passage', () => {
    const withWindow = draftOf(lShapePlan);
    withWindow.walls = withWindow.walls.map((wall) =>
      wall.id === L_SHAPE.wall.wPart
        ? { ...wall, openings: [{ id: LOCAL.innerWindow, type: 'window' as const, center: 2.5, width: 0.9, sill: 0.82, head: 2.35 }] }
        : wall,
    );
    const plan = solvePlan(withWindow);
    expect(canTraverse(plan, { x: 5.5, y: 1.65, z: 2.5 }, { x: 6.5, y: 1.65, z: 2.5 })).toBe(false);
  });

  test('a door interval names the opening that fills it', () => {
    const partition = lShape.centrelines.find((line) => line.wallId === L_SHAPE.wall.wPart)!;
    expect(partition.doors.map((door) => door.openingId)).toEqual([L_SHAPE.opening.doorAb]);
  });

  test('refuses targets outside every room', () => {
    expect(canTraverse(lShape, { x: 8, y: 1.65, z: 2.5 }, { x: 8, y: 1.65, z: 6.5 })).toBe(false);
    expect(canTraverse(bay, { x: 2, y: 1.65, z: 2 }, { x: 2, y: 1.65, z: -2.4 })).toBe(false);
  });

  test('clamps eye height into the room volume', () => {
    const low = clampToNavigation(lShape, 3.15, { x: 3, y: 0, z: 4 });
    const high = clampToNavigation(lShape, 3.15, { x: 3, y: 9, z: 4 });
    expect(low.y).toBe(1.15);
    expect(high.y).toBeCloseTo(2.7, 6);
  });

  test('leaves points inside a room and inside a doorway untouched', () => {
    const inside = clampToNavigation(lShape, 3.15, { x: 3, y: 1.65, z: 4 });
    expect(inside.x).toBe(3);
    expect(inside.z).toBe(4);
    const doorway = clampToNavigation(lShape, 3.15, { x: 6, y: 1.65, z: 2.5 });
    expect(doorway.x).toBe(6);
    expect(doorway.z).toBe(2.5);
  });

  test('pushes a point outside a straight wall back in by WALL_PAD', () => {
    const clamped = clampToNavigation(lShape, 3.15, { x: 3, y: 1.65, z: -0.2 });
    expect(clamped.x).toBeCloseTo(3, 6);
    expect(clamped.z).toBeCloseTo(0.5, 6);
    expect(clearance(lShape, clamped)).toBeCloseTo(0.35, 6);
    const north = clampToNavigation(lShape, 3.15, { x: 3, y: 1.65, z: 7.95 });
    expect(north.z).toBeCloseTo(7.5, 6);
  });

  test('pushes a point outside the bay arc back inside at WALL_PAD', () => {
    const clamped = clampToNavigation(bay, 3.15, { x: 2, y: 1.65, z: -2.6 });
    expect(clamped.x).toBeCloseTo(2, 6);
    expect(clamped.z).toBeGreaterThan(-1.85);
    expect(isNavigable(bay, clamped)).toBe(true);
    expect(Math.abs(clearance(bay, clamped) - 0.35)).toBeLessThan(0.01);
    // The radial direction is kept: the point stays on the bay axis.
    expect(Math.hypot(clamped.x - 2, clamped.z)).toBeCloseTo(1.5, 2);
  });

  test('keeps a clamped corner point clear of both walls', () => {
    const clamped = clampToNavigation(lShape, 3.15, { x: -0.4, y: 1.65, z: -0.4 });
    expect(isNavigable(lShape, clamped)).toBe(true);
  });

  test('blocks walk paths that cross large furniture', () => {
    const obstacles = obstaclesFor(lShapePlan);
    expect(obstacles.length).toBe(2);
    // Sofa at (2, 6), half extents 1.34 x 0.52.
    expect(pathBlockedByFurniture(obstacles, { x: 2, y: 1.65, z: 4.8 }, { x: 2, y: 1.65, z: 7.2 })).toBe(true);
    expect(pathBlockedByFurniture(obstacles, { x: 2, y: 1.65, z: 3.0 }, { x: 2, y: 1.65, z: 3.6 })).toBe(false);
  });

  test('skips assets too flat to walk around', () => {
    const scene = draftOf(lShapePlan);
    scene.assets = [{ id: LOCAL.rug, type: 'rug', position: { x: 2, y: 0, z: 6 }, material: FINISH.oak_natural }];
    expect(obstaclesFor(scene)).toEqual([]);
  });

  test('resolves walk targets that land on furniture to a free spot', () => {
    const obstacles = obstaclesFor(lShapePlan);
    const resolved = resolveNavigationTarget(lShape, lShapePlan, { x: 2, y: 1.65, z: 6 }, obstacles);
    // Half the catalogue sofa depth (0.95 m) plus the 0.22 m stand-off; the
    // footprint comes from the rendered variant, not a hand-kept table.
    expect(resolved.z).toBeCloseTo(6.695, 6);
    expect(resolved.x).toBeCloseTo(2, 6);
    expect(resolved.y).toBeCloseTo(1.65, 6);
    expect(pathBlockedByFurniture(obstacles, resolved, resolved)).toBe(false);
    expect(isNavigable(lShape, resolved)).toBe(true);
  });

  test('keeps an unreachable target where it was asked for', () => {
    const obstacles = obstaclesFor(lShapePlan);
    const point = { x: 8, y: 1.65, z: 6.5 };
    expect(resolveNavigationTarget(lShape, lShapePlan, point, obstacles)).toEqual(point);
  });
});

describe('asset footprints follow the catalogue reference', () => {
  // The legacy `type` deliberately names something else, so a reference that
  // fails to resolve falls back to the chair footprint and the test can see it.
  const placement = (asset: string | undefined, extra: Partial<DemoAsset> = {}): DemoAsset => ({
    id: LOCAL.placed,
    type: 'chair',
    asset,
    position: { x: 0, y: 0, z: 0 },
    ...extra,
  });

  test('the bare asset UUID decides the footprint, whichever library it names', () => {
    const bare = footprintOf(placement(ARCHETYPE.sofa_3s));
    expect(bare).not.toBeNull();
    expect(bare).not.toEqual(footprintOf(placement(undefined))!);
    expect(footprintOf(placement(ARCHETYPE.sofa_3s, { library: LOCAL.library }))).toEqual(bare);
  });

  test('an explicit collision box still wins over the catalogue', () => {
    const explicit = footprintOf(placement(ARCHETYPE.sofa_3s, { collision: { hx: 2, hz: 3 } }));
    expect(explicit).toEqual({ hx: 2, hz: 3 });
  });
});

describe('crossesClosedDoor', () => {
  /** A crossing of the partition wall, straight through `door-ab` (z = 2.05..2.95). */
  const through = { from: { x: 5.5, y: 1.65, z: 2.5 }, to: { x: 6.5, y: 1.65, z: 2.5 } };

  test('a segment through a closed door is blocked', () => {
    expect(crossesClosedDoor(lShape, new Set([L_SHAPE.opening.doorAb]), through.from, through.to)).toBe(true);
  });

  test('the same segment is free when the door is open', () => {
    expect(crossesClosedDoor(lShape, new Set(), through.from, through.to)).toBe(false);
    // Another door being closed says nothing about this one.
    expect(crossesClosedDoor(lShape, new Set([L_SHAPE.opening.doorEntry]), through.from, through.to)).toBe(false);
  });

  test('a segment parallel to the wall never crosses it', () => {
    const closed = new Set([L_SHAPE.opening.doorAb]);
    expect(crossesClosedDoor(lShape, closed, { x: 5.5, y: 1.65, z: 1.5 }, { x: 5.5, y: 1.65, z: 3.5 })).toBe(false);
  });

  test('a crossing beside the door is not the door', () => {
    // The solid part of the same wall carries no door interval, so nothing there
    // can be closed; `canTraverse` refuses that crossing on its own.
    expect(crossesClosedDoor(lShape, new Set([L_SHAPE.opening.doorAb]), { x: 5.5, y: 1.65, z: 1 }, { x: 6.5, y: 1.65, z: 1 })).toBe(false);
  });

  test('a passage is never closed: it has no door state to be in the set', () => {
    const withPassage = draftOf(lShapePlan);
    withPassage.walls = withPassage.walls.map((wall) =>
      wall.id === L_SHAPE.wall.wPart
        ? { ...wall, openings: [{ id: LOCAL.passageAb, type: 'passage' as const, center: 2.5, width: 0.9, sill: 0, head: 2.1 }] }
        : wall,
    );
    const plan = solvePlan(withPassage);
    // The passage IS a door-like interval in the plan; it just never becomes a
    // `DoorStates` id, so the closed set can never name it.
    expect(plan.centrelines.find((line) => line.wallId === L_SHAPE.wall.wPart)!.doors[0]!.openingId).toBe(LOCAL.passageAb);
    expect(crossesClosedDoor(plan, new Set([L_SHAPE.opening.doorAb]), through.from, through.to)).toBe(false);
  });
});
