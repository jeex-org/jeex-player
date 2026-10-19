/**
 * «Look through»: the author drives a tour camera
 * from inside it with the walk rig's own controls — drag to look, WASD or the
 * arrows to move — plus E/Q to raise and lower it, and keeps the result with
 * Enter or «Done» or drops it with Esc or «Cancel».
 *
 * The walk rig is reused as it is (`CameraDirector.enterWalkAt` spawns it at
 * the checkpoint's pose); what this module adds is the one thing the walk rig
 * does not do — a camera height other than the walker's eye. The walk rig
 * puts every step back at `EYE_HEIGHT_M`, so `update()` runs every frame
 * AFTER the controller and stands the camera back at the pilot's height.
 *
 * It owns no commit and no mode switch: `end()` answers the eye pose, and the
 * host command (`handle-commands.ts`) turns that into one edit and a return to
 * `orbit`. Esc CANCELS (`endLookThrough(false)`), Enter and «Done» keep.
 */

import * as THREE from 'three';
import { listenerOptions } from '../shared/abort.js';
import { clamp } from '../shared/math.js';
import { isTypingTarget } from './camera-input.js';
import { TOUR_CHECKPOINT_HEIGHT_MARGIN_M, TOUR_CHECKPOINT_HEIGHT_MIN_M } from '../scene/types.js';

/** Height change per E/Q press (and per key repeat), metres. */
const LIFT_STEP_M = 0.05;

export type PilotDeps = {
  camera: THREE.PerspectiveCamera;
  /** The viewer's key target; absent leaves only the host's commands and the bar. */
  keys?: HTMLElement | undefined;
  /** The pilot asked to end itself: Enter keeps (`true`), Esc cancels (`false`). */
  onKeyEnd: (commit: boolean) => void;
  signal?: AbortSignal | undefined;
};

/** What a finished look-through hands back: which camera, and where its eye ended up. */
export type PilotResult = {
  readonly id: string;
  readonly baseRev: number;
  readonly eye: { position: THREE.Vector3; target: THREE.Vector3 };
};

export class CheckpointPilot {
  private readonly deps: PilotDeps;
  private state: { id: string; height: number; ceiling: number; baseRev: number } | null = null;

  constructor(deps: PilotDeps) {
    this.deps = deps;
    deps.keys?.addEventListener('keydown', this.onKeyDown as EventListener, listenerOptions(deps.signal));
  }

  /** The camera being looked through, or `null`. */
  get id(): string | null {
    return this.state?.id ?? null;
  }

  /** The height the pilot holds, metres; `null` outside a look-through. */
  get height(): number | null {
    return this.state?.height ?? null;
  }

  begin(id: string, height: number, ceiling: number, baseRev: number): void {
    this.state = { id, height, ceiling, baseRev };
    this.update();
  }

  /** Raises (positive) or lowers the camera, clamped between the floor band and the ceiling. */
  lift(delta: number): void {
    if (!this.state) return;
    this.state.height = clamp(
      this.state.height + delta,
      TOUR_CHECKPOINT_HEIGHT_MIN_M,
      this.state.ceiling - TOUR_CHECKPOINT_HEIGHT_MARGIN_M,
    );
    this.update();
  }

  /** Every frame, after the controller: the camera stands at the pilot's height, whatever the walk rig did. */
  update(): void {
    if (this.state) this.deps.camera.position.y = this.state.height;
  }

  /**
   * Lets go of the keys and drops a running look-through. The mount signal
   * alone is not enough: a Retry rebuilds the stage on the SAME root, and a
   * pilot left listening mid look-through would go on swallowing E/Q/Enter/Esc
   * there (the reason `CheckpointGestures` unbinds on dispose too).
   */
  dispose(): void {
    this.deps.keys?.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.state = null;
  }

  /** Ends the look-through and answers the eye pose; `null` when none was running. */
  end(): PilotResult | null {
    const state = this.state;
    if (!state) return null;
    this.state = null;
    const camera = this.deps.camera;
    const position = camera.position.clone();
    position.y = state.height;
    const direction = camera.getWorldDirection(new THREE.Vector3());
    return { id: state.id, baseRev: state.baseRev, eye: { position, target: position.clone().add(direction) } };
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.state) return;
    if (isTypingTarget(typeof event.composedPath === 'function' ? event.composedPath() : [])) return;
    const key = event.key.toLowerCase();
    if (key === 'e') this.lift(LIFT_STEP_M);
    else if (key === 'q') this.lift(-LIFT_STEP_M);
    else if (key === 'enter') this.deps.onKeyEnd(true);
    else if (key === 'escape') this.deps.onKeyEnd(false);
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
}
