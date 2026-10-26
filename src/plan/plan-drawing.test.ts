/**
 * The 2D drawing is what the user sees in `plan2d` and, later, on the
 * mini-map, so it is tested against the same two documents the solver is: the
 * L-shape fixture (hand-verified numbers) and the demo apartment (the real
 * thing, curved bay and all).
 *
 * The contract under test is COUNTING and PLACEMENT, not pixels: one filled
 * body per wall and per joint core, one white cut per opening, a leaf and a
 * quarter arc per hinged door, a double line per window, footprints for the
 * bath and kitchen fixtures only, and a hit test that answers with a room id.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildPlanDrawing,
  fitTransform,
  isPlanFixtureCategory,
  planPoint,
  roomAt,
  type PlanDrawing,
  type PlanPrimitive,
} from './plan-drawing.js';
import { solvePlan } from './plan-solver.js';
import { jointCores } from './plan-joints.js';
import { doorSwings } from './door-swing.js';
import { openingFrameWidth } from '../assets/opening-frame.js';
import { planDrawingInputs } from '../assets/plan-fixtures.js';
import { signedArea } from './plan-geometry.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { lShapePlan, bayPlan } from '../fixtures/plan-l-shape.js';
import { apartmentScene } from '../demo/scene-data.js';
import { findCatalogueEntry } from '../assets/asset-catalogue.js';
import type { SceneData, Vec2 } from '../scene/types.js';

function drawingOf(scene: SceneData): PlanDrawing {
  return buildPlanDrawing(solvePlan(scene), scene, planDrawingInputs(scene));
}

function kinds(drawing: PlanDrawing, kind: PlanPrimitive['kind']): PlanPrimitive[] {
  return drawing.primitives.filter((primitive) => primitive.kind === kind);
}

function centroid(polygon: Vec2[]): Vec2 {
  const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / polygon.length, z: sum.z / polygon.length };
}

/** Longest edge of a polygon, as a rough "is this a real body" measure. */
function span(polygon: Vec2[]): number {
  const xs = polygon.map((p) => p.x);
  const zs = polygon.map((p) => p.z);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
}

describe('buildPlanDrawing: wall bodies', () => {
  test('one filled body per wall plus one per joint core, exactly as the shell builds them', () => {
    for (const scene of [lShapePlan, bayPlan, apartmentScene]) {
      const drawing = drawingOf(scene);
      const cores = jointCores(scene).length;
      expect({ scene: scene.id, walls: kinds(drawing, 'wall').length }).toEqual({ scene: scene.id, walls: scene.walls.length + cores });
    }
  });

  test('a straight wall body is its centreline band: true thickness, closed, non-degenerate', () => {
    const drawing = drawingOf(lShapePlan);
    const bodies = kinds(drawing, 'wall');
    // `w-part` is the 0.10 partition running (6,0) -> (6,5): area 5 * 0.10.
    const partition = bodies
      .filter((primitive): primitive is Extract<PlanPrimitive, { kind: 'wall' }> => primitive.kind === 'wall')
      .find((body) => Math.abs(Math.abs(signedArea(body.polygon)) - 0.5) < 0.02);
    expect(partition).toBeDefined();
    const xs = partition!.polygon.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.1, 6);
  });

  test('the curved bay is drawn as a curve, not as its chord', () => {
    const drawing = drawingOf(bayPlan);
    const arcWall = bayPlan.walls.find((wall) => wall.arc)!;
    // The bay body has many vertices (the discretised arc, both sides); a
    // chord would give four.
    const curved = kinds(drawing, 'wall').filter((body) => body.kind === 'wall' && body.polygon.length > 12);
    expect(arcWall).toBeDefined();
    expect(curved.length).toBeGreaterThan(0);
  });
});

describe('buildPlanDrawing: openings', () => {
  test('one white cut per opening, of the wall thickness and the opening width', () => {
    for (const scene of [lShapePlan, apartmentScene]) {
      const openings = scene.walls.flatMap((wall) => wall.openings ?? []);
      const cuts = kinds(drawingOf(scene), 'opening');
      expect({ scene: scene.id, cuts: cuts.length }).toEqual({ scene: scene.id, cuts: openings.length });
    }
  });

  test('the cut carries the opening type and spans the opening width', () => {
    const drawing = drawingOf(lShapePlan);
    const cuts = kinds(drawing, 'opening').filter(
      (primitive): primitive is Extract<PlanPrimitive, { kind: 'opening' }> => primitive.kind === 'opening',
    );
    expect(cuts.map((cut) => cut.type).sort()).toEqual(['door', 'door', 'window', 'window']);
    // `door-ab` is 0.90 wide in the 0.10 partition: its cut is 0.9 x 0.1.
    const partitionDoor = cuts.find((cut) => Math.abs(span(cut.quad) - 0.9) < 0.02);
    expect(partitionDoor).toBeDefined();
    expect(partitionDoor!.type).toBe('door');
  });

  test('a window also gets its thin double line inside the cut', () => {
    for (const scene of [lShapePlan, apartmentScene]) {
      const windows = scene.walls.flatMap((wall) => wall.openings ?? []).filter((o) => o.type === 'window');
      const drawn = kinds(drawingOf(scene), 'window');
      expect({ scene: scene.id, windows: drawn.length }).toEqual({ scene: scene.id, windows: windows.length });
    }
  });
});

