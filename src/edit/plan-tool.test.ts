/**
 * The plan tool's state machine over a fake host: which presses it claims,
 * what one drag emits, what a refused release puts back, and when it stays
 * out of the way. A real `SceneModel` judges every batch.
 */

import { describe, expect, test } from 'bun:test';
import { PlanTool, type CanvasPoint, type PlanToolHost } from './plan-tool.js';
import { bindPlanToolInput } from './plan-tool-session.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { SceneModel } from '../scene/scene-model.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { planPoint, type PlanTransform } from '../plan/plan-drawing.js';
import type { ViewerMode } from '../scene/types.js';
import type { PlanEdit, PlanEditRefused, PlanToolStateEvent } from './plan-edit.js';
import type { PlanDraft } from './pending-plan-edit.js';

/** Another document's id, as a host mints it. */
const OTHER_SCENE = '01a13a43-2c6e-7b19-9d4f-5e8a0c3b7f21';

/** 50 px per metre, the plan origin at pixel (100, 100). */
const TRANSFORM: PlanTransform = { scale: 50, ox: 100, oy: 100 };
const px = (x: number, z: number): { x: number; y: number } => planPoint(TRANSFORM, { x, z });

function harness(target: { kind: 'wall' | 'opening' | 'room' | 'furniture'; id: string } = { kind: 'wall', id: L_SHAPE.wall.wSA }) {
  const model = new SceneModel(lShapePlan, CATALOGUE_REGISTRIES);
  const world = { mode: 'plan2d' as ViewerMode, target, model };
  /** The ops of every trial the tool ran, in order. */
  const trials: Array<readonly unknown[]> = [];
  const edits: PlanEdit[] = [];
  const refusals: PlanEditRefused[] = [];
  const states: PlanToolStateEvent['phase'][] = [];
  const drafts: Array<PlanDraft | null> = [];
  const hints: Array<string | null> = [];
  const frames: Array<() => void> = [];
  const host: PlanToolHost = {
    mode: () => world.mode,
    target: () => world.target,
    model: () => ({
      get scene() {
        return world.model.scene;
      },
      get plan() {
        return world.model.plan;
      },
      get rev() {
        return world.model.rev;
      },
      trial: (batch) => {
        trials.push(batch.ops);
        return world.model.trial(batch);
      },
    }),
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
  return { tool, model, world, edits, refusals, states, drafts, hints, frames, trials };
}

/** The tool bound to a stand-in canvas whose top-left corner is the page's: `fire` plays one pointer event on the scene canvas. */
function bound(h: ReturnType<typeof harness>) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const canvas = {
    dataset: {} as Record<string, string>,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  };
  const container = {
    addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), handler]),
    removeEventListener: () => undefined,
  };
  const keys = { addEventListener: () => undefined, removeEventListener: () => undefined };
  bindPlanToolInput(h.tool, {
    container: container as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLElement,
    keys: keys as unknown as HTMLElement,
    typing: () => false,
    signal: new AbortController().signal,
  });
  return (type: string, at: CanvasPoint, pointerId = 1): void => {
    const event = { type, target: canvas, clientX: at.x, clientY: at.y, pointerId, button: 0, stopImmediatePropagation: () => undefined };
    for (const handler of listeners.get(type) ?? []) handler(event);
  };
}

