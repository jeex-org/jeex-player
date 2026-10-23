import { describe, expect, test } from 'bun:test';
import { FIRST_DRAW_BOUND_MS, FirstDrawGate, FirstDrawSignal } from './first-draw.js';

/** A hand-driven timer: `advance` fires what is due. */
function clock() {
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  return {
    timers: {
      setTimeout: (run: () => void, ms: number) => {
        next += 1;
        timers.set(next, { at: now + ms, run });
        return next;
      },
      clearTimeout: (handle: number) => {
        timers.delete(handle);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(handle);
        timer.run();
      }
    },
    pending: () => timers.size,
  };
}

/** A promise with its settle functions in hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

describe('FirstDrawGate', () => {
  test('is open before it is armed', () => {
    expect(new FirstDrawGate(clock().timers).open).toBe(true);
  });

  test('opens when compilation resolves, and drops its timer', async () => {
    const time = clock();
    const gate = new FirstDrawGate(time.timers);
    const compile = deferred();
    gate.arm(() => compile.promise);
    expect(gate.open).toBe(false);
    time.advance(FIRST_DRAW_BOUND_MS - 1);
    expect(gate.open).toBe(false);
    compile.resolve();
    await settle();
    expect(gate.open).toBe(true);
    expect(time.pending()).toBe(0);
  });

  test('opens at the bound when compilation never resolves', () => {
    const time = clock();
    const gate = new FirstDrawGate(time.timers);
    gate.arm(() => new Promise<void>(() => {}));
    time.advance(FIRST_DRAW_BOUND_MS - 1);
    expect(gate.open).toBe(false);
    time.advance(1);
    expect(gate.open).toBe(true);
  });

  test('opens on a rejection, at once on a throw and without asynchronous compilation', async () => {
    const time = clock();
    const rejected = new FirstDrawGate(time.timers);
    const compile = deferred();
    rejected.arm(() => compile.promise);
    compile.reject(new Error('lost context'));
    await settle();
    expect(rejected.open).toBe(true);

    const thrown = new FirstDrawGate(time.timers);
    thrown.arm(() => {
      throw new Error('no programs');
    });
    expect(thrown.open).toBe(true);

    const without = new FirstDrawGate(time.timers);
    without.arm(null);
    expect(without.open).toBe(true);
    expect(time.pending()).toBe(0);
  });

  test('a compilation of an earlier arming does not open a later one', async () => {
    const time = clock();
    const gate = new FirstDrawGate(time.timers);
    const first = deferred();
    gate.arm(() => first.promise);
    const second = deferred();
    gate.arm(() => second.promise);
    first.resolve();
    await settle();
    expect(gate.open).toBe(false);
    second.resolve();
    await settle();
    expect(gate.open).toBe(true);
  });
});

describe('FirstDrawSignal', () => {
  test('resolves on the first draw after an arming, and is re-armed by the next one', async () => {
    const signal = new FirstDrawSignal();
    const heard: string[] = [];
    signal.arm();
    void signal.next.then(() => heard.push('first'));
    await settle();
    expect(heard).toEqual([]);
    signal.drawn();
    signal.drawn();
    await settle();
    expect(heard).toEqual(['first']);
    signal.arm();
    void signal.next.then(() => heard.push('restore'));
    await settle();
    expect(heard).toEqual(['first']);
    signal.drawn();
    await settle();
    expect(heard).toEqual(['first', 'restore']);
  });

  test('an arming while one is owed keeps the same promise; nothing owed resolves at once', async () => {
    const signal = new FirstDrawSignal();
    let early = false;
    void signal.next.then(() => (early = true));
    await settle();
    expect(early).toBe(true);
    signal.arm();
    const owed = signal.next;
    signal.arm();
    expect(signal.next).toBe(owed);
  });
});
