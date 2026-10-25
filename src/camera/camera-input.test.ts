/**
 * The gesture normaliser, driven by fake event targets.
 *
 * Nothing here is about the camera: it is about what the BROWSER said and what
 * the modes are told it meant. The quirks pinned here — Firefox's wheel lines
 * and its shift+wheel axis rewrite, a pinch's stray `deltaX`, a two-finger pan
 * firing once per finger — each cost a bug report before they were normalised.
 */

import { describe, expect, test } from 'bun:test';
import {
  CameraInput,
  TYPING_SELECTOR,
  isTypingTarget,
  keyDirection,
  shiftWheel,
  wheelPixels,
  type CameraGesture,
  type CameraGestureSink,
} from './camera-input.js';
import { CAMERA_TUNING } from './camera-tuning.js';
import { fakeCanvas, type FakeCanvas } from '../fixtures/stubs.js';

type Rig = {
  canvas: FakeCanvas;
  keys: FakeCanvas;
  input: CameraInput;
  seen: CameraGesture[];
  /** Types only, in order — the shape most assertions are about. */
  types: () => string[];
  of: <T extends CameraGesture['type']>(type: T) => Extract<CameraGesture, { type: T }>[];
};

function rig(sink: CameraGestureSink = () => false, interaction?: 'full' | 'passive', ownsWheel?: () => boolean): Rig {
  const canvas = fakeCanvas();
  const keys = fakeCanvas();
  const seen: CameraGesture[] = [];
  const input = new CameraInput(
    { canvas: canvas as unknown as HTMLElement, keys: keys as unknown as HTMLElement, interaction, ownsWheel },
    (gesture) => {
      seen.push(gesture);
      return sink(gesture);
    },
  );
  return {
    canvas,
    keys,
    input,
    seen,
    types: () => seen.map((gesture) => gesture.type),
    of: (type) => seen.filter((gesture) => gesture.type === type) as never,
  };
}

/** A wheel event with the fields the handler reads, defaults for the rest (the pointer mid-canvas). */
function wheelEvent(init: Partial<WheelEvent> & { prevented?: { count: number } } = {}): unknown {
  const prevented = init.prevented ?? { count: 0 };
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    clientX: 400,
    clientY: 300,
    shiftKey: false,
    ctrlKey: false,
    ...init,
    preventDefault: () => {
      prevented.count += 1;
    },
  };
}

describe('listeners', () => {
  test('pointer and wheel go to the canvas, keys to the key target', () => {
    const built = rig();
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'pointerleave',
      'click',
      'wheel',
      'dblclick',
      'contextmenu',
    ]) {
      expect(built.canvas.count(type)).toBe(1);
    }
    for (const type of ['keydown', 'keyup', 'blur']) {
      expect(built.keys.count(type)).toBe(1);
      expect(built.canvas.count(type)).toBe(0);
    }
  });

  test('dispose releases every one of them', () => {
    const built = rig();
    built.input.dispose();
    const total = [...built.canvas.listeners.values(), ...built.keys.listeners.values()].reduce((sum, set) => sum + set.size, 0);
    expect(total).toBe(0);
  });
});

