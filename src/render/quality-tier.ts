/**
 * Render quality tiers: the two settings sets the walk and tour renderer runs
 * on, and the pure state machine that picks one when the host left the choice
 * to the viewer (`quality: 'auto'`).
 *
 * `high` is the behaviour every delivery before quality tiers shipped; `low`
 * trades drawing-buffer resolution for frame rate on a slow device. The
 * settings below are the drawing buffer's pixel-ratio cap, the occlusion
 * buffer's resolution, the GTAO ray count, the denoise's samples and radius,
 * and the probes' bake pace; today the tiers differ in the cap and the bake
 * pace only, the occlusion being the same on both. The tone curve, the exposure, the
 * sun and its 2048-texel shadow, the lamp occlusion, the sky, SMAA and the
 * half-float targets are identical on every tier — and so is the probes'
 * capture edge, which the probe atlas pins (see `probeSize` below).
 *
 * The machine is fed one interval per DRAWN frame — the time between two
 * consecutive drawn frames, in milliseconds, tracked by the caller that owns
 * the frame clock. Walk and tour draw only when the camera moves
 * (render-on-demand), so drawn frames ARE motion frames; a gap too long to be
 * a frame interval is the camera resting, and feeds nothing. Start-up
 * (compile, decode, probe capture, bake) is excluded the same way, one level
 * up: sampling arms only once the room lighting is live
 * (`app/quality-control.ts`, the same gate `dev/meter.ts` waits on).
 *
 * Pure module: no `three`, no DOM.
 */

/** The two tiers. */
export type QualityTierName = 'low' | 'high';
/** How the tier is chosen: `auto` runs the frame-time machine, `fixed` pins a tier. */
export type QualityMode = 'auto' | 'fixed';
/** The mount option's union, before it becomes a mode. */
export type QualityOption = 'auto' | 'low' | 'high';

/** The debug readout (`__viewerDebug.quality()`): the mode in force and the tier it answers with now. */
export type QualityDebug = { mode: QualityMode; tier: QualityTierName };

/**
 * The per-tier settings. Every `low` value here is a starting point, not a
 * measurement: the owner-phone measurement of this delivery may fix the final
 * numbers, and each one is commented with what it buys.
 */
export const QUALITY_TIERS = Object.freeze({
  high: Object.freeze({
    /** Today's drawing-buffer cap — the runtime's default is this value, so the number has one home (`render-runtime.ts`): above it the fill cost outgrows the visible gain. */
    pixelRatioCap: 1.7,
    /** The occlusion buffer at the drawing buffer's full resolution (`walk-post.ts`). */
    aoResolutionScale: 1,
    denoise: Object.freeze({ depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 }),
    /** Three's `GTAOPass` default ray count. */
    gtaoSamples: 16,
    /** The room reflection probe's cube edge, texels — the probe atlas's tile invariant pins it on every tier (`walk-lighting/room-probes.ts`). */
    probeSize: 128,
    /** Grid probes baked per frame (`walk-lighting-tuning.ts`). */
    probesPerFrame: 6,
  }),
  low: Object.freeze({
    /** A quarter less fill in each direction; the largest single win on a phone GPU. */
    pixelRatioCap: 1.25,
    /** The full occlusion buffer: any smaller one leaves stair-stepped halos on door and table edges, because the blend's bilinear upsampling crosses depth (`walk-post.ts`; 0.75 showed it in a 2x crop). A depth-aware upsample comes first. */
    aoResolutionScale: 1,
    /**
     * The occlusion is high's: half the GTAO rays with a denoise of radius 4 /
     * 8 samples left dark, grainy blotches round furniture and along floor
     * edges on a Mali-G57 phone. The fill saving above is the tier's cost cut.
     */
    denoise: Object.freeze({ depthPhi: 0.05, normalPhi: 8, lumaPhi: 10, radius: 6, samples: 16 }),
    gtaoSamples: 16,
    /**
     * NOT a tier knob, whatever the tier: the probe atlas's tile invariant
     * pins the capture edge — a 128 px probe's PMREM output is exactly one
     * atlas tile, and any other edge throws in `RoomProbes.step`
     * (`walk-lighting/room-probes.ts`). Only the bake pace below is the
     * tier's; a tier-aware atlas is a redesign, out of scope.
     */
    probeSize: 128,
    /** Two thirds of the bake pace: the bake takes longer, the direct look covers it. */
    probesPerFrame: 4,
  }),
});

