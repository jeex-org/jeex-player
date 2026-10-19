/**
 * The tour-camera tool's INPUT: pointer gestures on the canvas — select, move,
 * lift, turn, click-to-place — and the keyboard nudges on the viewer's key
 * target. The overlay (`checkpoint-overlay.ts`) owns the state and the
 * drawing and hands itself in as the `GestureHost`; this module owns only the
 * gesture state machine and the plane math. Rays are cast through the host's
 * `camera()` — the camera the MODE draws with, the plan's top view in
 * `plan3d` — and a gesture whose handle the mode no longer offers ends.
 *
 * Input order: the stage builds the overlay — and so these listeners — BEFORE
 * the camera input and the selection controller, so a claimed press answers
 * with `stopImmediatePropagation` and never orbits the scene or clears the
 * scene selection. A press within the grace radius of a handle is claimed even
 * when it misses the drawn shape; a click deselects only when it lands more
 * than `DESELECT_PX` from every handle of the active camera.
 *
 * Every gesture edits the host's WORKING copy and commits once, on release —
 * and only when the pose really changed (`GestureHost.commit` compares). The
 * release of a claimed press is stopped too, so the scene selection never
 * reports the room or the furniture under a camera.
 */

import * as THREE from 'three';
import { listenerOptions } from '../shared/abort.js';
import type { Draft } from '../shared/committed.js';
import { clamp } from '../shared/math.js';
import { isTypingTarget } from './camera-input.js';
import {
  DESELECT_PX,
  YawSweep,
  cursorFor,
  floorAngle,
  pitchFromDrag,
  type HandleKind,
  type Pick,
  type ScreenPoint,
} from './checkpoint-picking.js';
import { IdleCommit, applyNudge, nudgeFor, type Scheduler } from './checkpoint-keys.js';
import { DRAG_PX, aimRay, claimPointer, releasePointer } from '../edit/drag-kit.js';
import {
  TOUR_CHECKPOINT_HEIGHT_MARGIN_M,
  TOUR_CHECKPOINT_HEIGHT_MIN_M,
  TOUR_PITCH_LIMIT_RAD,
  type TourCheckpoint,
} from '../scene/types.js';
import type { ViewCamera } from './checkpoint-view.js';

/** What the gestures need of the overlay. */
export type GestureHost = {
  readonly canvas: HTMLCanvasElement;
  /** The camera a pointer ray is cast through: the one the mode draws with. */
  camera(): ViewCamera | undefined;
  /** Enabled AND in a select mode (`orbit`, `plan3d`). */
  editable(): boolean;
  /** The handles the mode on screen offers. */
  handles(): ReadonlySet<HandleKind>;
  rev(): number;
  ceiling(): number;
  activeId(): string | null;
  setActive(id: string | null): void;
  /** The working copy of one camera, mutable for the gesture. */
  working(id: string): Draft<TourCheckpoint> | undefined;
  /** A working pose changed: redraw its marker, the gizmo and (next frame) the tube. */
  changed(id: string): void;
  /** Emits the working list — unless it equals the committed one. */
  commit(summary: string, baseRev: number): void;
  /** Drops the working copy back to the committed list. */
  revert(): void;
  /** Removes one camera and commits. */
  remove(id: string): void;
  pick(pointer: ScreenPoint): Pick | null;
  nearestActive(pointer: ScreenPoint): number;
  hover(pick: Pick | null): void;
  /** Whether the tour can stand on a plan point. */
  canStand(point: { x: number; z: number }): boolean;
  /** A move gesture ended: stands the camera on navigable floor. */
  settle(id: string): void;
  /** Tints one camera as an invalid spot (a move over a wall), `null` clears. */
  setInvalid(id: string | null): void;
  placing(): boolean;
  /** Moves the placing ghost; `null` hides it. */
  ghost(point: { x: number; z: number } | null, aim: { x: number; z: number } | null, valid: boolean): void;
  /** Drops the new camera; ends the placing state. */
  drop(press: { x: number; z: number }, release: { x: number; z: number } | null): void;
  cancelPlacing(): void;
  /** The floor point under a canvas pixel: the navigable-floor pick, else the floor plane. */
  floorUnder(clientX: number, clientY: number): { x: number; z: number } | null;
  /** The author's horizontal view direction, for view-relative nudges. */
  viewYaw(): number;
};

