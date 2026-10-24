/**
 * The `jeex-viewer/lighting` entry: the lighting standard every application
 * that renders JEEX content uses, so a material looks the same in asset
 * review, store previews and the player.
 *
 * It imports no three.js and touches no DOM: the caller passes its own
 * three.js namespace (revision 186) and renderer to `createLightingContext`,
 * and every object is built with them.
 */

export { colourTemperatureRgb, isLightTemperature } from './colour-temperature.js';
export { createLightingContext } from './lighting-context.js';
export { blenderPower, lampCandela } from './lamp-units.js';
export type { ApartmentRig, LightingContext, LightingRig, LightingRigKind } from './lighting-context.js';
export { LightingError, LIGHTING_ERROR_CODES } from './lighting-error.js';
export type { LightingErrorCode } from './lighting-error.js';
export { LIGHTING_STANDARD, LIGHTING_STANDARD_VERSION } from './lighting-standard.js';
export type { DeepReadonly, EnvironmentPanel, EnvironmentRecipe, LightingStandard, SunAngles, Triple } from './lighting-standard.js';
export { fitShadowFrustum } from './shadow-fit.js';
export type { ShadowBox, ShadowFit } from './shadow-fit.js';
export { LEGACY_SUN_DIRECTION, sunDirection } from './sun-direction.js';
export type { SunDirection, SunOrientation, SunPresetName } from './sun-direction.js';
export type { ApartmentRigOptions } from './lighting-options.schema.js';
export type { LightingRenderer, LightingScene, LightingThree } from './lighting-three.js';
