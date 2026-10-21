import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { apartmentScene } from '../demo/scene-data.js';
import { bayPlan, lShapePlan } from '../fixtures/plan-l-shape.js';
import { solvePlan } from '../plan/plan-solver.js';
import { checkCompleteness } from './completeness.js';
import type { SceneData } from './types.js';
import { DEMO } from '../demo/demo-ids.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';

/** Fixed ids for these tests, generated once offline. */
const STRAY_STOOL = '01a12ff5-8951-7627-a8b9-a4e159e87755';
/** A finish no catalogue declares. */
const UNKNOWN_FINISH = '01a12ff5-8952-7c19-a2d6-ccd89d1eab18';

const demoPlan = solvePlan(apartmentScene);
const demoReport = checkCompleteness(apartmentScene, demoPlan, CATALOGUE_REGISTRIES);

describe('checkCompleteness — the demo apartment', () => {
  test('yields zero warnings', () => {
    expect(demoReport.counts.warning).toBe(0);
  });

  test('never raises an error-severity finding', () => {
    expect(demoReport.counts.error).toBe(0);
    expect(demoReport.entries.every((entry) => entry.severity === 'info' || entry.severity === 'warning')).toBe(true);
  });

  test('names the interior rooms that carry no window as info, not warning', () => {
    const windowless = demoReport.entries.filter((entry) => entry.code === 'room-no-window');
    const ids = windowless.map((entry) => entry.entity?.id).sort((a, b) => (a ?? '').localeCompare(b ?? ''));
    // The hall and the WC are the two rooms the plan gives no window.
    expect(ids).toEqual([DEMO.room.hall, DEMO.room.wc].sort((a, b) => a.localeCompare(b)));
    expect(windowless.every((entry) => entry.severity === 'info')).toBe(true);
  });

  test('names every opening left at its catalogue default look as info', () => {
    const noVariant = demoReport.entries.filter((entry) => entry.code === 'opening-no-variant');
    expect(noVariant.length).toBeGreaterThan(0);
    expect(noVariant.every((entry) => entry.severity === 'info' && entry.entity?.kind === 'opening')).toBe(true);
  });

  test("reports the missing storey as info (the schema's own documented default)", () => {
    const storey = demoReport.entries.filter((entry) => entry.code === 'storey-missing');
    expect(storey).toHaveLength(1);
    expect(storey[0]?.severity).toBe('info');
  });

  test('reports no units-missing finding (the demo carries its units)', () => {
    expect(demoReport.entries.some((entry) => entry.code === 'units-missing')).toBe(false);
  });
});

describe('checkCompleteness — room-no-door', () => {
  test('a room with no door-like opening is reported, its neighbour with one is not', () => {
    const noDoorScene: SceneData = {
      ...lShapePlan,
      walls: lShapePlan.walls.map((wall) => (wall.id === L_SHAPE.wall.wPart ? { ...wall, openings: [] } : wall)),
    };
    const plan = solvePlan(noDoorScene);
    const report = checkCompleteness(noDoorScene, plan, CATALOGUE_REGISTRIES);
    const findings = report.entries.filter((entry) => entry.code === 'room-no-door');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'warning', entity: { kind: 'room', id: L_SHAPE.room.b } });
  });

  test('is skipped when the plan has one room', () => {
    // `bayPlan`'s only door names no `entrance`, so it also exercises `no-entrance`.
    const plan = solvePlan(bayPlan);
    const report = checkCompleteness(bayPlan, plan, CATALOGUE_REGISTRIES);
    expect(report.entries.some((entry) => entry.code === 'room-no-door')).toBe(false);
  });
});

describe('checkCompleteness — no-entrance', () => {
  test('a scene with no entrance-marked opening is reported once, scene-wide', () => {
    const plan = solvePlan(bayPlan);
    const report = checkCompleteness(bayPlan, plan, CATALOGUE_REGISTRIES);
    const findings = report.entries.filter((entry) => entry.code === 'no-entrance');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.entity).toBeUndefined();
  });

  test('the demo apartment, which does mark an entrance, is not reported', () => {
    expect(demoReport.entries.some((entry) => entry.code === 'no-entrance')).toBe(false);
  });
});

describe('checkCompleteness — asset-outside-rooms', () => {
  test('an asset placed outside every room polygon is reported with its id', () => {
    const outsideScene: SceneData = {
      ...lShapePlan,
      assets: [...lShapePlan.assets, { id: STRAY_STOOL, type: 'stool', position: { x: 100, y: 0, z: 100 } }],
    };
    const plan = solvePlan(outsideScene);
    const report = checkCompleteness(outsideScene, plan, CATALOGUE_REGISTRIES);
    const finding = report.entries.find((entry) => entry.code === 'asset-outside-rooms');
    expect(finding).toMatchObject({ severity: 'warning', entity: { kind: 'asset', id: STRAY_STOOL } });
  });

  test('every demo asset sits inside a room', () => {
    expect(demoReport.entries.some((entry) => entry.code === 'asset-outside-rooms')).toBe(false);
  });
});

describe('checkCompleteness — room-unnamed', () => {
  test('a room with an empty name is reported', () => {
    const unnamedScene: SceneData = {
      ...lShapePlan,
      rooms: lShapePlan.rooms.map((room, index) => (index === 0 ? { ...room, name: '' } : room)),
    };
    const plan = solvePlan(unnamedScene);
    const report = checkCompleteness(unnamedScene, plan, CATALOGUE_REGISTRIES);
    const finding = report.entries.find((entry) => entry.code === 'room-unnamed');
    expect(finding).toMatchObject({ severity: 'warning', entity: { kind: 'room', id: L_SHAPE.room.a } });
  });
});

describe('checkCompleteness — room-no-floor-finish', () => {
  test('a room whose floor material does not resolve is reported', () => {
    const badFloorScene: SceneData = {
      ...lShapePlan,
      rooms: lShapePlan.rooms.map((room) => (room.id === L_SHAPE.room.a ? { ...room, floorMaterial: UNKNOWN_FINISH } : room)),
    };
    const plan = solvePlan(badFloorScene);
    const report = checkCompleteness(badFloorScene, plan, CATALOGUE_REGISTRIES);
    const finding = report.entries.find((entry) => entry.code === 'room-no-floor-finish');
    expect(finding).toMatchObject({ severity: 'warning', entity: { kind: 'room', id: L_SHAPE.room.a } });
  });
});

describe('checkCompleteness — units-missing', () => {
  test('a document with no explicit units is reported as info', () => {
    const { units: _units, ...withoutUnits } = lShapePlan;
    const unitless: SceneData = withoutUnits;
    const plan = solvePlan(unitless);
    const report = checkCompleteness(unitless, plan, CATALOGUE_REGISTRIES);
    const finding = report.entries.find((entry) => entry.code === 'units-missing');
    expect(finding?.severity).toBe('info');
  });
});
