/**
 * The one refusal of a light temperature a host hands the viewer: anything
 * but `null` («Original») or a whole step of kelvin inside the lighting
 * standard's range throws `bad-params` naming `lightTemperature`.
 *
 * Its own small module because two places judge the same call: the running
 * viewer (`light-temperature-control.ts`) and the element's handle before its
 * viewer has started (`embed/pending-viewer.ts`), which must not pull the
 * renderer in to say no.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError } from '../shared/errors.js';
import { isLightTemperature } from '../lighting/colour-temperature.js';
import { LIGHTING_STANDARD } from '../lighting/lighting-standard.js';

/** A refused value, as the refusal names it. */
function describe(value: unknown): string {
  return typeof value === 'number' ? String(value) : (JSON.stringify(value) ?? typeof value);
}

/** Answers `value` as a temperature, or throws `bad-params` (path `lightTemperature`). */
export function requireLightTemperature(value: unknown): number | null {
  if (value === null || isLightTemperature(value)) return value;
  const { min, max, step } = LIGHTING_STANDARD.temperature;
  throw new ViewerLibError(
    'bad-params',
    `setLightTemperature: lightTemperature must be null or a whole multiple of ${step} K from ${min} to ${max}, got ${describe(value)}`,
    { path: 'lightTemperature', detail: { value: describe(value) } },
  );
}
