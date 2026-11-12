/**
 * The frame rebate of one opening, and how many leaves it hangs, read off the
 * variant bank.
 *
 * `plan/door-swing.ts` needs it to know how much of an opening's width the
 * frame eats before the leaf starts, and the layout linter and the opening
 * builder need the SAME number — what the linter clears must be what the
 * viewer draws. The number itself is variant data, which lives here in
 * `assets/`; the trigonometry lives at the bottom of the layer order and is
 * handed this function (`door-swing.FrameWidthOf`).
 *
 * The leaf count is the same `leaf.style` field the opening builder reads to
 * hang a `'double'` variant's two leaves on both jambs, so a door panel that
 * asks it describes the door the viewer builds.
 *
 * Invariant: an opening with no `variant`, or one naming a variant the bank
 * does not have, gets its type's default look — never zero, which would put
 * the leaf's hinge on the jamb line itself.
 *
 * Pure module: no `three`, no DOM.
 */

import { defaultOpeningVariant, findOpeningVariant, type OpeningVariant } from './opening-variants.js';
import type { Opening } from '../scene/types.js';

/** The variant this opening wears, its type's default when it names none or an unknown one. */
function variantOf(opening: Opening): OpeningVariant {
  return (opening.variant ? findOpeningVariant(opening.variant) : undefined) ?? defaultOpeningVariant(opening.type, opening.entrance);
}

/** Frame width of the variant this opening wears, in metres. */
export function openingFrameWidth(opening: Opening): number {
  return variantOf(opening).frame.width;
}

/**
 * How many hinged leaves the builder hangs in this opening: two for a
 * `'double'` leaf style (one on each jamb), one otherwise. The 2D plan draws
 * that many leaves and swing arcs (`plan/plan-drawing.LeafCountOf`).
 */
export function openingLeafCount(opening: Opening): 1 | 2 {
  return variantOf(opening).leaf?.style === 'double' ? 2 : 1;
}
