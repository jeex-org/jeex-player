/**
 * The single writable copy of the scene: a deep clone of the loaded document,
 * a monotonic revision, and the only way to change either — a validated,
 * atomic batch of operations.
 *
 * Atomicity: `apply` validates the base revision, clones the committed scene,
 * runs every operation on the clone, merges the rooms a removed wall joined
 * (`room-merge.ts`), then re-runs `validateScene` and `solvePlan` on the
 * candidate. Only when all of that succeeds does the clone
 * become the committed scene and `rev` advance; a failure anywhere leaves the
 * previous scene, plan and revision untouched — the caller's draft is dropped.
 *
 * Invariant: the committed scene always satisfies `validateScene`, and `plan`
 * is always the solution of exactly that scene.
 *
 * A batch may additionally ask for the furniture LAYOUT to be reviewed
 * (`ApplyBatch.lint`): `report` returns what the linter found,
 * `strict` refuses a candidate with a hard issue — a document that is legal but
 * physically impossible — without advancing the revision. The linter is handed
 * in rather than imported (`SceneModelOptions.lint`); a viewer passes none and
 * nothing changes for it.
 *
 * Ownership invariant: what `scene` and `plan` hand out is DEEP-FROZEN at
 * runtime and `Committed<T>` at compile time (`shared/committed.ts`) — the same
 * fact, said twice, so a consumer that tries to edit the committed document
 * fails at the keyboard rather than in production. The model is the only
 * writer; `toJSON()` is the way to get a `Draft<SceneData>` to edit.
 *
 * Pure module: no `three`, no DOM.
 */

import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import { validateScene } from './scene-validator.js';
import { ViewerLibError } from '../shared/errors.js';
import { applyOp, OpError, sameTouched, type SceneOp, type TouchedEntity } from './scene-ops.js';
import { applyRoomMerges, planRoomMerges, type RoomMerge } from './room-merge.js';
import { heirsOf, inheritedCirculation, inheritedKeys, issueKey } from './issue-heirs.js';
import { diffScenes, sameData } from './scene-diff.js';
import { Fanout } from '../shared/fanout.js';
import { draftOf, type Committed, type Draft } from '../shared/committed.js';
import type { SceneRegistries } from './registries.js';
import type { LayoutIssue, LayoutLinter } from '../layout/layout-issue.js';
import type { Logger } from '../shared/logger.js';
import { isReadonlyMapView } from '../shared/readonly-map.js';
import type { SceneData } from './types.js';

/**
 * What the layout linter does to a batch.
 *
 * `off` is the default and the viewer's own setting: a viewer renders
 * documents, it does not review them. An editor host asks for `report` while the
 * user drags things about, and for `strict` when it bakes — a hard issue is a
 * physical impossibility, and baking one is worse than refusing the edit.
 *
 * `strict-new` refuses only a hard issue the BASE document did not already
 * have, compared by rule id and entity ids: a sofa moved across the room is not
 * refused because a wardrobe elsewhere already stood in a doorway. A wall or
 * room the batch split, joined or merged is followed to its new ids first
 * (`issue-heirs.ts`), so a piece already in a wall stays old in the wall that
 * replaced it. After a room merge, a `circulation` error in the survivor is
 * old when every opening it names was already blocked in a merged room, in
 * whatever wording (`inheritedCirculation`). Pre-existing
 * hard issues still come back in `ApplyOk.issues`, so the host can show them
 * without blocking the edit.
 */
export type LintMode = 'off' | 'report' | 'strict' | 'strict-new';

export type ApplyBatch = {
  /** Revision the caller believes it is editing; a mismatch is refused. */
  baseRev: number;
  ops: readonly SceneOp[];
  /** Free-form author tag, carried for logs only. */
  actor?: string;
  /** Layout lint over the candidate, before it commits. Defaults to `'off'`. */
  lint?: LintMode;
};

