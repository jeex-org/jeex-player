/**
 * `options.select` end to end, on a real WebGL2 context: what a click reports,
 * what a drag does not, and that a viewer without the option attaches no
 * pointer listener at all.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { ViewerSelection } from '../../src/app/selection.js';
import type { ReplaceOpeningVariantOp, SceneData, SceneOp, Vec2 } from '../../src/scene/types.js';
import { OPENING_VARIANT } from '../../src/assets/catalogue-ids.js';
import { closeContainers, demoScene, openContainer, until } from './support.js';
import { buildPlanDrawing, planPoint, roomAt, type PlanPrimitive } from '../../src/plan/plan-drawing.js';
import { solvePlan } from '../../src/plan/plan-solver.js';
import { planDrawingInputs } from '../../src/assets/plan-fixtures.js';
import { TWO_ROOM_ENTRANCE, twoRoomEntrancePlan } from '../../src/fixtures/plan-two-room-entrance.js';

const handles: ViewerHandle[] = [];

function mount(
  options: Record<string, unknown> = {},
  scene: SceneData = demoScene(),
): { container: HTMLElement; handle: ViewerHandle; seen: ViewerSelection[] } {
  const container = openContainer();
  const handle = mountViewer(container, {
    scene: { repository: new InlineSceneRepository(scene) },
    tour: { mode: 'off' },
    debug: false,
    ...options,
  });
  handles.push(handle);
  const seen: ViewerSelection[] = [];
  handle.on('select', (selection) => seen.push(selection));
  return { container, handle, seen };
}

/** The viewer's own canvas inside a mounted container. */
function canvasOf(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
  if (!canvas) throw new Error('no scene canvas');
  return canvas;
}

let pointerId = 900;

/** One press-and-release on the canvas, `move` CSS pixels apart. */
function press(canvas: HTMLCanvasElement, x: number, y: number, move = 0): void {
  const id = (pointerId += 1);
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: id, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x + move, clientY: y, button: 0, pointerId: id, bubbles: true }));
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

describe('select', () => {
  test('a click in orbit reports what it landed on, with a plan point', async () => {
    const { container, handle, seen } = mount({ select: true });
    await handle.ready;
    const canvas = canvasOf(container);
    const box = canvas.getBoundingClientRect();
    press(canvas, box.left + box.width / 2, box.top + box.height / 2);
    await until(() => seen.length > 0, 'a select event');
    expect(seen[0]!.mode).toBe('orbit');
    // WHAT the centre of the demo apartment shows depends on the presentation
    // camera; that it is one of the five words, and nothing else, does not.
    expect(['wall', 'room', 'furniture', 'opening', 'none']).toContain(seen[0]!.kind);
    if (seen[0]!.kind !== 'none') expect(seen[0]!.point).toBeDefined();
  });

  test('a click far outside the apartment reports none', async () => {
    const { container, handle, seen } = mount({ select: true });
    await handle.ready;
    const canvas = canvasOf(container);
    const box = canvas.getBoundingClientRect();
    press(canvas, box.left + 1, box.top + 1);
    await until(() => seen.length > 0, 'a select event');
    expect(seen.at(-1)!.kind).toBe('none');
    expect(seen.at(-1)!.id).toBeUndefined();
  });

  test('a drag is not a click', async () => {
    const { container, handle, seen } = mount({ select: true });
    await handle.ready;
    const canvas = canvasOf(container);
    const box = canvas.getBoundingClientRect();
    press(canvas, box.left + box.width / 2, box.top + box.height / 2, 40);
    expect(seen).toEqual([]);
  });

  test('walk reports nothing: a click there steers the gaze', async () => {
    const { container, handle, seen } = mount({ select: true });
    await handle.ready;
    handle.setMode('walk');
    const canvas = canvasOf(container);
    const box = canvas.getBoundingClientRect();
    press(canvas, box.left + box.width / 2, box.top + box.height / 2);
    expect(seen).toEqual([]);
  });

  test('the option off means no report at all', async () => {
    const { container, handle, seen } = mount();
    await handle.ready;
    expect(handle.options.select).toBe(false);
    const canvas = canvasOf(container);
    const box = canvas.getBoundingClientRect();
    press(canvas, box.left + box.width / 2, box.top + box.height / 2);
    expect(seen).toEqual([]);
  });
});

