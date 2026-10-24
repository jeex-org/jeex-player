/**
 * When a light bake is applied and dropped during a viewer's life, with the
 * apply itself replaced by a fake: the real one runs in the browser
 * (`tests/component/light-bake-hook.test.ts`).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import type { SceneData } from '../scene/types.js';
import type { TouchedEntity } from '../scene/ops/context.js';
import type { LogEntry } from '../shared/logger.js';
import type { BakedShellOptions, BakedShellOutcome } from './baked-shell.js';
import type { LightBake } from './light-bake.js';
import { LightBakeError } from './light-bake-error.js';
import { lightBakeWiring, type BakeTarget } from './light-bake-wiring.js';

const SOURCE = { sidecarUrl: new URL('https://bake.test/sidecar.json'), shellUrl: new URL('https://bake.test/shell.glb') };
const LAMP = '01a1c000-0000-7000-8000-000000000001';

/** A promise and its resolver. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A wiring over a fake apply that answers what `answer` says, and records every call and every disposal. */
function harness(answer: (options: BakedShellOptions) => Promise<BakedShellOutcome> | 'applied' = () => 'applied') {
  const log: LogEntry[] = [];
  const calls: BakedShellOptions[] = [];
  const disposed: number[] = [];
  let changed = 0;
  let source: typeof SOURCE | null = SOURCE;
  const wiring = lightBakeWiring({
    source: () => source,
    log: {
      warn: (code, message, detail) => log.push({ level: 'warn', code, message, detail }),
      error: (code, message, detail) => log.push({ level: 'error', code, message, detail }),
    },
    changed: () => (changed += 1),
    apply: async (options) => {
      calls.push(options);
      const result = answer(options);
      if (result !== 'applied') return result;
      const id = calls.length;
      return {
        applied: true,
        bake: { bakeId: `bake-${String(id)}`, lamps: [{ id: LAMP }], bindings: [] } as unknown as LightBake,
        bound: { unresolvedLamps: [], transmissive: [], unbind: () => undefined },
        dispose: () => disposed.push(id),
      };
    },
  });
  return {
    wiring,
    log,
    calls,
    disposed,
    changes: () => changed,
    setSource: (next: typeof SOURCE | null) => (source = next),
  };
}

const target = (settled: Promise<unknown> = Promise.resolve(), document: object = {}): BakeTarget => ({
  document,
  scene: { id: 'scene' } as SceneData,
  root: new THREE.Group(),
  settled,
});