describe('pointer gestures', () => {
  test('a press reports the button and the shift the gesture started with, and whether it moves', () => {
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 10, clientY: 10, button: 0, shiftKey: false });
    built.canvas.fire('pointerup', { pointerId: 1 });
    built.canvas.fire('pointerdown', { pointerId: 2, clientX: 10, clientY: 10, button: 2, shiftKey: false });
    built.canvas.fire('pointerup', { pointerId: 2 });
    built.canvas.fire('pointerdown', { pointerId: 3, clientX: 10, clientY: 10, button: 0, shiftKey: true });
    expect(built.of('press')).toEqual([
      { type: 'press', button: 'primary', shift: false, move: false },
      { type: 'press', button: 'secondary', shift: false, move: true },
      { type: 'press', button: 'primary', shift: true, move: true },
    ]);
    expect(built.canvas.captured).toEqual([1, 2, 3]);
  });

  test('a shift released mid-drag does not change what the drag is', () => {
    // `button` is -1 and `shiftKey` false on a plain pointermove in some
    // browsers; reading them per move turned a pan into a rotation halfway.
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0, shiftKey: true });
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 140, clientY: 100, shiftKey: false });
    expect(built.of('press')[0]!.shift).toBe(true);
    expect(built.of('drag')[0]).toEqual({ type: 'drag', dx: 40, dy: 0, pointers: 1, centroid: null });
  });

  test('a single-pointer move is one drag of that pointer, with no centroid', () => {
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 130, clientY: 80 });
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 130, clientY: 90 });
    expect(built.of('drag')).toEqual([
      { type: 'drag', dx: 30, dy: -20, pointers: 1, centroid: null },
      { type: 'drag', dx: 0, dy: 10, pointers: 1, centroid: null },
    ]);
  });

  test('a move from an untracked pointer is a hover, and only with nothing down', () => {
    const built = rig();
    built.canvas.fire('pointermove', { pointerId: 9, clientX: 12, clientY: 34 });
    expect(built.of('hover')).toEqual([{ type: 'hover', x: 12, y: 34 }]);
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    built.canvas.fire('pointermove', { pointerId: 9, clientX: 20, clientY: 40 });
    expect(built.of('hover')).toHaveLength(1);
    expect(built.types()).not.toContain('leave');
    built.canvas.fire('pointerleave', {});
    expect(built.types().at(-1)).toBe('leave');
  });

  test('two fingers report their separation and the movement of their midpoint', () => {
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 300, clientY: 300, button: 0 });
    built.canvas.fire('pointerdown', { pointerId: 2, clientX: 400, clientY: 300, button: 0 });
    // First move seeds the centroid: there is nothing yet to measure it against.
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 300, clientY: 300 });
    expect(built.of('drag')[0]!.centroid).toBeNull();
    // Both fingers slide 40 px right: the midpoint moves 40, not 80.
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 340, clientY: 300 });
    built.canvas.fire('pointermove', { pointerId: 2, clientX: 440, clientY: 300 });
    const centroids = built
      .of('drag')
      .slice(1)
      .map((drag) => drag.centroid!.dx);
    expect(centroids.reduce((sum, dx) => sum + dx, 0)).toBeCloseTo(40, 6);
    for (const drag of built.of('drag')) expect(drag.pointers).toBe(2);
  });

  test('fingers spreading scale a distance down, closing scale it up', () => {
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 300, clientY: 300, button: 0 });
    built.canvas.fire('pointerdown', { pointerId: 2, clientX: 400, clientY: 300, button: 0 });
    built.canvas.fire('pointermove', { pointerId: 2, clientX: 500, clientY: 300 });
    // 100 px apart became 200: a radius that follows the fingers halves.
    expect(built.of('pinch')[0]!.scale).toBeCloseTo(0.5, 6);
    built.canvas.fire('pointermove', { pointerId: 2, clientX: 400, clientY: 300 });
    expect(built.of('pinch')[1]!.scale).toBeCloseTo(2, 6);
  });

  test('a pinch names the point between the two fingers, for the zoom to close in on', () => {
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 300, clientY: 200, button: 0 });
    built.canvas.fire('pointerdown', { pointerId: 2, clientX: 400, clientY: 300, button: 0 });
    built.canvas.fire('pointermove', { pointerId: 2, clientX: 500, clientY: 400 });
    // The midpoint AFTER the move: the scene point the fingers now frame.
    expect(built.of('pinch')[0]).toMatchObject({ x: 400, y: 300 });
  });

  test('a finger leaving is a release, and the centroid starts again', () => {
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 300, clientY: 300, button: 0 });
    built.canvas.fire('pointerdown', { pointerId: 2, clientX: 400, clientY: 300, button: 0 });
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 310, clientY: 300 });
    built.canvas.fire('pointercancel', { pointerId: 2 });
    expect(built.types().at(-1)).toBe('release');
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 320, clientY: 300 });
    expect(built.of('drag').at(-1)).toEqual({ type: 'drag', dx: 10, dy: 0, pointers: 1, centroid: null });
  });

  test('a click that moved is a drag ending, not a tap — and the next one taps', () => {
    const built = rig();
    const far = CAMERA_TUNING.pointer.dragThresholdPx + 5;
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 100 + far, clientY: 100 });
    built.canvas.fire('pointerup', { pointerId: 1 });
    built.canvas.fire('click', { clientX: 100 + far, clientY: 100 });
    expect(built.of('tap')).toHaveLength(0);
    built.canvas.fire('click', { clientX: 100, clientY: 100 });
    expect(built.of('tap')).toHaveLength(1);
  });

  test('a press that barely moved still taps, and carries when it happened', () => {
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 101, clientY: 100 });
    built.canvas.fire('pointerup', { pointerId: 1 });
    const before = performance.now();
    built.canvas.fire('click', { clientX: 101, clientY: 100 });
    const tap = built.of('tap')[0]!;
    expect(tap.x).toBe(101);
    expect(tap.at).toBeGreaterThanOrEqual(before);
    expect(tap.at).toBeLessThanOrEqual(performance.now());
  });

  test('the second click of a double click is a repeat tap; a single or synthetic click is not', () => {
    const built = rig();
    built.canvas.fire('click', { clientX: 10, clientY: 10, detail: 1 });
    built.canvas.fire('click', { clientX: 10, clientY: 10, detail: 2 });
    built.canvas.fire('click', { clientX: 10, clientY: 10 });
    expect(built.of('tap').map((tap) => tap.repeat)).toEqual([false, true, false]);
  });

  test('a double click is its own gesture, at its own point', () => {
    const built = rig();
    built.canvas.fire('dblclick', { clientX: 55, clientY: 66 });
    expect(built.of('double-tap')).toEqual([{ type: 'double-tap', x: 55, y: 66 }]);
  });

  test('reset forgets an in-flight gesture without detaching', () => {
    const built = rig();
    built.canvas.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    built.input.reset();
    built.canvas.fire('pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
    // The pointer is unknown again, so its move is a hover, not a 100 px drag.
    expect(built.of('drag')).toHaveLength(0);
    expect(built.of('hover')).toHaveLength(1);
  });
});

