/**
 * The mini-map: does it paint, and does a pointer over a room find that room.
 *
 * `plan-canvas.ts` is tested against a fake 2D context in `bun test`; what was
 * never tested is that the card lays itself out, gets a real backing store from
 * `fitCanvasToBox`, and turns a client point back into a room. All three need a
 * browser.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Minimap, type MinimapDeps } from '../../src/ui/minimap.js';
import { HostSlots } from '../../src/ui/host-slots.js';
import { WalkCameraBar } from '../../src/ui/walk-camera-bar.js';
import { OVERLAY_NAMES } from '../../src/ui/viewer-shell.js';
import { roomAt } from '../../src/plan/plan-drawing.js';
import type { PlanCameraMarker } from '../../src/plan/plan-canvas.js';
import {
  canvasHasInk,
  closeContainers,
  demoDrawing,
  demoScene,
  fillSlot,
  intersects,
  nextFrame,
  openShell,
  until,
  type Shell,
} from './support.js';

type World = { camera: PlanCameraMarker | null; enabled: boolean; hasDrawing: boolean };
type Harness = { shell: Shell; map: Minimap; world: World; onRoomPicked: ReturnType<typeof vi.fn> };

/** The first room of the demo apartment; ids are looked up, never indexed blind. */
const ROOM_ID = demoScene().rooms[0]!.id;
/** A well-formed room id the demo does not have, fixed UUID v7. */
const UNKNOWN_ROOM_ID = '01a12ffa-de61-7e99-9822-172e2877328a';

function build(overrides: Partial<MinimapDeps> = {}, size: { width?: number; height?: number } = {}): Harness {
  const shell = openShell(size.width, size.height);
  shell.roots.byName('viewer-ui').classList.remove('is-hidden');
  const world: World = { camera: { x: 2, z: 2, yaw: 0 }, enabled: true, hasDrawing: true };
  const onRoomPicked = vi.fn();
  const map = new Minimap({
    container: shell.roots.root,
    drawing: () => (world.hasDrawing ? demoDrawing() : null),
    camera: () => world.camera,
    enabled: () => world.enabled,
    onRoomPicked,
    messages: shell.messages,
    ...overrides,
  });
  return { shell, map, world, onRoomPicked };
}

/** Puts the card on screen and paints it, which is what every hit test needs. */
async function paint(harness: Harness): Promise<void> {
  harness.map.setMode('walk');
  await until(() => harness.map.element.getBoundingClientRect().width > 0, 'the map card to be laid out');
  harness.map.update();
  await nextFrame();
}

let harness: Harness;

beforeEach(() => {
  harness = build();
});

afterEach(() => {
  harness.map.dispose();
  closeContainers();
});

describe('the card', () => {
  test('is in the shell, named for the browser check, and hidden outside walk and tour', () => {
    const card = harness.map.element;
    expect(card.dataset['jeex']).toBe(OVERLAY_NAMES.minimap);
    expect(harness.shell.roots.root.contains(card)).toBe(true);
    expect(card.getAttribute('aria-label')).toBe(harness.shell.messages.t('minimap.label'));

    harness.map.setMode('orbit');
    harness.map.update();
    expect(harness.map.state().visible).toBe(false);
    harness.map.setMode('walk');
    harness.map.update();
    expect(harness.map.state().visible).toBe(true);
    expect(card.dataset['mode']).toBe('walk');
    harness.map.setMode('plan2d');
    harness.map.update();
    expect(harness.map.state().visible).toBe(false);
  });

  test('the mount option takes the map away even in walk', () => {
    harness.world.enabled = false;
    harness.map.setMode('walk');
    harness.map.update();
    expect(harness.map.state().visible).toBe(false);
  });

  test('dispose takes the card out of the shell', () => {
    const card = harness.map.element;
    harness.map.dispose();
    expect(card.isConnected).toBe(false);
  });
});

