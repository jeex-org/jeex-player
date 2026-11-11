/**
 * The 2D plan's draft and decoration (`PlanModes.setDraft`, `setDecoration`),
 * on real canvas pixels: a draft redraws what moved and keeps the committed
 * fit, so an untouched far wall stays where it was under the pointer; `null`
 * puts the committed drawing back exactly; the decoration is painted last, over
 * the selection mark.
 */

import * as THREE from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import { PlanModes, type PlanModeOptions } from '../../src/ui/plan-modes.js';
import { RenderRuntime } from '../../src/render/render-runtime.js';
import { SceneModel } from '../../src/scene/scene-model.js';
import { CATALOGUE_REGISTRIES } from '../../src/assets/catalogue-registries.js';
import { planPoint } from '../../src/plan/plan-drawing.js';
import { closeContainers, demoPlan, demoScene, openShell, readableCanvas, until, type Shell } from './support.js';

/** No labels, chains or camera marker: only the walls, the openings and the marks draw. */
const BARE = (): PlanModeOptions => ({ labels: false, dimensions: false, camera: false });

type Harness = { shell: Shell; runtime: RenderRuntime; modes: PlanModes };
const open: Harness[] = [];

async function inPlan2d(): Promise<Harness> {
  const shell = openShell();
  const runtime = new RenderRuntime({ canvas: shell.roots.canvas, viewport: shell.roots.viewport });
  runtime.setCamera(new THREE.PerspectiveCamera(60, 1.5, 0.1, 100));
  const modes = new PlanModes({
    container: shell.roots.root,
    viewport: shell.roots.viewport,
    runtime,
    perspective: () => undefined,
    options: BARE,
  });
  open.push({ shell, runtime, modes });
  // Every paint compared below on one rasteriser (`readableCanvas`).
  readableCanvas(modes.element);
  modes.setDocument(demoPlan(), demoScene());
  modes.setMode('plan2d');
  await until(() => modes.element.width > 0, 'the overlay to get a backing store');
  return { shell, runtime, modes };
}

afterEach(() => {
  for (const { modes, runtime } of open.splice(0)) {
    modes.dispose();
    runtime.dispose();
  }
  closeContainers();
});

/** The canvas's pixels, for an exact comparison. */
const pixels = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
  canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;

/** The pixels of a square of `half` CSS px around a plan point. */
function around(h: Harness, point: { x: number; z: number }, half = 10): Uint8ClampedArray {
  const canvas = h.modes.element;
  const ratio = canvas.width / h.shell.roots.viewport.clientWidth;
  const at = planPoint(h.modes.view()!.transform, point);
  const size = Math.round(2 * half * ratio);
  return canvas.getContext('2d')!.getImageData(Math.round((at.x - half) * ratio), Math.round((at.y - half) * ratio), size, size).data;
}

/** The demo's first wall's first node moved 0.3 m east, as the plan tool's trial answers it, and a wall far from it. */
function draftMovingANode(): {
  draft: { scene: ReturnType<typeof demoScene>; plan: ReturnType<typeof demoPlan> };
  moved: { x: number; z: number };
  far: { x: number; z: number };
} {
  const scene = demoScene();
  const model = new SceneModel(scene, CATALOGUE_REGISTRIES);
  const node = scene.nodes.find((candidate) => candidate.id === scene.walls[0]!.a)!;
  const result = model.trial({ baseRev: model.rev, ops: [{ op: 'move_node', nodeId: node.id, dp: { x: 0.3, z: 0 } }] });
  if ('error' in result) throw new Error(result.message);
  const position = (id: string) => scene.nodes.find((candidate) => candidate.id === id)!.p;
  const middles = scene.walls
    .filter((wall) => wall.a !== node.id && wall.b !== node.id)
    .map((wall) => ({ x: (position(wall.a).x + position(wall.b).x) / 2, z: (position(wall.a).z + position(wall.b).z) / 2 }));
  const far = middles.reduce((best, middle) =>
    Math.hypot(middle.x - node.p.x, middle.z - node.p.z) > Math.hypot(best.x - node.p.x, best.z - node.p.z) ? middle : best,
  );
  return { draft: result, moved: node.p, far };
}

describe('setDraft', () => {
  test('repaints over the moved wall, keeps the committed fit, and null puts the committed drawing back', async () => {
    const h = await inPlan2d();
    const { draft, moved, far } = draftMovingANode();
    const committed = pixels(h.modes.element);
    const nearBefore = around(h, moved);
    const farBefore = around(h, far);

    h.modes.setDraft(draft);
    expect(around(h, moved)).not.toEqual(nearBefore);
    expect(around(h, far)).toEqual(farBefore);

    h.modes.setDraft(null);
    expect(pixels(h.modes.element)).toEqual(committed);
  });
});

describe('setDecoration', () => {
  test('is painted after the selection mark, over it', async () => {
    const h = await inPlan2d();
    const scene = demoScene();
    const wall = scene.walls[0]!;
    const position = (id: string) => scene.nodes.find((candidate) => candidate.id === id)!.p;
    const middle = { x: (position(wall.a).x + position(wall.b).x) / 2, z: (position(wall.a).z + position(wall.b).z) / 2 };
    h.modes.setSelection({ kind: 'wall', id: wall.id });
    h.modes.setDecoration((ctx, transform) => {
      const at = planPoint(transform, middle);
      ctx.fillStyle = 'rgb(1, 2, 3)';
      ctx.fillRect(at.x - 4, at.y - 4, 8, 8);
    });
    const centre = around(h, middle, 1);
    expect([centre[0], centre[1], centre[2]]).toEqual([1, 2, 3]);
    h.modes.setDecoration(null);
    const after = around(h, middle, 1);
    expect([after[0], after[1], after[2]]).not.toEqual([1, 2, 3]);
  });
});
