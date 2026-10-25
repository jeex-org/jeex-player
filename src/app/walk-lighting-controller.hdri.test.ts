/**
 * The walk lighting controller's host sky (`lighting.hdri`): when its files
 * load, what is installed, what a light bake allows, and what is released.
 */

import { describe, expect, test } from 'bun:test';
import { WalkLightingController, type HdriLoads, type WalkLightingHandle } from './walk-lighting-controller.js';
import type { HdriContent, HdriSkyState, HdriView } from '../render/hdri/hdri-sky.js';
import type { HdriEntry } from '../lighting/hdri-entry.js';
import type { HdriTarget, HdriMode } from './hdri-wiring.js';

type Doc = { id: number };

class FakeLighting implements WalkLightingHandle<Doc> {
  phase: 'baking' | 'probes' | 'live' | 'empty' = 'live';
  installed: Array<HdriContent | null> = [];
  views: HdriView[] = [];
  hdriState: HdriSkyState = 'off';
  disposed = false;
  stats = null;
  recapturing = false;
  load(): void {}
  frame(eligible: boolean): void {
    const content = this.installed.at(-1) ?? null;
    this.hdriState = !eligible || !content ? 'off' : content.environment ? 'display' : 'sky-only';
  }
  refresh(): void {}
  relight(): void {}
  setHdri(content: HdriContent | null): void {
    this.installed.push(content);
  }
  setHdriView(view: HdriView): void {
    this.views.push(view);
  }
  setSun(): void {}
  dispose(): void {
    this.disposed = true;
  }
}

type Pending<T> = { url: string; resolve: (value: T) => void; reject: (error: Error) => void; signal: AbortSignal };
type Resource = { disposed: boolean; dispose(): void };

const entry = (name: string): HdriEntry => ({
  environmentUrl: `https://cdn.example.test/${name}.jpg`,
  skyUrl: `https://cdn.example.test/${name}.avif`,
  sun: { azimuthDeg: 54, elevationDeg: 43, colourLinear: [1, 1, 1], horizontalIrradianceShare: 0.5 },
});
const noon = entry('noon');
const evening = entry('evening');
const view = (rotationY = 0): HdriView => ({ rotationY, elevationDeg: 43, colourLinear: [1, 1, 1] });

