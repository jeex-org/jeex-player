/**
 * Deterministic frames of the authored tour for a fast, script-assembled
 * video: this module plus `ffmpeg` on the command line
 * IS the fast-video pipeline; no video codec lives in this library.
 *
 * The frame clock is the TOUR's own playback clock at 1x
 * (`TourPlayer.seekTime`): the speed profile WITH a checkpoint run's
 * ease-in from camera 1 and ease-out into the last camera, so a clip starts and ends at a standstill exactly like the
 * live run, and `getDuration()` (the default `to`) is that whole run. It is
 * never wall-clock time or the render loop's
 * `requestAnimationFrame` cadence: the same request produces byte-identical
 * frames on every run, on any machine, whatever real frame rate the render
 * loop happens to manage. A video assembled from live playback footage would
 * not have that property.
 *
 * Ownership: `capture-commands.ts` builds `FrameCaptureDeps` from its own
 * `CaptureDeps` — the same `runtime`/`model`/`shellState`/`options`/
 * `messages` a `still`/`panorama`/`pair` capture reads — and hands this
 * module only what it cannot get any other way (the tour) plus two closures
 * (`withRoot`, `captionFor`) that already know how to build the `'default'`
 * offscreen document and resolve the disclosure caption. This module never
 * imports `capture-commands.ts` back: the two would form the cycle
 * `check:arch` refuses (`.dependency-cruiser.cjs`, `no-circular`).
 *
 * Render-loop invariant: the live frame loop is STOPPED for the whole capture
 * (`RenderRuntime.stop()`/`start()`). `TourPlayer.seekTime` moves the pose
 * through the SAME `CameraController` the canvas draws from — nothing here
 * renders into a target of its own the way `captureStill` usually implies
 * "never touches the live camera"; the live camera IS the tour's camera, and
 * pausing the loop is what keeps a host's visible tour from jumping through
 * the whole clip while its frames are produced.
 *
 * `'default'`-state invariant: the offscreen document is built ONCE for the
 * whole clip, not once per frame — a tour can be a hundred frames, and a
 * fresh `SceneBuilder` per frame would turn "fast video" into the slowest
 * artefact this library makes. Its dollhouse shell state is `deps`'s current
 * one, evaluated once, which is exactly correct for the `'full'` shell a
 * running tour is normally shown with (`CameraDirector.setMode`); a capture
 * requested while the shell is `'dollhouse'` gets a fixed camera-vs-wall
 * reading for the eye position it started from, a known simplification for a
 * combination the tour does not put a host in.
 *
 * Tour-state invariant: whatever `TourState` the player was in before this
 * call — `ready`, `paused`, `playing` or `ended` — it is in again after, at
 * the same distance along the route (`restoreTour`).
 *
 * Context-loss invariant: a WebGL context lost while the clip is produced
 * ends it with a `ViewerLibError` of code `context-lost`, never with frames
 * drawn by a context that is gone and never with a promise that does not
 * settle, so a host's recording can be marked failed. The tour and the live
 * loop are put back as on any other ending.
 */

import { captureEdge, captureStill } from '../render/still-capture.js';
import { provenanceFor, stampCaption, type Provenance } from './provenance.js';
import { ViewerLibError } from '../shared/errors.js';
import type { RenderRuntime } from '../render/render-runtime.js';
import type { SceneState } from '../render/offscreen-scene.js';
import type { SceneModel } from '../scene/scene-model.js';
import { isTourSpeed, TOUR_SPEEDS, type TourPlayer, type TourSpeed, type TourState } from '../camera/tour-player.js';
import type { CameraPose } from '../scene/types.js';
import type { PostProcessor } from '../render/post-processor.js';
import type * as THREE from 'three';

/**
 * The width a frame is captioned for, mirrored from `capture-commands.ts`'s
 * `CAPTION_REFERENCE_PX`: a caption is sized for the picture it is drawn on,
 * not for the sentence itself, and a frame is captioned exactly like a still.
 */
const CAPTION_REFERENCE_PX = 1280;

/** Frame aspect ratios `capture.frames` offers; height is always the request's, width follows it. */
export type Aspect = '16:9' | '9:16' | '1:1';

/** `width = height * ratio`, matching every named aspect. */
const ASPECT_RATIO: Record<Aspect, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };

