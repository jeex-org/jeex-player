/**
 * The doors between the walker and where they are going.
 *
 * Doors are the one piece of VIEW state that reaches navigation, and it
 * arrives as two sets: `closedDoors()` is where the leaves physically are — a
 * step across one is refused this frame — and `lockedDoors()` is which of them
 * are going to STAY shut. A tap is refused (with `hint.doorClosed`) only for a
 * locked door; a door that opens as the walker arrives merely makes them wait
 * at the leaf for the half-second the swing takes.
 *
 * A latched door is escapable by INTENT, because the release radius
 * (`DOOR_AUTO_CLOSE_M`) is a pose a small room may not contain: a tap beyond
 * the leaf, or `walk.doorPushS` of pushing at it, re-arms the latch and the
 * door opens as the walker arrives. `rearm` is how that insistence is passed
 * on, and its `false` — an unknown door, or a viewer with `doors.autoOpen` off
 * where a shut door really is a wall — is what turns the refusal into words.
 *
 * Nothing here keeps door state of its own: `door-state.ts` owns it and this
 * only asks. The manual walker and the scripted route (`travel-rig.ts`) share
 * one of these, because they have to agree about a leaf they are both facing.
 */

import { CAMERA_TUNING } from './camera-tuning.js';
import { crossesClosedDoor } from '../navigation/navigation.js';
import type { MessageKey } from '../shared/messages.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { Vec3 } from '../scene/types.js';

const { walk: WALK } = CAMERA_TUNING;

/** Shared empty answer for a viewer that tracks no door state. */
const EMPTY_DOORS: ReadonlySet<string> = new Set<string>();

export type DoorCallbacks = {
  /**
   * Raises one hint, BY KEY. The rig knows which thing to say, not which
   * language to say it in: the director (`camera-director.ts`) resolves the key
   * against the instance's own catalogue, so two viewers in two languages hint
   * in two languages and nothing about the message is process-wide.
   */
  onHint: (key: MessageKey, params?: Record<string, string | number>) => void;
  /** Doors whose leaf is IN the doorway right now (`DoorStates.blockingIds`). */
  closedDoors?: (() => ReadonlySet<string>) | undefined;
  /**
   * Doors that will not open by themselves (`DoorStates.latchedIds`, or every
   * shut door when `doors.autoOpen` is off). Absent means "the same as
   * `closedDoors`", which is the pre-automation rule.
   */
  lockedDoors?: (() => ReadonlySet<string>) | undefined;
  /**
   * Arms a latched door again (`DoorStates.rearm`). Absent is the
   * pre-automation viewer: no latch to escape, so a shut door is refused
   * immediately, exactly as it always was.
   */
  rearmDoor?: ((openingId: string) => boolean) | undefined;
};

type DoorDeps = {
  plan: () => SolvedPlan;
  callbacks: DoorCallbacks;
  /**
   * Whether a refusal must stay quiet. A scripted route walks INTO closed
   * doors on purpose — the auto-open rule opens them as the camera arrives —
   * so complaining about one mid-route would contradict the travel the viewer
   * just asked for.
   */
  suspended: () => boolean;
};

export class DoorNegotiator {
  private readonly deps: DoorDeps;
  private lastHintAt = -Infinity;

  constructor(deps: DoorDeps) {
    this.deps = deps;
  }

  /** Whether the viewer has any latch to release at all. */
  get automated(): boolean {
    return this.deps.callbacks.rearmDoor !== undefined;
  }

  /** Doors whose leaf is in the way right now; empty when nothing tracks door state. */
  closed(): ReadonlySet<string> {
    return this.deps.callbacks.closedDoors?.() ?? EMPTY_DOORS;
  }

  /** Doors that will stay shut however close the walker gets. */
  locked(): ReadonlySet<string> {
    return this.deps.callbacks.lockedDoors?.() ?? this.closed();
  }

  /**
   * Which of `doors` the step from `from` to `to` would cross, in the order the
   * set names them. Empty when the step crosses none — the answer for all but a
   * handful of frames, which is why the cheap all-at-once test comes first and
   * the per-door one only runs for a step that is actually blocked.
   */
  inTheWay(doors: ReadonlySet<string>, from: Vec3, to: Vec3): string[] {
    const plan = this.deps.plan();
    if (doors.size === 0 || !crossesClosedDoor(plan, doors, from, to)) return [];
    const crossed: string[] = [];
    for (const id of doors) {
      if (crossesClosedDoor(plan, new Set([id]), from, to)) crossed.push(id);
    }
    return crossed;
  }

  /**
   * Tells the door state which latches the walker has just insisted on, and
   * answers whether any of them is now off. `false` from a viewer that has no
   * latches to release — there the refusal is the answer, and it is said out
   * loud.
   */
  rearm(ids: readonly string[]): boolean {
    const rearm = this.deps.callbacks.rearmDoor;
    if (!rearm) return false;
    let released = false;
    for (const id of ids) released = rearm(id) || released;
    return released;
  }

  /**
   * Says `hint.doorClosed`, and answers whether it did. A held key must not
   * restate it every frame, so the continuous path (movement) is throttled; a
   * deliberate tap always answers.
   */
  refuse(force = false): boolean {
    if (this.deps.suspended()) return false;
    const now = performance.now();
    if (!force && now - this.lastHintAt < WALK.doorHintThrottleMs) return false;
    this.lastHintAt = now;
    this.deps.callbacks.onHint('hint.doorClosed');
    return true;
  }
}
