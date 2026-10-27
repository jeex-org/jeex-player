/**
 * The walk and tour room lighting's tuning, in one frozen object: the room
 * volumes, the grid bake, the room probes, the box-projection blend and the
 * walk calibration (ambient floor, exposure and the sun inside rooms).
 *
 * Invariant: these numbers belong to the walk chunk and never to the lighting
 * standard (`lighting/lighting-standard.ts`); the editing look is untouched by
 * any of them. The calibration values were set by measurement in the browser
 * (`tests/component/walk-lighting.test.ts`).
 *
 * Pure module: no `three`, no DOM.
 */

export const WALK_LIGHTING_TUNING = Object.freeze({
  /** A grid's sampling box is the room box inset by this much on every side, metres: probes sit on its surface. */
  samplingInsetM: 0.12,
  /** The selection box reaches this far below the floor and above the ceiling, metres. */
  selectionPadM: 0.2,
  /** Probe spacing of a room grid along x and z, metres. */
  gridSpacingM: 1,
  /**
   * Probe layers of a room grid in height. Three, not two: with two layers the
   * probes sit just above the floor and just below the ceiling, under the sill
   * and over the head of every window, and a wall facing a window was lit from
   * a quarter of the light it gets (measured on the demo living room).
   */
  gridLayers: 3,
  /** Edge of a grid probe's capture cube, texels. */
  gridCubemapSize: 8,
  /** Grid probes (one cube render each) baked per frame. */
  probesPerFrame: 6,
  /** Height of a room's reflection probe above the floor, metres. */
  probeHeightM: 1.5,
  /**
   * Clearance a room's reflection probe keeps from every furniture box in 3D,
   * metres; a target, not a guarantee (a crowded room takes its clearest
   * point). Measured on the demo living room: a probe 9 cm from the floor
   * lamp's glowing shade saw the shade fill its whole upward view, and every
   * glossy floor there reflected one uniform blob instead of the room.
   */
  probeClearanceM: 0.5,
  /** Edge of a reflection probe's capture cube, texels; its PMREM output then has the studio environment's layout. */
  probeSize: 128,
  /** Room boxes the apartment may have; more keeps the direct look and reports an error. */
  maxBoxes: 16,
  /** Grid probes along x or z of one room box (64 m at the spacing); more keeps the direct look and reports an error. */
  maxProbesPerAxis: 64,
  /** Width of the blend between two rooms' reflections at a shared box face, metres. */
  blendM: 0.4,
  /** How far a fragment's room lookup point is pushed along its normal, metres. */
  normalPushM: 0.05,
  /**
   * Ambient light in walk and tour, so a room without a window or a lamp is not
   * black; intensity. Measured on the demo apartment by daylight (lamps off): the
   * closed WC reads 0.17 of the living room's window wall at this floor.
   */
  ambientFloor: 0.05,
  /**
   * Renderer exposure in walk and tour, against the standard's 1. Baked
   * daylight through windows is far weaker than the studio light of the editing
   * look; at 3.5 a grey card facing the living room's window reads about a
   * third of its editing value, the target (about 1.6 stops under the studio
   * look, as a daylit room measures against an evenly lit studio). Facades and
   * the sky are divided by it, so they keep the editing look.
   */
  walkExposure: 3.5,
  /**
   * What direct sunlight is scaled by inside the room boxes in walk and tour,
   * against the editing look's sun. At the walk exposure a sunlit floor read
   * at the display maximum and lost its texture; scaling the sun by the
   * inverse of the exposure gives it back the editing look's level, while
   * the bake, the ambient floor and the exposure (and with them every ratio
   * the daylight calibration above set) stay as they are. Facades keep their
   * sun: they are outside every box. Measured in the browser
   * (`tests/component/walk-lighting.test.ts`).
   */
  walkSunScale: 1 / 3.5,
  /**
   * The brightest channel an emissive term (a lamp shade's glow) may reach in
   * walk and tour, before tone mapping and after the walk exposure; the chroma
   * is kept and a term under it passes unchanged. At the walk exposure the
   * catalogue's shade glows read 0.79-6.66 and blew out against PBR Neutral's
   * knee (0.76); the shade's lit part adds to this, so the cap sits below it.
   * Measured 2026-10-24 on an NVIDIA GPU with the demo floor lamp
   * (`tests/component/lamp-shade-emissive.test.ts`), the shade's mean
   * brightest channel and its luminance over the unlit shade: ivory 0.667 and
   * 1.63, opal 0.677 and 1.63, warm lamp 0.716 and 1.50, ink 0.306 and 6.97;
   * every shade at or under 0.76 and at least 1.25 times its unlit self.
   */
  walkEmissiveCap: 0.3,
  /** Quiet time after the last edit in walk before the affected rooms are refreshed, milliseconds. */
  refreshDebounceMs: 1000,
  /** Quiet time after the last change of the artificial light's colour before the room probes are re-captured, milliseconds. */
  relightSettleMs: 250,
  /**
   * The camera's white balance and exposure per room (`room-balance.ts`),
   * set by the look of professional interior photographs of modern flats
   * (64 listing photographs, 2026-10-27): their bright neutral surfaces read
   * red over blue 1.02-1.06 in linear colour whatever lit the room, and their
   * median lightness 176-187 of 255.
   */
  balance: Object.freeze({
    /** Edge of the cube a room is measured with, texels. */
    sampleSize: 32,
    /** A probe texel is a neutral surface under this saturation, display-encoded. */
    neutralSaturation: 0.25,
    /** Passes of the white's refinement: the band's mean, then the texels near it, twice. */
    whitePasses: 3,
    /** Texels from this luminance quantile up are the bright surfaces the white is measured from. */
    neutralQuantile: 0.7,
    /** Texels at or above this luminance quantile are highlights (sky, glowing shades): out of the white, and the exposure's limit. */
    highlightQuantile: 0.97,
    /** Red over blue a neutral surface keeps after the balance: a trace of warmth, as in the photographs. */
    tintRB: 1.06,
    /** The neutral surfaces' mean luminance after exposure and gain, before tone mapping. */
    targetLevel: 0.85,
    /** The most the gain opens a room up: 1.5 stops. */
    maxGain: 2 ** 1.5,
    /** The highlight's luminance after exposure and gain stays under this: PBR Neutral maps 1.67 to 0.95. */
    highlightCap: 1.67,
    /** How long the camera takes to settle into a room it entered, milliseconds. */
    blendMs: 600,
  }),
});
