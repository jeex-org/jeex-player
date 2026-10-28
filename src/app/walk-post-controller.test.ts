/**
 * The walk and tour chain's lifecycle, with a fake loader: lazy load on the
 * first eligible frame, direct rendering while it is pending, attach only when
 * still eligible, not disposed and on the same GPU context, one error per
 * failed entry, detach in the editing modes, disposal and rebuild after a
 * context restore.
 */

import { describe, expect, test } from 'bun:test';
import { WalkPostController } from './walk-post-controller.js';
import type { PostProcessor } from '../render/post-processor.js';

type FakeChain = PostProcessor & { readonly id: number; disposed: number };

/** A loader whose builds the test resolves or rejects by hand. */
function harness(options: { prepare?: (chain: PostProcessor) => Promise<unknown> } = {}) {
  let next = 0;
  const builds: Array<{ resolve: (chain: FakeChain) => void; reject: (error: unknown) => void; chain: FakeChain }> = [];
  const attached: Array<PostProcessor | null> = [];
  const errors: unknown[] = [];
  const controller = new WalkPostController({
    build: () =>
      new Promise<PostProcessor>((resolve, reject) => {
        next += 1;
        const chain: FakeChain = {
          id: next,
          disposed: 0,
          render: () => undefined,
          renderTo: () => undefined,
          compile: () => Promise.resolve(),
          setSize: () => undefined,
          dispose() {
            this.disposed += 1;
          },
        };
        builds.push({ resolve, reject, chain });
      }),
    attach: (chain) => attached.push(chain),
    report: (error) => errors.push(error),
    ...(options.prepare && { prepare: options.prepare }),
  });
  /** Resolves build `index` and lets its continuation run. */
  async function finish(index: number): Promise<FakeChain> {
    const build = builds[index]!;
    build.resolve(build.chain);
    await settle();
    return build.chain;
  }
  async function fail(index: number, error: unknown): Promise<void> {
    builds[index]!.reject(error);
    await settle();
  }
  return { controller, builds, attached, errors, finish, fail, last: () => attached.at(-1) };
}

