import { describe, expect, test } from 'bun:test';

import { isResolved, resolveAsset } from '../assets/asset-resolver.js';
import { closestOnSegment, dist } from '../plan/plan-geometry.js';
import type { SolvedPlan, WallFace } from '../plan/plan-solver.js';
import { solvePlan } from '../plan/plan-solver.js';
import { ARCHETYPE } from '../assets/catalogue-ids.js';
import { DEMO } from './demo-ids.js';
import { apartmentScene } from './scene-data.js';
import type { DemoAsset, FaceKey, Vec2 } from '../scene/types.js';

/**
 * Facing check for the apartment scene: a case good standing against a wall
 * must open into the room, not into the wall.
 *
 * The bug this locks out is invisible in the data. A placement carries a
 * `rotationY`, but what the viewer renders is `rotationY + asset.yaw`, where
 * `yaw` is the legacy per-type compensation the object bank applies to
 * pre-bank `type` words (`asset-catalogue.LEGACY_TYPE_ALIASES`). Half the scene
 * was authored against the compensated frame and half against the documented
 * one, so a wardrobe with a perfectly plausible `rotationY: 0` rendered with
 * its doors pressed into the wall and its blank back to the room.
 *
 * So the assertion is made on the *resolved* yaw, the same number the loader
 * puts on the group, and against the *solved* wall faces, the same geometry
 * the shell is built from - never against numbers copied out of either.
 */

const { asset: ASSET } = DEMO;

/** A placement's readable name for a test title: its key in `DEMO.asset`. */
const NAME_OF = new Map<string, string>(Object.entries(ASSET).map(([name, id]) => [id, name]));
const nameOf = (placement: DemoAsset): string => NAME_OF.get(placement.id) ?? placement.id;

const plan: SolvedPlan = solvePlan(apartmentScene);
const faces: WallFace[] = [...plan.faces.values()];

/**
 * Case goods: everything whose front is a door, a drawer or an appliance face.
 * Symmetric objects (rugs, plants, lamps, tables) are deliberately absent -
 * they have no front to point anywhere.
 */
const CASE_GOODS: ReadonlySet<string> = new Set([
  ARCHETYPE.wardrobe,
  ARCHETYPE.cabinet_tall,
  ARCHETYPE.cabinet_wall,
  ARCHETYPE.cabinet_shoe,
  ARCHETYPE.dresser,
  ARCHETYPE.nightstand,
  ARCHETYPE.desk,
  ARCHETYPE.tv_unit,
  ARCHETYPE.bookshelf,
  ARCHETYPE.console_hall,
  ARCHETYPE.counter_run,
  ARCHETYPE.cooker,
  ARCHETYPE.fridge_tall,
  ARCHETYPE.vanity_sink,
]);

/** Wall-hung pieces whose face must look into the room they hang in. */
const WALL_PIECES: ReadonlySet<string> = new Set([
  ARCHETYPE.art_framed,
  ARCHETYPE.mirror_round,
  ARCHETYPE.hood_extractor,
  ARCHETYPE.cabinet_wall,
]);

/** A placement this close to a wall face is standing against it. */
const AGAINST_WALL = 0.6;

/**
 * World direction the front of a placement looks along, in plan.
 *
 * `asset-loader` turns the built body by `Math.PI` (builders author fronts at
 * +Z) and then sets `group.rotation.y = rotationY + asset.yaw`, so in scene
 * space the front is -Z turned by that angle.
 */
function frontNormal(placement: DemoAsset): Vec2 {
  const resolution = resolveAsset(placement, { ceilingHeight: apartmentScene.ceilingHeight });
  if (!isResolved(resolution)) throw new Error(`${placement.id} does not resolve`);
  const angle = (placement.rotationY ?? 0) + resolution.asset.yaw;
  return { x: -Math.sin(angle), z: -Math.cos(angle) };
}

function archetypeOf(placement: DemoAsset): string {
  const resolution = resolveAsset(placement, { ceilingHeight: apartmentScene.ceilingHeight });
  if (!isResolved(resolution)) throw new Error(`${placement.id} does not resolve`);
  return resolution.asset.archetypeId;
}