describe('buildPlanDrawing: doors', () => {
  test('a leaf line and a quarter-circle swing arc per hinged door', () => {
    for (const scene of [lShapePlan, apartmentScene]) {
      const plan = solvePlan(scene);
      const swings = doorSwings(scene, plan, openingFrameWidth).length;
      const drawing = buildPlanDrawing(plan, scene, planDrawingInputs(scene));
      expect({ scene: scene.id, leaves: kinds(drawing, 'leaf').length, arcs: kinds(drawing, 'swing').length }).toEqual({
        scene: scene.id,
        leaves: swings,
        arcs: swings,
      });
    }
  });

  test('the leaf stands at its rest angle and the arc closes it again', () => {
    const plan = solvePlan(lShapePlan);
    const drawing = buildPlanDrawing(plan, lShapePlan, planDrawingInputs(lShapePlan));
    const swing = doorSwings(lShapePlan, plan, openingFrameWidth).find((entry) => entry.openingId === L_SHAPE.opening.doorAb)!;
    const leaf = kinds(drawing, 'leaf')
      .filter((primitive): primitive is Extract<PlanPrimitive, { kind: 'leaf' }> => primitive.kind === 'leaf')
      .find((line) => Math.hypot(line.from.x - swing.pivot.x, line.from.z - swing.pivot.z) < 1e-9)!;
    const arc = kinds(drawing, 'swing')
      .filter((primitive): primitive is Extract<PlanPrimitive, { kind: 'swing' }> => primitive.kind === 'swing')
      .find((entry) => Math.hypot(entry.centre.x - swing.pivot.x, entry.centre.z - swing.pivot.z) < 1e-9)!;

    // The leaf is the open position: `pivot + open * leaf`.
    expect(leaf.to.x).toBeCloseTo(swing.pivot.x + swing.open.x * swing.leaf, 9);
    expect(leaf.to.z).toBeCloseTo(swing.pivot.z + swing.open.z * swing.leaf, 9);
    // The arc runs from the open leaf back to the closed one: a quarter turn.
    expect(arc.radius).toBeCloseTo(swing.leaf, 9);
    expect(Math.abs(arc.a1 - arc.a0)).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.cos(arc.a0)).toBeCloseTo(swing.open.x, 6);
    expect(Math.sin(arc.a0)).toBeCloseTo(swing.open.z, 6);
    expect(Math.cos(arc.a1)).toBeCloseTo(swing.closed.x, 6);
    expect(Math.sin(arc.a1)).toBeCloseTo(swing.closed.z, 6);
  });
});

describe('buildPlanDrawing: fixtures', () => {
  test('only bath and kitchen categories are drawn, and only what stands on the floor', () => {
    const drawing = drawingOf(apartmentScene);
    const fixtures = kinds(drawing, 'fixture').filter(
      (primitive): primitive is Extract<PlanPrimitive, { kind: 'fixture' }> => primitive.kind === 'fixture',
    );
    expect(fixtures.length).toBeGreaterThan(3);
    for (const fixture of fixtures) expect(isPlanFixtureCategory(fixture.category)).toBe(true);

    // Every floor-standing bath/kitchen placement of the demo is there, and
    // nothing else: a sofa never reaches the drawing.
    const expected = apartmentScene.assets.filter((asset) => {
      const entry = findCatalogueEntry(asset.asset ?? asset.type);
      return Boolean(entry) && entry!.object.anchor === 'floor' && isPlanFixtureCategory(entry!.object.category);
    });
    expect(fixtures.length).toBe(expected.length);
    expect(fixtures.every((fixture) => fixture.polygon.length === 4)).toBe(true);
  });

  test('fixtures can be switched off entirely', () => {
    const scene = apartmentScene;
    const plan = solvePlan(scene);
    // Fixtures are DATA now: a drawing built without them simply has none,
    // which is also what a caller that does not resolve them gets.
    expect(buildPlanDrawing(plan, scene, { frameWidthOf: openingFrameWidth }).primitives.some((p) => p.kind === 'fixture')).toBe(false);
  });

  test('the category predicate names bathroom, kitchen and floor appliances, and nothing else', () => {
    for (const fixture of [
      'bathroom/toilets',
      'bathroom/baths',
      'bathroom/vanity-units',
      'kitchen/base-units',
      'kitchen/tall-units',
      'kitchen/islands',
      'appliances/cookers',
      'appliances/refrigerators',
      'appliances/washing-machines',
    ])
      expect({ fixture, drawn: isPlanFixtureCategory(fixture) }).toEqual({ fixture, drawn: true });
    // A hood hangs above the worktop and a kettle stands on it: neither has a footprint on the plan.
    for (const other of [
      'appliances/cooker-hoods',
      'appliances/kettles',
      'furniture/sofas',
      'decor/rugs',
      'lighting/pendants',
      'sanitary/wc',
    ])
      expect({ other, drawn: isPlanFixtureCategory(other) }).toEqual({ other, drawn: false });
  });
});