export type AppliedOp = { op: SceneOp; summary: string };

export type ApplyOk = {
  rev: number;
  applied: AppliedOp[];
  /** What changed, deduplicated, in operation order (`TouchedEntity`, `ops/context.ts`). */
  touched: TouchedEntity[];
  /** What the layout linter found, when the batch asked for it and it found anything. */
  issues?: LayoutIssue[];
  /**
   * The rooms the batch merged because it removed the walls between them,
   * one entry per absorbed room sorted by `from` (`room-merge.ts`). Present
   * only when a merge happened.
   */
  roomMerges?: RoomMerge[];
  /**
   * Listeners that threw while being notified. The batch is committed either
   * way — this only says who failed to react to it.
   */
  listenerErrors?: Error[];
};

export type ApplyFailure = {
  /**
   * `not_ready` is never produced by `SceneModel.apply` itself — it is what a
   * caller ABOVE the model (a debug/API surface asked to act before its
   * subsystem exists, e.g. `applyPreset` before the editor is built) answers
   * with instead of forging an `ApplyOk` or picking one of the model's own
   * failure kinds for a situation the model never saw.
   *
   * `layout_failed` is `lint: 'strict'` refusing a candidate the VALIDATOR
   * accepted: the document is legal, the furniture in it is not.
   */
  error: 'revision_conflict' | 'validation_failed' | 'not_ready' | 'layout_failed';
  message: string;
  /** Every issue the linter found, when `layout_failed` is why the batch was refused. */
  issues?: LayoutIssue[];
};

/** What a model may be built with beyond its document and its registries. */
export type SceneModelOptions = {
  /**
   * The layout linter `ApplyBatch.lint` runs, INJECTED rather than imported:
   * `layout/layout-lint.lintLayout` reads the object bank and sits three
   * layers above this one (`layout/layout-issue.ts`). A model built without
   * one refuses any batch that asks to lint, rather than silently passing it.
   */
  readonly lint?: LayoutLinter;
  /**
   * The revision the model starts at: the HOST's revision of the document it
   * is handed, so `rev` (and every artefact's provenance) says which of the
   * host's revisions it is. A host that reloads its document on every commit
   * passes its own number here; the model counts its own commits from it.
   * A whole number of 0 or more; absent is 0.
   */
  readonly revision?: number;
};

export type ApplyResult = ApplyOk | ApplyFailure;

/** Notified after a batch commits, in subscription order. */
export type RevisionListener = (rev: number, touched: readonly TouchedEntity[], ops: readonly SceneOp[]) => void;

export function isApplyOk(result: ApplyResult): result is ApplyOk {
  return (result as ApplyFailure).error === undefined;
}

/**
 * Freezes a value and everything reachable from it, in place.
 *
 * Keyed state that leaves the model is a `readonly-map.ts` VIEW, not a `Map`:
 * only the values behind it are frozen here, because the view itself is frozen
 * at construction and owns no writable path to its store. A raw `Map`/`Set` is
 * still handled — `Object.freeze` does not stop `Map.set`, so its mutators are
 * shadowed by throwing own properties — but that is defence in depth, not the
 * mechanism the exposed plan relies on: shadowed mutators can be bypassed with
 * `Map.prototype.set.call(...)`, a view cannot. Cycles are handled through a
 * seen-set; the solved plan has plenty of them (faces point back at their room).
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as unknown as object;
  if (seen.has(object)) return value;
  seen.add(object);
  if (isReadonlyMapView(object)) {
    for (const entry of object.values()) deepFreeze(entry, seen);
    return value;
  }
  if (object instanceof Map || object instanceof Set) {
    for (const entry of (object as Map<unknown, unknown> | Set<unknown>).values()) deepFreeze(entry, seen);
    sealCollection(object as Map<unknown, unknown> | Set<unknown>);
  } else {
    for (const key of Object.getOwnPropertyNames(object)) {
      deepFreeze((object as Record<string, unknown>)[key], seen);
    }
  }
  return Object.freeze(value);
}

/** Replaces the mutators of a Map/Set with throwing own properties. */
function sealCollection(collection: Map<unknown, unknown> | Set<unknown>): void {
  const refuse = (name: string) => () => {
    throw new TypeError(`Cannot ${name} on a frozen ${collection.constructor.name}`);
  };
  for (const name of ['set', 'add', 'delete', 'clear'] as const) {
    if (typeof (collection as unknown as Record<string, unknown>)[name] !== 'function') continue;
    Object.defineProperty(collection, name, { value: refuse(name), configurable: false, writable: false });
  }
}

