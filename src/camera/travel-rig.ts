/**
 * The scripted walk: a route of waypoints turned into ONE curve, and a camera
 * driven along it by arc length.
 *
 * A camera driven waypoint by waypoint slows to a stop at every corner and
 * changes pace between a short leg and a long one, and no amount of tuning the
 * per-leg rates hides it. So the route is turned once into a single
 * arc-length-parameterised curve (`travel-path.ts`) and a single scalar `s` is
 * advanced along it at `travel.speedMps`, easing only at the two ends. The
 * pose is SET from the curve, never approached: the curve was built from legs
 * the router had already proved clear, and re-testing it per frame would
 * wedge the camera on a door jamb.
 *
 * DOORS are the one exception, because they are the one thing on the route
 * that can change under it: a door shut through the HUD mid-route is wood the
 * curve knows nothing about. The step across a leaf that is in the doorway
 * right now is not taken — the walker WAITS at it — and the wait itself is
 * what gets the door open: `walk.doorPushS` of it re-arms a latch, and after
 * `travel.doorWaitS` of a door that still has not moved the route gives up and
 * says so.
 */

import * as THREE from 'three';
import { smoothstep } from '../shared/math.js';
import { CAMERA_TUNING } from './camera-tuning.js';
import { EYE_HEIGHT_M } from '../navigation/navigation.js';
import {
  buildTravelPath,
  cloneWaypoint,
  pointAt,
  tangentAt,
  type ClearTest,
  type TravelPath,
  type TravelWaypoint,
} from '../navigation/travel-path.js';
import type { DoorNegotiator } from './walk-doors.js';
import type { Vec3 } from '../scene/types.js';

const { travel: TRAVEL, walk: WALK } = CAMERA_TUNING;

/**
 * Share of the travel speed in force `s` metres into a path `length` long.
 *
 * One inside the whole middle — a scripted travel is meant to read as ONE
 * steady walk — and a smoothstep down to `travel.easeFloor` over the last and
 * first stretch, so the camera leans into the move and settles out of it
 * instead of snapping to a stop. The floor is what stops the eased end from
 * taking forever: at zero speed the camera would never reach the goal.
 */
export function travelEase(s: number, length: number): number {
  const ease = Math.min(TRAVEL.easeM, length * TRAVEL.easeSpan);
  if (ease <= 0) return 1;
  const ends = Math.min(smoothstep(s / ease), smoothstep((length - s) / ease));
  return TRAVEL.easeFloor + (1 - TRAVEL.easeFloor) * ends;
}

/**
 * The waypoints a scripted travel is built from: `start` (where the camera
 * stands) followed by `points`, with every waypoint that lands within
 * `travel.mergeM` of the one before it merged away.
 *
 * A DOOR-TAGGED waypoint is never the one dropped. It is what squares the
 * camera up to the opening, and `travel-path.ts` keeps the leg between a
 * tagged pair straight; merging one away let the wall be crossed on a corner
 * fillet's diagonal, close enough to clip the jamb. So the untagged neighbour
 * goes instead — `travel-path.merged` keeps the tagged side of a pair the same
 * way — unless that neighbour is `start` itself, which the curve has to begin
 * from: then both survive, however close together they are.
 */
export function mergeTravelRoute(start: TravelWaypoint, points: ReadonlyArray<Vec3 & { door?: string | undefined }>): TravelWaypoint[] {
  const route: TravelWaypoint[] = [start];
  for (const point of points) {
    const previous = route.at(-1)!;
    const waypoint = cloneWaypoint(point);
    if (Math.hypot(point.x - previous.x, point.z - previous.z) <= TRAVEL.mergeM) {
      if (waypoint.door === undefined) continue;
      if (route.length > 1) route.pop();
    }
    route.push(waypoint);
  }
  return route;
}

type TravelDeps = {
  camera: THREE.PerspectiveCamera;
  /** The walker's own clearance predicate, the one the router accepted legs with. */
  clear: ClearTest;
  /** The walker's look angles; a running travel steers them onto the curve. */
  look: { yaw: number; pitch: number };
  /** The walker's own door negotiation; both drivers face the same leaves. */
  doors: DoorNegotiator;
  /** The travel is over and the camera is free again (a tap destination is not). */
  onEnd: () => void;
  /** Nothing is going to open the door the route is standing at. */
  onDoorRefused: () => void;
  /**
   * Whether a NEW travel should skip the animated walk and jump straight to
   * its destination in one frame (reduced motion). A getter,
   * read once per `walkAlong` call, so a live `prefers-reduced-motion` change
   * mid-session is honoured by the NEXT travel without touching one already
   * running. Doors on the route still open and close in STATE the way they
   * always did; only the camera's own swing across the floor is skipped —
   * this rig never animated the leaf itself. Absent means "never instant".
   */
  instant?: (() => boolean) | undefined;
};

