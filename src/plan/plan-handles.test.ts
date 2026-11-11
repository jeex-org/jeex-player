/**
 * The plan tool's handles: where they stand on the selected wall or opening,
 * in plan metres, and which one a pointer pixel lands on.
 */

import { describe, expect, test } from 'bun:test';
import { handleAt, planHandles, type PlanHandle } from './plan-handles.js';
import { solvePlan } from './plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { planPoint, type PlanTransform } from './plan-drawing.js';

const plan = solvePlan(lShapePlan);

/** 50 px per metre, the plan origin at pixel (100, 100). */
const TRANSFORM: PlanTransform = { scale: 50, ox: 100, oy: 100 };

const at = (handle: PlanHandle | undefined): { x: number; z: number } | undefined =>
  handle ? { x: round(handle.at.x), z: round(handle.at.z) } : undefined;
const round = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;

describe('planHandles', () => {
  test('a straight wall: a node handle at each end, a wall handle at the middle carrying its unit normal', () => {
    // The south facade run: n1 (0, 0) to n2 (6, 0).
    const handles = planHandles(plan, lShapePlan, { kind: 'wall', id: L_SHAPE.wall.wSA });
    const nodes = handles.filter((handle) => handle.kind === 'node');
    expect(nodes.map((handle) => handle.kind === 'node' && handle.nodeId)).toEqual([L_SHAPE.node.n1, L_SHAPE.node.n2]);
    expect(nodes.map((handle) => at(handle))).toEqual([
      { x: 0, z: 0 },
      { x: 6, z: 0 },
    ]);
    const middle = handles.find((handle) => handle.kind === 'wall');
    expect(at(middle)).toEqual({ x: 3, z: 0 });
    if (middle?.kind !== 'wall') throw new Error('no wall handle');
    expect(Math.abs(middle.normal.x)).toBeCloseTo(0, 9);
    expect(Math.abs(middle.normal.z)).toBeCloseTo(1, 9);
    expect(handles).toHaveLength(3);
  });

  test('an opening: its body at `center` and its jambs at `center ± width / 2` on the centreline', () => {
    // The entry door on the south run: centre 1.25 m, 1 m wide.
    const handles = planHandles(plan, lShapePlan, { kind: 'opening', id: L_SHAPE.opening.doorEntry });
    expect(handles.map((handle) => handle.kind)).toEqual(['opening', 'opening-end', 'opening-end']);
    expect(handles.map((handle) => at(handle))).toEqual([
      { x: 1.25, z: 0 },
      { x: 0.75, z: 0 },
      { x: 1.75, z: 0 },
    ]);
    expect(handles.map((handle) => (handle.kind === 'opening-end' ? handle.end : null))).toEqual([null, 'a', 'b']);
  });

  test('a room, a placement, or a target the document does not carry gives no handles', () => {
    expect(planHandles(plan, lShapePlan, { kind: 'room', id: L_SHAPE.room.a })).toEqual([]);
    expect(planHandles(plan, lShapePlan, { kind: 'furniture', id: lShapePlan.assets[0]!.id })).toEqual([]);
    expect(planHandles(plan, lShapePlan, { kind: 'wall', id: L_SHAPE.room.a })).toEqual([]);
  });
});

describe('handleAt', () => {
  const handles = planHandles(plan, lShapePlan, { kind: 'wall', id: L_SHAPE.wall.wSA });
  const n1 = planPoint(TRANSFORM, { x: 0, z: 0 });

  test('finds a handle 11 px from its centre and none 13 px away, under a known transform', () => {
    const hit = handleAt(handles, { x: n1.x - 11, y: n1.y }, TRANSFORM, 12);
    expect(hit?.kind === 'node' && hit.nodeId).toBe(L_SHAPE.node.n1);
    expect(handleAt(handles, { x: n1.x - 13, y: n1.y }, TRANSFORM, 12)).toBeNull();
  });
});