export class SceneModel {
  private readonly catalogues: SceneRegistries;
  /** The injected layout linter, or `undefined` when this model never lints. */
  private readonly linter: LayoutLinter | undefined;
  private committed: SceneData;
  private solved: SolvedPlan;
  private revision = 0;
  /**
   * The revision fan-out. Its failure sink collects into `pendingErrors` for
   * the `ApplyResult` and forwards to `onListenerError` — the sink is a
   * listener too, so a throw from IT is recorded rather than escaping a
   * committed batch (`shared/fanout.ts`).
   */
  private readonly listeners = new Fanout<Parameters<RevisionListener>>((error) => this.collectListenerError(error));
  /** Failures of the batch being notified right now; drained by `apply`. */
  private pendingErrors: Error[] = [];
  /** True while listeners are being notified; blocks re-entrant `apply`. */
  private applying = false;
  /** The committed revision's hard issues, for `strict-new`; `null` until first asked. */
  private baseErrors: { rev: number; issues: readonly LayoutIssue[] } | null = null;
  /** Optional sink for listener failures, set with `onError`. */
  private onListenerError?: ((error: Error) => void) | undefined;

  /**
   * Takes ownership of a deep copy of `input`, which must already validate.
   * Use `SceneModel.load` for untrusted documents.
   *
   * `registries` is what every reference in the document — and in every
   * operation applied to it later — is checked against; the model keeps them so
   * `apply` and the preset batch do not have to be handed them again
   * (`registries.ts`).
   */
  constructor(input: SceneData, registries: SceneRegistries, options: SceneModelOptions = {}) {
    this.catalogues = registries;
    this.linter = options.lint;
    if (options.revision !== undefined) {
      if (!Number.isSafeInteger(options.revision) || options.revision < 0) {
        throw new ViewerLibError('bad-params', `revision must be a whole number of 0 or more, got ${String(options.revision)}`, {
          detail: { revision: options.revision },
        });
      }
      this.revision = options.revision;
    }
    this.committed = deepFreeze(validateScene(draftOf(input), registries));
    this.solved = deepFreeze(solvePlan(this.committed));
  }

  /** Validates an unknown document (a repository result) and wraps it. */
  static load(input: unknown, registries: SceneRegistries, log?: Logger, options?: SceneModelOptions): SceneModel {
    return new SceneModel(validateScene(input, registries, log), registries, options);
  }

  /** The registries this model validates and applies against. */
  get registries(): SceneRegistries {
    return this.catalogues;
  }

  get rev(): number {
    return this.revision;
  }

  /** The committed scene. Deep-frozen: mutate it only through `apply`. */
  get scene(): Committed<SceneData> {
    return this.committed;
  }

  /** The solved plan of the committed scene. Deep-frozen. */
  get plan(): Committed<SolvedPlan> {
    return this.solved;
  }

