/**
 * The frame rebate of one opening, read off the variant bank.
 *
 * `plan/door-swing.ts` needs it to know how much of an opening's width the
 * frame eats before the leaf starts, and the layout linter and the opening
 * builder need the SAME number — what the linter clears must be what the
 * viewer draws. The number itself is variant data, which lives here in
 * `assets/`; the trigonometry lives at the bottom of the layer order and is
 * handed this function (`door-swing.FrameWidthOf`).
 *
 * Invariant: an opening with no `variant`, or one naming a variant the bank
 * does not have, gets its type's default look — never zero, which would put
 * the leaf's hinge on the jamb line itself.
 *
 * Pure module: no `three`, no DOM.
 */

import { defaultOpeningVariant, findOpeningVariant } from './opening-variants.js';
import type { Opening } from '../scene/types.js';

/** Frame width of the variant this opening wears, in metres. */
export function openingFrameWidth(opening: Opening): number {
  const variant =
    (opening.variant ? findOpeningVariant(opening.variant) : undefined) ?? defaultOpeningVariant(opening.type, opening.entrance);
  return variant.frame.width;
}
