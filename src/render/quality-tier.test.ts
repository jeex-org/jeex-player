/**
 * The quality tiers: the per-tier settings are pinned against the behaviour
 * each one must stay identical to, and the auto state machine is driven on
 * drawn-frame intervals alone. The chain itself needs WebGL and is proved in
 * `tests/component` (`tests/component/quality-tier.test.ts`).
 */

import { describe, expect, test } from 'bun:test';
import { QUALITY_TIERS, QualityTierMachine, startingTier, walkLightingOverridesFor } from './quality-tier.js';
import { WALK_POST_DEFAULT_TIER, WALK_POST_TUNING } from './walk-post.js';
import { WALK_LIGHTING_TUNING as T } from './walk-lighting/walk-lighting-tuning.js';

describe('QUALITY_TIERS', () => {
  test('high is today`s behaviour: the pixel-ratio cap, the full-resolution AO and three`s default sampling', () => {
    expect(QUALITY_TIERS.high).toEqual({
      pixelRatioCap: 1.7,
      aoResolutionScale: 1,
      denoise: { depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 },
      gtaoSamples: 16,
      probeSize: 128,
      probesPerFrame: 6,
    });
    // The numbers above are copies of the live tuning, pinned here so a tuning
    // change that forgets the tier fails loudly instead of silently leaving
    // `high` behind.
    expect(QUALITY_TIERS.high.aoResolutionScale).toBe(WALK_POST_TUNING.aoResolutionScale);
    expect(QUALITY_TIERS.high.denoise).toEqual(WALK_POST_TUNING.denoise);
    // A chain built without a tier starts on the default inputs (`walk-post.ts`);
    // a ray count the default chain does not share would make `high` the stranger.
    expect(WALK_POST_DEFAULT_TIER.gtaoSamples).toBe(QUALITY_TIERS.high.gtaoSamples);
    expect(QUALITY_TIERS.high.probeSize).toBe(T.probeSize);
    expect(QUALITY_TIERS.high.probesPerFrame).toBe(T.probesPerFrame);
  });

  test('low keeps the denoise phis and the full occlusion buffer, and halves the sampling', () => {
    expect(QUALITY_TIERS.low).toEqual({
      pixelRatioCap: 1.25,
      aoResolutionScale: 1,
      denoise: { depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 4, samples: 8 },
      gtaoSamples: 8,
      // The probe atlas's tile invariant pins the capture edge on every tier
      // (`walk-lighting/room-probes.ts`); only the bake pace below is the tier's.
      probeSize: 128,
      probesPerFrame: 4,
    });
    // A reduced occlusion buffer leaves stair-stepped halos on door and table
    // edges: the blend's bilinear upsampling crosses depth (`walk-post.ts`).
    // 0.5 showed it in the walk, 0.75 in a 2x crop of a door edge. Low keeps
    // the full buffer until the upsample is depth-aware.
    expect(QUALITY_TIERS.low.aoResolutionScale).toBe(QUALITY_TIERS.high.aoResolutionScale);
    // The capture edge is NOT a tier knob: any other edge gives a PMREM output
    // a different size than the atlas tile, and the probe step throws.
    expect(QUALITY_TIERS.low.probeSize).toBe(QUALITY_TIERS.high.probeSize);
    expect(QUALITY_TIERS.low.denoise.depthPhi).toBe(QUALITY_TIERS.high.denoise.depthPhi);
    expect(QUALITY_TIERS.low.denoise.normalPhi).toBe(QUALITY_TIERS.high.denoise.normalPhi);
    expect(QUALITY_TIERS.low.denoise.lumaPhi).toBe(QUALITY_TIERS.high.denoise.lumaPhi);
  });

  test('the lighting overrides of a tier map the bake pace and nothing else', () => {
    expect(walkLightingOverridesFor('high')).toEqual({ probesPerFrame: QUALITY_TIERS.high.probesPerFrame });
    expect(walkLightingOverridesFor('low')).toEqual({ probesPerFrame: QUALITY_TIERS.low.probesPerFrame });
  });

  test('both tiers are frozen', () => {
    expect(Object.isFrozen(QUALITY_TIERS)).toBe(true);
    expect(Object.isFrozen(QUALITY_TIERS.high)).toBe(true);
    expect(Object.isFrozen(QUALITY_TIERS.high.denoise)).toBe(true);
    expect(Object.isFrozen(QUALITY_TIERS.low)).toBe(true);
    expect(Object.isFrozen(QUALITY_TIERS.low.denoise)).toBe(true);
  });

  test('startingTier: auto and high start on high, low starts on low', () => {
    expect(startingTier('auto')).toBe('high');
    expect(startingTier('high')).toBe('high');
    expect(startingTier('low')).toBe('low');
  });
});

