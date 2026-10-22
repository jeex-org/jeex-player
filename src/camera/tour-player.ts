/**
 * Plays the apartment tour as ONE continuous camera clip and exposes it as a
 * seekable clip an embedding page can drive.
 *
 * The authored route (overview arc → dive to the entrance → walkthrough through
 * doorways → rise) is smoothed with corner fillets — straight legs joined by
 * quadratic Beziers — so the position has no kinks, and is traversed with a
 * single speed profile (per-waypoint zones blended smoothly, ease-in at the
 * start, ease-out at the end, no zero-velocity joints). Gaze keys — a world
 * point, a camera's own direction, or the level direction of travel
 * (`tour-path.ts`) — ease into each other along the short yaw arc over windows
 * scaled to the turn angle, so pans never whip.
 *
 * A checkpoint route (`scene/tour-route.ts`, `kind: 'checkpoints'`) is ridden
 * as the polyline it is, so the run stands exactly on every camera, and it is
 * entered with a one-second GLIDE from wherever the view is to camera 1's
 * exact pose (`GLIDE_SECONDS`; a cut under reduced motion)
 * rather than an approach. Along the track the run eases in from a standstill
 * and out into the last camera's pose over `TRACK_RAMP_SECONDS` each
 * (`track-ease.ts`), and so does every resume and every
 * play after a seek; a pause stops at once. The authored route keeps its own
 * ramps, baked into its time table. Where a checkpoint run looks and how fast
 * it goes at every metre is `tour-motion.ts`: the gaze blends into each
 * camera's view with a continuous angular velocity, and the speed eases down
 * wherever the gaze would whip or the track turns tight.
 *
 * Speed setting: `setSpeed(0.5 | 1 | 2)` scales the route clock — the
 * position, the gaze and the time table are untouched, so a change never
 * moves the camera — and eases from the old factor to the new one over
 * `TRACK_RAMP_SECONDS` of wall-clock time; the track ramps stay half a second of
 * wall-clock time at every factor. 1x of a checkpoint run is
 * `TOUR_TRACK_SPEED_FACTOR` times the route's cruise speed.
 *
 * Progress invariant: DISTANCE along the authored route is canonical.
 * `length` is its arc length in metres, `fraction = distance / length`, and
 * `elapsed` / `duration` are derived from the speed profile for autoplay only.
 * They are PLAYBACK seconds at 1x: on a checkpoint run they include the
 * ramps of an uninterrupted run (`track-ease.ts` `routeTimeAt`), so
 * `seekTime` stepped evenly reproduces the run as it plays and a recording
 * eases in and out like it.
 * The APPROACH — the fly-in from wherever the camera happens to be to the head
 * of the route — is a phase of its own with its own curve and clock: it never
 * enters `samples`, `length`, `duration`, the speed zones or the gaze track, so
 * a host that scrubs by fraction always addresses the same authored metres. The
 * reported fraction is `0` for its whole duration, and any seek cancels it.
 */

import * as THREE from 'three';
import type { SceneData } from '../scene/types.js';
import { DEFAULT_TOUR_SPEED_MPS, tourRouteOf, type TourRoute } from '../scene/tour-route.js';
import {
  lookOf,
  lookPoint,
  positionOnPath,
  sampleFilletedPath,
  samplePolyline,
  turnAim,
  turnOnTrack,
  turnTrack,
  vec3,
  yawDelta,
  type Aim,
  type Look,
  type SampledPath,
} from './tour-path.js';
import type { TourNavigation } from '../navigation/tour-legs.js';
import { clamp, lerp, smoothstep } from '../shared/math.js';
import { playbackTimeAt, rampFor, routeTimeAt, warpStep, TRACK_RAMP_SECONDS } from './track-ease.js';
import { cellDistance, cellTime, trackMotion, type TimeEntry, type TrackMotion } from './tour-motion.js';
import { glideStep, glideTo, type Glide } from './pose-glide.js';
import { approachPose, approachTo, START_RAMP, type Approach } from './tour-approach.js';

export type TourState = 'ready' | 'playing' | 'paused' | 'ended';

/** The speed settings of the tour, a factor of its 1x pace. */
export type TourSpeed = 0.5 | 1 | 2;
/** Every speed setting, in the order the tour bar's button cycles through them: 1x → 2x → 0.5x → 1x. */
export const TOUR_SPEEDS = [1, 2, 0.5] as const satisfies readonly TourSpeed[];

