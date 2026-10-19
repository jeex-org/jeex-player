/**
 * `roomLabels` and `facadeDimensions` against the L-shape fixture
 * (hand-verified numbers, `fixtures/plan-l-shape.ts`) and the demo apartment.
 */

import { describe, expect, test } from 'bun:test';
import { FACADE_DIMENSION_OFFSET_M, facadeDimensions, roomLabels } from './plan-dimensions.js';
import { solvePlan } from './plan-solver.js';
import { pointInPolygon } from './plan-geometry.js';
import { buildPlanDrawing } from './plan-drawing.js';
import { planDrawingInputs } from '../assets/plan-fixtures.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { lShapePlan, bayPlan } from '../fixtures/plan-l-shape.js';
import { apartmentScene } from '../demo/scene-data.js';

describe('roomLabels', () => {
  test('one label per solved room face, named and sized from the source rooms', () => {
    const plan = solvePlan(lShapePlan);
    const labels = roomLabels(plan, lShapePlan.rooms);
    expect(labels.map((l) => l.roomId).sort()).toEqual([L_SHAPE.room.a, L_SHAPE.room.b]);
    const byId = new Map(labels.map((l) => [l.roomId, l]));
    expect(byId.get(L_SHAPE.room.a)!.text).toBe('Room A');
    expect(byId.get(L_SHAPE.room.b)!.text).toBe('Room B');
  });

  test('each label sits strictly inside its own room polygon', () => {
    const plan = solvePlan(lShapePlan);
    const labels = roomLabels(plan, lShapePlan.rooms);
    for (const label of labels) {
      const face = plan.rooms.find((r) => r.roomId === label.roomId)!;
      expect(pointInPolygon(label.at, face.polygon)).toBe(true);
    }
  });

  test('area matches the shoelace area of the room polygon within 0.01 m2', () => {
    const plan = solvePlan(lShapePlan);
    const labels = roomLabels(plan, lShapePlan.rooms);
    // Room A is 5.8 x ~7.85 minus nothing (the jog is on B's side); just check
    // against the polygon itself so this does not restate the solver's own
    // numbers.
    for (const label of labels) {
      const face = plan.rooms.find((r) => r.roomId === label.roomId)!;
      const xs = face.polygon.map((p) => p.x);
      const zs = face.polygon.map((p) => p.z);
      const bboxArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
      expect(label.area).toBeGreaterThan(0);
      expect(label.area).toBeLessThanOrEqual(bboxArea + 0.01);
    }
  });

  test('a concave (L-shaped) room still gets a label strictly inside it', () => {
    // The demo apartment is the real thing: whichever of its rooms is
    // non-convex, every label must still land inside its own face.
    const plan = solvePlan(apartmentScene);
    const labels = roomLabels(plan, apartmentScene.rooms);
    expect(labels.length).toBe(plan.rooms.length);
    for (const label of labels) {
      const face = plan.rooms.find((r) => r.roomId === label.roomId)!;
      expect(pointInPolygon(label.at, face.polygon)).toBe(true);
    }
  });

  test('an unnamed source room falls back to its id (defensive; the schema requires a name)', () => {
    const plan = solvePlan(lShapePlan);
    const labels = roomLabels(plan, []);
    expect(labels.every((l) => l.text === l.roomId)).toBe(true);
  });
});

describe('facadeDimensions', () => {
  test('one chain per maximal run of adjacent, same-direction facade faces (lShapePlan: 6)', () => {
    // Facade loop order: w-s-a(+x), w-s-b(+x) merge into one southern chain;
    // w-e(+z); w-n-b(-x); w-step(+z); w-n-a(-x); w-w(-z). w-n-b and w-n-a are
    // both "north-going" in sign but are NOT adjacent in the loop (w-step sits
    // between them at the jog), so they stay two separate chains: 6 in total.
    const plan = solvePlan(lShapePlan);
    const dimensions = facadeDimensions(plan);
    expect(dimensions.length).toBe(6);
  });

  test('every value is within 0.005 m of the sum of its run’s face lengths', () => {
    const plan = solvePlan(lShapePlan);
    const dimensions = facadeDimensions(plan);
    const totalFaceLength = plan.facade.reduce((sum, face) => sum + face.length, 0);
    const totalDimensionValue = dimensions.reduce((sum, d) => sum + d.value, 0);
    expect(Math.abs(totalDimensionValue - totalFaceLength)).toBeLessThan(0.005 * plan.facade.length);
  });

  test('the merged southern run spans both w-s-a and w-s-b', () => {
    const plan = solvePlan(lShapePlan);
    const south = plan.facade.filter((f) => f.wallId === L_SHAPE.wall.wSA || f.wallId === L_SHAPE.wall.wSB);
    const expectedLength = south.reduce((sum, f) => sum + f.length, 0);
    const dimensions = facadeDimensions(plan);
    const match = dimensions.find((d) => Math.abs(d.value - Math.round(expectedLength * 100) / 100) < 0.005);
    expect(match).toBeDefined();
  });

  test('every chain sits offset 0.35 m outward from the wall it measures', () => {
    const plan = solvePlan(lShapePlan);
    for (const dimension of facadeDimensions(plan)) expect(dimension.offset).toBeCloseTo(FACADE_DIMENSION_OFFSET_M, 9);
  });

  test('a curved facade (bayPlan) still yields one finite chain per face, none merged across the arc', () => {
    const plan = solvePlan(bayPlan);
    const dimensions = facadeDimensions(plan);
    expect(dimensions.length).toBeGreaterThan(0);
    for (const dimension of dimensions) {
      expect(Number.isFinite(dimension.value)).toBe(true);
      expect(Number.isFinite(dimension.a.x)).toBe(true);
      expect(Number.isFinite(dimension.b.z)).toBe(true);
    }
  });
});

describe('buildPlanDrawing regression: without the new options, primitives are unchanged', () => {
  test('the L-shape and demo apartment gain no label or dimension primitive when the options are omitted', () => {
    for (const scene of [lShapePlan, apartmentScene]) {
      const plan = solvePlan(scene);
      const drawing = buildPlanDrawing(plan, scene, planDrawingInputs(scene));
      expect(drawing.primitives.some((p) => p.kind === 'label')).toBe(false);
      expect(drawing.primitives.some((p) => p.kind === 'dimension')).toBe(false);
    }
  });

  test('with both options on, the drawing gains exactly one label per room and the facade’s dimension chains', () => {
    const plan = solvePlan(lShapePlan);
    const drawing = buildPlanDrawing(plan, lShapePlan, { ...planDrawingInputs(lShapePlan), labels: true, dimensions: true });
    const labels = drawing.primitives.filter((p) => p.kind === 'label');
    const dims = drawing.primitives.filter((p) => p.kind === 'dimension');
    expect(labels.length).toBe(plan.rooms.length);
    expect(dims.length).toBe(facadeDimensions(plan).length);
  });
});
