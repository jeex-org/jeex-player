/**
 * Walk mode: a person at eye height inside the flat.
 *
 * Invariant: collisions and routing are decided by `navigation.ts` on the
 * CURRENT solved plan; this rig never inspects scene geometry — walkability
 * comes from the plan, picks come from the `Picker`.
 *
 * Every way the walker moves shares one collision rule (`tryMove`): the keys,
 * a tap that sets a destination to approach, a MOVE drag (Space, Shift or the
 * right button held at the press; two fingers on touch) and a pinch that move
 * it directly, the wheel that glides it a short step, and a scripted route
 * (`travel-rig.ts`), which lives inside this rig because it is
 * the same walker — it shares the look angles, the clearance predicate and the
 * door negotiation (`walk-doors.ts`). Any manual input ends the route: the
 * user asking for the camera always outranks the script.
 */

import { defaultLogger, type Logger } from '../shared/logger.js';
import * as THREE from 'three';
import { CAMERA_TUNING } from './camera-tuning.js';
import {
  EYE_HEIGHT_M,
  canTraverse,
  clampToNavigation,
  crossesClosedDoor,
  isInDoorway,
  isNavigable,
  pathBlockedByFurniture,
  resolveNavigationTarget,
  type Obstacle,
} from '../navigation/navigation.js';
import { walkSpawn } from '../navigation/room-graph.js';
import { DoorNegotiator, type DoorCallbacks } from './walk-doors.js';
import { TravelRig } from './travel-rig.js';
import { MOVE_KEYS, keyDirection } from './camera-input.js';
import type { Picker } from '../geometry/picker.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData, Vec2, Vec3 } from '../scene/types.js';
import type { TravelPath } from '../navigation/travel-path.js';

const { tap: TAP, walk: WALK } = CAMERA_TUNING;

// Module-level scratch vectors, so no per-frame or per-movement path
// allocates a fresh `new THREE.Vector3()`. None of them is ever returned to a caller — each is written with
// `.set`/`.copy` and read out before the next call reuses it.
/** Scratch: the WASD input direction, rebuilt every frame in `update()`. */
const SCRATCH_MOVE = new THREE.Vector3();
/** Scratch: `moveBy`'s floor-plane step, rebuilt on every drag move. */
const SCRATCH_STEP = new THREE.Vector3();
/** Scratch: the slice of a wheel glide `update()` takes this frame. */
const SCRATCH_GLIDE_STEP = new THREE.Vector3();
/** Scratch: `lookTarget()`'s gaze direction, derived from yaw/pitch every call. */
const SCRATCH_AHEAD = new THREE.Vector3();
/** Scratch: the destination-tap step `update()` feeds `tryMove` every frame while approaching one. */
const SCRATCH_DESTINATION_STEP = new THREE.Vector3();
/** Scratch: `tryMove`'s two axis-locked retries, tried when the full step is blocked. */
const SCRATCH_ATTEMPT_X = new THREE.Vector3();
const SCRATCH_ATTEMPT_Z = new THREE.Vector3();
/** Scratch: the candidate position `tryMove` tests each attempt against. */
const SCRATCH_NEXT = new THREE.Vector3();

/**
 * Shortest offset from the spawn to its target that still names a direction,
 * metres. A target ON the spawn — a scene whose entry point is its room centre
 * — says nothing about which way to face, and `atan2(0, 0)` would answer "due
 * north" as if it did.
 */
const SPAWN_LOOK_MIN_M = 0.25;

/** What the walk rig tells the application; a subset of the controller's own. */
export type WalkCallbacks = DoorCallbacks & {
  /**
   * A tap that landed on an opening. `true` means the application consumed it
   * (the door HUD), so the tap must not also start a walk.
   */
  onOpeningTapped?: ((openingId: string) => boolean) | undefined;
};

type WalkDeps = {
  camera: THREE.PerspectiveCamera;
  picker: Picker;
  /** The committed document and its solution, re-read on every plan commit. */
  scene: () => SceneData;
  plan: () => SolvedPlan;
  /** Furniture footprints, re-derived whenever an object changes size. */
  obstacles: () => Obstacle[];
  /** Whether furniture blocks the walker right now (off while it is hidden). */
  furnitureCollisions: () => boolean;
  callbacks: WalkCallbacks;
  /** Where a derived spawn is reported; the host's `onLog`, else the console. */
  log?: Logger | undefined;
};

