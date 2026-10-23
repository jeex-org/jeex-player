/**
 * The boot policy, tested where it is pure.
 *
 * `nextFrame` is the one piece of the boot that can HANG: a viewer mounted in a
 * tab that is never painted never gets a frame, and before it took the mount's
 * signal `dispose()` could not break the await.
 * `applyStartView` is the opening-mode decision table.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyStartView, firstPicture, loadWithNoiseTiles, nextFrame } from './viewer-boot.js';
import { TextureCache } from '../materials/texture-cache.js';
import { ViewerDisposedError } from './viewer-context.js';
import { DEFAULT_VIEWER_OPTIONS, type ViewerOptions } from './viewer-options.js';
import type { ViewerMode } from '../scene/types.js';

type Frame = () => void;

/**
 * Installs a global for the duration of a test and puts the environment back
 * exactly as it was.
 *
 * `globalThis.x = undefined` is NOT the same as no `x` at all: another test
 * file probing `'window' in globalThis` would then find one and skip its own
 * setup, and Bun runs every file in one process.
 */
function stubGlobal(name: string, value: unknown): () => void {
  const had = name in globalThis;
  const previous = Reflect.get(globalThis, name);
  Reflect.set(globalThis, name, value);
  return () => {
    if (had) Reflect.set(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  };
}

let restore: Array<() => void> = [];

/** Frames scheduled and not yet run, keyed by the handle `nextFrame` holds. */
let frames = new Map<number, Frame>();
let cancelled: number[] = [];
let nextHandle = 0;

beforeEach(() => {
  frames = new Map();
  cancelled = [];
  nextHandle = 0;
  restore = [
    stubGlobal('requestAnimationFrame', (callback: Frame): number => {
      nextHandle += 1;
      frames.set(nextHandle, callback);
      return nextHandle;
    }),
    stubGlobal('cancelAnimationFrame', (handle: number): void => {
      cancelled.push(handle);
      frames.delete(handle);
    }),
  ];
});

afterEach(() => {
  for (const undo of restore.reverse()) undo();
});

/** Runs every frame currently scheduled. */
function paint(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const frame of pending) frame();
}

describe('nextFrame', () => {
  test('resolves on the next painted frame', async () => {
    const controller = new AbortController();
    const waiting = nextFrame(controller.signal);
    paint();
    await waiting;
    expect(cancelled).toEqual([]);
  });

  test('a signal aborted while waiting rejects and cancels the frame', async () => {
    const controller = new AbortController();
    const waiting = nextFrame(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(ViewerDisposedError);
    expect(cancelled).toEqual([1]);
  });

  test('a signal that is already aborted rejects without scheduling anything', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(nextFrame(controller.signal)).rejects.toBeInstanceOf(ViewerDisposedError);
    expect(frames.size).toBe(0);
  });

  test('a resolved wait leaves no handler on the signal', async () => {
    const controller = new AbortController();
    const waiting = nextFrame(controller.signal);
    paint();
    await waiting;
    // Aborting afterwards must not cancel a frame that no longer exists — the
    // resolved case unbinds itself, so a long-lived viewer does not pile up one
    // abort handler per frame it ever waited for.
    controller.abort();
    expect(cancelled).toEqual([]);
  });
});

describe('firstPicture', () => {
  test('waits for the owed first picture, then for the frame after it', async () => {
    const controller = new AbortController();
    let draw: () => void = () => undefined;
    const picture = new Promise<void>((resolve) => {
      draw = resolve;
    });
    let done = false;
    const waiting = firstPicture(controller.signal, picture).then(() => (done = true));
    paint();
    await Promise.resolve();
    expect(done).toBe(false);
    draw();
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    expect(done).toBe(false);
    paint();
    await waiting;
    expect(done).toBe(true);
  });

  test('without a picture owed it is one frame; disposal while waiting rejects', async () => {
    const plain = firstPicture(new AbortController().signal, undefined);
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    paint();
    await plain;
    const controller = new AbortController();
    const waiting = firstPicture(controller.signal, new Promise<void>(() => {}));
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(ViewerDisposedError);
  });
});

