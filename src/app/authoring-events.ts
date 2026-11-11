/**
 * The authoring rows of the public event map: what the tour-camera tool, the
 * asset move tool and the plan tool raise. Types only; `viewer-events.ts` composes them with
 * the core rows into `ViewerEventMap`, whose members are the public contract.
 *
 * The tools themselves load lazily with the other authoring tools; a type
 * import costs the boot bundle nothing, and an event is created on its first
 * subscriber or emission, so a page that never arms a tool carries no row of
 * its own for it.
 */

import type { CheckpointEdit, CheckpointSelect } from '../camera/checkpoint-types.js';
import type { AssetEdit, AssetEditRefused } from '../edit/asset-edit.js';
import type { PlanEdit, PlanEditRefused, PlanToolStateEvent } from '../edit/plan-edit.js';

/** The `assetMoveState` payload. */
export type AssetMoveStateEvent = { readonly phase: 'idle' | 'dragging' | 'nudging' };

/** The `checkpointLookThrough` payload. */
export type CheckpointLookThrough = { readonly id: string | null };

/** The `checkpointPlacing` payload. */
export type CheckpointPlacing = { readonly active: boolean };

export type AuthoringEventMap = {
  /** A tour-checkpoint marker was clicked (`id: null` — the focus was cleared); placement overlay only. */
  checkpointSelect: CheckpointSelect;
  /** A placement gesture (drag, add) finished; the HOST commits the list. */
  checkpointEdit: CheckpointEdit;
  /** A look-through began (`id` — the camera piloted) or ended (`null`); tour-camera tool only. */
  checkpointLookThrough: CheckpointLookThrough;
  /** Click-to-place began (`active: true`) or ended — a drop, Esc, or a mode change; tour-camera tool only. */
  checkpointPlacing: CheckpointPlacing;
  /**
   * The asset move tool released a legal move: `move_object` (+ `rotate_object`) for the HOST to commit as one
   * batch on `baseRev`; the new pose stays on screen until the document
   * answers, `handle.revertAssetEdit()` puts the start pose back.
   */
  assetEdit: AssetEdit;
  /** A move ended illegal and reverted; `issues` are the hard layout issues of the final pose. */
  assetEditRefused: AssetEditRefused;
  /**
   * A drag or an arrow/Q/E burst of the asset move tool began (`dragging`,
   * `nudging`) or ended (`idle`): a host hides what it hangs over the object
   * (a host editor's selection card) while it moves. Edges only, never per frame.
   */
  assetMoveState: AssetMoveStateEvent;
  /**
   * The plan tool released a legal drag in `plan2d`: `move_node` or
   * `set_opening` for the HOST to commit as one batch on `baseRev`; the draft
   * stays on the 2D plan until the document answers, `handle.revertPlanEdit()`
   * puts the committed drawing back.
   */
  planEdit: PlanEdit;
  /** A plan drag ended illegal and the drawing went back; `reason` is the model's refusal, verbatim. */
  planEditRefused: PlanEditRefused;
  /** A plan drag began (`dragging`) or ended (`idle`): a host holds its card's field edits meanwhile. Edges only. */
  planToolState: PlanToolStateEvent;
};
