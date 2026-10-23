/**
 * A click on the scene as a public event: recognising the gesture, building
 * the `ViewerSelection` and highlighting what was selected.
 *
 * Invariant: the viewer NEVER changes the selection by itself. A click is
 * REPORTED (`events.emit('select', …)`) and the highlight is only ever what a
 * host asked for through `ViewerHandle.setSelection` — usually from its own
 * `select` handler. That is what keeps a published tour behaving exactly as it
 * did before this module existed, and what makes `options.select: false` a
 * complete off switch: with it the pointer listener is not attached at all.
 *
 * Gesture: primary button, `pointerdown` -> `pointerup` on the canvas, under
 * `SELECT_MAX_MOVE_PX` of travel and under `SELECT_MAX_DURATION_MS`, no
 * modifier keys. A camera drag therefore never selects. The listener is
 * PASSIVE and never calls `preventDefault`: the built-in click behaviour
 * (opening a door, raising a variant panel) is `camera-input.ts`'s and stays
 * exactly as it was — this module adds a report, it replaces nothing.
 */

import type * as THREE from 'three';
import type { FaceKey, ViewerMode } from '../scene/types.js';
import type { Picker, SurfacePick } from '../geometry/picker.js';
import { linkedAbortController } from '../shared/abort.js';
import { SelectionHighlight, type HighlightKind, type HighlightTarget } from '../render/selection-highlight.js';

/** What a click named; `'none'` when it landed on nothing. */
export type ViewerSelectionKind = HighlightKind | 'none';

/** What a host may ask the viewer to highlight. */
export type ViewerSelectionTarget = HighlightTarget;

export type ViewerSelection = {
  readonly kind: ViewerSelectionKind;
  /** `wallId` | `openingId` | `roomId` | `assetId`; absent for `'none'`. */
  readonly id?: string;
  /** For an opening: the wall it hangs on. For a wall: itself. */
  readonly wallId?: string;
  /** The room the clicked face belongs to (a wall, a floor); absent on the facade. */
  readonly roomId?: string;
  /** For a wall: the painting unit `{ room?, wallId, side }`, `room` omitted on the facade. */
  readonly face?: FaceKey;
  /** Where the ray met the scene, in plan metres (X-Z). */
  readonly point?: { readonly x: number; readonly z: number };
  readonly mode: ViewerMode;
};

/** Pointer travel, in CSS pixels, at or beyond which a press is a drag. */
export const SELECT_MAX_MOVE_PX = 5;
/** Press duration, in milliseconds, at or beyond which a press is not a click. */
export const SELECT_MAX_DURATION_MS = 300;
/** The modes a click reports in; `walk` and `tour` steer the gaze instead. */
export const SELECT_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['plan2d', 'plan3d', 'orbit']);

/** Where and when a press started, and which pointer made it. */
export type PointerDown = { x: number; y: number; at: number; pointerId: number };

/** Whether a press-and-release is a CLICK rather than a drag or a hold. */
export function isSelectClick(down: PointerDown, up: { x: number; y: number; at: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) < SELECT_MAX_MOVE_PX && up.at - down.at < SELECT_MAX_DURATION_MS;
}

/** One picked surface as the public selection. Pure: the whole vocabulary decision. */
export function selectionFrom(pick: SurfacePick, point: { x: number; z: number }, mode: ViewerMode): ViewerSelection {
  if (pick.surface === 'furniture') return strip({ kind: 'furniture', id: pick.assetId, point, mode });
  if (pick.surface === 'opening') return strip({ kind: 'opening', id: pick.openingId, wallId: pick.wallId, point, mode });
  if (pick.surface === 'wall') {
    return strip({ kind: 'wall', id: pick.wallId, wallId: pick.wallId, roomId: pick.roomId, face: pick.face, point, mode });
  }
  return strip({ kind: 'room', id: pick.roomId, roomId: pick.roomId, point, mode });
}

