/**
 * The camera mode switch: which rig owns the camera, and what a gesture means
 * to it.
 *
 * Three rigs share one `PerspectiveCamera`, and exactly one of them drives it
 * at a time: `orbit-rig.ts` (the dollhouse), `walk-rig.ts` (a person at eye
 * height, with `travel-rig.ts` inside it for a scripted route) and the tour,
 * which is not a rig at all — `tour-player.ts` writes the pose through
 * `setPose` and this controller only remembers what it was told. The two PLAN
 * modes freeze the rig entirely: `plan-modes.ts` draws the picture, this
 * camera does not move and takes no input, so the pose the user left is
 * exactly the one they come back to.
 *
 * Input arrives as normalised gestures (`camera-input.ts`), never as browser
 * events, and this file is where a gesture is given a meaning: the same drag
 * turns the dollhouse and turns the walker's head, the same MOVE drag (Space,
 * Shift or the right button) pans the dollhouse and walks the walker, and the
 * same wheel zooms the one and steps the other.
 *
 * Invariant: collisions and routing are decided by `navigation.ts` on the
 * CURRENT solved plan; nothing here inspects scene geometry. A plan-level
 * operation therefore has to re-seed the controller through `setScene`: the
 * rendered shell and the collision system must never disagree about whether a
 * doorway exists.
 */
import * as THREE from 'three';
import type { SceneData, Vec3, ViewerMode } from '../scene/types.js';
import { isPlanMode } from '../scene/types.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import { isNavigable, type Obstacle } from '../navigation/navigation.js';
import { obstaclesFor } from '../assets/asset-footprint.js';
import { shippedAssetFacts, type AssetFactsSource } from '../assets/asset-facts.js';
import { CAMERA_TUNING, fieldOfViewFor } from './camera-tuning.js';
import { CameraInput, type CameraGesture } from './camera-input.js';
import { OrbitRig } from './orbit-rig.js';
import { WalkRig, navigableFloorPoint, type WalkCallbacks } from './walk-rig.js';
import { FloorRing, floorRingPoint } from './floor-ring.js';
import type { TravelPath } from '../navigation/travel-path.js';
import type { Picker, SurfacePick } from '../geometry/picker.js';
import type { Logger } from '../shared/logger.js';

const { hover: HOVER, orbit: ORBIT, walk: WALK } = CAMERA_TUNING;

/** The keys that widen and narrow the walk field of view. */
const FOV_IN_KEYS: ReadonlySet<string> = new Set(['+', '=']);
const FOV_OUT_KEYS: ReadonlySet<string> = new Set(['-', '_']);
/** The walk's camera-step keys, free in the walk input table. */
const STEP_KEYS: ReadonlyMap<string, 'next' | 'previous' | 'first' | 'last'> = new Map([
  ['pagedown', 'next'],
  ['pageup', 'previous'],
  ['home', 'first'],
  ['end', 'last'],
] as const);

type CameraPose = { position: THREE.Vector3; target: THREE.Vector3 };

type InputCallbacks = WalkCallbacks & {
  /**
   * The bank the document's furniture is sized from (`assets/asset-facts.ts`),
   * read late: a baked project's own library over the shipped bank. Absent
   * is the shipped bank alone.
   */
  assetFacts?: (() => AssetFactsSource) | undefined;
  /**
   * Where keystrokes are listened for, passed straight to `CameraInput`.
   * Resolved by the caller (`app/viewer-stage.ts`, which owns `ViewerRoots`) —
   * this controller never reaches into the shell to find it.
   */
  keys: HTMLElement;
  /**
   * The mounted viewer's lifetime, passed straight to `CameraInput`: it is
   * carried in the callback bag rather than as a seventh positional argument
   * because that is the one thing every construction site already builds.
   */
  signal?: AbortSignal | undefined;
  /** Carried alongside `signal`, and for the same reason: every site builds it. */
  log?: Logger | undefined;
  /**
   * `options.interaction`. `'none'` means `CameraInput` is not
   * even constructed — the canvas gets `pointer-events: none` from
   * `app/viewer-stage.ts`, so there is nothing left for it to listen to.
   * `'passive'` still attaches one, told to listen passively. Default `'full'`.
   */
  interaction?: 'full' | 'none' | 'passive' | undefined;
  onManualInput: () => void;
  /**
   * A walk camera-step key (PageDown, PageUp, Home, End); `true` when a step
   * took it. Not manual input: the step is the walker's own request.
   */
  onCameraStep?: ((to: 'next' | 'previous' | 'first' | 'last') => boolean) | undefined;
  onSurfacePicked?: ((pick: SurfacePick | null, clientX: number, clientY: number) => void) | undefined;
  onFurniturePicked?: ((assetId: string | null) => void) | undefined;
  /** What the pointer is hovering. Absent means no hover raycast is done at all. */
  onHover?: ((pick: SurfacePick | null, clientX: number, clientY: number) => void) | undefined;
  /**
   * A plain wheel went to the page because the viewer is not engaged, in a
   * mode that would have acted on it: the caller shows «Ctrl + scroll to zoom».
   */
  onScrollThrough?: (() => void) | undefined;
};