describe('QualityTierMachine', () => {
  /** Feeds one slow window (2 s of `ms` drawn frames); answers whether any feed changed the tier. */
  function slowWindow(machine: QualityTierMachine, ms = 24): boolean {
    let changed = false;
    for (let fed = 0; fed * ms < 2000; fed += 1) changed = machine.feed(ms) || changed;
    return changed;
  }
  /** Feeds one fast window (2 s of 8 ms drawn frames). */
  function fastWindow(machine: QualityTierMachine, ms = 8): boolean {
    let changed = false;
    for (let fed = 0; fed * ms < 2000; fed += 1) changed = machine.feed(ms) || changed;
    return changed;
  }

  test('starts on high', () => {
    expect(new QualityTierMachine().tier).toBe('high');
  });

  test('two consecutive slow windows downgrade to low; the frame that closes the second answers true', () => {
    const machine = new QualityTierMachine();
    expect(slowWindow(machine)).toBe(false);
    expect(machine.tier).toBe('high');
    expect(machine.feed(24)).toBe(false); // 2 s not yet reached in the second window
    expect(slowWindow(machine)).toBe(true); // its closing frame downgrades
    expect(machine.tier).toBe('low');
  });

  test('one fast window between two slow ones resets the count: three slow windows are needed', () => {
    const machine = new QualityTierMachine();
    slowWindow(machine);
    fastWindow(machine);
    slowWindow(machine);
    expect(machine.tier).toBe('high');
    slowWindow(machine);
    expect(machine.tier).toBe('low');
  });

  test('p75, not the average: a single spike in a fast window does not downgrade', () => {
    const machine = new QualityTierMachine();
    for (let fed = 0; fed < 250; fed += 1) machine.feed(fed === 100 ? 120 : 8);
    expect(machine.tier).toBe('high');
  });

  test('a 5 s window of fast motion recovers to high, once', () => {
    const machine = new QualityTierMachine();
    slowWindow(machine);
    slowWindow(machine);
    expect(machine.tier).toBe('low');
    let recovered = false;
    for (let fed = 0; fed < 625 && !recovered; fed += 1) recovered = machine.feed(8);
    expect(recovered).toBe(true);
    expect(machine.tier).toBe('high');
    expect(machine.recoveryUsed).toBe(true);
  });

  test('a 5 s window that is not fast enough does not recover; the next full 5 s starts fresh', () => {
    const machine = new QualityTierMachine();
    slowWindow(machine);
    slowWindow(machine);
    // 5 s of ragged motion: three frames in ten take 20 ms, the rest 8. The
    // p75 lands on the 20 ms frames — over the recovery bar and over the
    // absolute downgrade bar — so the window recovers nothing.
    let recovered = false;
    for (let fed = 0; fed < 435 && !recovered; fed += 1) recovered = machine.feed(fed % 10 < 3 ? 20 : 8);
    expect(machine.tier).toBe('low');
    // The window emptied at its verdict: another full 5 s of fast motion recovers.
    for (let fed = 0; fed < 700 && !recovered; fed += 1) recovered = machine.feed(8);
    expect(recovered).toBe(true);
    expect(machine.tier).toBe('high');
  });

  test('a 60 Hz display: motion back at vsync recovers, though the absolute bar is far above', () => {
    const machine = new QualityTierMachine();
    // The downgrade that brought it low: every other vsync missed (~33 ms on 60 Hz).
    expect(slowWindow(machine, 33.4)).toBe(false);
    expect(slowWindow(machine, 33.4)).toBe(true);
    expect(machine.tier).toBe('low');
    // Motion back at vsync with a fifth of the frames a frame late: the p75
    // stays on 16.7, the machine's own refresh estimate reads the panel, and
    // 1.02 x 16.7 (~17 ms) opens the recovery the absolute 11 ms never could.
    let recovered = false;
    for (let fed = 0; fed < 400 && !recovered; fed += 1) recovered = machine.feed(fed % 5 === 4 ? 18.5 : 16.7);
    expect(recovered).toBe(true);
    expect(machine.tier).toBe('high');
  });

  test('a 60 Hz display throttled to 30 fps: a steady ~33 ms never recovers', () => {
    const machine = new QualityTierMachine();
    slowWindow(machine, 33.4);
    slowWindow(machine, 33.4);
    expect(machine.tier).toBe('low');
    // Against the refresh-relative bar alone a steady stream always counts as
    // holding vsync (its own estimate reads 33 ms); the absolute downgrade bar
    // caps the recovery bar, so the throttle stays low instead of recovering
    // into a downgrade on the next window.
    for (let fed = 0; fed < 500; fed += 1) machine.feed(33.3);
    expect(machine.tier).toBe('low');
    expect(machine.recoveryUsed).toBe(false);
  });

  test('recovery happens at most once per scene load: a second slowdown never recovers', () => {
    const machine = new QualityTierMachine();
    slowWindow(machine);
    slowWindow(machine);
    for (let fed = 0; fed < 625; fed += 1) machine.feed(8);
    expect(machine.tier).toBe('high');
    slowWindow(machine);
    slowWindow(machine);
    expect(machine.tier).toBe('low');
    for (let fed = 0; fed < 1000; fed += 1) machine.feed(8);
    expect(machine.tier).toBe('low');
    expect(machine.recoveryUsed).toBe(true);
  });

  test('a gap beyond the motion limit is a burst break: it feeds nothing and slows nothing', () => {
    const machine = new QualityTierMachine();
    // 30 rest gaps of 300 ms: 9 s of wall time, no motion samples, still high.
    for (let fed = 0; fed < 30; fed += 1) expect(machine.feed(300)).toBe(false);
    expect(machine.tier).toBe('high');
    // And the gap did not count towards a slow window: two slow windows after it downgrade.
    slowWindow(machine);
    slowWindow(machine);
    expect(machine.tier).toBe('low');
  });

  test('reset() starts the scene over: the starting tier, a fresh recovery, fresh windows', () => {
    const machine = new QualityTierMachine();
    slowWindow(machine);
    slowWindow(machine);
    for (let fed = 0; fed < 625; fed += 1) machine.feed(8);
    expect(machine.recoveryUsed).toBe(true);
    machine.reset();
    expect(machine.tier).toBe('high');
    expect(machine.recoveryUsed).toBe(false);
    // One slow window is no longer enough: the count restarted.
    slowWindow(machine);
    expect(machine.tier).toBe('high');
    slowWindow(machine);
    expect(machine.tier).toBe('low');
  });
});
