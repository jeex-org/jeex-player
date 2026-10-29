/**
 * The room graph and the routes over it, on the demo apartment.
 *
 * The assertions are about REACHABILITY and CLEARANCE, never about a particular
 * chain of waypoints: the demo is re-authored regularly and a route that goes
 * one door around is still a good route. What may never change is that every
 * habitable room can be walked to, that the walk goes through doorways, and
 * that every leg is one the walk controller would itself accept.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildRoomGraph,
  roomAt,
  roomCentre,
  roomStandingPoint,
  routeBetween,
  routeToRoom,
  walkSpawn,
  DOOR_STANDOFF_M,
} from './room-graph.js';
import { solvePlan } from '../plan/plan-solver.js';
import { EYE_HEIGHT_M, canTraverse, isInDoorway, isNavigable, pathBlockedByFurniture } from './navigation.js';
import { obstaclesFor } from '../assets/asset-footprint.js';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { lShapePlan, spawnlessLShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import type { SceneData, Vec2 } from '../scene/types.js';

const scene = apartmentScene;
const plan = solvePlan(scene);
const obstacles = obstaclesFor(scene);
const graph = buildRoomGraph(plan, scene, obstacles);

/** Eye height the walk controller stands at; every leg is tested at it. */
const EYE = EYE_HEIGHT_M;

/** A room UUID no fixture has. */
const NO_SUCH_ROOM = '01a12ff3-e151-7391-a94d-79398a479e05';

const HABITABLE = scene.rooms.filter((room) => room.kind !== 'loggia').map((room) => room.id);

function at(point: Vec2): { x: number; y: number; z: number } {
  return { x: point.x, y: EYE, z: point.z };
}

describe('buildRoomGraph', () => {
  test('every room of the document becomes a node', () => {
    const rooms = graph.nodes
      .filter((node) => node.kind === 'room')
      .map((node) => node.id)
      .sort();
    expect(rooms).toEqual(scene.rooms.map((room) => room.id).sort());
  });

  test('a door between two rooms becomes a node joined to both', () => {
    const node = graph.nodes.find((candidate) => candidate.id === DEMO.opening.doorLivingHall);
    expect(node).toBeDefined();
    expect(node!.kind).toBe('door');
    expect([...node!.roomIds].sort()).toEqual([DEMO.room.hall, DEMO.room.living].sort());
    const incident = graph.edges.filter(([a, b]) => graph.nodes[a]!.id === node!.id || graph.nodes[b]!.id === node!.id);
    expect(incident.length).toBe(2);
  });

  test('the entrance door is not an edge: it leads outside, not to a room', () => {
    expect(graph.nodes.some((node) => node.id === DEMO.opening.doorEntrance)).toBe(false);
    const entrance = scene.walls.flatMap((wall) => wall.openings ?? []).find((opening) => opening.entrance === true);
    expect(entrance).toBeDefined();
  });

  test('windows never become nodes', () => {
    const windowIds = new Set(
      scene.walls.flatMap((wall) => (wall.openings ?? []).filter((opening) => opening.type === 'window').map((opening) => opening.id)),
    );
    const windows = graph.nodes.filter((node) => windowIds.has(node.id));
    expect(windows).toEqual([]);
  });

  test('every edge is room-to-door, never room-to-room', () => {
    for (const [a, b] of graph.edges) {
      const kinds = [graph.nodes[a]!.kind, graph.nodes[b]!.kind].sort();
      expect(kinds).toEqual(['door', 'room']);
    }
  });

  test('every edge weight is the real distance between its two nodes', () => {
    for (const [a, b, weight] of graph.edges) {
      const from = graph.nodes[a]!.point;
      const to = graph.nodes[b]!.point;
      expect(weight).toBeCloseTo(Math.hypot(from.x - to.x, from.z - to.z), 6);
    }
  });
});