  /**
   * Applies a batch atomically. On success the revision advances by exactly
   * one, whatever the batch size, and every listener sees the union of the
   * touched entities in operation order.
   */
  apply(batch: ApplyBatch): ApplyResult {
    if (this.applying) {
      return {
        error: 'validation_failed',
        message: 'A revision listener cannot apply another batch; the commit in flight has not finished notifying',
      };
    }
    if (batch.baseRev !== this.revision) {
      return {
        error: 'revision_conflict',
        message: `Batch is based on revision ${batch.baseRev}, the scene is at ${this.revision}`,
      };
    }
    if (!Array.isArray(batch.ops) || batch.ops.length === 0) {
      return { error: 'validation_failed', message: 'A batch needs at least one operation' };
    }

    const draft = draftOf(this.committed);
    const applied: AppliedOp[] = [];
    const touched: TouchedEntity[] = [];
    try {
      for (const op of batch.ops) {
        const outcome = applyOp(draft, op, this.catalogues);
        applied.push({ op, summary: outcome.summary });
        for (const entity of outcome.touched) if (!touched.some((seen) => sameTouched(seen, entity))) touched.push(entity);
      }
    } catch (error) {
      const message = error instanceof OpError || error instanceof Error ? error.message : String(error);
      return { error: 'validation_failed', message };
    }

    // Removing the wall between rooms leaves their anchors in one face; they
    // merge here, on the FINAL plan, before validation would refuse it as
    // MULTI_ANCHOR. A batch that removes no wall is never touched.
    let roomMerges: RoomMerge[] = [];
    if (batch.ops.some((op) => op.op === 'remove_wall')) {
      const merged = applyRoomMerges(draft, planRoomMerges(this.committed, this.solved, draft), this.committed);
      roomMerges = merged.merges;
      if (roomMerges.length > 0) {
        for (const entity of merged.touched) if (!touched.some((seen) => sameTouched(seen, entity))) touched.push(entity);
      }
    }

    let candidate: SceneData;
    let candidatePlan: SolvedPlan;
    try {
      candidate = validateScene(draft, this.catalogues);
      candidatePlan = solvePlan(candidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: 'validation_failed', message };
    }

    const linted = this.lint(batch.lint ?? 'off', candidate, candidatePlan, batch.ops, roomMerges);
    if (!Array.isArray(linted)) return linted;

    this.committed = deepFreeze(draft);
    this.solved = deepFreeze(candidatePlan);
    this.revision += 1;
    // The batch is committed the moment the revision advances. Notification is
    // a separate, best-effort phase: one broken listener must not swallow the
    // others, and it must never turn a successful commit into a thrown call.
    const result: ApplyOk = { rev: this.revision, applied, touched };
    if (linted.length > 0) result.issues = linted;
    if (roomMerges.length > 0) result.roomMerges = roomMerges;
    this.pendingErrors = [];
    this.applying = true;
    try {
      this.listeners.emit(result.rev, touched, batch.ops);
    } finally {
      this.applying = false;
    }
    const listenerErrors = this.pendingErrors;
    this.pendingErrors = [];
    return listenerErrors.length > 0 ? { ...result, listenerErrors } : result;
  }

  /**
   * Commits `next`'s document as ONE revision of this model, and says what it
   * touched (`scene-diff.ts`).
   *
   * The road for a host that keeps the document itself and hands the viewer
   * the whole next version after each edit it committed (`loadScene`): the
   * viewer's consumers follow a revision piece by piece, where a new model
   * would rebuild every placement and download every model again (one turned
   * sofa redrew the whole apartment).
   *
   * `next` was loaded and validated against registries describing the same
   * library as this model's — the caller's judgement (`SceneMount.present`) —
   * so its committed scene and solved plan are taken as they are, never
   * judged twice. A document that differs in nothing commits nothing:
   * `null`, revision unchanged. Listeners hear `touched` and no operations.
   */
  replaceDocument(next: SceneModel): { rev: number; touched: readonly TouchedEntity[] } | null {
    if (this.applying) throw new Error('A revision listener cannot replace the document; the commit in flight has not finished notifying');
    // A change that draws nothing (the name, the presets) touches nothing and
    // is still a revision: only the SAME document commits nothing.
    if (sameData(this.committed, next.scene)) return null;
    const touched = diffScenes(this.committed, next.scene);
    this.committed = next.committed;
    this.solved = next.solved;
    this.revision += 1;
    this.pendingErrors = [];
    this.applying = true;
    try {
      this.listeners.emit(this.revision, touched, []);
    } finally {
      this.applying = false;
      this.pendingErrors = [];
    }
    return { rev: this.revision, touched };
  }

