/**
 * The asset move tool's canvas listeners and the session the lazy chunk hands
 * the wiring.
 *
 * Input order: the listeners sit on the canvas's PARENT in the capture phase,
 * so a claimed press never reaches the orbit rig, the scene selection or the
 * tour-camera tool on the canvas, even though this module loads lazily, long
 * after those listeners were added. The parent also holds the chrome and the
 * host slots, so a press counts only when its target is the canvas.
 */

import type * as THREE from 'three';
import type { MirrorAxis } from '../scene/types.js';
import { listenerOptions } from '../shared/abort.js';
import { claimPointer, releasePointer } from './drag-kit.js';
import { AssetMoveTool, type AssetMoveHost, type AssetMoveState, type PointerSample } from './asset-move-tool.js';
import { AssetSurfaceOverlay } from './asset-surface-overlay.js';
import { AssetHandlesView } from './asset-handles-view.js';
import { handleAt, handleShape, type HandlePixel, type HandlePoint } from './asset-handles.js';
import { dragCatalogue } from './asset-move-catalogue.js';
import { dragContext, poseItem, type DragContext } from '../layout/asset-legality.js';
import { shippedFacts } from '../layout/layout-lint.js';

/** `__viewerDebug.assetMove()`: the switch, the chunk, and the tool's own state once it is there. */
export type AssetMoveDebug = { readonly enabled: boolean; readonly loaded: boolean; readonly state: AssetMoveState | null };

/** The switch `handle-commands.ts` drives and the stage keeps (`app/asset-move-wiring.ts` builds it). */
export type AssetMoveControl = {
  /** `handle.setAssetMoveTool`: arms or disarms the tool; the first arming loads it. */
  setEnabled(enabled: boolean): void;
  /** The next press moves the selected object to it (a host card's «Move» toggle). */
  arm(): void;
  /** `handle.revertAssetEdit`: the host refused the last edit. */
  revert(): void;
  /** `handle.mirrorAsset`: toggles one axis; `false` with no event while the chunk is not in. */
  mirror(assetId: string, axis: MirrorAxis): boolean;
  /** `handle.turnAsset`: `false` until the chunk is in, or when the tool refuses to judge it. */
  turnAsset(assetId: string, steps: number): boolean;
  /** Resolves once the lazy chunk is in (immediately when it already is, or never armed). */
  loaded(): Promise<void>;
  debug(): AssetMoveDebug;
  dispose(): void;
};

/* ------------------------------------------------------------ listeners --- */

/** Where the tool listens. */
export type AssetMoveInputDeps = {
  /** The canvas's parent: its capture phase runs before every listener on the canvas. */
  container: HTMLElement;
  canvas: HTMLElement;
  /** The viewer's key target. */
  keys: HTMLElement;
  /** Whether a key event was typed into host chrome (`camera-input.isTypingTarget`). */
  typing: (event: KeyboardEvent) => boolean;
  signal?: AbortSignal | undefined;
};