/** Lets every pending continuation of a settled promise run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('WalkPostController', () => {
  test('editing modes load nothing and attach nothing', () => {
    const h = harness();
    h.controller.update('orbit');
    h.controller.update('plan3d');
    h.controller.update('plan2d');
    expect(h.builds.length).toBe(0);
    expect(h.attached).toEqual([]);
  });

  test('loads on the first eligible frame, once, and renders directly while pending', async () => {
    const h = harness();
    h.controller.update('walk');
    h.controller.update('walk');
    expect(h.builds.length).toBe(1);
    expect(h.attached).toEqual([]);
    expect(h.controller.state()).toBe('loading');
    const chain = await h.finish(0);
    expect(h.last()).toBe(chain);
    expect(h.controller.state()).toBe('on');
  });

  test('a tour attaches like a walk', async () => {
    const h = harness();
    h.controller.update('tour');
    expect(h.last()).toBeUndefined();
    const chain = await h.finish(0);
    expect(h.last()).toBe(chain);
  });

  test('leaving before the load completes attaches nothing; the next entry attaches the kept chain', async () => {
    const h = harness();
    h.controller.update('walk');
    h.controller.update('orbit');
    const chain = await h.finish(0);
    expect(h.attached).toEqual([]);
    expect(chain.disposed).toBe(0);
    h.controller.update('walk');
    expect(h.builds.length).toBe(1);
    expect(h.last()).toBe(chain);
  });

  test('detaches in the editing modes and keeps the chain for the next visit', async () => {
    const h = harness();
    h.controller.update('walk');
    const chain = await h.finish(0);
    h.controller.update('orbit');
    expect(h.last()).toBeNull();
    expect(chain.disposed).toBe(0);
    h.controller.update('orbit');
    expect(h.attached.length).toBe(2);
    h.controller.update('tour');
    expect(h.last()).toBe(chain);
    expect(h.builds.length).toBe(1);
  });

  test('a failed load reports one error, keeps rendering directly and retries only on the next entry', async () => {
    const h = harness();
    h.controller.update('walk');
    await h.fail(0, new Error('chunk'));
    h.controller.update('walk');
    h.controller.update('walk');
    expect(h.errors.length).toBe(1);
    expect(h.builds.length).toBe(1);
    expect(h.attached).toEqual([]);
    expect(h.controller.state()).toBe('failed');
    h.controller.update('orbit');
    h.controller.update('walk');
    expect(h.builds.length).toBe(2);
    const chain = await h.finish(1);
    expect(h.last()).toBe(chain);
    expect(h.errors.length).toBe(1);
  });

  test('disposal while loading attaches nothing and disposes what the load built', async () => {
    const h = harness();
    h.controller.update('walk');
    h.controller.dispose();
    const chain = await h.finish(0);
    expect(h.attached.filter((entry) => entry !== null)).toEqual([]);
    expect(chain.disposed).toBe(1);
    h.controller.update('walk');
    expect(h.builds.length).toBe(1);
  });

  test('dispose detaches and disposes an attached chain once', async () => {
    const h = harness();
    h.controller.update('walk');
    const chain = await h.finish(0);
    h.controller.dispose();
    h.controller.dispose();
    expect(h.last()).toBeNull();
    expect(chain.disposed).toBe(1);
  });

  test('a context loss while loading makes the completion stale: nothing attached, the build disposed', async () => {
    const h = harness();
    h.controller.update('walk');
    h.controller.contextLost();
    h.controller.contextRestored();
    const stale = await h.finish(0);
    expect(h.attached.filter((entry) => entry !== null)).toEqual([]);
    expect(stale.disposed).toBe(1);
    // The next eligible frame rebuilds on the new context.
    h.controller.update('walk');
    expect(h.builds.length).toBe(2);
    const fresh = await h.finish(1);
    expect(h.last()).toBe(fresh);
  });

  test('a context loss disposes the attached chain; the first walk frame after the restore rebuilds it', async () => {
    const h = harness();
    h.controller.update('walk');
    const lost = await h.finish(0);
    h.controller.contextLost();
    expect(h.last()).toBeNull();
    expect(lost.disposed).toBe(1);
    // Nothing is built while the context is gone.
    h.controller.update('walk');
    expect(h.builds.length).toBe(1);
    h.controller.contextRestored();
    h.controller.update('walk');
    expect(h.builds.length).toBe(2);
    const rebuilt = await h.finish(1);
    expect(h.last()).toBe(rebuilt);
  });

  test('a capture in walk waits for the load and gets the same chain the live view uses', async () => {
    const h = harness();
    const pending = h.controller.forCapture('walk');
    expect(h.builds.length).toBe(1);
    h.controller.update('walk');
    expect(h.builds.length).toBe(1);
    const chain = await h.finish(0);
    expect(await pending).toBe(chain);
    expect(await h.controller.forCapture('tour')).toBe(chain);
  });

  test('a capture outside walk and tour, or after a failed load, gets no chain', async () => {
    const h = harness();
    expect(await h.controller.forCapture('orbit')).toBeNull();
    expect(h.builds.length).toBe(0);
    const pending = h.controller.forCapture('walk');
    await h.fail(0, new Error('chunk'));
    expect(await pending).toBeNull();
    expect(await h.controller.forCapture('walk')).toBeNull();
    expect(h.errors.length).toBe(1);
  });
});

describe('WalkPostController compiles the scene for the chain before attaching it', () => {
  test('draws directly until the compilation for the chain resolves, then attaches', async () => {
    let compiled: () => void = () => undefined;
    const prepared: PostProcessor[] = [];
    const { controller, finish, attached } = harness({
      prepare: (chain) => {
        prepared.push(chain);
        return new Promise<void>((resolve) => {
          compiled = resolve;
        });
      },
    });
    controller.update('walk');
    const chain = await finish(0);
    expect(prepared).toEqual([chain]);
    controller.update('walk');
    expect(attached).toEqual([]);
    expect(controller.state()).toBe('loading');
    compiled();
    await settle();
    controller.update('walk');
    expect(attached).toEqual([chain]);
  });

  test('a compilation that throws or rejects attaches at once', async () => {
    const thrown = harness({
      prepare: () => {
        throw new Error('no compileAsync');
      },
    });
    thrown.controller.update('tour');
    const chain = await thrown.finish(0);
    expect(thrown.attached).toEqual([chain]);
    const rejected = harness({ prepare: () => Promise.reject(new Error('lost')) });
    rejected.controller.update('walk');
    const other = await rejected.finish(0);
    rejected.controller.update('walk');
    expect(rejected.attached).toEqual([other]);
  });
});

describe('applyTierInputs', () => {
  /** The low tier's inputs, as the quality control would hand them over. */
  const LOW = { aoResolutionScale: 0.75, denoise: { depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 4, samples: 8 }, gtaoSamples: 8 };
  const HIGH = { aoResolutionScale: 1, denoise: { depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 }, gtaoSamples: 16 };

  test('hands the per-tier inputs to the built walk chain; false while there is none', async () => {
    const h = harness();
    expect(h.controller.applyTierInputs(LOW)).toBe(false);
    h.controller.update('walk');
    const chain = await h.finish(0);
    // A chain that is not the walk post (a foreign PostProcessor) takes none.
    expect(h.controller.applyTierInputs(LOW)).toBe(false);
    const tiered: Array<unknown> = [];
    (chain as { applyTier?: (inputs: unknown) => void }).applyTier = (received) => tiered.push(received);
    expect(h.controller.applyTierInputs(LOW)).toBe(true);
    expect(tiered).toEqual([LOW]);
  });

  test('a switch that landed while the chain was loading is re-applied when the chain adopts', async () => {
    const h = harness();
    h.controller.update('walk'); // the build starts on the build-time inputs
    // The tier switch lands while the walk chunk is still loading: no chain
    // to take it, but the controller remembers it.
    expect(h.controller.applyTierInputs(LOW)).toBe(false);
    const tiered: Array<unknown> = [];
    (h.builds[0]!.chain as { applyTier?: (inputs: unknown) => void }).applyTier = (received) => tiered.push(received);
    await h.finish(0);
    // The chain adopts the LATEST inputs, not the ones the build started with.
    expect(tiered).toEqual([LOW]);
    // And a later switch reaches the adopted chain the ordinary way.
    expect(h.controller.applyTierInputs(HIGH)).toBe(true);
    expect(tiered).toEqual([LOW, HIGH]);
  });

  test('a disposed controller applies nothing', async () => {
    const h = harness();
    h.controller.update('walk');
    const chain = await h.finish(0);
    const tiered: Array<unknown> = [];
    (chain as { applyTier?: (inputs: unknown) => void }).applyTier = (received) => tiered.push(received);
    h.controller.dispose();
    expect(h.controller.applyTierInputs(LOW)).toBe(false);
    expect(tiered).toEqual([]);
  });
});