  /**
   * Runs the layout linter over a candidate that already validates, and says
   * whether the batch may commit.
   *
   * Returns the issues (possibly none) when it may, and the `ApplyFailure`
   * when it may not — an array or a refusal, which is what lets `apply` keep
   * the decision in one line. `off` never calls the linter at all, so a model
   * without one behaves exactly as it did before this option existed; asking
   * to lint without one is the CALLER's mistake and is refused rather than
   * answered with an empty list that would read as "no issues found".
   */
  /** `ops` and `roomMerges`: what the batch renamed and merged (`issue-heirs.ts`), read only by `strict-new`. */
  private lint(
    mode: LintMode,
    candidate: SceneData,
    plan: SolvedPlan,
    ops: readonly SceneOp[],
    roomMerges: readonly RoomMerge[],
  ): LayoutIssue[] | ApplyFailure {
    if (mode === 'off') return [];
    if (!this.linter) {
      return {
        error: 'layout_failed',
        message: `Batch asked for lint: '${mode}', but this SceneModel was built without a layout linter (pass { lint: lintLayout })`,
      };
    }
    const issues = [...this.linter(candidate, plan)];
    if (mode === 'report') return issues;
    let errors = issues.filter((issue) => issue.severity === 'error');
    if (mode === 'strict-new') {
      const old = this.baseErrorIssues(this.linter);
      const base = inheritedKeys(old, heirsOf(ops, roomMerges));
      const openings = new Set(candidate.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => opening.id)));
      errors = errors.filter((issue) => !base.has(issueKey(issue)) && !inheritedCirculation(issue, old, roomMerges, openings));
    }
    if (errors.length === 0) return issues;
    const what = mode === 'strict-new' ? 'new error(s)' : 'error(s)';
    return {
      error: 'layout_failed',
      message: `Layout lint refused the batch: ${errors.length} ${what}, first is ${errors[0]!.rule} — ${errors[0]!.message}`,
      issues,
    };
  }

  /** The committed document's hard issues, linted once per revision. */
  private baseErrorIssues(linter: LayoutLinter): readonly LayoutIssue[] {
    if (this.baseErrors?.rev === this.revision) return this.baseErrors.issues;
    const issues = linter(this.committed, this.solved).filter((issue) => issue.severity === 'error');
    this.baseErrors = { rev: this.revision, issues };
    return issues;
  }

  /**
   * One throwing revision listener: recorded for the `ApplyResult` and handed
   * to `onError`, whose own throw is recorded too rather than escaping.
   */
  private collectListenerError(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.pendingErrors.push(failure);
    try {
      this.onListenerError?.(failure);
    } catch (sinkError) {
      this.pendingErrors.push(sinkError instanceof Error ? sinkError : new Error(String(sinkError)));
    }
  }

  /** Registers a sink for listener failures; the returned function clears it. */
  onError(handler: (error: Error) => void): () => void {
    this.onListenerError = handler;
    return () => {
      this.onListenerError = undefined;
    };
  }

  /** Subscribes to commits; the returned function unsubscribes. */
  onRevision(listener: RevisionListener): () => void {
    return this.listeners.add(listener);
  }

  /**
   * Exportable draft: a deep copy of the committed scene, deeply mutable in the
   * type system as well, so a caller can edit it and hand it back to
   * `SceneModel.load` (or a repository) and get the scene it asked for.
   */
  toJSON(): Draft<SceneData> {
    return draftOf(this.committed);
  }
}
