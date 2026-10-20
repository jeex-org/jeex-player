/**
 * The asset move tool on a real WebGL mount: the host selects an object and arms the tool, real pointer events on
 * the canvas drag it, and the viewer answers with `assetEdit` (a legal move)
 * or `assetEditRefused` (an illegal one, reverted). The tool loads as its own
 * chunk on first arming; its state is read through `__viewerDebug.assetMove`,
 * the read a host editor's e2e uses.
 *
 * Targets are chosen with the tool's own judge (`layout/asset-legality.ts`)
 * so the test never depends on which spots of the demo flat happen to be free.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { AssetEdit, AssetEditRefused } from '../../src/edit/asset-move-tool.js';
import type { AssetMoveDebug } from '../../src/edit/asset-move-session.js';
import { DEMO } from '../../src/demo/demo-ids.js';
import { dragContext, judge, poseItem } from '../../src/layout/asset-legality.js';
import { mask } from '../../src/layout/asset-mask.js';
import { solvePlan } from '../../src/plan/plan-solver.js';
import type { SceneData } from '../../src/scene/types.js';
import type { SlotName } from '../../src/ui/host-slots.js';
import { ASSET_MOVE_CHUNK_TIMEOUT_MS, closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

type Debug = {
  mode: () => string | undefined;
  assetMove: () => AssetMoveDebug;
  selectionPoint: (x: number, z: number) => { x: number; y: number } | null;
  projectPoint: (x: number, y: number, z: number) => { x: number; y: number } | null;
};

const handles: ViewerHandle[] = [];

function debug(): Debug {
  return (window as unknown as { __viewerDebug: Debug }).__viewerDebug;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

type Mounted = { handle: ViewerHandle; canvas: HTMLCanvasElement; edits: AssetEdit[]; refusals: AssetEditRefused[]; scene: SceneData };

async function mount(mode: 'orbit' | 'plan3d', assetId: string, slots: readonly SlotName[] = []): Promise<Mounted> {
  const scene = demoScene();
  const container = openContainer();
  const handle = mountViewer(container, {
    scene: { repository: new InlineSceneRepository(scene) },
    tour: { mode: 'off' },
    debug: true,
    slots,
  });
  handles.push(handle);
  await handle.ready;
  const edits: AssetEdit[] = [];
  const refusals: AssetEditRefused[] = [];
  handle.on('assetEdit', (edit) => edits.push(edit));
  handle.on('assetEditRefused', (refusal) => refusals.push(refusal));
  handle.setMode(mode);
  await until(() => debug().mode() === mode, mode);
  handle.setSelection({ kind: 'furniture', id: assetId });
  handle.setAssetMoveTool(true);
  await until(() => debug().assetMove().loaded, 'the asset move chunk', ASSET_MOVE_CHUNK_TIMEOUT_MS);
  await nextFrame();
  const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
  if (!canvas) throw new Error('no scene canvas');
  return { handle, canvas, edits, refusals, scene };
}

/** Viewport pixels of a plan point at height `y`, through the camera a pick is cast with. */
function pixel(mode: 'orbit' | 'plan3d', x: number, y: number, z: number): { x: number; y: number } {
  const point = mode === 'plan3d' ? debug().selectionPoint(x, z) : debug().projectPoint(x, y, z);
  if (!point) throw new Error(`(${x}, ${z}) is not on screen`);
  return point;
}

let pointerId = 4000;

/** Press at `from`, drag in eight steps to `to`, release: real pointer events on the canvas. */
function drag(canvas: HTMLCanvasElement, from: { x: number; y: number }, to: { x: number; y: number }, during?: () => void): void {
  const box = canvas.getBoundingClientRect();
  const id = (pointerId += 1);
  const at = (point: { x: number; y: number }) => ({
    clientX: box.left + point.x,
    clientY: box.top + point.y,
    button: 0,
    pointerId: id,
    bubbles: true,
  });
  canvas.dispatchEvent(new PointerEvent('pointerdown', at(from)));
  for (let step = 1; step <= 8; step += 1) {
    const k = step / 8;
    canvas.dispatchEvent(new PointerEvent('pointermove', at({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k })));
  }
  during?.();
  canvas.dispatchEvent(new PointerEvent('pointerup', at(to)));
}

