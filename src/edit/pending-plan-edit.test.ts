/**
 * The plan edits the viewer emitted and the host has not answered: a later
 * revision or another document answers them, the same document at the same
 * revision answers nothing, a second record appends to the first (the plan
 * tool's own tests drive a second drag through it), and a revert with nothing
 * pending does nothing.
 */

import { describe, expect, test } from 'bun:test';
import { PendingPlanEdit } from './pending-plan-edit.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { SceneModel } from '../scene/scene-model.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import type { PlanEditOp } from './plan-edit.js';

/** Another document's id, as a host mints it. */
const OTHER_SCENE = '01a13a42-5d18-7f30-a2c4-8b9e1f6d3a75';

const FIRST: PlanEditOp[] = [{ op: 'move_node', nodeId: L_SHAPE.node.n3, p: { x: 10.5, z: 0 } }];
const SECOND: PlanEditOp[] = [{ op: 'move_node', nodeId: L_SHAPE.node.n4, p: { x: 10.5, z: 5 } }];

function pendingAfterFirst(): { model: SceneModel; pending: PendingPlanEdit } {
  const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
  const pending = new PendingPlanEdit();
  const draft = model.trial({ baseRev: model.rev, ops: FIRST });
  if ('error' in draft) throw new Error(draft.message);
  pending.record(model.scene.id, model.rev, FIRST, draft);
  return { model, pending };
}

describe('PendingPlanEdit', () => {
  test('a revision past the recorded one answers the pending edit', () => {
    const { model, pending } = pendingAfterFirst();
    expect(pending.documentChanged(model.scene.id, model.rev + 1)).toBe(true);
    expect(pending.draft()).toBeNull();
    expect(pending.ops()).toEqual([]);
  });

  test('another document answers it at any revision', () => {
    const { model, pending } = pendingAfterFirst();
    expect(pending.documentChanged(OTHER_SCENE, model.rev)).toBe(true);
    expect(pending.draft()).toBeNull();
  });

  test('the same document handed back at the same revision answers nothing: the draft stays', () => {
    const { model, pending } = pendingAfterFirst();
    expect(pending.documentChanged(model.scene.id, model.rev)).toBe(false);
    expect(pending.draft()).not.toBeNull();
    expect(pending.ops()).toEqual(FIRST);
  });

  test('a second record on the same document and revision appends its ops after the first and keeps the newer draft', () => {
    const { model, pending } = pendingAfterFirst();
    const second = model.trial({ baseRev: model.rev, ops: [...pending.ops(), ...SECOND] });
    if ('error' in second) throw new Error(second.message);
    const node = (id: string) => second.scene.nodes.find((candidate) => candidate.id === id)?.p;
    expect(node(L_SHAPE.node.n3)).toEqual({ x: 10.5, z: 0 });
    expect(node(L_SHAPE.node.n4)).toEqual({ x: 10.5, z: 5 });
    pending.record(model.scene.id, model.rev, SECOND, second);
    expect(pending.ops()).toEqual([...FIRST, ...SECOND]);
    expect(pending.draft()).toBe(second);
  });

  test('revert drops the record and the draft; with nothing pending it does nothing', () => {
    const { pending } = pendingAfterFirst();
    expect(pending.revert()).toBe(true);
    expect(pending.draft()).toBeNull();
    expect(pending.revert()).toBe(false);
    expect(new PendingPlanEdit().revert()).toBe(false);
  });
});
