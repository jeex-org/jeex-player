/**
 * The one place `matchMedia` is read for reduced motion, and the pure fold
 * over `motion` + the environment that decides whether scripted travel is
 * instant. `viewer-options.test.ts` covers the `tour.mode` downgrade this
 * feeds; this file covers the environment read and the live subscription.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { prefersReducedMotion, resolveMotionInstant, watchMotion } from './motion-wiring.js';

/**
 * Installs a global for the duration of a test and puts the environment back
 * exactly as it was — `globalThis.x = undefined` is not the same as no `x` at
 * all, and Bun runs every file in one process.
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

/**
 * A `MediaQueryList` stub that remembers its one listener and can fire it,
 * and honours `{ signal }` the real `EventTarget.addEventListener` way: an
 * abort on the given signal drops the listener, whichever came first.
 */
function stubMediaQuery(initialMatches: boolean): { matchMedia: (query: string) => unknown; fire: (matches: boolean) => void } {
  let listener: ((event: { matches: boolean }) => void) | undefined;
  let matches = initialMatches;
  const query = {
    get matches() {
      return matches;
    },
    addEventListener: (type: string, callback: (event: { matches: boolean }) => void, options?: { signal?: AbortSignal }) => {
      if (type !== 'change') return;
      listener = callback;
      options?.signal?.addEventListener('abort', () => {
        listener = undefined;
      });
    },
  };
  return {
    matchMedia: () => query,
    fire: (next: boolean) => {
      matches = next;
      listener?.({ matches });
    },
  };
}

let restore: Array<() => void> = [];

afterEach(() => {
  for (const undo of restore.reverse()) undo();
  restore = [];
});

describe('resolveMotionInstant', () => {
  test('reduced is always instant', () => {
    expect(resolveMotionInstant('reduced', false)).toBe(true);
    expect(resolveMotionInstant('reduced', true)).toBe(true);
  });

  test('full is never instant', () => {
    expect(resolveMotionInstant('full', false)).toBe(false);
    expect(resolveMotionInstant('full', true)).toBe(false);
  });

  test('auto follows the environment', () => {
    expect(resolveMotionInstant('auto', false)).toBe(false);
    expect(resolveMotionInstant('auto', true)).toBe(true);
  });
});

describe('prefersReducedMotion', () => {
  test('is false where matchMedia does not exist, never throws', () => {
    restore.push(stubGlobal('matchMedia', undefined));
    expect(prefersReducedMotion()).toBe(false);
  });

  test('reads matchMedia(...).matches when it does exist', () => {
    const stub = stubMediaQuery(true);
    restore.push(stubGlobal('matchMedia', stub.matchMedia));
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('watchMotion', () => {
  beforeEach(() => {
    restore = [];
  });

  test('reports the resolved value once, synchronously, on install', () => {
    restore.push(stubGlobal('matchMedia', undefined));
    const seen: boolean[] = [];
    const controller = new AbortController();
    watchMotion({ motion: 'reduced', signal: controller.signal, onChange: (instant) => seen.push(instant) });
    expect(seen).toEqual([true]);
  });

  test("motion: 'auto' subscribes and reports every later change", () => {
    const stub = stubMediaQuery(false);
    restore.push(stubGlobal('matchMedia', stub.matchMedia));
    const seen: boolean[] = [];
    const controller = new AbortController();
    watchMotion({ motion: 'auto', signal: controller.signal, onChange: (instant) => seen.push(instant) });
    expect(seen).toEqual([false]);
    stub.fire(true);
    expect(seen).toEqual([false, true]);
    stub.fire(false);
    expect(seen).toEqual([false, true, false]);
  });

  test("motion: 'full' and 'reduced' never subscribe: only the one report", () => {
    const stub = stubMediaQuery(true);
    restore.push(stubGlobal('matchMedia', stub.matchMedia));
    const full: boolean[] = [];
    const reduced: boolean[] = [];
    const controller = new AbortController();
    watchMotion({ motion: 'full', signal: controller.signal, onChange: (instant) => full.push(instant) });
    watchMotion({ motion: 'reduced', signal: controller.signal, onChange: (instant) => reduced.push(instant) });
    stub.fire(false);
    expect(full).toEqual([false]);
    expect(reduced).toEqual([true]);
  });

  test('an aborted signal stops later reports', () => {
    const stub = stubMediaQuery(false);
    restore.push(stubGlobal('matchMedia', stub.matchMedia));
    const seen: boolean[] = [];
    const controller = new AbortController();
    watchMotion({ motion: 'auto', signal: controller.signal, onChange: (instant) => seen.push(instant) });
    controller.abort();
    stub.fire(true);
    expect(seen).toEqual([false]);
  });
});