describe('lightBakeWiring', () => {
  test('without a source nothing is fetched and the state is off', async () => {
    const h = harness();
    h.setSource(null);
    h.wiring.mounted(target());
    await h.wiring.idle();
    expect(h.calls).toHaveLength(0);
    expect(h.wiring.state()).toEqual({ state: 'off' });
  });

  test('waits for the scene to settle before it applies', async () => {
    const h = harness();
    const settled = deferred();
    h.wiring.mounted(target(settled.promise));
    await Promise.resolve();
    expect(h.wiring.state().state).toBe('waiting');
    expect(h.calls).toHaveLength(0);
    settled.resolve();
    await h.wiring.idle();
    expect(h.calls).toHaveLength(1);
    expect(h.wiring.state()).toEqual({ state: 'applied', bakeId: 'bake-1', bound: 0 });
    expect(h.changes()).toBe(1);
  });

  test('a refusal logs one reason and keeps nothing applied', async () => {
    const h = harness(async () => ({ applied: false, error: new LightBakeError('shell', 'light bake x was made for another shell') }));
    h.wiring.mounted(target());
    await h.wiring.idle();
    expect(h.log).toEqual([
      { level: 'warn', code: 'light-bake-refused', message: 'light bake x was made for another shell', detail: { reason: 'shell' } },
    ]);
    expect(h.wiring.state()).toEqual({ state: 'refused', reason: 'shell', message: 'light bake x was made for another shell' });
    expect(h.changes()).toBe(0);
  });

  test('drop disposes the applied bake once and says so', async () => {
    const h = harness();
    h.wiring.mounted(target());
    await h.wiring.idle();
    h.wiring.drop();
    h.wiring.drop();
    expect(h.disposed).toEqual([1]);
    expect(h.wiring.state()).toEqual({ state: 'dropped', bakeId: 'bake-1' });
    expect(h.changes()).toBe(2);
  });

  test('a drop while loading aborts the apply and disposes what it brings back', async () => {
    const gate = deferred();
    let signal: AbortSignal | undefined;
    const h = harness((options) => {
      signal = options.signal;
      return gate.promise
        .then(() => 'applied' as const)
        .then(() => ({
          applied: true as const,
          bake: { bakeId: 'late', lamps: [], bindings: [] } as unknown as LightBake,
          bound: { unresolvedLamps: [], transmissive: [], unbind: () => undefined },
          dispose: () => h.disposed.push(99),
        }));
    });
    h.wiring.mounted(target());
    await Promise.resolve();
    await Promise.resolve();
    expect(h.wiring.state().state).toBe('loading');
    h.wiring.drop();
    expect(signal?.aborted).toBe(true);
    gate.resolve();
    await h.wiring.idle();
    expect(h.disposed).toEqual([99]);
    expect(h.wiring.state().state).toBe('dropped');
  });

  test('a new mount drops the bake of the previous one first and applies again', async () => {
    const h = harness();
    h.wiring.mounted(target());
    await h.wiring.idle();
    h.wiring.mounted(target());
    expect(h.disposed).toEqual([1]);
    await h.wiring.idle();
    expect(h.calls).toHaveLength(2);
    expect(h.wiring.state()).toEqual({ state: 'applied', bakeId: 'bake-2', bound: 0 });
  });

  test('a revision of the shell, a finish, an opening or the site drops the bake; cameras and furniture do not', async () => {
    const keeps: TouchedEntity[][] = [
      [],
      [{ kind: 'camera', target: { kind: 'presentation' } } as unknown as TouchedEntity],
      [{ kind: 'navigation' }, { kind: 'autotour' }, { kind: 'tourCheckpoints' }],
      [{ kind: 'asset', id: '01a1c000-0000-7000-8000-0000000000ff' }],
    ];
    const drops: TouchedEntity[][] = [
      [{ kind: 'shell' }],
      [{ kind: 'facade' }],
      [{ kind: 'floor', room: 'r' }],
      [{ kind: 'walls', room: 'r' }],
      [{ kind: 'ceiling', room: 'r' }],
      [{ kind: 'trim', room: 'r' }],
      [{ kind: 'face', face: { wall: 'w', side: 'left' } } as unknown as TouchedEntity],
      [{ kind: 'opening', id: 'o' }],
      [{ kind: 'site' }],
      [{ kind: 'asset', id: LAMP }],
    ];
    for (const touched of keeps) {
      const h = harness();
      h.wiring.mounted(target());
      await h.wiring.idle();
      h.wiring.revision(touched);
      expect(h.wiring.state().state, JSON.stringify(touched)).toBe('applied');
    }
    for (const touched of drops) {
      const h = harness();
      h.wiring.mounted(target());
      await h.wiring.idle();
      h.wiring.revision(touched);
      expect(h.wiring.state().state, JSON.stringify(touched)).toBe('dropped');
      expect(h.disposed).toEqual([1]);
    }
  });

  test('a revision while waiting drops the attempt: it is not applied later', async () => {
    const h = harness();
    const settled = deferred();
    h.wiring.mounted(target(settled.promise));
    h.wiring.revision([{ kind: 'facade' }]);
    settled.resolve();
    await h.wiring.idle();
    expect(h.calls).toHaveLength(0);
    expect(h.wiring.state().state).toBe('dropped');
  });

  test('an apply that throws is logged as an error and keeps nothing applied', async () => {
    const h = harness(async () => {
      throw new Error('defect');
    });
    h.wiring.mounted(target());
    await h.wiring.idle();
    expect(h.log.map((entry) => [entry.level, entry.code])).toEqual([['error', 'light-bake-failed']]);
    expect(h.wiring.state()).toEqual({ state: 'refused', message: 'defect' });
  });

  test('while the lamps are not known yet, any furniture edit drops the attempt', async () => {
    const h = harness();
    const settled = deferred();
    h.wiring.mounted(target(settled.promise));
    h.wiring.revision([{ kind: 'asset', id: '01a1c000-0000-7000-8000-0000000000ff' }]);
    settled.resolve();
    await h.wiring.idle();
    expect(h.calls).toHaveLength(0);
  });

  test('a remount of the same document retries, unless an edit invalidated that document', async () => {
    const h = harness();
    const document = {};
    h.wiring.mounted(target(Promise.resolve(), document));
    await h.wiring.idle();
    h.wiring.drop();
    h.wiring.mounted(target(Promise.resolve(), document));
    await h.wiring.idle();
    expect(h.calls).toHaveLength(2);
    expect(h.wiring.state().state).toBe('applied');
    h.wiring.revision([{ kind: 'facade' }]);
    h.wiring.mounted(target(Promise.resolve(), document));
    await h.wiring.idle();
    expect(h.calls).toHaveLength(2);
    expect(h.wiring.state().state).toBe('dropped');
    h.wiring.mounted(target(Promise.resolve(), {}));
    await h.wiring.idle();
    expect(h.calls).toHaveLength(3);
  });
});
