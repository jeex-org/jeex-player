/**
 * The plan edits the viewer emitted and the host has not answered yet: the
 * operations, in order, and the draft the screen shows for them.
 *
 * The rule of `pending-edits.ts`, applied to the plan: a second drag before
 * the host answered builds on the first (its trial runs the recorded ops in
 * front of its own, and its handles are read from the draft), and its
 * `planEdit` carries only its own ops on the same `baseRev`. A committed
 * revision past the recorded one answers the record, and so does another
 * document at any revision; the same document handed back at the same
 * revision answers nothing. `revert` drops the record.
 *
 * Pure module: no `three`, no DOM.
 */

import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData } from '../scene/types.js';
import type { PlanEditOp } from './plan-edit.js';

/** A candidate document as `SceneModel.trial` answers it. */
export type PlanDraft = { readonly scene: SceneData; readonly plan: SolvedPlan };

export class PendingPlanEdit {
  private pending: { sceneId: string; rev: number; ops: PlanEditOp[]; draft: PlanDraft } | null = null;

  /** A legal release on document `sceneId` at `rev`: its ops join the record, `draft` is what the screen now shows. */
  record(sceneId: string, rev: number, ops: readonly PlanEditOp[], draft: PlanDraft): void {
    const kept = this.pending !== null && this.pending.sceneId === sceneId && this.pending.rev === rev ? this.pending.ops : [];
    this.pending = { sceneId, rev, ops: [...kept, ...ops], draft };
  }

  /** The ops emitted and not answered, in order; empty when nothing waits. */
  ops(): readonly PlanEditOp[] {
    return this.pending?.ops ?? [];
  }

  /** The draft the screen shows for them, `null` when nothing waits. */
  draft(): PlanDraft | null {
    return this.pending?.draft ?? null;
  }

  /** The mounted document is now `sceneId` at `rev`; `true` when that answered the record (it is dropped). */
  documentChanged(sceneId: string, rev: number): boolean {
    const record = this.pending;
    if (record === null || (record.sceneId === sceneId && rev <= record.rev)) return false;
    this.pending = null;
    return true;
  }

  /** The host refused: drops the record; `false` when nothing was pending. */
  revert(): boolean {
    const had = this.pending !== null;
    this.pending = null;
    return had;
  }
}
