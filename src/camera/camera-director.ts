/**
 * Who drives the camera: the mode buttons, a room focus, the autotour, or the
 * user grabbing the scene mid-tour.
 *
 * Every one of those has to agree on three things at once — the camera mode,
 * whether the tour is playing, and whether the shell is a dollhouse or the full
 * interior — so they all go through here instead of being repeated in the
 * composition root.
 *
 * Invariant: the shell state follows the mode (`orbit` is a dollhouse, `walk`
 * is full, `tour` returns to the dollhouse), with one exception: a manual grab
 * during a tour leaves the shell as it is, so the scene does not pop while the
 * user takes over.
 *
 * Document invariant: the director also owns the point where a new committed
 * document reaches the camera stack (`setScene`), because the controller's
 * obstacles and the tour's route both come from it and must change together.
 *
 * Walk is the user-driven tour (`walk-stepper.ts`):
 * entering `walk` on a document whose tour rides its cameras glides to camera
 * 1 and stops there; the person walks, and steps between the cameras on
 * demand (`stepCamera`). A manual input cancels a step where it stands. The
 * tour's own player, state and public events are never touched by a walk.
 */

import type { UsageSink } from '../shared/usage.js';
import * as THREE from 'three';
import { CameraController } from './camera-controller.js';
import type { RouteWaypoint } from '../navigation/room-graph.js';
import { RoomTravel } from './room-travel.js';
import type { AssetFactsSource } from '../assets/asset-facts.js';
import { TourPlayer } from './tour-player.js';
import { TourCameraReach } from './tour-camera-reach.js';
import { WalkStepper, type StepTarget, type WalkCamera } from './walk-stepper.js';
import type { TourPose, TourProgress, TourState } from './tour-player.js';
import { tourRouteOf } from '../scene/tour-route.js';
import { tourNavigation } from '../navigation/tour-legs.js';
import type { Picker } from '../geometry/picker.js';
import type { SurfacePick } from '../geometry/picker.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import type { SceneData, Vec2, ViewerMode } from '../scene/types.js';
import { isPlanMode } from '../scene/types.js';
import type { MessageKey, Messages } from '../shared/messages.js';

/**
 * The seven things the director drives on the chrome — hints, mode buttons, the
 * plan-mode veil, the tour status pill and progress bar, the auto-hide wake
 * and the narrow-viewer hint's collapse — declared HERE (the role camera code depends on) rather than imported
 * from `ui/viewer-ui.ts` (the class that happens to implement it today): a
 * camera module names what it needs, not who provides it, which is what lets
 * `camera` stay below `ui` in the layer order. `ViewerUI`
 * implements this without an explicit `implements` on its own side of the
 * import — camera never imports `ui`.
 */
export type DirectorChrome = {
  setHint(message: string): void;
  setModeButtons(mode: ViewerMode): void;
  /** Every mode switch, plan or not (`applyPlanMode`): the tour chrome shows only in `tour`. */
  setPlanMode(mode: ViewerMode): void;
  setTourState(state: TourState): void;
  setTourProgress(progress: TourProgress): void;
  wakeControls(): void;
  /** Scene input closes a narrow viewer's opened hint (`ui/hint-toggle.ts`). */
  collapseHint(): void;
};

type CameraDirectorDeps = {
  controller: CameraController;
  tour: TourPlayer;
  ui: DirectorChrome;
  /** This instance's catalogue; every hint the director raises comes from it. */
  messages: Messages;
  dollhouse: Dollhouse;
  /** The CURRENT committed scene; a plan-level commit hands out a new object. */
  scene: () => SceneData;
  /** The CURRENT solved plan; the room graph is rebuilt when it changes. */
  plan: () => SolvedPlan;
  camera: () => THREE.Camera | undefined;
  /**
   * Whether scene input pauses a running tour and hands the camera over.
   * `false` ignores input while the tour is engaged, which is what a
   * scroll-driven embed wants (`viewer-options.ts`). Defaults to `true`.
   */
  pauseOnInput?: boolean | undefined;
  /**
   * The two display-only modes (`plan-modes.ts`): the 2D overlay and the
   * orthographic top view. Absent in the unit harness, where there is no DOM
   * and no renderer.
   */
  planModes?: PlanModeHost | undefined;
  /** The walk's current camera or the camera count changed; the chrome and the public `walkCamera` event. */
  onWalkCamera?: ((camera: WalkCamera) => void) | undefined;
};