export class CameraController {
  private readonly camera: THREE.PerspectiveCamera;
  private sceneData: SceneData;
  private plan: SolvedPlan;
  private readonly picker: Picker;
  private obstacles: Obstacle[];
  private readonly callbacks: InputCallbacks;
  /** `null` under `interaction: 'none'` — never attached to the canvas at all. */
  private readonly input: CameraInput | null;
  private readonly orbit: OrbitRig;
  private readonly walk: WalkRig;
  private mode: ViewerMode = 'orbit';
  /** The camera mode a plan mode interrupted; restored when it ends. */
  private modeBeforePlan: ViewerMode = 'orbit';
  /** What the camera is looking at, whichever rig last wrote it. */
  private target = new THREE.Vector3();
  private orbitStart: CameraPose;
  private furnitureCollisions = true;
  /** Whether a pointer is down on the canvas; a hover is a move without one. */
  private pointerDown = false;
  /** Pointer position waiting for its once-per-frame hover raycast. */
  private pendingHover: { x: number; y: number } | null = null;
  /** Where the pointer last was over the canvas; `null` once it leaves. */
  private hoverPoint: { x: number; y: number } | null = null;
  private lastHoverCastAt = -Infinity;
  /** Reduced motion: whether the NEXT scripted travel or fly-to is instant. */
  private motionInstant = false;
  /** `+`/`-` in walk: degrees added to the field of view; reset by a mode switch. */
  private walkFovOffset = 0;
  /**
   * The walk floor cursor. The stage adds `floorRing.object` to the render
   * scene; this controller decides where it stands and whether it shows.
   */
  readonly floorRing = new FloorRing();

  constructor(
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    sceneData: SceneData,
    plan: SolvedPlan,
    picker: Picker,
    callbacks: InputCallbacks,
  ) {
    this.camera = camera;
    this.sceneData = sceneData;
    this.plan = plan;
    this.picker = picker;
    this.callbacks = callbacks;
    this.obstacles = obstaclesFor(sceneData, this.assetFacts());
    this.orbit = new OrbitRig({ camera, picker, callbacks, fieldOfView: (heightM) => fieldOfViewFor(camera.aspect, heightM) });
    this.walk = new WalkRig({
      camera,
      picker,
      scene: () => this.sceneData,
      plan: () => this.plan,
      obstacles: () => this.obstacles,
      furnitureCollisions: () => this.furnitureCollisions,
      callbacks,
      log: callbacks.log,
    });
    this.orbitStart = this.pose(sceneData.presentationCamera);
    this.reset();
    this.input =
      callbacks.interaction === 'none'
        ? null
        : new CameraInput(
            {
              canvas,
              keys: callbacks.keys,
              signal: callbacks.signal,
              interaction: callbacks.interaction === 'passive' ? 'passive' : 'full',
            },
            this.onGesture,
          );
  }

  /** The document's bank (`InputCallbacks.assetFacts`), for every obstacle list derived from it. */
  assetFacts(): AssetFactsSource {
    return this.callbacks.assetFacts?.() ?? shippedAssetFacts;
  }

  getMode(): ViewerMode {
    return this.mode;
  }

  /**
   * Re-seeds the controller after a plan-level commit: everything derived from
   * the document is recomputed, and an in-flight walk is dropped, because a
   * route computed against the previous plan may now cross a wall that has no
   * doorway any more.
   */
  setScene(scene: SceneData, plan: SolvedPlan): void {
    this.plan = plan;
    this.refreshObstacles(scene);
    this.orbitStart = this.pose(scene.presentationCamera);
    this.walk.cancelTravel();
    this.walk.clearDestination();
    if (this.mode === 'walk') this.walk.clampToPlan(scene.ceilingHeight);
  }