/** Frame rates `TourPlayer.seekTime`'s clock steps at; the ones `ffmpeg -r` names without a fractional guess. */
const FPS_VALUES: ReadonlySet<number> = new Set([24, 25, 30]);

export type FramesRequest = {
  aspect: Aspect;
  /** Frame height in pixels; width follows from `aspect`. */
  height: number;
  fps: 24 | 25 | 30;
  /** 1x seconds along the tour's playback clock (ramps included); default 0. */
  from?: number | undefined;
  /** 1x seconds along the tour's playback clock; default the tour's whole duration, ramps and end hold included. */
  to?: number | undefined;
  /**
   * The tour's speed setting for this clip, default 1:
   * the clip steps `speed / fps` seconds of the 1x profile per frame, so a 2x
   * clip of a tour of `D` 1x seconds has `round(D / 2 * fps) + 1` frames and
   * lasts half as long. `from`, `to` and each frame's `timeS` stay 1x seconds.
   * A 2x clip is the 1x recording at twice the pace, its ramps included (a
   * quarter of a second each), so the count stays the formula above.
   */
  speed?: TourSpeed | undefined;
  /** Which document to render; default `'current'`. */
  state?: SceneState | undefined;
  /** Overrides `options.capture.disclosure.caption` for every frame of this clip. */
  caption?: boolean | undefined;
  /** Called once per frame, in order; may await encoding or writing it out. */
  onFrame: (frame: { index: number; timeS: number; blob: Blob }) => Promise<void> | void;
};

/** The clip's summary: how many frames it produced, over how many seconds, and one representative sidecar. */
export type FramesResult = { frames: number; durationS: number; provenance: Provenance };

/**
 * What `captureFrames` needs, assembled by `capture-commands.ts`'s `frames`
 * method from its own `CaptureDeps` plus the two closures it already owns
 * (`inState`, `captionFor`) — see the module doc for why this module never
 * imports that one back.
 */
export type FrameCaptureDeps = {
  runtime: RenderRuntime;
  model: SceneModel;
  tour: TourPlayer;
  /** The pose the live camera holds right now — the tour's, once `seekTime` has run. */
  livePose: () => CameraPose | null;
  /** Runs `take` against the root the request's `state` names; owns building and disposing it. */
  withRoot: <T>(take: (root: THREE.Object3D) => Promise<T>) => Promise<T>;
  /** The disclosure caption text for one artefact, or `null` when none is wanted. */
  captionFor: (wanted: boolean | undefined) => string | null;
  /** The live walk and tour chain every frame renders through, like a still; absent or `null` for the direct path. */
  post?: PostProcessor | null | undefined;
};

/** Pixel size for `height` at `aspect`, validated the way every capture edge is (`still-capture.ts`). */
function frameSize(aspect: Aspect, height: number): { width: number; height: number } {
  const validHeight = captureEdge('height', height, 1);
  const width = captureEdge('width', Math.round(validHeight * ASPECT_RATIO[aspect]), 1);
  return { width, height: validHeight };
}

/**
 * How many samples `[from, to]` (1x seconds) takes at `fps` and `speed`: at
 * least one, `round((to - from) / speed * fps) + 1` — the end frame
 * included, the count a host computes in advance to check a clip against.
 */
function frameCount(from: number, to: number, fps: number, speed: TourSpeed): number {
  return Math.max(1, Math.round(((to - from) / speed) * fps) + 1);
}

/**
 * Puts `tour` back the way `captureFrames` found it: the same `TourState`, at
 * the same distance along the route.
 *
 * `TourPlayer.seekDistance` only ever moves state AWAY from `'ready'` (to
 * `'paused'`) or out of `'playing'`/`'ended'` at the route's own ends — it
 * never turns a currently-`'paused'` player back into `'playing'`, nor
 * `'paused'` into `'ended'`, on its own; those two are restored with an
 * explicit `play()` first, which resumes from the paused position without
 * taking a fly-in approach.
 */
function restoreTour(tour: TourPlayer, state: TourState, distance: number): void {
  if (state === 'ready') {
    tour.stop();
    return;
  }
  if ((state === 'playing' || state === 'ended') && tour.getState() !== 'playing') tour.play();
  tour.seekDistance(distance);
}

