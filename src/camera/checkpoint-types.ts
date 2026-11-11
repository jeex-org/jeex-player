/**
 * The payloads of the tour-camera tool's two document events, as types only:
 * the public event map and the package's type exports name them, and a type
 * import keeps the tool itself out of every bundle that only listens.
 */

import type { TourCheckpoint } from '../scene/types.js';

/** A checkpoint was clicked (or the click landed off every marker: `null`). */
export type CheckpointSelect = { readonly id: string | null };
/**
 * A gesture finished and the working list is the answer. `baseRev` is the
 * revision the gesture started from, so a host can tell whether the document
 * moved underneath it, and `summary` is a one-line human reason.
 */
export type CheckpointEdit = { readonly checkpoints: readonly TourCheckpoint[]; readonly baseRev: number; readonly summary: string };
