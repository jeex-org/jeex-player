/**
 * The progress bar, scrubbed with real pointer events on a real track.
 *
 * The scrub is the whole reason this needs a browser: `fractionAt` reads
 * `getBoundingClientRect()`, so a fake element makes every seek 0 and the test
 * proves nothing.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TourBar, type TourBarDeps } from '../../src/ui/tour-bar.js';
import { createMessages } from '../../src/ui/messages.js';
import type { TourProgress, TourState } from '../../src/camera/tour-controls.js';
import type { ViewerMode } from '../../src/scene/types.js';
import { closeContainers, openShell, type Shell } from './support.js';

type Harness = {
  shell: Shell;
  bar: TourBar;
  seek: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  toggle: ReturnType<typeof vi.fn>;
  setSpeed: ReturnType<typeof vi.fn>;
  onInteraction: ReturnType<typeof vi.fn>;
  onState: ReturnType<typeof vi.fn>;
  mode: { value: ViewerMode };
  collapsed: { value: boolean };
};

function build(overrides: Partial<TourBarDeps> = {}): Harness {
  const shell = openShell();
  const seek = vi.fn();
  const play = vi.fn();
  const pause = vi.fn();
  const toggle = vi.fn();
  const setSpeed = vi.fn();
  const onInteraction = vi.fn();
  const onState = vi.fn();
  // The bar's tests start where the bar lives: in the tour.
  const mode: { value: ViewerMode } = { value: 'tour' };
  const collapsed = { value: false };
  const bar = new TourBar({
    roots: shell.roots,
    messages: shell.messages,
    seek,
    play,
    pause,
    toggle,
    setSpeed,
    onInteraction,
    mode: () => mode.value,
    collapsed: () => collapsed.value,
    onState,
    ...overrides,
  });
  // The chrome ships hidden and `ViewerChrome.showViewer()` is what reveals it.
  // The track's fraction is read off `getBoundingClientRect()`, so a bar inside
  // a `display:none` parent would make every seek 0 and every assertion here
  // vacuous.
  shell.roots.byName('viewer-ui').classList.remove('is-hidden');
  return { shell, bar, seek, play, pause, toggle, setSpeed, onInteraction, onState, mode, collapsed };
}

/** A pointer event the track will act on; `pointerId` is what capture needs. */
function pointer(type: string, clientX: number, target: HTMLElement): PointerEvent {
  const rect = target.getBoundingClientRect();
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    isPrimary: true,
    clientX,
    clientY: rect.top + rect.height / 2,
  });
}

let harness: Harness;

beforeEach(() => {
  harness = build();
  harness.bar.bind();
});

afterEach(() => {
  closeContainers();
});

describe('scrubbing the track', () => {
  test('a press at the middle of the track seeks to that fraction', () => {
    // `data-visible="false"` is `display:none`, so the bar has no box until the
    // clip is engaged — which is also when a scrub can happen at all.
    harness.bar.setState('paused');
    const track = harness.shell.roots.byName('tour-track');
    const rect = track.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    track.dispatchEvent(pointer('pointerdown', rect.left + rect.width / 2, track));
    expect(harness.seek).toHaveBeenCalledTimes(1);
    expect(harness.seek.mock.calls[0]![0] as number).toBeCloseTo(0.5, 1);
    expect(harness.onInteraction).toHaveBeenCalled();
  });

  test('a drag seeks continuously and clamps at both ends', () => {
    harness.bar.setState('paused');
    const track = harness.shell.roots.byName('tour-track');
    const rect = track.getBoundingClientRect();
    track.dispatchEvent(pointer('pointerdown', rect.left + rect.width * 0.25, track));
    track.dispatchEvent(pointer('pointermove', rect.left - 500, track));
    track.dispatchEvent(pointer('pointermove', rect.right + 500, track));
    const seeks = harness.seek.mock.calls.map((call) => call[0] as number);
    expect(seeks.length).toBe(3);
    expect(seeks[0]!).toBeCloseTo(0.25, 1);
    expect(seeks[1]!).toBe(0);
    expect(seeks[2]!).toBe(1);
  });

  test('a move with no press before it seeks nothing', () => {
    const track = harness.shell.roots.byName('tour-track');
    track.dispatchEvent(pointer('pointermove', track.getBoundingClientRect().left + 10, track));
    expect(harness.seek).not.toHaveBeenCalled();
  });

  test('a drag over a playing run pauses it and resumes on release', () => {
    harness.bar.setState('playing');
    const track = harness.shell.roots.byName('tour-track');
    const rect = track.getBoundingClientRect();
    track.dispatchEvent(pointer('pointerdown', rect.left + 10, track));
    expect(harness.pause).toHaveBeenCalledTimes(1);
    expect(harness.shell.roots.byName('tour-bar').dataset['scrubbing']).toBe('true');
    track.dispatchEvent(pointer('pointerup', rect.left + 10, track));
    expect(harness.play).toHaveBeenCalledTimes(1);
    expect(harness.shell.roots.byName('tour-bar').dataset['scrubbing']).toBeUndefined();
  });

  test('a drag over a paused run does not start it playing on release', () => {
    harness.bar.setState('paused');
    const track = harness.shell.roots.byName('tour-track');
    const rect = track.getBoundingClientRect();
    track.dispatchEvent(pointer('pointerdown', rect.left + 10, track));
    track.dispatchEvent(pointer('pointerup', rect.left + 10, track));
    expect(harness.play).not.toHaveBeenCalled();
    expect(harness.pause).not.toHaveBeenCalled();
  });
});