/**
 * Raycasts the pointer onto a navigable floor: the shared half of a walk tap,
 * a 360 double click and the debug hook, none of which want the door rules.
 */
export function navigableFloorPoint(
  deps: Pick<WalkDeps, 'camera' | 'picker' | 'plan'>,
  clientX: number,
  clientY: number,
): THREE.Vector3 | null {
  const point = deps.picker.floorPoint(clientX, clientY, deps.camera);
  return point && isNavigable(deps.plan(), point) ? point : null;
}

export class WalkRig {
  private readonly deps: WalkDeps;
  /** Where the walker is looking. The travel rig steers the same object. */
  readonly look = { yaw: 0, pitch: 0 };
  private readonly doors: DoorNegotiator;
  private readonly travel: TravelRig;
  private readonly keys = new Set<string>();
  /**
   * Where a tap is taking the walker, and the exponential approach rate the
   * walk uses to get there.
   */
  private destination: { point: THREE.Vector3; rate: number } | null = null;
  /**
   * How long the walker has been pushing at a LATCHED door under manual
   * control, seconds. Cumulative — leaning on a door in short bursts is still
   * leaning on it — and cleared by any step that gets somewhere.
   */
  private doorPushFor = 0;
  /** The press in progress turns the head. */
  private looking = false;
  /** The press in progress MOVES the walker (Space/Shift/right button). */
  private moving = false;
  /**
   * What is left of the wheel's steps, world metres on the floor plane,
   * eased off a slice per frame. `null` when nothing is gliding.
   */
  private glide: THREE.Vector3 | null = null;
  private lastTapAt = 0;
  private lastTapPoint: THREE.Vector3 | null = null;
  /** Scene id whose missing `walkSpawn` has already been reported. */
  private warnedSpawnFor: string | null = null;
  /** Reduced motion: whether the NEXT scripted travel should be instant. */
  private motionInstant = false;

  constructor(deps: WalkDeps) {
    this.deps = deps;
    this.doors = new DoorNegotiator({
      plan: deps.plan,
      callbacks: deps.callbacks,
      suspended: () => this.travel.isTravelling(),
    });
    this.travel = new TravelRig({
      camera: deps.camera,
      clear: (a, b) => this.clear(a, b),
      look: this.look,
      doors: this.doors,
      onEnd: () => {
        this.destination = null;
      },
      onDoorRefused: () => {
        this.refuseDoor(true);
      },
      instant: () => this.motionInstant,
    });
  }

  /**
   * Reduced motion: whether a scripted travel should skip its animation. Read
   * live by the NEXT `walkAlong`, never by one already running.
   */
  setMotionInstant(value: boolean): void {
    this.motionInstant = value;
  }

  // ---------------------------------------------------------------- queries

  /**
   * Whether walk mode could stand at `(x, z)` on the CURRENT plan — inside a
   * room with clearance, or inside a doorway slab.
   */
  isNavigableAt(x: number, z: number): boolean {
    const point = { x, y: EYE_HEIGHT_M, z };
    const plan = this.deps.plan();
    return isNavigable(plan, point) || isInDoorway(plan, point);
  }

  /**
   * Whether a straight walk from the camera to `(x, z)` is possible right now.
   * A door that opens as the walker arrives is not an obstacle here: only a
   * LOCKED one closes the way, because only that one is still shut when the
   * walker gets there.
   */
  canWalkTo(x: number, z: number): boolean {
    const target = { x, y: EYE_HEIGHT_M, z };
    const { position } = this.deps.camera;
    if (crossesClosedDoor(this.deps.plan(), this.doors.locked(), position, target)) return false;
    if (!canTraverse(this.deps.plan(), position, target)) return false;
    return !this.deps.furnitureCollisions() || !pathBlockedByFurniture(this.deps.obstacles(), position, target);
  }