/** Whether `value` is one of the speed settings: the one check every public entry point refuses others with. */
export function isTourSpeed(value: unknown): value is TourSpeed {
  return (TOUR_SPEEDS as readonly unknown[]).includes(value);
}

/**
 * 1x of a checkpoint run against the route's cruise speed: the route's own
 * cruise speed reads as too slow a walk, so 1x is half as fast again.
 */
export const TOUR_TRACK_SPEED_FACTOR = 1.5;

/** One snapshot of the clip; emitted with every pose and returned by `progress()`. */
export type TourProgress = {
  state: TourState;
  /** 0..1 of the AUTHORED route; `0` for the whole approach phase. */
  fraction: number;
  /** Metres along the authored route. */
  distance: number;
  /** Arc length of the authored route, metres. */
  length: number;
  /** Seconds along the playback clock (a checkpoint run's track ramps included). */
  elapsed: number;
  /**
   * Seconds the whole run plays for at 1x, end hold included: the authored
   * route at its authored speeds, a checkpoint run with its ease-in and
   * ease-out — what `capture.frames` records.
   */
  duration: number;
  /** The speed setting; `elapsed` and `duration` are 1x seconds, a wall clock divides them by it. */
  speed: TourSpeed;
};

type TourCallbacks = {
  onState: (state: TourState) => void;
  onProgress: (progress: TourProgress) => void;
  /**
   * Where the camera is right now: what a checkpoint run glides FROM when
   * `play()` is not told (the tour was already engaged). Absent, such a run
   * cuts to camera 1.
   */
  pose?: (() => TourPose) | undefined;
  /**
   * The tour PLAYED to its end. Only the playback clock raises it: a seek to
   * the end of a playing tour reaches `ended` too, but is not a completion.
   */
  onComplete?: (() => void) | undefined;
};

export type TourPose = { position: THREE.Vector3; target: THREE.Vector3 };

const GAZE_TURN_RATE = 30; // deg/s of gaze panning; transition length follows the turn angle
const GAZE_MIN_WINDOW = 2.0; // metres of path per gaze transition
const GAZE_MAX_WINDOW = 7.0;
const ZONE_BLEND = 2.0; // metres over which adjacent speed zones blend
const END_RAMP = 1.4; // seconds of ease-out
const END_RAMP_FLOOR = 0.45; // slowest fraction of cruise speed at the very end
const END_HOLD = 0.4; // seconds held on the final view
const APPROACH_MIN = 0.4; // metres: closer than this a checkpoint run needs no glide to camera 1
const TABLE_STEP = 0.05;
/** Path metres between two samples of a gaze transition's way round (`turnsOf`). */
const TURN_GRID_M = 0.02;
/** How far a direction or travel look reaches ahead of the eye, metres (the floor guard may shorten it). */
const GAZE_REACH_M = 3;
/** Path metres ahead a `travel` key of a non-checkpoint route aims at. */
const TRAVEL_LOOKAHEAD_M = 1;

export class TourPlayer {
  private readonly setPose: (position: THREE.Vector3, target: THREE.Vector3) => void;
  private readonly callbacks: TourCallbacks;
  private basePath: THREE.Vector3[] = [];
  private baseZones: Array<{ at: number; speed: number }> = [];
  private baseGaze: Array<{ at: number; look: Look }> = [];
  private baseSpeed = DEFAULT_TOUR_SPEED_MPS;
  /** `'checkpoints'` rides the path as it is and opens with a glide to camera 1; the authored route flies in. */
  private kind: TourRoute['kind'];
  private motionInstant = false;

  private route: SampledPath = { samples: [{ p: new THREE.Vector3(), d: 0 }], length: 0, controlDistances: [0] };
  private zoneStarts: Array<{ d: number; speed: number }> = [];
  private gaze: Array<{ d: number; look: Look; window: number; turns: number[] }> = [];
  private timeTable: TimeEntry[] = [];
  private state: TourState = 'ready';
  private elapsed = 0;
  /** Route seconds of the time table, end hold included; the playback clock adds the ramps (`playbackDuration`). */
  private totalDuration = 0;
  /** Route seconds the motion of a checkpoint run ends at, and its track ramp length at 1x (0 on an authored route). */
  private motionEnd = 0;
  private ramp = 0;
  private approach: Approach | null = null;
  private glide: Glide | null = null;
  /**
   * Real seconds since a checkpoint run last left a standstill (a fresh
   * start, a resume, a play after a seek), `null` when it is not easing in.
   */
  private easeSince: number | null = null;
  /** A checkpoint run's gaze and time table (`tour-motion.ts`); `null` on an authored route. */
  private motion: TrackMotion | null = null;
  /** The speed setting, and the factor the clock runs at while it eases from the previous one. */
  private speed: TourSpeed = 1;
  private rateFrom = 1;
  private rateSince: number | null = null;

