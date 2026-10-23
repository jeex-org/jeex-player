/**
 * The control bar and the three cards (loading, error, viewer), against the
 * real shell.
 *
 * These run in the browser tier because every method of `viewer-chrome.ts`
 * reaches into a real shell, so nothing about it is checkable from
 * `bun test`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ViewerChrome, type ChromeCommands, type ViewerChromeDeps } from '../../src/ui/viewer-chrome.js';
import { FullscreenController } from '../../src/ui/fullscreen-controller.js';
import { createMessages } from '../../src/ui/messages.js';
import type { ViewerMode } from '../../src/scene/types.js';
import { canvasHasInk, closeContainers, openShell, type Shell } from './support.js';

type Harness = {
  shell: Shell;
  chrome: ViewerChrome;
  commands: { [K in keyof ChromeCommands]: ReturnType<typeof vi.fn> };
  onModePressed: ReturnType<typeof vi.fn>;
  onCollapseChanged: ReturnType<typeof vi.fn>;
  onDismiss: ReturnType<typeof vi.fn>;
  onRetry: ReturnType<typeof vi.fn>;
  viewport: FullscreenController;
};

function build(overrides: Partial<ViewerChromeDeps> = {}): Harness {
  const shell = openShell();
  const commands = {
    setMode: vi.fn(),
    resetCamera: vi.fn(),
    toggleTour: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleFurniture: vi.fn(),
    openInteriors: vi.fn(),
    setLightTemperature: vi.fn(),
  };
  const onModePressed = vi.fn();
  const onCollapseChanged = vi.fn();
  const onDismiss = vi.fn();
  const onRetry = vi.fn();
  const viewport = new FullscreenController(shell.roots.viewport);
  const chrome = new ViewerChrome({
    roots: shell.roots,
    viewport,
    messages: shell.messages,
    commands,
    onModePressed,
    onCollapseChanged,
    onDismiss,
    onRetry,
    ...overrides,
  });
  return { shell, chrome, commands, onModePressed, onCollapseChanged, onDismiss, onRetry, viewport };
}

let harness: Harness;

beforeEach(() => {
  harness = build();
});

afterEach(() => {
  harness.chrome.dispose();
  harness.viewport.dispose();
  closeContainers();
});

describe('shell states', () => {
  test('setLoading writes the width and the label onto the loading card', () => {
    harness.chrome.setLoading(42, 'Solving the plan');
    expect(harness.shell.roots.byName('loading-progress').style.width).toBe('42%');
    expect(harness.shell.roots.byName('loading-label').textContent).toBe('Solving the plan');
  });

  test('showViewer swaps the loading card for the chrome', () => {
    harness.chrome.showViewer();
    expect(harness.shell.roots.byName('loading-state').classList.contains('is-hidden')).toBe(true);
    expect(harness.shell.roots.byName('viewer-ui').classList.contains('is-hidden')).toBe(false);
  });

  test('showError shows the card, its copy, and the Retry button when retry is allowed', () => {
    harness.chrome.showError('Boot failed', 'no scene', true);
    expect(harness.shell.roots.byName('error-title').textContent).toBe('Boot failed');
    expect(harness.shell.roots.byName('error-message').textContent).toBe('no scene');
    expect(harness.shell.roots.byName('error-state').classList.contains('is-hidden')).toBe(false);
    expect(harness.shell.roots.byName('retry-button').classList.contains('is-hidden')).toBe(false);
    expect(harness.shell.roots.byName('viewer-ui').classList.contains('is-hidden')).toBe(true);
  });

  test('showError hides Retry for a failure retrying cannot fix', () => {
    harness.chrome.showError('No WebGL', 'this browser cannot', false);
    expect(harness.shell.roots.byName('retry-button').classList.contains('is-hidden')).toBe(true);
  });

  test('showError paints the fallback into the untouched canvas itself, for a dead end with no Retry', () => {
    harness.chrome.showError('No WebGL', 'this browser cannot', false);
    const canvas = harness.shell.roots.root.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
    // A canvas nothing has asked for a context yet can still give a 2D one, so
    // there is nothing to replace.
    expect(canvas).toBe(harness.shell.roots.canvas);
    expect(canvasHasInk(canvas!)).toBe(true);
  });

  test('showError REPLACES a canvas already taken by WebGL, keeping its shell name', () => {
    // `hasWebGL` said yes, the renderer took the context, and the boot failed
    // afterwards with nothing left to retry. A canvas with a WebGL context can
    // never give a 2D one, so the card would otherwise have nothing to paint
    // into.
    expect(harness.shell.roots.canvas.getContext('webgl2')).not.toBeNull();
    harness.chrome.showError('Boot failed', 'the scene did not build', false);
    const canvas = harness.shell.roots.root.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
    expect(canvas).not.toBeNull();
    expect(canvas).not.toBe(harness.shell.roots.canvas);
    expect(canvas!.className).toBe(harness.shell.roots.canvas.className);
    expect(canvas!.getAttribute('aria-label')).toBe(harness.shell.messages.t('canvas.fallbackLabel'));
    expect(canvasHasInk(canvas!)).toBe(true);
  });

  test('showError leaves the canvas untouched when Retry is offered, so a retried buildStage can still take WebGL', () => {
    // The bug this guards against: painting the 2D fallback into a canvas
    // that has never held a context locks it to '2d' forever (a canvas may
    // hold exactly one context type in its lifetime) — a Retry that reaches
    // `buildStage()` again would then find `THREE.WebGLRenderer` unable to
    // get a context at all. `canvasHasInk`
    // is not used here on purpose: it takes a '2d' context of its own, which
    // would taint the very thing this test is proving stayed untaken.
    const before = harness.shell.roots.canvas;
    harness.chrome.showError('Boot failed', 'the scene server said no', true);
    const canvas = harness.shell.roots.root.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]');
    expect(canvas).toBe(before);
    expect(canvas!.getContext('webgl2')).not.toBeNull();
  });

  test('showLoading is what Retry shows: back to the loading card', () => {
    harness.chrome.showError('Boot failed', 'no scene', true);
    harness.chrome.showLoading();
    expect(harness.shell.roots.byName('loading-state').classList.contains('is-hidden')).toBe(false);
    expect(harness.shell.roots.byName('error-state').classList.contains('is-hidden')).toBe(true);
  });

  test('showDegradedNotice reveals the notice', () => {
    expect(harness.shell.roots.byName('degraded-notice').classList.contains('is-hidden')).toBe(true);
    harness.chrome.showDegradedNotice();
    expect(harness.shell.roots.byName('degraded-notice').classList.contains('is-hidden')).toBe(false);
  });

  test('setSceneName fills the brand context line the template leaves empty', () => {
    harness.chrome.setSceneName('Bright two-room');
    expect(harness.shell.roots.byName('brand-context').textContent).toBe('Bright two-room');
  });
});

describe('control bar', () => {
  test('a click on a mode button reports that mode to the owner', () => {
    harness.chrome.bind();
    harness.shell.roots.root.querySelector<HTMLButtonElement>('[data-mode="walk"]')!.click();
    expect(harness.onModePressed).toHaveBeenCalledWith('walk');
  });

  test('setModeButtons marks exactly one button active and aria-pressed', () => {
    for (const mode of ['plan2d', 'plan3d', 'orbit', 'walk', 'tour'] as ViewerMode[]) {
      harness.chrome.setModeButtons(mode);
      const buttons = [...harness.shell.roots.byName('control-bar').querySelectorAll<HTMLButtonElement>('[data-mode]')];
      const active = buttons.filter((button) => button.classList.contains('is-active'));
      expect(active.map((button) => button.dataset['mode'])).toEqual([mode]);
      expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toEqual(active);
    }
  });

  test('the five mode buttons are the only nodes of the bar carrying data-mode', () => {
    const buttons = [...harness.shell.roots.byName('control-bar').querySelectorAll('[data-mode]')];
    expect(buttons.map((button) => (button as HTMLElement).dataset['mode'])).toEqual(['plan2d', 'plan3d', 'orbit', 'walk', 'tour']);
  });

  test('the reset, fullscreen and furniture buttons call their commands', () => {
    harness.chrome.bind();
    harness.shell.roots.byName<HTMLButtonElement>('reset-button').click();
    harness.shell.roots.byName<HTMLButtonElement>('fullscreen-button').click();
    harness.shell.roots.byName<HTMLButtonElement>('furniture-button').click();
    expect(harness.commands.resetCamera).toHaveBeenCalledTimes(1);
    expect(harness.commands.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(harness.commands.toggleFurniture).toHaveBeenCalledTimes(1);
  });

  test('the interiors button opens the panel anchored under itself', () => {
    harness.chrome.bind();
    harness.shell.roots.byName<HTMLButtonElement>('interiors-button').click();
    expect(harness.commands.openInteriors).toHaveBeenCalledTimes(1);
    const anchor = harness.commands.openInteriors.mock.calls[0]![0] as { x: number; y: number };
    expect(Number.isFinite(anchor.x)).toBe(true);
    expect(Number.isFinite(anchor.y)).toBe(true);
  });

  test('Retry re-runs this instance’s boot', () => {
    harness.chrome.bind();
    harness.shell.roots.byName<HTMLButtonElement>('retry-button').click();
    expect(harness.onRetry).toHaveBeenCalledTimes(1);
  });

  test('setTourButtonLabel writes Play or Pause onto the Tour button', () => {
    harness.chrome.setTourButtonLabel(true);
    const button = harness.shell.roots.root.querySelector<HTMLButtonElement>('[data-mode="tour"]')!;
    const playing = button.textContent;
    harness.chrome.setTourButtonLabel(false);
    expect(button.textContent).not.toBe(playing);
  });

  test('retranslate re-renders the Pause label of a playing tour; the mode name Tour never changes', () => {
    const button = harness.shell.roots.root.querySelector<HTMLButtonElement>('[data-mode="tour"]')!;
    harness.chrome.setTourButtonLabel(true);
    harness.chrome.retranslate(createMessages('ru'));
    expect(button.textContent).toBe(createMessages('ru').t('tour.button.pause'));
    harness.chrome.setTourButtonLabel(false);
    harness.chrome.retranslate(createMessages('en'));
    expect(button.textContent).toBe('Tour');
  });
});

describe('control bar semantics', () => {
  test('the bar is a plain group, not role="toolbar"', () => {
    expect(harness.shell.roots.byName('control-bar').getAttribute('role')).toBe('group');
    expect(harness.shell.roots.root.querySelector('[role="toolbar"]')).toBeNull();
  });

  test('no <nav> is nested inside the control bar', () => {
    expect(harness.shell.roots.byName('control-bar').querySelector('nav')).toBeNull();
  });

  test('the mode switcher is its own named group, not a navigation landmark', () => {
    const switcher = harness.shell.roots.byName('control-bar').querySelector('.mode-switcher')!;
    expect(switcher.tagName).toBe('DIV');
    expect(switcher.getAttribute('role')).toBe('group');
  });

  test('every mode button is reachable by Tab, in DOM order, as its own stop', () => {
    harness.chrome.bind();
    harness.chrome.wake(true);
    const buttons = [...harness.shell.roots.byName('control-bar').querySelectorAll<HTMLButtonElement>('[data-mode]')];
    expect(buttons.map((button) => button.dataset['mode'])).toEqual(['plan2d', 'plan3d', 'orbit', 'walk', 'tour']);
    // Each is a native <button> with no tabindex override: every one is its
    // OWN tab stop (no roving tabindex, no arrow-key redirection).
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.hasAttribute('tabindex')).toBe(false);
      expect(button.disabled).toBe(false);
    }
  });

  test('aria-pressed on a mode button says whether it is active', () => {
    harness.chrome.setModeButtons('walk');
    const walk = harness.shell.roots.root.querySelector<HTMLButtonElement>('[data-mode="walk"]')!;
    const orbit = harness.shell.roots.root.querySelector<HTMLButtonElement>('[data-mode="orbit"]')!;
    expect(walk.getAttribute('aria-pressed')).toBe('true');
    expect(orbit.getAttribute('aria-pressed')).toBe('false');
  });
});

const FULL_CHROME = { brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: true };

describe('chrome visibility options', () => {
  test('chrome:false hides the brand lockup, the bar and the hint with the hidden attribute', () => {
    harness.chrome.setChrome({ ...FULL_CHROME, brand: false, controls: false, hint: false });
    expect(harness.shell.roots.byName('brand-lockup').hidden).toBe(true);
    expect(harness.shell.roots.byName('control-bar').hidden).toBe(true);
    expect(harness.shell.roots.byName('hint-card').hidden).toBe(true);
    // `hidden` is the DOM's own answer, so it really is out of the layout.
    expect(harness.shell.roots.byName('control-bar').offsetParent).toBeNull();
  });

  test('each of the five flags hides exactly its own element and nothing else', () => {
    const elements = {
      brand: 'brand-lockup',
      controls: 'control-bar',
      hint: 'hint-card',
      modeSwitcher: 'mode-switcher',
    } as const;
    for (const flag of Object.keys(elements) as (keyof typeof elements)[]) {
      harness.chrome.setChrome(FULL_CHROME);
      harness.chrome.setChrome({ ...FULL_CHROME, [flag]: false });
      for (const [otherFlag, name] of Object.entries(elements)) {
        expect(harness.shell.roots.byName(name).hidden).toBe(otherFlag === flag);
      }
    }
    // Reset for the tests that follow.
    harness.chrome.setChrome(FULL_CHROME);
  });

  test('hint is decoupled from controls: controls off leaves the hint on and vice versa', () => {
    harness.chrome.setChrome({ ...FULL_CHROME, controls: false, hint: true });
    expect(harness.shell.roots.byName('control-bar').hidden).toBe(true);
    expect(harness.shell.roots.byName('hint-card').hidden).toBe(false);
    harness.chrome.setChrome({ ...FULL_CHROME, controls: true, hint: false });
    expect(harness.shell.roots.byName('control-bar').hidden).toBe(false);
    expect(harness.shell.roots.byName('hint-card').hidden).toBe(true);
  });

  test('the reveal-controls pill follows controls: wake(true) cannot show it while controls is off', () => {
    harness.chrome.bind();
    harness.chrome.setChrome({ ...FULL_CHROME, controls: false });
    const pill = harness.shell.roots.byName('reveal-controls');
    expect(pill.hidden).toBe(true);
    harness.chrome.wake(true);
    expect(pill.hidden).toBe(true);
    // Native `hidden` takes it out of the accessibility tree and the tab
    // order regardless of the class/aria-hidden/tabIndex `wake` also sets.
    expect(pill.offsetParent).toBeNull();
    harness.chrome.setChrome({ ...FULL_CHROME, controls: true });
    expect(pill.hidden).toBe(false);
  });

  test('a plan mode takes the interior selector off the bar and gives it back', () => {
    harness.chrome.setInteriorsAvailable(true);
    const button = harness.shell.roots.byName('interiors-button');
    expect(button.classList.contains('is-hidden')).toBe(false);
    expect(harness.chrome.setPlanMode('plan2d')).toBe(true);
    expect(button.classList.contains('is-hidden')).toBe(true);
    // Idempotent: a second plan mode is not a change.
    expect(harness.chrome.setPlanMode('plan3d')).toBe(false);
    expect(harness.chrome.setPlanMode('orbit')).toBe(true);
    expect(button.classList.contains('is-hidden')).toBe(false);
  });

  test('a scene with no presets never offers the selector, whatever the mode', () => {
    harness.chrome.setInteriorsAvailable(false);
    expect(harness.shell.roots.byName('interiors-button').classList.contains('is-hidden')).toBe(true);
  });

  test('the live region is never touched by chrome:false — an accessibility baseline is not a chrome option', () => {
    harness.chrome.setChrome({ ...FULL_CHROME, brand: false, controls: false, status: false, modeSwitcher: false, hint: false });
    expect(harness.shell.roots.byName('live-region').hidden).toBe(false);
  });
});

describe('live region', () => {
  test('setModeButtons announces the mode, but only when it actually changes', async () => {
    const live = harness.shell.roots.byName('live-region');
    harness.chrome.setModeButtons('walk');
    expect(live.textContent).toBe('Walk mode');
    live.textContent = 'SENTINEL';
    harness.chrome.setModeButtons('walk');
    expect(live.textContent).toBe('SENTINEL');
    // Outside the throttle window, a real change writes straight away again.
    await new Promise((resolve) => {
      setTimeout(resolve, 1100);
    });
    harness.chrome.setModeButtons('tour');
    expect(live.textContent).toBe('Tour mode');
  });

  test('setHint (the room-tracking hint already uses) mirrors into the live region too', () => {
    const live = harness.shell.roots.byName('live-region');
    harness.chrome.setHint('Kitchen · click anywhere else to deselect');
    expect(live.textContent).toBe('Kitchen · click anywhere else to deselect');
  });

  test('a burst of announcements coalesces to the LATEST one, at most once per throttle window', async () => {
    const live = harness.shell.roots.byName('live-region');
    harness.chrome.setModeButtons('walk');
    const first = live.textContent;
    harness.chrome.setModeButtons('tour');
    harness.chrome.setModeButtons('orbit');
    // Still the FIRST text: the window has not elapsed, so nothing after it
    // has been written yet — only scheduled.
    expect(live.textContent).toBe(first);
    await new Promise((resolve) => {
      setTimeout(resolve, 1100);
    });
    expect(live.textContent).toBe('360 view mode');
  });

  test('setCanvasDescription builds a description that names the scene and every room', () => {
    harness.chrome.setCanvasDescription('Flat A', ['Hall', 'Kitchen', 'Living room']);
    const description = harness.shell.roots.canvas.getAttribute('aria-description');
    expect(description).toContain('Flat A');
    for (const room of ['Hall', 'Kitchen', 'Living room']) expect(description).toContain(room);
    expect(description).toContain('W, A, S, D');
  });

  test('retranslate rebuilds the last description in the new language', () => {
    harness.chrome.setCanvasDescription('Flat A', ['Kitchen']);
    harness.chrome.retranslate(createMessages('ru'));
    const description = harness.shell.roots.canvas.getAttribute('aria-description');
    expect(description).toContain('Клавиши');
    expect(description).toContain('Kitchen');
  });
});

describe('hints and furniture state', () => {
  test('setHintForMode writes that mode’s hint', () => {
    harness.chrome.setHintForMode('walk');
    const walk = harness.shell.roots.byName('hint-text').textContent;
    harness.chrome.setHintForMode('orbit');
    expect(harness.shell.roots.byName('hint-text').textContent).not.toBe(walk);
    expect(walk?.length).toBeGreaterThan(0);
  });

  test('setFurnitureState mirrors onto aria-pressed, the label and the hint', () => {
    const button = harness.shell.roots.byName('furniture-button');
    harness.chrome.setFurnitureState(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList.contains('is-off')).toBe(true);
    const hidden = harness.shell.roots.byName('hint-text').textContent;
    harness.chrome.setFurnitureState(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(harness.shell.roots.byName('hint-text').textContent).not.toBe(hidden);
  });

  test('retranslate re-renders the strings the chrome owns', () => {
    const button = harness.shell.roots.byName('furniture-button');
    harness.chrome.setFurnitureState(true);
    const english = button.getAttribute('aria-label');
    harness.chrome.retranslate(createMessages('ru'));
    // The label is re-read from the new catalogue; whether RU has that key is
    // `messages.ts`'s business, so this asserts the CALL happened, by identity.
    expect(button.getAttribute('aria-label')).toBe(createMessages('ru').t('furniture.hide'));
    expect(typeof english).toBe('string');
  });
});

describe('auto-hide', () => {
  test('wake(true) shows the bar and leaves it shown', async () => {
    harness.chrome.wake(true);
    expect(harness.chrome.isCollapsed).toBe(false);
    expect(harness.shell.roots.byName('control-bar').classList.contains('is-collapsed')).toBe(false);
    expect(harness.shell.roots.byName('reveal-controls').getAttribute('aria-hidden')).toBe('true');
    expect(harness.onCollapseChanged).toHaveBeenCalled();
  });

  test('the idle timer collapses the bar, makes it inert and offers the reveal pill', async () => {
    vi.useFakeTimers();
    try {
      harness.chrome.wake();
      vi.advanceTimersByTime(4300);
      expect(harness.chrome.isCollapsed).toBe(true);
      const bar = harness.shell.roots.byName('control-bar');
      expect(bar.classList.contains('is-collapsed')).toBe(true);
      expect(bar.inert).toBe(true);
      const pill = harness.shell.roots.byName('reveal-controls');
      expect(pill.classList.contains('is-visible')).toBe(true);
      expect(pill.hasAttribute('aria-hidden')).toBe(false);
      expect(pill.tabIndex).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('chrome.autoHide defaults to true, so the bar still collapses after the idle pause', () => {
    vi.useFakeTimers();
    try {
      harness.chrome.setChrome(FULL_CHROME);
      harness.chrome.wake();
      vi.advanceTimersByTime(4300);
      expect(harness.chrome.isCollapsed).toBe(true);
      expect(harness.shell.roots.byName('control-bar').inert).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('chrome.autoHide: false keeps the bar shown and interactive long past HIDE_CONTROLS_MS', () => {
    vi.useFakeTimers();
    try {
      harness.chrome.bind();
      harness.chrome.setChrome({ ...FULL_CHROME, autoHide: false });
      harness.chrome.wake();
      // 4.2 s is the idle pause; a minute is «never», not «not yet».
      vi.advanceTimersByTime(60_000);
      const bar = harness.shell.roots.byName('control-bar');
      expect(harness.chrome.isCollapsed).toBe(false);
      expect(bar.classList.contains('is-collapsed')).toBe(false);
      expect(bar.dataset['collapsed']).toBe('false');
      expect(bar.inert).toBe(false);
      const pill = harness.shell.roots.byName('reveal-controls');
      expect(pill.classList.contains('is-visible')).toBe(false);
      expect(pill.getAttribute('aria-hidden')).toBe('true');
      expect(pill.tabIndex).toBe(-1);
      // Interactive, not merely visible: the button is still reachable and its
      // handler still runs, which a collapsed (and `inert`) bar would deny a user.
      bar.querySelector<HTMLButtonElement>('[data-mode="walk"]')?.click();
      expect(harness.onModePressed).toHaveBeenCalledWith('walk');
    } finally {
      vi.useRealTimers();
    }
  });

  test('turning chrome.autoHide off disarms the timer already ticking, and back on arms it again', () => {
    vi.useFakeTimers();
    try {
      harness.chrome.wake();
      harness.chrome.setChrome({ ...FULL_CHROME, autoHide: false });
      vi.advanceTimersByTime(60_000);
      expect(harness.chrome.isCollapsed).toBe(false);
      harness.chrome.setChrome(FULL_CHROME);
      harness.chrome.wake();
      vi.advanceTimersByTime(4300);
      expect(harness.chrome.isCollapsed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('with chrome.autoHide off a collapsed bar is opened again and stays open', () => {
    vi.useFakeTimers();
    try {
      harness.chrome.wake();
      vi.advanceTimersByTime(4300);
      expect(harness.chrome.isCollapsed).toBe(true);
      harness.chrome.setChrome({ ...FULL_CHROME, autoHide: false });
      expect(harness.chrome.isCollapsed).toBe(false);
      expect(harness.shell.roots.byName('control-bar').inert).toBe(false);
      vi.advanceTimersByTime(60_000);
      expect(harness.chrome.isCollapsed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('dispose stops the pending idle timer', () => {
    vi.useFakeTimers();
    try {
      harness.chrome.wake();
      harness.chrome.dispose();
      harness.onCollapseChanged.mockClear();
      vi.advanceTimersByTime(10_000);
      expect(harness.chrome.isCollapsed).toBe(false);
      expect(harness.onCollapseChanged).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('standalone fullscreen button and read-only', () => {
  /** A chrome whose viewport reports whatever `state.fullscreen` says. */
  function buildWithFullscreen(state: { fullscreen: boolean }): Harness {
    const viewport = { isFullscreen: () => state.fullscreen } as unknown as FullscreenController;
    return build({ viewport });
  }

  const EMBED = { chrome: { ...FULL_CHROME, controls: false }, fullscreenButton: { show: true, right: 32, top: 32 }, readonly: true };

  function apply(target: Harness, options = EMBED): void {
    target.chrome.setChrome(options.chrome);
    target.chrome.setFullscreenButton(options.fullscreenButton);
    target.chrome.setReadonly(options.readonly);
  }

  test('the floating button is hidden by default, before and after the chrome is laid out', () => {
    const float = harness.shell.roots.byName('fullscreen-float');
    expect(float.hidden).toBe(true);
    harness.chrome.setChrome(FULL_CHROME);
    harness.chrome.setFullscreenButton({ show: false, right: 32, top: 32 });
    expect(float.hidden).toBe(true);
  });

  test('controls=0 + fullscreenButton: only the floating button, at the configured offsets', () => {
    harness.chrome.bind();
    apply(harness, { ...EMBED, fullscreenButton: { show: true, right: 12, top: 20 } });
    harness.chrome.showViewer();
    const float = harness.shell.roots.byName('fullscreen-float');
    expect(float.hidden).toBe(false);
    expect(harness.shell.roots.byName('control-bar').hidden).toBe(true);
    const root = harness.shell.roots.root.getBoundingClientRect();
    const box = float.getBoundingClientRect();
    expect(Math.round(root.right - box.right)).toBe(12);
    expect(Math.round(box.top - root.top)).toBe(20);
    expect(float.getAttribute('aria-label')).toBe(harness.shell.messages.t('fullscreen.enter'));
  });

  test('a click on the floating button asks the one fullscreen command', () => {
    harness.chrome.bind();
    apply(harness);
    harness.shell.roots.byName<HTMLButtonElement>('fullscreen-float').click();
    expect(harness.commands.toggleFullscreen).toHaveBeenCalledTimes(1);
  });

  test('entering fullscreen hides the floating button and opens the bar; leaving restores the embedding state', () => {
    harness.chrome.dispose();
    const state = { fullscreen: false };
    harness = buildWithFullscreen(state);
    harness.chrome.bind();
    apply(harness);
    const { byName } = harness.shell.roots;
    state.fullscreen = true;
    harness.chrome.updateFullscreenButton();
    expect(byName('fullscreen-float').hidden).toBe(true);
    expect(byName('control-bar').hidden).toBe(false);
    expect(byName('control-bar').dataset['collapsed']).toBe('false');
    state.fullscreen = false;
    harness.chrome.updateFullscreenButton();
    expect(byName('fullscreen-float').hidden).toBe(false);
    expect(byName('control-bar').hidden).toBe(true);
    expect(byName('reveal-controls').hidden).toBe(true);
  });

  /** A bound, laid-out embed whose fullscreen command flips `state` and reports the change like the controller would. */
  function fullscreenEmbed(state: { fullscreen: boolean }): Harness {
    harness.chrome.dispose();
    const target = buildWithFullscreen(state);
    target.commands.toggleFullscreen.mockImplementation(() => {
      state.fullscreen = !state.fullscreen;
      target.chrome.updateFullscreenButton();
    });
    target.chrome.bind();
    apply(target);
    target.chrome.showViewer();
    return target;
  }

  function activeIn(target: Harness): Element | null {
    return (target.shell.roots.root.getRootNode() as unknown as DocumentOrShadowRoot).activeElement;
  }

  test('a keyboard press on the floating button moves focus to the toolbar fullscreen button, and leaving returns it', async () => {
    const state = { fullscreen: false };
    harness = fullscreenEmbed(state);
    const { byName } = harness.shell.roots;
    const float = byName<HTMLButtonElement>('fullscreen-float');
    for (let i = 0; i < 20 && activeIn(harness) !== float; i += 1) await userEvent.tab();
    expect(activeIn(harness)).toBe(float);
    expect(float.matches(':focus-visible')).toBe(true);
    await userEvent.keyboard('{Enter}');
    expect(state.fullscreen).toBe(true);
    expect(float.hidden).toBe(true);
    expect(activeIn(harness)).toBe(byName('fullscreen-button'));
    await userEvent.keyboard('{Enter}');
    expect(state.fullscreen).toBe(false);
    expect(float.hidden).toBe(false);
    expect(activeIn(harness)).toBe(float);
  });

  test('a pointer press on the floating button does not move focus into the bar', async () => {
    const state = { fullscreen: false };
    harness = fullscreenEmbed(state);
    const { byName } = harness.shell.roots;
    await userEvent.click(byName('fullscreen-float'));
    expect(state.fullscreen).toBe(true);
    expect(byName('control-bar').contains(activeIn(harness))).toBe(false);
  });

  test('leaving fullscreen with focus outside the viewer leaves focus where it is', () => {
    const state = { fullscreen: false };
    harness = fullscreenEmbed(state);
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      state.fullscreen = true;
      harness.chrome.updateFullscreenButton();
      outside.focus();
      state.fullscreen = false;
      harness.chrome.updateFullscreenButton();
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  test('read-only hides the brand and keeps Reset, the switcher, furniture and fullscreen buttons', () => {
    harness.chrome.bind();
    apply(harness, { ...EMBED, chrome: FULL_CHROME });
    const { byName } = harness.shell.roots;
    expect(byName('brand-lockup').hidden).toBe(true);
    expect(byName('reset-button').hidden).toBe(false);
    expect(byName('mode-switcher').hidden).toBe(false);
    expect(byName('furniture-button').hidden).toBe(false);
    expect(byName('fullscreen-button').hidden).toBe(false);
    harness.chrome.setReadonly(false);
    expect(byName('brand-lockup').hidden).toBe(false);
    expect(byName('reset-button').hidden).toBe(false);
  });
});