  /** Whether a straight step between two plan points is walkable; the router's own test. */
  private clear(a: Vec2, b: Vec2): boolean {
    const at = (point: Vec2): Vec3 => ({ x: point.x, y: EYE_HEIGHT_M, z: point.z });
    return (
      canTraverse(this.deps.plan(), at(a), at(b)) &&
      (!this.deps.furnitureCollisions() || !pathBlockedByFurniture(this.deps.obstacles(), at(a), at(b)))
    );
  }

  /** What the walker is looking at: `walk.gazeDistanceM` ahead of the eye. */
  lookTarget(): THREE.Vector3 {
    const { yaw, pitch } = this.look;
    SCRATCH_AHEAD.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // The RETURN value is a fresh clone the caller owns; only the intermediate
    // direction above is scratch.
    return this.deps.camera.position.clone().addScaledVector(SCRATCH_AHEAD, WALK.gazeDistanceM);
  }

  // ------------------------------------------------------------ transitions

  /** Seeds the look angles from wherever the camera is pointing right now. */
  syncFromCamera(): void {
    const direction = new THREE.Vector3();
    this.deps.camera.getWorldDirection(direction);
    this.look.pitch = Math.asin(direction.y);
    this.look.yaw = Math.atan2(direction.x, direction.z);
  }

  /**
   * Stands the walker at the flat's entry pose (`room-graph.walkSpawn`),
   * because the camera is somewhere walk mode cannot stand (the dollhouse
   * overview, usually). A pose nobody authored is reported once, naming the
   * scene: it was read off the plan, and the scene should say.
   */
  spawn(): void {
    const scene = this.deps.scene();
    const spawn = walkSpawn(this.deps.plan(), scene, this.deps.obstacles());
    if ((spawn === null || spawn.derived) && this.warnedSpawnFor !== scene.id) {
      this.warnedSpawnFor = scene.id;
      (this.deps.log ?? defaultLogger).warn(
        'walkspawn-derived',
        spawn === null
          ? `camera: scene "${scene.id}" authors no walkSpawn and no navigation points; walk mode has nowhere to enter from`
          : `camera: scene "${scene.id}" authors no walkSpawn; walk mode enters from the plan`,
        { sceneId: scene.id, derived: spawn !== null },
      );
    }
    if (!spawn) return;
    this.deps.camera.position.set(spawn.position.x, EYE_HEIGHT_M, spawn.position.z);
    // A pose is a place AND a heading, and only the place is always knowable:
    // keep the heading the camera arrived with when the target cannot name one.
    const dx = spawn.target.x - spawn.position.x;
    const dz = spawn.target.z - spawn.position.z;
    if (Math.hypot(dx, dz) >= SPAWN_LOOK_MIN_M) this.look.yaw = Math.atan2(dx, dz);
    this.look.pitch = 0;
  }

  /**
   * Fits the eye back into the room volume after a plan-level commit. The
   * clamp's own answer is kept: overwriting it with the fixed `EYE_HEIGHT_M`
   * put the camera back through a low ceiling it had just been rescued from.
   */
  clampToPlan(ceilingHeight: number): void {
    const { position } = this.deps.camera;
    const clamped = clampToNavigation(this.deps.plan(), ceilingHeight, { x: position.x, y: position.y, z: position.z });
    position.set(clamped.x, clamped.y, clamped.z);
  }

  /** Forgets where a tap or the wheel was taking the walker; the route is ended separately. */
  clearDestination(): void {
    this.destination = null;
    this.glide = null;
  }

  /** Entering a plan mode: every in-flight walk gesture is over. */
  freeze(): void {
    this.keys.clear();
    this.cancelTravel();
    this.destination = null;
    this.glide = null;
    this.looking = false;
    this.moving = false;
    this.doorPushFor = 0;
  }

  // The scripted route is the same walker on a curve (`travel-rig.ts`).
  travelPathFor(points: ReadonlyArray<Vec3 & { door?: string | undefined }>): TravelPath | null {
    return this.travel.pathFor(points);
  }
  walkAlong(points: ReadonlyArray<Vec3 & { door?: string | undefined }>, onDone?: () => void): boolean {
    return this.travel.walkAlong(points, onDone);
  }
  isTravelling(): boolean {
    return this.travel.isTravelling();
  }
  cancelTravel(): void {
    this.travel.cancel();
  }
  finishTravel(): boolean {
    return this.travel.finish();
  }