function setup() {
  const built: FakeLighting[] = [];
  const errors: unknown[] = [];
  const warnings: string[] = [];
  const environments: Array<Pending<Resource & { texture: never; gain: number; sunIntensity: number; cubeSize: number }>> = [];
  const skies: Array<Pending<Resource & { texture: never }>> = [];
  const made: Resource[] = [];
  let target: HdriTarget | null = null;
  const resource = <T extends object>(extra: T): Resource & T => {
    const value = Object.assign(
      {
        disposed: false,
        dispose(this: Resource) {
          this.disposed = true;
        },
      },
      extra,
    );
    made.push(value);
    return value;
  };
  const loads: HdriLoads = {
    environment: (e, signal) =>
      new Promise((resolve, reject) => {
        environments.push({ url: e.environmentUrl, resolve, reject, signal });
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    sky: (e, signal) =>
      new Promise((resolve, reject) => {
        skies.push({ url: e.skyUrl, resolve, reject, signal });
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  };
  const controller = new WalkLightingController<Doc>({
    build: async () => {
      const lighting = new FakeLighting();
      built.push(lighting);
      return lighting;
    },
    report: (error) => errors.push(error),
    chainReady: () => true,
    document: () => ({ id: 1 }),
    now: () => 0,
    hdri: { target: () => target, loads, warn: (code) => warnings.push(code), sun: () => undefined },
  });
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  const ready = async (): Promise<FakeLighting> => {
    controller.update('walk');
    await flush();
    controller.update('walk');
    return built.at(-1)!;
  };
  return {
    controller,
    built,
    errors,
    warnings,
    environments,
    skies,
    made,
    flush,
    ready,
    target: (next: HdriTarget | null) => (target = next),
    resolveEnvironment: (i = environments.length - 1) =>
      environments[i]!.resolve(resource({ texture: null as never, gain: 1, sunIntensity: 2, cubeSize: 256 })),
    resolveSky: (i = skies.length - 1) => skies[i]!.resolve(resource({ texture: null as never })),
  };
}

const full = (e = noon, mode: HdriMode = 'full', rotationY = 0): HdriTarget => ({ preset: 'noon', entry: e, view: view(rotationY), mode });

describe('WalkLightingController with a host sky', () => {
  test('loads nothing before the first eligible frame, then both files at once, once', async () => {
    const s = setup();
    s.target(full());
    s.controller.update('orbit');
    expect(s.environments).toHaveLength(0);
    const lighting = await s.ready();
    expect(s.environments.map((p) => p.url)).toEqual([noon.environmentUrl]);
    expect(s.skies.map((p) => p.url)).toEqual([noon.skyUrl]);
    s.resolveEnvironment();
    s.resolveSky();
    await s.flush();
    expect(s.controller.update('walk')).toBe(true);
    expect(lighting.installed.at(-1)?.environment).toBeDefined();
    expect(s.controller.hdri().state).toBe('live');
    // Walk, orbit, tour, walk: no new request.
    for (const mode of ['orbit', 'tour', 'walk'] as const) s.controller.update(mode);
    expect([s.environments.length, s.skies.length]).toEqual([1, 1]);
  });

  test('nothing is installed until both files are ready', async () => {
    const s = setup();
    s.target(full());
    const lighting = await s.ready();
    s.resolveEnvironment();
    await s.flush();
    s.controller.update('walk');
    expect(lighting.installed).toEqual([]);
    expect(s.controller.hdri().state).toBe('loading');
  });

  test('a failure of either file warns once, releases the other, and is not retried until a new document', async () => {
    const s = setup();
    s.target(full());
    await s.ready();
    s.resolveEnvironment();
    s.skies[0]!.reject(new Error('HTTP 404'));
    await s.flush();
    s.controller.update('walk');
    expect(s.warnings).toEqual(['hdri-unavailable']);
    expect(s.made.every((r) => r.disposed)).toBe(true);
    expect(s.controller.hdri().state).toBe('failed');
    for (const mode of ['orbit', 'walk', 'tour'] as const) s.controller.update(mode);
    expect(s.environments).toHaveLength(1);
    s.controller.documentChanged();
    s.controller.update('walk');
    expect(s.environments).toHaveLength(2);
    expect(s.warnings).toEqual(['hdri-unavailable']);
  });

  test('a preset change releases the installed pair and loads the new one; a stale load is disposed on arrival', async () => {
    const s = setup();
    s.target(full());
    const lighting = await s.ready();
    s.resolveEnvironment();
    s.resolveSky();
    await s.flush();
    s.controller.update('walk');
    s.target(full(evening));
    s.controller.update('walk');
    expect(lighting.installed.at(-1)).toBeNull();
    expect(s.made.filter((r) => r.disposed)).toHaveLength(2);
    expect(s.environments.map((p) => p.url)).toEqual([noon.environmentUrl, evening.environmentUrl]);
    // Back to noon before evening answers: evening's files are disposed when they come.
    s.target(full(noon));
    s.controller.update('walk');
    expect(s.environments[1]!.signal.aborted).toBe(true);
  });

  test('a north change turns the installed sky without a reload', async () => {
    const s = setup();
    s.target(full());
    const lighting = await s.ready();
    s.resolveEnvironment();
    s.resolveSky();
    await s.flush();
    s.controller.update('walk');
    s.target(full(noon, 'full', 0.7));
    s.controller.update('walk');
    expect(lighting.views.at(-1)?.rotationY).toBe(0.7);
    expect(s.environments).toHaveLength(1);
  });

  test('a lost context disposes everything; the restore loads again', async () => {
    const s = setup();
    s.target(full());
    await s.ready();
    s.resolveEnvironment();
    s.resolveSky();
    await s.flush();
    s.controller.update('walk');
    s.controller.contextLost();
    expect(s.made.every((r) => r.disposed)).toBe(true);
    s.controller.contextRestored();
    await s.ready();
    expect(s.environments).toHaveLength(2);
  });

  test('unmount releases everything, in flight too', async () => {
    const s = setup();
    s.target(full());
    await s.ready();
    s.controller.dispose();
    expect(s.environments[0]!.signal.aborted).toBe(true);
    expect(s.skies[0]!.signal.aborted).toBe(true);
  });

  test('a pending bake loads only the sky and shows nothing; applied shows the sky alone and warns once', async () => {
    const s = setup();
    s.target(full(noon, 'hold'));
    const lighting = await s.ready();
    expect(s.environments).toHaveLength(0);
    expect(s.skies).toHaveLength(1);
    s.resolveSky();
    await s.flush();
    s.controller.update('walk');
    expect(lighting.installed).toEqual([]);
    s.target(full(noon, 'sky-only'));
    s.controller.update('walk');
    expect(lighting.installed.at(-1)?.environment).toBeUndefined();
    expect(lighting.installed.at(-1)?.sky).toBeDefined();
    s.controller.update('walk');
    expect(s.controller.hdri().state).toBe('sky-only');
    expect(s.environments).toHaveLength(0);
    expect(s.warnings).toEqual(['hdri-bake-daylight']);
  });

  test('a dropped bake releases the hold: the environment loads and full lighting follows, the sky reused', async () => {
    const s = setup();
    s.target(full(noon, 'sky-only'));
    const lighting = await s.ready();
    s.resolveSky();
    await s.flush();
    s.controller.update('walk');
    s.target(full(noon, 'full'));
    s.controller.update('walk');
    expect(s.environments).toHaveLength(1);
    expect(s.skies).toHaveLength(1);
    s.resolveEnvironment();
    await s.flush();
    s.controller.update('walk');
    expect(lighting.installed.at(-1)?.environment).toBeDefined();
  });
});
