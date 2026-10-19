/**
 * The camera-preview card: while ONE tour checkpoint is active (the author
 * clicked its marker), the bottom-right corner shows what that camera sees —
 * INSTEAD of the mini-map, which hides for the time being.
 *
 * The picture is the live scene, not a snapshot: a post-render hook draws the
 * scene from a dedicated `PerspectiveCamera` into a SCISSORED corner of the
 * main canvas (`render-runtime.addPostRenderHook` — the inset render must
 * follow the main render, or the main render clears it), and the DOM card is
 * only the frame around the window that shows through. No second GL context,
 * no readback, no extra pass over the scene graph.
 *
 * Invariant: this module owns exactly one element, `[data-jeex="camera-preview"]`,
 * which it creates itself and appends to the viewer shell — the `minimap.ts`
 * pattern. Its whole state is machine-readable (`data-visible`), and it flips
 * `data-jeex-preview` on the shell root so the mini-map's own CSS steps aside
 * while the card is up.
 *
 * The scissor rectangle is read from the card's box EVERY FRAME it renders:
 * the card is CSS-positioned like the mini-map it replaces, and the GL rect is
 * the window's box converted into the drawing buffer's flipped coordinates —
 * never cached, because a resize, a locale or a zoom changes it without a
 * mode change.
 *
 * The card is a control, not only a picture (pitch is set here, not on
 * the 3D gizmo): a drag inside it turns the camera — horizontal travel
 * is yaw, vertical travel is pitch, `LOOK_RAD_PER_PX` each, the picture
 * following the pointer the way the walk look does — and commits ONE edit per
 * gesture; its «Look through» button hands the camera to the pilot. A
 * one-line caption «Drag to aim» says so until the first drag of the mount,
 * then fades; `data-taught` marks it.
 */

import * as THREE from 'three';
import { FAR_PLANE_M, NEAR_PLANE_M, fieldOfViewFor } from '../camera/camera-tuning.js';
import { AUTHORING_MODES, type CheckpointOverlay } from '../camera/checkpoint-overlay.js';
import { wrapAngle } from '../camera/checkpoint-picking.js';
import { listenerOptions } from '../shared/abort.js';
import type { Messages } from './messages.js';
import { TOUR_PITCH_LIMIT_RAD, type ViewerMode } from '../scene/types.js';

/** Turn per pixel of drag inside the card: 0.25°. */
export const LOOK_RAD_PER_PX = (0.25 / 180) * Math.PI;

/** The `data-jeex` name this module stamps on the card it creates. */
export const CAMERA_PREVIEW_NAME = 'camera-preview';

/** The attribute this module flips on the shell root while the card is up. */
export const PREVIEW_ACTIVE_ATTRIBUTE = 'data-jeex-preview';

/**
 * The modes the card shows in: the authoring modes of the overlay
 * (`AUTHORING_MODES`). `walk` and `tour` hide it with the markers, and the
 * active checkpoint survives, so leaving them brings it back.
 */
const PREVIEW_MODES = AUTHORING_MODES;

export type CameraPreviewDeps = {
  /** The viewer shell the card is appended to; also where the flag is stamped. */
  container: HTMLElement;
  /** The shell ROOT — the node the `data-jeex-preview` flag goes on. */
  root: HTMLElement;
  /** The scene that is drawn (the same graph the main camera renders). */
  scene: () => THREE.Scene;
  /** The renderer the inset is drawn with (the main one; same GL context). */
  renderer: () => THREE.WebGLRenderer | undefined;
  /** The overlay, asked once per frame for the active checkpoint's pose. */
  overlay: () => CheckpointOverlay | undefined;
  /** The mode on screen; `undefined` before the camera stack exists. */
  mode: () => ViewerMode | undefined;
  /** This instance's catalogue: the card's label and the button's text. */
  messages: Messages;
  /** The «Look through» button: pilots the camera (`handle.lookThroughCheckpoint`); absent hides the button. */
  onLookThrough?: ((id: string) => void) | undefined;
  /** The mounted viewer's lifetime; the card's listeners carry it. */
  signal?: AbortSignal | undefined;
};

/** One drag-to-look gesture inside the card. */
type Look = { pointerId: number; id: string; x: number; y: number; yaw: number; pitch: number; rev: number; moved: boolean };