  /**
   * A pointer is down, and while it is, a drag turns the head — or, when the
   * press carried the move modifier, walks. Latched here, at the press: a
   * Space let go mid-drag must not turn a walk into a look.
   */
  press(move = false): void {
    this.looking = !move;
    this.moving = move;
    // Taking the walker by hand ends where a tap or the wheel was taking it.
    if (move) this.clearDestination();
  }
  release(): void {
    this.looking = false;
    this.moving = false;
  }

  /**
   * One pointer's travel (`pointers` down, `centroid` of a two-finger pair).
   *
   * A look follows the Street View / touch-panorama convention: the
   * picture follows the pointer on both axes, the same rule 360 mode uses.
   * Measured with `__viewerDebug.projectPoint` on a point ahead at eye height:
   * `+dx` (drag right) must slide that point right on screen, and `+dy` (drag
   * down) must slide it down. `+=` on both does that; `-=` (the
   * first-person mouse-look convention) would move the picture against the
   * pointer.
   *
   * A MOVE drag and a two-finger drag walk instead (`moveByPointer`): one
   * finger looks, two fingers move, exactly as 360 rotates with one and pans
   * with two.
   */
  drag(dx: number, dy: number, pointers = 1, centroid: { dx: number; dy: number } | null = null): void {
    if (!this.looking && !this.moving) return;
    if (pointers >= 2) {
      if (centroid) this.moveByPointer(centroid.dx, centroid.dy);
      return;
    }
    if (this.moving) {
      this.moveByPointer(dx, dy);
      return;
    }
    this.look.yaw += dx * WALK.lookRadPerPx;
    this.look.pitch = THREE.MathUtils.clamp(this.look.pitch + dy * WALK.pitchRadPerPx, WALK.pitchMin, WALK.pitchMax);
  }

  /**
   * A drag that walks, in POINTER pixels (`+dy` down the screen). The floor
   * follows the pointer like everything else (the input-direction rule): pull
   * it down towards you and you go FORWARD — a point on the
   * floor ahead slides down the screen as you approach it — and drag it right
   * and you step LEFT, so the floor ahead slides right. Verified by projection
   * in `walk-rig.test.ts`.
   */
  moveByPointer(dx: number, dy: number): void {
    this.moveBy(dy * WALK.dragMoveMPerPx, -dx * WALK.dragMoveMPerPx);
  }

  /**
   * Moves the walker `forwardM` along the view on the floor and `rightM`
   * towards screen-right, at once, through the one collision rule. No glide
   * and no inertia: a hand on the floor moves exactly as far as the hand.
   */
  moveBy(forwardM: number, rightM: number): void {
    const step = this.floorStep(forwardM, rightM, SCRATCH_STEP);
    if (step.lengthSq() > 0) this.tryMove(step, 0);
  }

  /**
   * The wheel: `forwardM` along the view (and `rightM` sideways, for a
   * sideways trackpad swipe), GLIDED over a few frames so a notch reads as a
   * short step rather than a jump. Steps add up, so a fast wheel keeps
   * walking. Under reduced motion the whole step lands at once. A wall ends
   * the glide where it stands (`update`).
   */
  step(forwardM: number, rightM = 0): void {
    this.destination = null;
    const step = this.floorStep(forwardM, rightM, new THREE.Vector3());
    if (this.motionInstant) {
      this.glide = null;
      this.tryMove(step, 0);
      return;
    }
    this.glide = this.glide ? this.glide.add(step) : step;
  }

  /**
   * Two fingers changing their separation (`scale` < 1: apart). Apart walks
   * forward, together walks back — the pinch that zooms in 360 — on a log
   * scale, so the same spread moves the same distance at any finger span.
   */
  pinch(scale: number): void {
    if (!(scale > 0)) return;
    this.moveBy(-Math.log(scale) * WALK.pinchMPerLog, 0);
  }