/**
 * What the director asks of the plan modes. One call, because entering and
 * leaving them is one decision: `plan-modes.ts` owns which of the two (if
 * either) is on and what that does to the render camera and the loop.
 */
type PlanModeHost = {
  setMode(mode: ViewerMode): void;
  /**
   * The perspective pose that shows what the plan mode on screen shows
   * (`plan-view-pose.ts`), `null` outside `plan2d`/`plan3d`. A plan mode
   * freezes the perspective camera wherever the 360 view left it, so without
   * this a walk or tour entry would glide from a pose nobody is looking at.
   */
  viewPose(): TourPose | null;
};

/** Everything `mountCameraDirector` needs to build the camera stack itself. */
export type CameraStackDeps = {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** Where keystrokes are listened for; the stage resolves it from `ViewerRoots.root`. */
  keys: HTMLElement;
  picker: Picker;
  ui: DirectorChrome;
  /** This instance's catalogue; handed on to the director. */
  messages: Messages;
  dollhouse: Dollhouse;
  scene: () => SceneData;
  plan: () => SolvedPlan;
  onSurfacePicked: (pick: SurfacePick | null, clientX: number, clientY: number) => void;
  onFurniturePicked: (assetId: string | null) => void;
  /** Throttled hover report; absent switches the hover raycast off entirely. */
  onHover?: ((pick: SurfacePick | null, clientX: number, clientY: number) => void) | undefined;
  /** A plain wheel went to the page (viewer not engaged): the stage shows «Ctrl + scroll». */
  onScrollThrough?: (() => void) | undefined;
  /** A vertical swipe went to the page (viewer not engaged): the stage shows «Tap to look around». */
  onSwipeThrough?: (() => void) | undefined;
  /** A pointer press reached the viewer: the stage takes that plate away. */
  onPress?: (() => void) | undefined;
  /** A walk tap on an opening; `true` when the application consumed it. */
  onOpeningTapped?: ((openingId: string) => boolean) | undefined;
  /** Doors whose leaf is in the doorway right now, so a walk step waits at it. */
  closedDoors?: (() => ReadonlySet<string>) | undefined;
  /** Doors that will stay shut, so a walk tap beyond one is refused with a hint. */
  lockedDoors?: (() => ReadonlySet<string>) | undefined;
  /**
   * Takes the latch off a door the walker has insisted on (a tap through it, a
   * push at the leaf); `true` when the door will now open by itself.
   */
  rearmDoor?: ((openingId: string) => boolean) | undefined;
  /** The document's bank, for the walk obstacles (`CameraController.assetFacts`); absent is the shipped bank. */
  assetFacts?: (() => AssetFactsSource) | undefined;
  pauseOnInput?: boolean;
  /**
   * `options.interaction`, passed straight to `CameraController` —
   * `'none'` skips `CameraInput` entirely, `'passive'` attaches one that never
   * blocks page scroll. Default `'full'`.
   */
  interaction?: 'full' | 'none' | 'passive' | undefined;
  /** The 2D overlay and the top-view camera; absent leaves both modes inert. */
  planModes?: PlanModeHost;
  /** Public fan-out of the tour clip, wired next to the UI updates. */
  onTourState?: ((state: TourState) => void) | undefined;
  onTourProgress?: ((progress: TourProgress) => void) | undefined;
  /** The walk's current camera or the camera count changed (`CameraDirector.stepCamera`). */
  onWalkCamera?: ((camera: WalkCamera) => void) | undefined;
  /** The mounted viewer's lifetime; the pointer/key listeners carry it. */
  signal?: AbortSignal | undefined;
  /** Hears accepted camera steps and a tour played to its end (`shared/usage.ts`). */
  usage?: UsageSink | undefined;
};

/**
 * Builds the camera controller, the tour player and the director around one
 * document. The composition root calls this once and then hands every later
 * document to `setScene`.
 */