/** Nearest point on any solved wall face, and the unit vector pointing at it. */
function nearestWall(point: Vec2): { face: FaceKey | null; distance: number; toWall: Vec2 } {
  let best: { face: FaceKey | null; distance: number; toWall: Vec2 } = { face: null, distance: Infinity, toWall: { x: 0, z: 0 } };
  for (const face of faces) {
    for (let index = 0; index + 1 < face.polyline.length; index += 1) {
      const { point: hit } = closestOnSegment(point, face.polyline[index]!, face.polyline[index + 1]!);
      const distance = dist(point, hit);
      if (distance >= best.distance) continue;
      const scale = Math.max(1e-9, distance);
      best = { face: face.key, distance, toWall: { x: (hit.x - point.x) / scale, z: (hit.z - point.z) / scale } };
    }
  }
  return best;
}

function facingReport(placement: DemoAsset): { face: FaceKey | null; distance: number; dot: number } {
  const front = frontNormal(placement);
  const near = nearestWall({ x: placement.position.x, z: placement.position.z });
  return { face: near.face, distance: near.distance, dot: front.x * near.toWall.x + front.z * near.toWall.z };
}

const placementsOf = (ids: ReadonlySet<string>): DemoAsset[] =>
  apartmentScene.assets.filter((placement) => ids.has(archetypeOf(placement)));

describe('case goods face the room', () => {
  test('the scene actually holds the case goods this suite claims to cover', () => {
    const covered = new Set(placementsOf(CASE_GOODS).map((placement) => archetypeOf(placement)));
    // Every wardrobe in the flat, plus at least one of each storage family.
    expect(placementsOf(CASE_GOODS).length).toBeGreaterThanOrEqual(20);
    for (const archetype of [
      ARCHETYPE.wardrobe,
      ARCHETYPE.dresser,
      ARCHETYPE.nightstand,
      ARCHETYPE.console_hall,
      ARCHETYPE.cabinet_shoe,
      ARCHETYPE.counter_run,
    ]) {
      expect(covered).toContain(archetype);
    }
  });

  for (const placement of placementsOf(CASE_GOODS)) {
    test(`${nameOf(placement)} opens away from the wall behind it`, () => {
      const { face, distance, dot } = facingReport(placement);
      if (distance > AGAINST_WALL) return; // free-standing: nothing to face away from
      expect({ id: placement.id, face, dot: dot < 0 }).toEqual({ id: placement.id, face, dot: true });
    });
  }
});

describe('wall-hung pieces look into their room', () => {
  for (const placement of placementsOf(WALL_PIECES)) {
    test(`${nameOf(placement)} looks away from its wall`, () => {
      const { face, distance, dot } = facingReport(placement);
      expect(distance).toBeLessThanOrEqual(AGAINST_WALL);
      expect({ id: placement.id, face, dot: dot < 0 }).toEqual({ id: placement.id, face, dot: true });
    });
  }
});

describe('dining and desk seating faces its table', () => {
  const pairs: Array<[chair: string, table: string]> = [
    [ASSET.livingChairA, ASSET.livingTable],
    [ASSET.livingChairB, ASSET.livingTable],
    [ASSET.livingChairC, ASSET.livingTable],
    [ASSET.livingChairD, ASSET.livingTable],
    [ASSET.studyChair, ASSET.studyDesk],
  ];
  const byId = (id: string): DemoAsset => apartmentScene.assets.find((placement) => placement.id === id)!;

  for (const [chairId, tableId] of pairs) {
    const chair = byId(chairId);
    const table = byId(tableId);
    test(`${nameOf(chair)} faces ${nameOf(table)}`, () => {
      const front = frontNormal(chair);
      const toTable = { x: table.position.x - chair.position.x, z: table.position.z - chair.position.z };
      const length = Math.hypot(toTable.x, toTable.z);
      expect(front.x * (toTable.x / length) + front.z * (toTable.z / length)).toBeGreaterThan(0.7);
    });
  }
});