export class CameraPreview {
  private readonly deps: CameraPreviewDeps;
  private readonly card: HTMLDivElement;
  private readonly window: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  /** «Drag to aim», faded once the author has dragged. */
  private readonly caption: HTMLSpanElement;
  private look: Look | null = null;
  /** The main render's viewport, read before the inset and put back after it. */
  private readonly savedViewport = new THREE.Vector4();
  private readonly camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(60, 16 / 9, NEAR_PLANE_M, FAR_PLANE_M);
  private visible = false;

  constructor(deps: CameraPreviewDeps) {
    this.deps = deps;
    this.card = deps.container.ownerDocument.createElement('div');
    this.card.dataset['jeex'] = CAMERA_PREVIEW_NAME;
    this.card.className = 'camera-preview';
    this.card.setAttribute('part', CAMERA_PREVIEW_NAME);
    this.card.dataset['visible'] = 'false';
    // A group, not an image: it holds a button and takes a drag.
    this.card.setAttribute('role', 'group');
    this.card.setAttribute('aria-label', deps.messages.t('cameraPreview.label'));
    // The visible label reads its own attribute and its own SHORT copy: the
    // ARIA name is a sentence for the screen reader, the strip over a 190 px
    // card has room for two words.
    this.card.dataset['label'] = deps.messages.t('cameraPreview.title');
    // The window is the transparent hole the scissored render shows through;
    // the card draws the frame and the label strip around it.
    this.window = deps.container.ownerDocument.createElement('div');
    this.window.className = 'camera-preview-window';
    this.card.appendChild(this.window);
    this.button = deps.container.ownerDocument.createElement('button');
    this.button.type = 'button';
    this.button.className = 'camera-preview-look';
    this.button.dataset['jeex'] = 'camera-preview-look';
    this.button.textContent = deps.messages.t('cameraPreview.lookThrough');
    this.button.hidden = deps.onLookThrough === undefined;
    this.card.appendChild(this.button);
    this.caption = deps.container.ownerDocument.createElement('span');
    this.caption.className = 'camera-preview-caption';
    this.caption.setAttribute('aria-hidden', 'true');
    this.caption.textContent = deps.messages.t('cameraPreview.dragToAim');
    this.card.appendChild(this.caption);
    deps.container.appendChild(this.card);
    const listen = listenerOptions(deps.signal);
    this.button.addEventListener('click', this.onLookThrough, listen);
    this.window.addEventListener('pointerdown', this.onPointerDown as EventListener, listen);
    this.window.addEventListener('pointermove', this.onPointerMove as EventListener, listen);
    this.window.addEventListener('pointerup', this.onPointerUp as EventListener, listen);
    this.window.addEventListener('pointercancel', this.onPointerCancel as EventListener, listen);
  }

  /** The card element, for tests and for the debug surface. */
  get element(): HTMLDivElement {
    return this.card;
  }

  /** Re-labels on `handle.setLocale`; nothing else here speaks. */
  retranslate(messages: Messages): void {
    this.card.setAttribute('aria-label', messages.t('cameraPreview.label'));
    this.card.dataset['label'] = messages.t('cameraPreview.title');
    this.button.textContent = messages.t('cameraPreview.lookThrough');
    this.caption.textContent = messages.t('cameraPreview.dragToAim');
  }

  private readonly onLookThrough = (): void => {
    const id = this.deps.overlay()?.activeCheckpoint()?.id;
    if (id !== undefined) this.deps.onLookThrough?.(id);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const overlay = this.deps.overlay();
    const checkpoint = overlay?.activeCheckpoint() ?? null;
    if (!overlay || !checkpoint || event.button !== 0 || !overlay.editable()) return;
    event.preventDefault();
    try {
      this.window.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser does not know (a synthetic one) cannot be captured; the drag still works inside the card.
    }
    this.look = {
      pointerId: event.pointerId,
      id: checkpoint.id,
      x: event.clientX,
      y: event.clientY,
      yaw: checkpoint.yaw,
      pitch: checkpoint.pitch,
      rev: overlay.rev(),
      moved: false,
    };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const look = this.look;
    const working = look && event.pointerId === look.pointerId ? this.deps.overlay()?.working(look.id) : undefined;
    if (!look || !working) return;
    look.moved = true;
    // Taught: the caption fades for the rest of this mount.
    this.card.dataset['taught'] = 'true';
    // The picture follows the pointer: drag right slides the scene right, which
    // is the camera turning LEFT (yaw grows); drag down tilts the view up.
    working.yaw = wrapAngle(look.yaw + (event.clientX - look.x) * LOOK_RAD_PER_PX);
    working.pitch = Math.max(
      -TOUR_PITCH_LIMIT_RAD,
      Math.min(TOUR_PITCH_LIMIT_RAD, look.pitch + (event.clientY - look.y) * LOOK_RAD_PER_PX),
    );
    this.deps.overlay()?.changed(look.id);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const look = this.look;
    if (!look || event.pointerId !== look.pointerId) return;
    this.look = null;
    this.release(event.pointerId);
    if (look.moved) this.deps.overlay()?.commit(`Camera ${look.id} re-aimed in the preview`, look.rev);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    const look = this.look;
    if (!look || event.pointerId !== look.pointerId) return;
    this.look = null;
    this.release(event.pointerId);
    // Only a look that moved made an edit to take back, as `onPointerUp` commits only one that moved.
    if (look.moved) this.deps.overlay()?.revert();
  };

