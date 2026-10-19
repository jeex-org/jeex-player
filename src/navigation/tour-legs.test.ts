/**
 * The walkable-space answers the tour's checkpoint route asks for, on the
 * L-shape plan: a partition at x = 6 with the door `door-ab` (z 2.05..2.95,
 * head 2.1) between room A (x < 6) and room B.
 */

import { describe, expect, test } from 'bun:test';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { solvePlan } from '../plan/plan-solver.js';
import { DOOR_HEAD_CLEARANCE_M, OPENING_SIDE_MARGIN_M, WINDOW_HEIGHT_MARGIN_M, tourNavigation } from './tour-legs.js';
import type { SceneData } from '../scene/types.js';

const plan = solvePlan(lShapePlan);
const navigation = tourNavigation(plan, lShapePlan);

/** `lShapePlan` with its partition's openings replaced. */
function withPartition(openings: NonNullable<SceneData['walls'][number]['openings']>): SceneData {
  return { ...lShapePlan, walls: lShapePlan.walls.map((wall) => (wall.id === L_SHAPE.wall.wPart ? { ...wall, openings } : wall)) };
}

const DOOR_AB = lShapePlan.walls.find((wall) => wall.id === L_SHAPE.wall.wPart)!.openings![0]!;
/** The window the tests put into the partition. */
const WINDOW_AB_ID = '01a12ff9-4a82-7e6f-a153-a1e26605a68c';
const WINDOW_AB = { id: WINDOW_AB_ID, type: 'window', center: 4, width: 1, sill: 0.9, head: 2.1 } as const;
/** The door AND a window in the partition. */
const windowedScene = withPartition([DOOR_AB, WINDOW_AB]);
const windowed = tourNavigation(solvePlan(windowedScene), windowedScene);
/** Only the window: room B is reachable through it alone. */
const windowOnlyScene = withPartition([WINDOW_AB]);
const windowOnly = tourNavigation(solvePlan(windowOnlyScene), windowOnlyScene);
/** No opening at all in the partition. */
const sealedScene = withPartition([]);
const sealed = tourNavigation(solvePlan(sealedScene), sealedScene);