  /**
   * Re-derives the walk obstacles from `scene` alone, for a commit that changed
   * furniture without touching the plan: a variant swap can change an object's
   * real size, and the collision system would otherwise keep colliding with a
   * footprint that is no longer there. A running travel ends here for the same
   * reason — its curve was proved clear against the obstacles just replaced —
   * and its `onDone` fires, so the director forgets where it was going.
   */
  refreshObstacles(scene: SceneData): void {
    this.sceneData = scene;
    this.obstacles = obstaclesFor(scene, this.assetFacts());
    this.walk.cancelTravel();
  }

  // The plan queries and the scripted curve belong to the walker, which owns
  // the clearance predicate and the door rules both of them are asked with.
  isNavigableAt(x: number, z: number): boolean {
    return this.walk.isNavigableAt(x, z);
  }
  canWalkTo(x: number, z: number): boolean {
    return this.walk.canWalkTo(x, z);
  }
  isTravelling(): boolean {
    return this.walk.isTravelling();
  }
  travelPathFor(points: ReadonlyArray<Vec3 & { door?: string | undefined }>): TravelPath | null {
    return this.walk.travelPathFor(points);
  }

  // Furniture collision is off while the furniture itself is hidden; a
  // scripted route respects whatever this says as much as the walker does.
  setFurnitureCollision(enabled: boolean): void {
    this.furnitureCollisions = enabled;
  }
  hasFurnitureCollision(): boolean {
    return this.furnitureCollisions;
  }

  /**
   * Reduced motion: whether the NEXT `flyTo` / `flyToRoom` / scripted walk
   * lands in one frame instead of animating. A flag PASSED IN by the
   * composition root, which resolves `prefers-reduced-motion` and the
   * `motion` mount option — this class reads no media query itself.
   */
  setMotionInstant(instant: boolean): void {
    this.motionInstant = instant;
    this.walk.setMotionInstant(instant);
  }

  setMode(mode: ViewerMode): void {
    // A plan mode freezes the 3D rig and takes no input at all.
    if (isPlanMode(mode)) {
      if (!isPlanMode(this.mode)) this.modeBeforePlan = this.mode;
      this.mode = mode;
      this.freezeInput();
      return;
    }
    if (mode === 'walk') this.walk.syncFromCamera();
    this.walkFovOffset = 0;
    this.orbit.clearKeys();
    this.floorRing.show(null);
    // Leaving a plan mode, the mode that matters is the one it interrupted:
    // the rig has not moved since.
    const previousMode = isPlanMode(this.mode) ? this.modeBeforePlan : this.mode;
    this.walk.cancelTravel();
    this.mode = mode;
    this.walk.clearDestination();
    this.walk.release();
    this.orbit.cancelTween();
    this.orbit.release();
    if (mode === 'walk' && !isNavigable(this.plan, this.camera.position)) this.walk.spawn();
    if (mode === 'orbit') {
      // Orbit around what the camera is currently looking at, not a stale target.
      if (previousMode !== 'orbit' && this.target.lengthSq() > 0) this.orbit.setTarget(this.target);
      this.orbit.syncFromCamera();
    }
  }

  /** Drops every in-flight gesture: entering a plan mode ends the interaction. */
  private freezeInput(): void {
    this.input?.reset();
    this.pointerDown = false;
    this.walk.freeze();
    this.orbit.cancelTween();
    this.orbit.release();
    this.orbit.clearKeys();
    this.clearHover();
  }

  /** Nothing is hovered, and the application is told so once. */
  private clearHover(): void {
    this.pendingHover = null;
    this.hoverPoint = null;
    this.floorRing.show(null);
    this.callbacks.onHover?.(null, 0, 0);
  }

  /** Back to the presentation pose, in 360 mode. */
  reset(): void {
    this.mode = 'orbit';
    this.orbit.reset(this.orbitStart.position, this.orbitStart.target);
  }

  getPose(): CameraPose {
    return { position: this.camera.position.clone(), target: this.targetFromCamera() };
  }

  debugFloorPoint(clientX: number, clientY: number): Vec3 | null {
    const point = this.floorPoint(clientX, clientY);
    return point ? { x: point.x, y: point.y, z: point.z } : null;
  }

