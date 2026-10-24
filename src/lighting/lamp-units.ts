/**
 * The one conversion of a lamp's nominal lumens (the `lights` fact of a
 * project variant) into what a renderer draws, shared by the player and the
 * lightmap bake so the two never disagree about a lamp.
 *
 * The lumens are NOMINAL: they mean something only against
 * `LIGHTING_STANDARD.lamp.exposure`, which is calibrated so 400 lm reads as
 * 1.2 cd (the bank table lamp), not the physical 400 / 4π ≈ 31.8 cd.
 *
 * Pure module: no `three`, no DOM.
 */

import { LIGHTING_STANDARD } from './lighting-standard.js';

/** A three.js `PointLight` intensity, candela, for a lamp of `lumens` nominal lumens. */
export function lampCandela(lumens: number): number {
  return (lumens / (4 * Math.PI)) * LIGHTING_STANDARD.lamp.exposure;
}

/**
 * The power, watts as Blender's point lamp reads them, of a light of
 * `candela`: 4π · cd. Unconfirmed: the calibration room's lamp landmark checks
 * this convention before the first baked lamp relies on it.
 */
export function blenderPower(candela: number): number {
  return 4 * Math.PI * candela;
}