describe('tourNavigation', () => {
  test('is one answer per solved plan', () => {
    expect(tourNavigation(plan, lShapePlan)).toBe(navigation);
  });

  test('routes camera to camera through the door, both ends exact, the crossing pinned at the door centre', () => {
    const chain = navigation.route({ x: 3, z: 4 }, { x: 8, z: 2 });
    expect(chain).not.toBeNull();
    expect(chain![0]).toEqual({ x: 3, z: 4 });
    expect(chain!.at(-1)).toEqual({ x: 8, z: 2 });
    // The two standoffs and, between them, the pinned centre on the partition.
    const door = chain!.filter((point) => point.door === L_SHAPE.opening.doorAb);
    expect(door).toHaveLength(3);
    expect(door.map((point) => point.pinned === true)).toEqual([false, true, false]);
    expect(door[1]!.x).toBeCloseTo(6, 6);
    expect(door[1]!.z).toBeCloseTo(2.5, 6);
    for (const point of door) expect(point.high).toBeCloseTo(2.1 - DOOR_HEAD_CLEARANCE_M, 10);
  });

  test('a room with a door is never entered through a window, even one in the same wall', () => {
    const chain = navigation.route({ x: 3, z: 4 }, { x: 8, z: 2 })!;
    expect(windowed.route({ x: 3, z: 4 }, { x: 8, z: 2 })).toEqual(chain);
    expect(chain.some((point) => point.opening === WINDOW_AB_ID)).toBe(false);
  });

  test('a room no door reaches is entered through a window between two rooms, crossing at its centre', () => {
    const chain = windowOnly.route({ x: 3, z: 4 }, { x: 8, z: 2 });
    expect(chain).not.toBeNull();
    const window = chain!.filter((point) => point.opening === WINDOW_AB_ID);
    expect(window).toHaveLength(3);
    const centre = window.find((point) => point.pinned === true)!;
    expect(centre.x).toBeCloseTo(6, 6);
    expect(centre.z).toBeCloseTo(4, 6);
    expect(centre.low).toBeCloseTo(0.9 + WINDOW_HEIGHT_MARGIN_M, 10);
    expect(centre.high).toBeCloseTo(2.1 - WINDOW_HEIGHT_MARGIN_M, 10);
  });

  test('a facade window opens onto the street: no route leaves the flat through one', () => {
    // Room B's only way in is gone, and its east window faces outside.
    expect(sealed.route({ x: 3, z: 4 }, { x: 8, z: 2 })).toBeNull();
  });

  test('a hop crosses a wall only inside an opening, clear of the jambs and inside its height', () => {
    // Through the door centre, under the head: yes. Beside the jamb: no.
    expect(navigation.throughOpenings({ x: 5.5, y: 1.6, z: 2.5 }, { x: 6.5, y: 1.6, z: 2.5 })).toBe(true);
    const nearJamb = 2.05 + OPENING_SIDE_MARGIN_M / 2;
    expect(navigation.throughOpenings({ x: 5.5, y: 1.6, z: nearJamb }, { x: 6.5, y: 1.6, z: nearJamb })).toBe(false);
    // Through the lintel: no.
    expect(navigation.throughOpenings({ x: 5.5, y: 2.05, z: 2.5 }, { x: 6.5, y: 2.05, z: 2.5 })).toBe(false);
    // Through the window between the rooms, inside its band: yes; below the sill: no.
    expect(windowOnly.throughOpenings({ x: 5.5, y: 1.5, z: 4 }, { x: 6.5, y: 1.5, z: 4 })).toBe(true);
    expect(windowOnly.throughOpenings({ x: 5.5, y: 0.8, z: 4 }, { x: 6.5, y: 0.8, z: 4 })).toBe(false);
    // Through solid wall: no; inside one room: yes.
    expect(navigation.throughOpenings({ x: 5.5, y: 1.6, z: 4.2 }, { x: 6.5, y: 1.6, z: 4.2 })).toBe(false);
    expect(navigation.throughOpenings({ x: 2, y: 1.6, z: 2 }, { x: 4, y: 1.6, z: 6 })).toBe(true);
  });

  test("an opening's passage is the wall body at the opening and the slab either side, nothing else", () => {
    expect(windowOnly.inOpening({ x: 6, z: 4 })).toBe(true);
    expect(windowOnly.inOpening({ x: 6.3, z: 4 })).toBe(true);
    expect(windowOnly.inOpening({ x: 6, z: 1 })).toBe(false);
    expect(windowOnly.inOpening({ x: 3, z: 4 })).toBe(false);
  });

  test('joins a camera standing against a wall to the walkable area first', () => {
    // 0.1 m off room A's west face: inside the room, outside the walk margin.
    const against = { x: 0.25, z: 4 };
    expect(navigation.walkable(against)).toBe(false);
    const chain = navigation.route(against, { x: 3, z: 4 });
    expect(chain).not.toBeNull();
    expect(chain![0]).toEqual(against);
    expect(navigation.walkable(chain![1]!)).toBe(true);
  });

  test('a camera glides under the door head in a doorway and is unbounded elsewhere', () => {
    expect(navigation.ceilingAt({ x: 6, z: 2.5 })).toBeCloseTo(2.1 - DOOR_HEAD_CLEARANCE_M, 10);
    expect(navigation.ceilingAt({ x: 3, z: 4 })).toBe(Number.POSITIVE_INFINITY);
  });

  test('a straight hop through the partition is not clear, one through the door is', () => {
    expect(navigation.clear({ x: 5, z: 4.2 }, { x: 7, z: 4.2 })).toBe(false);
    expect(navigation.clear({ x: 5, z: 2.5 }, { x: 7, z: 2.5 })).toBe(true);
  });
});