  /**
   * Seeds the walk look from where the camera points now: the walk entry
   * glide and a camera step (`walk-stepper.ts`) hand the walk over here, so
   * the first drag turns from the view on screen. Changes no input state.
   */
  syncWalkLook(): void {
    this.walk.syncFromCamera();
  }

  setPose(position: THREE.Vector3, target: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    this.target.copy(target);
  }

  /**
   * Smoothly flies the orbit camera to a pose. Ends a scripted route first:
   * flying the camera away is the mode change that ends a route everywhere
   * else, and one left running under a tween would never fire its `onDone`.
   *
   * Under reduced motion (`motionInstant`) the camera JUMPS to the pose
   * in one call (`orbit.snapTo`) instead of tweening to it over `duration`.
   */
  flyTo(position: THREE.Vector3, target: THREE.Vector3, duration = ORBIT.flyDurationS): void {
    if (this.motionInstant) {
      this.snapOrbit(position, target);
      return;
    }
    this.walk.cancelTravel();
    this.mode = 'orbit';
    this.orbit.flyTo(position, target, duration);
  }

  /** `flyTo` landing at once whatever the motion setting: the orbit stands at the pose (within its radius and pitch limits). */
  snapOrbit(position: THREE.Vector3, target: THREE.Vector3): void {
    this.walk.cancelTravel();
    this.mode = 'orbit';
    this.orbit.snapTo(position, target);
  }

  /** Flies to a room's authored camera; `false` for a room that has none. */
  flyToRoom(roomId: string): boolean {
    const roomCamera = this.sceneData.roomCameras[roomId];
    if (!roomCamera) return false;
    const pose = this.pose(roomCamera);
    this.flyTo(pose.position, pose.target, ORBIT.roomFlyDurationS);
    return true;
  }

  /**
   * Travels the camera along `points` and answers whether it started. Walk mode
   * only: everywhere else the caller has other ways to move a camera, and a
   * scripted walk in orbit would fight the rig.
   */
  walkAlong(points: ReadonlyArray<Vec3 & { door?: string | undefined }>, onDone?: () => void): boolean {
    if (this.mode !== 'walk') return false;
    return this.walk.walkAlong(points, onDone);
  }

  /** Stops a running travel where it stands; its `onDone` fires (`TravelRig.cancel`). */
  cancelTravel(): void {
    this.walk.cancelTravel();
  }

  /** Ends a running travel on the spot, at the end of its curve (`TravelRig.finish`). */
  finishTravel(): boolean {
    if (!this.walk.finishTravel()) return false;
    this.applyWalkGaze();
    return true;
  }

  /** Points the camera where the walker is looking, and remembers it. */
  private applyWalkGaze(): void {
    const target = this.walk.lookTarget();
    this.camera.lookAt(target);
    this.target.copy(target);
  }

  update(delta: number): void {
    // A plan mode owns the picture; nothing here may move the camera under it.
    if (isPlanMode(this.mode)) return;
    if (this.mode === 'orbit') {
      this.orbit.update(delta);
      this.target.copy(this.orbit.target);
    }
    if (this.mode === 'walk') {
      this.walk.update(delta);
      this.applyWalkGaze();
    }
    this.updateFieldOfView();
    this.flushHover();
  }

  dispose(): void {
    this.input?.dispose();
    this.floorRing.dispose();
  }

  /**
   * The hover raycast: at most once per frame after a move, and a slow
   * heartbeat while the pointer rests. `pointermove` fires far more often than
   * the renderer draws, so the gesture only remembers where the pointer is and
   * the cast happens here, against the camera of the frame about to be drawn.
   * The heartbeat is what keeps a RESTING pointer hovering: one held still
   * over a door sends no events at all.
   */
  private flushHover(): void {
    const moved = this.pendingHover !== null;
    this.pendingHover = null;
    const point = this.hoverPoint;
    const walking = this.mode === 'walk';
    // The floor ring belongs to walk alone, and to a pointer that is only
    // hovering: while a drag is on, the pointer is looking, not choosing.
    if (!walking || this.pointerDown) this.floorRing.show(null);
    if (!point || this.pointerDown || (!this.callbacks.onHover && !walking)) return;
    const now = performance.now();
    if (!moved && now - this.lastHoverCastAt < HOVER.heartbeatMs) return;
    this.lastHoverCastAt = now;
    const pick = this.picker.pickSurface(point.x, point.y, this.camera);
    this.callbacks.onHover?.(pick, point.x, point.y);
    if (walking) {
      const floor = this.floorPoint(point.x, point.y);
      this.floorRing.show(floorRingPoint(pick, floor, (at) => this.walk.canWalkTo(at.x, at.z)));
    }
  }

