/**
 * The viewer's one quality control: what the mount option starts, what the
 * host's `setQuality` and the element's live attribute retune, what a drawn
 * frame feeds, and what the debug surface reads. The machine itself is
 * `render/quality-tier.ts`'s; this pins the app-side doors around it.
 */

import { describe, expect, test } from 'bun:test';
import { QualityControl } from './quality-control.js';
import { QUALITY_TIERS } from '../render/quality-tier.js';
import { handleCommands } from './handle-commands.js';
import { ViewerEvents } from './viewer-events.js';
import { ViewerLibError } from '../shared/errors.js';
import type { FurnitureAnimator } from '../geometry/furniture-animator.js';
import type { RenderRuntime } from '../render/render-runtime.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { ViewerContext } from './viewer-context.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerStage } from './viewer-stage.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ViewerMode } from '../scene/types.js';

function harness(options: { initial?: 'auto' | 'low' | 'high'; withRuntime?: boolean } = {}) {
  const caps: number[] = [];
  const tiers: unknown[] = [];
  let invalidations = 0;
  let live = false;
  let runtime: { setPixelRatioCap(value: number): void } | null =
    options.withRuntime === false
      ? null
      : {
          setPixelRatioCap: (value) => caps.push(value),
        };
  const control = new QualityControl({
    initial: options.initial ?? 'auto',
    // The control touches one method of the runtime; a stub stands in for it.
    runtime: () => runtime as RenderRuntime | undefined,
    applyChainTier: (inputs) => {
      tiers.push(inputs);
      return true;
    },
    lightingLive: () => live,
    invalidate: () => {
      invalidations += 1;
    },
  });
  return {
    control,
    caps,
    tiers,
    drawnFrames: () => invalidations,
    setLive: (value: boolean) => {
      live = value;
    },
    removeRuntime: () => {
      runtime = null;
    },
    addRuntime: () => {
      runtime = { setPixelRatioCap: (value) => caps.push(value) };
    },
  };
}

/** Draws frames `ms` apart until `total` ms of intervals has fed the machine (the run's first live draw anchors only). */
function motion(control: QualityControl, ms: number, total: number, start: number): number {
  let now = start;
  const draws = Math.ceil(total / ms) + 1;
  for (let index = 0; index < draws; index += 1) control.drawn((now += ms));
  return now;
}

/** One slow 2 s motion window. */
function slowWindow(control: QualityControl, start: number, ms = 24): number {
  return motion(control, ms, 2000, start);
}