  /**
   * `navigation` is the walkable space of the document's solved plan
   * (`navigation/tour-legs.ts`), without which a checkpoint route is the bare
   * spline through the cameras.
   */
  constructor(
    sceneData: SceneData,
    setPose: (position: THREE.Vector3, target: THREE.Vector3) => void,
    callbacks: TourCallbacks,
    navigation?: TourNavigation,
  ) {
    this.setPose = setPose;
    this.callbacks = callbacks;
    // The route the checkpoints derive when the document carries them, else
    // the authored autotour (`tour-route.ts`): the SAME derivation every
    // later document takes through `CameraDirector.setScene`.
    this.setRoute(tourRouteOf(sceneData, navigation));
  }

  /**
   * Reduced motion: a checkpoint run's opening glide becomes a plain cut.
   * The composition root forwards the resolved `motion` option here through
   * the director, like every other scripted camera move.
   */
  setMotionInstant(instant: boolean): void {
    this.motionInstant = instant;
  }

  /**
   * Adopts a route (`SceneData.autotour`) and keeps the current fraction.
   *
   * The composition root calls this after a plan-level commit: an authored
   * route belongs to a document, and a player still holding the previous one
   * would fly the camera through a doorway that no longer exists. A running
   * tour keeps running, at the same fraction of the new route, so a finish
   * change mid-run does not restart the clip.
   */
  setRoute(tour: TourRoute): void {
    const fraction = this.route.length > 0 ? this.distanceAt(this.elapsed) / this.route.length : 0;
    this.kind = tour.kind;
    this.basePath = tour.path.map((point) => vec3(point));
    this.baseSpeed = tour.speed ?? DEFAULT_TOUR_SPEED_MPS;
    this.baseZones = (tour.zones ?? [])
      .filter((zone) => Number.isInteger(zone.at) && zone.at >= 0 && zone.at < tour.path.length && zone.speed > 0)
      .map((zone) => ({ at: zone.at, speed: zone.speed }));
    this.baseGaze = (tour.gaze ?? [])
      .filter((key) => Number.isInteger(key.at) && key.at >= 0 && key.at < tour.path.length)
      .map((key) => ({ at: key.at, look: lookOf(key) }));
    this.approach = null;
    this.glide = null;
    this.build();
    this.elapsed = this.timeAt(clamp(fraction, 0, 1) * this.route.length);
    if (this.state !== 'ready') this.emitPose(this.pathPose(this.distanceAt(this.elapsed)));
  }

  getState(): TourState {
    return this.state;
  }
  /** Whether the route rides tour checkpoints (`kind: 'checkpoints'`): what a walk entry glides onto and follows. */
  isCheckpointRoute(): boolean {
    return this.kind === 'checkpoints';
  }
  getElapsed(): number {
    return this.approach || this.glide ? 0 : this.playbackOf(this.elapsed);
  }
  /** Seconds the whole run plays for at 1x, ramps and end hold included (the clock `seekTime` speaks). */
  getDuration(): number {
    return this.playbackDuration();
  }
  /** Arc length of the authored route, metres; the unit `seekDistance` speaks. */
  length(): number {
    return this.route.length;
  }

  progress(): TourProgress {
    const opening = this.approach !== null || this.glide !== null;
    const distance = opening ? 0 : this.distanceAt(this.elapsed);
    return {
      state: this.state,
      fraction: this.route.length > 0 ? distance / this.route.length : 0,
      distance,
      length: this.route.length,
      elapsed: opening ? 0 : this.playbackOf(this.elapsed),
      duration: this.playbackDuration(),
      speed: this.speed,
    };
  }

  getSpeed(): TourSpeed {
    return this.speed;
  }

