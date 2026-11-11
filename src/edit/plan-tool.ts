/**
 * The plan tool: handles on the wall or opening the host selected, dragged on
 * the 2D plan (`plan2d`) into an edit batch the HOST commits.
 *
 * The state machine is `idle → pressed → dragging → idle`. A press within
 * `HIT_RADIUS_PX` of a handle is claimed; past `DRAG_THRESHOLD_PX` of travel
 * the drag starts (`planToolState: dragging`). Each pointer move records the
 * point, and one trial runs per animation frame on the latest one: the
 * gesture's ops (`plan-gesture.ts`), with the unanswered ops in front
 * (`pending-plan-edit.ts`), judged by `SceneModel.trial` on the committed
 * model. A legal candidate is shown as the draft; an illegal one leaves the
 * last legal draft and paints the dragged handle in the `bad` tint. The
 * release is judged once more: legal emits `planEdit` and the draft stays as
 * the pending edit, illegal puts back the drawing of before the press and
 * emits `planEditRefused` with the model's message. Esc, a cancelled pointer,
 * leaving `plan2d`, disarming, or another selection ends a drag with no edit.
 *
 * The tool mints no id and emits nothing but `move_node` and `set_opening`.
 * It reads and writes only through its host (`PlanToolHost`); the DOM binding
 * is `plan-tool-session.ts`. Points are canvas CSS pixels.
 */

import { handleAt, planHandles, type PlanHandle, type PlanHandleTarget } from '../plan/plan-handles.js';
import { planPointAt, type PlanTransform } from '../plan/plan-drawing.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { Vec2, ViewerMode } from '../scene/types.js';
import { gestureOps } from './plan-gesture.js';
import { PendingPlanEdit, type PlanDraft } from './pending-plan-edit.js';
import type { PlanEdit, PlanEditOp, PlanEditRefused, PlanEditTarget, PlanToolStateEvent } from './plan-edit.js';

/** A handle answers within 12 CSS px of its centre, for mouse, pen and touch alike: a 24 px target. */
export const HIT_RADIUS_PX = 12;
/** Travel before a press becomes a drag, CSS px. */
const DRAG_THRESHOLD_PX = 3;

/** A canvas point in CSS pixels. */
export type CanvasPoint = { readonly x: number; readonly y: number };

/** The hints the tool raises; `null` gives the mode's own hint back. */
export type PlanToolHint = 'hint.planTool' | 'hint.planEditIllegal' | null;

/** What the tool reads of the running viewer and what it writes back, all late-bound. */
export type PlanToolHost = {
  mode(): ViewerMode | undefined;
  /** The host's selection (`ViewerHandle.setSelection`). */
  target(): PlanHandleTarget | null;
  /** The committed model; `null` before the first document. */
  model(): Pick<SceneModel, 'scene' | 'plan' | 'rev' | 'trial'> | null;
  /** The 2D drawing's fit (`PlanModes.view`), `null` before a document. */
  transform(): PlanTransform | null;
  /** Shows a candidate on the 2D plan; `null` shows the committed document. */
  showDraft(draft: PlanDraft | null): void;
  /** The handles changed: repaint them. */
  redraw(): void;
  emitEdit(edit: PlanEdit): void;
  emitRefused(refusal: PlanEditRefused): void;
  emitState(state: PlanToolStateEvent): void;
  hint(key: PlanToolHint): void;
  /** Runs `run` on the next animation frame. */
  frame(run: () => void): void;
};

/** What the handle painter draws: the handles, the one hovered or dragged, and whether the current trial fails. */
export type PlanHandlesView = {
  readonly handles: readonly PlanHandle[];
  /** One of `handles`: the one hovered or dragged. */
  readonly active: PlanHandle | null;
  readonly dragging: boolean;
  readonly bad: boolean;
  /** Where the dragged handle is while the trial fails: the pointer, in plan metres. */
  readonly pointer: Vec2 | null;
};

