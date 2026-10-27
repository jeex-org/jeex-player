/**
 * The colour temperature range of the lighting standard, on its own: the
 * standard publishes it as `LIGHTING_STANDARD.temperature`, and the few
 * modules that only judge a temperature (`colour-temperature.ts`, the
 * custom element's handle before its viewer starts) read it from here, so
 * judging a number does not load the rest of the standard.
 *
 * Pure module: no `three`, no DOM.
 */

/**
 * Kelvin, whole steps; `null` is «Original» (no conversion). The default is a
 * neutral 5000 K: the interiors read cool and modern, as professional interior
 * photographs of modern flats do; «Original» was the default until the
 * per-room camera balance arrived.
 */
export const TEMPERATURE_RANGE: Readonly<{ min: number; max: number; step: number; default: number | null }> = Object.freeze({
  min: 2700,
  max: 6500,
  step: 100,
  default: 5000,
});
