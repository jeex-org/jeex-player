/**
 * The pieces every direct-manipulation tool of the editor shares, lifted out
 * of the tour-camera tool so the asset move tool does not grow a second copy:
 * a pointer ray through the camera the mode draws with, claiming and releasing a press, the relative yaw sweep,
 * the idle commit of a key burst, and the «no empty commit» tolerances.
 *
 * The `edit` layer sits between `render` and `camera` (`.dependency-cruiser.cjs`):
 * the camera tool imports this kit, and the tools in this layer get their
 * cameras, picks and plan modes INJECTED, never imported.
 */

import type * as THREE from 'three';
import { wrapAngle } from '../shared/math.js';

/* ----------------------------------------------------------- gestures --- */

/** Pointer travel before a claimed press becomes a drag, px. */
export const DRAG_PX = 4;

/** The ray through a canvas pixel and `camera`, written into `raycaster`. */
export function aimRay(
  raycaster: THREE.Raycaster,
  ndc: THREE.Vector2,
  canvas: HTMLElement,
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
): void {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

/**
 * Takes a press for a tool: no listener after this one hears it (the orbit
 * rig, the scene selection), and the pointer stays with the canvas while it
 * drags.
 */
export function claimPointer(canvas: HTMLElement, event: PointerEvent): void {
  event.stopImmediatePropagation();
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // A pointer the browser does not track (a synthetic one) cannot be captured; the gesture works without it.
  }
}

/** Gives a claimed pointer back. */
export function releasePointer(canvas: HTMLElement, pointerId: number): void {
  try {
    canvas.releasePointerCapture(pointerId);
  } catch {
    // A pointer the drag outlived (a released button elsewhere) — nothing to release.
  }
}

/* -------------------------------------------------------------- angles --- */

/** Folds an angle into `(-PI, PI]` (lives in `shared/math.ts`, where the pure `layout` layer can reach it too). */
export { wrapAngle };

/** Rounds `angle` to the nearest multiple of `step` radians. */
export function snapAngle(angle: number, step: number): number {
  return Math.round(angle / step) * step;
}

/** Shift-drag and keyboard snap on a yaw ring: 15°. */
export const YAW_SNAP_RAD = (15 / 180) * Math.PI;

/**
 * The RELATIVE yaw drag: the object turns by the angle the pointer swept
 * around its floor point since the grab — never to face the pointer (the
 * absolute mapping swung a camera up to 180° on the first move). `swept` is
 * the unwrapped running sweep, so a drag that goes round more than half a
 * turn keeps turning instead of flipping back.
 */
export class YawSweep {
  private readonly startYaw: number;
  private last: number;
  private swept = 0;

  constructor(startYaw: number, startAngle: number) {
    this.startYaw = startYaw;
    this.last = startAngle;
  }

  /** Adopts the pointer's current angle around the object and answers the new yaw. */
  update(angle: number, snap: boolean): number {
    this.swept += wrapAngle(angle - this.last);
    this.last = angle;
    const yaw = this.startYaw + this.swept;
    return wrapAngle(snap ? snapAngle(yaw, YAW_SNAP_RAD) : yaw);
  }
}

/** The angle of `point` around `centre` on the floor, in the yaw convention (0 = +Z, positive toward +X). */
export function floorAngle(centre: { x: number; z: number }, point: { x: number; z: number }): number {
  return Math.atan2(point.x - centre.x, point.z - centre.z);
}

/* --------------------------------------------------------- comparisons --- */

/** Position tolerance under which a gesture is «no change», metres (1 mm). */
export const SAME_POSITION_M = 0.001;
/** Angle tolerance under which a gesture is «no change», radians (0.1°). */
export const SAME_ANGLE_RAD = (0.1 / 180) * Math.PI;

/** Whether two positions are the same within 1 mm on every axis. */
export function samePosition(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return Math.abs(a.x - b.x) < SAME_POSITION_M && Math.abs(a.y - b.y) < SAME_POSITION_M && Math.abs(a.z - b.z) < SAME_POSITION_M;
}

/** Whether two angles are the same within 0.1°, whole turns aside. */
export function sameAngle(a: number, b: number): boolean {
  return Math.abs(wrapAngle(a - b)) < SAME_ANGLE_RAD;
}

/* ---------------------------------------------------------- key bursts --- */

/** How long after the last press a burst commits, ms. */
export const BURST_IDLE_MS = 450;

/** A timer the tests can drive: `schedule` answers the cancel. */
export type Scheduler = (run: () => void, ms: number) => () => void;

export const realScheduler: Scheduler = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

/** Runs `commit` once, `BURST_IDLE_MS` after the LAST `touch`; `flush` runs it now. */
export class IdleCommit {
  private cancel: (() => void) | null = null;
  private readonly schedule: Scheduler;
  private readonly commit: () => void;

  constructor(commit: () => void, schedule: Scheduler = realScheduler) {
    this.commit = commit;
    this.schedule = schedule;
  }

  get pending(): boolean {
    return this.cancel !== null;
  }

  touch(): void {
    this.cancel?.();
    this.cancel = this.schedule(() => this.flush(), BURST_IDLE_MS);
  }

  /** Commits a pending burst immediately (a gesture or a focus change must not interleave with it). */
  flush(): void {
    if (!this.cancel) return;
    this.cancel();
    this.cancel = null;
    this.commit();
  }

  /** Forgets a pending burst without committing it. */
  drop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}
