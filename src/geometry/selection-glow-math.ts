/**
 * The pure maths behind the selection aura: the cyclic gradient, the breathing
 * and fade curves, and the envelope geometry (padding, merging, rounding) that
 * turns a furniture object's mesh boxes into a handful of soft-edged boxes.
 *
 * Nothing here touches `three` or the DOM — it is the CPU mirror of the GLSL
 * in `selection-glow-shader.ts`, tested directly and reused by
 * `selection-glow.ts` (the Three.js shell that builds the actual meshes and
 * material) so the numbers the shader marches against and the numbers a test
 * asserts on are the same function.
 */

import { easeInOutCubic } from '../shared/easing.js';
import { smoothstep } from '../shared/math.js';
import { parseHex } from '../materials/texture-noise.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Cyclic gradient stops, in order. The gradient wraps from the last stop back to the first. */
export const GLOW_COLORS = ['#2f6bff', '#4fe8ff', '#a463ff'] as const;

/**
 * Metres over which the mist thins from full density at the core envelope to nothing outside it.
 * This is the whole reason the aura has no edge: make it small and the haze turns back into a
 * shell with a visible outline.
 */
export const HAZE_EDGE_SOFTNESS = 0.17;
/** Extinction per metre of mist. Higher = the haze goes opaque over a shorter path. */
export const HAZE_ABSORPTION = 1.6;
/** Peak opacity after the march, before breathing and the fade. Deliberately low: mist, not film. */
export const HAZE_PEAK_OPACITY = 0.3;
/** Samples taken along the view ray through one envelope. Jittered, so ten stays smooth. */
export const HAZE_STEPS = 10;

/** Noise cycles per world metre. Higher = finer wisps. */
export const HAZE_NOISE_SCALE = 1.6;
/** Noise-space units the density field drifts per second (upwards, like smoke). */
export const HAZE_NOISE_SPEED = 0.13;
/** How much of the density the noise may eat, 0..1. 0 = uniform film, 1 = fully wispy. */
export const HAZE_DENSITY = 0.9;

/** Weight of the slow wandering brightening that replaced the travelling band. */
export const DRIFT_GAIN = 0.5;

/** Breathing multiplier bounds: peak-to-trough intensity swing as a fraction of full intensity. */
export const BREATH_DEPTH = 0.16;
/** Peak-to-trough envelope swell, as a fraction of the envelope scale. */
export const BREATH_SCALE_DEPTH = 0.014;
/**
 * Breathing rate in radians per second (~0.24 Hz — slow enough to never read as flicker).
 * Exported: `selection-glow.ts`'s material also drives its shader uniform from this same number.
 */
export const BREATH_SPEED = 1.5;

/** Envelope scale at zero intensity; the aura grows to 1 as it fades in. */
export const FADE_SCALE_FROM = 0.9;

/** Metres the dense core of the aura extends past the object on every side. */
export const AURA_PADDING = 0.09;
/**
 * Corner radius of the core envelope as a fraction of its *smallest* extent. Small on purpose: the
 * silhouette must still follow the object's overall shape, so this is a softened corner, never a
 * capsule.
 */
export const AURA_ROUNDNESS = 0.16;
/** Absolute cap on that corner radius, in metres, so a big object never gets pill corners. */
export const AURA_MAX_RADIUS = 0.07;
/** Envelopes per selection after merging. Keeps a 15-mesh sofa down to a readable cloud. */
export const AURA_MAX_PARTS = 3;
/** Smallest envelope side in metres, so a rug or a picture frame still gets a cloud. */
export const AURA_MIN_EXTENT = 0.18;

/** Shortest gradient period, so tiny props do not get a compressed rainbow. */
export const MIN_SWEEP_LENGTH = 0.6;
/** Headroom added to the object height when deriving the gradient period. */
const SWEEP_HEADROOM = 0.25;

// ---------------------------------------------------------------------------
// Pure helpers (mirrored by the GLSL in `selection-glow-shader.ts`)
// ---------------------------------------------------------------------------

function fract(value: number): number {
  return value - Math.floor(value);
}

type GradientSample = { from: number; to: number; mix: number };

/**
 * Resolves a gradient position to the two `GLOW_COLORS` stops it sits between and the
 * eased blend weight. `t` is cyclic: `gradientStopsAt(t)` equals `gradientStopsAt(t + 1)`.
 */
export function gradientStopsAt(t: number): GradientSample {
  const stops = GLOW_COLORS.length;
  const scaled = fract(t) * stops;
  const from = Math.min(stops - 1, Math.floor(scaled));
  return { from, to: (from + 1) % stops, mix: smoothstep(scaled - from) };
}

