/**
 * The viewer's one quality tier: what the mount option starts, what the
 * host's `setQuality` and the element's live attribute retune, and what the
 * debug surface reads.
 *
 * `auto` runs the pure machine (`render/quality-tier.ts`), fed one interval
 * per DRAWN frame by the runtime's post-render hook (`viewer-stage.ts`).
 * Sampling arms only once the room lighting is live — the same gate
 * `dev/meter.ts` waits on — so start-up (compile, decode, probe capture,
 * bake) is never measured as slow motion. `low` and `high` pin a tier and
 * feed nothing.
 *
 * Applying a tier moves ONLY what the tier owns: the runtime's pixel-ratio
 * cap and the walk chain's occlusion inputs. The bake pace is read ONCE, at
 * the lighting build, from the tier in force then (`loadWalkLighting`); the
 * probes' capture edge is the probe atlas's invariant and never varies. A
 * tier switch never rebakes and never reloads.
 *
 * Invariant: the value is valid by construction. Anything but `auto`, `low`
 * or `high` throws `bad-params` naming `quality` and changes nothing; an
 * unchanged mode re-applies its tier anyway — in `auto` the RUNNING machine
 * is kept, so a host that re-applies the option never undoes a downgrade or
 * restarts the recovery budget.
 */

import { requireQuality } from './quality-check.js';
import {
  QUALITY_TIERS,
  QualityTierMachine,
  type QualityDebug,
  type QualityMode,
  type QualityOption,
  type QualityTierName,
} from '../render/quality-tier.js';
import type { WalkPostTierInputs } from '../render/walk-post.js';
import type { RenderRuntime } from '../render/render-runtime.js';

/** Who this control applies the tier through, all of it late-bound. */
export type QualityControlDeps = {
  /** The resolved mount option `quality`. */
  initial: QualityOption;
  /** The runtime, once the stage exists; absent before the first boot and between boots. */
  runtime: () => RenderRuntime | undefined;
  /** Hands one tier's post inputs to the built walk chain (`walk-post-controller.ts`); false while there is none. */
  applyChainTier: (inputs: WalkPostTierInputs) => boolean;
  /** Whether the room lighting is live (`walk-lighting-controller.ts`): the machine's sampling arms only then. */
  lightingLive: () => boolean;
  /** The next tick draws (`render/render-demand.ts`). */
  invalidate: () => void;
};

/** The tier's post inputs, as the chain takes them. */
function postInputs(tier: QualityTierName): WalkPostTierInputs {
  const settings = QUALITY_TIERS[tier];
  return {
    aoResolutionScale: settings.aoResolutionScale,
    denoise: { ...settings.denoise },
    gtaoSamples: settings.gtaoSamples,
  };
}

export class QualityControl {
  private readonly deps: QualityControlDeps;
  /** Non-null while the option is `auto`; the machine owns the tier then. */
  private machine: QualityTierMachine | null;
  /** The pinned tier while the option is `low` or `high`; null in `auto`. */
  private fixed: QualityTierName | null;
  /** The last drawn frame's clock reading, for the interval the machine is fed; null across a rest or a disarm. */
  private lastDrawn: number | null = null;

  constructor(deps: QualityControlDeps) {
    this.deps = deps;
    // Construction applies nothing: the runtime and the chain are BUILT on the
    // starting tier (`viewer-stage.ts` reads this control); only a live
    // switch applies.
    if (deps.initial === 'auto') {
      this.machine = new QualityTierMachine('high');
      this.fixed = null;
    } else {
      this.machine = null;
      this.fixed = deps.initial;
    }
  }

  get mode(): QualityMode {
    return this.machine === null ? 'fixed' : 'auto';
  }

  get tier(): QualityTierName {
    return this.machine === null ? this.fixed! : this.machine.tier;
  }

  /** The drawing-buffer cap of the tier in force, for a runtime built now (`viewer-stage.ts`). */
  get pixelRatioCap(): number {
    return QUALITY_TIERS[this.tier].pixelRatioCap;
  }

  /** The walk chain's inputs of the tier in force, for a chain built now (`viewer-stage.ts`). */
  get chainInputs(): WalkPostTierInputs {
    return postInputs(this.tier);
  }

  /**
   * Sets the option; throws `bad-params` for a value that is not one of the
   * three. Setting `auto` while already auto keeps the RUNNING machine: a
   * host (or the element, when the attribute is removed) re-applying the
   * option must not undo a downgrade or restart the recovery budget. Only a
   * switch from a pinned tier constructs a new one.
   */
  set(value: unknown): void {
    const quality = requireQuality(value);
    if (quality === 'auto') {
      // Already auto: the running machine stays (a downgrade and the recovery
      // budget survive); only a switch from a pinned tier constructs one.
      this.machine ??= new QualityTierMachine('high');
      this.fixed = null;
    } else {
      this.machine = null;
      this.fixed = quality;
    }
    this.lastDrawn = null;
    this.apply();
  }

  /**
   * One drawn frame, from the runtime's post-render hook. Before the room
   * lighting is live the frame is start-up, not motion: nothing feeds, and
   * the next live frame anchors a fresh interval.
   */
  drawn(now: number): void {
    const machine = this.machine;
    if (machine === null) return;
    if (!this.deps.lightingLive()) {
      this.lastDrawn = null;
      return;
    }
    const previous = this.lastDrawn;
    this.lastDrawn = now;
    if (previous === null) return;
    if (machine.feed(now - previous)) this.apply();
  }

  /**
   * A tick that drew nothing (the post-render hook's skipped branch): demand
   * said "no draw", never that the device was slow, so the interval since the
   * last drawn frame is broken, not stretched — the next drawn frame anchors
   * a fresh one. A run of sporadic draws (a hover, a settle window) then
   * reads as no motion at all, not as slow motion.
   */
  skipped(): void {
    this.lastDrawn = null;
  }

  /** A new scene load: the machine starts over, and the screen follows the tier it restarts on. */
  newScene(): void {
    this.lastDrawn = null;
    if (this.machine === null) return;
    this.machine.reset();
    this.apply();
  }

  /** The debug readout (`__viewerDebug.quality()`). */
  debug(): QualityDebug {
    return { mode: this.mode, tier: this.tier };
  }

  /** Puts the tier in force onto the runtime and the chain, and asks for a frame. */
  private apply(): void {
    this.deps.runtime()?.setPixelRatioCap(this.pixelRatioCap);
    this.deps.applyChainTier(postInputs(this.tier));
    this.deps.invalidate();
  }
}