describe('the track as a slider', () => {
  test('arrows step, Home and End jump, and every key reports an interaction', () => {
    const track = harness.shell.roots.byName('tour-track');
    harness.bar.setProgress({ fraction: 0.5, elapsed: 5, duration: 10, speed: 1 } as TourProgress);
    const press = (key: string, shiftKey = false): void => {
      track.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    };
    press('ArrowRight');
    press('ArrowLeft');
    press('ArrowRight', true);
    press('Home');
    press('End');
    const seeks = harness.seek.mock.calls.map((call) => call[0] as number);
    expect(seeks[0]!).toBeCloseTo(0.52, 5);
    expect(seeks[1]!).toBeCloseTo(0.48, 5);
    expect(seeks[2]!).toBeCloseTo(0.6, 5);
    expect(seeks[3]!).toBe(0);
    expect(seeks[4]!).toBe(1);
    expect(harness.onInteraction).toHaveBeenCalledTimes(5);
  });

  test('Space on the track toggles playback rather than seeking', () => {
    const track = harness.shell.roots.byName('tour-track');
    track.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(harness.toggle).toHaveBeenCalledTimes(1);
    expect(harness.seek).not.toHaveBeenCalled();
  });

  test('a key the slider does not use is left to the page', () => {
    const track = harness.shell.roots.byName('tour-track');
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    track.dispatchEvent(event);
    expect(harness.seek).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test('aria-valuenow follows the reported progress', () => {
    harness.bar.setProgress({ fraction: 0.375, elapsed: 3, duration: 8, speed: 1 } as TourProgress);
    expect(harness.shell.roots.byName('tour-track').getAttribute('aria-valuenow')).toBe('0.3750');
  });
});

describe('what the bar reports', () => {
  test('the play button toggles and reports an interaction', () => {
    harness.shell.roots.byName<HTMLButtonElement>('tour-play').click();
    expect(harness.toggle).toHaveBeenCalledTimes(1);
    expect(harness.onInteraction).toHaveBeenCalledTimes(1);
  });

  test('setState stamps data-state, relabels the pill and tells the owner', () => {
    for (const state of ['ready', 'playing', 'paused', 'ended'] as TourState[]) {
      harness.bar.setState(state);
      expect(harness.shell.roots.byName('tour-status').dataset['state']).toBe(state);
      expect(harness.shell.roots.byName('tour-bar').dataset['state']).toBe(state);
    }
    expect(harness.onState.mock.calls.map((call) => call[0])).toEqual(['ready', 'playing', 'paused', 'ended']);
    // `ready` is the one state with nothing to show.
    harness.bar.setState('ready');
    expect(harness.shell.roots.byName('tour-status').classList.contains('is-hidden')).toBe(true);
  });

  test('setProgress writes mm:ss / mm:ss and drives the CSS progress variable', () => {
    harness.bar.setState('playing');
    harness.bar.setProgress({ fraction: 0.25, elapsed: 65, duration: 260, speed: 1 } as TourProgress);
    expect(harness.shell.roots.byName('tour-status-progress').textContent).toBe('01:05 / 04:20');
    expect(harness.shell.roots.byName('tour-bar').style.getPropertyValue('--tour-progress')).toBe('0.25');
  });

  test('the bar is on screen only when enabled, in the tour, and not ready', () => {
    const bar = harness.shell.roots.byName('tour-bar');
    harness.bar.setState('playing');
    expect(bar.dataset['visible']).toBe('true');
    harness.bar.setEnabled(false);
    expect(bar.dataset['visible']).toBe('false');
    harness.bar.setEnabled(true);
    harness.bar.setState('ready');
    expect(bar.dataset['visible']).toBe('false');
  });

  test('the tour chrome is on screen only while the mode is Tour, whatever the clip is doing', () => {
    // A reported bug: leaving the tour pauses the clip, and a paused
    // clip kept the bar and the pill up in 360 and Walk.
    const bar = harness.shell.roots.byName('tour-bar');
    const pill = harness.shell.roots.byName('tour-status');
    for (const state of ['playing', 'paused', 'ended'] as TourState[]) {
      harness.bar.setState(state);
      for (const mode of ['plan2d', 'plan3d', 'orbit', 'walk'] as ViewerMode[]) {
        harness.mode.value = mode;
        harness.bar.refresh();
        expect({ state, mode, bar: bar.dataset['visible'], pill: pill.classList.contains('is-hidden') }).toEqual({
          state,
          mode,
          bar: 'false',
          pill: true,
        });
      }
      harness.mode.value = 'tour';
      harness.bar.refresh();
      expect({ state, bar: bar.dataset['visible'], pill: pill.classList.contains('is-hidden') }).toEqual({
        state,
        bar: 'true',
        pill: false,
      });
    }
  });

  test('a paused run keeps the bar awake after the rest of the chrome collapses', () => {
    const bar = harness.shell.roots.byName('tour-bar');
    harness.collapsed.value = true;
    harness.bar.setState('playing');
    expect(bar.classList.contains('is-collapsed')).toBe(true);
    harness.bar.setState('paused');
    expect(bar.classList.contains('is-collapsed')).toBe(false);
  });

  test('setStatusEnabled(false) hides the pill even while the clip is running (chrome.status)', () => {
    harness.bar.setState('playing');
    expect(harness.shell.roots.byName('tour-status').classList.contains('is-hidden')).toBe(false);
    harness.bar.setStatusEnabled(false);
    expect(harness.shell.roots.byName('tour-status').classList.contains('is-hidden')).toBe(true);
    // The state itself keeps advancing and stays machine-readable.
    harness.bar.setState('paused');
    expect(harness.shell.roots.byName('tour-status').dataset['state']).toBe('paused');
    expect(harness.shell.roots.byName('tour-status').classList.contains('is-hidden')).toBe(true);
    harness.bar.setStatusEnabled(true);
    expect(harness.shell.roots.byName('tour-status').classList.contains('is-hidden')).toBe(false);
  });

  test('the speed button shows the setting and cycles 1x → 2x → 0.5x → 1x', () => {
    const button = harness.shell.roots.byName<HTMLButtonElement>('tour-speed');
    harness.bar.setState('playing');
    const seen: string[] = [];
    let speed: 0.5 | 1 | 2 = 1;
    harness.setSpeed.mockImplementation((next: 0.5 | 1 | 2) => {
      speed = next;
    });
    for (let click = 0; click < 4; click += 1) {
      harness.bar.setProgress({ fraction: 0.25, elapsed: 4, duration: 16, speed } as TourProgress);
      seen.push(`${button.textContent} ${button.getAttribute('aria-label')}`);
      button.click();
    }
    expect(seen).toEqual(['1x Tour speed 1x', '2x Tour speed 2x', '0.5x Tour speed 0.5x', '1x Tour speed 1x']);
    expect(harness.setSpeed.mock.calls.map((call) => call[0])).toEqual([2, 0.5, 1, 2]);
    expect(harness.onInteraction).toHaveBeenCalledTimes(4);
  });

  test('the times of the pill run on the wall clock of the speed setting', () => {
    harness.bar.setState('playing');
    harness.bar.setProgress({ fraction: 0.25, elapsed: 65, duration: 260, speed: 2 } as TourProgress);
    expect(harness.shell.roots.byName('tour-status-progress').textContent).toBe('00:32 / 02:10');
  });

  test('retranslate re-renders the play button’s label from the new catalogue', () => {
    harness.bar.setState('playing');
    const before = harness.shell.roots.byName('tour-play').getAttribute('aria-label');
    harness.bar.retranslate(createMessages('ru'));
    expect(harness.shell.roots.byName('tour-play').getAttribute('aria-label')).toBe(createMessages('ru').t('tour.bar.pause'));
    expect(typeof before).toBe('string');
  });
});
