import { describe, expect, test } from 'bun:test';
import { WalkLightingController, type WalkLightingHandle } from './walk-lighting-controller.js';
import type { LightingScope } from './walk-lighting-scope.js';

type Doc = { id: number };

/** A lighting that bakes for `bakeFrames` frames, then is live, and records what it was asked. */
class FakeLighting implements WalkLightingHandle<Doc> {
  phase: 'baking' | 'probes' | 'live' = 'baking';
  frames: boolean[] = [];
  loads: Doc[] = [];
  refreshes: LightingScope[] = [];
  disposed = false;
  loadError: Error | null = null;
  private left: number;
  constructor(bakeFrames: number) {
    this.left = bakeFrames;
  }
  load(doc: Doc): void {
    if (this.loadError) throw this.loadError;
    this.loads.push(doc);
    this.phase = 'baking';
  }
  frame(eligible: boolean): void {
    this.frames.push(eligible);
    if (eligible && this.phase !== 'live' && --this.left <= 0) this.phase = 'live';
  }
  refresh(scope: LightingScope): void {
    this.refreshes.push(scope);
  }
  stats = null;
  dispose(): void {
    this.disposed = true;
  }
}

function setup(options: { chainReady?: boolean; bakeFrames?: number } = {}) {
  const built: FakeLighting[] = [];
  const errors: unknown[] = [];
  let clock = 0;
  let chainReady = options.chainReady ?? true;
  let doc: Doc | null = { id: 1 };
  let resolveBuild: (() => void) | null = null;
  const controller = new WalkLightingController<Doc>({
    build: () =>
      new Promise((resolve) => {
        resolveBuild = () => {
          const lighting = new FakeLighting(options.bakeFrames ?? 2);
          built.push(lighting);
          resolve(lighting);
        };
      }),
    report: (error) => errors.push(error),
    chainReady: () => chainReady,
    document: () => doc,
    now: () => clock,
  });
  return {
    controller,
    built,
    errors,
    finishBuild: async () => {
      resolveBuild?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    tick: (ms: number) => (clock += ms),
    setChain: (ready: boolean) => (chainReady = ready),
    setDoc: (next: Doc | null) => (doc = next),
  };
}

describe('WalkLightingController', () => {
  test('loads nothing outside walk and tour, and nothing before the walk chain is ready', () => {
    const { controller, built } = setup({ chainReady: false });
    controller.update('orbit');
    controller.update('walk');
    expect(controller.state()).toBe('off');
    expect(built).toHaveLength(0);
  });

  test('builds on the first eligible frame, loads the document, bakes with the direct look, then is live', async () => {
    const { controller, built, finishBuild } = setup();
    controller.update('walk');
    expect(controller.state()).toBe('loading');
    await finishBuild();
    controller.update('walk');
    const lighting = built[0]!;
    expect(lighting.loads).toEqual([{ id: 1 }]);
    expect(controller.state()).toBe('baking');
    controller.update('walk');
    expect(controller.state()).toBe('live');
    expect(lighting.frames).toEqual([true, true]);
  });

  test('leaving walk shows the editing look, coming back shows the baked lighting again without a new load', async () => {
    const { controller, built, finishBuild } = setup({ bakeFrames: 1 });
    controller.update('walk');
    await finishBuild();
    controller.update('walk');
    controller.update('orbit');
    controller.update('walk');
    expect(built[0]!.frames).toEqual([true, false, true]);
    expect(built[0]!.loads).toHaveLength(1);
  });

  test('a new document is loaded on the next frame', async () => {
    const { controller, built, finishBuild, setDoc } = setup();
    controller.update('walk');
    await finishBuild();
    controller.update('walk');
    setDoc({ id: 2 });
    controller.documentChanged();
    controller.update('walk');
    expect(built[0]!.loads).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('edits are merged and refreshed once after the debounce', async () => {
    const { controller, built, finishBuild, tick } = setup({ bakeFrames: 1 });
    controller.update('walk');
    await finishBuild();
    controller.update('walk');
    controller.edited({ all: false, grids: [], probes: ['living'] });
    tick(400);
    controller.edited({ all: false, grids: ['bath'], probes: [] });
    controller.update('walk');
    expect(built[0]!.refreshes).toHaveLength(0);
    tick(1000);
    controller.update('walk');
    controller.update('walk');
    expect(built[0]!.refreshes).toEqual([{ all: false, grids: ['bath'], probes: ['living'] }]);
  });

  test('an edit made in orbit refreshes nothing until the next entry into walk', async () => {
    const { controller, built, finishBuild, tick } = setup({ bakeFrames: 1 });
    controller.update('walk');
    await finishBuild();
    controller.update('walk');
    controller.update('orbit');
    controller.edited({ all: false, grids: ['bath'], probes: [] });
    tick(5000);
    controller.update('orbit');
    controller.update('plan3d');
    expect(built[0]!.refreshes).toEqual([]);
    controller.update('walk');
    expect(built[0]!.refreshes).toEqual([{ all: false, grids: ['bath'], probes: [] }]);
  });

  test('a bake that throws is reported once and leaves the direct look', async () => {
    const { controller, built, errors, finishBuild } = setup();
    controller.update('walk');
    await finishBuild();
    const lighting = built[0]!;
    const frame = lighting.frame.bind(lighting);
    lighting.frame = (eligible: boolean) => {
      if (eligible) throw new Error('layout');
      frame(eligible);
    };
    controller.update('walk');
    controller.update('walk');
    controller.update('walk');
    expect(errors).toHaveLength(1);
    expect(controller.state()).toBe('failed');
    expect(lighting.frames.at(-1)).toBe(false);
  });

  test('a document the lighting refuses keeps the direct look and reports once', async () => {
    const { controller, built, errors, finishBuild, setDoc } = setup();
    controller.update('walk');
    await finishBuild();
    built[0]!.loadError = new Error('too many room boxes');
    setDoc({ id: 3 });
    controller.documentChanged();
    controller.update('walk');
    controller.update('walk');
    expect(errors).toHaveLength(1);
    expect(controller.state()).toBe('failed');
    expect(built[0]!.frames.at(-1)).toBe(false);
  });

  test('a context loss disposes the lighting; the restore builds and bakes it again', async () => {
    const { controller, built, finishBuild } = setup({ bakeFrames: 1 });
    controller.update('walk');
    await finishBuild();
    controller.update('walk');
    controller.contextLost();
    expect(built[0]!.disposed).toBe(true);
    controller.update('walk');
    expect(built).toHaveLength(1);
    controller.contextRestored();
    controller.update('walk');
    await finishBuild();
    controller.update('walk');
    expect(built[1]!.loads).toEqual([{ id: 1 }]);
  });

  test('a build that finishes after a context loss is disposed at once', async () => {
    const { controller, built, finishBuild } = setup();
    controller.update('walk');
    controller.contextLost();
    await finishBuild();
    expect(built[0]!.disposed).toBe(true);
  });
});
