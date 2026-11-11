/**
 * The plan tool end to end, in a mounted viewer in `plan2d`: a wall selected
 * by the host, the tool armed, real pointer events on the scene canvas at the
 * pixels `planView()` names. A legal drag emits one `planEdit` and touches
 * nothing in 3D; the host's applied document answers it, so the next drag
 * starts from what the host applied; an illegal drag is
 * refused with the drawing put back; `revertPlanEdit` puts the committed
 * drawing back after a legal one.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { PlanEdit, PlanEditRefused } from '../../src/edit/plan-edit.js';
import { CATALOGUE_REGISTRIES } from '../../src/assets/catalogue-registries.js';
import { SceneModel, isApplyOk } from '../../src/scene/scene-model.js';
import { planPoint } from '../../src/plan/plan-drawing.js';
import type { SceneData, Vec2 } from '../../src/scene/types.js';
import { closeContainers, demoScene, nextFrame, openContainer, readableCanvas, until } from './support.js';

type Debug = { mode: () => string | undefined };
const debug = (): Debug => (window as unknown as { __viewerDebug: Debug }).__viewerDebug;

const handles: ViewerHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

/** The demo's first wall and its first node, and one travel of the node the model takes and one it refuses. */
function plannedMoves(scene: SceneData): { wallId: string; nodeId: string; from: Vec2; legal: Vec2; illegal: Vec2 } {
  const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
  const wall = scene.walls[0]!;
  const node = scene.nodes.find((candidate) => candidate.id === wall.a)!;
  const judged = (to: Vec2): boolean =>
    !('error' in model.trial({ baseRev: model.rev, ops: [{ op: 'move_node', nodeId: node.id, p: to }] }));
  const around = (reach: number): Vec2[] =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([x, z]) => ({ x: node.p.x + x! * reach, z: node.p.z + z! * reach }));
  const legal = around(0.5).find((to) => judged(to));
  const illegal = [...around(4), ...around(8)].find((to) => !judged(to));
  if (!legal || !illegal) throw new Error('the demo has no legal 0.5 m move or no refused far move for its first node');
  return { wallId: wall.id, nodeId: node.id, from: node.p, legal, illegal };
}

let pointerId = 7000;

async function mounted() {
  const scene = demoScene();
  const container = openContainer();
  const handle = mountViewer(container, { scene: { repository: new InlineSceneRepository(scene) }, tour: { mode: 'off' }, debug: true });
  handles.push(handle);
  await handle.ready;
  const moves = plannedMoves(scene);
  const edits: PlanEdit[] = [];
  const refusals: PlanEditRefused[] = [];
  const states: string[] = [];
  const scenes: number[] = [];
  handle.on('planEdit', (edit) => edits.push(edit));
  handle.on('planEditRefused', (refusal) => refusals.push(refusal));
  handle.on('planToolState', (state) => states.push(state.phase));
  handle.on('scene', (info) => scenes.push(info.rev));
  const plan = container.querySelector<HTMLCanvasElement>('[data-jeex="plan-canvas"]')!;
  // The drawings compared below on one rasteriser (`readableCanvas`): before `plan2d` paints it first.
  readableCanvas(plan);
  handle.setMode('plan2d');
  await until(() => debug().mode() === 'plan2d', 'plan2d');
  handle.setSelection({ kind: 'wall', id: moves.wallId });
  handle.setPlanTool(true);
  const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
  const pixel = (point: Vec2): { clientX: number; clientY: number } => {
    const box = canvas.getBoundingClientRect();
    const at = planPoint(handle.planView()!.transform, point);
    return { clientX: box.left + at.x, clientY: box.top + at.y };
  };
  const fire = (type: string, point: Vec2, id: number): void => {
    canvas.dispatchEvent(new PointerEvent(type, { ...pixel(point), button: 0, pointerId: id, bubbles: true }));
  };
  // The tool is in once a pointer over the node's handle is answered with the grab cursor.
  await until(() => {
    fire('pointermove', moves.from, 1);
    return canvas.dataset['planHandle'] === 'node';
  }, 'the plan tool over the node handle');
  await nextFrame();
  /** Press on the node's handle at `from`, drag in steps to `to`, a frame, release. */
  const drag = async (to: Vec2, from: Vec2 = moves.from): Promise<void> => {
    const id = (pointerId += 1);
    fire('pointerdown', from, id);
    for (let step = 1; step <= 6; step += 1) {
      const k = step / 6;
      fire('pointermove', { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k }, id);
    }
    await nextFrame();
    fire('pointerup', to, id);
  };
  /** Waits until a pointer at `at` is over the node's handle. */
  const overNode = (at: Vec2): Promise<void> =>
    until(() => {
      fire('pointermove', at, 1);
      return canvas.dataset['planHandle'] === 'node';
    }, 'the plan tool over the node handle');
  const pixels = (): Uint8ClampedArray => plan.getContext('2d')!.getImageData(0, 0, plan.width, plan.height).data;
  return { handle, scene, moves, edits, refusals, states, scenes, drag, overNode, pixels };
}