describe('roomAt', () => {
  test('every room answers for its own centroid, and a point outside answers null', () => {
    const drawing = drawingOf(lShapePlan);
    const rooms = kinds(drawing, 'room').filter(
      (primitive): primitive is Extract<PlanPrimitive, { kind: 'room' }> => primitive.kind === 'room',
    );
    expect(rooms.map((room) => room.id).sort()).toEqual([L_SHAPE.room.a, L_SHAPE.room.b]);
    for (const room of rooms) expect(roomAt(drawing, centroid(room.polygon))).toBe(room.id);
    expect(roomAt(drawing, { x: -5, z: -5 })).toBeNull();
    expect(roomAt(drawing, { x: 9, z: 7 })).toBeNull();
  });

  test('the demo apartment answers for every authored room anchor', () => {
    const drawing = drawingOf(apartmentScene);
    for (const room of apartmentScene.rooms) {
      expect({ id: room.id, hit: roomAt(drawing, room.anchor) }).toEqual({ id: room.id, hit: room.id });
    }
  });
});

describe('fitTransform', () => {
  test('keeps the aspect ratio and the padding on both axes', () => {
    const bounds = { min: { x: 0, z: 0 }, max: { x: 10, z: 5 } };
    const transform = fitTransform(bounds, { w: 800, h: 600 }, 0.06);
    // One scale for both axes: 800 * 0.88 / 10 is the binding constraint.
    expect(transform.scale).toBeCloseTo((800 * 0.88) / 10, 9);
    const a = planPoint(transform, bounds.min);
    const b = planPoint(transform, bounds.max);
    expect(a.x).toBeCloseTo(800 * 0.06, 6);
    expect(b.x).toBeCloseTo(800 * 0.94, 6);
    // Centred on the short axis, and never tighter than the padding.
    expect((a.y + b.y) / 2).toBeCloseTo(300, 6);
    expect(a.y).toBeGreaterThan(600 * 0.06);
  });

  test('a portrait viewport binds on height instead', () => {
    const bounds = { min: { x: -2, z: -2 }, max: { x: 2, z: 6 } };
    const transform = fitTransform(bounds, { w: 400, h: 400 }, 0.1);
    expect(transform.scale).toBeCloseTo((400 * 0.8) / 8, 9);
    const centre = planPoint(transform, { x: 0, z: 2 });
    expect(centre.x).toBeCloseTo(200, 6);
    expect(centre.y).toBeCloseTo(200, 6);
  });

  test('a degenerate bounds or viewport still yields a finite transform', () => {
    const transform = fitTransform({ min: { x: 1, z: 1 }, max: { x: 1, z: 1 } }, { w: 0, h: 0 }, 0.5);
    expect(Number.isFinite(transform.scale)).toBe(true);
    expect(Number.isFinite(transform.ox)).toBe(true);
    expect(Number.isFinite(transform.oy)).toBe(true);
  });
});

describe('the drawing as a whole', () => {
  test('its bounds are the solved plan bounds, and every primitive lies inside them', () => {
    const plan = solvePlan(apartmentScene);
    const drawing = buildPlanDrawing(plan, apartmentScene, planDrawingInputs(apartmentScene));
    expect(drawing.bounds.min.x).toBeCloseTo(plan.bounds.minX, 9);
    expect(drawing.bounds.max.z).toBeCloseTo(plan.bounds.maxZ, 9);
    const pad = 0.35; // a door leaf may reach past the wall body it hangs on
    for (const primitive of drawing.primitives) {
      const points =
        primitive.kind === 'leaf'
          ? [primitive.from, primitive.to]
          : primitive.kind === 'swing'
            ? [primitive.centre]
            : primitive.kind === 'opening' || primitive.kind === 'window'
              ? primitive.quad
              : primitive.kind === 'label'
                ? [primitive.at]
                : primitive.kind === 'dimension'
                  ? [primitive.a, primitive.b]
                  : primitive.polygon;
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(drawing.bounds.min.x - pad);
        expect(point.x).toBeLessThanOrEqual(drawing.bounds.max.x + pad);
        expect(point.z).toBeGreaterThanOrEqual(drawing.bounds.min.z - pad);
        expect(point.z).toBeLessThanOrEqual(drawing.bounds.max.z + pad);
      }
    }
  });

  test('nothing but rooms carries a label, and there is no furniture beyond the fixtures', () => {
    const drawing = drawingOf(apartmentScene);
    const present = new Set(drawing.primitives.map((primitive) => primitive.kind));
    expect([...present].sort()).toEqual(['fixture', 'leaf', 'opening', 'room', 'swing', 'wall', 'window']);
  });
});
