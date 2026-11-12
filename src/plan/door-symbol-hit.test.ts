/**
 * The 2D plan's door hit test: a point on a drawn door symbol (its leaf or its
 * swing sector) names that door, a point just outside both names nothing, and
 * where two symbols overlap the door whose centre is nearer wins.
 */

import { describe, expect, test } from 'bun:test';
import { doorSymbolAt } from './door-symbol-hit.js';
import { buildPlanDrawing, type PlanDrawing, type PlanPrimitive } from './plan-drawing.js';
import { solvePlan } from './plan-solver.js';
import { planDrawingInputs } from '../assets/plan-fixtures.js';
import { TWO_ROOM_ENTRANCE, twoRoomEntrancePlan } from '../fixtures/plan-two-room-entrance.js';
import type { Vec2 } from '../scene/types.js';

type Swing = Extract<PlanPrimitive, { kind: 'swing' }>;
type Leaf = Extract<PlanPrimitive, { kind: 'leaf' }>;

const drawing: PlanDrawing = buildPlanDrawing(solvePlan(twoRoomEntrancePlan), twoRoomEntrancePlan, planDrawingInputs(twoRoomEntrancePlan));
const INNER = TWO_ROOM_ENTRANCE.opening.inner;
/** Two invented doors on one wall, for the overlap case. */
const NEAR = '01a1cf25-e6dd-7157-8457-9520e44c76b8';
const FAR = '01a1cf25-e6e0-73a6-a4b8-0f7cd14d719a';
const WALL = '01a1cf25-e6da-77c0-9b61-2f6b8ce5f162';

function swingOf(openingId: string): Swing {
  return drawing.primitives.find((p): p is Swing => p.kind === 'swing' && p.door.openingId === openingId)!;
}

function leafOf(openingId: string): Leaf {
  return drawing.primitives.find((p): p is Leaf => p.kind === 'leaf' && p.door.openingId === openingId)!;
}

/** The point at `fraction` of the radius along the sector's bisector. */
function alongBisector(swing: Swing, fraction: number): Vec2 {
  const angle = (swing.a0 + swing.a1) / 2;
  return { x: swing.centre.x + Math.cos(angle) * swing.radius * fraction, z: swing.centre.z + Math.sin(angle) * swing.radius * fraction };
}

describe('doorSymbolAt', () => {
  test('a point inside the swing sector names the door and its wall', () => {
    expect(doorSymbolAt(drawing, alongBisector(swingOf(INNER), 0.5))).toEqual({
      openingId: INNER,
      wallId: TWO_ROOM_ENTRANCE.wall.partition,
    });
  });

  test('a point on the leaf, just off the sector on the leaf’s far face, names the door', () => {
    const leaf = leafOf(INNER);
    const swing = swingOf(INNER);
    const middle = { x: (leaf.from.x + leaf.to.x) / 2, z: (leaf.from.z + leaf.to.z) / 2 };
    // The leaf lies along the sector's open edge; step 1 cm away from the arc's inside.
    const inward = { x: Math.cos(swing.a1) * 0.01, z: Math.sin(swing.a1) * 0.01 };
    const outside = { x: middle.x - inward.x, z: middle.z - inward.z };
    expect(doorSymbolAt(drawing, outside)?.openingId).toBe(INNER);
  });

  test('a point just past the arc and one just past the leaf’s face name nothing', () => {
    expect(doorSymbolAt(drawing, alongBisector(swingOf(INNER), 1.05))).toBeNull();
    const leaf = leafOf(INNER);
    const swing = swingOf(INNER);
    const middle = { x: (leaf.from.x + leaf.to.x) / 2, z: (leaf.from.z + leaf.to.z) / 2 };
    const away = { x: middle.x - Math.cos(swing.a1) * 0.1, z: middle.z - Math.sin(swing.a1) * 0.1 };
    expect(doorSymbolAt(drawing, away)).toBeNull();
  });

  test('a room away from every door names nothing', () => {
    expect(doorSymbolAt(drawing, { x: 2.5, z: 4 })).toBeNull();
  });

  test('where two symbols overlap, the door with the nearer centre wins', () => {
    const near = { openingId: NEAR, wallId: WALL, centre: { x: 0.2, z: 0 } };
    const far = { openingId: FAR, wallId: WALL, centre: { x: 1, z: 0 } };
    const overlapping: PlanDrawing = {
      bounds: { min: { x: 0, z: 0 }, max: { x: 1, z: 1 } },
      primitives: [
        { kind: 'swing', centre: { x: 1, z: 0 }, radius: 1, a0: Math.PI / 2, a1: Math.PI, door: far },
        { kind: 'swing', centre: { x: 0, z: 0 }, radius: 1, a0: Math.PI / 2, a1: 0, door: near },
      ],
    };
    expect(doorSymbolAt(overlapping, { x: 0.5, z: 0.3 })?.openingId).toBe(NEAR);
    expect(doorSymbolAt(overlapping, { x: 0.7, z: 0.3 })?.openingId).toBe(FAR);
  });
});
