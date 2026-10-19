import { describe, expect, test } from 'bun:test';

import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { ARCHETYPE } from '../assets/catalogue-ids.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { distanceToPolygon, dot, pointInPolygon, signedArea } from '../plan/plan-geometry.js';
import { solvePlan, type RoomFace, type SolvedPlan, type WallFace } from '../plan/plan-solver.js';
import { SceneModel, isApplyOk } from '../scene/scene-model.js';
import { nearestFace } from './rules/context.js';
import { lintContext, lintLayout, type LayoutIssue } from './layout-lint.js';
import { suggestPlacement } from './free-space.js';
import type { SceneData, Vec2 } from '../scene/types.js';

/** Ids of the placements and references the tests make up, none of which the fixtures carry. */
const PROBE = {
  unknownAsset: '01a12ff7-2ad4-79d7-a7e1-e1acb3a00889',
  stool: '01a12ff7-2ad5-772c-836b-dd47b98ae66b',
  mirror: '01a12ff7-2ad6-791f-b6b3-1aaac25d101b',
  pendant: '01a12ff7-2ad7-7093-869c-1fdb252f1f62',
  ghostRoom: '01a12ff7-2ad8-7174-bd27-6cc9e92dc138',
  sofa: '01a12ff7-2ad9-73ff-a60b-1733f9601f60',
} as const;

const lShape = solvePlan(lShapePlan);
const apartment = solvePlan(apartmentScene);