export function mountCameraDirector(deps: CameraStackDeps): CameraDirector {
  let director: CameraDirector | undefined;
  const controller = new CameraController(deps.camera, deps.canvas, deps.scene(), deps.plan(), deps.picker, {
    keys: deps.keys,
    onManualInput: () => director?.handleManualInput(),
    onCameraStep: (to) => {
      const stepped = director?.stepCamera(to) ?? false;
      if (stepped) deps.usage?.('camera_step');
      return stepped;
    },
    // The rigs raise a hint by KEY; the director turns it into words with this
    // instance's own catalogue. It exists before any input can reach a rig —
    // the controller is not wired to a canvas until this function returns.
    onHint: (key, params) => director?.hint(key, params),
    onSurfacePicked: deps.onSurfacePicked,
    onFurniturePicked: deps.onFurniturePicked,
    onHover: deps.onHover,
    onScrollThrough: deps.onScrollThrough,
    onSwipeThrough: deps.onSwipeThrough,
    onPress: deps.onPress,
    onOpeningTapped: deps.onOpeningTapped,
    closedDoors: deps.closedDoors,
    lockedDoors: deps.lockedDoors,
    rearmDoor: deps.rearmDoor,
    assetFacts: deps.assetFacts,
    interaction: deps.interaction,
    signal: deps.signal,
  });
  const tour = new TourPlayer(
    deps.scene(),
    (position, target) => controller.setPose(position, target),
    {
      onState: (state) => {
        deps.ui.setTourState(state);
        deps.onTourState?.(state);
      },
      onProgress: (progress) => {
        deps.ui.setTourProgress(progress);
        deps.onTourProgress?.(progress);
      },
      pose: () => controller.getPose(),
      onComplete: () => deps.usage?.('tour_complete'),
    },
    tourNavigation(deps.plan(), deps.scene()),
  );
  director = new CameraDirector({
    controller,
    tour,
    ui: deps.ui,
    messages: deps.messages,
    dollhouse: deps.dollhouse,
    scene: deps.scene,
    plan: deps.plan,
    camera: () => deps.camera,
    pauseOnInput: deps.pauseOnInput,
    planModes: deps.planModes,
    onWalkCamera: deps.onWalkCamera,
  });
  return director;
}

export class CameraDirector {
  private readonly deps: CameraDirectorDeps;
  /**
   * This instance's catalogue. It is a FIELD rather than a read of `deps`
   * because `handle.setLocale` replaces it mid-session (`retranslate`), and
   * every hint in the camera stack — the director's own and the ones the rigs
   * raise by key — is resolved through it.
   */
  private catalogue: Messages;
  /** Shorthand: this module raises most of the hints. */
  private get messages(): Messages {
    return this.catalogue;
  }
  private pauseOnInput: boolean;
  /** Flights, walks and jumps to a named room, with the room graph they route over (`room-travel.ts`). */
  private readonly rooms: RoomTravel;
  /** The walk entry glide and the camera steps. */
  private readonly stepper: WalkStepper;
  private readonly tourReach = new TourCameraReach();
  /**
   * The walk-with-cameras hint waits for the walk's FIRST frame: every mode
   * switch is followed, synchronously, by the chrome's own hint for the mode
   * (`handle-commands.ts`, `viewer-ui.ts`), which would overwrite it.
   */
  private walkHintPending = false;

  constructor(deps: CameraDirectorDeps) {
    this.deps = deps;
    this.catalogue = deps.messages;
    this.pauseOnInput = deps.pauseOnInput ?? true;
    this.stepper = new WalkStepper({
      scene: deps.scene,
      plan: deps.plan,
      pose: () => poseOfCamera(deps.camera()) ?? deps.controller.getPose(),
      setPose: (position, target) => deps.controller.setPose(position, target),
      syncWalkLook: () => deps.controller.syncWalkLook(),
      onCamera: deps.onWalkCamera,
    });
    this.rooms = new RoomTravel({
      controller: deps.controller,
      ui: deps.ui,
      scene: deps.scene,
      plan: deps.plan,
      hint: (key, params) => this.hint(key, params),
      cancelStep: () => this.stepper.cancel(),
      leavePlanMode: () => this.applyPlanMode('orbit'),
      stopTour: () => deps.tour.stop(),
      dollhouse: () => this.setShell('dollhouse'),
      walkFromTour: () => {
        this.walkFromTour();
        // The room travel speaks for itself: the camera-keys hint would replace
        // «walking to …» on the next frame.
        this.walkHintPending = false;
      },
    });
  }