describe('QualityControl', () => {
  test('auto starts on high and applies nothing before anything asks', () => {
    const h = harness();
    expect(h.control.mode).toBe('auto');
    expect(h.control.tier).toBe('high');
    expect(h.caps).toEqual([]);
    expect(h.tiers).toEqual([]);
  });

  test('the mount option low pins the tier; the stage builds on it, the control applies when asked', () => {
    const h = harness({ initial: 'low' });
    expect(h.control.mode).toBe('fixed');
    expect(h.control.tier).toBe('low');
    // Construction applies nothing: the runtime and the chain are BUILT on the
    // starting tier; only a live switch applies.
    expect(h.caps).toEqual([]);
    h.control.set('high');
    expect(h.caps).toEqual([QUALITY_TIERS.high.pixelRatioCap]);
    expect(h.control.tier).toBe('high');
  });

  test('set retunes the runtime, the chain and the redraw, both ways', () => {
    const h = harness();
    const low = QUALITY_TIERS.low;
    h.control.set('low');
    expect(h.caps).toEqual([low.pixelRatioCap]);
    expect(h.tiers).toEqual([{ aoResolutionScale: low.aoResolutionScale, denoise: { ...low.denoise }, gtaoSamples: low.gtaoSamples }]);
    expect(h.drawnFrames()).toBeGreaterThan(0);
    h.control.set('high');
    expect(h.caps).toEqual([low.pixelRatioCap, QUALITY_TIERS.high.pixelRatioCap]);
    h.control.set('auto');
    expect(h.control.mode).toBe('auto');
    expect(h.control.tier).toBe('high');
    expect(h.caps).toEqual([low.pixelRatioCap, QUALITY_TIERS.high.pixelRatioCap, QUALITY_TIERS.high.pixelRatioCap]);
  });

  test('an invalid value throws bad-params naming quality and changes nothing', () => {
    const h = harness();
    try {
      h.control.set('crisp');
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(ViewerLibError);
      const libError = error as ViewerLibError;
      expect(libError.code).toBe('bad-params');
      expect(libError.path).toBe('quality');
    }
    expect(h.control.tier).toBe('high');
    expect(h.caps).toEqual([]);
  });

  test('drawn frames feed nothing until the room lighting is live, then the machine runs', () => {
    const h = harness();
    let now = 0;
    // Start-up: compile, bake, probe capture. The gate `dev/meter.ts` waits on.
    now = slowWindow(h.control, now, 40);
    now = slowWindow(h.control, now, 40);
    expect(h.control.tier).toBe('high');
    h.setLive(true);
    now = slowWindow(h.control, now);
    now = slowWindow(h.control, now);
    expect(h.control.tier).toBe('low');
    expect(h.caps).toEqual([QUALITY_TIERS.low.pixelRatioCap]);
  });

  test('a rest gap between drawn frames feeds nothing; fast motion after a downgrade recovers, once', () => {
    const h = harness();
    let now = 0;
    h.setLive(true);
    now = slowWindow(h.control, now);
    now = slowWindow(h.control, now);
    expect(h.control.tier).toBe('low');
    // The camera rests: a gap is not a slow frame, and 5 s of gaps recover nothing.
    for (let fed = 0; fed < 20; fed += 1) h.control.drawn((now += 300));
    expect(h.control.tier).toBe('low');
    // 5 s of fast motion recovers.
    now = motion(h.control, 8, 5000, now);
    expect(h.control.tier).toBe('high');
    expect(h.caps).toEqual([QUALITY_TIERS.low.pixelRatioCap, QUALITY_TIERS.high.pixelRatioCap]);
    // And the recovery is spent: a second slowdown stays.
    now = slowWindow(h.control, now);
    now = slowWindow(h.control, now);
    expect(h.control.tier).toBe('low');
    now = motion(h.control, 8, 5000, now);
    expect(h.control.tier).toBe('low');
  });

  test('a fixed tier never feeds the machine', () => {
    const h = harness({ initial: 'low' });
    h.setLive(true);
    let now = 0;
    for (let fed = 0; fed < 400; fed += 1) h.control.drawn((now += 8));
    expect(h.control.mode).toBe('fixed');
    expect(h.caps).toEqual([]);
  });

  test('a new scene load resets the machine: the tier returns to high and the recovery is unspent', () => {
    const h = harness();
    let now = 0;
    h.setLive(true);
    now = slowWindow(h.control, now);
    now = slowWindow(h.control, now);
    expect(h.control.tier).toBe('low');
    h.control.newScene();
    // The machine restarts on high, and the screen follows it at once.
    expect(h.control.tier).toBe('high');
    expect(h.caps).toEqual([QUALITY_TIERS.low.pixelRatioCap, QUALITY_TIERS.high.pixelRatioCap]);
    // One slow window is not enough any more.
    now = slowWindow(h.control, now);
    expect(h.control.tier).toBe('high');
    now = slowWindow(h.control, now);
    expect(h.control.tier).toBe('low');
    expect(h.caps).toEqual([QUALITY_TIERS.low.pixelRatioCap, QUALITY_TIERS.high.pixelRatioCap, QUALITY_TIERS.low.pixelRatioCap]);
  });

  test('a switch before the stage exists is remembered and reaches the runtime when one does', () => {
    const h = harness();
    h.removeRuntime();
    h.control.set('low');
    expect(h.control.tier).toBe('low');
    expect(h.caps).toEqual([]);
    h.addRuntime();
    h.control.set('high');
    expect(h.caps).toEqual([QUALITY_TIERS.high.pixelRatioCap]);
  });

  test('the debug readout names the mode and the tier', () => {
    const h = harness({ initial: 'low' });
    expect(h.control.debug()).toEqual({ mode: 'fixed', tier: 'low' });
    h.control.set('auto');
    expect(h.control.debug()).toEqual({ mode: 'auto', tier: 'high' });
  });

  test('set(auto) while already auto keeps the running machine: the downgrade and the budget survive', () => {
    const h = harness();
    let now = 0;
    h.setLive(true);
    now = slowWindow(h.control, now);
    now = slowWindow(h.control, now);
    expect(h.control.tier).toBe('low');
    // A host re-applying the option (the element applies it again when the
    // attribute is removed) must not undo the downgrade...
    h.control.set('auto');
    expect(h.control.mode).toBe('auto');
    expect(h.control.tier).toBe('low');
    // ...nor restart the once-per-scene recovery budget.
    now = motion(h.control, 8, 5000, now);
    expect(h.control.tier).toBe('high');
    now = slowWindow(h.control, now);
    now = slowWindow(h.control, now);
    expect(h.control.tier).toBe('low');
    now = motion(h.control, 8, 5000, now);
    expect(h.control.tier).toBe('low');
  });

  test('a skipped tick breaks the interval: sporadic draws do not read as slow motion', () => {
    const h = harness();
    h.setLive(true);
    let now = 0;
    // Sporadic draws in walk (a hover, a settle window): each draw follows
    // skipped ticks, so every drawn interval would stretch to ~100 ms — under
    // the motion gap, over the downgrade bar. Breaking the interval feeds
    // nothing: a fast device stays high.
    for (let cycle = 0; cycle < 40; cycle += 1) {
      h.control.drawn((now += 16));
      h.control.skipped();
      h.control.skipped();
      h.control.skipped();
      h.control.drawn((now += 84));
      h.control.skipped();
      h.control.skipped();
      h.control.skipped();
      h.control.skipped();
    }
    expect(h.control.tier).toBe('high');
    expect(h.caps).toEqual([]);
  });
});