/** A press shorter and smaller than this is a click, not a drag. */
const CLICK_PX = 5;
const CLICK_MS = 350;

type Gesture = {
  kind: HandleKind;
  id: string;
  pointerId: number;
  moved: boolean;
  /** The revision the GRAB started from — the baseRev contract, not a read at release. */
  startRev: number;
  startPointer: ScreenPoint;
  /** `move`: the horizontal plane at the camera's height, and the grab's offset from the camera. */
  plane: THREE.Plane;
  offset: THREE.Vector3;
  /** `height`: the height and the plane height at the grab — the drag is relative. */
  startHeight: number;
  startHit: number;
  /** `yaw`: the running relative sweep. */
  sweep: YawSweep | null;
  /** `pitch`: the pitch at the grab — the drag is relative, 0.25° per pixel. */
  startPitch: number;
};

/** The history label's verb per handle. */
const COMMIT_VERBS: Readonly<Record<HandleKind, string>> = { move: 'moved', height: 're-heighted', pitch: 'tilted', yaw: 're-aimed' };

const UP = new THREE.Vector3(0, 1, 0);
const FLOOR = new THREE.Plane(UP, 0);

export class CheckpointGestures {
  private readonly host: GestureHost;
  private gesture: Gesture | null = null;
  private missDown: { pointerId: number; x: number; y: number; at: number } | null = null;
  private placeDown: { pointerId: number; press: { x: number; z: number } } | null = null;
  private consumeClick = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly burst: IdleCommit;
  private burstRev = 0;
  private burstId: string | null = null;
  private unbind: (() => void) | null;

  constructor(
    host: GestureHost,
    options: { keys?: HTMLElement | undefined; signal?: AbortSignal | undefined; schedule?: Scheduler | undefined },
  ) {
    this.host = host;
    this.burst = new IdleCommit(() => this.host.commit(`Camera ${this.burstId ?? ''} nudged`, this.burstRev), options.schedule);
    const listen = listenerOptions(options.signal);
    const canvas = host.canvas;
    const pointer = {
      pointerdown: this.onPointerDown as EventListener,
      pointermove: this.onPointerMove as EventListener,
      pointerup: this.onPointerUp as EventListener,
      pointercancel: this.onPointerCancel as EventListener,
      click: this.onClick as EventListener,
    };
    for (const [type, handler] of Object.entries(pointer)) canvas.addEventListener(type, handler, listen);
    const keys = options.keys;
    keys?.addEventListener('keydown', this.onKeyDown as EventListener, listen);
    // Kept for `dispose()`: a Retry rebuilds the overlay on the SAME canvas,
    // and listeners riding the mount signal would survive it.
    this.unbind = () => {
      for (const [type, handler] of Object.entries(pointer)) canvas.removeEventListener(type, handler, listen);
      keys?.removeEventListener('keydown', this.onKeyDown as EventListener, listen);
    };
  }

  /** Whether a pointer gesture is in flight. */
  get active(): boolean {
    return this.gesture !== null;
  }

  /** Tears a gesture down WITHOUT reverting its edits — cleanup, not undo. */
  cancel(): void {
    if (this.gesture) {
      releasePointer(this.host.canvas, this.gesture.pointerId);
      this.host.setInvalid(null);
    }
    this.gesture = null;
    this.placeDown = null;
    this.missDown = null;
    this.consumeClick = false;
    this.host.canvas.style.cursor = '';
  }

  /** Commits a pending key burst now (a focus change, a new gesture). */
  flushKeys(): void {
    this.burst.flush();
  }

  dispose(): void {
    this.burst.drop();
    this.unbind?.();
    this.unbind = null;
    this.cancel();
  }

  // ------------------------------------------------------------- pointer --

