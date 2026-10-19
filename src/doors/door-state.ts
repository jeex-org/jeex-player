/**
 * Which doors are open, which are shut, and where every leaf is in between.
 *
 * Door state is VIEW state, not document state: closing a door changes what the
 * camera may walk through and what the leaves look like, never the apartment
 * itself, so nothing here is ever committed to `SceneModel`. A reload opens
 * every door again, which is how the apartment is authored (`scene-authoring`).
 *
 * A door has TWO states, and keeping them apart is what lets a shut door open
 * as a walker arrives without forgetting that it is shut: `rest` is what the
 * user (or the scene) decided, `phase`/`t` is where the leaf happens to be.
 * The proximity automation (`doorAutomation`) only ever borrows a leaf — it
 * holds a rest-closed door open while the eye is near and gives it back to its
 * rest state when the eye leaves. A rest-OPEN door is never closed by walking
 * away.
 *
 * Invariants:
 * - `t` is `0` shut and `1` fully open, and never leaves that range whatever
 *   the clock does — a stale or backwards `now` cannot push a leaf through a
 *   wall;
 * - a reversal keeps the leaf where it is (`t` is carried over) and travels the
 *   remaining distance at the same speed, so no toggle makes a leaf jump;
 * - `blockingIds()` is PHYSICAL — the leaf is in the doorway right now
 *   (`t < DOOR_PASSABLE_T`) — so a walker waits at a door that is swinging open
 *   instead of walking through the wood, and slips out through one that has
 *   only just started to close;
 * - `latchedIds()` is INTENTIONAL — shut and not going to open by itself — so a
 *   tap beyond it is refused with a hint instead of walking into a stall;
 * - `closedIds()` (shut or shutting) is the pre-automation rule, kept for
 *   `doors.autoOpen: false`.
 *
 * Pure module: no `three`, no DOM.
 */

import { easeInOutCubic } from '../shared/easing.js';
import { clamp01 } from '../shared/math.js';

export type DoorPhase = 'open' | 'closed' | 'opening' | 'closing';

/** What the door is FOR: what it returns to once nobody is standing at it. */
type DoorRest = 'open' | 'closed';

export type DoorRecord = {
  id: string;
  phase: DoorPhase;
  /** 0 = closed, 1 = fully open. */
  t: number;
  /** The state the door was left in; the automation always returns it here. */
  rest: DoorRest;
  /** True while the automation is holding this rest-closed door open. */
  auto: boolean;
  /**
   * Whether the automation may take this door. A manual close arms nothing:
   * shutting a door in your own face keeps it shut until you walk away
   * (past `DOOR_AUTO_CLOSE_M`) and come back.
   */
  armed: boolean;
};

/** Time a leaf takes to travel the whole way, milliseconds (`easeInOutCubic` on `t`). */
export const DOOR_ANIMATION_MS = 650;

/** How close the eye has to be for a rest-closed door to open itself, metres. */
export const DOOR_AUTO_OPEN_M = 2.0;

/**
 * How far the eye has to leave before an automatically opened door closes
 * again, metres. Wider than the open radius on purpose: a walker loitering in a
 * doorway must not make the leaf flutter.
 */
export const DOOR_AUTO_CLOSE_M = 2.6;

/**
 * How far a leaf has to have swung for a body to fit past it. Below this the
 * doorway is wood, whatever the phase says.
 */
export const DOOR_PASSABLE_T = 0.6;

/**
 * How far off the gaze a door may sit and still open itself, as a cosine. A
 * door beside the walker opens; one squarely behind — which they cannot see —
 * does not.
 */
const AUTO_OPEN_COS = -0.2;

/** One door's state plus the animation it is in the middle of, if any. */
type DoorEntry = {
  id: string;
  phase: DoorPhase;
  t: number;
  rest: DoorRest;
  auto: boolean;
  armed: boolean;
  /** Value of `t` the current animation started from. */
  from: number;
  /** Clock reading the current animation started at, milliseconds. */
  start: number;
  /** Length of the current animation, milliseconds; `0` when settled. */
  duration: number;
};

export class DoorStates {
  private entries = new Map<string, DoorEntry>();

  /** Every interactive door of the scene, all of them open. */
  constructor(ids: readonly string[]) {
    this.reset(ids);
  }

  /** A COPY of one door's state; the caller may not edit the machine through it. */
  get(id: string): DoorRecord | undefined {
    const entry = this.entries.get(id);
    return entry ? record(entry) : undefined;
  }

  /** Every door's state, in the order the ids were registered. */
  list(): DoorRecord[] {
    return [...this.entries.values()].map((entry) => record(entry));
  }

