/**
 * The walk and tour room lighting's tuning, in one frozen object: the room
 * volumes, the grid bake, the room probes, the box-projection blend and the
 * walk calibration (ambient floor and exposure).
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
  /** Quiet time after the last edit in walk before the affected rooms are refreshed, milliseconds. */
  refreshDebounceMs: 1000,
});