describe('painting', () => {
  test('the canvas gets a backing store and real ink on it', async () => {
    await paint(harness);
    const canvas = harness.map.element.querySelector('canvas')!;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    expect(canvasHasInk(canvas)).toBe(true);
  });

  test('a camera that has not moved does not earn a second paint', async () => {
    await paint(harness);
    const canvas = harness.map.element.querySelector('canvas')!;
    const before = canvas.toDataURL();
    harness.map.update();
    expect(canvas.toDataURL()).toBe(before);
    // A metre of walking does.
    harness.world.camera = { x: 3, z: 2, yaw: 0.4 };
    harness.map.update();
    expect(canvas.toDataURL()).not.toBe(before);
  });

  test('a document with no drawing yet paints nothing and reports no camera', () => {
    harness.world.hasDrawing = false;
    harness.world.camera = null;
    harness.map.setMode('walk');
    harness.map.update();
    expect(harness.map.state()).toEqual({ visible: true, camera: null, hoverRoom: null });
  });

  test('setDocument forces the next frame to repaint', async () => {
    await paint(harness);
    const canvas = harness.map.element.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    expect(canvasHasInk(canvas)).toBe(false);
    harness.map.setDocument();
    harness.map.update();
    expect(canvasHasInk(canvas)).toBe(true);
  });
});

describe('pointing at a room', () => {
  test('roomPoint answers in viewport pixels inside the card, and null while hidden', async () => {
    await paint(harness);
    const point = harness.map.roomPoint(ROOM_ID);
    expect(point).not.toBeNull();
    const rect = harness.map.element.querySelector('canvas')!.getBoundingClientRect();
    expect(point!.x).toBeGreaterThanOrEqual(rect.left);
    expect(point!.x).toBeLessThanOrEqual(rect.right);
    expect(point!.y).toBeGreaterThanOrEqual(rect.top);
    expect(point!.y).toBeLessThanOrEqual(rect.bottom);

    harness.map.setMode('orbit');
    harness.map.update();
    expect(harness.map.roomPoint(ROOM_ID)).toBeNull();
  });

  test('roomPoint answers null for a room the plan does not have', async () => {
    await paint(harness);
    expect(harness.map.roomPoint(UNKNOWN_ROOM_ID)).toBeNull();
  });

  test('a pointer over a room stamps data-hover-room and leaving clears it', async () => {
    await paint(harness);
    const point = harness.map.roomPoint(ROOM_ID)!;
    const card = harness.map.element;
    card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: point.x, clientY: point.y }));
    expect(card.dataset['hoverRoom']).toBe(ROOM_ID);
    expect(harness.map.state().hoverRoom).toBe(ROOM_ID);
    card.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(card.dataset['hoverRoom']).toBeUndefined();
    expect(harness.map.state().hoverRoom).toBeNull();
  });

  test('leaving the map for a mode without one clears the hover', async () => {
    await paint(harness);
    const point = harness.map.roomPoint(ROOM_ID)!;
    harness.map.element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: point.x, clientY: point.y }));
    expect(harness.map.state().hoverRoom).toBe(ROOM_ID);
    harness.map.setMode('orbit');
    expect(harness.map.state().hoverRoom).toBeNull();
  });

  test('a click on a room reports it, and one off the plan reports nothing', async () => {
    await paint(harness);
    const point = harness.map.roomPoint(ROOM_ID)!;
    harness.map.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y }));
    expect(harness.onRoomPicked).toHaveBeenCalledWith(ROOM_ID);

    harness.onRoomPicked.mockClear();
    const rect = harness.map.element.getBoundingClientRect();
    harness.map.element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: rect.left + 1, clientY: rect.top + 1 }),
    );
    expect(harness.onRoomPicked).not.toHaveBeenCalled();
  });

  test('a hidden map answers no pointer at all', () => {
    harness.map.setMode('orbit');
    harness.map.update();
    harness.map.element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(harness.onRoomPicked).not.toHaveBeenCalled();
  });
});