describe('select in plan2d: the drawn door symbols', () => {
  type Swing = Extract<PlanPrimitive, { kind: 'swing' }>;
  const plan = twoRoomEntrancePlan;

  /** The partition door's drawing and a point at `fraction` of its swing radius along the bisector, in plan metres. */
  function alongPartitionSwing(fraction: number): { drawing: ReturnType<typeof buildPlanDrawing>; point: Vec2 } {
    const drawing = buildPlanDrawing(solvePlan(plan), plan, planDrawingInputs(plan));
    const swing = drawing.primitives.find((p): p is Swing => p.kind === 'swing' && p.door.openingId === TWO_ROOM_ENTRANCE.opening.inner)!;
    const angle = (swing.a0 + swing.a1) / 2;
    const reach = swing.radius * fraction;
    return { drawing, point: { x: swing.centre.x + Math.cos(angle) * reach, z: swing.centre.z + Math.sin(angle) * reach } };
  }

  /** A real click at the pixel the 2D plan draws `point` at. */
  async function clickPlanPoint(point: Vec2): Promise<ViewerSelection> {
    const { container, handle, seen } = mount({ select: true }, plan);
    await handle.ready;
    handle.setMode('plan2d');
    const view = handle.planView();
    if (!view) throw new Error('no plan view');
    const canvas = canvasOf(container);
    const box = canvas.getBoundingClientRect();
    const pixel = planPoint(view.transform, point);
    press(canvas, box.left + pixel.x, box.top + pixel.y);
    await until(() => seen.length > 0, 'a select event');
    return seen.at(-1)!;
  }

  test('a click on a door’s swing arc selects the door, not the floor under it', async () => {
    const selection = await clickPlanPoint(alongPartitionSwing(1).point);
    expect({ kind: selection.kind, id: selection.id, wallId: selection.wallId, mode: selection.mode }).toEqual({
      kind: 'opening',
      id: TWO_ROOM_ENTRANCE.opening.inner,
      wallId: TWO_ROOM_ENTRANCE.wall.partition,
      mode: 'plan2d',
    });
  });

  test('a click on the empty floor inside the swing selects the room there', async () => {
    const { drawing, point } = alongPartitionSwing(0.5);
    const room = roomAt(drawing, point);
    expect(room).not.toBeNull();
    const selection = await clickPlanPoint(point);
    expect({ kind: selection.kind, id: selection.id }).toEqual({ kind: 'room', id: room });
  });

  test('a click on the room away from every door still selects the room', async () => {
    const selection = await clickPlanPoint({ x: 2.5, z: 4 });
    expect({ kind: selection.kind, id: selection.id }).toEqual({ kind: 'room', id: TWO_ROOM_ENTRANCE.room.living });
  });
});

describe('select in plan2d after a door’s variant swap', () => {
  type Swing = Extract<PlanPrimitive, { kind: 'swing' }>;
  const INNER = TWO_ROOM_ENTRANCE.opening.inner;
  const swap: ReplaceOpeningVariantOp = { op: 'replace_opening_variant', openingId: INNER, variant: OPENING_VARIANT.door_white_double };

  /** The partition door's swing arcs once it wears the double variant, in plan metres. */
  function doubleDoorArcs(): Swing[] {
    const scene: SceneData = {
      ...twoRoomEntrancePlan,
      walls: twoRoomEntrancePlan.walls.map((wall) => ({
        ...wall,
        openings: (wall.openings ?? []).map((opening) => (opening.id === INNER ? { ...opening, variant: swap.variant } : opening)),
      })),
    };
    const drawing = buildPlanDrawing(solvePlan(scene), scene, planDrawingInputs(scene));
    return drawing.primitives.filter((p): p is Swing => p.kind === 'swing' && p.door.openingId === INNER);
  }

  test('the redrawn plan takes a click on either new arc as the door', async () => {
    const arcs = doubleDoorArcs();
    expect(arcs.length).toBe(2);
    const { container, handle, seen } = mount({ select: true, debug: true }, twoRoomEntrancePlan);
    await handle.ready;
    handle.setMode('plan2d');
    const applied = (window as unknown as { __viewerDebug: { applyOps: (ops: SceneOp[]) => { error?: unknown } } }).__viewerDebug.applyOps([
      swap,
    ]);
    expect(applied.error).toBeUndefined();
    const view = handle.planView();
    if (!view) throw new Error('no plan view');
    const canvas = canvasOf(container);
    const box = canvas.getBoundingClientRect();
    for (const arc of arcs) {
      const angle = (arc.a0 + arc.a1) / 2;
      const pixel = planPoint(view.transform, {
        x: arc.centre.x + Math.cos(angle) * arc.radius,
        z: arc.centre.z + Math.sin(angle) * arc.radius,
      });
      const before = seen.length;
      press(canvas, box.left + pixel.x, box.top + pixel.y);
      await until(() => seen.length > before, 'a select event');
      expect({ kind: seen.at(-1)!.kind, id: seen.at(-1)!.id }).toEqual({ kind: 'opening', id: INNER });
    }
  });
});