export class TravelRig {
  private readonly deps: TravelDeps;
  /**
   * The travel being driven, `null` when none is. `heldFor` is how long the
   * walker has been waiting at a door in the way, in seconds; it is zero on
   * every frame that moves.
   */
  private travel: { path: TravelPath; s: number; heldFor: number; onDone?: (() => void) | undefined } | null = null;

  constructor(deps: TravelDeps) {
    this.deps = deps;
  }

  /**
   * The curve a scripted travel along `points` would follow from where the
   * camera stands, or `null` when there is nothing to travel.
   *
   * Pure query — it moves nothing — so the debug surface can show the track
   * before anyone walks it (`__viewerDebug.travelPath`).
   */
  pathFor(points: ReadonlyArray<Vec3 & { door?: string | undefined }>): TravelPath | null {
    const { position } = this.deps.camera;
    const route = mergeTravelRoute({ x: position.x, z: position.z }, points);
    if (route.length < 2) return null;
    const path = buildTravelPath(route, this.deps.clear);
    return path.length > 0 ? path : null;
  }

  /**
   * Starts travelling along `points` and answers whether it started.
   *
   * `onDone` fires once when the travel ENDS, whether it arrived or was
   * cancelled by the user grabbing the camera. Starting a new one replaces the
   * old one and ends it the same way.
   *
   * Under reduced motion (`deps.instant`) the travel starts and ends in
   * the SAME call: one frame to the destination, `finish`'s own jump, rather
   * than a curve advanced over many frames — which is what "scripted travel
   * is instant" means for a walk that has no frames to be slow across.
   */
  walkAlong(points: ReadonlyArray<Vec3 & { door?: string | undefined }>, onDone?: () => void): boolean {
    const path = this.pathFor(points);
    this.cancel();
    if (!path) {
      onDone?.();
      return false;
    }
    this.travel = { path, s: 0, heldFor: 0, onDone };
    if (this.deps.instant?.() === true) this.finish();
    return true;
  }

  isTravelling(): boolean {
    return this.travel !== null;
  }

  /** Ends the travel, if there is one, and tells its owner. */
  cancel(): void {
    const travel = this.travel;
    if (!travel) return;
    this.travel = null;
    this.deps.onEnd();
    travel.onDone?.();
  }

  /**
   * Ends a running travel on the spot: one frame, no easing. The camera jumps
   * to the end of the curve — `pointAt(path.length)` at eye height, yaw the
   * heading of `tangentAt(path.length)`, pitch level — and the route ends
   * exactly the way an ordinary arrival does, `onDone` included. `false` when
   * nothing is travelling, and calling it again after that answers the same.
   *
   * This is the "instant transfer" a second mini-map click on the room already
   * being walked to asks for (`CameraDirector.travelToRoom`): the viewer
   * already committed to this destination, so a repeat click means "take me
   * there now", not "walk the same route again".
   */
  finish(): boolean {
    const travel = this.travel;
    if (!travel) return false;
    const { path } = travel;
    const point = pointAt(path, path.length);
    const tangent = tangentAt(path, path.length);
    this.deps.camera.position.set(point.x, EYE_HEIGHT_M, point.z);
    this.deps.look.yaw = Math.atan2(tangent.x, tangent.z);
    this.deps.look.pitch = 0;
    this.cancel();
    return true;
  }

  /**
   * One frame: the same step forward along the curve, the gaze eased onto the
   * tangent a little ahead of it.
   */
  advance(delta: number): void {
    const travel = this.travel;
    if (!travel) return;
    const { camera, look } = this.deps;
    const { path } = travel;
    const step = Math.min(delta, CAMERA_TUNING.maxFrameStepS);
    const next = Math.min(path.length, travel.s + TRAVEL.speedMps * travelEase(travel.s, path.length) * step);
    const ahead = pointAt(path, next);
    const { doors } = this.deps;
    const held = doors.inTheWay(doors.closed(), camera.position, { x: ahead.x, y: EYE_HEIGHT_M, z: ahead.z });
    if (held.length > 0) {
      travel.heldFor += step;
      const locked = doors.locked();
      if (travel.heldFor >= WALK.doorPushS) doors.rearm(held.filter((id) => locked.has(id)));
      if (travel.heldFor >= TRAVEL.doorWaitS) {
        // Nothing is going to open it: end the route the way any other
        // cancellation ends it, and explain the stop instead of leaving the
        // camera facing wood.
        this.cancel();
        this.deps.onDoorRefused();
        return;
      }
    } else {
      travel.heldFor = 0;
      travel.s = next;
      const point = pointAt(path, travel.s);
      camera.position.set(point.x, EYE_HEIGHT_M, point.z);
    }

    const tangent = tangentAt(path, Math.min(path.length, travel.s + TRAVEL.lookAheadM));
    let turn = Math.atan2(tangent.x, tangent.z) - look.yaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const ease = 1 - Math.exp(-step / TRAVEL.lookTauS);
    look.yaw += turn * ease;
    look.pitch += (0 - look.pitch) * ease;

    if (travel.s >= path.length - 1e-6) this.cancel();
  }
}
