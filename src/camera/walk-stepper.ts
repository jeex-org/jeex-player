/**
 * Walk is the user-driven tour: entering `walk` on a document with a
 * checkpoint route glides in about
 * one second to camera 1's exact pose and STOPS there; from then on the person
 * walks, and steps between the tour cameras on demand — PageDown/PageUp,
 * Home/End, the Previous/Next buttons, a camera dot on the mini-map.
 *
 * A step walks from where the walker stands to the target camera through the
 * plan's openings, exactly as the tour joins two cameras (`tourRouteOf` over
 * the pair «here, there»), at the tour's walking speed with the half-second
 * ramps of a checkpoint run (`track-ease.ts`), and stops ON the camera's pose
 * — position, yaw and pitch. A
 * walker already within `NEAR_M` of the camera glides there instead, with
 * the entry's own one-second glide (`pose-glide.ts`). Any
 * manual input cancels the step where it stands (`cancel`).
 *
 * The CURRENT camera is the last one the walker stood on or stepped to, kept
 * by id so a reorder in the host does not move it; a cancelled step leaves it
 * where it was, so «next» after a cancelled step aims at the same camera
 * again. With no current camera, both «next» and «previous» go to camera 1.
 *
 * The step rides its own `TourPlayer`, never the tour's: the tour's clip,
 * state and public events are untouched by a walk.
 */

import * as THREE from 'three';
import { TourPlayer, type TourPose } from './tour-player.js';
import { aimOf, glideStep, glideTo, type Glide } from './pose-glide.js';
import { vec3 as vector } from './tour-path.js';
import { hasTourRoute, tourRouteOf } from '../scene/tour-route.js';
import { tourNavigation } from '../navigation/tour-legs.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData, TourCheckpoint } from '../scene/types.js';

/** Where a step goes: a neighbour of the current camera, an end of the list, or a 0-based index. */
export type StepTarget = 'next' | 'previous' | 'first' | 'last' | number;

/** The walk's camera index: the current camera (0-based, `null` when none) and how many there are. */
export type WalkCamera = { readonly index: number | null; readonly count: number };

/** A walker this close to the target camera glides to it rather than walking a leg, metres. */
const NEAR_M = 0.4;
/** A step this close to the end of its leg has landed, metres. */
const ARRIVED_M = 1e-6;
/** A walker standing this close to a camera's position stands ON it (`standAt`), metres. */
const ON_CAMERA_M = 0.01;
/**
 * Id of the route's first stop, the walker's own pose. A transient stop, never
 * stored, emitted or validated (`tourRouteOf` reads positions and looks only),
 * so it is a fixed label rather than an id composed from the target's.
 */
const WALKER_STOP_ID = 'walker';

type WalkStepperDeps = {
  scene: () => SceneData;
  plan: () => SolvedPlan;
  /** The camera's own pose right now (its place and real look); a step starts from it. */
  pose: () => TourPose;
  setPose: (position: THREE.Vector3, target: THREE.Vector3) => void;
  /** The walk rig adopts the camera's look, so the first drag turns from what is on screen. */
  syncWalkLook: () => void;
  /** The current camera or the camera count changed. */
  onCamera?: ((camera: WalkCamera) => void) | undefined;
};

export class WalkStepper {
  private readonly deps: WalkStepperDeps;
  private readonly player: TourPlayer;
  /** The camera the walker last stood on or stepped to. */
  private currentId: string | null = null;
  /** The camera the step (or the entry glide) in flight goes to; `null` when nothing moves. */
  private targetId: string | null = null;
  private instant = false;
  /** The entry glide, or the glide of a walker already near the camera; `null` while the player rides a leg. */
  private glide: Glide | null = null;
  /** What `onCamera` last said, so a frame that changed nothing says nothing. */
  private reported: WalkCamera = { index: null, count: 0 };

  constructor(deps: WalkStepperDeps) {
    this.deps = deps;
    this.player = new TourPlayer(deps.scene(), (position, target) => deps.setPose(position, target), {
      onState: () => undefined,
      onProgress: () => undefined,
    });
    this.reported = this.camera();
  }

  /** Reduced motion: an entry or a step lands in one frame. */
  setMotionInstant(instant: boolean): void {
    this.instant = instant;
    this.player.setMotionInstant(instant);
  }

  /** Whether an entry glide or a step is moving the camera right now. */
  isMoving(): boolean {
    return this.targetId !== null;
  }

  /** The current camera and the count, as the chrome and `getState().walk` read them. */
  camera(): WalkCamera {
    const cameras = this.cameras();
    const index = this.currentId === null ? -1 : cameras.findIndex((camera) => camera.id === this.currentId);
    return { index: index < 0 ? null : index, count: cameras.length };
  }

  /**
   * The walk entry: glides from `from` to camera 1 and stops there. `false`
   * (nothing started) on a document without a checkpoint route, which keeps
   * its own entry.
   */
  enter(from: TourPose): boolean {
    const scene = this.deps.scene();
    const first = this.cameras()[0];
    if (!hasTourRoute(scene) || !first) return false;
    this.player.stop();
    // The camera stands on the view it glides from at once (`CameraDirector.engageTour`).
    this.deps.setPose(from.position, from.target);
    this.glideOnto(first, from);
    return true;
  }

