/**
 * The eager half of the authoring boundary: the switches are remembered before
 * there is a stage or a chunk, the one chunk loads on the first switch-on and
 * is bound to the stage once both are there, a failed load is retried on the
 * next switch-on, and every command answers its «not loaded» value until then.
 *
 * The dynamic import is replaced by an injected loader, and the lazily built
 * tools by a recording stand-in: what is pinned is the port's own policy.
 */

import { describe, expect, test } from 'bun:test';
import { authoringPort, type Authoring, type AuthoringPortDeps } from './authoring-port.js';
import { collectLogger } from '../fixtures/stubs.js';

/** A tour camera id, as a host mints it. */
const CAM = '01a13a40-6f2e-7c41-9b1d-3e5f0a7c2d84';

type Stage = { readonly name: string };

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** The tools as the chunk would build them, recording what the port asked of them. */
function recordingTools(calls: string[]): Authoring {
  return {
    setCheckpointOverlay: (on) => calls.push(`overlay:${String(on)}`),
    setAssetMoveTool: (on) => calls.push(`asset:${String(on)}`),
    setPlanTool: (on) => calls.push(`plan:${String(on)}`),
    revertPlanEdit: () => calls.push('revert-plan'),
    addCheckpoint: () => true,
    startCheckpointPlacement: () => true,
    cancelCheckpointPlacement: () => calls.push('cancel'),
    setCheckpointFromView: () => true,
    frameCheckpoint: () => true,
    lookThroughCheckpoint: () => true,
    endLookThrough: () => true,
    focusCheckpoint: () => true,
    revertCheckpointEdit: () => calls.push('revert-checkpoint'),
    armAssetMove: () => calls.push('arm'),
    revertAssetEdit: () => calls.push('revert-asset'),
    mirrorAsset: () => true,
    turnAsset: () => true,
    modeChanged: (mode) => calls.push(`mode:${mode}`),
    retranslate: () => calls.push('retranslate'),
    lookThroughId: () => CAM,
    placing: () => true,
    debug: () => ({ checkpointOverlay: undefined, assetMove: null }),
    dispose: () => calls.push('dispose'),
  };
}

/** A port over a stage the test sets, with loads the test settles. */
function harness(start: AuthoringPortDeps<Stage, 'module'>['start'] | null = null) {
  const loads: Array<ReturnType<typeof deferred<'module'>>> = [];
  const started: string[] = [];
  const calls: string[] = [];
  const log = collectLogger();
  const reports: unknown[] = [];
  let stage: Stage | undefined;
  const deps: AuthoringPortDeps<Stage, 'module'> = {
    stage: () => stage,
    load: () => {
      const load = deferred<'module'>();
      loads.push(load);
      return load.promise;
    },
    start:
      start ??
      ((_module, on) => {
        started.push(on.name);
        return recordingTools(calls);
      }),
    log: log.log,
    report: (error) => reports.push(error),
  };
  const port = authoringPort(deps);
  return {
    port,
    loads,
    started,
    calls,
    log,
    reports,
    setStage: (next: Stage | undefined) => {
      stage = next;
    },
  };
}