/** The tier a session starts on: `auto` begins on the full look and earns its way down. */
export function startingTier(quality: QualityOption): QualityTierName {
  return quality === 'low' ? 'low' : 'high';
}

/**
 * The lighting overrides a starting tier hands the walk lighting's build
 * (`app/walk-lighting-controller.ts`'s `loadWalkLighting`): the bake pace and
 * nothing else — the probes' capture edge is the atlas invariant's, not the
 * tier's (see `QUALITY_TIERS.low.probeSize`).
 */
export function walkLightingOverridesFor(tier: QualityTierName): { probesPerFrame: number } {
  return { probesPerFrame: QUALITY_TIERS[tier].probesPerFrame };
}

/** The machine's shape, in one place. */
export const QUALITY_TUNING = Object.freeze({
  /** A downgrade window: 2 s of drawn-frame (motion) intervals. */
  windowMs: 2000,
  /** A window whose p75 frame interval exceeds this many milliseconds counts as slow. */
  downgradeP75Ms: 18,
  /** A recovery window: the next 5 s of drawn-frame (motion) intervals after the downgrade. */
  recoveryWindowMs: 5000,
  /**
   * The recovery bar's FLOOR, in milliseconds: however fast the estimated
   * refresh reads, a p75 at or over this never recovers, so a 120 Hz-class
   * device must actually hold its high rate (an interval at twice its vsync
   * sits over the floor) instead of recovering on idle-speed frames.
   */
  recoveryP75Ms: 11,
  /** How far over the estimated refresh period a window's p75 may sit and still count as holding vsync. */
  recoveryRefreshSlack: 1.02,
  /**
   * Drawn-frame intervals the display's refresh period is estimated from: the
   * 10th percentile of the last this many, so a fifth of dropped frames
   * cannot drag the estimate off the panel's vsync (at 16.7 ms that is a
   * little under 5 s of motion — the estimate is fully refreshed before the
   * first 5 s recovery verdict can close).
   */
  refreshSamples: 240,
  /** The refresh-period estimate's clamp, in milliseconds. */
  refreshClampMs: Object.freeze({ min: 4, max: 50 }),
  /**
   * An interval above this many milliseconds is not a slow frame but the
   * camera resting (at 4 fps a draw is 250 ms from its neighbour): a burst
   * break that feeds nothing. `plan2d`'s 500 ms keep-warm heartbeat never
   * counts either.
   */
  motionGapMs: 250,
});

/** The nearest-rank 75th percentile of `samples` (a copy, never the caller's array). */
function p75(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.75) - 1]!;
}

/** The nearest-rank 10th percentile of `samples` (a copy, never the caller's array). */
function p10(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.1) - 1]!;
}

/**
 * The auto tier machine. Two consecutive 2 s windows of motion with a p75
 * frame interval above 18 ms downgrade to `low`; back to `high` when a 5 s
 * window of motion holds its p75 at or under the display's refresh period —
 * at most ONCE per scene load, so a device that slowed again after recovering
 * is not trusted a second time. `reset()` starts a new scene load over.
 *
 * The recovery bar is relative to the display because the machine is fed rAF
 * tick deltas, and vsync bounds them from below: on a 60 Hz display every
 * drawn interval is at least ~16.7 ms, so an absolute 11 ms bar can never
 * fire there and one downgrade would last the scene. The machine estimates
 * the refresh period itself — the 10th percentile of its recent drawn
 * intervals, clamped to [4, 50] ms — and recovers when the window's p75 sits
 * under `max(11, 1.02 x estimate)`: on 60 Hz that is ≤ ~17 ms (holding
 * vsync), on 90 Hz ≤ ~11.3, and the 11 ms floor keeps 120 Hz-class devices
 * honest. The absolute 18 ms downgrade bar caps the recovery bar: a steady
 * ~33 ms reader (a display or browser throttled to 30 fps) is over it, so it
 * stays low instead of recovering into a downgrade on the next window.
 */
