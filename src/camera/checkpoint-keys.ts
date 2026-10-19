/**
 * Keyboard nudges for the active tour camera: arrows move 0.1 m relative to
 * the VIEW (Shift 0.5 m),
 * Q/E turn 5°, R/F tilt 5°, Page Up/Down raise and lower 0.1 m, Delete
 * removes, Esc deselects. A burst of presses commits ONCE, after a short idle
 * (`IdleCommit`), so holding an arrow is one history entry, not thirty.
 *
 * Pure key map and pose arithmetic plus a tiny timer wrapper; the overlay owns
 * the listener and the focus rule (only with an active camera, only when the
 * key reached the viewer's own key target and not a text field).
 */

import { clamp } from '../shared/math.js';
import { wrapAngle } from '../edit/drag-kit.js';

// The burst timer lives in the editor's shared kit.
export { BURST_IDLE_MS, IdleCommit, type Scheduler } from '../edit/drag-kit.js';
import {
  TOUR_CHECKPOINT_HEIGHT_MARGIN_M,
  TOUR_CHECKPOINT_HEIGHT_MIN_M,
  TOUR_PITCH_LIMIT_RAD,
  type TourCheckpoint,
} from '../scene/types.js';

const STEP_M = 0.1;
const SHIFT_STEP_M = 0.5;
const TURN_RAD = (5 / 180) * Math.PI;
const LIFT_M = 0.1;

/** What one key press asks of the active camera. */
export type Nudge =
  | {
      readonly kind: 'pose';
      readonly forward: number;
      readonly right: number;
      readonly lift: number;
      readonly turn: number;
      readonly tilt: number;
    }
  | { readonly kind: 'delete' }
  | { readonly kind: 'deselect' };

const pose = (fields: Partial<{ forward: number; right: number; lift: number; turn: number; tilt: number }>): Nudge => ({
  kind: 'pose',
  forward: 0,
  right: 0,
  lift: 0,
  turn: 0,
  tilt: 0,
  ...fields,
});

/** The nudge for `key` (`KeyboardEvent.key`, any case), or `null` for a key the tool does not use. */
export function nudgeFor(key: string, shift: boolean): Nudge | null {
  const step = shift ? SHIFT_STEP_M : STEP_M;
  switch (key.toLowerCase()) {
    case 'arrowup':
      return pose({ forward: step });
    case 'arrowdown':
      return pose({ forward: -step });
    case 'arrowleft':
      return pose({ right: -step });
    case 'arrowright':
      return pose({ right: step });
    case 'q':
      return pose({ turn: TURN_RAD });
    case 'e':
      return pose({ turn: -TURN_RAD });
    case 'r':
      return pose({ tilt: TURN_RAD });
    case 'f':
      return pose({ tilt: -TURN_RAD });
    case 'pageup':
      return pose({ lift: LIFT_M });
    case 'pagedown':
      return pose({ lift: -LIFT_M });
    case 'delete':
    case 'backspace':
      return { kind: 'delete' };
    case 'escape':
      return { kind: 'deselect' };
    default:
      return null;
  }
}

/**
 * `checkpoint` after a pose nudge. `viewYaw` is the AUTHOR's horizontal view
 * direction (the orbit camera's), so «up» moves away from the author and
 * «right» moves right on screen, whichever way the camera itself faces. Q
 * turns left (yaw grows toward +X, which is the camera's left).
 */
export function applyNudge(
  checkpoint: TourCheckpoint,
  nudge: Extract<Nudge, { kind: 'pose' }>,
  viewYaw: number,
  ceilingHeight: number,
): TourCheckpoint {
  const forward = { x: Math.sin(viewYaw), z: Math.cos(viewYaw) };
  const right = { x: -forward.z, z: forward.x };
  return {
    ...checkpoint,
    position: {
      x: checkpoint.position.x + forward.x * nudge.forward + right.x * nudge.right,
      y: clamp(checkpoint.position.y + nudge.lift, TOUR_CHECKPOINT_HEIGHT_MIN_M, ceilingHeight - TOUR_CHECKPOINT_HEIGHT_MARGIN_M),
      z: checkpoint.position.z + forward.z * nudge.forward + right.z * nudge.right,
    },
    yaw: wrapAngle(checkpoint.yaw + nudge.turn),
    pitch: clamp(checkpoint.pitch + nudge.tilt, -TOUR_PITCH_LIMIT_RAD, TOUR_PITCH_LIMIT_RAD),
  };
}