/** Same gradient, resolved to sRGB components in 0..1 — the CPU mirror of `iridescent()`. */
export function iridescentAt(t: number): [number, number, number] {
  const { from, to, mix } = gradientStopsAt(t);
  // `parseHex` yields 0..255 components; shader colours are 0..1.
  // `gradientStopsAt` clamps `from` into the palette and takes `to` modulo it.
  const a = parseHex(GLOW_COLORS[from]!);
  const b = parseHex(GLOW_COLORS[to]!);
  return [(a.r + (b.r - a.r) * mix) / 255, (a.g + (b.g - a.g) * mix) / 255, (a.b + (b.b - a.b) * mix) / 255];
}

/**
 * Density of the mist at a signed distance from the core envelope, in metres — the CPU mirror of
 * the fragment shader's `smoothstep(feather, 0, sd)`. 1 inside the core, easing to 0 `feather`
 * metres outside it. The width of that ramp is the entire difference between a haze and a shell.
 */
export function hazeDensityAt(distance: number, feather = HAZE_EDGE_SOFTNESS): number {
  if (!(feather > 0)) return distance <= 0 ? 1 : 0;
  return smoothstep((feather - distance) / feather);
}

/** Breathing multiplier on intensity, always inside `[1 - BREATH_DEPTH, 1]`. */
export function breathAt(timeSeconds: number): number {
  return 1 - BREATH_DEPTH + BREATH_DEPTH * (0.5 + 0.5 * Math.sin(timeSeconds * BREATH_SPEED));
}

/** Breathing multiplier on envelope scale, centred on 1. */
export function breathScaleAt(timeSeconds: number): number {
  return 1 + BREATH_SCALE_DEPTH * Math.sin(timeSeconds * BREATH_SPEED);
}

/** Gradient period for an object of the given height, so one hue cycle spans roughly the object. */
export function sweepLengthFor(height: number): number {
  return Math.max(MIN_SWEEP_LENGTH, height + SWEEP_HEADROOM);
}

// --- fade ------------------------------------------------------------------

/**
 * Ease used by both fades. Slow start, slow end, exactly 0.5 at the midpoint,
 * clamped outside 0..1 so a stale clock can never overshoot.
 */
export function fadeEase(t: number): number {
  return easeInOutCubic(t);
}

/** Normalised progress through a fade. A zero or negative duration is already finished. */
export function fadeProgress(elapsedSeconds: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) return 1;
  return Math.min(1, Math.max(0, elapsedSeconds / durationSeconds));
}

/** Envelope scale multiplier for a fade intensity: the aura swells slightly as it lights up. */
export function fadeScaleAt(intensity: number): number {
  const clamped = Math.min(1, Math.max(0, intensity));
  return FADE_SCALE_FROM + (1 - FADE_SCALE_FROM) * clamped;
}

// --- envelopes -------------------------------------------------------------

/**
 * Component triple in the furniture group's local space. Deliberately NOT
 * `types.Vec3` (`{ x, y, z }`): every envelope helper below folds over the three
 * axes by index, and the uniforms it feeds are packed the same way.
 */
export type Vec3Tuple = readonly [number, number, number];
/** Axis-aligned box in the furniture group's local space. */
export type AuraBox = { min: Vec3Tuple; max: Vec3Tuple };

/**
 * The three axes as literal indices. Iterating these rather than `0..2` is what
 * lets `Vec3Tuple[axis]` type as `number`: a `number` index into a 3-tuple is
 * `number | undefined` under `noUncheckedIndexedAccess`, a `0 | 1 | 2` is not.
 */
export const AXES = [0, 1, 2] as const;
/** A rounded envelope: where to put one rounded box and how big to make it. */
export type AuraEnvelope = { centre: Vec3Tuple; size: Vec3Tuple };

/** Grows a box by `padding` on every side. */
export function padAuraBox(box: AuraBox, padding = AURA_PADDING): AuraBox {
  return {
    min: [box.min[0] - padding, box.min[1] - padding, box.min[2] - padding],
    max: [box.max[0] + padding, box.max[1] + padding, box.max[2] + padding],
  };
}