describe('the plan tool', () => {
  test('a legal drag emits one `planEdit` and rebuilds nothing; the host’s applied document answers it', async () => {
    const m = await mounted();
    await m.drag(m.moves.legal);
    expect(m.edits).toHaveLength(1);
    const edit = m.edits[0]!;
    expect(edit).toMatchObject({ target: { kind: 'wall', id: m.moves.wallId }, gesture: 'node', baseRev: 0 });
    expect(edit.ops).toHaveLength(1);
    expect(edit.ops[0]).toMatchObject({ op: 'move_node', nodeId: m.moves.nodeId });
    expect(m.states).toEqual(['dragging', 'idle']);
    // The 3D scene is rebuilt only by a mounted document, and every mounted document raises `scene`: none so far.
    expect(m.scenes).toEqual([]);

    // The host commits its own answer, the node halfway to where it was dragged, and hands the document back.
    const applied = { x: (m.moves.from.x + m.moves.legal.x) / 2, z: (m.moves.from.z + m.moves.legal.z) / 2 };
    const host = new SceneModel(m.scene, CATALOGUE_REGISTRIES);
    expect(isApplyOk(host.apply({ baseRev: host.rev, ops: [{ op: 'move_node', nodeId: m.moves.nodeId, p: applied }] }))).toBe(true);
    await m.handle.loadScene({ document: host.toJSON() });
    // One document mounted, so one rebuild, for the host's document.
    expect(m.scenes).toEqual([1]);
    expect(m.handle.getState().rev).toBe(1);
    // The document answered the pending edit: the handle stands where the host put the node, and a drag
    // from there back to the start moves it by its own travel from the applied position.
    await m.overNode(applied);
    await m.drag(m.moves.from, applied);
    expect(m.edits).toHaveLength(2);
    expect(m.edits[1]).toMatchObject({ gesture: 'node', baseRev: 1 });
    const second = m.edits[1]!.ops[0]!;
    if (second.op !== 'move_node' || !second.p) throw new Error('expected a move_node to a point');
    expect(second.p.x).toBeCloseTo(m.moves.from.x, 2);
    expect(second.p.z).toBeCloseTo(m.moves.from.z, 2);
  }, 120_000);

  test('an illegal drag is refused with the model’s message and the drawing as it was', async () => {
    const m = await mounted();
    const before = m.pixels();
    await m.drag(m.moves.illegal);
    expect(m.edits).toEqual([]);
    expect(m.refusals).toHaveLength(1);
    expect(m.refusals[0]!.reason.code).toBe('validation_failed');
    expect(m.refusals[0]!.reason.message.length).toBeGreaterThan(0);
    await nextFrame();
    expect(m.pixels()).toEqual(before);
  }, 120_000);

  test('revertPlanEdit after a legal release puts the committed drawing back', async () => {
    const m = await mounted();
    const before = m.pixels();
    await m.drag(m.moves.legal);
    expect(m.edits).toHaveLength(1);
    expect(m.pixels()).not.toEqual(before);
    m.handle.revertPlanEdit();
    expect(m.pixels()).toEqual(before);
  }, 120_000);
});
