/**
 * The plan tool's state machine over a fake host: which presses it claims,
 * what one drag emits, what a refused release puts back, and when it stays
 * out of the way. A real `SceneModel` judges every batch.
 */

import { describe, expect, test } from 'bun:test';
import { PlanTool, type PlanToolHost } from './plan-tool.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { SceneModel } from '../scene/scene-model.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { planPoint, type PlanTransform } from '../plan/plan-drawing.js';
import type { ViewerMode } from '../scene/types.js';
import type { PlanEdit, PlanEditRefused, PlanToolStateEvent } from './plan-edit.js';
import type { PlanDraft } from './pending-plan-edit.js';

/** 50 px per metre, the plan origin at pixel (100, 100). */
const TRANSFORM: PlanTransform = { scale: 50, ox: 100, oy: 100 };
const px = (x: number, z: number): { x: number; y: number } => planPoint(TRANSFORM, { x, z });

function harness(target: { kind: 'wall' | 'opening' | 'room' | 'furniture'; id: string } = { kind: 'wall', id: L_SHAPE.wall.wSA }) {
  const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
  const world = { mode: 'plan2d' as ViewerMode, target };
  const edits: PlanEdit[] = [];
  const refusals: PlanEditRefused[] = [];
  const states: PlanToolStateEvent['phase'][] = [];
  const drafts: Array<PlanDraft | null> = [];
  const hints: Array<string | null> = [];
  const frames: Array<() => void> = [];
  const host: PlanToolHost = {
    mode: () => world.mode,
    target: () => world.target,
    model: () => model,
    transform: () => TRANSFORM,
    showDraft: (draft) => drafts.push(draft),
    redraw: () => undefined,
    emitEdit: (edit) => edits.push(edit),
    emitRefused: (refusal) => refusals.push(refusal),
    emitState: (state) => states.push(state.phase),
    hint: (key) => hints.push(key),
    frame: (run) => frames.push(run),
  };
  const tool = new PlanTool(host);
  tool.setEnabled(true);
  return { tool, model, world, edits, refusals, states, drafts, hints, frames };
}

describe('the plan tool', () => {
  test('a press off every handle is not claimed', () => {
    const h = harness();
    expect(h.tool.press(px(3, 2))).toBe(false);
    expect(h.states).toEqual([]);
  });

  test('press, move and release on a node handle: one `planEdit`, two `planToolState` edges, the draft stays', () => {
    const h = harness();
    expect(h.tool.press(px(6, 0))).toBe(true);
    h.tool.move(px(6.5, 0));
    expect(h.states).toEqual(['dragging']);
    h.tool.release(px(6.5, 0));
    expect(h.edits).toEqual([
      {
        target: { kind: 'wall', id: L_SHAPE.wall.wSA },
        gesture: 'node',
        baseRev: 0,
        ops: [{ op: 'move_node', nodeId: L_SHAPE.node.n2, p: { x: 6.5, z: 0 } }],
      },
    ]);
    expect(h.states).toEqual(['dragging', 'idle']);
    expect(h.refusals).toEqual([]);
    const shown = h.drafts.at(-1);
    expect(shown?.scene.nodes.find((node) => node.id === L_SHAPE.node.n2)?.p).toEqual({ x: 6.5, z: 0 });
    // The committed document did not move: the host commits.
    expect(h.model.rev).toBe(0);
  });

  test('a release whose trial fails emits `planEditRefused` with the model’s message and shows the pre-press drawing', () => {
    const h = harness();
    // The corner n2 dragged across the east facade: the south run would cross it.
    expect(h.tool.press(px(6, 0))).toBe(true);
    h.tool.move(px(12, 2.5));
    h.tool.release(px(12, 2.5));
    expect(h.edits).toEqual([]);
    expect(h.refusals).toHaveLength(1);
    const refusal = h.refusals[0]!;
    expect(refusal.ops).toEqual([{ op: 'move_node', nodeId: L_SHAPE.node.n2, p: { x: 12, z: 2.5 } }]);
    const judged = h.model.trial({ baseRev: 0, ops: refusal.ops });
    expect('error' in judged && judged.message).toBe(refusal.reason.message);
    expect(refusal.reason.code).toBe('validation_failed');
    expect(h.drafts.at(-1)).toBeNull();
    expect(h.states).toEqual(['dragging', 'idle']);
    expect(h.hints).toContain('hint.planEditIllegal');
  });

  test('Esc during a drag cancels it: the drawing goes back and nothing is emitted', () => {
    const h = harness();
    h.tool.press(px(6, 0));
    h.tool.move(px(6.5, 0));
    for (const run of h.frames.splice(0)) run();
    expect(h.tool.key('Escape')).toBe(true);
    h.tool.release(px(6.5, 0));
    expect(h.edits).toEqual([]);
    expect(h.refusals).toEqual([]);
    expect(h.states).toEqual(['dragging', 'idle']);
    expect(h.drafts.at(-1)).toBeNull();
  });

  test('outside plan2d, and for a room selection, it claims nothing', () => {
    const h = harness();
    h.world.mode = 'plan3d';
    expect(h.tool.press(px(6, 0))).toBe(false);
    const room = harness({ kind: 'room', id: L_SHAPE.room.a });
    expect(room.tool.press(px(6, 0))).toBe(false);
  });

  test('a release under the 3 px travel threshold emits nothing', () => {
    const h = harness();
    expect(h.tool.press(px(6, 0))).toBe(true);
    const start = px(6, 0);
    h.tool.move({ x: start.x + 2, y: start.y });
    h.tool.release({ x: start.x + 2, y: start.y });
    expect(h.edits).toEqual([]);
    expect(h.refusals).toEqual([]);
    expect(h.states).toEqual([]);
  });
});