/** Smallest box holding both inputs. */
export function unionAuraBox(a: AuraBox, b: AuraBox): AuraBox {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** True when `inner` fits entirely inside `outer`. */
export function auraBoxContains(outer: AuraBox, inner: AuraBox): boolean {
  for (const axis of AXES) {
    if (inner.min[axis] < outer.min[axis] || inner.max[axis] > outer.max[axis]) return false;
  }
  return true;
}

/** Volume of a box; never negative. */
export function auraBoxVolume(box: AuraBox): number {
  let volume = 1;
  for (const axis of AXES) volume *= Math.max(0, box.max[axis] - box.min[axis]);
  return volume;
}

/**
 * Turns the per-mesh boxes of one furniture object into at most `maxParts` envelope boxes:
 * boxes contained in another are dropped, then the pair whose union wastes the least volume is
 * merged repeatedly. A bed's base, mattress, pillows and blanket collapse into a couple of
 * clouds instead of ten, which is what keeps the aura from tracing every panel.
 */
export function reduceAuraBoxes(boxes: readonly AuraBox[], maxParts = AURA_MAX_PARTS): AuraBox[] {
  // Largest first, so a box is only ever dropped in favour of one that is already kept —
  // duplicates collapse to a single survivor instead of eliminating each other.
  const kept: AuraBox[] = [];
  for (const candidate of [...boxes].sort((a, b) => auraBoxVolume(b) - auraBoxVolume(a))) {
    if (kept.some((other) => auraBoxContains(other, candidate))) continue;
    kept.push(candidate);
  }

  const limit = Math.max(1, Math.floor(maxParts));
  while (kept.length > limit) {
    let bestI = 0;
    let bestJ = 1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < kept.length; i += 1) {
      const boxI = kept[i]!;
      for (let j = i + 1; j < kept.length; j += 1) {
        // Both indices are bounded by `kept.length`.
        const boxJ = kept[j]!;
        const merged = unionAuraBox(boxI, boxJ);
        const cost = auraBoxVolume(merged) - auraBoxVolume(boxI) - auraBoxVolume(boxJ);
        if (cost < bestCost) {
          bestCost = cost;
          bestI = i;
          bestJ = j;
        }
      }
    }
    // `bestI`/`bestJ` were set from the same bounded loops (or seeded 0 and 1,
    // and the `while` above only runs while `kept.length > limit >= 1`).
    const merged = unionAuraBox(kept[bestI]!, kept[bestJ]!);
    kept.splice(bestJ, 1);
    kept.splice(bestI, 1);
    kept.push(merged);
  }
  return kept;
}

/**
 * Envelope for one box: padded on every side, never thinner than `AURA_MIN_EXTENT`, and cut off
 * at `groundY` so a floor-standing object's haze lands on the floor rather than under it.
 * Sizes are in the same units as the box.
 */
export function auraEnvelopeFor(
  box: AuraBox,
  padding = AURA_PADDING,
  minExtent = AURA_MIN_EXTENT,
  groundY = Number.NEGATIVE_INFINITY,
): AuraEnvelope {
  const padded = padAuraBox(box, padding);
  const onAxis = (axis: (typeof AXES)[number]): { centre: number; size: number } => {
    const grow = Math.max(0, minExtent - (padded.max[axis] - padded.min[axis])) / 2;
    const high = padded.max[axis] + grow;
    // Y only: the envelope never sinks below the floor it stands on.
    const low = axis === 1 ? Math.min(high, Math.max(padded.min[axis] - grow, groundY)) : padded.min[axis] - grow;
    return { centre: (low + high) / 2, size: high - low };
  };
  const [x, y, z] = [onAxis(0), onAxis(1), onAxis(2)];
  return { centre: [x.centre, y.centre, z.centre], size: [x.size, y.size, z.size] };
}

/**
 * Corner radius for an envelope of this size, in the same units as the size. It is a *fraction of
 * the smallest extent* (so a thin slab gets a thin fillet, not a pill), capped in absolute terms by
 * `maxRadius` (so a wardrobe does not get 20 cm corners) and always kept under half the smallest
 * extent, where the rounded-box distance field degenerates.
 */
export function auraCornerRadiusFor(size: Vec3Tuple, roundness = AURA_ROUNDNESS, maxRadius = AURA_MAX_RADIUS): number {
  const smallest = Math.max(0, Math.min(size[0], size[1], size[2]));
  if (smallest <= 0) return 0;
  const fraction = Math.min(0.5, Math.max(0, roundness));
  return Math.min(smallest * fraction, Math.max(0, maxRadius), smallest * 0.49);
}

/**
 * Size of the proxy box that has to be rendered for a core envelope: the core grown by the feather
 * on every side, so the whole soft field is inside the geometry the ray march runs on.
 */
export function hazeProxySize(size: Vec3Tuple, feather = HAZE_EDGE_SOFTNESS): Vec3Tuple {
  const grow = Math.max(0, feather) * 2;
  return [Math.max(1e-3, size[0] + grow), Math.max(1e-3, size[1] + grow), Math.max(1e-3, size[2] + grow)];
}