export class QualityTierMachine {
  private current: QualityTierName;
  private readonly starting: QualityTierName;
  private hasRecovered = false;
  private slowWindows = 0;
  private window: number[] = [];
  private windowSpan = 0;
  private recovery: number[] = [];
  private recoverySpan = 0;
  /** The last `QUALITY_TUNING.refreshSamples` drawn-frame intervals, for the refresh-period estimate. */
  private recent: number[] = [];

  constructor(starting: QualityTierName = 'high') {
    this.starting = starting;
    this.current = starting;
  }

  get tier(): QualityTierName {
    return this.current;
  }

  /** Whether the single recovery per scene load was spent. */
  get recoveryUsed(): boolean {
    return this.hasRecovered;
  }

  /**
   * One drawn frame: `intervalMs` since the previous drawn frame. Answers
   * whether the tier changed, so the caller applies the tier once.
   */
  feed(intervalMs: number): boolean {
    // The camera rested between the frames: a gap in the motion, not a slow
    // frame. The current window keeps waiting for more motion.
    if (intervalMs > QUALITY_TUNING.motionGapMs) return false;
    this.recent.push(intervalMs);
    if (this.recent.length > QUALITY_TUNING.refreshSamples) this.recent.shift();
    if (this.current === 'high') return this.watchDowngrade(intervalMs);
    return this.watchRecovery(intervalMs);
  }

  /**
   * A new scene load: the starting tier, a fresh recovery, fresh windows. The
   * display's estimated refresh survives — the scene restarted, the panel
   * did not.
   */
  reset(): void {
    this.current = this.starting;
    this.hasRecovered = false;
    this.slowWindows = 0;
    this.window = [];
    this.windowSpan = 0;
    this.recovery = [];
    this.recoverySpan = 0;
  }

  /** High: two consecutive slow 2 s windows downgrade. */
  private watchDowngrade(intervalMs: number): boolean {
    this.window.push(intervalMs);
    this.windowSpan += intervalMs;
    if (this.windowSpan < QUALITY_TUNING.windowMs) return false;
    const slow = p75(this.window) > QUALITY_TUNING.downgradeP75Ms;
    this.window = [];
    this.windowSpan = 0;
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    if (slow && this.slowWindows >= 2) {
      this.current = 'low';
      this.slowWindows = 0;
      this.recovery = [];
      this.recoverySpan = 0;
      return true;
    }
    return false;
  }

  /**
   * Low: a 5 s window of motion under the refresh-relative bar recovers, once
   * per scene load. The window is CONSECUTIVE, not rolling: a verdict — fast
   * or slow — empties it, and the next one starts fresh.
   */
  private watchRecovery(intervalMs: number): boolean {
    if (this.hasRecovered) return false;
    this.recovery.push(intervalMs);
    this.recoverySpan += intervalMs;
    if (this.recoverySpan < QUALITY_TUNING.recoveryWindowMs) return false;
    const p = p75(this.recovery);
    // Either way the window empties: a verdict needs a full 5 s of motion,
    // so a marginal 5 s cannot ride on the samples before it.
    this.recovery = [];
    this.recoverySpan = 0;
    // The absolute downgrade bar caps the refresh-relative one: a p75 over it
    // would only downgrade again on the next window (the throttled-30 fps
    // reader), and recovery must mean the device would hold `high`.
    const bar = Math.max(QUALITY_TUNING.recoveryP75Ms, QUALITY_TUNING.recoveryRefreshSlack * this.refreshEstimate());
    if (p < bar && p < QUALITY_TUNING.downgradeP75Ms) {
      this.current = 'high';
      this.hasRecovered = true;
      return true;
    }
    return false;
  }

  /** The display's refresh period, ms: the 10th percentile of the recent drawn intervals, clamped. */
  private refreshEstimate(): number {
    if (this.recent.length === 0) return QUALITY_TUNING.refreshClampMs.min;
    const estimate = p10(this.recent);
    return Math.min(QUALITY_TUNING.refreshClampMs.max, Math.max(QUALITY_TUNING.refreshClampMs.min, estimate));
  }
}