/** The comparison the helper makes: an error is the rule plus the sorted ids it names. */
function errorKeys(issues: readonly LayoutIssue[]): Set<string> {
  return new Set(issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.rule}|${[...issue.ids].sort().join(',')}`));
}

function roomOf(plan: SolvedPlan, roomId: string): RoomFace {
  const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
  if (!room) throw new Error(`fixture has no room ${roomId}`);
  return room;
}

function planPoint(position: { x: number; z: number }): Vec2 {
  return { x: position.x, z: position.z };
}

/**
 * The direction a placement's front looks, as `itemsOf` computes it.
 *
 * Spelled out rather than imported: a test that reads the yaw through the same
 * helper the code uses would pass on a sign error in that helper.
 */
function frontOf(rotationY: number): Vec2 {
  return { x: -Math.sin(rotationY), z: -Math.cos(rotationY) };
}

/** Longest face of a room's loop — the "dominant" face a free-standing object aligns with. */
function longestFace(room: RoomFace): WallFace {
  return [...room.loop].sort((left, right) => right.length - left.length)[0]!;
}

/** Deterministic `[0, 1)` source for the "a caller seed decides" test — the module's own PRNG, spelled out. */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('suggestPlacement', () => {
  test('samples a pose inside the room polygon and away from its walls', () => {
    const pose = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s });
    const room = roomOf(lShape, pose.roomId);
    expect(pose.how).toBe('sampled');
    expect(pose.warning).toBeUndefined();
    expect(pointInPolygon(planPoint(pose.position), room.polygon)).toBe(true);
    // `sofa_3s` is 2.24 x 0.95, so its reach is 1.12 m; the margin is 0.40 m.
    expect(distanceToPolygon(planPoint(pose.position), room.polygon).distance).toBeGreaterThanOrEqual(1.12 + 0.4 - 1e-9);
    expect(pose.position.y).toBe(0);
  });

  test('a sampled pose is a pose SceneModel.apply accepts with lint: strict', () => {
    // Only meaningful on a scene whose own lint is clean: `lint: 'strict'`
    // refuses a batch for an error the scene already had.
    expect(errorKeys(lintLayout(lShapePlan, lShape)).size).toBe(0);
    const pose = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s });
    const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES, { lint: lintLayout });
    const result = model.apply({
      baseRev: model.rev,
      lint: 'strict',
      ops: [
        {
          op: 'place_object',
          id: PROBE.sofa,
          asset: ARCHETYPE.sofa_3s,
          position: pose.position,
          rotationY: pose.rotationY,
          room: pose.roomId,
        },
      ],
    });
    expect(isApplyOk(result)).toBe(true);
  });

  test('adds no NEW layout error to the demo apartment', () => {
    const before = errorKeys(lintLayout(apartmentScene, apartment));
    expect(before.size).toBe(0);
    const pose = suggestPlacement({ scene: apartmentScene, plan: apartment, asset: ARCHETYPE.stool_bar, roomId: DEMO.room.bedroom });
    expect(pose.how).toBe('sampled');
    const placed: SceneData = {
      ...apartmentScene,
      assets: [
        ...apartmentScene.assets,
        { id: PROBE.stool, type: ARCHETYPE.stool_bar, asset: ARCHETYPE.stool_bar, position: pose.position, rotationY: pose.rotationY },
      ],
    };
    const after = errorKeys(lintLayout(placed, apartment));
    expect([...after].filter((key) => !before.has(key))).toEqual([]);
  });

  test('the same request answers the same pose twice', () => {
    const first = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s });
    const second = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s });
    expect(second).toEqual(first);
  });

  test('a caller seed decides the pose', () => {
    const one = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s, rng: mulberry32(1) });
    const two = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s, rng: mulberry32(2) });
    expect(one.how).toBe('sampled');
    expect(two.how).toBe('sampled');
    expect([one.position.x, one.position.z]).not.toEqual([two.position.x, two.position.z]);
    for (const pose of [one, two]) {
      const room = roomOf(lShape, pose.roomId);
      expect(pointInPolygon(planPoint(pose.position), room.polygon)).toBe(true);
    }
  });

  test('a room with no room for the asset falls back to its centre', () => {
    // The demo `living` is furnished to the edges: no sample survives there.
    const pose = suggestPlacement({ scene: apartmentScene, plan: apartment, asset: ARCHETYPE.sofa_3s, roomId: DEMO.room.living });
    expect(pose.how).toBe('room-centre');
    expect(pose.warning).toBe('no-free-space');
    expect(pose.roomId).toBe(DEMO.room.living);
    expect(pointInPolygon(planPoint(pose.position), roomOf(apartment, DEMO.room.living).polygon)).toBe(true);
  });

  test('an asset the bank does not know falls back to the centre of the largest room', () => {
    const pose = suggestPlacement({ scene: apartmentScene, plan: apartment, asset: PROBE.unknownAsset });
    expect(pose.roomId).toBe(DEMO.room.living);
    expect(pose.how).toBe('room-centre');
    expect(pose.warning).toBe('unknown-asset');
  });

  test('a wall-hung archetype hangs on the first free span of a face, facing in, at its mount height', () => {
    const pose = suggestPlacement({ scene: apartmentScene, plan: apartment, asset: ARCHETYPE.mirror_round, roomId: DEMO.room.bedroom });
    expect(pose.warning).toBeUndefined();
    expect(pose.how).toBe('wall-span');
    expect(pose.roomId).toBe(DEMO.room.bedroom);
    expect(pose.position.y).toBeCloseTo(1.6, 6);
    // Committed as a host's catalogue dialog would, the mirror adds no layout error at all.
    const probe = {
      id: PROBE.mirror,
      type: ARCHETYPE.mirror_round,
      asset: ARCHETYPE.mirror_round,
      position: pose.position,
      rotationY: pose.rotationY,
    } as const;
    const issues = lintLayout({ ...apartmentScene, assets: [...apartmentScene.assets, probe] }, apartment);
    expect(issues.filter((issue) => issue.severity === 'error' && issue.ids.includes(PROBE.mirror)).map((issue) => issue.message)).toEqual(
      [],
    );
  });

  test('a ceiling archetype hangs under the ceiling of the room, legal, and never in a loggia', () => {
    const pose = suggestPlacement({ scene: apartmentScene, plan: apartment, asset: ARCHETYPE.pendant, roomId: DEMO.room.bedroom });
    expect(pose.how).toBe('ceiling');
    expect(pose.warning).toBeUndefined();
    expect(pose.position.y).toBe(0);
    expect(pointInPolygon(planPoint(pose.position), roomOf(apartment, DEMO.room.bedroom).polygon)).toBe(true);
    const probe = { id: PROBE.pendant, type: ARCHETYPE.pendant, asset: ARCHETYPE.pendant, position: pose.position, rotationY: 0 } as const;
    const issues = lintLayout({ ...apartmentScene, assets: [...apartmentScene.assets, probe] }, apartment);
    expect(issues.filter((issue) => issue.severity === 'error' && issue.ids.includes(PROBE.pendant)).map((issue) => issue.message)).toEqual(
      [],
    );

    const loggia = suggestPlacement({ scene: apartmentScene, plan: apartment, asset: ARCHETYPE.pendant, roomId: DEMO.room.loggiaNorth });
    expect(loggia.warning).toBe('no-free-space');
    expect(loggia.how).toBe('room-centre');
  });

  test('no answer is ever unsupported-anchor any more', () => {
    for (const asset of [ARCHETYPE.art_framed, ARCHETYPE.mirror_round, ARCHETYPE.pendant, ARCHETYPE.cabinet_wall, ARCHETYPE.sofa_3s]) {
      expect(suggestPlacement({ scene: lShapePlan, plan: lShape, asset }).warning).not.toBe('unsupported-anchor');
    }
  });

  test('no rooms at all answers no-rooms without throwing', () => {
    const roomless: SolvedPlan = { ...lShape, rooms: [] };
    const pose = suggestPlacement({ scene: lShapePlan, plan: roomless, asset: ARCHETYPE.sofa_3s });
    expect(pose.warning).toBe('no-rooms');
    expect(pose.how).toBe('room-centre');
    expect(pose.roomId).toBe('');
    expect(Number.isFinite(pose.position.x)).toBe(true);
    expect(Number.isFinite(pose.position.z)).toBe(true);
    expect(pose.rotationY).toBe(0);
  });

  test('an unknown roomId is treated as absent', () => {
    const ghost = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s, roomId: PROBE.ghostRoom });
    const absent = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s });
    expect(ghost.warning).toBeUndefined();
    expect(ghost).toEqual(absent);
  });

  test('the largest room is the default', () => {
    const areas = lShape.rooms.map((room) => ({ id: room.roomId, area: Math.abs(signedArea(room.polygon)) }));
    const largest = [...areas].sort((left, right) => right.area - left.area)[0]!;
    expect(largest.id).toBe(L_SHAPE.room.a);
    expect(suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s }).roomId).toBe(L_SHAPE.room.a);
  });

  test('neither the scene nor the plan is mutated', () => {
    const sceneBefore = JSON.stringify(lShapePlan);
    const roomsBefore = JSON.stringify(lShape.rooms);
    suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s });
    suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.art_framed });
    expect(JSON.stringify(lShapePlan)).toBe(sceneBefore);
    expect(JSON.stringify(lShape.rooms)).toBe(roomsBefore);
  });

  test('a concave room whose centroid falls outside still answers an interior point', () => {
    // A 3 x 3 L with 1 m arms: the centroid is (1.1, 1.1), in the notch, and no
    // sofa fits in a 1 m arm — so the fallback has to find an interior point.
    const polygon: Vec2[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 3 },
      { x: 0, z: 3 },
    ];
    expect(pointInPolygon({ x: 1.1, z: 1.1 }, polygon)).toBe(false);
    const elbow: RoomFace = {
      roomId: L_SHAPE.room.a,
      polygon,
      loop: roomOf(lShape, L_SHAPE.room.a).loop,
      bbox: { minX: 0, maxX: 3, minZ: 0, maxZ: 3 },
    };
    const bent: SolvedPlan = { ...lShape, rooms: [elbow] };
    const empty: SceneData = { ...lShapePlan, assets: [] };
    const pose = suggestPlacement({ scene: empty, plan: bent, asset: ARCHETYPE.sofa_3s });
    expect(pose.how).toBe('room-centre');
    expect(pose.warning).toBe('no-free-space');
    expect(pointInPolygon(planPoint(pose.position), polygon)).toBe(true);
  });

  test('a room whose scan finds no interior cell answers a point on its own outline', () => {
    // The last resort of `interiorPoint`, reached when the 0.1 m scan finds
    // nothing at all — in the wild a room thinner than the lattice, here a
    // bbox that does not cover its own polygon, which is the cheapest
    // deterministic way to empty the scan. The answer must lie ON the polygon
    // (`pointInPolygon` counts the boundary as inside); the VERTEX AVERAGE of
    // this L is (1.33, 1.33), in the notch, outside the room — which is why
    // the fallback is the nearest boundary point and not `quadCentre`.
    const polygon: Vec2[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 3 },
      { x: 0, z: 3 },
    ];
    expect(pointInPolygon({ x: 8 / 6, z: 8 / 6 }, polygon)).toBe(false);
    const elsewhere: RoomFace = {
      roomId: L_SHAPE.room.a,
      polygon,
      loop: roomOf(lShape, L_SHAPE.room.a).loop,
      bbox: { minX: 10, maxX: 10.05, minZ: 10, maxZ: 10.05 },
    };
    const off: SolvedPlan = { ...lShape, rooms: [elsewhere] };
    const pose = suggestPlacement({ scene: { ...lShapePlan, assets: [] }, plan: off, asset: ARCHETYPE.sofa_3s });
    expect(pose.how).toBe('room-centre');
    expect(pointInPolygon(planPoint(pose.position), polygon)).toBe(true);
    expect(distanceToPolygon(planPoint(pose.position), polygon).distance).toBeCloseTo(0, 9);
    expect(Number.isFinite(pose.rotationY)).toBe(true);
  });
});

describe('which way a suggested object faces', () => {
  test('a wall-snap archetype turns its back on the nearest wall', () => {
    // `sofa_3s` carries `wallSnap: true` in the bank; the pose must look INTO
    // the room. "Turned" and "turned the right way" are different assertions:
    // this one projects the front onto the face normal instead of comparing
    // the yaw to a number, so a sign error cannot hide behind a golden angle.
    const pose = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s });
    const near = nearestFace(lShape, pose.roomId, planPoint(pose.position))!;
    // A `WallFace.normal` points from the wall INTO its room, so a front equal
    // to the normal is a back turned on the wall.
    expect(dot(frontOf(pose.rotationY), near.face.normal)).toBeCloseTo(1, 6);
    // And not standing IN that wall: half the sofa's depth is 0.475 m.
    expect(near.distance).toBeGreaterThan(0.95 / 2);
  });

  test('a free-standing archetype aligns with the longest wall of the room', () => {
    // `plant_strelitzia` carries `wallSnap: false`: the DOMINANT face decides,
    // not the nearest one — and in room `a` the two differ (`w-w`, 7.70 m,
    // against `w-s-a` at 0.82 m from the sampled pose).
    const pose = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.plant_strelitzia, roomId: L_SHAPE.room.a });
    const longest = longestFace(roomOf(lShape, L_SHAPE.room.a));
    const near = nearestFace(lShape, pose.roomId, planPoint(pose.position))!;
    expect(longest.wallId).toBe(L_SHAPE.wall.wW);
    expect(near.face.wallId).not.toBe(longest.wallId);
    expect(dot(frontOf(pose.rotationY), longest.normal)).toBeCloseTo(1, 6);
  });

  test('the yaw the helper answers is the yaw the linter reads', () => {
    // `applyPlaceObject` writes `asset`, so `shippedFacts` reports `yaw: 0`
    // and `LintItem.front` is exactly the vector above — no legacy facing
    // compensation stands between the two, which is what makes the wall-snap
    // assertion above a statement about the linter's own judgement.
    const pose = suggestPlacement({ scene: lShapePlan, plan: lShape, asset: ARCHETYPE.sofa_3s });
    const placed: SceneData = {
      ...lShapePlan,
      assets: [
        ...lShapePlan.assets,
        { id: PROBE.sofa, type: ARCHETYPE.sofa_3s, asset: ARCHETYPE.sofa_3s, position: pose.position, rotationY: pose.rotationY },
      ],
    };
    const item = lintContext(placed, lShape).items.find((candidate) => candidate.placement.id === PROBE.sofa)!;
    const front = frontOf(pose.rotationY);
    expect(item.front.x).toBeCloseTo(front.x, 9);
    expect(item.front.z).toBeCloseTo(front.z, 9);
  });
});
