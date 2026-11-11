/**
 * The plan tool's view of the running viewer (`edit/plan-tool.ts`), built on
 * one stage by the authoring chunk (`authoring.ts`), in the pattern of
 * `asset-move-wiring.ts`.
 *
 * What the tool reads, all late-bound: the mode, the host's selection (the
 * highlight `setSelection` set), the committed model of the mount, and the 2D
 * drawing's fit. What it writes: the draft and the handles on the 2D plan
 * (`PlanModes.setDraft`, `setDecoration`), `planEdit`, `planEditRefused` and
 * `planToolState` on the public fan-out, and its two hints. The 3D scene is
 * never touched: the renderer is off in `plan2d`, and the host's next document
 * rebuilds it once.
 */

import { isTypingTarget } from '../camera/camera-input.js';
import { PlanTool } from '../edit/plan-tool.js';
import { bindPlanToolInput, paintPlanHandles } from '../edit/plan-tool-session.js';
import type { PlanDecoration } from '../ui/plan-modes.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ViewerRoots } from '../ui/viewer-shell.js';
import { MOVE_BAD_TINT } from './asset-move-wiring.js';
import type { SceneMount } from './scene-mount.js';
import type { ViewerEvents } from './viewer-events.js';
import type { ViewerStage } from './viewer-stage.js';

/** The drawing's accent and paper (`plan-canvas.ts`'s `drawing` palette), and the refusal tint of the move tools. */
const COLOURS = { accent: '#dfbd7d', paper: '#ffffff', bad: `#${MOVE_BAD_TINT.toString(16).padStart(6, '0')}` } as const;

/** The plan tool's switch and its two host commands. */
export type PlanToolControl = {
  setEnabled(enabled: boolean): void;
  revert(): void;
  dispose(): void;
};

export function planToolWiring(deps: {
  stage: ViewerStage;
  mount: () => SceneMount;
  events: ViewerEvents;
  ui: ViewerUI;
  roots: ViewerRoots;
  signal: AbortSignal;
}): PlanToolControl {
  const { stage, roots } = deps;
  const paint: PlanDecoration = (ctx, transform) => {
    const view = tool.view();
    if (view) paintPlanHandles(ctx, transform, view, COLOURS);
  };
  const tool: PlanTool = new PlanTool({
    mode: () => stage.mode,
    target: () => stage.selection.current().highlight,
    model: () => deps.mount().model ?? null,
    transform: () => stage.planModes.view()?.transform ?? null,
    showDraft: (draft) => stage.planModes.setDraft(draft),
    // Handing the painter in again repaints the plan with it.
    redraw: () => stage.planModes.setDecoration(paint),
    emitEdit: (edit) => deps.events.emit('planEdit', edit),
    emitRefused: (refusal) => deps.events.emit('planEditRefused', refusal),
    emitState: (state) => deps.events.emit('planToolState', state),
    hint: (key) => {
      if (key !== null) stage.director?.hint(key);
      else if (stage.mode) deps.ui.setHintForMode(stage.mode);
    },
    frame: (run) => requestAnimationFrame(run),
  });
  const unbind = bindPlanToolInput(tool, {
    container: roots.canvas.parentElement ?? roots.viewport,
    canvas: roots.canvas,
    keys: roots.root,
    typing: (event) => isTypingTarget(typeof event.composedPath === 'function' ? event.composedPath() : []),
    signal: deps.signal,
  });
  stage.planModes.setDecoration(paint);
  // A committed document answers a pending edit or leaves it (`pending-plan-edit.ts`); leaving `plan2d` ends a drag.
  const offScene = deps.events.on('scene', () => tool.documentChanged());
  const offMode = deps.events.on('mode', (mode) => {
    if (mode !== 'plan2d') tool.cancel();
  });

  return {
    setEnabled: (enabled) => tool.setEnabled(enabled),
    revert: () => tool.revert(),
    dispose() {
      offScene();
      offMode();
      tool.cancel();
      unbind();
      stage.planModes.setDecoration(null);
      stage.planModes.setDraft(null);
    },
  };
}
