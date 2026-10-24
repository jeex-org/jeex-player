/**
 * The shape of one `lighting.hdri` entry, a type only: `viewer-options.ts`
 * publishes it and `hdri-option.schema.ts` judges it, and neither imports the
 * other for it (a type edge would close a dependency cycle).
 *
 * Pure module: no `three`, no DOM.
 */

/**
 * One sky a host hands the viewer for one sun preset (`lighting.hdri`): the
 * lighting environment, the sky the windows show, and the sun facts measured
 * once when the panorama was imported. Licence, source and the library
 * record's identity stay with the host; the viewer needs none of them.
 */
export type HdriEntry = {
  /**
   * The lighting environment: an equirectangular gain-map (Ultra HDR) JPEG,
   * 1024 x 512 recommended. Absolute `http:`, `https:` or `blob:` URL.
   * @pattern ^(https?|blob):
   */
  environmentUrl: string;
  /**
   * The sky the windows show: an equirectangular image of the same panorama
   * the browser decodes (AVIF recommended), sRGB. Absolute `http:`, `https:`
   * or `blob:` URL.
   * @pattern ^(https?|blob):
   */
  skyUrl: string;
  /** The panorama's own sun, measured at import before the sun was clamped. */
  sun: {
    /**
     * Azimuth in the panorama's own frame, degrees clockwise from +Z towards
     * +X (three's `atan2(z, x)` azimuth `a` is `90 - a`).
     */
    azimuthDeg: number;
    /**
     * Elevation above the horizon, degrees.
     * @exclusiveMinimum 0
     * @maximum 90
     */
    elevationDeg: number;
    /**
     * Linear RGB colour of the sun, normalised so its largest channel is 1.
     * @minItems 3
     * @maxItems 3
     */
    colourLinear: readonly [number, number, number];
    /**
     * Share of the sky's horizontal irradiance that came from the cone around
     * the sun, before it was clamped.
     * @minimum 0
     * @exclusiveMaximum 1
     */
    horizontalIrradianceShare: number;
  };
};

/** `lighting.hdri`: one entry per sun preset, every preset optional. */
export type HdriOption = { readonly morning?: HdriEntry; readonly noon?: HdriEntry; readonly evening?: HdriEntry };