type Drag = {
  readonly target: PlanEditTarget;
  readonly handle: PlanHandle;
  readonly press: CanvasPoint;
  readonly pressPlan: Vec2;
  /** The document the handles were read from: the pending draft, else the committed one. */
  readonly start: PlanDraft;
  readonly sceneId: string;
  readonly rev: number;
  dragging: boolean;
  latest: CanvasPoint;
  queued: boolean;
  /** The last legal candidate, its ops and gesture, or the last refusal's message. */
  legal: PlanDraft | null;
  ops: readonly PlanEditOp[];
  gesture: PlanEdit['gesture'];
  failure: string | null;
  pointer: Vec2 | null;
};

export class PlanTool {
  private readonly host: PlanToolHost;
  private readonly pending = new PendingPlanEdit();
  private enabled = false;
  private drag: Drag | null = null;
  private hovered: PlanHandle | null = null;

  constructor(host: PlanToolHost) {
    this.host = host;
  }

  /** `handle.setPlanTool`: disarming ends a drag; a pending edit stays until answered. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
    this.hovered = null;
    this.host.redraw();
  }

  /** Whether a drag is running (past the threshold). */
  dragging(): boolean {
    return this.drag?.dragging === true;
  }

  /** A primary press at `point`: `true` when it landed on a handle and the tool claims it. */
  press(point: CanvasPoint): boolean {
    const target = this.target();
    const model = this.host.model();
    const transform = this.host.transform();
    if (this.drag || !target || !model || !transform) return false;
    const start = this.pending.draft() ?? { scene: model.scene, plan: model.plan };
    const handle = handleAt(planHandles(start.plan, start.scene, target), point, transform, HIT_RADIUS_PX);
    if (!handle) return false;
    this.drag = {
      target,
      handle,
      press: point,
      pressPlan: planPointAt(transform, point),
      start,
      sceneId: model.scene.id,
      rev: model.rev,
      dragging: false,
      latest: point,
      queued: false,
      legal: null,
      ops: [],
      gesture: 'node',
      failure: null,
      pointer: null,
    };
    return true;
  }

  /** The pointer moved; `true` while the tool owns the pointer. */
  move(point: CanvasPoint): boolean {
    const drag = this.drag;
    if (!drag) return false;
    if (!this.stillOn(drag)) {
      this.cancel();
      return true;
    }
    if (!drag.dragging) {
      if (Math.hypot(point.x - drag.press.x, point.y - drag.press.y) < DRAG_THRESHOLD_PX) return true;
      drag.dragging = true;
      this.host.emitState({ phase: 'dragging' });
      this.host.hint('hint.planTool');
    }
    drag.latest = point;
    if (!drag.queued) {
      drag.queued = true;
      this.host.frame(() => {
        drag.queued = false;
        if (this.drag === drag) this.judge(drag, drag.latest);
      });
    }
    return true;
  }

  /** The pointer was released; `true` when the tool owned the press. */
  release(point: CanvasPoint): boolean {
    const drag = this.drag;
    if (!drag) return false;
    if (!drag.dragging || !this.stillOn(drag)) {
      this.cancel();
      return true;
    }
    this.judge(drag, point);
    if (drag.failure === null && drag.legal) {
      this.pending.record(drag.sceneId, drag.rev, drag.ops, drag.legal);
      this.host.emitEdit({ target: drag.target, ops: drag.ops, baseRev: drag.rev, gesture: drag.gesture });
    } else {
      this.host.showDraft(this.pending.draft());
      this.host.emitRefused({
        target: drag.target,
        ops: drag.ops,
        reason: { code: 'validation_failed', message: drag.failure ?? 'The plan tool could not place this handle' },
      });
    }
    this.end();
    return true;
  }

