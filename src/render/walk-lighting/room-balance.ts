/**
 * The camera's white balance and exposure per room, the way an interior
 * photographer sets both for each room with a grey card: the light on a white
 * surface comes out near neutral whatever lights the room (warm lamps, a blue
 * sky through the window), every finish keeps its own colour, and a dim room
 * is opened up without flattening its window to white.
 *
 * Measurement (`measureProbe`): the six faces of a grey-card cube
 * (`room-sampler.ts`: every surface matte white), in scene-linear colour, so
 * a texel's colour is the light on it. The light is the mean of the texels
 * whose luminance lies between the `neutralQuantile` and the
 * `highlightQuantile` (the brightly lit surfaces, as a photograph is metered)
 * and whose display-encoded saturation, judged against the room's cast
 * (refined over `whitePasses`: the first takes the whole band), is under
 * `neutralSaturation`, so a coloured glow does not count. The sky through a
 * window and a glowing shade sit above the highlight quantile and stay out,
 * and the quantile itself is the highlight the exposure must keep below the
 * display maximum.
 *
 * Balance (`roomBalance`): one linear 3x3 matrix, the full white balance from
 * the measured white to the tuned warm-neutral tint, times the exposure gain;
 * the walk chain applies it before its tone mapping (`walk-post.ts`).
 *
 * Pure module: no `three`, no DOM.
 */

import { whiteBalanceMatrix, type Mat3, type Rgb } from '../white-balance.js';
import { WALK_LIGHTING_TUNING } from './walk-lighting-tuning.js';

/** What a probe measured: its neutral white (linear, luminance 1), their mean luminance, and the luminance at the highlight quantile. */
export type ProbeLight = { white: Rgb; level: number; highlight: number };

const B = WALK_LIGHTING_TUNING.balance;
const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The value at quantile `q` (0-1) of `values`, which it sorts. */
function quantile(values: Float32Array, q: number): number {
  values.sort();
  return values[Math.min(values.length - 1, Math.floor(values.length * q))]!;
}

/**
 * Measures the faces of a probe (linear RGBA, four floats per texel); `null`
 * when no texel reads as a lit neutral surface (an unlit room, or a
 * renderer that could not read the faces back).
 */
export function measureProbe(faces: readonly Float32Array[]): ProbeLight | null {
  const count = faces.reduce((sum, face) => sum + face.length / 4, 0);
  const lum = new Float32Array(count);
  let n = 0;
  for (const face of faces) for (let i = 0; i < face.length; i += 4) lum[n++] = luminance(face[i]!, face[i + 1]!, face[i + 2]!);
  const sorted = Float32Array.from(lum);
  const low = quantile(sorted, B.neutralQuantile);
  const high = quantile(sorted, B.highlightQuantile);
  if (!(high > 0)) return null;
  // The white is refined from the cast of the whole band: under a warm lamp a white wall is far
  // from grey, so saturation is judged against the current estimate, not against grey.
  let white: Rgb = [1, 1, 1];
  let level = 0;
  for (let pass = 0; pass < B.whitePasses; pass += 1) {
    const next = neutralMean(faces, lum, low, high, pass === 0 ? null : white);
    if (next === null) return null;
    [white, level] = next;
  }
  return { white, level, highlight: high };
}

/**
 * The mean of the band's texels whose colour, divided by `cast` (none on the
 * first pass), is under the neutral saturation: their white at luminance 1
 * and their mean luminance; `null` when none is.
 */
function neutralMean(faces: readonly Float32Array[], lum: Float32Array, low: number, high: number, cast: Rgb | null): [Rgb, number] | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let neutral = 0;
  let n = 0;
  for (const face of faces) {
    for (let i = 0; i < face.length; i += 4, n += 1) {
      const [r, g, b] = [face[i]!, face[i + 1]!, face[i + 2]!];
      if (lum[n]! < low || lum[n]! >= high) continue;
      if (cast !== null) {
        const [er, eg, eb] = [(r / cast[0]) ** (1 / 2.2), (g / cast[1]) ** (1 / 2.2), (b / cast[2]) ** (1 / 2.2)];
        const max = Math.max(er, eg, eb);
        if (max <= 0 || (max - Math.min(er, eg, eb)) / max >= B.neutralSaturation) continue;
      }
      red += r;
      green += g;
      blue += b;
      neutral += 1;
    }
  }
  if (neutral === 0) return null;
  const y = luminance(red, green, blue);
  if (!(y > 0)) return null;
  return [[red / y, green / y, blue / y], y / neutral];
}

/**
 * The room's camera matrix for a measured `light` under the walk `exposure`:
 * the white balance to the tuned tint, times the gain that brings the neutral
 * level to `targetLevel`, bounded by `maxGain` and by the highlight's
 * headroom; the gain never darkens.
 */
export function roomBalance(light: ProbeLight, exposure: number): Mat3 {
  const toWhite = whiteBalanceMatrix(light.white, 1);
  // The tint keeps luminance: red over blue of a grey becomes `tintRB`.
  const tint = [B.tintRB, 1, 1].map((c) => c / luminance(B.tintRB, 1, 1));
  const lift = B.targetLevel / (exposure * light.level);
  const headroom = B.highlightCap / (exposure * light.highlight);
  const gain = Math.max(1, Math.min(lift, B.maxGain, headroom));
  return toWhite.map((value, i) => value * tint[Math.floor(i / 3)]! * gain) as unknown as Mat3;
}

/** `from` moved towards `to` by `t` (0-1), entry by entry. */
export function blendBalance(from: Mat3, to: Mat3, t: number): Mat3 {
  return from.map((value, i) => value + (to[i]! - value) * t) as unknown as Mat3;
}

/** An entry closer than this to the target's has arrived. */
const SETTLED = 1e-3;

/**
 * The live balance easing towards a target: 95 % of the way in `blendMs`
 * (exponential), exactly the target once every entry is within `SETTLED`.
 * The first target is taken at once, as is any after a pause of `blendMs`
 * or more between steps (nothing was drawn meanwhile).
 */
export class EasedBalance {
  private live: Mat3 | null = null;
  private target: Mat3 | null = null;
  private at: number | null = null;

  /** The balance on screen now; `null` before the first target. */
  get value(): Mat3 | null {
    return this.live;
  }

  /** Eases towards `target` (`null` keeps the last one) at `now`, milliseconds; answers whether the balance changed. */
  step(target: Mat3 | null, now: number): boolean {
    this.target = target ?? this.target;
    const goal = this.target;
    const live = this.live;
    const elapsed = this.at === null ? Number.POSITIVE_INFINITY : now - this.at;
    this.at = now;
    if (goal === null || live === goal) return false;
    if (live === null || elapsed >= B.blendMs) {
      this.live = goal;
      return true;
    }
    const next = blendBalance(live, goal, 1 - Math.exp((-3 * elapsed) / B.blendMs));
    this.live = next.every((value, i) => Math.abs(value - goal[i]!) < SETTLED) ? goal : next;
    return true;
  }

  /** Forgets the balance: the next target is taken at once. */
  reset(): void {
    this.live = this.target = null;
    this.at = null;
  }
}