  /** Starts a step to `to`; `false` when there is no such camera (an end of the list, an index out of range). */
  step(to: StepTarget): boolean {
    const cameras = this.cameras();
    const index = this.resolve(to, cameras.length);
    const target = index === null ? undefined : cameras[index];
    if (!target) return false;
    // An auto-repeating key asks for the same camera again: the step goes on.
    if (this.targetId === target.id) return true;
    this.player.stop();
    this.glide = null;
    const from = this.deps.pose();
    const scene = this.deps.scene();
    if (from.position.distanceTo(vector(target.position)) > NEAR_M) {
      // The pair «here, there» as a two-camera route: the same legs through
      // the openings the tour rides, starting on the walker's own look.
      const here: TourCheckpoint = { id: WALKER_STOP_ID, position: vec(from.position), ...lookOf(from) };
      this.player.setRoute(
        tourRouteOf({ autotour: scene.autotour, tourCheckpoints: [here, target] }, tourNavigation(this.deps.plan(), scene)),
      );
      this.targetId = target.id;
      this.player.play(from);
    } else {
      // Already at the camera: a glide onto its pose.
      this.glideOnto(target, from);
    }
    if (this.instant && this.targetId !== null) this.arrive();
    return true;
  }

  /** Glides from `from` onto `target`'s pose; a walker already standing on it arrives at once. */
  private glideOnto(target: TourCheckpoint, from: TourPose): void {
    this.targetId = target.id;
    this.glide = glideTo(poseOf(target), from, this.instant, 0);
    if (!this.glide) this.arrive();
  }

  /** One frame of the entry glide or the step; it lands on the camera's exact pose. */
  update(delta: number): void {
    if (this.targetId === null) return;
    if (this.glide) {
      const pose = glideStep(this.glide, delta);
      if (pose) this.deps.setPose(pose.position, pose.target);
      else this.arrive();
      return;
    }
    this.player.update(delta);
    // The ride lands on the pose at the motion end; the clip's end hold after
    // it is not part of a step, so the camera is current from that frame on.
    // The eased arrival closes in on the pose, so the last micrometre counts as there.
    const { distance, length } = this.player.progress();
    if (this.player.getState() === 'ended' || length - distance <= ARRIVED_M) this.arrive();
  }

  /** Stops an entry or a step where it stands; the current camera does not change. */
  cancel(): void {
    if (this.targetId === null) return;
    this.player.stop();
    this.glide = null;
    this.targetId = null;
    this.deps.syncWalkLook();
  }

  /** The walker now stands at `pose` (the look-through entry): on a camera when its place is a camera's. */
  standAt(pose: TourPose): void {
    this.cancel();
    const on = this.cameras().find((camera) => vector(camera.position).distanceTo(pose.position) <= ON_CAMERA_M);
    if (on) this.currentId = on.id;
    this.report();
  }

  /** A new document: a step to a camera that is gone stops, and the index is re-read. */
  sceneChanged(): void {
    const ids = new Set(this.cameras().map((camera) => camera.id));
    if (this.targetId !== null && !ids.has(this.targetId)) this.cancel();
    if (this.currentId !== null && !ids.has(this.currentId)) this.currentId = null;
    this.report();
  }

  private arrive(): void {
    const target = this.cameras().find((camera) => camera.id === this.targetId);
    this.player.stop();
    this.glide = null;
    this.targetId = null;
    if (target) {
      const pose = poseOf(target);
      this.deps.setPose(pose.position, pose.target);
      this.currentId = target.id;
    }
    this.deps.syncWalkLook();
    this.report();
  }

  private report(): void {
    const camera = this.camera();
    if (camera.index === this.reported.index && camera.count === this.reported.count) return;
    this.reported = camera;
    this.deps.onCamera?.(camera);
  }

  private resolve(to: StepTarget, count: number): number | null {
    if (count === 0) return null;
    const current = this.camera().index;
    let index: number;
    if (to === 'first') index = 0;
    else if (to === 'last') index = count - 1;
    else if (to === 'next') index = current === null ? 0 : current + 1;
    else if (to === 'previous') index = current === null ? 0 : current - 1;
    else index = to;
    return Number.isInteger(index) && index >= 0 && index < count ? index : null;
  }

  private cameras(): readonly TourCheckpoint[] {
    return this.deps.scene().tourCheckpoints ?? [];
  }
}

/** A camera's exact pose: its place, looking along its yaw and pitch. */
export function poseOf(camera: TourCheckpoint): TourPose {
  const position = vector(camera.position);
  const direction = new THREE.Vector3(
    Math.sin(camera.yaw) * Math.cos(camera.pitch),
    Math.sin(camera.pitch),
    Math.cos(camera.yaw) * Math.cos(camera.pitch),
  );
  return { position, target: position.clone().add(direction) };
}

/** A pose's look as a camera's yaw and pitch: the glide's own derivation (`pose-glide.ts`). */
function lookOf(pose: TourPose): { yaw: number; pitch: number } {
  const { yaw, pitch } = aimOf(pose);
  return { yaw, pitch };
}

function vec(point: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: point.x, y: point.y, z: point.z };
}