/** Binds the tool to the DOM; the answer unbinds. */
export function bindAssetMoveInput(tool: AssetMoveTool, deps: AssetMoveInputDeps): () => void {
  const capture: AddEventListenerOptions = { ...listenerOptions(deps.signal), capture: true };
  let consumeClick = false;
  const sample = (event: PointerEvent): PointerSample => ({
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    shiftKey: event.shiftKey,
  });
  const onDown = (event: PointerEvent): void => {
    // A claimed press released outside the viewer never clicked; its flag must not eat this press's click.
    consumeClick = false;
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    // Only a press on the scene itself: the capture listener on the parent also
    // hears the viewer's chrome and the host's slot content (an editor host's
    // selection card and its «Move» button). Those presses pass through
    // untouched and leave an armed «Move» armed — the host disarms its own.
    if (event.target !== deps.canvas) return;
    if (!tool.down(sample(event))) return;
    consumeClick = true;
    claimPointer(deps.canvas, event);
  };
  const onMove = (event: PointerEvent): void => {
    if (!tool.move(sample(event))) return;
    event.stopImmediatePropagation();
    deps.canvas.style.cursor = tool.state().phase === 'dragging' ? 'grabbing' : '';
  };
  const onUp = (event: PointerEvent): void => {
    if (!tool.up(sample(event))) return;
    event.stopImmediatePropagation();
    deps.canvas.style.cursor = '';
    releasePointer(deps.canvas, event.pointerId);
  };
  const onCancel = (event: PointerEvent): void => {
    if (tool.cancel()) event.stopImmediatePropagation();
    deps.canvas.style.cursor = '';
  };
  const onClick = (event: MouseEvent): void => {
    // The click after a claimed press belongs to the tool, not to a door behind the object.
    if (!consumeClick) return;
    consumeClick = false;
    event.stopImmediatePropagation();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (deps.typing(event)) return;
    if (!tool.key(event.key, event.shiftKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
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
  };
}

/* -------------------------------------------------------------- session --- */

/** The tool, its legality field and its listeners: what the lazy chunk hands the wiring. */
export type AssetMoveSession = {
  readonly tool: AssetMoveTool;
  readonly overlay: AssetSurfaceOverlay;
  dispose(): void;
};

/** What the handles need of the viewer: a frame to follow the object in, and the camera the mode draws with. */
export type HandlesHost = {
  /** Registers and drops the per-frame hook the handles follow the selection in (`RenderRuntime.addFrameHook`). */
  addFrameHook(hook: () => void): void;
  removeFrameHook(hook: () => void): void;
  /** A plan point in client pixels through that camera, `null` behind it. */
  project(point: HandlePoint): HandlePixel | null;
  /** The plan direction pointing up the screen in the top view. */
  screenUp(): { x: number; z: number };
  /** `orbit` or `plan3d`, the modes the tool serves; `null` in any other. */
  mode(): 'orbit' | 'plan3d' | null;
};

/** The tool's host as the wiring gives it: the field and the handles are the session's own, and `redraw` asks the viewer for a frame. */
export type SessionHost = Omit<AssetMoveHost, 'drawMask' | 'handleAt'> & {
  /** Something the tool shows changed; the editing modes draw on demand (`RenderDemand.invalidate`). */
  redraw?: (() => void) | undefined;
  /** Absent draws no handles: the body drag and the keys remain. */
  handles?: HandlesHost | undefined;
};

/**
 * The tool's host with every on-screen change followed by `redraw`: a preview
 * pose (a drag, a nudge, a mirror, the revert to the start) and the legality
 * field drawn or removed. The editing modes draw on demand, so neither may
 * rely on a frame something else happens to cause.
 */
export function redrawingHost(host: SessionHost, drawField: AssetMoveHost['drawMask']): AssetMoveHost {
  const { redraw, ...rest } = host;
  return {
    ...rest,
    show: (assetId, pose, mirror) => {
      if (mirror) host.show(assetId, pose, mirror);
      else host.show(assetId, pose);
      redraw?.();
    },
    drawMask: (field) => {
      drawField(field);
      redraw?.();
    },
  };
}

/**
 * Builds the tool on first arming (`app/asset-move-wiring.ts` imports this
 * module dynamically, so none of it — the tool, the overlay, the legality
 * judge — is in the boot bundle). The field is drawn under `scene`.
 */
export function startAssetMove(host: SessionHost, input: AssetMoveInputDeps, scene: THREE.Object3D): AssetMoveSession {
  const overlay = new AssetSurfaceOverlay();
  scene.add(overlay.group);
  const handles = host.handles;
  const view = handles ? new AssetHandlesView() : null;
  if (view) scene.add(view.group);
  const toolHost = redrawingHost(host, (field) => overlay.show(field));
  if (handles && view)
    toolHost.handleAt = (clientX, clientY) => handleAt(view.current(), (point) => handles.project(point), { x: clientX, y: clientY });
  const tool = new AssetMoveTool(toolHost);
  const unbind = bindAssetMoveInput(tool, input);
  const follow = handles && view ? handleFollower(host, handles, view, tool) : null;
  if (follow) handles?.addFrameHook(follow);
  return {
    tool,
    overlay,
    dispose: () => {
      unbind();
      if (follow) handles?.removeFrameHook(follow);
      view?.dispose();
      tool.dispose();
      overlay.dispose();
    },
  };
}

/**
 * The per-frame hook that keeps the handles on the selected object: where it
 * is drawn (the drag's pose while one runs, else the document's), in the
 * mode on screen. The object's facts are read once per object and revision.
 */
function handleFollower(host: SessionHost, handles: HandlesHost, view: AssetHandlesView, tool: AssetMoveTool): () => void {
  const catalogue = dragCatalogue(
    (assetId) => host.bodyFacts(assetId),
    (placement) => (host.layoutCatalogue?.() ?? shippedFacts)(placement),
  );
  let cached: { key: string; context: DragContext } | null = null;
  return () => {
    const mode = handles.mode();
    const id = host.selected();
    const doc = host.document();
    if (!host.active() || mode === null || id === null || !doc) {
      view.show(null);
      return;
    }
    const key = `${id}|${doc.rev}`;
    if (cached?.key !== key) {
      const context = dragContext(doc.scene, doc.plan, id, catalogue);
      cached = context ? { key, context } : null;
    }
    if (!cached) {
      view.show(null);
      return;
    }
    const { context } = cached;
    const state = tool.state();
    const pose =
      state.assetId === id && state.pose
        ? state.pose
        : { position: context.placement.position, rotationY: context.placement.rotationY ?? 0 };
    const item = poseItem(context, pose);
    const target = {
      surface: context.facts.anchor,
      position: pose.position,
      hx: item.dims[0] / 2,
      hz: item.dims[2] / 2,
      rotationY: pose.rotationY,
      ceiling: doc.scene.ceilingHeight,
    };
    view.show(handleShape(target, mode, handles.screenUp()));
  };
}
