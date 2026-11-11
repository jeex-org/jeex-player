/**
 * Room travel: how the camera gets to a room the visitor named (a mini-map
 * click, `handle.focusRoom`, the debug routes).
 *
 * In `orbit` and the plan modes the camera flies to the room's camera; in
 * `walk` (and `tour`, which hands over to walk first) the walker walks there
 * through the doors over the room graph (`navigation/room-graph.ts`), or jumps
 * in when no clear way exists. `CameraDirector` forwards its public room
 * methods here and supplies the narrow view below.
 *
 * Invariant: the room graph is cached per committed document (the plan and
 * scene objects it was built from) and rebuilt only when either changes;
 * `travellingTo` names the room a scripted walk is headed to, and is cleared
 * the moment that walk's route ends for any reason.
 */

import { buildRoomGraph, routeToRoom as planRouteToRoom, type RoomGraph, type RouteWaypoint } from '../navigation/room-graph.js';
import { obstaclesFor } from '../assets/asset-footprint.js';
import { roomJumpPose } from './room-jump.js';
import { pointInPolygon } from '../plan/plan-geometry.js';
import { isPlanMode, type SceneData, type Vec2, type ViewerMode } from '../scene/types.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { MessageKey } from '../shared/messages.js';
import type { CameraController } from './camera-controller.js';

/** What room travel reads and drives of the director. */
export type RoomTravelView = {
  controller: CameraController;
  /** The two chrome calls a travel makes (the director's `DirectorChrome`). */
  ui: { setModeButtons(mode: ViewerMode): void; wakeControls(): void };
  /** The CURRENT committed scene and solved plan. */
  scene: () => SceneData;
  plan: () => SolvedPlan;
  hint: (key: MessageKey, params?: Record<string, string | number>) => void;
  /** Stops a walk entry glide or a camera step where it stands. */
  cancelStep: () => void;
  /** Leaves a plan mode for the orbit picture (`applyPlanMode('orbit')`). */
  leavePlanMode: () => void;
  stopTour: () => void;
  /** The dollhouse shell, as every room focus shows it. */
  dollhouse: () => void;
  /** A running tour is paused and handed over to walk, with no camera-keys hint to follow. */
  walkFromTour: () => void;
};

export class RoomTravel {
  private readonly view: RoomTravelView;
  /** The room graph of the document it was built from; rebuilt when that changes. */
  private graph: { plan: SolvedPlan; scene: SceneData; value: RoomGraph } | null = null;
  /**
   * The room a scripted travel is currently headed to, `null` when none is
   * running. Set when `travelToRoom` starts a walk, cleared when that route's
   * `onDone` fires — arrival, cancellation or replacement all count. A second
   * `travelToRoom` call naming the SAME room while this is still set is the
   * "instant transfer" gesture; naming a different one replaces the route as
   * it always has.
   */
  private travellingTo: string | null = null;

  constructor(view: RoomTravelView) {
    this.view = view;
  }

  /**
   * Fly the orbit camera into a room and put its name in the hint. `false` when
   * the scene has no camera for that room, so callers (and the debug API) can
   * report the miss instead of claiming success.
   */
  focusRoom(roomId: string): boolean {
    const { view } = this;
    view.cancelStep();
    view.leavePlanMode();
    if (!view.controller.flyToRoom(roomId)) return false;
    view.stopTour();
    view.dollhouse();
    view.ui.setModeButtons('orbit');
    const roomName = view.scene().rooms.find((room) => room.id === roomId)?.name ?? roomId;
    view.hint('hint.room', { name: roomName });
    view.ui.wakeControls();
    return true;
  }

  /**
   * Waypoints from where the camera stands to the centre of `roomId`, over the
   * doors of the flat (`room-graph.ts`). `null` when nothing gets there — no
   * such room, or every way through is blocked.
   *
   * The graph is cached per document: a mini-map hover must not rebuild it, and
   * a plan-level commit hands out new objects, which is exactly the signal to.
   */
  routeToRoom(roomId: string): RouteWaypoint[] | null {
    const { controller } = this.view;
    const scene = this.view.scene();
    const plan = this.view.plan();
    if (!scene.rooms.some((room) => room.id === roomId)) return null;
    if (!this.graph || this.graph.plan !== plan || this.graph.scene !== scene) {
      this.graph = { plan, scene, value: buildRoomGraph(plan, scene, obstaclesFor(scene, controller.assetFacts())) };
    }
    const from = controller.getPose().position;
    // Hidden furniture is not collided with, so it must not route around either.
    const obstacles = controller.hasFurnitureCollision() ? obstaclesFor(scene, controller.assetFacts()) : [];
    return planRouteToRoom(this.graph.value, plan, { x: from.x, z: from.z }, roomId, obstacles);
  }