  /**
   * The speed setting. Applied at once to a paused or ready clip; a playing
   * one eases from the factor it runs at now to the new one over
   * `TRACK_RAMP_SECONDS`, so neither the camera nor its speed jumps.
   */
  setSpeed(speed: TourSpeed): void {
    if (speed === this.speed) return;
    this.rateFrom = this.rate();
    this.rateSince = this.state === 'playing' ? 0 : null;
    this.speed = speed;
    this.callbacks.onProgress(this.progress());
  }

  /** The factor the route clock runs at right now. */
  private rate(): number {
    if (this.rateSince === null) return this.speed;
    return lerp(this.rateFrom, this.speed, smoothstep(this.rateSince / TRACK_RAMP_SECONDS));
  }

  /**
   * Starts or resumes the tour. `from` is the current camera pose: when it is
   * off the route the run opens with an APPROACH that eases out of that view
   * instead of cutting to the head of the route. Resuming a paused run never
   * takes an approach — the camera is already where the clip left it.
   *
   * A checkpoint run never takes the approach: it GLIDES to camera 1's exact
   * pose in `GLIDE_SECONDS` (a cut under reduced motion) from `from`, or from
   * the camera's pose when `from` is not given, and rides from there — unless
   * the camera already stands on camera 1 looking its way.
   */
  play(from?: TourPose): void {
    if (this.state === 'playing') return;
    if (this.state === 'paused') {
      this.easeSince = 0;
      this.setState('playing');
      return;
    }
    if (this.state === 'ended') this.elapsed = 0;
    this.easeSince = 0;
    if (this.kind === 'checkpoints') {
      this.approach = null;
      this.glide = this.buildGlide(from ?? this.callbacks.pose?.());
    } else {
      this.approach = this.buildApproach(from);
    }
    this.setState('playing');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.rateSince = null;
    this.setState('paused');
  }

  stop(): void {
    this.elapsed = 0;
    this.approach = null;
    this.glide = null;
    this.setState('ready');
  }

  /** Seeks to a fraction `0..1` of the authored route. */
  seek(fraction: number): void {
    this.seekDistance(clamp(fraction, 0, 1) * this.route.length);
  }

  /** Seeks to an absolute distance in metres along the authored route. */
  seekDistance(metres: number): void {
    const distance = clamp(metres, 0, this.route.length);
    // The approach is not part of the clip: addressing the clip cancels it.
    this.approach = null;
    this.glide = null;
    // A run that goes on from the new point leaves it from a standstill.
    this.easeSince = 0;
    this.elapsed = this.timeAt(distance);
    if (this.state === 'ready') this.setState('paused');
    else if (this.state === 'playing' && distance >= this.route.length && this.route.length > 0) {
      this.elapsed = this.totalDuration;
      this.setState('ended');
    } else if (this.state === 'ended' && distance < this.route.length) this.setState('paused');
    this.emitPose(this.pathPose(distance));
  }

  /**
   * Seeks to a point of the playback clock, in 1x seconds from the start of
   * the run: a checkpoint run's track ramps included, so stepping this clock
   * evenly reproduces the run as it plays (`capture.frames`).
   */
  seekTime(seconds: number): void {
    const playback = clamp(seconds, 0, this.playbackDuration());
    this.seekDistance(this.distanceAt(routeTimeAt(playback, this.motionEnd, this.ramp)));
  }

  /** The playback clock's length: the time table plus the ramps' extra time. */
  private playbackDuration(): number {
    return this.totalDuration + this.ramp;
  }

  /** Route seconds to playback seconds (`track-ease.ts`). */
  private playbackOf(route: number): number {
    return playbackTimeAt(route, this.motionEnd, this.ramp);
  }

  update(delta: number): void {
    if (this.state !== 'playing') return;
    if (this.glide) {
      // Still gliding: nothing else moves this frame.
      if (this.stepGlide(this.glide, delta)) return;
    } else if (this.approach) {
      this.approach.elapsed += delta;
      if (this.approach.elapsed < this.approach.duration) {
        this.emitPose(approachPose(this.approach));
        return;
      }
      // Hand over mid-frame: the leftover seconds belong to the route.
      this.elapsed = this.approach.entryTime + (this.approach.elapsed - this.approach.duration);
      this.approach = null;
    } else if (this.kind === 'checkpoints') {
      // The warp runs on the wall clock: route seconds divided by the factor,
      // so the ramps stay half a second long at every speed setting.
      const rate = this.advanceRate(delta);
      const motionEnd = this.motionEnd / rate;
      this.elapsed = rate * warpStep(this.elapsed / rate, delta, this.easeSince, motionEnd, rampFor(motionEnd));
      if (this.easeSince !== null) this.easeSince += delta;
    } else {
      this.elapsed += delta * this.advanceRate(delta);
    }
    const finished = this.elapsed >= this.totalDuration;
    if (finished) {
      this.elapsed = this.totalDuration;
      this.setState('ended');
    }
    this.emitPose(this.pathPose(this.distanceAt(this.elapsed)));
    if (finished) this.callbacks.onComplete?.();
  }

