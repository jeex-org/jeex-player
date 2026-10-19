/**
 * Who may write `__viewerDebug` / `__appReady` / `__viewerReadyAt`, and when.
 *
 * The claim is re-taken in `init()`, which is what these cases pin. A claim
 * decided once at construction would let a viewer that had released the
 * globals go on believing it owned them: after a Retry it would write
 * `__appReady` without holding the claim, over whatever had taken it in the
 * meantime.
 *
 * The claim registry (`viewer-globals.ts`) has no test file of its own: this
 * class is its only caller, so its contract (first claim wins, a repeat claim
 * is a no-op, only the owner releases, releasing twice is harmless) is proved
 * here, through the path production takes.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ViewerPageGlobals } from './viewer-page-globals.js';

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

beforeEach(() => {
  restore = [stubGlobal('window', {}), stubGlobal('performance', { now: () => 42 })];
});

afterEach(() => {
  for (const undo of restore.reverse()) undo();
});

/** The `window` the code under test is writing to, as a plain record. */
function pageWindow(): Record<string, unknown> {
  return (globalThis as unknown as { window: Record<string, unknown> }).window;
}

describe('ViewerPageGlobals', () => {
  test('the first claimant may write; a second viewer may not', () => {
    const first = new ViewerPageGlobals({});
    const second = new ViewerPageGlobals({});
    expect(first.claim()).toBe(true);
    expect(second.claim()).toBe(false);
    first.publishReady();
    second.publishReady();
    expect(pageWindow()['__appReady']).toBe(true);
    expect(pageWindow()['__viewerReadyAt']).toBe(42);
    first.release();
  });

  test('release takes the globals down and hands the claim back', () => {
    const owner = new ViewerPageGlobals({});
    owner.claim();
    owner.publishReady();
    owner.release();
    expect(pageWindow()['__appReady']).toBe(false);
    expect('__viewerReadyAt' in pageWindow()).toBe(false);
    const next = new ViewerPageGlobals({});
    expect(next.claim()).toBe(true);
    next.release();
  });

  test('a repeat claim by the owner is a no-op, not a refusal', () => {
    const owner = new ViewerPageGlobals({});
    expect(owner.claim()).toBe(true);
    expect(owner.claim()).toBe(true);
    expect(new ViewerPageGlobals({}).claim()).toBe(false);
    owner.release();
  });

  test('releasing twice is harmless and leaves the claim free', () => {
    const owner = new ViewerPageGlobals({});
    owner.claim();
    owner.release();
    owner.release();
    expect(pageWindow()['__appReady']).toBe(false);
    const next = new ViewerPageGlobals({});
    expect(next.claim()).toBe(true);
    next.release();
  });

  test('a released instance can claim again — the Retry path', () => {
    const owner = new ViewerPageGlobals({});
    owner.claim();
    owner.release();
    expect(owner.owns).toBe(false);
    expect(owner.claim()).toBe(true);
    owner.publishReady();
    expect(pageWindow()['__appReady']).toBe(true);
    owner.release();
  });

  test('a non-owner releasing changes nothing at all', () => {
    const owner = new ViewerPageGlobals({});
    const other = new ViewerPageGlobals({});
    owner.claim();
    other.claim();
    owner.publishReady();
    other.release();
    expect(pageWindow()['__appReady']).toBe(true);
    expect(owner.owns).toBe(true);
    expect(new ViewerPageGlobals({}).claim()).toBe(false);
    owner.release();
  });

  test('a non-owner installs no debug surface', () => {
    const owner = new ViewerPageGlobals({});
    const other = new ViewerPageGlobals({});
    owner.claim();
    other.claim();
    let read = 0;
    // The host is a bag of GETTERS now, so "installed nothing" is checked by
    // whether any of them was ever called.
    other.installDebug({ model: () => (read += 1) as never } as never);
    expect(read).toBe(0);
    expect('__viewerDebug' in pageWindow()).toBe(false);
    owner.release();
  });
});