  /** The field of view the camera's height, the viewport and `+`/`-` ask for, if it changed. */
  private updateFieldOfView(): void {
    const fov = this.fieldOfView();
    if (Math.abs(this.camera.fov - fov) < 1e-4) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** `fieldOfViewFor`, plus the walk's own `+`/`-` offset inside its clamp. */
  private fieldOfView(): number {
    const base = fieldOfViewFor(this.camera.aspect, this.camera.position.y);
    if (this.mode !== 'walk') return base;
    return THREE.MathUtils.clamp(base + this.walkFovOffset, WALK.fovMinDeg, WALK.fovMaxDeg);
  }

  /** `+` narrows the walk view (a closer look at a detail), `-` widens it. */
  private stepFieldOfView(direction: -1 | 1): void {
    const base = fieldOfViewFor(this.camera.aspect, this.camera.position.y);
    const wanted = THREE.MathUtils.clamp(this.fieldOfView() + direction * WALK.fovStepDeg, WALK.fovMinDeg, WALK.fovMaxDeg);
    this.walkFovOffset = wanted - base;
  }

  /**
   * One normalised gesture, routed to the mode that owns the camera. `true`
   * means the mode consumed it and the browser's own default — page scroll,
   * mostly — must not also happen.
   */
  private onGesture = (gesture: CameraGesture): boolean => {
    // Letting go of a key and losing focus are not input, they are the end of
    // input: a key held across a mode switch must not stay held for ever.
    if (gesture.type === 'blur') {
      this.walk.clearKeys();
      this.orbit.clearKeys();
      return false;
    }
    if (gesture.type === 'key' && !gesture.down) {
      this.walk.keyUp(gesture.code);
      this.orbit.keyUp(gesture.code);
      return false;
    }
    // A plan mode owns the picture: the rig is frozen and takes no input.
    if (isPlanMode(this.mode)) return false;
    switch (gesture.type) {
      case 'press':
        return this.onPress(gesture.move);
      case 'release':
        this.pointerDown = false;
        this.orbit.release();
        this.walk.release();
        return false;
      case 'drag':
        if (this.mode === 'orbit') this.orbit.drag(gesture.dx, gesture.dy, gesture.pointers, gesture.centroid);
        if (this.mode === 'walk') this.walk.drag(gesture.dx, gesture.dy, gesture.pointers, gesture.centroid);
        return false;
      case 'pinch':
        if (this.mode === 'orbit') this.orbit.pinch(gesture.scale, gesture);
        if (this.mode === 'walk') this.walk.pinch(gesture.scale);
        return false;
      case 'pan':
        // A sideways swipe (or a shift-wheel) moves the walker the way a MOVE
        // drag does: pointer pixels, the floor following the fingers.
        return this.onWheelGesture(
          () => this.orbit.pan(gesture.dx, gesture.dy),
          () => this.walk.step(gesture.dy * WALK.wheelPanMPerPx, -gesture.dx * WALK.wheelPanMPerPx),
        );
      case 'zoom':
        // Wheel forward (`dy < 0`) zooms in in 360 — toward the point under
        // the cursor — and steps forward on foot.
        return this.onWheelGesture(
          () => this.orbit.zoom(gesture.dy, gesture),
          () => this.walk.step(-THREE.MathUtils.clamp(gesture.dy / WALK.wheelNotchPx, -1, 1) * WALK.wheelStepM),
        );
      case 'scroll-through':
        if (this.mode === 'orbit' || this.mode === 'walk') this.callbacks.onScrollThrough?.();
        return false;
      case 'tap':
        // A tap means "what is this?" in 360 and "take me there" on foot.
        if (this.mode === 'orbit') this.orbit.tap(gesture.x, gesture.y);
        if (this.mode === 'walk') this.walk.tap(gesture.x, gesture.y, gesture.at);
        return false;
      case 'double-tap': {
        // 360 only: fly in on the floor point under the pointer.
        const point = this.mode === 'orbit' ? this.floorPoint(gesture.x, gesture.y) : null;
        if (point) this.orbit.focusAt(point);
        return false;
      }
      case 'hover':
        // Walk always tracks the pointer (the floor ring); 360 only for a host
        // that asked to be told what is hovered.
        if (this.mode === 'walk' || (this.callbacks.onHover && this.mode === 'orbit')) {
          this.pendingHover = { x: gesture.x, y: gesture.y };
          this.hoverPoint = this.pendingHover;
        }
        return false;
      case 'leave':
        this.clearHover();
        return false;
      case 'key':
        return this.onKeyDown(gesture.code);
    }
  };

  /**
   * A pointer went down: the user is taking the camera back from any script.
   * `move` (Space, Shift or the right button) makes the drag pan in 360 and
   * walk on foot instead of turning.
   */
  private onPress(move: boolean): boolean {
    this.pointerDown = true;
    this.floorRing.show(null);
    // Each rig latches what THIS press means to it, and the rigs that are not
    // driving latch nothing: a press that arrives in another mode must not
    // leave a look or a pan armed for the mode after next.
    if (this.mode === 'walk') this.walk.press(move);
    else this.walk.release();
    if (this.mode === 'orbit') this.orbit.press(move);
    else this.orbit.release();
    this.walk.cancelTravel();
    this.callbacks.onManualInput();
    return false;
  }

  /**
   * A wheel or trackpad gesture. It always ends a scripted route and always
   * counts as manual input; 360 acts on it with `inOrbit`, walk with
   * `onFoot`, and only then may the page scroll be suppressed. The tour and
   * the plan modes leave it to the page.
   *
   * The manual input is reported BEFORE the rig acts: a camera step in flight
   * stops on it and seeds the walk look from the view on screen, and a wheel
   * step taken before that would head along the look the walk had before.
   * The mode that owns the gesture is read first, so a tour the input pauses
   * still leaves the wheel to the page.
   */
  private onWheelGesture(inOrbit: () => void, onFoot: () => void): boolean {
    this.walk.cancelTravel();
    const act = this.mode === 'orbit' ? inOrbit : this.mode === 'walk' ? onFoot : null;
    this.callbacks.onManualInput();
    act?.();
    return act !== null;
  }

  /**
   * A key went down; `true` when a mode took it. Walk: WASD/arrows walk and
   * `+`/`-` change the field of view. 360: WASD/arrows pan the model.
   */
  private onKeyDown(code: string): boolean {
    if (this.mode === 'orbit') {
      if (!this.orbit.keyDown(code)) return false;
      this.callbacks.onManualInput();
      return true;
    }
    if (this.mode !== 'walk') return false;
    const step = STEP_KEYS.get(code);
    if (step) return this.callbacks.onCameraStep?.(step) ?? false;
    if (FOV_IN_KEYS.has(code) || FOV_OUT_KEYS.has(code)) {
      // A key like any other: it cancels a camera step in flight.
      this.callbacks.onManualInput();
      this.stepFieldOfView(FOV_IN_KEYS.has(code) ? -1 : 1);
      return true;
    }
    if (!this.walk.keyDown(code)) return false;
    this.walk.cancelTravel();
    this.callbacks.onManualInput();
    return true;
  }

  private floorPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    return navigableFloorPoint({ camera: this.camera, picker: this.picker, plan: () => this.plan }, clientX, clientY);
  }

  /**
   * What the camera is looking at right now, per mode. `tour` reads back the
   * target `setPose` last wrote rather than the walk look angles: those are
   * only seeded when walk mode starts, so in a session that never walked they
   * are `0/0` and would answer "4 m due south, level" for any camera — which
   * is how the tour's lead-in gaze ended up pointing at empty sky. A plan mode
   * has not moved the rig, so it answers for the mode it interrupted.
   */
  private targetFromCamera(): THREE.Vector3 {
    const mode = isPlanMode(this.mode) ? this.modeBeforePlan : this.mode;
    if (mode === 'orbit') return this.orbit.target.clone();
    if (mode === 'tour') return this.target.lengthSq() > 0 ? this.target.clone() : this.orbit.target.clone();
    return this.walk.lookTarget();
  }

  private pose(input: { position: Vec3; target: Vec3 }): CameraPose {
    return {
      position: new THREE.Vector3(input.position.x, input.position.y, input.position.z),
      target: new THREE.Vector3(input.target.x, input.target.y, input.target.z),
    };
  }
}