describe('wheel classification: one gesture, one effect', () => {
  test('a dominant deltaX pans with the fingers and never zooms', () => {
    const built = rig();
    // Natural scrolling: fingers LEFT arrive as `deltaX > 0`, and a pan speaks
    // pointer pixels, so the sign is flipped exactly once, here.
    built.canvas.fire('wheel', wheelEvent({ deltaX: 60, deltaY: 20 }));
    expect(built.of('pan')).toEqual([{ type: 'pan', dx: -60, dy: -20 }]);
    expect(built.of('zoom')).toHaveLength(0);
  });

  test('a dominant deltaY zooms and never pans', () => {
    const built = rig();
    built.canvas.fire('wheel', wheelEvent({ deltaX: 5, deltaY: -80 }));
    expect(built.of('zoom')).toEqual([{ type: 'zoom', dy: -80, x: 400, y: 300 }]);
    expect(built.of('pan')).toHaveLength(0);
  });

  test('a zoom names the pointer it happened under (zoom toward the point under the cursor)', () => {
    const built = rig();
    built.canvas.fire('wheel', wheelEvent({ deltaY: -80, clientX: 612, clientY: 144 }));
    expect(built.of('zoom')).toEqual([{ type: 'zoom', dy: -80, x: 612, y: 144 }]);
  });

  test('a pinch zooms only, however much stray deltaX it rolled with', () => {
    const built = rig();
    built.canvas.fire('wheel', wheelEvent({ deltaX: 120, deltaY: -12, ctrlKey: true }));
    expect(built.of('zoom')).toEqual([{ type: 'zoom', dy: -12, x: 400, y: 300 }]);
    expect(built.of('pan')).toHaveLength(0);
  });

  test('a shift wheel pans vertically, on Firefox too', () => {
    const chromium = rig();
    chromium.canvas.fire('wheel', wheelEvent({ deltaY: 40, shiftKey: true }));
    expect(chromium.of('pan')).toEqual([{ type: 'pan', dx: -0, dy: -40 }]);

    // Firefox rewrites the same physical gesture onto deltaX with no deltaY.
    const firefox = rig();
    firefox.canvas.fire('wheel', wheelEvent({ deltaX: 40, shiftKey: true }));
    expect(firefox.of('pan')).toEqual([{ type: 'pan', dx: -0, dy: -40 }]);

    // A shift gesture that KEPT its deltaY is a genuine diagonal: untouched.
    const diagonal = rig();
    diagonal.canvas.fire('wheel', wheelEvent({ deltaX: 40, deltaY: 10, shiftKey: true }));
    expect(diagonal.of('pan')).toEqual([{ type: 'pan', dx: -40, dy: -10 }]);
  });

  test('lines and pages are read as pixels, not as pixels-worth-of-lines', () => {
    const lines = rig();
    lines.canvas.fire('wheel', wheelEvent({ deltaY: -3, deltaMode: 1 }));
    expect(lines.of('zoom')[0]!.dy).toBeCloseTo(-3 * CAMERA_TUNING.wheel.linePx, 6);

    const pages = rig();
    pages.canvas.fire('wheel', wheelEvent({ deltaY: 1, deltaMode: 2 }));
    // The canvas knows its own height, so a page is that height.
    expect(pages.of('zoom')[0]!.dy).toBeCloseTo(600, 6);
  });

  test('the page only stops scrolling when a mode says it consumed the wheel', () => {
    const ignored = rig(() => false);
    const preventedIgnored = { count: 0 };
    ignored.canvas.fire('wheel', wheelEvent({ deltaY: 40, prevented: preventedIgnored }));
    expect(preventedIgnored.count).toBe(0);

    const consumed = rig(() => true);
    const preventedConsumed = { count: 0 };
    consumed.canvas.fire('wheel', wheelEvent({ deltaY: 40, prevented: preventedConsumed }));
    expect(preventedConsumed.count).toBe(1);
  });

  test("interaction: 'passive' never prevents the wheel default, even when a mode consumed it", () => {
    const consumed = rig(() => true, 'passive');
    const prevented = { count: 0 };
    consumed.canvas.fire('wheel', wheelEvent({ deltaY: 40, prevented }));
    // Still zoomed — the gesture is unaffected, only the page's own scroll is left alone.
    expect(consumed.of('zoom')).toEqual([{ type: 'zoom', dy: 40, x: 400, y: 300 }]);
    expect(prevented.count).toBe(0);
  });

  test("interaction: 'passive' registers the wheel listener with { passive: true }; 'full' does not", () => {
    const passive = rig(() => false, 'passive');
    expect(passive.canvas.passive.get('wheel')).toBe(true);
    const full = rig(() => false, 'full');
    expect(full.canvas.passive.get('wheel')).toBe(false);
  });

  test('a context menu on the canvas is always suppressed', () => {
    const built = rig();
    const prevented = { count: 0 };
    built.canvas.fire('contextmenu', {
      preventDefault: () => {
        prevented.count += 1;
      },
    });
    expect(prevented.count).toBe(1);
    expect(built.seen).toHaveLength(0);
  });
});