describe('roomCentre', () => {
  test('every room centre is a point walk mode could stand on', () => {
    for (const room of scene.rooms) {
      const centre = roomCentre(plan, scene, room.id, obstacles);
      expect({ room: room.id, standable: isNavigable(plan, at(centre)) }).toEqual({ room: room.id, standable: true });
    }
  });

  test('a centre is pushed out of the furniture that stands on it', () => {
    // The bedroom centroid falls on the bed; the navigable centre may not.
    const centre = roomCentre(plan, scene, DEMO.room.bedroom, obstacles);
    expect(
      obstacles.some((obstacle) => {
        const dx = centre.x - obstacle.x;
        const dz = centre.z - obstacle.z;
        const lx = dx * obstacle.cos - dz * obstacle.sin;
        const lz = dx * obstacle.sin + dz * obstacle.cos;
        return Math.abs(lx) <= obstacle.hx && Math.abs(lz) <= obstacle.hz;
      }),
    ).toBe(false);
  });

  test('an unknown room is an error, never a silent origin', () => {
    expect(() => roomCentre(plan, scene, NO_SUCH_ROOM, obstacles)).toThrow();
  });
});

describe('routeToRoom', () => {
  test('every pair of habitable rooms of the demo has a route', () => {
    const missing: string[] = [];
    for (const from of HABITABLE) {
      for (const to of HABITABLE) {
        if (from === to) continue;
        const route = routeToRoom(graph, plan, roomCentre(plan, scene, from, obstacles), to, obstacles);
        if (!route) missing.push(`${from} -> ${to}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('the route ends on the target room centre', () => {
    const centre = roomCentre(plan, scene, DEMO.room.bedroom, obstacles);
    const route = routeToRoom(graph, plan, roomCentre(plan, scene, DEMO.room.living, obstacles), DEMO.room.bedroom, obstacles)!;
    expect(route.at(-1)!.x).toBeCloseTo(centre.x, 6);
    expect(route.at(-1)!.z).toBeCloseTo(centre.z, 6);
  });

  test('living to study passes a hall door node', () => {
    // The study opens only to the hall, so the walk has to leave the living
    // room by its hall door and enter the study by its own.
    const route = routeToRoom(graph, plan, roomCentre(plan, scene, DEMO.room.living, obstacles), DEMO.room.study, obstacles)!;
    const hallDoors = graph.nodes.filter((node) => node.kind === 'door' && node.roomIds.includes(DEMO.room.hall));
    expect(hallDoors.length).toBeGreaterThan(1);
    const passed = hallDoors.filter((door) =>
      route.some((point) => Math.hypot(point.x - door.point.x, point.z - door.point.z) <= DOOR_STANDOFF_M + 1e-6),
    );
    // Both ends of the walk are hall doors: out of the living room, into the study.
    expect(passed.map((door) => door.id).sort()).toEqual([DEMO.opening.doorLivingHall, DEMO.opening.doorStudy].sort());
  });

  test('living to bedroom takes the loggia, which both rooms open onto', () => {
    const route = routeToRoom(graph, plan, roomCentre(plan, scene, DEMO.room.living, obstacles), DEMO.room.bedroom, obstacles)!;
    const doorsOn = route.flatMap((point) => (point.door === undefined ? [] : [point.door]));
    expect([...new Set(doorsOn)].sort((a, b) => a.localeCompare(b))).toEqual(
      [DEMO.opening.doorBedroomLoggia, DEMO.opening.doorLivingLoggia].sort((a, b) => a.localeCompare(b)),
    );
  });

  test('the two standoff points of a door carry its id, and nothing else does', () => {
    const route = routeToRoom(graph, plan, roomCentre(plan, scene, DEMO.room.living, obstacles), DEMO.room.bedroom, obstacles)!;
    const tagged = route.filter((point) => point.door !== undefined);
    expect(tagged.length).toBeGreaterThanOrEqual(4);
    expect(tagged.length % 2).toBe(0);
    // Tagged points come in consecutive pairs, `2 * DOOR_STANDOFF_M` apart,
    // straddling the door centre: that pair is the leg `travel-path.ts` keeps
    // straight so the camera crosses the opening square.
    for (const door of new Set(tagged.map((point) => point.door!))) {
      const pair = route.filter((point) => point.door === door);
      expect(pair.length).toBe(2);
      const [near, far] = pair as [(typeof pair)[0], (typeof pair)[0]];
      expect(Math.hypot(far.x - near.x, far.z - near.z)).toBeCloseTo(2 * DOOR_STANDOFF_M, 6);
      expect(route.indexOf(far)).toBe(route.indexOf(near) + 1);
      const node = graph.nodes.find((candidate) => candidate.kind === 'door' && candidate.id === door)!;
      expect((near.x + far.x) / 2).toBeCloseTo(node.point.x, 6);
      expect((near.z + far.z) / 2).toBeCloseTo(node.point.z, 6);
    }
    // Start and goal are plain points; a furniture detour is one too.
    expect(route[0]!.door).toBeUndefined();
    expect(route.at(-1)!.door).toBeUndefined();
  });

  test('every waypoint of every route is navigable or inside a doorway', () => {
    const bad: string[] = [];
    for (const from of HABITABLE) {
      for (const to of HABITABLE) {
        if (from === to) continue;
        const route = routeToRoom(graph, plan, roomCentre(plan, scene, from, obstacles), to, obstacles);
        if (!route) continue;
        for (const point of route) {
          if (isNavigable(plan, at(point)) || isInDoorway(plan, at(point))) continue;
          bad.push(`${from} -> ${to} @ ${point.x.toFixed(2)},${point.z.toFixed(2)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('every leg of every route is one the walk controller would take', () => {
    const bad: string[] = [];
    for (const from of HABITABLE) {
      for (const to of HABITABLE) {
        if (from === to) continue;
        const route = routeToRoom(graph, plan, roomCentre(plan, scene, from, obstacles), to, obstacles);
        if (!route) continue;
        for (let i = 0; i + 1 < route.length; i += 1) {
          const a = at(route[i]!);
          const b = at(route[i + 1]!);
          if (canTraverse(plan, a, b) && !pathBlockedByFurniture(obstacles, a, b)) continue;
          bad.push(`${from} -> ${to} leg ${i}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('a walk inside one room is the single leg to its centre', () => {
    // The hall is the circulation space: a step off its centre has a clear
    // line back to it, so no doorway and no detour belong in the answer.
    const centre = roomCentre(plan, scene, DEMO.room.hall, obstacles);
    const route = routeToRoom(graph, plan, { x: centre.x + 0.6, z: centre.z }, DEMO.room.hall, obstacles)!;
    expect(route.length).toBe(2);
    expect(route[1]!.x).toBeCloseTo(centre.x, 6);
    expect(route[1]!.z).toBeCloseTo(centre.z, 6);
  });

  test('an unknown target answers null instead of a route to nowhere', () => {
    expect(routeToRoom(graph, plan, roomCentre(plan, scene, DEMO.room.living, obstacles), NO_SUCH_ROOM, obstacles)).toBeNull();
  });

  test('a room walled off behind furniture answers null, so the caller can fly', () => {
    // A wall of obstacles across the whole L-shape fixture: no leg can pass.
    const small = solvePlan(lShapePlan);
    const smallGraph = buildRoomGraph(small, lShapePlan, obstaclesFor(lShapePlan));
    const wall = Array.from({ length: 40 }, (_, i) => ({
      x: -1 + i * 0.3,
      z: 4.9,
      hx: 0.4,
      hz: 0.4,
      cos: 1,
      sin: 0,
    }));
    const from = roomCentre(small, lShapePlan, L_SHAPE.room.a, obstaclesFor(lShapePlan));
    expect(routeToRoom(smallGraph, small, { x: from.x, z: 7 }, L_SHAPE.room.b, wall)).toBeNull();
  });
});

describe('roomAt', () => {
  test('a point inside a room names that room', () => {
    for (const roomId of HABITABLE) {
      expect(roomAt(plan, roomCentre(plan, scene, roomId, obstacles))).toBe(roomId);
    }
  });

  test('a point outside every room falls back to the nearest one', () => {
    // Well off the site: there is no containing room, but "nearest" is still a
    // real answer read off the plan rather than an invented one.
    const named = roomAt(plan, { x: -50, z: -50 });
    expect(named).not.toBeNull();
    expect(scene.rooms.map((room) => room.id)).toContain(named!);
  });
});

describe('walkSpawn: where a walkthrough begins', () => {
  test('the demo flat authors its own, and it is used verbatim', () => {
    const spawn = walkSpawn(plan, scene, obstacles)!;
    expect(spawn.derived).toBe(false);
    expect(spawn.position).toEqual(scene.walkSpawn!.position);
    expect(spawn.target).toEqual(scene.walkSpawn!.target);
  });

  test('a room camera never stands in for the walk spawn', () => {
    // The spawnless fixture still authors a camera per room; none of them is
    // where a walkthrough begins.
    expect(Object.keys(spawnlessLShapePlan.roomCameras).length).toBeGreaterThan(0);
    const spawn = walkSpawn(solvePlan(spawnlessLShapePlan), spawnlessLShapePlan, obstaclesFor(spawnlessLShapePlan))!;
    expect(spawn.derived).toBe(true);
  });

  test('a scene that authored neither stands on the first navigation point, facing its room', () => {
    const small = solvePlan(spawnlessLShapePlan);
    const spawn = walkSpawn(small, spawnlessLShapePlan, obstaclesFor(spawnlessLShapePlan))!;
    expect(spawn.derived).toBe(true);
    expect(spawn.position).toEqual(spawnlessLShapePlan.navigation.points[0]!);
    const roomId = roomAt(small, spawn.position)!;
    const centre = roomCentre(small, spawnlessLShapePlan, roomId, obstaclesFor(spawnlessLShapePlan));
    expect(spawn.target.x).toBeCloseTo(centre.x, 6);
    expect(spawn.target.z).toBeCloseTo(centre.z, 6);
    expect(spawn.target.y).toBeCloseTo(EYE_HEIGHT_M, 6);
  });

  test('a scene with nothing to derive from answers null, not the origin', () => {
    const empty: SceneData = { ...spawnlessLShapePlan, navigation: { points: [] } };
    expect(walkSpawn(solvePlan(empty), empty, obstaclesFor(empty))).toBeNull();
  });
});

describe('routeBetween', () => {
  test('walks from a point in one room to a POINT in another, through the doors, ending on that point', () => {
    const from = { x: 4.0, z: 8.3 };
    const to = { x: 8.2, z: 8.4 };
    expect(roomAt(plan, from)).toBe(DEMO.room.living);
    expect(roomAt(plan, to)).toBe(DEMO.room.bedroom);
    const route = routeBetween(graph, plan, from, to);
    expect(route).not.toBeNull();
    expect(route![0]).toEqual(from);
    expect(route!.at(-1)).toEqual(to);
    // Doors come in standoff pairs, and every leg is one the walk would accept.
    expect(route!.filter((point) => point.door !== undefined).length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < route!.length; index += 1) expect(canTraverse(plan, at(route![index - 1]!), at(route![index]!))).toBe(true);
    // Not through the bedroom's centre: the goal is the point, not the room.
    const centre = roomCentre(plan, scene, DEMO.room.bedroom, obstacles);
    expect(route!.some((point) => point.x === centre.x && point.z === centre.z)).toBe(false);
  });

  test('two points in one room are one straight leg', () => {
    const route = routeBetween(graph, plan, { x: 3.95, z: 5.0 }, { x: 3.95, z: 7.6 });
    expect(route).toEqual([
      { x: 3.95, z: 5.0 },
      { x: 3.95, z: 7.6 },
    ]);
  });
});

describe('roomStandingPoint: where a walker jumped into a room stands', () => {
  test('a centre pushed off one table into the next: a clear point inside the room, in no furniture', () => {
    const lPlan = solvePlan(lShapePlan);
    // A side table on the room's centre, a sideboard wall to wall just beside it:
    // the centre is pushed off the table straight into the sideboard.
    const sideTable = { x: 7.95, z: 2.5, hx: 0.5, hz: 0.5, cos: 1, sin: 0 };
    const sideboard = { x: 8.9, z: 2.5, hx: 0.4, hz: 3, cos: 1, sin: 0 };
    const inside = (point: Vec2, box: typeof sideTable) => Math.abs(point.x - box.x) <= box.hx && Math.abs(point.z - box.z) <= box.hz;
    expect(inside(roomCentre(lPlan, lShapePlan, L_SHAPE.room.b, [sideboard, sideTable]), sideboard)).toBe(true);

    const point = roomStandingPoint(lPlan, lShapePlan, L_SHAPE.room.b, [sideboard, sideTable]);

    expect(roomAt(lPlan, point)).toBe(L_SHAPE.room.b);
    expect(isNavigable(lPlan, { x: point.x, y: EYE_HEIGHT_M, z: point.z })).toBe(true);
    expect(inside(point, sideTable) || inside(point, sideboard)).toBe(false);
  });

  test('a clear room: its centre', () => {
    const lPlan = solvePlan(lShapePlan);
    expect(roomStandingPoint(lPlan, lShapePlan, L_SHAPE.room.b, [])).toEqual(roomCentre(lPlan, lShapePlan, L_SHAPE.room.b, []));
  });
});