/**
 * Steps the tour deterministically — `seekTime(from + i * speed / fps)` for
 * `i = 0..N-1` — and captures a still at the tour's pose for every step, at
 * the aspect's width. See the module doc for the pause/restore invariants.
 */
export async function captureFrames(deps: FrameCaptureDeps, request: FramesRequest): Promise<FramesResult> {
  if (!FPS_VALUES.has(request.fps)) {
    throw new ViewerLibError('bad-params', `capture frames: fps must be 24, 25 or 30, got ${String(request.fps)}`, {
      detail: { fps: request.fps },
    });
  }
  const speed = request.speed ?? 1;
  if (!isTourSpeed(speed)) {
    throw new ViewerLibError('bad-params', `capture frames: speed must be one of ${TOUR_SPEEDS.join(', ')}, got ${String(speed)}`, {
      detail: { speed },
    });
  }
  const from = request.from ?? 0;
  const to = request.to ?? deps.tour.getDuration();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
    throw new ViewerLibError('bad-params', `capture frames: "to" (${String(to)}) must be >= "from" (${String(from)}) and both >= 0`, {
      detail: { from, to },
    });
  }
  const { width, height } = frameSize(request.aspect, request.height);
  const count = frameCount(from, to, request.fps, speed);
  const state = request.state ?? 'current';
  const text = deps.captionFor(request.caption);

  const start = deps.tour.progress();
  const startState = deps.tour.getState();
  const loss = watchContextLoss(deps.runtime);
  deps.runtime.stop();
  try {
    let provenance: Provenance | undefined;
    await deps.withRoot(async (root) => {
      for (let index = 0; index < count; index += 1) {
        loss.check(index);
        const timeS = from + (index * speed) / request.fps;
        deps.tour.seekTime(timeS);
        const pose = deps.livePose();
        if (pose === null) throw new ViewerLibError('not-ready', 'capture: the live camera does not exist yet');
        const shot = await loss.race(captureStill(deps.runtime.renderer, root, { width, height, pose, post: deps.post }), index);
        loss.check(index);
        const blob = text === null ? shot.blob : await stampCaption(shot.blob, text, Math.max(1, shot.width / CAPTION_REFERENCE_PX));
        provenance ??= provenanceFor(deps.model.scene, deps.model.rev, 'frame', state, { camera: pose });
        await loss.race(Promise.resolve(request.onFrame({ index, timeS, blob })), index);
      }
      loss.check(count);
    });
    // `count >= 1` always (see `frameCount`), so `provenance` was set on the first iteration.
    return { frames: count, durationS: count > 1 ? (count - 1) / request.fps : 0, provenance: provenance! };
  } finally {
    loss.stop();
    restoreTour(deps.tour, startState, start.distance);
    deps.runtime.start();
  }
}

/** The refusal a clip ends with when its context goes; `index` is the frame it was at. */
function contextLost(index: number): ViewerLibError {
  return new ViewerLibError('context-lost', `capture frames: the WebGL context was lost at frame ${String(index)}`, { detail: { index } });
}

/**
 * Watches the runtime's context for the length of one clip: `check` throws
 * once it is lost, `race` rejects a pending step the moment it is (a step
 * waiting on a context that is gone may never settle), `stop` lets go.
 */
function watchContextLoss(runtime: RenderRuntime): {
  check: (index: number) => void;
  race: <T>(step: Promise<T>, index: number) => Promise<T>;
  stop: () => void;
} {
  const renderer = runtime.renderer;
  const isLost = (): boolean => renderer.getContext().isContextLost();
  const canvas = renderer.domElement;
  const waiting = new Set<() => void>();
  const onLost = (): void => {
    for (const reject of waiting) reject();
  };
  const listening = new AbortController();
  canvas.addEventListener('webglcontextlost', onLost, { signal: listening.signal });
  return {
    check: (index) => {
      if (isLost()) throw contextLost(index);
    },
    race: <T>(step: Promise<T>, index: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const fail = (): void => reject(contextLost(index));
        waiting.add(fail);
        step.then(resolve, reject).finally(() => waiting.delete(fail));
      }),
    stop: () => {
      listening.abort();
      waiting.clear();
    },
  };
}