describe('keys', () => {
  test('down and up are reported in lower case, and blur ends them all', () => {
    const built = rig();
    built.keys.fire('keydown', { key: 'W', preventDefault: () => undefined });
    built.keys.fire('keyup', { key: 'W' });
    built.keys.fire('blur', {});
    expect(built.seen).toEqual([{ type: 'key', code: 'w', down: true }, { type: 'key', code: 'w', down: false }, { type: 'blur' }]);
  });

  test('only a key a mode consumed stops the page scrolling', () => {
    const walking = rig((gesture) => gesture.type === 'key' && gesture.code === 'arrowup');
    const prevented = { count: 0 };
    const preventDefault = (): void => {
      prevented.count += 1;
    };
    walking.keys.fire('keydown', { key: 'ArrowUp', preventDefault });
    expect(prevented.count).toBe(1);
    walking.keys.fire('keydown', { key: 'Tab', preventDefault });
    expect(prevented.count).toBe(1);
  });
});

/**
 * A text field inside the viewer's root is unusable today, and that
 * is a BUG — every `w` typed into it also walks the camera. The guard reads
 * `composedPath()`, so it works through a shadow root and inside a host's own
 * slot content.
 */
describe('keys typed into host chrome', () => {
  /** A node that answers `matches` the way an `Element` would, for `selector`. */
  function node(selector: string | null): EventTarget {
    return { matches: (query: string) => query === selector } as unknown as EventTarget;
  }

  test('isTypingTarget: an empty path, a plain node, and a node that matches', () => {
    expect(isTypingTarget([])).toBe(false);
    expect(isTypingTarget([node(null)])).toBe(false);
    expect(isTypingTarget([node(TYPING_SELECTOR)])).toBe(true);
  });

  test('isTypingTarget ignores a path entry that is not an element at all', () => {
    // `composedPath()` ends with the document and the window; neither has
    // `matches`, and `instanceof Element` is not available under Bun.
    expect(isTypingTarget([{} as EventTarget, globalThis as unknown as EventTarget])).toBe(false);
  });

  test('a key typed into a field is no gesture and is not prevented — the field keeps it', () => {
    const built = rig();
    const prevented = { count: 0 };
    built.keys.fire('keydown', {
      key: 'w',
      composedPath: () => [node(TYPING_SELECTOR)],
      preventDefault: () => {
        prevented.count += 1;
      },
    });
    expect(built.seen).toHaveLength(0);
    expect(prevented.count).toBe(0);
  });

  test('a key typed inside a host SLOT is the same silence', () => {
    const built = rig();
    built.keys.fire('keydown', { key: 'w', composedPath: () => [node(TYPING_SELECTOR)], preventDefault: () => undefined });
    expect(built.seen).toHaveLength(0);
  });

  test('keyup from a field is ignored too, or the camera latches a key that never comes back', () => {
    const built = rig();
    built.keys.fire('keydown', { key: 'w', preventDefault: () => undefined });
    built.keys.fire('keyup', { key: 'w', composedPath: () => [node(TYPING_SELECTOR)] });
    expect(built.seen).toEqual([{ type: 'key', code: 'w', down: true }]);
  });

  /**
   * `contenteditable="false"` is how a host puts a NON-editable widget inside
   * editable page content, and the guard scans the whole composed path — so a
   * bare `[contenteditable]` would match that wrapper and silence every key
   * aimed at the camera. Only the selector TEXT can be
   * asserted here; that a real wrapper does not match it is proved in
   * `tests/component/host-slots.test.ts`, where there is a CSS engine.
   */
  test('the contenteditable clause excludes the OFF value', () => {
    expect(TYPING_SELECTOR).toContain('[contenteditable]:not([contenteditable="false"])');
  });

  test('the selector names the slot attribute, so anything a host renders in a box is covered', () => {
    expect(TYPING_SELECTOR).toContain('input');
    expect(TYPING_SELECTOR).toContain('[contenteditable]');
  });
});