/** A legal spot for `id`, `away` metres or more from home, read off its own legality field. */
function legalSpot(scene: SceneData, id: string, away: number, surface: 'floor' | 'ceiling'): { x: number; z: number } {
  const plan = solvePlan(scene);
  const context = dragContext(scene, plan, id)!;
  const home = context.placement;
  const field = mask(context, poseItem(context, { position: home.position, rotationY: home.rotationY ?? 0 }), surface);
  for (let cell = 0; cell < field.count; cell += 1) {
    const x = field.positions[cell * 12]! + field.step / 2;
    const z = field.positions[cell * 12 + 2]! + field.step / 2;
    if (field.ok[cell] !== 1 || Math.hypot(x - home.position.x, z - home.position.z) < away) continue;
    if (judge(context.ctx, poseItem(context, { position: { x, y: home.position.y, z }, rotationY: home.rotationY ?? 0 })).ok)
      return { x, z };
  }
  throw new Error(`no legal spot for ${id}`);
}

function placement(scene: SceneData, id: string) {
  const found = scene.assets.find((asset) => asset.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

describe('the asset move tool', () => {
  test('loads only when armed, and stays idle for a press off the selected object', async () => {
    const container = openContainer();
    const handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      debug: true,
    });
    handles.push(handle);
    await handle.ready;
    expect(debug().assetMove()).toEqual({ enabled: false, loaded: false, state: null });
    handle.setAssetMoveTool(true);
    await until(() => debug().assetMove().loaded, 'the asset move chunk', ASSET_MOVE_CHUNK_TIMEOUT_MS);
    expect(debug().assetMove().state?.phase).toBe('idle');
  });

  for (const mode of ['plan3d', 'orbit'] as const) {
    test(`a floor drag in ${mode} draws the field, then emits move_object for the host on the start revision`, async () => {
      const { canvas, edits, refusals, scene } = await mount(mode, DEMO.asset.bedroomBed);
      const home = placement(scene, DEMO.asset.bedroomBed).position;
      const spot = legalSpot(scene, DEMO.asset.bedroomBed, 0.4, 'floor');
      let cells = 0;
      drag(canvas, pixel(mode, home.x, 0.5, home.z), pixel(mode, spot.x, 0.5, spot.z), () => {
        cells = debug().assetMove().state?.maskCells ?? 0;
      });
      expect(cells).toBeGreaterThan(1000);
      expect(refusals).toEqual([]);
      expect(edits).toHaveLength(1);
      const op = edits[0]!.ops[0]!;
      if (op.op !== 'move_object') throw new Error('expected move_object');
      expect(edits[0]!.assetId).toBe(DEMO.asset.bedroomBed);
      expect(edits[0]!.baseRev).toBe(0);
      // Exact under the top view; the slanted orbit ray lands within a few centimetres of the projected spot.
      const tolerance = mode === 'plan3d' ? 0.05 : 0.35;
      expect(Math.hypot(op.position!.x - spot.x, op.position!.z - spot.z)).toBeLessThan(tolerance);
      expect(debug().assetMove().state).toMatchObject({ phase: 'idle', maskCells: 0, pending: DEMO.asset.bedroomBed });
    });
  }

  test('a drag through the facade is refused and reverted; revertAssetEdit undoes an emitted move', async () => {
    const { handle, canvas, edits, refusals, scene } = await mount('plan3d', DEMO.asset.bedroomBed);
    const home = placement(scene, DEMO.asset.bedroomBed).position;
    drag(canvas, pixel('plan3d', home.x, 0.5, home.z), pixel('plan3d', home.x + 6, 0.5, home.z));
    expect(edits).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.assetId).toBe(DEMO.asset.bedroomBed);
    expect(refusals[0]!.issues.length).toBeGreaterThan(0);
    expect(debug().assetMove().state?.pending).toBeNull();

    const spot = legalSpot(scene, DEMO.asset.bedroomBed, 0.4, 'floor');
    drag(canvas, pixel('plan3d', home.x, 0.5, home.z), pixel('plan3d', spot.x, 0.5, spot.z));
    expect(edits).toHaveLength(1);
    handle.revertAssetEdit();
    expect(debug().assetMove().state?.pending).toBeNull();
  });

  for (const mode of ['plan3d', 'orbit'] as const) {
    test(`a ceiling pendant moves under the ceiling in ${mode}`, async () => {
      const { canvas, edits, refusals, scene } = await mount(mode, DEMO.asset.livingPendant);
      const home = placement(scene, DEMO.asset.livingPendant).position;
      const spot = legalSpot(scene, DEMO.asset.livingPendant, 0.6, 'ceiling');
      const height = scene.ceilingHeight - 0.3;
      drag(canvas, pixel(mode, home.x, height, home.z), pixel(mode, spot.x, height, spot.z));
      expect(refusals).toEqual([]);
      expect(edits).toHaveLength(1);
      const op = edits[0]!.ops[0]!;
      if (op.op !== 'move_object') throw new Error('expected move_object');
      expect(op.position!.y).toBe(home.y);
      expect(Math.hypot(op.position!.x - home.x, op.position!.z - home.z)).toBeGreaterThan(0.3);
    });
  }

  test('the Move toggle hangs a picture further along its wall, facing the room; its field is the wall spans', async () => {
    const { handle, canvas, edits, refusals, scene } = await mount('plan3d', DEMO.asset.bedroomArt);
    const home = placement(scene, DEMO.asset.bedroomArt).position;
    let surface: string | null = null;
    // A 5 cm thick picture is two pixels wide from above: the toggle moves it to the next press instead.
    handle.armAssetMove();
    const target = pixel('plan3d', home.x + 0.5, home.y, home.z + 0.3);
    drag(canvas, target, { x: target.x + 1, y: target.y }, () => {
      surface = debug().assetMove().state?.surface ?? null;
    });
    expect(surface).toBe('wall');
    expect(refusals).toEqual([]);
    expect(edits).toHaveLength(1);
    const op = edits[0]!.ops[0]!;
    if (op.op !== 'move_object') throw new Error('expected move_object');
    // It stayed on its face — flat on it now, within layout rule 5's 2 cm of where it was authored — and at its height.
    expect(Math.abs(op.position!.z - home.z)).toBeLessThan(0.02);
    expect(op.position!.y).toBeCloseTo(home.y, 6);
    expect(op.position!.x).toBeGreaterThan(home.x + 0.3);
  });

  test('an armed Move ignores a press on host slot content and stays armed; the next canvas press moves', async () => {
    const { handle, canvas, edits, refusals, scene } = await mount('plan3d', DEMO.asset.bedroomArt, ['selection-anchor']);
    const home = placement(scene, DEMO.asset.bedroomArt).position;
    const target = pixel('plan3d', home.x + 0.5, home.y, home.z + 0.3);
    // A host editor's selection card lives in a slot inside the canvas's parent; its button sits over the scene.
    const card = handle.slots.get('selection-anchor');
    const button = document.createElement('button');
    button.textContent = 'Move';
    card.append(button);
    let clicks = 0;
    button.addEventListener('click', () => (clicks += 1));
    handle.armAssetMove();
    const box = canvas.getBoundingClientRect();
    const at = { clientX: box.left + target.x, clientY: box.top + target.y, button: 0, pointerId: 4999, bubbles: true, composed: true };
    button.dispatchEvent(new PointerEvent('pointerdown', at));
    button.dispatchEvent(new PointerEvent('pointerup', at));
    button.dispatchEvent(new MouseEvent('click', at));
    await nextFrame();
    expect(clicks).toBe(1);
    expect(edits).toEqual([]);
    expect(debug().assetMove().state).toMatchObject({ phase: 'idle', pending: null });

    drag(canvas, target, { x: target.x + 1, y: target.y });
    expect(refusals).toEqual([]);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.assetId).toBe(DEMO.asset.bedroomArt);
  });

  test('assetMoveState reports the two edges of a drag, never a frame in between', async () => {
    const { handle, canvas, edits, scene } = await mount('plan3d', DEMO.asset.bedroomBed);
    const phases: string[] = [];
    handle.on('assetMoveState', ({ phase }) => phases.push(phase));
    const home = placement(scene, DEMO.asset.bedroomBed).position;
    const spot = legalSpot(scene, DEMO.asset.bedroomBed, 0.4, 'floor');
    drag(canvas, pixel('plan3d', home.x, 0.5, home.z), pixel('plan3d', spot.x, 0.5, spot.z));
    expect(edits).toHaveLength(1);
    expect(phases).toEqual(['dragging', 'idle']);
  });

  test('turnAsset turns a placement 15° through the handle, and refuses a sofa across its room', async () => {
    const { handle, edits, refusals } = await mount('plan3d', DEMO.asset.bedroomBed);
    expect(handle.turnAsset(DEMO.asset.livingChairA, 1)).toBe(true);
    expect(edits).toHaveLength(1);
    const rotate = edits[0]!.ops.find((op) => op.op === 'rotate_object');
    if (rotate?.op !== 'rotate_object') throw new Error('expected rotate_object');
    expect(rotate.rotationY).toBeCloseTo(Math.PI / 12, 6);
    handle.revertAssetEdit();
    expect(handle.turnAsset(DEMO.asset.livingSofa, 6)).toBe(true);
    expect(refusals.at(-1)?.assetId).toBe(DEMO.asset.livingSofa);
    expect(handle.turnAsset('01a12fe6-0000-7000-8000-000000000000', 1)).toBe(false);
  });
});
