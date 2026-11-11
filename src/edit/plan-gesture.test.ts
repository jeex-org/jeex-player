/**
 * The plan tool's gestures as operations: one case per handle, exact ops,
 * every value on the millimetre.
 */

import { describe, expect, test } from 'bun:test';
import { gestureOps } from './plan-gesture.js';
import { planHandles, type PlanHandle } from '../plan/plan-handles.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { SceneModel } from '../scene/scene-model.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';

const start = { scene: lShapePlan, plan: solvePlan(lShapePlan) };
const wallHandles = planHandles(start.plan, lShapePlan, { kind: 'wall', id: L_SHAPE.wall.wSA });
const doorHandles = planHandles(start.plan, lShapePlan, { kind: 'opening', id: L_SHAPE.opening.doorEntry });
const pick = (handles: readonly PlanHandle[], match: (handle: PlanHandle) => boolean): PlanHandle =>
  handles.find((handle) => match(handle))!;

describe('gestureOps', () => {
  test('a node dragged 0.5 m: `move_node` to its start plus the travel, on the millimetre', () => {
    const n1 = pick(wallHandles, (handle) => handle.kind === 'node' && handle.nodeId === L_SHAPE.node.n1);
    const result = gestureOps(n1, { x: 0.0003, z: 0.0001 }, { x: 0.5004, z: 0.0002 }, start);
    expect(result).toEqual({ gesture: 'node', ops: [{ op: 'move_node', nodeId: L_SHAPE.node.n1, p: { x: 0.5, z: 0 } }] });
  });

  test('the wall handle keeps only the travel across the wall: both end nodes move by the same `dp`', () => {
    const middle = pick(wallHandles, (handle) => handle.kind === 'wall');
    const result = gestureOps(middle, { x: 3, z: 0 }, { x: 4, z: 0.3 }, start);
    expect(result?.gesture).toBe('wall');
    expect(result?.ops).toEqual([
      { op: 'move_node', nodeId: L_SHAPE.node.n1, dp: { x: 0, z: 0.3 } },
      { op: 'move_node', nodeId: L_SHAPE.node.n2, dp: { x: 0, z: 0.3 } },
    ]);
    // Travel along the wall alone moves nothing across it.
    expect(gestureOps(middle, { x: 3, z: 0 }, { x: 5, z: 0 }, start)?.ops).toEqual([
      { op: 'move_node', nodeId: L_SHAPE.node.n1, dp: { x: 0, z: 0 } },
      { op: 'move_node', nodeId: L_SHAPE.node.n2, dp: { x: 0, z: 0 } },
    ]);
  });

  test('an opening dragged past the end of its wall stops at the end of the centreline', () => {
    const body = pick(doorHandles, (handle) => handle.kind === 'opening');
    const length = start.plan.centrelines.find((line) => line.wallId === L_SHAPE.wall.wSA)!.length;
    const result = gestureOps(body, { x: 1.25, z: 0 }, { x: 40, z: 0.2 }, start);
    expect(result).toEqual({
      gesture: 'opening',
      ops: [{ op: 'set_opening', openingId: L_SHAPE.opening.doorEntry, center: Math.round(length * 1000) / 1000 }],
    });
  });

  test('a jamb drag keeps the other jamb where it was and gives the new `center` and `width`', () => {
    const jambB = pick(doorHandles, (handle) => handle.kind === 'opening-end' && handle.end === 'b');
    // The door spans 0.75..1.75; its far jamb goes to 2.0.
    const result = gestureOps(jambB, { x: 1.75, z: 0 }, { x: 2, z: 0.1 }, start);
    expect(result).toEqual({
      gesture: 'opening-width',
      ops: [{ op: 'set_opening', openingId: L_SHAPE.opening.doorEntry, center: 1.375, width: 1.25 }],
    });
  });

  test('a jamb dragged closer than the narrowest opening stops there: the fixed jamb stays exactly where it was', () => {
    const jambB = pick(doorHandles, (handle) => handle.kind === 'opening-end' && handle.end === 'b');
    // The door spans 0.75..1.75; its far jamb goes to 0.85, a 0.1 m door.
    const op = gestureOps(jambB, { x: 1.75, z: 0 }, { x: 0.85, z: 0 }, start)?.ops[0];
    if (op?.op !== 'set_opening') throw new Error('expected a set_opening');
    expect(op.center! - op.width! / 2).toBeCloseTo(0.75, 9);
    // The model commits the op as it is: the narrowest door, its near jamb still at 0.75.
    const judged = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES).trial({ baseRev: 0, ops: [op] });
    if ('error' in judged) throw new Error(judged.message);
    const door = judged.scene.walls.flatMap((wall) => wall.openings ?? []).find((item) => item.id === L_SHAPE.opening.doorEntry)!;
    expect(door.center - door.width / 2).toBeCloseTo(0.75, 9);
  });
});
