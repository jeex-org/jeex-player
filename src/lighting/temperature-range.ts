/**
 * The colour temperature range of the lighting standard, on its own: the
 * standard publishes it as `LIGHTING_STANDARD.temperature`, and the few
 * modules that only judge a temperature (`colour-temperature.ts`, the
 * custom element's handle before its viewer starts) read it from here, so
 * judging a number does not load the rest of the standard.
 *
 * Pure module: no `three`, no DOM.
 */

/** Kelvin, whole steps; `default: null` is «Original» (no conversion). */
export const TEMPERATURE_RANGE = Object.freeze({
  min: 2700,
  max: 6500,
  step: 100,
  default: null,
});