/** Lets every settled promise's handlers run. */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('the authoring port', () => {
  test('with no switch turned on nothing loads and every command answers its «not loaded» value', async () => {
    const h = harness();
    h.setStage({ name: 'stage' });
    await h.port.ready();
    expect(h.loads).toHaveLength(0);
    expect(h.port.addCheckpoint(CAM)).toBe(false);
    expect(h.port.startCheckpointPlacement(CAM)).toBe(false);
    expect(h.port.setCheckpointFromView(CAM)).toBe(false);
    expect(h.port.frameCheckpoint(CAM)).toBe(false);
    expect(h.port.lookThroughCheckpoint(CAM)).toBe(false);
    expect(h.port.endLookThrough(true)).toBe(false);
    expect(h.port.focusCheckpoint(CAM)).toBe(false);
    expect(h.port.mirrorAsset(CAM, 'x')).toBe(false);
    expect(h.port.turnAsset(CAM, 1)).toBe(false);
    expect(h.port.lookThroughId()).toBeNull();
    expect(h.port.placing()).toBe(false);
    expect(h.port.debug()).toEqual({ loaded: false, checkpointOverlay: undefined, assetMove: null });
  });

  test('`focusCheckpoint(null)` before the tools are bound clears nothing and answers `true`, as with the overlay off; before a stage `false`', async () => {
    const h = harness();
    expect(h.port.focusCheckpoint(null)).toBe(false);
    h.setStage({ name: 'stage' });
    await h.port.ready();
    expect(h.port.focusCheckpoint(null)).toBe(true);
    h.port.setCheckpointOverlay(true);
    // The chunk is on the way: the clear still has nothing to clear.
    expect(h.port.focusCheckpoint(null)).toBe(true);
    expect(h.port.focusCheckpoint(CAM)).toBe(false);
    expect(h.loads).toHaveLength(1);
  });

  test('each switch turned on starts exactly one load, and a second switch during that load starts none', () => {
    const h = harness();
    h.port.setCheckpointOverlay(true);
    expect(h.loads).toHaveLength(1);
    h.port.setAssetMoveTool(true);
    h.port.setCheckpointOverlay(false);
    h.port.setCheckpointOverlay(true);
    expect(h.loads).toHaveLength(1);
  });

  test('a switch set before the stage is applied once the stage and the chunk are both there, last value winning', async () => {
    const h = harness();
    h.port.setCheckpointOverlay(true);
    h.port.setCheckpointOverlay(false);
    h.port.setAssetMoveTool(true);
    h.port.setAssetMoveTool(false);
    h.port.setAssetMoveTool(true);
    h.port.setPlanTool(true);
    h.port.setPlanTool(false);
    h.loads[0]!.resolve('module');
    await settle();
    // The chunk is in, the stage is not: nothing is built yet.
    expect(h.started).toEqual([]);
    expect(h.port.checkpointOverlay()).toBe(false);
    h.setStage({ name: 'stage' });
    await h.port.ready();
    expect(h.started).toEqual(['stage']);
    expect(h.calls).toEqual(['overlay:false', 'asset:true', 'plan:false']);
    expect(h.port.focusCheckpoint(CAM)).toBe(true);
    expect(h.port.lookThroughId()).toBe(CAM);
  });

  test('a failed load is retried on the next switch-on and not before', async () => {
    const h = harness();
    h.setStage({ name: 'stage' });
    h.port.setAssetMoveTool(true);
    h.loads[0]!.reject(new Error('chunk gone'));
    await h.port.ready();
    expect(h.log.codes()).toEqual(['authoring-chunk']);
    h.port.setAssetMoveTool(false);
    await h.port.ready();
    expect(h.loads).toHaveLength(1);
    h.port.setCheckpointOverlay(true);
    expect(h.loads).toHaveLength(2);
    h.loads[1]!.resolve('module');
    await h.port.ready();
    expect(h.started).toEqual(['stage']);
  });

  test('a port disposed during the load binds nothing when the load resolves', async () => {
    const h = harness();
    h.setStage({ name: 'stage' });
    h.port.setCheckpointOverlay(true);
    h.port.dispose();
    h.loads[0]!.resolve('module');
    await settle();
    expect(h.started).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.port.focusCheckpoint(CAM)).toBe(false);
  });

  test('a mode change or a new catalogue before the chunk is in does nothing and throws nothing', () => {
    const h = harness();
    h.setStage({ name: 'stage' });
    h.port.setCheckpointOverlay(true);
    expect(() => h.port.modeChanged('walk')).not.toThrow();
    expect(() => h.port.retranslate({} as never)).not.toThrow();
    expect(h.calls).toEqual([]);
  });

  test('a new stage gets its own tools; the old stage’s are disposed first', async () => {
    const h = harness();
    h.setStage({ name: 'first' });
    h.port.setCheckpointOverlay(true);
    h.loads[0]!.resolve('module');
    await h.port.ready();
    h.port.unbind();
    h.setStage({ name: 'second' });
    await h.port.ready();
    expect(h.started).toEqual(['first', 'second']);
    expect(h.calls).toEqual(['overlay:true', 'asset:false', 'plan:false', 'dispose', 'overlay:true', 'asset:false', 'plan:false']);
  });

  test('a «Move» armed while the chunk loads is armed once the tools are bound', async () => {
    const h = harness();
    h.setStage({ name: 'stage' });
    h.port.setAssetMoveTool(true);
    h.port.armAssetMove();
    h.loads[0]!.resolve('module');
    await h.port.ready();
    expect(h.calls).toEqual(['overlay:false', 'asset:true', 'plan:false', 'arm']);
  });

  test('a «Move» armed and then switched off while the chunk loads is not armed', async () => {
    const h = harness();
    h.setStage({ name: 'stage' });
    h.port.setAssetMoveTool(true);
    h.port.armAssetMove();
    h.port.setAssetMoveTool(false);
    h.loads[0]!.resolve('module');
    await h.port.ready();
    expect(h.calls).toEqual(['overlay:false', 'asset:false', 'plan:false']);
  });

  test('tools that throw while they are built are reported as an internal error, not as a chunk that did not load', async () => {
    const failure = new Error('the tools broke');
    const h = harness(() => {
      throw failure;
    });
    h.setStage({ name: 'stage' });
    h.port.setPlanTool(true);
    h.loads[0]!.resolve('module');
    await h.port.ready();
    expect(h.log.codes()).toEqual([]);
    expect(h.reports).toEqual([failure]);
  });
});