  /**
   * Says one thing, once, in this instance's language. Every hint in the
   * camera stack goes through here: the director's own, and the ones
   * `walk-rig.ts` / `walk-doors.ts` raise as a KEY without knowing the locale.
   */
  hint(key: MessageKey, params?: Record<string, string | number>): void {
    this.deps.ui.setHint(this.messages.t(key, params));
  }

  /** Adopts a new catalogue in place (`handle.setLocale`); nothing is rebuilt. */
  retranslate(messages: Messages): void {
    this.catalogue = messages;
  }

  /** Whether scene input pauses a running tour; a mount option, see `viewer-options.ts`. */
  setPauseOnInput(enabled: boolean): void {
    this.pauseOnInput = enabled;
  }

  /**
   * Reduced motion: whether the NEXT scripted travel (`focusRoom`, a minimap
   * click, `flyTo`) lands in one frame. The composition root calls this once
   * at mount from the resolved `motion` option and again on every
   * `prefers-reduced-motion` change while `motion: 'auto'` — this director,
   * like the rig underneath it, reads no media query itself.
   */
  setMotion(instant: boolean): void {
    this.deps.controller.setMotionInstant(instant);
    // A checkpoint tour and the walk entry glide to camera 1; reduced motion cuts, and so does a step.
    this.deps.tour.setMotionInstant(instant);
    this.stepper.setMotionInstant(instant);
  }

  get controller(): CameraController {
    return this.deps.controller;
  }

  get tour(): TourPlayer {
    return this.deps.tour;
  }

  /**
   * Adopts a newly committed document: the controller recomputes its obstacles
   * and orbit home, the tour adopts the new route. A plan change that only
   * reached the geometry would leave walk collisions on the previous plan.
   *
   * The route is `tourRouteOf(scene)`: the tour checkpoints when the document
   * carries a real list of them, else the authored `autotour` — one
   * derivation, shared with the placement overlay, so the route that plays is
   * the route the editor drew.
   */
  setScene(scene: SceneData, plan: SolvedPlan): void {
    this.deps.controller.setScene(scene, plan);
    this.deps.tour.setRoute(tourRouteOf(scene, tourNavigation(plan, scene)));
    this.stepper.sceneChanged();
  }

  /**
   * Switches the camera mode. ENTERING `walk` on a document whose tour rides
   * its cameras glides to camera 1 and stops there: the pose is read before
   * the switch (in orbit it is the orbit target — see `engageTour`), the walk
   * spawn the controller may apply is never drawn, and the glide starts from
   * that pose. Asking for `walk` while a walk is gliding or stepping changes
   * nothing.
   */
  setMode(mode: ViewerMode): void {
    const entering = mode !== this.deps.controller.getMode();
    if (!entering && this.stepper.isMoving()) return;
    const glideFrom = mode === 'walk' && entering && this.deps.tour.isCheckpointRoute() ? this.viewOnScreen() : null;
    this.stepper.cancel();
    this.deps.tour.pause();
    this.applyPlanMode(mode);
    this.deps.controller.setMode(mode);
    // Walk and tour stand inside the flat and need its ceilings; everything
    // else is a dollhouse. The top view is a dollhouse whose exterior walls all
    // stay up, because from above none of them hides anything.
    this.setShell(mode === 'walk' || mode === 'tour' ? 'full' : 'dollhouse');
    this.walkHintPending = glideFrom !== null && this.stepper.enter(glideFrom);
  }

  /**
   * An EXPLICIT mode choice — a mode button, the handle's `setMode`, the embed
   * protocol's `setMode`. Choosing 360 this way
   * ends in the Reset camera pose, through `reset()` itself and never a copy
   * of it, so the two cannot drift apart. Implicit landings in 360 — a grab
   * that takes over a running tour (`handleManualInput`), a room focus, the
   * return from a look-through — go through `setMode` or the controller and
   * keep the pose, because resetting would yank the camera from under the
   * pointer.
   */
  selectMode(mode: ViewerMode): void {
    this.setMode(mode);
    if (mode === 'orbit') this.reset();
  }

