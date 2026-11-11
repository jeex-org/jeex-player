/**
 * What the plan tool hands its host: an edit batch to commit, the reason a
 * release was refused, and the edges of a drag. Types only, apart from the
 * tool so the public event map (`app/authoring-events.ts`) reads them without
 * the tool's code, which loads lazily with the other authoring tools.
 *
 * The tool mints no id: its batches carry only `move_node` and `set_opening`
 * on nodes and openings the document already has.
 */

import type { MoveNodeOp, SetOpeningOp } from '../scene/types.js';

/** What a plan handle can stand for. */
export type PlanEditTarget = { readonly kind: 'wall' | 'opening'; readonly id: string };

/** The operations a plan edit carries. */
export type PlanEditOp = MoveNodeOp | SetOpeningOp;

/** A legal release of the plan tool: one batch for the HOST to commit on `baseRev`. */
export type PlanEdit = {
  readonly target: PlanEditTarget;
  /** `move_node` (one, or two for a wall moved sideways) or one `set_opening`. */
  readonly ops: readonly PlanEditOp[];
  /** The committed revision the drag started from. */
  readonly baseRev: number;
  /** Which handle moved: an end node, the wall's middle, an opening's body, one of its jambs. */
  readonly gesture: 'node' | 'wall' | 'opening' | 'opening-width';
};

/** A release the player's own trial of the batch refused; the drawing is back where it was. */
export type PlanEditRefused = {
  readonly target: PlanEditTarget;
  readonly ops: readonly PlanEditOp[];
  /** The model's refusal, verbatim: `validation_failed` with the validator's English message. */
  readonly reason: { readonly code: 'validation_failed'; readonly message: string };
};

/** A drag began or ended; edges only. A host holds its card's field edits meanwhile. */
export type PlanToolStateEvent = { readonly phase: 'idle' | 'dragging' };