describe('the tour cameras on the card', () => {
  /** A plan point inside the first room of the demo drawing: the mean of its polygon, checked by the drawing's own hit test. */
  function insideFirstRoom(): { id: string; point: { x: number; z: number } } {
    const drawing = demoDrawing();
    for (const primitive of drawing.primitives) {
      if (primitive.kind !== 'room') continue;
      const point = {
        x: primitive.polygon.reduce((sum, vertex) => sum + vertex.x, 0) / primitive.polygon.length,
        z: primitive.polygon.reduce((sum, vertex) => sum + vertex.z, 0) / primitive.polygon.length,
      };
      if (roomAt(drawing, point) === primitive.id) return { id: primitive.id, point };
    }
    throw new Error('no convex room in the demo drawing');
  }

  test('a click on a camera dot steps there and wins over the room under it; a click beside it is the room again', async () => {
    harness.map.dispose();
    const room = insideFirstRoom();
    const onCameraPicked = vi.fn();
    const onRoomPicked = vi.fn();
    harness = build({ onRoomPicked, onCameraPicked, cameras: () => ({ points: [{ x: -50, z: -50 }, room.point], current: 0 }) });
    await paint(harness);
    const dot = harness.map.cameraPoint(1)!;
    harness.map.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: dot.x, clientY: dot.y }));
    expect(onCameraPicked).toHaveBeenCalledWith(1);
    expect(onRoomPicked).not.toHaveBeenCalled();
    // Twelve pixels off is outside the dot's grab: that click is no step.
    onCameraPicked.mockClear();
    harness.map.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: dot.x + 12, clientY: dot.y }));
    expect(onCameraPicked).not.toHaveBeenCalled();
  });

  test('a camera that changes only which dot is current repaints the card', async () => {
    harness.map.dispose();
    const world = { current: 0 as number | null };
    harness = build({ cameras: () => ({ points: [insideFirstRoom().point], current: world.current }) });
    await paint(harness);
    const before = harness.map.element.querySelector('canvas')!.toDataURL();
    world.current = null;
    harness.map.update();
    expect(harness.map.element.querySelector('canvas')!.toDataURL()).not.toBe(before);
  });
});

/**
 * A host may claim the `bottom-right` box (the studio puts its 56px assistant
 * button there); the box sits at layer 8, above the card's 6, so it covered
 * the map's lower-right corner in walk and tour (at 1280 wide: 56 x 56 px in
 * walk, 56 x 30 px in tour). The
 * card rises out of the box's way like the camera preview that takes its place,
 * and a viewer whose host claimed nothing keeps the card where it always was.
 * The check sizes are the desktop window the defect was measured in, a phone
 * (the narrow-container insets) and the narrowest width the viewer supports.
 */
describe('the card keeps clear of a claimed bottom-right corner', () => {
  const CHECK_SIZES = [
    { label: 'desktop 1280x774', width: 1280, height: 774, edge: 18 },
    { label: 'phone 390x844', width: 390, height: 844, edge: 14 },
    { label: 'narrow 360x640', width: 360, height: 640, edge: 14 },
  ] as const;
  /** The tour bar runs along the bottom edge; the tour card stands 26px higher. */
  const MODES = [
    { mode: 'walk', lift: 0 },
    { mode: 'tour', lift: 26 },
  ] as const;

  function rebuild(width: number, height: number): void {
    harness.map.dispose();
    closeContainers();
    harness = build({}, { width, height });
  }

  for (const { label, width, height, edge } of CHECK_SIZES) {
    for (const { mode, lift } of MODES) {
      test(`${label}, ${mode}: the card does not intersect the claimed box`, () => {
        rebuild(width, height);
        const slots = new HostSlots(harness.shell.roots.root, ['bottom-right']);
        const box = slots.get('bottom-right');
        fillSlot(box);
        harness.map.setMode(mode);
        const card = harness.map.element.getBoundingClientRect();
        const claimed = box.getBoundingClientRect();
        // Measured, not assumed: both are real boxes in the same corner.
        expect(card.width).toBeGreaterThan(0);
        expect(claimed.width).toBe(56);
        expect(claimed.right).toBeGreaterThan(card.left);
        expect(intersects(card, claimed)).toBe(false);
        // Still in the viewer, still in its own column.
        const viewport = harness.shell.container.getBoundingClientRect();
        expect(card.top).toBeGreaterThanOrEqual(viewport.top);
        expect(viewport.right - card.right).toBeCloseTo(edge, 0);
        // It rises by exactly the claimed corner's 64px, on top of its own lift.
        expect(viewport.bottom - card.bottom).toBeCloseTo(edge + lift + 64, 0);
      });

      test(`${label}, ${mode}: without a claim the card keeps its corner`, () => {
        rebuild(width, height);
        const slots = new HostSlots(harness.shell.roots.root, ['top-left']);
        // The host built boxes, just not the corner the card lives in.
        expect(slots.get('top-left').isConnected).toBe(true);
        expect(harness.shell.roots.root.dataset['jeexSlotBottomRight']).toBe('false');
        harness.map.setMode(mode);
        const card = harness.map.element.getBoundingClientRect();
        const viewport = harness.shell.container.getBoundingClientRect();
        expect(card.width).toBeGreaterThan(0);
        expect(viewport.right - card.right).toBeCloseTo(edge, 0);
        expect(viewport.bottom - card.bottom).toBeCloseTo(edge + lift, 0);
      });
    }
  }
});