  /**
   * Enters `walk` standing exactly at `pose` — the look-through pilot's entry
   * («Look through»): no entry glide and no spawn, the
   * walk rig adopts the pose's look, so the first drag turns from what the
   * tour camera sees. Standing on a tour camera makes it the current one.
   */
  enterWalkAt(pose: TourPose): void {
    this.stepper.cancel();
    this.deps.tour.pause();
    this.applyPlanMode('walk');
    this.deps.controller.setMode('walk');
    this.setShell('full');
    this.deps.controller.setPose(pose.position, pose.target);
    this.deps.controller.syncWalkLook();
    this.stepper.standAt(pose);
  }

  /** The walk's current camera and the camera count (`getState().walk`). */
  walkCamera(): WalkCamera {
    return this.stepper.camera();
  }

  /** The camera the mini-map marks: in `tour` the one the run has reached, elsewhere the walk's current one. */
  mapCamera(): number | null {
    if (this.deps.controller.getMode() !== 'tour') return this.walkCamera().index;
    return this.tourReach.reached(this.deps.scene(), this.deps.plan(), this.deps.tour.progress().distance);
  }

  /**
   * Steps to a tour camera: the walker walks the leg
   * there and stops on its pose. From `tour` the run pauses and the viewer
   * switches to `walk` first, like a mini-map room click; in any other mode
   * there is no walker, and nothing happens. `false` when nothing started.
   */
  stepCamera(to: StepTarget): boolean {
    const { controller, ui } = this.deps;
    // The step replaces the entry glide `setMode` starts; the camera-keys hint stays, it is about steps.
    if (controller.getMode() === 'tour') this.walkFromTour();
    if (controller.getMode() !== 'walk') return false;
    // A step is the walker's new destination: a room travel in flight stops
    // where it stands, or the travel and the step both write the camera every
    // frame (`travelToRoom` cancels a step the same way).
    controller.cancelTravel();
    const started = this.stepper.step(to);
    if (started) ui.wakeControls();
    return started;
  }

  /**
   * Leaves a running tour for a walk that the caller drives at once (a camera
   * step, a room travel): the run pauses, the mode buttons follow, and the
   * walk entry glide `setMode` starts is cancelled, or it would fight the
   * caller's motion every frame and land on camera 1 in the middle of it.
   */
  private walkFromTour(): void {
    this.deps.tour.pause();
    this.setMode('walk');
    this.deps.ui.setModeButtons('walk');
    this.stepper.cancel();
  }

  /** The tour player's frame in `tour`; the entry glide and the steps in `walk`. */
  updateTour(delta: number): void {
    const mode = this.deps.controller.getMode();
    if (mode === 'tour') this.deps.tour.update(delta);
    else if (mode === 'walk') {
      if (this.walkHintPending) this.hint('hint.walkCameras');
      this.walkHintPending = false;
      this.stepper.update(delta);
    }
  }

  /**
   * The view on screen as a pose: a plan mode's top view stands in as its
   * perspective equivalent, anything else is the camera's own pose. Read
   * BEFORE a mode switch — see `engageTour` for why the order matters.
   */
  private viewOnScreen(): TourPose {
    return this.deps.planModes?.viewPose() ?? this.deps.controller.getPose();
  }

  /**
   * Routes a mode to the plan-mode host and to the chrome that has to step out
   * of the way. Every path that changes the mode goes through here, so a room
   * focus or a manual grab can never leave the 2D overlay standing.
   */
  private applyPlanMode(mode: ViewerMode): void {
    this.deps.planModes?.setMode(mode);
    this.deps.ui.setPlanMode(mode);
    this.deps.dollhouse.setKeepExteriors(mode === 'plan3d', this.deps.camera());
  }