/**
 * Drops the keys that came out `undefined`.
 *
 * `exactOptionalPropertyTypes` is on: an absent field must be ABSENT, never
 * present and `undefined`, or a host comparing two selections with `toEqual`
 * has to know which of them spells an absent key which way. The parameter is a
 * plain record rather than `ViewerSelection` for the same reason — the callers
 * above hand in `id: string | undefined`, which the public type refuses by
 * design; this function is exactly the place that turns one into the other.
 */
function strip(selection: Record<string, unknown>): ViewerSelection {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(selection)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as ViewerSelection;
}

/** What the controller needs of the running viewer; all of it late-bound. */
export type SelectionDeps = {
  /** The scene canvas: where the pointer is heard and what the pick is measured against. */
  canvas: HTMLElement;
  picker: Picker;
  /** The built scene graph the highlight looks the target up in. */
  root: () => THREE.Object3D | undefined;
  /** The camera a pick is cast with — `PlanModes.pickCamera()`, which the plan modes swap. */
  camera: () => THREE.Camera | undefined;
  /** The mode on screen; `undefined` before the camera stack exists. */
  mode: () => ViewerMode | undefined;
  /** Raises the public `select` event. */
  emit: (selection: ViewerSelection) => void;
  /** `options.select` (and `interaction !== 'none'`): whether to listen at all. */
  listen: boolean;
  /** The mounted viewer's lifetime. */
  signal?: AbortSignal | undefined;
};

/**
 * One mounted viewer's selection: the pointer listener, the last report and
 * the highlight.
 */
export class ViewerSelectionController {
  private readonly deps: SelectionDeps;
  private readonly listeners: AbortController;
  private readonly highlight: SelectionHighlight;
  private down: PointerDown | null = null;
  private last: ViewerSelection | null = null;

  constructor(deps: SelectionDeps) {
    this.deps = deps;
    this.highlight = new SelectionHighlight(deps.root);
    this.listeners = linkedAbortController(deps.signal);
    if (!deps.listen) return;
    const options: AddEventListenerOptions = { signal: this.listeners.signal, passive: true };
    deps.canvas.addEventListener('pointerdown', this.onPointerDown as EventListener, options);
    deps.canvas.addEventListener('pointerup', this.onPointerUp as EventListener, options);
    deps.canvas.addEventListener('pointercancel', this.onPointerCancel as EventListener, options);
  }

  /** The last report and the current highlight, for `__viewerDebug.selection()`. */
  current(): { last: ViewerSelection | null; highlight: ViewerSelectionTarget | null } {
    return { last: this.last, highlight: this.highlight.target };
  }

  /** `ViewerHandle.setSelection`: what the HOST asked to highlight. */
  setSelection(target: ViewerSelectionTarget | null): void {
    this.highlight.set(target);
  }

  /** Recolours the highlight (the asset move tool's green and red), `null` restores it. */
  tint(colour: number | null): void {
    this.highlight.setColour(colour);
  }

  /** A rebuilt document: the same highlight on the new meshes, or none. */
  reapply(): void {
    this.highlight.reapply();
  }

  /** Per frame: the fade (`app/viewer-frame.ts`); whether the picture changed. */
  update(now: number): boolean {
    return this.highlight.update(now);
  }

  dispose(): void {
    this.highlight.dispose();
    this.listeners.abort();
    this.down = null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      this.down = null;
      return;
    }
    this.down = { x: event.clientX, y: event.clientY, at: event.timeStamp, pointerId: event.pointerId };
  };

  private onPointerCancel = (): void => {
    this.down = null;
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.down;
    this.down = null;
    if (!down || down.pointerId !== event.pointerId) return;
    if (!isSelectClick(down, { x: event.clientX, y: event.clientY, at: event.timeStamp })) return;
    const mode = this.deps.mode();
    if (!mode || !SELECT_MODES.has(mode)) return;
    const camera = this.deps.camera();
    if (!camera) return;
    const picked = this.deps.picker.pickSelection(event.clientX, event.clientY, camera);
    const selection: ViewerSelection = picked
      ? selectionFrom(picked.pick, { x: picked.point.x, z: picked.point.z }, mode)
      : { kind: 'none', mode };
    this.last = selection;
    this.deps.emit(selection);
  };
}