  private release(pointerId: number): void {
    try {
      this.window.releasePointerCapture(pointerId);
    } catch {
      // The pointer is already gone; nothing is captured.
    }
  }

  dispose(): void {
    this.setVisible(false);
    this.card.remove();
  }

  /**
   * One frame, called from the post-render hook: syncs the card's visibility
   * with the active checkpoint and, when up, draws the inset. Everything it
   * reads is a comparison or a bounding box, so a hidden card costs nothing.
   */
  render(): void {
    const overlay = this.deps.overlay();
    const checkpoint = overlay?.activeCheckpoint() ?? null;
    const mode = this.deps.mode();
    const wants = checkpoint !== null && mode !== undefined && PREVIEW_MODES.has(mode);
    this.setVisible(wants);
    if (!wants || !checkpoint) return;
    // The tour's progress bar runs along the bottom edge; the card steps over
    // it the same way the mini-map does.
    if (this.card.dataset['mode'] !== mode) this.card.dataset['mode'] = mode!;
    this.aimAt(checkpoint.position, checkpoint.yaw, checkpoint.pitch);
    this.drawInset(checkpoint);
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.card.dataset['visible'] = String(visible);
    if (visible) this.deps.root.setAttribute(PREVIEW_ACTIVE_ATTRIBUTE, 'true');
    else this.deps.root.removeAttribute(PREVIEW_ACTIVE_ATTRIBUTE);
  }

  /** Points the preview camera from the checkpoint's pose; a look, not a target. */
  private aimAt(position: { x: number; y: number; z: number }, yaw: number, pitch: number): void {
    this.camera.position.set(position.x, position.y, position.z);
    const horizontal = Math.cos(pitch);
    this.camera.lookAt(position.x + Math.sin(yaw) * horizontal, position.y + Math.sin(pitch), position.z + Math.cos(yaw) * horizontal);
  }

  /** The scissored draw, in CSS pixels of the canvas, from the window's own box. */
  private drawInset(checkpoint: NonNullable<ReturnType<CheckpointOverlay['activeCheckpoint']>>): void {
    const renderer = this.deps.renderer();
    if (!renderer) return;
    const canvasRect = renderer.domElement.getBoundingClientRect();
    const box = this.window.getBoundingClientRect();
    const width = box.width;
    const height = box.height;
    if (width < 4 || height < 4 || canvasRect.width < 4 || canvasRect.height < 4) return;
    // GL origin is BOTTOM-left; the DOM's is top-left. The numbers stay in CSS
    // pixels: three's `setViewport`/`setScissor` multiply by the renderer's own
    // pixel ratio internally, and multiplying here too drew the preview twice
    // as large as its window on every scaled display.
    const x = box.left - canvasRect.left;
    const y = canvasRect.height - (box.bottom - canvasRect.top);

    // The platform's FOV policy, the same one the main camera recomputes every
    // frame: a fixed wide fov would make the preview see LESS than the tour
    // will, exactly where the author is judging the shot.
    this.camera.fov = fieldOfViewFor(width / height, checkpoint.position.y);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // The preview shows what the TOUR sees: no cameras, no tube, no handles.
    const hidden = this.deps.overlay()?.hideForPreview() ?? null;
    const previousAutoClear = renderer.autoClear;
    const previousViewport = renderer.getViewport(this.savedViewport);
    try {
      renderer.autoClear = true;
      renderer.setScissorTest(true);
      renderer.setScissor(x, y, width, height);
      renderer.setViewport(x, y, width, height);
      renderer.render(this.deps.scene(), this.camera);
    } finally {
      renderer.setScissorTest(false);
      renderer.setViewport(previousViewport);
      renderer.autoClear = previousAutoClear;
      hidden?.();
    }
  }
}