  /** The clock factor for a frame of `delta` seconds, advancing an easing speed change. */
  private advanceRate(delta: number): number {
    if (this.rateSince === null) return this.speed;
    this.rateSince += delta;
    if (this.rateSince >= TRACK_RAMP_SECONDS) this.rateSince = null;
    return this.rate();
  }

  /** Distance in metres reached after `time` seconds of the speed profile. */
  distanceAt(time: number): number {
    const table = this.timeTable;
    if (time <= 0 || table.length === 0) return 0;
    // Non-empty by the guard above, and the search keeps both bounds inside it.
    const last = table.at(-1)!;
    if (time >= last.t) return this.route.length;
    let lo = 0;
    let hi = table.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid]!.t <= time) lo = mid;
      else hi = mid;
    }
    return cellDistance(table[lo]!, table[hi]!, time);
  }

  /**
   * Monotone inverse of `distanceAt`: the first moment the run reaches
   * `distance`. The end hold is excluded, so `timeAt(length)` is when the
   * camera stops moving, not when the clip is over.
   */
  timeAt(distance: number): number {
    const table = this.timeTable;
    if (table.length === 0) return 0;
    // The last entry repeats the final distance for the end hold; the motion
    // ends one sample earlier, and a search that includes the hold would answer
    // with the hold's time for every distance at the end of the route.
    const motionEnd = Math.max(0, table.length - 2);
    const d = clamp(distance, 0, this.route.length);
    if (d <= 0) return 0;
    // Non-empty by the guard above; `motionEnd` is clamped into the table and
    // the search keeps both bounds between 0 and it.
    if (d >= table[motionEnd]!.d) return table[motionEnd]!.t;
    let lo = 0;
    let hi = motionEnd;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid]!.d <= d) lo = mid;
      else hi = mid;
    }
    return cellTime(table[lo]!, table[hi]!, d);
  }

  // ---- Route construction -------------------------------------------------

  /** Builds the smoothed route, speed zones, gaze track and time→distance table. */
  private build(): void {
    const controls = this.basePath.map((point) => point.clone());
    this.route = this.kind === 'checkpoints' ? samplePolyline(controls) : sampleFilletedPath(controls);

    this.zoneStarts = this.baseZones.map((zone) => ({ d: this.controlDistance(zone.at), speed: zone.speed })).sort((a, b) => a.d - b.d);

    const keys = this.baseGaze.map((key) => ({ d: this.controlDistance(key.at), look: key.look })).sort((a, b) => a.d - b.d);
    this.gaze = keys.map((key, index) => {
      const next = keys[index + 1];
      // Never longer than the gap to the next key: a transition that started
      // before THIS key was reached would jump the gaze the moment the key is
      // passed (checkpoint routes put keys a few metres apart).
      const window = next ? Math.max(1e-3, Math.min(this.gazeWindow(key, next), next.d - key.d)) : GAZE_MIN_WINDOW;
      return { d: key.d, look: key.look, window, turns: next ? this.turnsOf(key.look, next, window) : [] };
    });

    this.motion = this.kind === 'checkpoints' ? this.buildMotion() : null;
    this.timeTable = this.motion
      ? [...this.motion.table, { t: this.motion.table.at(-1)!.t + END_HOLD, d: this.route.length }]
      : this.buildTimeTable();
    // `buildTimeTable` always pushes the end hold, so the table is never empty.
    this.totalDuration = this.timeTable.at(-1)!.t;
    this.motionEnd = this.timeAt(this.route.length);
    this.ramp = this.motion ? rampFor(this.motionEnd) : 0;
  }

  private controlDistance(at: number): number {
    const list = this.route.controlDistances;
    // One entry per control point and the route always has some, so a gaze key
    // clamped to the last index resolves.
    return list[Math.min(at, list.length - 1)] ?? 0;
  }

  /** The gaze and the speed profile of a checkpoint run, from its camera keys and travel stretches. */
  private buildMotion(): TrackMotion {
    const cameras: Array<{ d: number; look: { yaw: number; pitch: number } }> = [];
    const travel: number[] = [];
    for (const key of this.gaze) {
      if ('direction' in key.look) cameras.push({ d: key.d, look: key.look.direction });
      else if ('travel' in key.look) travel.push(key.d);
    }
    return trackMotion({
      length: this.route.length,
      positionAt: (d) => positionOnPath(this.route, d),
      cameras,
      travel: travel.flatMap((leave, index) =>
        index % 2 === 0 && travel[index + 1] !== undefined ? [{ leave, arrive: travel[index + 1]! }] : [],
      ),
      cruise: this.baseSpeed * TOUR_TRACK_SPEED_FACTOR,
    });
  }

  /** The way round of the transition from `from` into `next` over its window (`turnTrack`). */
  private turnsOf(from: Look, next: { d: number; look: Look }, window: number): number[] {
    return turnTrack(Math.max(1, Math.ceil(window / TURN_GRID_M)), (u) => {
      const d = next.d - window + window * u;
      return this.aim(next.look, d).yaw - this.aim(from, d).yaw;
    });
  }

  /** Gaze transition length in path metres, scaled by the turn angle at the next key. */
  private gazeWindow(current: { d: number; look: Look }, next: { d: number; look: Look }): number {
    const a = this.aim(current.look, current.d);
    const b = this.aim(next.look, next.d);
    if (a.reach < 1e-3 || b.reach < 1e-3) return GAZE_MIN_WINDOW;
    const angle = Math.abs(yawDelta(a.yaw, b.yaw)) * (180 / Math.PI);
    return THREE.MathUtils.clamp(angle / GAZE_TURN_RATE, GAZE_MIN_WINDOW, GAZE_MAX_WINDOW);
  }

  /**
   * Integrates the authored route's speed profile (ease-in and ease-out
   * included) into a time→distance table; a checkpoint run's comes from
   * `tour-motion.ts`.
   *
   * The ease-out is measured in metres left, not against a guessed total run
   * time: the time estimate needs a fixed point that does not converge once the
   * speed zones are slower than the base speed, and the diverging pass leaves
   * the camera crawling at the ramp floor over the whole last leg.
   */
  private buildTimeTable(): Array<{ t: number; d: number }> {
    const samples: Array<{ t: number; d: number }> = [{ t: 0, d: 0 }];
    let time = 0;
    let dist = 0;
    let guard = 0;
    while (dist < this.route.length && guard < 60000) {
      time += TABLE_STEP;
      guard += 1;
      const cruise = this.speedAt(dist);
      const tail = (this.route.length - dist) / Math.max(cruise * END_RAMP, 1e-6);
      const ramp = Math.min(1, time / START_RAMP, Math.max(END_RAMP_FLOOR, tail));
      const step = cruise * ramp * TABLE_STEP;
      dist = Math.min(this.route.length, dist + step);
      samples.push({ t: time, d: dist });
    }
    // Brief hold on the final view so the run lands softly instead of cutting off.
    samples.push({ t: time + END_HOLD, d: this.route.length });
    return samples;
  }

  private speedAt(dist: number): number {
    let speed = this.zoneStarts[0]?.speed ?? this.baseSpeed;
    for (let index = 1; index < this.zoneStarts.length; index += 1) {
      // `index` is bounded by the loop condition.
      const zone = this.zoneStarts[index]!;
      if (dist >= zone.d) {
        speed = zone.speed;
      } else if (dist >= zone.d - ZONE_BLEND) {
        speed = THREE.MathUtils.lerp(speed, zone.speed, smoothstep((dist - (zone.d - ZONE_BLEND)) / ZONE_BLEND));
        break;
      } else {
        break;
      }
    }
    return speed;
  }

  // ---- Glide (checkpoint runs) --------------------------------------------

  /**
   * The glide to camera 1 from `from`, or `null` when there is nothing to
   * glide (no route, or the view already stands on camera 1 looking its way).
   * Without `from` the run opens with a cut.
   */
  private buildGlide(from?: TourPose): Glide | null {
    if (this.route.length <= 0) return null;
    return glideTo(this.pathPose(0), from, this.motionInstant, APPROACH_MIN);
  }

  /**
   * Advances the glide. Answers `true` while the frame belongs to it, and
   * `false` once it has landed on camera 1: the ride then leaves camera 1
   * from a standstill and eases in.
   */
  private stepGlide(glide: Glide, delta: number): boolean {
    const pose = glideStep(glide, delta);
    if (pose) {
      this.emitPose(pose);
      return true;
    }
    this.glide = null;
    this.elapsed = 0;
    this.easeSince = 0;
    return false;
  }

  // ---- Approach -----------------------------------------------------------

  /** The fly-in from `from` to the route (`tour-approach.ts`), landing where the route's own ease-in is spent. */
  private buildApproach(from?: TourPose): Approach | null {
    if (!from || this.route.length <= 0) return null;
    const entryDistance = Math.min(this.distanceAt(START_RAMP), this.route.length);
    return approachTo(
      from,
      this.route,
      { distance: entryDistance, pose: this.pathPose(entryDistance), time: this.timeAt(entryDistance) },
      this.baseSpeed,
    );
  }

  // ---- Emission -----------------------------------------------------------

  private setState(state: TourState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onState(state);
  }

  private emitPose(pose: TourPose): void {
    this.setPose(pose.position, pose.target);
    this.callbacks.onProgress(this.progress());
  }

  private pathPose(distance: number): TourPose {
    const d = clamp(distance, 0, this.route.length);
    return { position: positionOnPath(this.route, d), target: this.gazeTarget(d) };
  }

  /** Holds each gaze key, then eases to the next one over its adaptive window. */
  private gazeTarget(distance: number): THREE.Vector3 {
    const samples = this.route.samples;
    if (this.gaze.length === 0) {
      // `route.samples` is never empty (`sampleFilletedPath` seeds it), so both
      // of these clamped indexes resolve.
      const last = samples.at(-1)!;
      const previous = samples[Math.max(0, samples.length - 2)]!;
      const back = previous.p.clone().sub(last.p);
      if (back.lengthSq() < 1e-9) return last.p.clone().add(new THREE.Vector3(0, 0, 4));
      return last.p.clone().addScaledVector(back.normalize(), 4);
    }
    const eye = positionOnPath(this.route, distance);
    if (this.motion) return lookPoint(eye, { ...this.motion.gaze(distance), reach: GAZE_REACH_M });
    // Non-empty by the guard above, and `index` is bounded by the loop.
    let current = this.gaze[0]!;
    for (let index = 0; index < this.gaze.length; index += 1) {
      const key = this.gaze[index]!;
      if (key.d <= distance) current = key;
      else {
        const window = current.window || GAZE_MIN_WINDOW;
        const progress = smoothstep((distance - (key.d - window)) / window);
        const from = this.aim(current.look, distance, eye);
        // Before the first key there is no transition yet: the first look holds.
        if (progress <= 0 || key === current) return lookPoint(eye, from);
        const to = this.aim(key.look, distance, eye);
        const turn = turnOnTrack(current.turns, (distance - (key.d - window)) / window, to.yaw - from.yaw);
        return lookPoint(eye, turnAim(from, to, progress, turn));
      }
    }
    return lookPoint(eye, this.aim(current.look, distance, eye));
  }

  /**
   * A look resolved at `distance` along the route, seen from `eye` (the route
   * position there unless given): a target's direction and distance, a
   * camera's own direction, or the level direction of travel.
   */
  private aim(look: Look, distance: number, eye = positionOnPath(this.route, distance)): Aim {
    if ('target' in look) {
      const offset = look.target.clone().sub(eye);
      const reach = offset.length();
      if (reach < 1e-6) return { ...this.travelAim(distance), reach: 0 };
      return { yaw: Math.atan2(offset.x, offset.z), pitch: Math.asin(clamp(offset.y / reach, -1, 1)), reach };
    }
    if ('direction' in look) return { yaw: look.direction.yaw, pitch: look.direction.pitch, reach: GAZE_REACH_M };
    return { ...this.travelAim(distance), reach: GAZE_REACH_M };
  }

  /** The level direction of travel at `distance`: a chord one stride ahead (behind at the very end). */
  private travelAim(distance: number): { yaw: number; pitch: number } {
    const from = positionOnPath(this.route, Math.min(distance, this.route.length - TRAVEL_LOOKAHEAD_M));
    const to = positionOnPath(this.route, Math.max(distance, TRAVEL_LOOKAHEAD_M));
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    return { yaw: Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(dx, dz), pitch: 0 };
  }
}
