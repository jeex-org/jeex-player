/**
 * The lighting standard as data: the display transform, the calibration
 * target, the generated environment and the values of both rigs.
 *
 * Invariant: this is the ONE place the numbers live. The context, the rigs,
 * the environment recipe and the tests all read them from here, and the object
 * is frozen at every depth, so a consumer reading the published description
 * cannot change what the next rig is built with. Any intentional change of the
 * look raises `LIGHTING_STANDARD_VERSION`, which consumers use in the cache
 * keys of their previews.
 *
 * Directions and positions are in three.js world axes: `+y` up, `+z` towards
 * the default camera ("front"), `+x` to its right. Azimuths of the environment
 * follow three's equirectangular mapping, `atan2(z, x)` in degrees.
 *
 * Pure module: no `three`, no DOM.
 */

/** Appearance version of the standard; raised with every intentional change of the look. */
export const LIGHTING_STANDARD_VERSION = 1;

/** A three-component vector as plain data. */
export type Triple = readonly [number, number, number];

/** A sun position as angles: azimuth clockwise from north, elevation above the horizon, degrees. */
export type SunAngles = { readonly azimuth: number; readonly elevation: number };

/** One soft rectangular panel of the environment, in azimuth and elevation. */
export type EnvironmentPanel = {
  /** Centre azimuth, degrees, `atan2(z, x)`. */
  readonly azimuth: number;
  /** Centre elevation above the horizon, degrees. */
  readonly elevation: number;
  /** Full width and height of the flat part, degrees. */
  readonly width: number;
  readonly height: number;
  /** Width of the smooth fall-off around the flat part, degrees. */
  readonly softness: number;
  /** Radiance added inside the panel, in the recipe's units. */
  readonly radiance: number;
};

/** The parameters of the generated grey studio environment. */
export type EnvironmentRecipe = {
  /** Equirectangular size in texels; the width is twice the height. */
  readonly width: number;
  readonly height: number;
  /** Radiance straight up, at the horizon and straight down, in the recipe's units. */
  readonly zenith: number;
  readonly horizon: number;
  readonly nadir: number;
  readonly panels: readonly EnvironmentPanel[];
};

/** `T` read-only at every depth, as `deepFreeze` makes it at runtime. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value as DeepReadonly<T>;
}

/**
 * The standard. Read-only at every depth.
 *
 * `environment.normalisation` is the `scene.environmentIntensity` that makes
 * the reference rig meet the calibration target: under PBR Neutral a linear
 * value `v` above 0.08 is displayed as `v - 0.04`, so a 0.18 Lambert patch
 * reads 0.18 when the light reaching it satisfies `E / π = 0.22 / 0.18`. The
 * white key supplies `1 / π` of that; the environment, scaled by this number,
 * supplies the rest. The value is the one the browser calibration test
 * measured (`tests/component/lighting-calibration.test.ts`); the analytic
 * integration of the recipe (`lighting-standard.test.ts`) agrees with it within
 * 15 %: three adds a rough dielectric's specular term to the Lambert term and
 * prefilters the environment with a GGX lobe rather than a cosine one.
 */
export const LIGHTING_STANDARD = deepFreeze({
  /** The three.js `REVISION` the standard is calibrated for; any other is refused. */
  engineRevision: '186',
  display: {
    toneMapping: 'neutral',
    exposure: 1,
    outputColourSpace: 'srgb',
    workingColourSpace: 'srgb-linear',
  },
  calibration: {
    /** Linear base colour of the calibration patch. */
    albedo: 0.18,
    /** Linear value the patch reads after the display transform. */
    target: 0.18,
    /** Accepted deviation, linear (2 % of the target). */
    tolerance: 0.0036,
    /** Edge of the central square of pixels whose mean is read. */
    sample: 4,
  },
  environment: {
    recipe: {
      width: 512,
      height: 256,
      zenith: 1,
      horizon: 0.62,
      nadir: 0.28,
      panels: [
        // Above and behind the key: the highlight a polished metal shows.
        { azimuth: 50, elevation: 40, width: 50, height: 30, softness: 10, radiance: 4 },
        // A dimmer one opposite, low, so the shadow side of a metal is not black.
        { azimuth: -150, elevation: 20, width: 40, height: 24, softness: 10, radiance: 2 },
      ],
    } satisfies EnvironmentRecipe,
    normalisation: 0.543,
  },
  reference: {
    environmentScale: 1,
    key: {
      colour: '#ffffff',
      intensity: 1,
      /** From the origin towards the light: upper, front, right. */
      position: [2, 3, 2.5] as Triple,
    },
  },
  apartment: {
    environmentScale: 1.8,
    hemisphere: { sky: '#fffcf6', ground: '#6d675f', intensity: 0.9 },
    sun: {
      colour: '#fff4e6',
      intensity: 3,
      position: [12.5, 15.5, -6.5] as Triple,
      target: [8, 0, 5] as Triple,
      shadow: {
        defaultMapSize: 2048,
        minMapSize: 256,
        maxMapSize: 4096,
        /** Half extent of the orthographic shadow frustum, metres. */
        extent: 13,
        near: 2,
        far: 60,
        bias: -0.0002,
        normalBias: 0.02,
      },
      /**
       * The sun positions a scene's `site.sun` names: artistic, northern
       * hemisphere, not astronomical. Azimuth from north, clockwise seen from
       * above; the north itself is the scene's `site.northDeg`.
       */
      presets: {
        morning: { azimuth: 90, elevation: 20 },
        noon: { azimuth: 180, elevation: 55 },
        evening: { azimuth: 270, elevation: 20 },
      } satisfies Record<string, SunAngles>,
      /**
       * How a shadow frustum is fitted to the apartment (`shadow-fit.ts`):
       * padding across the light and along it, metres; the nearest the near
       * plane may be, metres; the depth offset the bias is made of, metres
       * (`bias = -depthOffset / (far - near)`); and the normal bias in world
       * texels, clamped to `[normalBiasMin, normalBiasMax]` metres.
       * Calibrated by eye on the demo apartment at the legacy direction and
       * the three presets (2048 map, 7 to 10 mm texels): no acne on walls or
       * floors and no visible gap between an object and its shadow.
       */
      fit: {
        lateralPadding: 0.25,
        depthPadding: 0.5,
        minNear: 0.1,
        depthOffset: 0.002,
        normalBiasTexels: 0.5,
        normalBiasMin: 0.002,
        normalBiasMax: 0.02,
      },
    },
    fill: { colour: '#bed7de', intensity: 0.4, position: [-14, 8, 14] as Triple },
  },
});

export type LightingStandard = typeof LIGHTING_STANDARD;

/** `scene.environmentIntensity` of the reference rig. */
export function referenceEnvironmentIntensity(): number {
  return LIGHTING_STANDARD.environment.normalisation * LIGHTING_STANDARD.reference.environmentScale;
}

/** `scene.environmentIntensity` of the apartment rig. */
export function apartmentEnvironmentIntensity(): number {
  return LIGHTING_STANDARD.environment.normalisation * LIGHTING_STANDARD.apartment.environmentScale;
}