describe('the wheel normalisers on their own', () => {
  test('wheelPixels leaves a pixel wheel alone', () => {
    expect(wheelPixels({ deltaX: 3, deltaY: -4, deltaMode: 0 } as WheelEvent, 600)).toEqual({ x: 3, y: -4 });
  });

  test('wheelPixels falls back to an assumed page when the canvas has no size', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 } as WheelEvent, 0)).toEqual({ x: 0, y: CAMERA_TUNING.wheel.pageFallbackPx });
  });

  test('shiftWheel only rewrites a shift gesture that lost its deltaY', () => {
    expect(shiftWheel({ x: 40, y: 0 }, true)).toEqual({ x: 0, y: 40 });
    expect(shiftWheel({ x: 40, y: 0 }, false)).toEqual({ x: 40, y: 0 });
    expect(shiftWheel({ x: 40, y: 3 }, true)).toEqual({ x: 40, y: 3 });
    expect(shiftWheel({ x: 0, y: 0 }, true)).toEqual({ x: 0, y: 0 });
  });
});

/**
 * Focus and embedding: Space held on the focused shell root makes the next
 * press a MOVE; anywhere
 * else it is the page's (and a focused button's) key.
 */
describe('the move modifier: Space held on the shell root', () => {
  /** A keydown of `key` aimed at `target`, counting `preventDefault` calls. */
  function keyEvent(key: string, target: unknown, prevented: { count: number } = { count: 0 }): unknown {
    return {
      key,
      target,
      preventDefault: () => {
        prevented.count += 1;
      },
    };
  }

  function press(built: Rig, init: { button?: number; shiftKey?: boolean } = {}): void {
    built.canvas.fire('pointerdown', {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      button: init.button ?? 0,
      shiftKey: init.shiftKey ?? false,
    });
    built.canvas.fire('pointerup', { pointerId: 1 });
  }

  test('Space on the root is taken (the page does not scroll) and the next press moves', () => {
    const built = rig();
    const prevented = { count: 0 };
    built.keys.fire('keydown', keyEvent(' ', built.keys, prevented));
    // Auto-repeat scrolls the page as well, so every repeat is taken too.
    built.keys.fire('keydown', keyEvent(' ', built.keys, prevented));
    expect(prevented.count).toBe(2);
    press(built);
    expect(built.of('press').at(-1)).toEqual({ type: 'press', button: 'primary', shift: false, move: true });
    // Space itself is a modifier, not a key any mode is told about.
    expect(built.of('key')).toHaveLength(0);
  });

  test('letting Space go ends the latch', () => {
    const built = rig();
    built.keys.fire('keydown', keyEvent(' ', built.keys));
    built.keys.fire('keyup', { key: ' ' });
    press(built);
    expect(built.of('press').at(-1)!.move).toBe(false);
  });

  test('losing focus ends the latch, the way it ends every held key', () => {
    const built = rig();
    built.keys.fire('keydown', keyEvent(' ', built.keys));
    built.keys.fire('blur', {});
    press(built);
    expect(built.of('press').at(-1)!.move).toBe(false);
  });

  test('Space on a focused button inside the root is left alone: the button must still be pressed', () => {
    const built = rig();
    const prevented = { count: 0 };
    const button = { tagName: 'BUTTON' };
    built.keys.fire('keydown', keyEvent(' ', button, prevented));
    expect(prevented.count).toBe(0);
    press(built);
    expect(built.of('press').at(-1)!.move).toBe(false);
  });

  test("interaction: 'passive' never takes Space", () => {
    const built = rig(() => false, 'passive');
    const prevented = { count: 0 };
    built.keys.fire('keydown', keyEvent(' ', built.keys, prevented));
    expect(prevented.count).toBe(0);
    press(built);
    expect(built.of('press').at(-1)!.move).toBe(false);
  });

  test('the cursor is told: move while Space or Shift is held, grabbing while a pointer is down', () => {
    const built = rig();
    expect(built.canvas.dataset).toEqual({ jeexMove: 'false', jeexDrag: 'false' });
    built.keys.fire('keydown', keyEvent(' ', built.keys));
    expect(built.canvas.dataset['jeexMove']).toBe('true');
    built.keys.fire('keyup', { key: ' ' });
    expect(built.canvas.dataset['jeexMove']).toBe('false');
    built.keys.fire('keydown', keyEvent('Shift', built.keys));
    expect(built.canvas.dataset['jeexMove']).toBe('true');
    built.keys.fire('keyup', { key: 'Shift' });
    expect(built.canvas.dataset['jeexMove']).toBe('false');
    built.canvas.fire('pointerdown', { pointerId: 4, clientX: 1, clientY: 1, button: 0, shiftKey: false });
    expect(built.canvas.dataset['jeexDrag']).toBe('true');
    built.canvas.fire('pointerup', { pointerId: 4 });
    expect(built.canvas.dataset['jeexDrag']).toBe('false');
  });
});

