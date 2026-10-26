/**
 * The wiring `viewer-chrome.ts` and `selection-panel.ts` cannot test alone:
 * Escape belongs to whichever of the chrome's overlays is open, and that
 * decision lives in `ViewerUI.dismiss`, bound on the shell root.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ViewerUI, type ViewerCommands } from '../../src/ui/viewer-ui.js';
import { FullscreenController } from '../../src/ui/fullscreen-controller.js';
import { closeContainers, openShell, type Shell } from './support.js';
import { FINISH } from '../../src/materials/finish-ids.js';

function noop(): void {
  // Command stubs: this file is about focus and the Escape key, not effects.
}

/** Every Escape the viewer passed on to clear its selection. */
let deselects = 0;

function build(): { shell: Shell; ui: ViewerUI } {
  const shell = openShell();
  shell.roots.byName('loading-state').classList.add('is-hidden');
  shell.roots.byName('viewer-ui').classList.remove('is-hidden');
  const commands: ViewerCommands = {
    setMode: noop,
    resetCamera: noop,
    toggleTour: noop,
    toggleFullscreen: noop,
    toggleFurniture: noop,
    openInteriors: noop,
    setLightTemperature: noop,
    tourSeek: noop,
    tourPlay: noop,
    tourPause: noop,
    tourSpeed: noop,
  };
  const ui = new ViewerUI({
    shell: new FullscreenController(shell.roots.viewport),
    messages: shell.messages,
    roots: shell.roots,
    commands,
    onEscape: () => {
      deselects += 1;
    },
  });
  ui.bind();
  return { shell, ui };
}

let harness: { shell: Shell; ui: ViewerUI };

beforeEach(() => {
  deselects = 0;
  harness = build();
});

afterEach(() => {
  closeContainers();
});

describe('the panel as a dialog', () => {
  test('Escape on the shell root closes an open panel and restores focus to the trigger', () => {
    const trigger = harness.shell.roots.byName<HTMLButtonElement>('furniture-button');
    trigger.focus();
    harness.ui.openPanel({
      kind: 'finish',
      title: 'Floor finish',
      items: [{ id: FINISH.oak, label: 'Oak', thumbnail: null, background: '#c8a06a', active: true, dataset: { finish: FINISH.oak } }],
      anchor: { x: 100, y: 100 },
      onPick: vi.fn(),
    });
    expect(harness.ui.isPanelOpen()).toBe(true);
    expect(document.activeElement).not.toBe(trigger);

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    harness.shell.roots.root.dispatchEvent(escape);

    expect(harness.ui.isPanelOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  test('a pointer press outside the panel closes it the same way', () => {
    harness.ui.openPanel({
      kind: 'finish',
      title: 'Floor finish',
      items: [],
      anchor: { x: 100, y: 100 },
      onPick: vi.fn(),
    });
    expect(harness.ui.isPanelOpen()).toBe(true);
    harness.shell.roots.root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(harness.ui.isPanelOpen()).toBe(false);
  });
});

describe('setChrome', () => {
  const FULL_CHROME = { brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: true };

  test('chrome.status reaches the tour-status pill through the tour bar, not the chrome', () => {
    harness.ui.setPlanMode('tour');
    harness.ui.setTourState('playing');
    expect(harness.shell.roots.byName('tour-status').classList.contains('is-hidden')).toBe(false);
    harness.ui.setChrome({ ...FULL_CHROME, status: false });
    expect(harness.shell.roots.byName('tour-status').classList.contains('is-hidden')).toBe(true);
    // The rest of the chrome is untouched by a `status`-only change.
    expect(harness.shell.roots.byName('control-bar').hidden).toBe(false);
    expect(harness.shell.roots.byName('mode-switcher').hidden).toBe(false);
    harness.ui.setChrome(FULL_CHROME);
    expect(harness.shell.roots.byName('tour-status').classList.contains('is-hidden')).toBe(false);
  });
});

describe('the tour chrome follows the mode', () => {
  test('leaving the tour for any other mode takes the bar and the pill away; coming back restores them', () => {
    const bar = harness.shell.roots.byName('tour-bar');
    const pill = harness.shell.roots.byName('tour-status');
    harness.ui.setPlanMode('tour');
    harness.ui.setTourState('playing');
    expect(bar.dataset['visible']).toBe('true');
    // The director pauses the clip and then announces the new mode, in that order.
    for (const mode of ['orbit', 'walk', 'plan3d', 'plan2d', 'orbit'] as const) {
      harness.ui.setTourState('paused');
      harness.ui.setPlanMode(mode);
      expect({ mode, bar: bar.dataset['visible'], pill: pill.classList.contains('is-hidden') }).toEqual({ mode, bar: 'false', pill: true });
    }
    harness.ui.setPlanMode('tour');
    expect(bar.dataset['visible']).toBe('true');
    expect(pill.classList.contains('is-hidden')).toBe(false);
  });
});

describe('Escape clears the selection', () => {
  const escape = (): void => {
    harness.shell.roots.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  };

  test('with nothing open, Escape on the shell root is passed on to clear the selection', () => {
    escape();
    expect(deselects).toBe(1);
  });

  test('with the selection panel open, one Escape closes it and clears the selection', () => {
    harness.ui.openPanel({ kind: 'finish', title: 'Floor finish', items: [], anchor: { x: 100, y: 100 }, onPick: vi.fn() });
    escape();
    expect(harness.ui.isPanelOpen()).toBe(false);
    expect(deselects).toBe(1);
  });

  test('an open popup takes the first Escape alone; the next one clears the selection', () => {
    harness.ui.openPanel({ kind: 'finish', title: 'Floor finish', items: [], anchor: { x: 100, y: 100 }, onPick: vi.fn() });
    harness.ui.openReplacePopup({ title: 'Replace Long sofa with', empty: 'Nothing else fits here', groups: [], onPick: vi.fn() });
    escape();
    expect(harness.ui.isPanelOpen()).toBe(true);
    expect(deselects).toBe(0);
    escape();
    expect(deselects).toBe(1);
  });

  test('a key other than Escape clears nothing', () => {
    harness.shell.roots.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(deselects).toBe(0);
  });
});