  private local(event: PointerEvent): ScreenPoint {
    const rect = this.host.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private claim(event: PointerEvent): void {
    this.consumeClick = true;
    claimPointer(this.host.canvas, event);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.host.editable() || event.button !== 0) return;
    this.burst.flush();
    if (this.host.placing()) {
      this.claim(event);
      const press = this.host.floorUnder(event.clientX, event.clientY);
      this.placeDown = press ? { pointerId: event.pointerId, press } : null;
      return;
    }
    const hit = this.host.pick(this.local(event));
    if (!hit) {
      // Not ours: remember it so a CLICK (not a drag) can clear the focus, but
      // let the orbit rig and the selection controller have the gesture.
      this.missDown = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
      return;
    }
    this.claim(event);
    if (hit.id !== this.host.activeId()) this.host.setActive(hit.id);
    const checkpoint = this.host.working(hit.id);
    const camera = this.host.camera();
    if (!checkpoint || !camera) return;
    this.aim(event, camera);
    const at = new THREE.Vector3(checkpoint.position.x, checkpoint.position.y, checkpoint.position.z);
    const plane = new THREE.Plane();
    const offset = new THREE.Vector3();
    let startHit = 0;
    let sweep: YawSweep | null = null;
    if (hit.kind === 'move') {
      plane.setFromNormalAndCoplanarPoint(UP, at);
      const point = this.raycaster.ray.intersectPlane(plane, this.scratch);
      if (point) offset.copy(point).sub(at);
    } else if (hit.kind === 'pitch') {
      // Screen space: nothing to intersect, the pointer's vertical travel is the input.
    } else if (hit.kind === 'height') {
      // A vertical plane through the camera, facing the author: the drag reads
      // the pointer's height off it, RELATIVE to the grab (the arrow stands
      // above the body, so an absolute read would jump).
      const normal = new THREE.Vector3(camera.position.x - at.x, 0, camera.position.z - at.z);
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
      plane.setFromNormalAndCoplanarPoint(normal.normalize(), at);
      startHit = this.raycaster.ray.intersectPlane(plane, this.scratch)?.y ?? at.y;
    } else {
      const point = this.raycaster.ray.intersectPlane(FLOOR, this.scratch);
      sweep = new YawSweep(checkpoint.yaw, point ? floorAngle(checkpoint.position, point) : checkpoint.yaw);
    }
    this.gesture = {
      kind: hit.kind,
      id: hit.id,
      pointerId: event.pointerId,
      moved: false,
      startRev: this.host.rev(),
      startPointer: { x: event.clientX, y: event.clientY },
      plane,
      offset,
      startHeight: checkpoint.position.y,
      startHit,
      sweep,
      startPitch: checkpoint.pitch,
    };
    this.host.canvas.style.cursor = hit.kind === 'move' ? 'grabbing' : cursorFor(hit.kind);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture) {
      if (event.pointerId !== gesture.pointerId) return;
      if (!gesture.moved && Math.hypot(event.clientX - gesture.startPointer.x, event.clientY - gesture.startPointer.y) < DRAG_PX) return;
      gesture.moved = true;
      this.apply(gesture, event);
      return;
    }
    if (!this.host.editable()) return;
    if (this.host.placing()) {
      const press = this.placeDown?.press ?? null;
      const point = this.host.floorUnder(event.clientX, event.clientY);
      if (press) this.host.ghost(press, point, this.host.canStand(press));
      else this.host.ghost(point, null, point !== null && this.host.canStand(point));
      this.host.canvas.style.cursor = 'crosshair';
      return;
    }
    // Hover affordance: the handle under the pointer brightens, the cursor names the action.
    const hit = this.host.pick(this.local(event));
    this.host.hover(hit);
    this.host.canvas.style.cursor = cursorFor(hit?.kind ?? null);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.placeDown && event.pointerId === this.placeDown.pointerId) {
      const { press } = this.placeDown;
      this.placeDown = null;
      event.stopImmediatePropagation();
      this.release(event.pointerId);
      this.host.drop(press, this.host.floorUnder(event.clientX, event.clientY));
      return;
    }
    const gesture = this.gesture;
    if (gesture && event.pointerId === gesture.pointerId) {
      this.gesture = null;
      this.release(event.pointerId);
      // The release belongs to the tool too: the scene selection must not report what lies under the camera.
      event.stopImmediatePropagation();
      if (!gesture.moved) return;
      if (gesture.kind === 'move') this.host.settle(gesture.id);
      this.host.setInvalid(null);
      this.host.commit(`Camera ${gesture.id} ${COMMIT_VERBS[gesture.kind]}`, gesture.startRev);
      return;
    }
    // A click that missed every handle clears the focus — but only a click,
    // only from the SAME pointer, and only well clear of the active handles.
    const miss = this.missDown;
    this.missDown = null;
    if (!miss || miss.pointerId !== event.pointerId || !this.host.editable()) return;
    if (Math.hypot(event.clientX - miss.x, event.clientY - miss.y) >= CLICK_PX || event.timeStamp - miss.at >= CLICK_MS) return;
    if (this.host.activeId() === null) return;
    if (this.host.nearestActive(this.local(event)) <= DESELECT_PX) return;
    this.host.setActive(null);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.placeDown?.pointerId === event.pointerId) {
      this.cancel();
      return;
    }
    if (this.gesture?.pointerId !== event.pointerId) return;
    // A cancelled drag reverts; the browser fires no `click` after a cancel.
    this.cancel();
    this.host.revert();
  };

  private readonly onClick = (event: MouseEvent): void => {
    // The click that follows a claimed gesture belongs to the tool, not to
    // whatever door or panel is behind the camera.
    if (!this.consumeClick) return;
    this.consumeClick = false;
    event.stopImmediatePropagation();
  };

  private release(pointerId: number): void {
    this.host.canvas.style.cursor = '';
    releasePointer(this.host.canvas, pointerId);
  }

  private aim(event: PointerEvent, camera: ViewCamera): void {
    aimRay(this.raycaster, this.ndc, this.host.canvas, event.clientX, event.clientY, camera);
  }

  /** Applies one pointer position to the gesture in flight. */
  private apply(gesture: Gesture, event: PointerEvent): void {
    const checkpoint = this.host.working(gesture.id);
    const camera = this.host.camera();
    // The mode left under the drag's feet (a scripted tour engaged itself, or
    // a switch to a mode without this handle).
    if (!this.host.editable() || !this.host.handles().has(gesture.kind) || !checkpoint || !camera) {
      this.cancel();
      return;
    }
    this.aim(event, camera);
    if (gesture.kind === 'move') {
      const hit = this.raycaster.ray.intersectPlane(gesture.plane, this.scratch);
      if (!hit) return;
      checkpoint.position = { x: hit.x - gesture.offset.x, y: checkpoint.position.y, z: hit.z - gesture.offset.z };
      this.host.setInvalid(this.host.canStand(checkpoint.position) ? null : gesture.id);
    } else if (gesture.kind === 'pitch') {
      checkpoint.pitch = pitchFromDrag(gesture.startPitch, event.clientY - gesture.startPointer.y, event.shiftKey, TOUR_PITCH_LIMIT_RAD);
    } else if (gesture.kind === 'height') {
      const hit = this.raycaster.ray.intersectPlane(gesture.plane, this.scratch);
      if (!hit) return;
      checkpoint.position = {
        x: checkpoint.position.x,
        y: clamp(
          gesture.startHeight + (hit.y - gesture.startHit),
          TOUR_CHECKPOINT_HEIGHT_MIN_M,
          this.host.ceiling() - TOUR_CHECKPOINT_HEIGHT_MARGIN_M,
        ),
        z: checkpoint.position.z,
      };
    } else {
      const hit = this.raycaster.ray.intersectPlane(FLOOR, this.scratch);
      if (!hit || !gesture.sweep) return;
      checkpoint.yaw = gesture.sweep.update(floorAngle(checkpoint.position, hit), event.shiftKey);
    }
    this.host.changed(gesture.id);
  }

  // ---------------------------------------------------------------- keys --

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.host.editable() || this.gesture) return;
    if (isTypingTarget(typeof event.composedPath === 'function' ? event.composedPath() : [])) return;
    const nudge = nudgeFor(event.key, event.shiftKey);
    if (!nudge) return;
    if (nudge.kind === 'deselect') {
      if (!this.host.placing() && this.host.activeId() === null) return;
      this.burst.flush();
      if (this.host.placing()) this.host.cancelPlacing();
      else this.host.setActive(null);
      this.claimKey(event);
      return;
    }
    const id = this.host.activeId();
    const checkpoint = id === null ? undefined : this.host.working(id);
    if (id === null || !checkpoint) return;
    this.claimKey(event);
    if (nudge.kind === 'delete') {
      this.burst.drop();
      this.host.remove(id);
      return;
    }
    if (!this.burst.pending || this.burstId !== id) {
      this.burst.flush();
      this.burstId = id;
      this.burstRev = this.host.rev();
    }
    const next = applyNudge(checkpoint, nudge, this.host.viewYaw(), this.host.ceiling());
    checkpoint.position = { ...next.position };
    checkpoint.yaw = next.yaw;
    checkpoint.pitch = next.pitch;
    this.host.changed(id);
    this.burst.touch();
  };

  private claimKey(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