  /** Ids of the doors that are shut or on their way shut, whatever the leaf shows. */
  closedIds(): ReadonlySet<string> {
    const closed = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.phase === 'closed' || entry.phase === 'closing') closed.add(entry.id);
    }
    return closed;
  }

  /**
   * Ids of the doors a body cannot fit past RIGHT NOW: the leaf still fills the
   * doorway (`t < DOOR_PASSABLE_T`), whatever direction it is travelling in.
   * This is the per-frame movement rule.
   */
  blockingIds(): ReadonlySet<string> {
    const blocking = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.t < DOOR_PASSABLE_T) blocking.add(entry.id);
    }
    return blocking;
  }

  /**
   * Ids of the doors that will NOT open by themselves: shut (or shutting) by a
   * decision the automation may not overrule. A walk tap beyond one of these is
   * refused; a tap beyond any other shut door is accepted, because approaching
   * it opens it.
   */
  latchedIds(): ReadonlySet<string> {
    const latched = new Set<string>();
    for (const entry of this.entries.values()) {
      const shut = entry.phase === 'closed' || entry.phase === 'closing';
      if (shut && entry.rest === 'closed' && !entry.armed) latched.add(entry.id);
    }
    return latched;
  }

  /**
   * Sends a door the other way: open or opening starts closing, closed or
   * closing starts opening. Answers with the new phase, or `null` for an id the
   * machine does not know.
   *
   * A toggle is a DECISION: it sets the door's rest state and takes it off the
   * automation. Shutting a door the automation was holding open latches it shut
   * until the camera has left the close radius.
   */
  toggle(id: string, now: number): DoorPhase | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const closing = entry.phase === 'open' || entry.phase === 'opening';
    this.decide(entry, closing ? 0 : 1, now);
    return entry.phase;
  }

  /** Opens a door for good (`rest = 'open'`); the swing is a no-op when it is already going. */
  open(id: string, now: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.decide(entry, 1, now);
  }

  /** Shuts a door for good (`rest = 'closed'`), and latches it against the automation. */
  close(id: string, now: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.decide(entry, 0, now);
  }

  /**
   * The automation borrows a door: opens it if needed and marks it `auto`, so a
   * later `release` knows to give it back. Never changes `rest`.
   */
  hold(id: string, now: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.auto = true;
    if (entry.phase === 'open' || entry.phase === 'opening') return;
    this.animate(entry, 1, now);
  }

  /**
   * The automation gives a door back: it travels to its rest state and is armed
   * again, which is also how a door latched by a manual close comes back into
   * play once the camera is far enough away.
   */
  release(id: string, now: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.auto = false;
    entry.armed = true;
    if (entry.rest !== 'closed') return;
    if (entry.phase === 'closed' || entry.phase === 'closing') return;
    this.animate(entry, 0, now);
  }

  /**
   * Puts a latched door back in the automation's reach without moving it:
   * `armed` and nothing else. The leaf stays exactly where it is and `rest`
   * still says what the user decided — the next frame's `hold` is what opens
   * it, and only if the pose qualifies.
   *
   * This is the escape from a latch that distance alone cannot give: the
   * release radius (`DOOR_AUTO_CLOSE_M`) is a pose that a small room may not
   * contain at all, and a walker who shuts a door on themselves in a bathroom
   * would otherwise be locked in. Insisting is the way out — a tap through the
   * door, or a push at the leaf — and it is the caller who reads that
   * insistence (`camera-controller.ts`). `false` for an id the machine does
   * not know.
   */
  rearm(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.armed = true;
    return true;
  }

  /** Advances every animation to `now`; answers with the ids whose `t` moved. */
  update(now: number): string[] {
    const changed: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry.phase !== 'opening' && entry.phase !== 'closing') continue;
      const target = entry.phase === 'opening' ? 1 : 0;
      const progress = entry.duration > 0 ? clamp01((now - entry.start) / entry.duration) : 1;
      const next = clamp01(entry.from + (target - entry.from) * easeInOutCubic(progress));
      const settled = progress >= 1;
      if (next === entry.t && !settled) continue;
      entry.t = settled ? target : next;
      if (settled) {
        entry.phase = target === 1 ? 'open' : 'closed';
        entry.duration = 0;
      }
      changed.push(entry.id);
    }
    return changed;
  }

  /**
   * Adopts the door list of a freshly rebuilt plan: a door that survived keeps
   * its state (a closed door must not fly open because a finish changed), a new
   * one joins open, and one that is gone is forgotten.
   */
  reset(ids: readonly string[]): void {
    const next = new Map<string, DoorEntry>();
    for (const id of ids) {
      const existing = this.entries.get(id);
      next.set(id, existing ?? { id, phase: 'open', t: 1, rest: 'open', auto: false, armed: true, from: 1, start: 0, duration: 0 });
    }
    this.entries = next;
  }

  /**
   * A deliberate open or close: the door's REST state moves with it, the
   * automation loses the door, and closing latches it (the automation re-arms
   * only once the camera has left the close radius).
   */
  private decide(entry: DoorEntry, target: 0 | 1, now: number): void {
    entry.rest = target === 1 ? 'open' : 'closed';
    entry.auto = false;
    entry.armed = target === 1;
    const settledThatWay =
      target === 1 ? entry.phase === 'open' || entry.phase === 'opening' : entry.phase === 'closed' || entry.phase === 'closing';
    if (settledThatWay) return;
    this.animate(entry, target, now);
  }

  /** Starts a travel towards `target`, from wherever the leaf currently stands. */
  private animate(entry: DoorEntry, target: 0 | 1, now: number): void {
    entry.from = entry.t;
    entry.start = now;
    // Constant leaf speed: half the way takes half the time, so a reversal
    // mid-swing neither dawdles nor snaps.
    entry.duration = DOOR_ANIMATION_MS * Math.abs(target - entry.t);
    entry.phase = target === 1 ? 'opening' : 'closing';
  }
}

