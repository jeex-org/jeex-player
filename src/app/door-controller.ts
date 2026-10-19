/**
 * Everything about doors, kept out of the composition root: which openings
 * are interactive, the view state over them, the animator that puts that state
 * on the leaves, the hover HUD, and the two screen-space answers the rest of
 * the viewer asks for.
 *
 * Invariant: door state is VIEW state and never a document change
 * (`door-state.ts`). Nothing here commits an op; a door that is open is a fact
 * about this session, not about the apartment.
 *
 * `doors.interactive: false` turns the whole feature off in one place: the door
 * list is empty, so there is no state, no HUD element, no hover raycast and
 * nothing blocking a walk.
 */

import * as THREE from 'three';
import { DoorStates, type DoorCentre, type DoorPhase, type DoorRecord } from '../doors/door-state.js';
import type { OpeningListEntry } from '../geometry/opening-builder.js';
import { DoorAnimator, doorLeafCentre } from '../doors/door-animator.js';
import { DoorHud } from '../doors/door-hud.js';
import { projectToViewport } from '../render/viewport-projection.js';
import type { Messages } from '../ui/messages.js';
import type { ViewerMode } from '../scene/types.js';

/**
 * Scratch: `screenPoint` runs every frame while the HUD anchor
 * is tracked; `projectToViewport` clones its `point` argument internally
 * (`render/viewport-projection.ts`), so handing it this reused vector is safe.
 */
const SCRATCH_LEAF_CENTRE = new THREE.Vector3();

type DoorControllerDeps = {
  /** The viewport the HUD is positioned inside, and the canvas it dismisses on. */
  container: HTMLElement;
  canvas: HTMLElement;
  messages: Messages;
  /** `options.doors.interactive`: the whole feature, on or off. */
  interactive: boolean;
  /** `options.doors.autoOpen`: the approach automation, on or off. */
  autoOpen: () => boolean;
  /** Every opening the current document built; the doors are filtered out of it. */
  openings: () => OpeningListEntry[];
  /** The built group of one opening, for the animator and the HUD anchor. */
  group: (openingId: string) => THREE.Object3D | null;
  camera: () => THREE.PerspectiveCamera | undefined;
  viewport: { clientWidth: number; clientHeight: number };
  /** The mode the camera is in; `undefined` before the camera stack exists. */
  mode: () => ViewerMode | undefined;
  /** True while a selection panel is open: the HUD steps out of its way. */
  panelOpen: () => boolean;
  /** True while a scripted route is running (`travel-rig.ts`). */
  travelling: () => boolean;
  /** The mounted viewer's lifetime; the HUD's listeners carry it. */
  signal?: AbortSignal | undefined;
};

/** The modes whose camera stands at door height; the plan cameras hang above. */
const WALKER_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['walk', 'tour']);
/** The modes that offer the hover affordance at all. */
const HUD_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['orbit', 'walk']);

export class DoorController {
  private readonly deps: DoorControllerDeps;
  /** Which doors are open; view state only, never committed (`door-state.ts`). */
  private readonly states = new DoorStates([]);
  private readonly animator: DoorAnimator;
  private hud?: DoorHud | undefined;

  constructor(deps: DoorControllerDeps) {
    this.deps = deps;
    this.animator = new DoorAnimator({
      states: this.states,
      group: (openingId) => deps.group(openingId),
      doors: () => this.interactiveDoors(),
      camera: () => deps.camera(),
      // Only reached with `doors.autoOpen` off: the tour AND a mini-map route
      // are scripted travel, and both then open the doors they walk up to for
      // good.
      scriptedCamera: () => deps.mode() === 'tour' || deps.travelling(),
      autoOpen: () => deps.autoOpen(),
      // Walk, tour and the scripted travel inside walk: the modes whose camera
      // stands at door height. The 360 and plan cameras hang above the flat and
      // would open every door they happen to float over.
      walkerCamera: () => walkerMode(deps.mode()),
    });
    this.mountHud();
  }