/**
 * Cooperative wheel: an unengaged viewer in a
 * scrolling page lets a plain wheel scroll the page and only Ctrl/⌘+wheel act.
 * What «engaged» means is `wheel-ownership.ts`'s question, proved against a
 * real page in `tests/component/wheel-ownership.test.ts`.
 */
describe('the wheel over a viewer that is not engaged', () => {
  test('a plain wheel goes to the page: nothing is prevented and the modes only hear scroll-through', () => {
    const built = rig(
      () => true,
      'full',
      () => false,
    );
    const prevented = { count: 0 };
    built.canvas.fire('wheel', wheelEvent({ deltaY: -80, prevented }));
    built.canvas.fire('wheel', wheelEvent({ deltaX: 80, prevented }));
    expect(prevented.count).toBe(0);
    expect(built.types()).toEqual(['scroll-through', 'scroll-through']);
  });

  test('Ctrl+wheel acts, and is taken so the browser does not zoom the page', () => {
    const built = rig(
      () => true,
      'full',
      () => false,
    );
    const prevented = { count: 0 };
    built.canvas.fire('wheel', wheelEvent({ deltaY: -80, ctrlKey: true, prevented }));
    expect(built.of('zoom')).toEqual([{ type: 'zoom', dy: -80, x: 400, y: 300 }]);
    expect(prevented.count).toBe(1);
  });

  test('⌘+wheel is the same gesture on a Mac: a zoom, never a pan', () => {
    const built = rig(
      () => true,
      'full',
      () => false,
    );
    built.canvas.fire('wheel', wheelEvent({ deltaX: 90, deltaY: -30, metaKey: true }));
    expect(built.of('zoom')).toEqual([{ type: 'zoom', dy: -30, x: 400, y: 300 }]);
    expect(built.of('pan')).toHaveLength(0);
  });

  test("interaction: 'passive' keeps its own contract: the gesture acts, the page scrolls too", () => {
    const built = rig(
      () => true,
      'passive',
      () => false,
    );
    const prevented = { count: 0 };
    built.canvas.fire('wheel', wheelEvent({ deltaY: -80, prevented }));
    expect(built.of('zoom')).toEqual([{ type: 'zoom', dy: -80, x: 400, y: 300 }]);
    expect(prevented.count).toBe(0);
  });

  test('an engaged viewer owns the plain wheel, exactly as before', () => {
    const built = rig(
      () => true,
      'full',
      () => true,
    );
    const prevented = { count: 0 };
    built.canvas.fire('wheel', wheelEvent({ deltaY: -80, prevented }));
    expect(built.of('zoom')).toEqual([{ type: 'zoom', dy: -80, x: 400, y: 300 }]);
    expect(prevented.count).toBe(1);
  });
});

describe('keyDirection', () => {
  test('forward and right from the held keys, arrows and letters alike, opposites cancelling', () => {
    expect(keyDirection(new Set(['w']))).toEqual({ forward: 1, right: 0 });
    expect(keyDirection(new Set(['arrowdown', 'd']))).toEqual({ forward: -1, right: 1 });
    expect(keyDirection(new Set(['a', 'arrowleft']))).toEqual({ forward: 0, right: -1 });
    expect(keyDirection(new Set(['w', 's', 'shift']))).toEqual({ forward: 0, right: 0 });
  });
});