  /**
   * The CURVE a travel to `roomId` would follow from where the camera stands —
   * the route smoothed the way `walkAlong` smooths it (`travel-path.ts`) — with
   * its length in metres. `null` when no route gets there.
   *
   * A pure query, for the debug surface and the browser check: it inspects the
   * track without moving anything.
   */
  travelPath(roomId: string): { length: number; points: Vec2[] } | null {
    const route = this.routeToRoom(roomId);
    if (!route) return null;
    const path = this.view.controller.travelPathFor(route.map((point) => ({ x: point.x, y: 0, z: point.z, door: point.door })));
    return path ? { length: path.length, points: path.points.map((point) => ({ x: point.x, z: point.z })) } : null;
  }

  /**
   * Takes the viewer to a room the way the mode it is in allows.
   *
   * In `walk` the camera WALKS there through the doors; a tour is paused and
   * handed over to walk first, because a click on the mini-map is the user
   * taking the wheel. Every other mode has no walker to send, so the room is
   * flown to as a room focus. When no clear path exists the walker jumps into
   * the room (`roomStandingPoint`, facing the room camera's aim)
   * and stays in walk (`hint.arrivedInstantly`).
   *
   * A second call naming the SAME room while it is still the one being
   * travelled to is an "instant transfer": the walk ends on the spot
   * (`CameraController.finishTravel`) and the hint says a jump happened
   * instead of a walk. A call naming a different room replaces the route as
   * it always has — nothing here changes for that case.
   *
   * `false` only when the scene knows nothing about the room at all.
   */
  travelToRoom(roomId: string): boolean {
    const { view } = this;
    const { controller, ui } = view;
    // A mini-map click is the visitor taking the wheel: a step in flight stops first.
    view.cancelStep();
    if (isPlanMode(controller.getMode()) || controller.getMode() === 'orbit') return this.focusRoom(roomId);
    if (controller.getMode() === 'tour') view.walkFromTour();

    const room = view.scene().rooms.find((candidate) => candidate.id === roomId);
    if (!room) return false;
    const name = room.name;

    if (controller.isTravelling() && this.travellingTo === roomId) {
      controller.finishTravel();
      view.hint('hint.arrivedInstantly', { name });
      ui.wakeControls();
      return true;
    }

    // Clicking the room the walker already stands in: routing degenerates to a
    // zero-length route (start = goal), which would otherwise fall through to
    // the no-clear-path fly-in, the wrong story for "you are already
    // here". No route, no mode change — just say so.
    if (this.isInsideRoom(roomId)) {
      view.hint('hint.alreadyHere', { name });
      ui.wakeControls();
      return true;
    }

    const route = this.routeToRoom(roomId);
    if (
      route &&
      controller.walkAlong(
        route.map((point) => ({ x: point.x, y: 0, z: point.z, door: point.door })),
        () => {
          this.travellingTo = null;
        },
      )
    ) {
      this.travellingTo = roomId;
      view.hint('hint.travelling', { name });
      ui.wakeControls();
      return true;
    }
    // No clear way through the doors: the walker JUMPS into the room and stays
    // on foot. Flying to the room camera would drop the visitor into 360.
    controller.cancelTravel();
    const obstacles = controller.hasFurnitureCollision() ? obstaclesFor(view.scene(), controller.assetFacts()) : [];
    const jump = roomJumpPose(view.plan(), view.scene(), roomId, obstacles, controller.getPose());
    controller.setPose(jump.position, jump.target);
    controller.syncWalkLook();
    view.hint('hint.arrivedInstantly', { name });
    ui.wakeControls();
    return true;
  }

  /**
   * Whether the walker's current plan point already lies inside `roomId`'s
   * polygon — the "already here" case a mini-map click on the room the walker
   * stands in must not route or change mode for.
   */
  private isInsideRoom(roomId: string): boolean {
    const room = this.view.plan().rooms.find((candidate) => candidate.roomId === roomId);
    if (!room) return false;
    const position = this.view.controller.getPose().position;
    return pointInPolygon({ x: position.x, z: position.z }, room.polygon);
  }
}