/** The bits of `ViewerUI` and `TourControls` the start view drives. */
function startHarness(overrides: Partial<ViewerOptions>) {
  const calls: string[] = [];
  const options: ViewerOptions = { ...DEFAULT_VIEWER_OPTIONS, ...overrides };
  applyStartView({
    options,
    ui: {
      setLoading: () => calls.push('loading'),
      setModeButtons: (mode: ViewerMode) => calls.push(`buttons:${mode}`),
      setHintForMode: (mode: ViewerMode) => calls.push(`hint:${mode}`),
    },
    tour: {
      seek: (fraction: number) => calls.push(`seek:${fraction}`),
      play: () => calls.push('play'),
    } as never,
    setMode: (mode) => calls.push(`setMode:${mode}`),
    engageTour: () => calls.push('engage'),
  });
  return calls;
}

describe('applyStartView', () => {
  test('a non-tour mode only switches the camera, never the clip', () => {
    const calls = startHarness({ view: { ...DEFAULT_VIEWER_OPTIONS.view, mode: 'walk' } });
    expect(calls).toEqual(['buttons:walk', 'hint:walk', 'setMode:walk']);
  });

  test('orbit is the resting mode and needs no switch', () => {
    const calls = startHarness({ view: { ...DEFAULT_VIEWER_OPTIONS.view, mode: 'orbit' } });
    expect(calls).toEqual(['buttons:orbit', 'hint:orbit']);
  });

  test('view tour with tour off engages the mode without starting the clip', () => {
    const calls = startHarness({
      view: { ...DEFAULT_VIEWER_OPTIONS.view, mode: 'tour' },
      tour: { ...DEFAULT_VIEWER_OPTIONS.tour, mode: 'off' },
    });
    expect(calls).toEqual(['buttons:tour', 'hint:tour', 'engage']);
  });

  test('view tour with tour play seeks to the start and then plays', () => {
    const calls = startHarness({
      view: { ...DEFAULT_VIEWER_OPTIONS.view, mode: 'tour' },
      tour: { ...DEFAULT_VIEWER_OPTIONS.tour, mode: 'play', start: 0.25 },
    });
    expect(calls).toEqual(['buttons:tour', 'hint:tour', 'seek:0.25', 'play']);
  });

  test('view tour with tour paused places the camera and stops there', () => {
    const calls = startHarness({
      view: { ...DEFAULT_VIEWER_OPTIONS.view, mode: 'tour' },
      tour: { ...DEFAULT_VIEWER_OPTIONS.tour, mode: 'paused', start: 0 },
    });
    expect(calls).toEqual(['buttons:tour', 'hint:tour', 'seek:0']);
  });
});

describe('loadWithNoiseTiles', () => {
  /** A cached canvas, another holder that comes and goes, and what is left of the canvas before and after the dispose. */
  async function holdAcross(load: Promise<string>): Promise<{ beforeDispose: unknown; afterDispose: unknown }> {
    const cache = new TextureCache();
    const controller = new AbortController();
    const canvas = {} as HTMLCanvasElement;
    await loadWithNoiseTiles(load, controller.signal, cache).catch(() => undefined);
    cache.putCanvas('tile', canvas);
    // Another holder (a sibling viewer's renderer) comes and goes; without the
    // viewer's own hold its release would empty the cache.
    cache.retain();
    cache.release();
    const beforeDispose = cache.canvas('tile');
    controller.abort();
    return { beforeDispose, afterDispose: cache.canvas('tile') };
  }

  test("answers the load's own value", async () => {
    expect(await loadWithNoiseTiles(Promise.resolve('document'), new AbortController().signal, new TextureCache())).toBe('document');
  });

  test('holds the texture cache from the load until the viewer is disposed', async () => {
    const { beforeDispose, afterDispose } = await holdAcross(Promise.resolve('document'));
    expect(beforeDispose).not.toBeNull();
    expect(afterDispose).toBeNull();
  });

  test('a load that fails still holds the cache until the dispose', async () => {
    const { beforeDispose, afterDispose } = await holdAcross(Promise.reject(new Error('scene-load')));
    expect(beforeDispose).not.toBeNull();
    expect(afterDispose).toBeNull();
  });
});