  /** Ends a drag with no edit and puts the drawing of before the press back. */
  cancel(): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.dragging) {
      this.host.showDraft(this.pending.draft());
      this.end();
      return;
    }
    this.drag = null;
  }

  /** A key on the viewer: Esc ends a drag. `true` when the tool used it. */
  key(key: string): boolean {
    if (key !== 'Escape' || !this.drag) return false;
    this.cancel();
    return true;
  }

  /** The handle under `point` while no drag runs, for the cursor; `null` off every handle. */
  hover(point: CanvasPoint): PlanHandle | null {
    if (this.drag) return this.drag.handle;
    const target = this.target();
    const model = this.host.model();
    const transform = this.host.transform();
    const start = model && (this.pending.draft() ?? { scene: model.scene, plan: model.plan });
    const handle =
      target && start && transform ? handleAt(planHandles(start.plan, start.scene, target), point, transform, HIT_RADIUS_PX) : null;
    if ((handle === null) !== (this.hovered === null) || (handle && this.hovered && !sameHandle(handle, this.hovered))) {
      this.hovered = handle;
      this.host.redraw();
    }
    return handle;
  }

  /**
   * A committed document arrived: a running drag on another document ends,
   * and a revision past the pending edit's, or another scene, answers it.
   */
  documentChanged(): void {
    const model = this.host.model();
    if (!model) return;
    if (this.drag && (this.drag.sceneId !== model.scene.id || this.drag.rev !== model.rev)) this.cancel();
    if (this.pending.documentChanged(model.scene.id, model.rev)) this.host.showDraft(null);
    this.host.redraw();
  }

  /** `handle.revertPlanEdit`: the host refused; the committed document shows again. Nothing pending: nothing happens. */
  revert(): void {
    this.cancel();
    if (this.pending.revert()) this.host.showDraft(null);
    this.host.redraw();
  }

  /** What the painter draws now; `null` while the tool shows nothing. */
  view(): PlanHandlesView | null {
    const target = this.target();
    const model = this.host.model();
    if (!target || !model) return null;
    const drag = this.drag;
    const shown = (drag?.dragging ? drag.legal : null) ?? this.pending.draft() ?? { scene: model.scene, plan: model.plan };
    const handles = planHandles(shown.plan, shown.scene, target);
    const wanted = drag?.handle ?? this.hovered;
    const active = wanted ? (handles.find((handle) => sameHandle(handle, wanted)) ?? null) : null;
    const bad = drag?.dragging === true && drag.failure !== null;
    return { handles, active, dragging: drag?.dragging === true, bad, pointer: bad ? drag.pointer : null };
  }

  /** The host's selection while the tool may act on it: armed, in `plan2d`, a wall or an opening. */
  private target(): PlanEditTarget | null {
    if (!this.enabled || this.host.mode() !== 'plan2d') return null;
    const target = this.host.target();
    return target && (target.kind === 'wall' || target.kind === 'opening') ? { kind: target.kind, id: target.id } : null;
  }

  /** Whether the drag's conditions still hold: armed, `plan2d`, the same selection, the same document. */
  private stillOn(drag: Drag): boolean {
    const target = this.target();
    const model = this.host.model();
    return target?.kind === drag.target.kind && target.id === drag.target.id && model?.scene.id === drag.sceneId && model.rev === drag.rev;
  }

  /** One trial of the drag at `point`. */
  private judge(drag: Drag, point: CanvasPoint): void {
    const model = this.host.model();
    const transform = this.host.transform();
    if (!model || !transform) return;
    const pointer = planPointAt(transform, point);
    const gesture = gestureOps(drag.handle, drag.pressPlan, pointer, drag.start);
    if (!gesture) return;
    drag.ops = gesture.ops;
    drag.gesture = gesture.gesture;
    drag.pointer = { x: drag.handle.at.x + pointer.x - drag.pressPlan.x, z: drag.handle.at.z + pointer.z - drag.pressPlan.z };
    const result = model.trial({ baseRev: model.rev, ops: [...this.pending.ops(), ...gesture.ops] });
    const wasBad = drag.failure !== null;
    if ('error' in result) {
      drag.failure = result.message;
      if (!wasBad) this.host.hint('hint.planEditIllegal');
    } else {
      drag.failure = null;
      drag.legal = result;
      this.host.showDraft(result);
      if (wasBad) this.host.hint('hint.planTool');
    }
    this.host.redraw();
  }

  /** The drag is over, whatever its outcome. */
  private end(): void {
    this.drag = null;
    this.host.emitState({ phase: 'idle' });
    this.host.hint(null);
    this.host.redraw();
  }
}

/** Whether two handles stand for the same thing (their positions differ between documents). */
function sameHandle(a: PlanHandle, b: PlanHandle): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'node' && b.kind === 'node') return a.nodeId === b.nodeId;
  if (a.kind === 'opening-end' && b.kind === 'opening-end') return a.openingId === b.openingId && a.end === b.end;
  return true;
}