  /**
   * Every door the viewer lets the user work: openings of type `door`, entrance
   * included. Empty when `doors.interactive` is off, which is what turns the
   * whole feature into a no-op.
   */
  interactiveDoors(): DoorCentre[] {
    if (!this.deps.interactive) return [];
    return this.deps.openings().filter((entry) => entry.type === 'door');
  }

  /** Adopts the door list of a freshly built document, keeping what survived. */
  seed(): void {
    this.states.reset(this.interactiveDoors().map((door) => door.id));
    this.animator.applyAll();
    this.hud?.hide();
  }

  /** A variant swap handed out a new opening group with its leaf open again. */
  reapply(): void {
    this.animator.applyAll();
  }

  /** Per-frame: the automation, then the HUD anchor. */
  update(now: number): void {
    this.animator.update(now);
    this.hud?.update(now);
  }

  /** Sends one door the other way; `false` for anything that is not one. */
  toggle(openingId: string): boolean {
    if (!this.states.get(openingId)) return false;
    this.states.toggle(openingId, performance.now());
    this.animator.apply(openingId);
    return true;
  }

  /** Offers the HUD for a door the pointer or a tap landed on. */
  showFor(openingId: string): boolean {
    if (!this.states.get(openingId)) return false;
    this.hud?.showFor(openingId, performance.now());
    return true;
  }

  /** The pointer moved over something: offer the HUD when it is a door. */
  hover(openingId: string | null): void {
    this.hud?.hover(openingId, performance.now());
  }

  /** Viewport pixels of a door's leaf centre — where the HUD button sits. */
  screenPoint(openingId: string): { x: number; y: number } | null {
    const group = this.deps.group(openingId);
    const camera = this.deps.camera();
    if (!group || !camera) return null;
    const centre = doorLeafCentre(group);
    if (!centre) return null;
    return projectToViewport(camera, SCRATCH_LEAF_CENTRE.set(centre.x, centre.y, centre.z), {
      width: this.deps.viewport.clientWidth,
      height: this.deps.viewport.clientHeight,
    });
  }

  /**
   * Doors whose leaf is in the doorway RIGHT NOW, so a walk step waits at it.
   * With the automation off there is no "will open by itself", so both sets
   * collapse to the pre-automation "shut or shutting".
   */
  closedIds(): ReadonlySet<string> {
    return this.deps.autoOpen() ? this.states.blockingIds() : this.states.closedIds();
  }

  /** Doors that will STAY shut, so a walk tap beyond one is refused with a hint. */
  lockedIds(): ReadonlySet<string> {
    return this.deps.autoOpen() ? this.states.latchedIds() : this.states.closedIds();
  }

  /**
   * Takes the latch off a door the walker insisted on. With the automation off
   * a shut door really is a wall, so the refusal stands — and that `false` is
   * what produces `hint.doorClosed`.
   */
  rearm(openingId: string): boolean {
    return this.deps.autoOpen() && this.states.rearm(openingId);
  }

  /** The debug surface's view of the doors (`viewer-debug.ts`). */
  list(): DoorRecord[] {
    return this.states.list();
  }

  /** What the automation would do for the current pose, as a pure query. */
  pending(): { hold: string[]; release: string[] } {
    return this.animator.pending();
  }

  phase(openingId: string): DoorPhase | null {
    return this.states.get(openingId)?.phase ?? null;
  }

  dispose(): void {
    this.hud?.dispose();
    this.hud = undefined;
  }

  /** The HUD exists only when doors are interactive; without it nothing hovers. */
  private mountHud(): void {
    if (!this.deps.interactive) return;
    this.hud = new DoorHud({
      container: this.deps.container,
      canvas: this.deps.canvas,
      messages: this.deps.messages,
      signal: this.deps.signal,
      screenPoint: (openingId) => this.screenPoint(openingId),
      phase: (openingId) => this.phase(openingId),
      toggle: (openingId) => {
        this.toggle(openingId);
      },
      panelOpen: () => this.deps.panelOpen(),
      enabled: () => HUD_MODES.has(this.deps.mode() ?? 'orbit') && this.deps.mode() !== undefined,
    });
  }
}

function walkerMode(mode: ViewerMode | undefined): boolean {
  return mode !== undefined && WALKER_MODES.has(mode);
}
