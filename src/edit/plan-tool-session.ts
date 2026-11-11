/**
 * The plan tool's DOM binding and its handle painter.
 *
 * Input, in the pattern of the asset move tool: pointer listeners in the
 * capture phase on the canvas's PARENT, counting only presses whose target is
 * the scene canvas (in `plan2d` every pointer event lands there: the plan's
 * own canvas does not take pointer events), so a claimed press never reaches
 * the selection controller and the click after it is consumed. A press
 * anywhere else passes through untouched, and so does every move, release or
 * cancel of a pointer other than the one that pressed. A cancelled pointer
 * lets go of a claimed press, dragging or not. Esc on the viewer's key target
 * ends a drag. Over a handle the scene canvas carries `data-plan-handle="<kind>"`
 * (and `data-plan-drag` while dragging), which `viewer.css` turns into the
 * grab cursors.
 *
 * Painting: the handles as discs in the drawing's accent, 6 px, 8 px for the
 * hovered or dragged one; while the current trial fails the dragged one
 * follows the pointer in the refusal tint.
 */

import { listenerOptions } from '../shared/abort.js';
import { planPoint, type PlanTransform } from '../plan/plan-drawing.js';
import { claimPointer, releasePointer } from './drag-kit.js';
import type { CanvasPoint, PlanHandlesView, PlanTool } from './plan-tool.js';

/** Where the tool listens. */
export type PlanToolInputDeps = {
  /** The canvas's parent: its capture phase runs before every listener on the canvas. */
  container: HTMLElement;
  canvas: HTMLElement;
  /** The viewer's key target. */
  keys: HTMLElement;
  /** Whether a key event comes from a text field (the viewer's own or a host slot's). */
  typing: (event: KeyboardEvent) => boolean;
  signal: AbortSignal;
};

/** Handle radii, CSS px: at rest, and hovered or dragged. */
const HANDLE_PX = 6;
const ACTIVE_PX = 8;

/** Binds the tool's input; the answer unbinds it. */
export function bindPlanToolInput(tool: PlanTool, deps: PlanToolInputDeps): () => void {
  const capture: AddEventListenerOptions = { ...listenerOptions(deps.signal), capture: true };
  let consumeClick = false;
  const point = (event: MouseEvent): CanvasPoint => {
    const rect = deps.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const cursor = (): void => {
    const handle = tool.view()?.active ?? null;
    if (handle) deps.canvas.dataset['planHandle'] = handle.kind;
    else delete deps.canvas.dataset['planHandle'];
    if (tool.dragging()) deps.canvas.dataset['planDrag'] = 'true';
    else delete deps.canvas.dataset['planDrag'];
  };
  /** Whether the tool holds a press of another pointer than `event`'s. */
  const other = (event: PointerEvent): boolean => {
    const held = tool.pressedBy();
    return held !== null && held !== event.pointerId;
  };
  const onDown = (event: PointerEvent): void => {
    if (other(event)) return;
    consumeClick = false;
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.target !== deps.canvas) return;
    if (!tool.press(point(event), event.pointerId)) return;
    consumeClick = true;
    claimPointer(deps.canvas, event);
  };
  const onMove = (event: PointerEvent): void => {
    if (other(event)) return;
    if (tool.move(point(event))) event.stopImmediatePropagation();
    else tool.hover(point(event));
    cursor();
  };
  const onUp = (event: PointerEvent): void => {
    if (other(event)) return;
    if (!tool.release(point(event))) return;
    event.stopImmediatePropagation();
    releasePointer(deps.canvas, event.pointerId);
    cursor();
  };
  const onCancel = (event: PointerEvent): void => {
    if (other(event) || !tool.cancel()) return;
    event.stopImmediatePropagation();
    releasePointer(deps.canvas, event.pointerId);
    cursor();
  };
  const onClick = (event: MouseEvent): void => {
    if (!consumeClick) return;
    consumeClick = false;
    event.stopImmediatePropagation();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (deps.typing(event) || !tool.key(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cursor();
  };
  const pointer: Array<[string, EventListener]> = [
    ['pointerdown', onDown as EventListener],
    ['pointermove', onMove as EventListener],
    ['pointerup', onUp as EventListener],
    ['pointercancel', onCancel as EventListener],
    ['click', onClick as EventListener],
  ];
  for (const [type, handler] of pointer) deps.container.addEventListener(type, handler, capture);
  deps.keys.addEventListener('keydown', onKey as EventListener, capture);
  return () => {
    for (const [type, handler] of pointer) deps.container.removeEventListener(type, handler, capture);
    deps.keys.removeEventListener('keydown', onKey as EventListener, capture);
    delete deps.canvas.dataset['planHandle'];
    delete deps.canvas.dataset['planDrag'];
  };
}

/** Paints the handles of `view` over the 2D plan (`PlanModes.setDecoration`). */
export function paintPlanHandles(
  ctx: CanvasRenderingContext2D,
  transform: PlanTransform,
  view: PlanHandlesView,
  colours: { accent: string; bad: string; paper: string },
): void {
  for (const handle of view.handles) {
    const active = handle === view.active;
    const at = planPoint(transform, active && view.pointer ? view.pointer : handle.at);
    ctx.beginPath();
    ctx.arc(at.x, at.y, active ? ACTIVE_PX : HANDLE_PX, 0, Math.PI * 2);
    ctx.fillStyle = active && view.bad ? colours.bad : colours.accent;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colours.paper;
    ctx.stroke();
  }
}