/**
 * The control as `handle-commands.ts` wires it, over a stub stage whose room
 * lighting is always live: the doors the command bag adds around the control
 * (the mode gate on the machine's sampling, the `scene` handler) are pinned
 * here, where the control's own tests above need no such stage.
 */
function commandHarness(options: { initial?: 'auto' | 'low' | 'high' } = {}) {
  const caps: number[] = [];
  let mode: ViewerMode = 'walk';
  const stage = {
    runtime: {
      setPixelRatioCap: (value: number) => caps.push(value),
      demand: { invalidate: () => undefined },
    },
    walkPost: { applyTierInputs: () => true },
    walkLighting: { state: () => 'live' as const },
    director: {
      controller: { getMode: () => mode },
      selectMode: () => undefined,
      setMode: () => undefined,
    },
    pilot: { id: null },
    overlay: { setMode: () => undefined },
  } as unknown as ViewerStage;
  const events = new ViewerEvents();
  const commands = handleCommands({
    stage: () => stage,
    ui: {
      setLightTemperature: () => undefined,
      setModeButtons: () => undefined,
      setHintForMode: () => undefined,
    } as unknown as ViewerUI,
    events,
    tour: {} as TourControls,
    mount: () => {
      throw new Error('commandHarness: the mount is not part of this test');
    },
    animator: {} as FurnitureAnimator,
    context: {} as ViewerContext,
    options: {
      quality: options.initial ?? 'auto',
      view: { mode: 'orbit' },
      lighting: { temperature: 5000 },
    } as unknown as ViewerOptions,
    furnitureVisible: () => true,
    setFurnitureVisible: () => undefined,
    checkpointsVisible: () => false,
    setCheckpointsVisible: () => undefined,
    messages: () => {
      throw new Error('commandHarness: the messages are not part of this test');
    },
    setMessages: () => undefined,
  });
  return {
    commands,
    events,
    caps,
    setMode: (value: ViewerMode) => (mode = value),
  };
}

describe('the command bag`s quality doors', () => {
  test('the machine feeds only in walk and tour: slow frames in an editing mode downgrade nothing', () => {
    const h = commandHarness();
    // The stage's room lighting is live, but the mode is not one it shows:
    // `state()` stays 'live' in orbit after one walk visit.
    h.setMode('orbit');
    expect(h.commands.getMode()).toBe('orbit');
    motion(h.commands.quality, 24, 4100, 0);
    expect(h.commands.quality.tier).toBe('high');
    expect(h.caps).toEqual([]);
  });

  test('a `scene` event resets the machine only when the scene id changes; a same-scene revision is ignored', () => {
    const h = commandHarness();
    // The scene loads; the machine runs and downgrades.
    h.events.emit('scene', { sceneId: 'scene-1', rev: 0 });
    motion(h.commands.quality, 24, 4100, 0);
    expect(h.commands.quality.tier).toBe('low');
    // A plan-level revision of the SAME scene fires `scene` too; it is not a
    // new load, and the machine the editing session wears must survive it.
    h.events.emit('scene', { sceneId: 'scene-1', rev: 7 });
    expect(h.commands.quality.tier).toBe('low');
    // A different scene id IS a new load: the machine restarts on high.
    h.events.emit('scene', { sceneId: 'scene-2', rev: 0 });
    expect(h.commands.quality.tier).toBe('high');
    // The caps: the load's own reset applied high, the downgrade applied low,
    // the ignored revision applied nothing, the new scene applied high.
    expect(h.caps).toEqual([QUALITY_TIERS.high.pixelRatioCap, QUALITY_TIERS.low.pixelRatioCap, QUALITY_TIERS.high.pixelRatioCap]);
  });
});
