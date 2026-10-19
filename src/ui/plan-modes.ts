/**
 * The two display-only view modes: `plan2d`, the flat architectural drawing,
 * and `plan3d`, the real scene from straight above.
 *
 * Invariant: this module owns exactly one element, the
 * `[data-jeex="plan-canvas"]` overlay, which it creates itself and appends to
 * the viewer shell — no id is read or written here (the `door-hud.ts` pattern). Its whole state is
 * machine-readable (`data-visible`, `data-view`), because that is what a
 * browser check may assert on. It is `data-view` and NOT `data-mode`: the
 * control bar's mode buttons are found with `[data-mode]`, and an overlay
 * answering that selector would be wired up as a sixth button.
 *
 * `plan2d` paints `plan-drawing.ts` over the viewport and switches the render
 * loop off (`RenderRuntime.setRenderEnabled(false)`): the overlay is opaque,
 * so there is nothing to draw behind it. Room labels, facade dimension chains
 * and the presentation camera's own marker (`deps.options`, `PlanModeOptions`,
 * default all on) are the same drawing's opt-in primitives, painted the same
 * way. `plan3d` installs an orthographic camera looking straight down with
 * north up, fitted to the plan bounds with the same 6 % padding as the
 * drawing, and hands it to the runtime; leaving either mode puts the
 * perspective camera back and starts drawing again.
 *
 * The rig itself is frozen by `CameraController` while a plan mode is on, so
 * the orbit pose survives the round trip untouched.
 */

import * as THREE from 'three';
import { buildPlanDrawing, fitTransform, type PlanBounds, type PlanDrawing } from '../plan/plan-drawing.js';
import { planDrawingInputs } from '../assets/plan-fixtures.js';
import { PLAN_PADDING, fitCanvasToBox, paintPlan, type PlanCameraMarker } from '../plan/plan-canvas.js';
import { cameraMarker } from '../render/viewport-projection.js';
import { planViewPose } from '../camera/plan-view-pose.js';
import type { TourPose } from '../camera/tour-player.js';
import type { RenderRuntime } from '../render/render-runtime.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData, ViewerMode } from '../scene/types.js';

/**
 * The `data-jeex` name this module stamps on the canvas it creates. Owned
 * here; `viewer-shell.ts` imports it to compose
 * `OVERLAY_NAMES`.
 */
export const PLAN_CANVAS_NAME = 'plan-canvas';

/** Which of the plan's labels, dimension chains and camera marker `plan2d` draws (`app/viewer-options.ts`'s `plan.*`). */
export type PlanModeOptions = { labels: boolean; dimensions: boolean; camera: boolean };

/** All three on, matching `DEFAULT_VIEWER_OPTIONS.plan` — the drawing gains nothing when a caller never wires `deps.options`. */
const DEFAULT_PLAN_MODE_OPTIONS: PlanModeOptions = { labels: true, dimensions: true, camera: true };

export type PlanModesDeps = {
  /** The viewer shell the overlay is appended to (`#viewer`). */
  container: HTMLElement;
  /** The box the overlay and the top-view frustum are measured against. */
  viewport: { clientWidth: number; clientHeight: number };
  runtime: RenderRuntime;
  /** The perspective camera the viewer returns to; absent before it exists. */
  perspective: () => THREE.PerspectiveCamera | undefined;
  /** Read fresh on every paint; absent means every one of `PlanModeOptions` is on. */
  options?: (() => PlanModeOptions) | undefined;
  /**
   * Coalesces a resize burst into the next frame (`render-runtime.ts`'s
   * `onObserve` pattern); injectable so a unit test can drive the queue by
   * hand. Defaults to `requestAnimationFrame`. Injected together with
   * `cancelFrame` — the handle it returns is only meaningful to that cancel,
   * and supplying one without the other mixes handle spaces.
   */
  scheduleFrame?: ((callback: () => void) => number) | undefined;
  /** Cancels a handle `scheduleFrame` returned. Defaults to `cancelAnimationFrame`. */
  cancelFrame?: ((handle: number) => void) | undefined;
};

/** Height the top-view camera sits at, metres above the floor plane. */
const TOP_VIEW_HEIGHT_M = 40;
/** Depth of the top-view frustum below the camera, metres. */
const TOP_VIEW_DEPTH_M = 60;
/**
 * Scratch vector for `PlanModes.marker`'s forward-direction read: one allocation for the life of the module rather than one per
 * paint, non-reentrant like every other scratch vector in the codebase.
 */
