/**
 * The one error type of the lighting standard (`jeex-viewer/lighting`).
 *
 * It is its own class, not a `ViewerLibError`: the lighting entry is published
 * apart from the viewer and carries none of its code, and its codes describe a
 * contract with the caller's engine and renderer, not a viewer failure. A
 * consumer writes one `instanceof LightingError` and switches on `code`.
 *
 * Pure module: no `three`, no DOM.
 */

/** Every way the lighting standard refuses a call. */
export const LIGHTING_ERROR_CODES = [
  /** The caller's three.js is not the revision the standard is calibrated for. */
  'engine-revision',
  /** The caller's three.js has colour management off or a working space other than linear sRGB. */
  'colour-management',
  /** Rig options the standard does not define, or a value out of range. */
  'bad-options',
  /** The rig is already attached to another scene. */
  'rig-attached',
  /** The scene already carries a different rig. */
  'scene-has-rig',
  /** The context or the rig was disposed. */
  'disposed',
] as const;

export type LightingErrorCode = (typeof LIGHTING_ERROR_CODES)[number];

/** A refusal of the lighting standard, with a machine-readable `code`. */
export class LightingError extends Error {
  readonly code: LightingErrorCode;

  constructor(code: LightingErrorCode, message: string) {
    super(message);
    this.name = 'LightingError';
    this.code = code;
  }
}