/** The read-only view of an entry every accessor hands out. */
function record(entry: DoorEntry): DoorRecord {
  return { id: entry.id, phase: entry.phase, t: entry.t, rest: entry.rest, auto: entry.auto, armed: entry.armed };
}

/** A door as the auto-open test sees it: an id and its centre in world metres. */
export type DoorCentre = { id: string; center: { x: number; y: number; z: number } };

/** A point on the plan; the automation is a plan-level question, height is not part of it. */
type PlanPoint = { x: number; z: number };

/**
 * What the proximity automation wants done from ONE camera pose: which
 * rest-closed doors to hold open, and which held (or latched) doors to give
 * back to their rest state.
 *
 * Pure query — it changes nothing, so `__viewerDebug.doorAutomation()` can ask
 * it for the current frame — and horizontal: a walker's eye and a door's centre
 * are at different heights and the distance that matters is the one on the
 * floor.
 *
 * `hold` and `release` are separated by hysteresis (`DOOR_AUTO_OPEN_M` <
 * `DOOR_AUTO_CLOSE_M`) so a walker standing in a doorway never makes the leaf
 * flutter, and a door in the release band is left exactly as it is.
 */
export function doorAutomation(
  doors: Iterable<DoorCentre>,
  records: Iterable<DoorRecord>,
  camera: PlanPoint,
  forward: PlanPoint,
): { hold: string[]; release: string[] } {
  const byId = new Map<string, DoorRecord>();
  for (const entry of records) byId.set(entry.id, entry);
  // The gaze is a 3D unit vector: its plan projection shortens with pitch, so
  // it is re-normalised here rather than compared as if it were unit.
  const gaze = Math.hypot(forward.x, forward.z);
  const hold: string[] = [];
  const release: string[] = [];
  for (const door of doors) {
    const state = byId.get(door.id);
    if (!state) continue;
    const dx = door.center.x - camera.x;
    const dz = door.center.z - camera.z;
    const distance = Math.hypot(dx, dz);
    if (state.rest === 'closed' && state.armed && distance <= DOOR_AUTO_OPEN_M) {
      const cos = distance < 1e-6 || gaze < 1e-6 ? 1 : (forward.x * dx + forward.z * dz) / (gaze * distance);
      if (cos > AUTO_OPEN_COS) {
        hold.push(door.id);
        continue;
      }
    }
    // Beyond the close radius the automation lets go of what it holds, and a
    // door latched shut by a manual close is armed again.
    if (distance > DOOR_AUTO_CLOSE_M && (state.auto || !state.armed)) release.push(door.id);
  }
  return { hold, release };
}

/**
 * Closed doors the tour should open: the ones within `radius` of the camera and
 * in front of it.
 *
 * The pre-automation rule, kept for `doors.autoOpen: false`: the doors it names
 * are opened FOR GOOD, so a run through the apartment leaves every door it
 * passed standing open. With the automation on (the default) `doorAutomation`
 * decides instead, and a rest-closed door shuts again behind the camera.
 */
export function doorsToAutoOpen(
  doors: Iterable<DoorCentre>,
  camera: { x: number; z: number },
  forward: { x: number; z: number },
  closed: ReadonlySet<string>,
  radius = DOOR_AUTO_OPEN_M,
): string[] {
  const open: string[] = [];
  for (const door of doors) {
    if (!closed.has(door.id)) continue;
    const dx = door.center.x - camera.x;
    const dz = door.center.z - camera.z;
    if (Math.hypot(dx, dz) > radius) continue;
    if (forward.x * dx + forward.z * dz <= 0) continue;
    open.push(door.id);
  }
  return open;
}