const FORWARD_SCRATCH = new THREE.Vector3();

export class PlanModes {
  private readonly deps: PlanModesDeps;
  private readonly canvas: HTMLCanvasElement;
  private readonly top = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, TOP_VIEW_DEPTH_M);
  /**
   * Coalesces a burst of RO notifications into ONE fit on the next frame:
   * resizing
   * the canvas SYNCHRONOUSLY inside a `ResizeObserver` callback is exactly
   * what raises the browser's "ResizeObserver loop completed with undelivered
   * notifications" warning (`render-runtime.ts`'s `onObserve` carries the same
   * comment for the same reason). The handler below only records that a
   * resize happened and schedules; the actual fit runs in `handleResize`,
   * off the observer's call stack.
   */
  private readonly onResize = (): void => {
    if (this.resizeHandle !== null) return;
    this.resizeHandle = this.schedule(() => {
      this.resizeHandle = null;
      this.handleResize();
    });
  };
  private readonly schedule: (callback: () => void) => number;
  private readonly cancel: (handle: number) => void;
  private resizeHandle: number | null = null;
  /** Watches the viewport box; the overlay follows its CONTAINER, not the window. */
  private readonly observer: ResizeObserver | null;
  private drawing: PlanDrawing | null = null;
  private bounds: PlanBounds | null = null;
  private mode: ViewerMode = 'orbit';

  constructor(deps: PlanModesDeps) {
    this.deps = deps;
    this.schedule = deps.scheduleFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancel = deps.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
    this.canvas = deps.container.ownerDocument.createElement('canvas');
    this.canvas.dataset['jeex'] = PLAN_CANVAS_NAME;
    this.canvas.className = 'plan-canvas';
    this.canvas.dataset['visible'] = 'false';
    this.canvas.dataset['view'] = 'orbit';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.top.up.set(0, 0, -1);
    deps.container.appendChild(this.canvas);
    // The drawing is fitted to the VIEWPORT, so it has to be refitted when the
    // viewport changes — which an embedded viewer does without the window
    // resizing at all (`render-runtime.ts` watches the same box).
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.onResize);
    this.observer?.observe(deps.container);
  }

  /** The overlay element, for tests and for the debug surface. */
  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  /** The drawing of the current document; `null` before the first one. */
  get planDrawing(): PlanDrawing | null {
    return this.drawing;
  }

  /**
   * Adopts a newly committed document. Every plan-level rebuild lands here, so
   * a wall or an opening that moved is on the drawing from the next frame.
   */
  setDocument(plan: SolvedPlan, scene: SceneData): void {
    const options = this.planOptions();
    this.drawing = buildPlanDrawing(plan, scene, { ...planDrawingInputs(scene), labels: options.labels, dimensions: options.dimensions });
    this.bounds = this.drawing.bounds;
    if (this.mode === 'plan2d') this.paint();
    if (this.mode === 'plan3d') this.fitTopView();
  }

  /**
   * Applies a mode. Idempotent, and safe to call for the three camera modes:
   * they simply leave whatever a plan mode had installed.
   */
  setMode(mode: ViewerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.canvas.dataset['view'] = mode;
    this.canvas.dataset['visible'] = String(mode === 'plan2d');
    this.deps.runtime.setRenderEnabled(mode !== 'plan2d');
    if (mode === 'plan2d') {
      this.paint();
      return;
    }
    if (mode === 'plan3d') {
      this.fitTopView();
      this.deps.runtime.setCamera(this.top);
      return;
    }
    const perspective = this.deps.perspective();
    if (perspective) this.deps.runtime.setCamera(perspective);
  }

  /** The camera the runtime draws with in this mode. */
  activeCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined {
    return this.mode === 'plan3d' ? this.top : this.deps.perspective();
  }

  /**
   * The camera a PICK is cast with in this mode.
   *
   * `plan2d` paints an opaque 2D overlay and switches the renderer off, so
   * `activeCamera()` there answers the FROZEN perspective rig — the right
   * answer for "what was drawn", the wrong one for "what is under the
   * pointer". The top view is fitted to the same bounds with the same
   * `PLAN_PADDING` as `fitTransform` gives the drawing, so a ray cast through
   * it lands where the drawing shows it. Fitted on demand: `fitTopView` is
   * cheap, allocates nothing and is idempotent, which is cheaper than keeping
   * a second fit in step from three call sites.
   */
  pickCamera(): THREE.Camera | undefined {
    if (this.mode !== 'plan2d' && this.mode !== 'plan3d') return this.deps.perspective();
    this.fitTopView();
    return this.top;
  }

  /**
   * The perspective pose that shows what this plan mode shows — the top view
   * and the drawing are fitted to the same bounds with the same padding — or
   * `null` outside a plan mode (or before a document and a camera exist). A
   * walk or tour entry glides from it (`CameraDirector`).
   * Refits the top view on demand, like `pickCamera`: cheap, allocation-free
   * and idempotent, so the answer follows a resize or a new document.
   */
  viewPose(): TourPose | null {
    if (this.mode !== 'plan2d' && this.mode !== 'plan3d') return null;
    const perspective = this.deps.perspective();
    if (!perspective || !this.bounds) return null;
    this.fitTopView();
    return planViewPose(this.top, perspective.aspect);
  }

  /** The orthographic top-view camera, whether or not it is installed. */
  get topCamera(): THREE.OrthographicCamera {
    return this.top;
  }

  dispose(): void {
    this.observer?.disconnect();
    if (this.resizeHandle !== null) this.cancel(this.resizeHandle);
    this.resizeHandle = null;
    this.canvas.remove();
  }

  private handleResize(): void {
    if (this.mode === 'plan2d') this.paint();
    if (this.mode === 'plan3d') this.fitTopView();
  }

  /** Repaints the whole overlay: fit to the viewport with 6 % padding. */
  private paint(): void {
    const drawing = this.drawing;
    if (!drawing) return;
    const fitted = fitCanvasToBox(this.canvas, this.deps.viewport);
    if (!fitted) return;
    const options = this.planOptions();
    paintPlan(fitted.ctx, drawing, fitTransform(drawing.bounds, { w: fitted.w, h: fitted.h }, PLAN_PADDING), 'drawing', {
      camera: options.camera ? this.marker() : null,
    });
  }

  /** `deps.options`, or every option on when the caller never wired one. */
  private planOptions(): PlanModeOptions {
    return this.deps.options?.() ?? DEFAULT_PLAN_MODE_OPTIONS;
  }

  /**
   * Where the presentation camera stands and looks, as `plan2d`'s own camera
   * marker — read directly off `deps.perspective()` rather than a camera-stack
   * pose, because that is all this module is handed. The forward direction the
   * camera already looks (`getWorldDirection`) stands in for a `target`:
   * `cameraMarker` only needs the direction between the two, not the distance.
   */
  private marker(): PlanCameraMarker | null {
    const camera = this.deps.perspective();
    if (!camera) return null;
    const forward = camera.getWorldDirection(FORWARD_SCRATCH);
    return cameraMarker(camera, {
      position: { x: camera.position.x, z: camera.position.z },
      target: { x: camera.position.x + forward.x, z: camera.position.z + forward.z },
    });
  }

  /**
   * Frustum of the top view: the plan bounds plus 6 % all round, widened to
   * the viewport aspect so the padding is never eaten on the long axis.
   */
  private fitTopView(): void {
    const bounds = this.bounds;
    if (!bounds) return;
    const width = Math.max(1, this.deps.viewport.clientWidth);
    const height = Math.max(1, this.deps.viewport.clientHeight);
    const aspect = width / height;
    const grow = 1 / (1 - 2 * PLAN_PADDING);
    let halfX = (Math.max(0.5, bounds.max.x - bounds.min.x) / 2) * grow;
    let halfZ = (Math.max(0.5, bounds.max.z - bounds.min.z) / 2) * grow;
    if (halfX / halfZ < aspect) halfX = halfZ * aspect;
    else halfZ = halfX / aspect;

    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cz = (bounds.min.z + bounds.max.z) / 2;
    this.top.left = -halfX;
    this.top.right = halfX;
    // `up` is -Z, so screen up is -Z (north) and the vertical half extent is
    // measured in Z.
    this.top.top = halfZ;
    this.top.bottom = -halfZ;
    this.top.near = 0.1;
    this.top.far = TOP_VIEW_HEIGHT_M + TOP_VIEW_DEPTH_M;
    this.top.position.set(cx, TOP_VIEW_HEIGHT_M, cz);
    this.top.up.set(0, 0, -1);
    this.top.lookAt(cx, 0, cz);
    this.top.updateProjectionMatrix();
    this.top.updateMatrixWorld();
  }
}