describe('the plan tool', () => {
  test('a press off every handle is not claimed', () => {
    const h = harness();
    expect(h.tool.press(px(3, 2), 1)).toBe(false);
    expect(h.states).toEqual([]);
  });

  test('press, move and release on a node handle: one `planEdit`, two `planToolState` edges, the draft stays', () => {
    const h = harness();
    expect(h.tool.press(px(6, 0), 1)).toBe(true);
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
    expect(h.tool.press(px(6, 0), 1)).toBe(true);
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
    h.tool.press(px(6, 0), 1);
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
    expect(h.tool.press(px(6, 0), 1)).toBe(false);
    const room = harness({ kind: 'room', id: L_SHAPE.room.a });
    expect(room.tool.press(px(6, 0), 1)).toBe(false);
  });

  test('a release under the 3 px travel threshold emits nothing', () => {
    const h = harness();
    expect(h.tool.press(px(6, 0), 1)).toBe(true);
    const start = px(6, 0);
    h.tool.move({ x: start.x + 2, y: start.y });
    h.tool.release({ x: start.x + 2, y: start.y });
    expect(h.edits).toEqual([]);
    expect(h.refusals).toEqual([]);
    expect(h.states).toEqual([]);
  });

  test('a cancelled press under the travel threshold lets go: later moves and releases emit nothing, the next press is claimed', () => {
    const h = harness();
    const fire = bound(h);
    const start = px(6, 0);
    fire('pointerdown', start);
    fire('pointercancel', { x: start.x + 1, y: start.y });
    fire('pointermove', px(6.5, 0));
    for (const run of h.frames.splice(0)) run();
    fire('pointerup', px(6.5, 0));
    expect(h.edits).toEqual([]);
    expect(h.states).toEqual([]);
    expect(h.tool.press(start, 1)).toBe(true);
  });

  test('a drag belongs to the pointer that pressed: another pointer’s release does not end it', () => {
    const h = harness();
    const fire = bound(h);
    fire('pointerdown', px(6, 0), 1);
    fire('pointermove', px(6.5, 0), 1);
    for (const run of h.frames.splice(0)) run();
    fire('pointerup', px(7, 0), 2);
    expect(h.edits).toEqual([]);
    expect(h.tool.dragging()).toBe(true);
    fire('pointerup', px(6.5, 0), 1);
    expect(h.edits.map((edit) => edit.ops)).toEqual([[{ op: 'move_node', nodeId: L_SHAPE.node.n2, p: { x: 6.5, z: 0 } }]]);
    expect(h.states).toEqual(['dragging', 'idle']);
  });

  /** Press on n2, drag past the threshold with one judged frame: the draft shows the moved node. */
  const midDrag = (h: ReturnType<typeof harness>): void => {
    expect(h.tool.press(px(6, 0), 1)).toBe(true);
    h.tool.move(px(6.5, 0));
    for (const run of h.frames.splice(0)) run();
    expect(h.drafts.at(-1)).not.toBeNull();
  };
  /** No edit, no refusal, the drag's two edges, and the committed drawing back. */
  const endedWithNoEdit = (h: ReturnType<typeof harness>): void => {
    expect(h.edits).toEqual([]);
    expect(h.refusals).toEqual([]);
    expect(h.states).toEqual(['dragging', 'idle']);
    expect(h.drafts.at(-1)).toBeNull();
    expect(h.tool.dragging()).toBe(false);
    expect(h.tool.pressedBy()).toBeNull();
  };

  test('leaving plan2d mid-drag ends it with no edit, and the release after it emits nothing', () => {
    const h = harness();
    midDrag(h);
    h.world.mode = 'plan3d';
    // The wiring cancels on the `mode` event; a move or release before it ends the drag too.
    h.tool.move(px(7, 0));
    h.tool.release(px(7, 0));
    endedWithNoEdit(h);
  });

  test('`setPlanTool(false)` mid-drag ends it with no edit, and the release after it emits nothing', () => {
    const h = harness();
    midDrag(h);
    h.tool.setEnabled(false);
    expect(h.tool.release(px(6.5, 0))).toBe(false);
    endedWithNoEdit(h);
  });

  test('another selection mid-drag ends it on the next event with no edit', () => {
    const h = harness();
    midDrag(h);
    h.world.target = { kind: 'wall', id: L_SHAPE.wall.wE };
    h.tool.move(px(7, 0));
    h.tool.release(px(7, 0));
    endedWithNoEdit(h);
  });

  test('a new document mid-drag ends it with no edit, and a frame queued before it judges nothing', () => {
    const h = harness();
    midDrag(h);
    h.tool.move(px(7, 0));
    expect(h.frames).toHaveLength(1);
    h.world.model = new SceneModel({ ...lShapePlan, id: OTHER_SCENE }, CATALOGUE_REGISTRIES);
    h.tool.documentChanged();
    const trials = h.trials.length;
    for (const run of h.frames.splice(0)) run();
    expect(h.trials).toHaveLength(trials);
    h.tool.release(px(7, 0));
    endedWithNoEdit(h);
  });

  test('a cancelled pointer past the travel threshold ends the drag with no edit; the release after it passes through', () => {
    const h = harness();
    const fire = bound(h);
    fire('pointerdown', px(6, 0));
    fire('pointermove', px(6.5, 0));
    for (const run of h.frames.splice(0)) run();
    expect(h.tool.dragging()).toBe(true);
    fire('pointercancel', px(6.5, 0));
    fire('pointerup', px(6.5, 0));
    endedWithNoEdit(h);
  });

  test('a tool never armed claims nothing, paints nothing and emits nothing', () => {
    const h = harness();
    const tool = new PlanTool({
      mode: () => 'plan2d',
      target: () => ({ kind: 'wall', id: L_SHAPE.wall.wSA }),
      model: () => h.model,
      transform: () => TRANSFORM,
      showDraft: (draft) => h.drafts.push(draft),
      redraw: () => undefined,
      emitEdit: (edit) => h.edits.push(edit),
      emitRefused: (refusal) => h.refusals.push(refusal),
      emitState: (state) => h.states.push(state.phase),
      hint: (key) => h.hints.push(key),
      frame: (run) => h.frames.push(run),
    });
    expect(tool.press(px(6, 0), 1)).toBe(false);
    expect(tool.move(px(6.5, 0))).toBe(false);
    expect(tool.release(px(6.5, 0))).toBe(false);
    expect(tool.view()).toBeNull();
    expect(h.frames).toEqual([]);
    expect(h.edits).toEqual([]);
    expect(h.refusals).toEqual([]);
    expect(h.states).toEqual([]);
    expect(h.drafts).toEqual([]);
  });

  test('a wall dragged along itself moves nothing: no `planEdit`, no refusal, and the tool goes back to idle', () => {
    const h = harness();
    expect(h.tool.press(px(3, 0), 1)).toBe(true);
    h.tool.move(px(5, 0));
    for (const run of h.frames.splice(0)) run();
    h.tool.release(px(5, 0));
    endedWithNoEdit(h);
  });

  test('a node dragged away and back to where it started moves nothing: no `planEdit`, no refusal, idle', () => {
    const h = harness();
    midDrag(h);
    h.tool.release(px(6, 0));
    endedWithNoEdit(h);
  });

  /** Press on the node handle at `from`, drag to `to` with one judged frame, release there. */
  const dragNode = (h: ReturnType<typeof harness>, from: { x: number; z: number }, to: { x: number; z: number }): void => {
    expect(h.tool.press(px(from.x, from.z), 1)).toBe(true);
    h.tool.move(px(to.x, to.z));
    for (const run of h.frames.splice(0)) run();
    h.tool.release(px(to.x, to.z));
  };
  const FIRST = { op: 'move_node', nodeId: L_SHAPE.node.n2, p: { x: 6.5, z: 0 } } as const;
  const SECOND = { op: 'move_node', nodeId: L_SHAPE.node.n2, p: { x: 7, z: 0 } } as const;

  test('a second drag before the host answers is judged on the first, and its `planEdit` carries only its own ops on the same `baseRev`', () => {
    const h = harness();
    dragNode(h, { x: 6, z: 0 }, { x: 6.5, z: 0 });
    h.trials.splice(0);
    // The handle is read from the draft: the node is at 6.5 now.
    dragNode(h, { x: 6.5, z: 0 }, { x: 7, z: 0 });
    expect(h.trials.at(-1)).toEqual([FIRST, SECOND]);
    expect(h.edits.map((edit) => ({ ops: edit.ops, baseRev: edit.baseRev }))).toEqual([
      { ops: [FIRST], baseRev: 0 },
      { ops: [SECOND], baseRev: 0 },
    ]);
  });

  test('the host’s document at a later revision answers the pending edit: the draft goes and the next drag builds on the document', () => {
    const h = harness();
    dragNode(h, { x: 6, z: 0 }, { x: 6.5, z: 0 });
    expect(h.model.apply({ baseRev: 0, ops: [...h.edits[0]!.ops] })).not.toHaveProperty('error');
    h.tool.documentChanged();
    expect(h.drafts.at(-1)).toBeNull();
    h.trials.splice(0);
    dragNode(h, { x: 6.5, z: 0 }, { x: 7, z: 0 });
    expect(h.trials.at(-1)).toEqual([SECOND]);
    expect(h.edits.at(-1)?.baseRev).toBe(1);
  });

  test('another document answers the pending edit at any revision', () => {
    const h = harness();
    dragNode(h, { x: 6, z: 0 }, { x: 6.5, z: 0 });
    h.world.model = new SceneModel({ ...lShapePlan, id: OTHER_SCENE }, CATALOGUE_REGISTRIES);
    h.tool.documentChanged();
    expect(h.drafts.at(-1)).toBeNull();
    h.trials.splice(0);
    dragNode(h, { x: 6, z: 0 }, { x: 7, z: 0 });
    expect(h.trials.at(-1)).toEqual([SECOND]);
  });

  test('the same document handed back at the same revision keeps the pending edit', () => {
    const h = harness();
    dragNode(h, { x: 6, z: 0 }, { x: 6.5, z: 0 });
    const shown = h.drafts.length;
    h.tool.documentChanged();
    expect(h.drafts).toHaveLength(shown);
    h.trials.splice(0);
    dragNode(h, { x: 6.5, z: 0 }, { x: 7, z: 0 });
    expect(h.trials.at(-1)).toEqual([FIRST, SECOND]);
  });
});