  /** `forwardM`/`rightM` in the walker's frame, as a world step on the floor. */
  private floorStep(forwardM: number, rightM: number, out: THREE.Vector3): THREE.Vector3 {
    const { yaw } = this.look;
    // Forward is the gaze on the floor (`lookTarget`); right is
    // cross(forward, up), the camera's own screen-right.
    return out.set(Math.sin(yaw) * forwardM - Math.cos(yaw) * rightM, 0, Math.cos(yaw) * forwardM + Math.sin(yaw) * rightM);
  }

  /**
   * A key went down. `true` means the walker took it, and the page must not
   * also scroll. `shift` is held, not taken: it only says how fast.
   */
  keyDown(code: string): boolean {
    if (code === 'shift') {
      this.keys.add('shift');
      return false;
    }
    if (!MOVE_KEYS.has(code)) return false;
    this.keys.add(code);
    this.glide = null;
    return true;
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }
  clearKeys(): void {
    this.keys.clear();
  }

  /**
   * A tap: walk to where it landed, or open the door it landed on. `at` is
   * when the tap happened, so two taps in the same place inside
   * `tap.doubleWindowMs` read as "get there quicker".
   */
  tap(clientX: number, clientY: number, at: number): void {
    const { camera, picker, callbacks } = this.deps;
    this.cancelTravel();
    // A tap on a door leaf is an offer to open it, not a request to walk into
    // it. Only the leaf and the frame band are pickable, so a tap THROUGH an
    // open doorway still lands on the floor behind it.
    if (callbacks.onOpeningTapped) {
      const pick = picker.pickSurface(clientX, clientY, camera);
      if (pick?.surface === 'opening' && pick.openingId && callbacks.onOpeningTapped(pick.openingId)) return;
    }
    const floorPoint = this.walkableFloorPoint(clientX, clientY);
    if (!floorPoint) return;
    const obstacles = this.deps.obstacles();
    const collides = this.deps.furnitureCollisions();
    const target = collides
      ? resolveNavigationTarget(this.deps.plan(), this.deps.scene(), new THREE.Vector3(floorPoint.x, EYE_HEIGHT_M, floorPoint.z), obstacles)
      : new THREE.Vector3(floorPoint.x, EYE_HEIGHT_M, floorPoint.z);
    if (collides && pathBlockedByFurniture(obstacles, camera.position, target)) {
      callbacks.onHint('hint.noClearPath');
      return;
    }
    const isDouble = this.lastTapPoint
      ? at - this.lastTapAt < TAP.doubleWindowMs && this.lastTapPoint.distanceTo(floorPoint) < TAP.doubleRadiusM
      : false;
    this.destination = { point: new THREE.Vector3(target.x, target.y, target.z), rate: isDouble ? TAP.doubleRate : TAP.singleRate };
    this.glide = null;
    this.lastTapAt = at;
    this.lastTapPoint = floorPoint;
    // Reduced motion: the walker is THERE, not on its way. A door still
    // swinging open stops the cut short; the
    // destination then survives and the walker finishes on foot.
    if (this.motionInstant) {
      this.tryMove(this.destination.point.clone().sub(camera.position), 0);
      if (camera.position.distanceTo(this.destination.point) < WALK.arriveM) this.destination = null;
    }
  }