  /**
   * Puts the camera stack in tour mode against the dollhouse shell WITHOUT
   * touching playback, and answers with the pose the camera had — the fly-in
   * pose for a `play()` that follows. `null` when the tour was already
   * engaged: there is nothing to fly in from.
   *
   * The pose is read BEFORE the mode switch. `getPose()` only answers with the
   * orbit target while the controller is still in orbit mode; asked in `tour`
   * mode it falls through to the walk look angles, which are `0/0` until walk
   * mode seeds them. Reading it after the switch would fly the whole 19 m dive
   * from the presentation view with its gaze locked 4 m due south of the
   * camera — at nothing — and open the run on half a minute of empty sky.
   */
  engageTour(): TourPose | null {
    this.stepper.cancel();
    const engaged = this.deps.controller.getMode() === 'tour';
    // Before `applyPlanMode`: leaving a plan mode is what makes its top view stop being the view on screen.
    const from = engaged ? null : this.viewOnScreen();
    this.applyPlanMode('tour');
    if (!engaged) this.deps.controller.setMode('tour');
    // The camera stands on the view it flies in from at once: the player's
    // first pose only arrives in the next frame, after the controller has
    // fitted the field of view to wherever the camera stood.
    if (from) this.deps.controller.setPose(from.position, from.target);
    // Entering the tour on a checkpoint route starts it over from camera 1:
    // the `play()` that follows glides there from `from`.
    if (!engaged && this.deps.tour.isCheckpointRoute()) this.deps.tour.stop();
    this.setShell('dollhouse');
    return from;
  }

  /** The tour button: starts the run, or pauses a running one. */
  toggleTour(): void {
    const from = this.engageTour();
    if (this.deps.tour.getState() === 'playing') this.deps.tour.pause();
    else this.deps.tour.play(from ?? undefined);
  }

  reset(): void {
    this.stepper.cancel();
    this.deps.tour.stop();
    this.applyPlanMode('orbit');
    this.deps.controller.reset();
    this.setShell('dollhouse');
  }

  /** Flies the orbit camera into a room (`room-travel.ts`); `false` when the scene has no camera for it. */
  focusRoom(roomId: string): boolean {
    return this.rooms.focusRoom(roomId);
  }

  /** Waypoints over the doors to the centre of `roomId`, `null` when nothing gets there (`room-travel.ts`). */
  routeToRoom(roomId: string): RouteWaypoint[] | null {
    return this.rooms.routeToRoom(roomId);
  }

  /** The curve a travel to `roomId` would follow, without moving anything (`room-travel.ts`). */
  travelPath(roomId: string): { length: number; points: Vec2[] } | null {
    return this.rooms.travelPath(roomId);
  }

  /** Takes the viewer to a room the way the mode it is in allows; `false` for an unknown room (`room-travel.ts`). */
  travelToRoom(roomId: string): boolean {
    return this.rooms.travelToRoom(roomId);
  }

  /** Scene input during playback: pause the tour and hand control back smoothly. */
  handleManualInput(): void {
    const { tour, controller, ui } = this.deps;
    // A plan mode swallows input entirely; nothing can reach here from one.
    if (isPlanMode(controller.getMode())) return;
    ui.collapseHint();
    // A walk entry or a step stops where it stands and stays a walk; the
    // input that ended it (a drag, a key, a tap) goes on to the walk rig.
    if (this.stepper.isMoving()) {
      this.stepper.cancel();
      ui.wakeControls();
      return;
    }
    // A scroll-driven embed owns the camera: the page's own wheel and pointer
    // events must not wrestle the tour away from it.
    if (!this.pauseOnInput && controller.getMode() === 'tour') return;
    if (tour.getState() === 'playing') {
      tour.pause();
      this.applyPlanMode('orbit');
      controller.setMode('orbit');
      ui.setModeButtons('orbit');
      this.hint('hint.tourPaused');
    } else if (controller.getMode() === 'tour') {
      this.applyPlanMode('orbit');
      controller.setMode('orbit');
      ui.setModeButtons('orbit');
    }
    ui.wakeControls();
  }

  private setShell(state: 'dollhouse' | 'full'): void {
    this.deps.dollhouse.setState(state, this.deps.camera());
  }
}

/** A camera's own pose: its place and the way it looks, whatever a rig's look angles say. */
function poseOfCamera(camera: THREE.Camera | undefined): TourPose | null {
  if (!camera) return null;
  camera.updateMatrixWorld();
  const position = camera.getWorldPosition(new THREE.Vector3());
  return { position, target: position.clone().add(camera.getWorldDirection(new THREE.Vector3())) };
}
