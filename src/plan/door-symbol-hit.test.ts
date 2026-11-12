/**
 * The 2D plan's door hit test: a point on a drawn door symbol (its leaf or its
 * arc stroke) names that door, the empty floor inside the swing and a point
 * just outside both name nothing, and where two symbols overlap the door whose
 * centre is nearer wins.
 */

import { describe, expect, test } from 'bun:test';
import { DOOR_HIT_SLOP_PX, doorSymbolAt } from './door-symbol-hit.js';
import { buildPlanDrawing, fitTransform, type PlanDrawing, type PlanPrimitive } from './plan-drawing.js';
import { PLAN_PADDING } from './plan-canvas.js';
import { solvePlan } from './plan-solver.js';
import { planDrawingInputs } from '../assets/plan-fixtures.js';
import { OPENING_VARIANT } from '../assets/catalogue-ids.js';
import { TWO_ROOM_ENTRANCE, twoRoomEntrancePlan } from '../fixtures/plan-two-room-entrance.js';
import type { SceneData, Vec2 } from '../scene/types.js';

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

/** `DOOR_HIT_SLOP_PX` in plan metres at the scale the 2D plan fits this drawing to an 800 x 600 canvas. */
function slopAtPlanScale(): number {
  return DOOR_HIT_SLOP_PX / planScale();
}

function planScale(): number {
  return fitTransform(drawing.bounds, { w: 800, h: 600 }, PLAN_PADDING).scale;
}

describe('doorSymbolAt', () => {
  test('a point on the arc stroke names the door and its wall', () => {
    expect(doorSymbolAt(drawing, alongBisector(swingOf(INNER), 1), slopAtPlanScale())).toEqual({
      openingId: INNER,
      wallId: TWO_ROOM_ENTRANCE.wall.partition,
    });
  });

  test('the empty floor halfway inside the swing names no door, even with the pointer grace', () => {
    expect(doorSymbolAt(drawing, alongBisector(swingOf(INNER), 0.5), slopAtPlanScale())).toBeNull();
  });

  test('a point on the leaf, on either face of it, names the door', () => {
    const leaf = leafOf(INNER);
    const swing = swingOf(INNER);
    const middle = { x: (leaf.from.x + leaf.to.x) / 2, z: (leaf.from.z + leaf.to.z) / 2 };
    // The leaf lies along the arc's open end; step 1 cm across it each way.
    const across = { x: Math.cos(swing.a1) * 0.01, z: Math.sin(swing.a1) * 0.01 };
    for (const point of [middle, { x: middle.x - across.x, z: middle.z - across.z }, { x: middle.x + across.x, z: middle.z + across.z }]) {
      expect(doorSymbolAt(drawing, point)?.openingId).toBe(INNER);
    }
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
    // Each door's centre sits on the far side of the crossing from its own
    // swing's pivot, so "nearer door centre" and "nearer pivot" disagree.
    const left = { openingId: NEAR, wallId: WALL, centre: { x: 0.6, z: 0 } };
    const right = { openingId: FAR, wallId: WALL, centre: { x: 0.4, z: 0 } };
    const overlapping: PlanDrawing = {
      bounds: { min: { x: 0, z: 0 }, max: { x: 1, z: 1 } },
      primitives: [
        { kind: 'swing', centre: { x: 1, z: 0 }, radius: 1, a0: Math.PI / 2, a1: Math.PI, door: right },
        { kind: 'swing', centre: { x: 0, z: 0 }, radius: 1, a0: Math.PI / 2, a1: 0, door: left },
      ],
    };
    // The two arc strokes cross at (0.5, sqrt(0.75)): both are under these points.
    const z = Math.sqrt(0.75);
    expect(doorSymbolAt(overlapping, { x: 0.51, z }, 0.02)?.openingId).toBe(NEAR);
    expect(doorSymbolAt(overlapping, { x: 0.49, z }, 0.02)?.openingId).toBe(FAR);
  });

  // Signed pixels off the arc stroke at the plan's scale: + past it, - inside it.
  test.each([
    { off: 2, door: INNER, says: 'the door' },
    { off: -2, door: INNER, says: 'the door' },
    { off: 5, door: null, says: 'nothing' },
    { off: -5, door: null, says: 'nothing' },
  ])('a click $off px off the arc stroke names $says', ({ off, door }) => {
    const swing = swingOf(INNER);
    const point = alongBisector(swing, 1 + off / planScale() / swing.radius);
    expect(doorSymbolAt(drawing, point, slopAtPlanScale())?.openingId ?? null).toBe(door);
  });
});

describe('doorSymbolAt: a double door', () => {
  /** The two-room plan with the partition door wearing the double variant. */
  const scene: SceneData = {
    ...twoRoomEntrancePlan,
    walls: twoRoomEntrancePlan.walls.map((wall) => ({
      ...wall,
      openings: (wall.openings ?? []).map((opening) =>
        opening.id === INNER ? { ...opening, variant: OPENING_VARIANT.door_white_double } : opening,
      ),
    })),
  };
  const double = buildPlanDrawing(solvePlan(scene), scene, planDrawingInputs(scene));
  const arcs = double.primitives.filter((p): p is Swing => p.kind === 'swing' && p.door.openingId === INNER);

  test('it has two arcs', () => {
    expect(arcs.length).toBe(2);
  });

  test.each([0, 1])('a point on arc %i’s stroke names the door', (index) => {
    expect(doorSymbolAt(double, alongBisector(arcs[index]!, 1), slopAtPlanScale())).toEqual({
      openingId: INNER,
      wallId: TWO_ROOM_ENTRANCE.wall.partition,
    });
  });

  test.each([0, 1])('the empty floor halfway inside arc %i names no door', (index) => {
    expect(doorSymbolAt(double, alongBisector(arcs[index]!, 0.5), slopAtPlanScale())).toBeNull();
  });
});