/**
 * The walk's camera stepper stays at the bottom centre; in a narrow viewer its
 * right half reaches under the card's corner (measured before this rule: at
 * 390x844 the stepper ran 132-258 px across, the card 212-376 px). So there the
 * card yields and stands above the stepper; wider viewers, and any mode or
 * document where the stepper is not shown, keep the card where it was.
 * The boundary is where the stepper comes within the same 8 px gap of the
 * card's column: a 561 px viewer lifts the card (stepper to 343.5 px, card
 * from 351 px), a 562 px one keeps them 8 px apart side by side.
 */
describe('the card keeps clear of the walk camera stepper', () => {
  /** The gap the lifted card keeps above the stepper's top edge. */
  const GAP = 8;
  const NARROW = [
    { label: 'phone 390x844', width: 390, height: 844 },
    { label: 'narrow 360x640', width: 360, height: 640 },
    { label: 'boundary 561x800', width: 561, height: 800 },
  ] as const;
  const WIDE = [
    { label: 'just wider 562x800', width: 562, height: 800, edge: 14 },
    { label: 'desktop 1280x774', width: 1280, height: 774, edge: 18 },
  ] as const;

  let stepper: WalkCameraBar;

  /** A viewer of that size with the stepper mounted where the stage mounts it, showing camera 1 of 7. */
  function rebuild(width: number, height: number, claim: boolean): HTMLElement | null {
    harness.map.dispose();
    closeContainers();
    harness = build({}, { width, height });
    stepper = new WalkCameraBar({
      container: harness.shell.roots.viewport,
      messages: harness.shell.messages,
      enabled: () => true,
      onStep: () => {},
    });
    stepper.setCamera({ index: 0, count: 7 });
    if (!claim) return null;
    const box = new HostSlots(harness.shell.roots.root, ['bottom-right']).get('bottom-right');
    fillSlot(box);
    return box;
  }

  function show(mode: 'walk' | 'tour'): { card: DOMRect; bar: HTMLElement; viewport: DOMRect } {
    stepper.setMode(mode);
    harness.map.setMode(mode);
    return {
      card: harness.map.element.getBoundingClientRect(),
      bar: stepper.element,
      viewport: harness.shell.container.getBoundingClientRect(),
    };
  }

  afterEach(() => {
    stepper.dispose();
  });

  for (const { label, width, height } of NARROW) {
    for (const claim of [false, true]) {
      const corner = claim ? 'a claimed corner' : 'no claim';
      test(`${label}, walk, ${corner}: the card stands above the stepper, whose lift already clears a claimed box`, () => {
        const box = rebuild(width, height, claim);
        const { card, bar, viewport } = show('walk');
        const steps = bar.getBoundingClientRect();
        // Measured, not assumed: the stepper is on screen and comes within the gap of the card's column.
        expect(bar.hidden).toBe(false);
        expect(steps.width).toBeGreaterThan(0);
        expect(steps.right + GAP).toBeGreaterThan(card.left);
        expect(intersects(card, steps)).toBe(false);
        expect(steps.top - card.bottom).toBeCloseTo(GAP, 0);
        // The same 8px over the stepper with or without the claim: the box sits lower than the stepper, so it adds no lift.
        if (box !== null) expect(intersects(card, box.getBoundingClientRect())).toBe(false);
        // Still in the viewer, still in its own column at the narrow edge.
        expect(card.top).toBeGreaterThanOrEqual(viewport.top);
        expect(viewport.right - card.right).toBeCloseTo(14, 0);
      });
    }
  }

  /**
   * A short narrow viewer: lifted over the stepper, the full card would reach
   * the top row. It shrinks to stay 8px under the control bar, which also keeps
   * it off a 56px box claimed at `top-right`; below a 96px card it steps out.
   */
  test('short embed 480x330, walk: the lifted card shrinks to sit under the control bar and a claimed top-right box', () => {
    rebuild(480, 330, false);
    const slots = new HostSlots(harness.shell.roots.root, ['bottom-right', 'top-right']);
    fillSlot(slots.get('bottom-right'));
    const topRight = slots.get('top-right');
    fillSlot(topRight);
    const { card, bar } = show('walk');
    const steps = bar.getBoundingClientRect();
    const controls = harness.shell.roots.byName('control-bar').getBoundingClientRect();
    expect(controls.height).toBeGreaterThan(0);
    expect(intersects(card, steps)).toBe(false);
    expect(steps.top - card.bottom).toBeCloseTo(GAP, 0);
    // The card's top is derived from the bar's declared geometry; the real bar must agree with it.
    expect(card.top - controls.bottom).toBeCloseTo(GAP, 0);
    expect(intersects(card, topRight.getBoundingClientRect())).toBe(false);
    expect(card.width).toBeCloseTo(card.height, 0);
    expect(card.height).toBeLessThan(196);
  });

  for (const { height, shown } of [
    { height: 298, shown: true },
    { height: 297, shown: false },
  ]) {
    test(`short embed 480x${height}, walk: the card ${shown ? 'keeps a 96px plan' : 'steps out rather than collapse'}`, () => {
      rebuild(480, height, false);
      const { card } = show('walk');
      if (shown) expect(card.height).toBeCloseTo(96, 0);
      else expect(card.height).toBe(0);
      // Not the mode leaving walk: the card still reports itself visible, only the narrow rule takes it away.
      expect(harness.map.element.dataset['visible']).toBe('true');
    });
  }

  // Where the stepper is not shown the card keeps the lift it had; one size is enough, the rule is one selector.
  test(`phone 390x844, tour: the stepper is hidden and the card keeps its tour lift`, () => {
    rebuild(390, 844, false);
    const { card, bar, viewport } = show('tour');
    expect(bar.hidden).toBe(true);
    expect(viewport.bottom - card.bottom).toBeCloseTo(14 + 26, 0);
  });

  test('phone 390x844, walk: a host element named like the stepper inside a slot does not lift the card', () => {
    rebuild(390, 844, false);
    stepper.setCamera({ index: null, count: 0 });
    const box = new HostSlots(harness.shell.roots.root, ['bottom-left']).get('bottom-left');
    const lookalike = document.createElement('div');
    lookalike.className = 'walk-cameras';
    box.append(lookalike);
    const { card, bar, viewport } = show('walk');
    expect(bar.hidden).toBe(true);
    expect(viewport.bottom - card.bottom).toBeCloseTo(14, 0);
  });

  test(`phone 390x844, walk with no tour cameras: no stepper, the card keeps its corner`, () => {
    rebuild(390, 844, false);
    stepper.setCamera({ index: null, count: 0 });
    const { card, bar, viewport } = show('walk');
    expect(bar.hidden).toBe(true);
    expect(viewport.bottom - card.bottom).toBeCloseTo(14, 0);
  });

  for (const { label, width, height, edge } of WIDE) {
    for (const { claim, lift } of [
      { claim: false, lift: 0 },
      { claim: true, lift: 64 },
    ]) {
      test(`${label}, walk, ${claim ? 'a claimed corner' : 'no claim'}: the card keeps its previous inset beside the stepper`, () => {
        rebuild(width, height, claim);
        const { card, bar, viewport } = show('walk');
        const steps = bar.getBoundingClientRect();
        expect(bar.hidden).toBe(false);
        expect(steps.width).toBeGreaterThan(0);
        // Side by side, at least the gap apart: nothing to step over.
        expect(card.left - steps.right).toBeGreaterThanOrEqual(GAP - 0.5);
        expect(viewport.right - card.right).toBeCloseTo(edge, 0);
        expect(viewport.bottom - card.bottom).toBeCloseTo(edge + lift, 0);
      });
    }
  }
});
