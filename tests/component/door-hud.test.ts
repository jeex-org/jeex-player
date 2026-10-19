/**
 * The door button: which door it belongs to, where it sits, and when it lets go.
 *
 * It builds its own element with `document.createElement` and anchors it in
 * viewport pixels, so there was no way to check any of it without a document.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DoorHud, type DoorHudDeps } from '../../src/doors/door-hud.js';
import type { DoorPhase } from '../../src/doors/door-state.js';
import { OVERLAY_NAMES } from '../../src/ui/viewer-shell.js';
import { closeContainers, openShell, type Shell } from './support.js';

/** Two doors and something that is not one, by fixed UUID v7. */
const DOOR = {
  closed: '01a12ffa-de5e-7022-9041-5757d12302bd',
  open: '01a12ffa-de5f-7f48-9180-657e2f7e4b48',
  notADoor: '01a12ffa-de60-7ea1-81c9-8014f2eb249e',
} as const;

type World = {
  phases: Map<string, DoorPhase>;
  points: Map<string, { x: number; y: number }>;
  panelOpen: boolean;
  enabled: boolean;
};

type Harness = { shell: Shell; hud: DoorHud; world: World; toggle: ReturnType<typeof vi.fn> };

function build(overrides: Partial<DoorHudDeps> = {}): Harness {
  const shell = openShell();
  const world: World = {
    phases: new Map<string, DoorPhase>([
      [DOOR.closed, 'closed'],
      [DOOR.open, 'open'],
    ]),
    points: new Map([
      [DOOR.closed, { x: 120, y: 240 }],
      [DOOR.open, { x: 300, y: 180 }],
    ]),
    panelOpen: false,
    enabled: true,
  };
  const toggle = vi.fn();
  const hud = new DoorHud({
    container: shell.roots.root,
    canvas: shell.roots.canvas,
    screenPoint: (id) => world.points.get(id) ?? null,
    phase: (id) => world.phases.get(id) ?? null,
    toggle,
    panelOpen: () => world.panelOpen,
    enabled: () => world.enabled,
    messages: shell.messages,
    ...overrides,
  });
  return { shell, hud, world, toggle };
}

let harness: Harness;

beforeEach(() => {
  harness = build();
});

afterEach(() => {
  harness.hud.dispose();
  closeContainers();
});

describe('the element', () => {
  test('is a button in the shell, named for the browser check, hidden to begin with', () => {
    const button = harness.hud.element;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.dataset['jeex']).toBe(OVERLAY_NAMES.doorHud);
    expect(button.dataset['visible']).toBe('false');
    expect(harness.shell.roots.root.contains(button)).toBe(true);
  });

  test('dispose takes it out of the shell and stops answering the canvas', () => {
    const button = harness.hud.element;
    harness.hud.dispose();
    expect(button.isConnected).toBe(false);
    harness.hud.hover(DOOR.closed, 0);
    // The element is gone, so nothing it could report is on screen.
    expect(harness.shell.roots.root.querySelector(`[data-jeex="${OVERLAY_NAMES.doorHud}"]`)).toBeNull();
  });
});

describe('showing', () => {
  test('a hover over an interactive door raises the button at that door’s point', () => {
    harness.hud.hover(DOOR.closed, 1000);
    const button = harness.hud.element;
    expect(harness.hud.current()).toBe(DOOR.closed);
    expect(button.dataset['visible']).toBe('true');
    expect(button.dataset['opening']).toBe(DOOR.closed);
    expect(button.style.left).toBe('120px');
    expect(button.style.top).toBe('240px');
  });

  test('the state and the label follow the door’s phase', () => {
    harness.hud.hover(DOOR.closed, 1000);
    expect(harness.hud.element.dataset['state']).toBe('closed');
    expect(harness.hud.element.getAttribute('aria-label')).toBe(harness.shell.messages.t('door.open'));
    harness.hud.hide();
    harness.hud.hover(DOOR.open, 1000);
    expect(harness.hud.element.dataset['state']).toBe('open');
    expect(harness.hud.element.getAttribute('aria-label')).toBe(harness.shell.messages.t('door.close'));
  });

  test('a hover over something that is not a door raises nothing', () => {
    harness.hud.hover(DOOR.notADoor, 1000);
    expect(harness.hud.current()).toBeNull();
    harness.hud.hover(null, 1000);
    expect(harness.hud.current()).toBeNull();
  });

  test('a mode that forbids door interaction raises nothing', () => {
    harness.world.enabled = false;
    harness.hud.hover(DOOR.closed, 1000);
    expect(harness.hud.current()).toBeNull();
  });

  test('an open panel keeps the button down', () => {
    harness.world.panelOpen = true;
    harness.hud.hover(DOOR.closed, 1000);
    expect(harness.hud.current()).toBeNull();
  });

  test('a tap pins the button, and an open panel does not take a pinned one away', () => {
    harness.hud.showFor(DOOR.closed, 1000);
    expect(harness.hud.current()).toBe(DOOR.closed);
    harness.world.panelOpen = true;
    harness.hud.update(1000);
    // The tap that raised it is the same tap that opens the variant panel.
    expect(harness.hud.current()).toBe(DOOR.closed);
  });
});

describe('letting go', () => {
  test('the button survives the grace window and goes after it', () => {
    harness.hud.hover(DOOR.closed, 1000);
    harness.hud.update(1200);
    expect(harness.hud.current()).toBe(DOOR.closed);
    harness.hud.update(1400);
    expect(harness.hud.current()).toBeNull();
    expect(harness.hud.element.dataset['visible']).toBe('false');
    expect(harness.hud.element.dataset['opening']).toBeUndefined();
  });

  test('a pointer resting on the button keeps it up indefinitely', () => {
    harness.hud.hover(DOOR.closed, 1000);
    harness.hud.element.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    harness.hud.update(9000);
    expect(harness.hud.current()).toBe(DOOR.closed);
    harness.hud.element.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    harness.hud.update(9400);
    expect(harness.hud.current()).toBeNull();
  });

  test('a pinned button ignores the grace window', () => {
    harness.hud.showFor(DOOR.closed, 1000);
    harness.hud.update(99_000);
    expect(harness.hud.current()).toBe(DOOR.closed);
  });

  test('a door that stops being interactive drops the button at once', () => {
    harness.hud.showFor(DOOR.closed, 1000);
    harness.world.phases.delete(DOOR.closed);
    harness.hud.update(1000);
    expect(harness.hud.current()).toBeNull();
  });

  test('a door that leaves the screen drops the button', () => {
    harness.hud.showFor(DOOR.closed, 1000);
    harness.world.points.delete(DOOR.closed);
    harness.hud.update(1000);
    expect(harness.hud.current()).toBeNull();
  });

  test('a press on the scene canvas dismisses it', () => {
    harness.hud.showFor(DOOR.closed, 1000);
    harness.shell.roots.canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(harness.hud.current()).toBeNull();
  });
});

describe('pressing', () => {
  test('a click toggles the door it belongs to and does not reach the scene', () => {
    const onCanvas = vi.fn();
    harness.shell.roots.canvas.addEventListener('click', onCanvas);
    harness.hud.hover(DOOR.open, 1000);
    harness.hud.element.click();
    expect(harness.toggle).toHaveBeenCalledWith(DOOR.open);
    expect(onCanvas).not.toHaveBeenCalled();
  });

  test('a click on a hidden button toggles nothing', () => {
    harness.hud.element.click();
    expect(harness.toggle).not.toHaveBeenCalled();
  });
});