  /**
   * The floor point a tap may walk to: navigable, reachable, and not behind a
   * door that is going to stay shut.
   */
  private walkableFloorPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const point = navigableFloorPoint(this.deps, clientX, clientY);
    if (!point) return null;
    // A tap on the far side of a door the user latched is the user saying they
    // want through it after all: that takes the latch off and the tap is
    // accepted. Only a viewer with no latch to release refuses and says so.
    const latched = this.doors.inTheWay(this.doors.locked(), this.deps.camera.position, point);
    if (latched.length > 0 && !this.doors.rearm(latched)) {
      this.refuseDoor(true);
      return null;
    }
    if (!canTraverse(this.deps.plan(), this.deps.camera.position, point)) {
      this.deps.callbacks.onHint('hint.routeClosed');
      return null;
    }
    return point;
  }

  // -------------------------------------------------------------- the frame

  update(delta: number): void {
    const { forward, right } = keyDirection(this.keys);
    const speed = this.keys.has('shift') ? WALK.runSpeedMps : WALK.speedMps;
    if (forward !== 0 || right !== 0) {
      const direction = this.floorStep(forward, right, SCRATCH_MOVE).normalize();
      this.tryMove(direction.multiplyScalar(delta * speed), delta);
    }
    this.advanceGlide(delta);
    if (this.destination) {
      const { point, rate } = this.destination;
      if (this.deps.camera.position.distanceTo(point) < WALK.arriveM) {
        this.destination = null;
      } else {
        this.tryMove(
          SCRATCH_DESTINATION_STEP.copy(point)
            .sub(this.deps.camera.position)
            .multiplyScalar(Math.min(1, delta * rate)),
          delta,
        );
      }
    }
    this.travel.advance(delta);
  }

  /**
   * One frame of the wheel's glide: an exponential slice of what is left,
   * like the tap approach. A slice that got nowhere (a wall, a shut door)
   * ends the glide, so a step into a wall is not retried forever.
   */
  private advanceGlide(delta: number): void {
    const glide = this.glide;
    if (!glide) return;
    const slice = SCRATCH_GLIDE_STEP.copy(glide).multiplyScalar(Math.min(1, delta * WALK.wheelGlideRate));
    const { position } = this.deps.camera;
    const beforeX = position.x;
    const beforeZ = position.z;
    this.tryMove(slice, delta);
    const moved = Math.hypot(position.x - beforeX, position.z - beforeZ);
    glide.sub(slice);
    if (moved < 1e-6 || glide.length() < WALK.arriveM) this.glide = null;
  }

  /**
   * Moves with wall, door and furniture collision, sliding along blocked axes.
   * `seconds` is the frame's own delta: pushing at a latched door is measured
   * in time, not in frames.
   */
  private tryMove(delta: THREE.Vector3, seconds: number): void {
    const { camera } = this.deps;
    const plan = this.deps.plan();
    const obstacles = this.deps.obstacles();
    const attempts = [delta, SCRATCH_ATTEMPT_X.set(delta.x, 0, 0), SCRATCH_ATTEMPT_Z.set(0, 0, delta.z)];
    const closed = this.doors.closed();
    let doorBlocked: string[] = [];
    for (const attempt of attempts) {
      if (attempt.lengthSq() < 1e-8) continue;
      const next = SCRATCH_NEXT.copy(camera.position).add(attempt);
      next.y = EYE_HEIGHT_M;
      const furnitureBlocked = this.deps.furnitureCollisions() && pathBlockedByFurniture(obstacles, camera.position, next);
      if (crossesClosedDoor(plan, closed, camera.position, next)) {
        // A leaf that is on its way open is a wait, not a wall: the walker
        // stands at it for the fraction of a second the swing needs and the
        // destination it was given survives.
        if (doorBlocked.length === 0) doorBlocked = this.doors.inTheWay(this.doors.locked(), camera.position, next);
        continue;
      }
      if (canTraverse(plan, camera.position, next) && !furnitureBlocked) {
        const clamped = clampToNavigation(plan, this.deps.scene().ceilingHeight, next);
        camera.position.set(clamped.x, EYE_HEIGHT_M, clamped.z);
        this.doorPushFor = 0;
        return;
      }
    }
    if (doorBlocked.length === 0) {
      this.doorPushFor = 0;
      return;
    }
    // Leaning on a door you shut yourself is how you take the latch off it
    // (`DoorStates.rearm`): the release radius is a pose a small room may not
    // contain, so INTENT is the other way out. Nothing is said until the push
    // is long enough to be intent — with the automation on the door is about
    // to open, and announcing a refusal it is about to reverse would be a lie.
    this.doorPushFor += seconds;
    if (!this.doors.automated) {
      // Walking into a shut door explains itself once, not sixty times a second.
      this.refuseDoor();
      return;
    }
    if (this.doorPushFor < WALK.doorPushS) return;
    this.doorPushFor = 0;
    if (!this.doors.rearm(doorBlocked)) this.refuseDoor();
  }

  /** Says the door is shut, and gives up on walking through it. */
  private refuseDoor(force = false): void {
    if (this.doors.refuse(force)) this.destination = null;
  }
}
