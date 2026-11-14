/**
 * The walk chain's glow stage: three's `UnrealBloomPass` (a luminance high
 * pass, five progressively halved Gaussian mips, one weighted composite added
 * over the picture), aimed at a threshold the lighting standard defines in
 * display-referred units.
 *
 * Reach invariant: the halo takes only the `mips` narrowest mips. A mip's
 * blur is a fixed kernel in its own texels, so its reach is a fixed number
 * of picture pixels, and the widest mips lift dark things far from a source;
 * the halo of a picture of another size has the same extent in pixels, not
 * the same share of the frame.
 *
 * Threshold invariant: the stage reads the linear picture BEFORE the output
 * pass applies the camera balance and the exposure (`walk-post.ts`), so the
 * display threshold is turned into the linear one per draw: divided by the
 * renderer's exposure and by the balance's gain on a neutral grey
 * (`glowThreshold`). A room the balance opens up glows where its surfaces
 * display as bright, not where their linear light is; a capture is aimed by
 * the balance of its own camera, as the output pass that follows it is.
 *
 * Loaded only with the walk chunk: like `walk-post.ts`, it imports three's
 * post-processing addons.
 */

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Mat3 } from './white-balance.js';

/** Rec. 709 luminance weights, the ones three's high pass judges a texel by. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * The linear luminance the stage must treat as `display` (a pre-tone-mapping
 * display value): `display` over the exposure and over the luminance the
 * balance `balance` (row-major) gives a linear grey of luminance 1.
 */
export function glowThreshold(display: number, exposure: number, balance: Mat3): number {
  let gain = 0;
  for (let row = 0; row < 3; row += 1) gain += LUMA[row]! * (balance[row * 3]! + balance[row * 3 + 1]! + balance[row * 3 + 2]!);
  return display / (exposure * gain);
}

/** The stage's tuning, display-referred (`WALK_POST_TUNING.bloom`). */
export type GlowTuning = { threshold: number; knee: number; mips: number; strength: number; radius: number };

/** The bloom pass with its threshold and knee in display units, aimed per draw by `aim`. */
export class GlowPass extends UnrealBloomPass {
  private readonly tuning: GlowTuning;

  constructor(tuning: GlowTuning) {
    // The size is the composer's to set (`EffectComposer.addPass` sizes every pass).
    super(new THREE.Vector2(1, 1), tuning.strength, tuning.radius, tuning.threshold);
    this.tuning = tuning;
    for (const tint of this.bloomTintColors.slice(tuning.mips)) tint.setScalar(0);
  }

  /** Aims the high pass for a picture shown at `exposure` through `balance`: the threshold and its soft knee, linear. */
  aim(exposure: number, balance: Mat3): void {
    const threshold = glowThreshold(this.tuning.threshold, exposure, balance);
    this.threshold = threshold;
    (this.highPassUniforms as Record<string, THREE.IUniform<number>>)['smoothWidth']!.value = threshold * this.tuning.knee;
  }
}
