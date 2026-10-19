/**
 * `TourControls`: the tour as an object an external script can drive — play,
 * pause, scrub by fraction, by metres or by seconds, read the progress, and
 * subscribe to it. It is what `ViewerHandle.tour` and `__viewerDebug.tour`
 * hand out, and the surface a postMessage transport will one day wrap.
 *
 * Routing invariant: every call goes through the CAMERA DIRECTOR, never
 * straight to the player. Playback only advances while the controller is in
 * tour mode (that is what ticks the player), so `play` and every `seek` engage
 * tour mode first; `pause` leaves the camera where it is and keeps that mode.
 *
 * Listener invariant: a subscriber that throws is reported and skipped, like a
 * `SceneModel` sink — one bad callback on a host page must not stop the frame
 * or the other subscribers.
 */

import { defaultLogger, type Logger } from '../shared/logger.js';
import { Fanout } from '../shared/fanout.js';
import { ViewerLibError } from '../shared/errors.js';
import {
  isTourSpeed,
  TOUR_SPEEDS,
  type TourPlayer,
  type TourPose,
  type TourProgress,
  type TourSpeed,
  type TourState,
} from './tour-player.js';

export type { TourProgress, TourSpeed, TourState } from './tour-player.js';

export type TourControls = {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  /** Seek to a fraction `0..1` of the authored route. */
  seek: (fraction: number) => void;
  /** Seek to an absolute distance in metres along the authored route. */
  seekDistance: (metres: number) => void;
  /** Seek to a point on the speed profile, in seconds. */
  seekTime: (seconds: number) => void;
  /**
   * The speed setting, a factor of the tour's 1x pace:
   * applied at once, eased over half a second while the tour plays, kept
   * across documents, never written into one. Throws `bad-params` for any
   * other value. `progress().speed` and the viewer's `tourSpeed` event read
   * it back.
   */
  setSpeed: (speed: TourSpeed) => void;
  /**
   * Where the clip stands, or `null` while there is no clip yet.
   *
   * `null` is the honest answer before the first scene is on screen: a host
   * that gets `{ state: 'ready', fraction: 0 }` there cannot tell "not loaded"
   * from "loaded and at the start", and a scroll-driven page would happily
   * drive a viewer that has not booted.
   */
  progress: () => TourProgress | null;
  /**
   * Subscribes to the clip; returns an unsubscribe function. `progress` fires
   * on every pose emission (a frame or a seek), `state` on every transition,
   * `ended` when playback reaches the end of the route.
   */
  on: ((event: 'progress', callback: (progress: TourProgress) => void) => () => void) &
    ((event: 'state', callback: (state: TourState) => void) => () => void) &
    ((event: 'ended', callback: () => void) => () => void);
};

/**
 * What `window.__viewerDebug.tour` exposes: the controls without the
 * subscription surface. These calls move the camera and nothing else, so they
 * are available in every build, not only behind `?debug=1`.
 */
export type TourDebugControls = Omit<TourControls, 'on'>;

/** The running camera stack, as much of it as the controls need. */
type TourControlsHost = {
  /**
   * Puts the camera stack in tour mode without touching playback and answers
   * with the pose it had before, or `null` when it was already engaged (there
   * is nothing to fly in from).
   */
  engageTour: () => TourPose | null;
  /** The tour button's behaviour: start, or pause a running run. */
  toggleTour: () => void;
  /** `null` until the camera stack has been built on the first document. */
  player: () => TourPlayer | null;
  /** The speed setting changed; the composition root announces it (`tourSpeed`). */
  onSpeed?: ((speed: TourSpeed) => void) | undefined;
};

/**
 * A command issued before the clip existed, kept so it can run when it does.
 *
 * Only the LAST one is kept, on purpose: these are transport controls, and a
 * host that calls `play()` then `seek(0.4)` while the scene loads means "start
 * at 0.4", not "play from 0, then jump". Replaying a queue would run a camera
 * through every position it was told about before the user ever saw it.
 */
type PendingCommand = { kind: 'play' | 'pause' | 'toggle' | 'stop' } | { kind: 'seek' | 'seekDistance' | 'seekTime'; value: number };

type Registry = {
  progress: Fanout<[TourProgress]>;
  state: Fanout<[TourState]>;
  ended: Fanout<[]>;
};

/**
 * Fan-out for the tour events. The composition root owns one and wires it into
 * the player's callbacks next to the UI updates, so subscribers see exactly
 * what the viewer's own chrome sees.
 */
export class TourEvents {
  private readonly listeners: Registry;

  constructor(log: Logger = defaultLogger) {
    const failed = (event: string) => (error: unknown) => log.error('listener-failed', `tour ${event} listener failed`, error);
    this.listeners = {
      progress: new Fanout<[TourProgress]>(failed('progress')),
      state: new Fanout<[TourState]>(failed('state')),
      ended: new Fanout<[]>(failed('ended')),
    };
  }

  on(event: 'progress', callback: (progress: TourProgress) => void): () => void;
  on(event: 'state', callback: (state: TourState) => void): () => void;
  on(event: 'ended', callback: () => void): () => void;
  on(event: keyof Registry, callback: (value: never) => void): () => void {
    return (this.listeners[event] as unknown as Fanout<[never]>).add(callback);
  }

  emitProgress(progress: TourProgress): void {
    this.listeners.progress.emit(progress);
  }

  /** A transition; `ended` fans out from the same call, after `state`. */
  emitState(state: TourState): void {
    this.listeners.state.emit(state);
    if (state !== 'ended') return;
    this.listeners.ended.emit();
  }

  /** Drops every subscriber; part of viewer teardown. */
  clear(): void {
    this.listeners.progress.clear();
    this.listeners.state.clear();
    this.listeners.ended.clear();
  }
}

/**
 * Binds the controls to a running camera stack and an event fan-out.
 *
 * `handle.tour` is handed out the moment `mountViewer` returns, which is before
 * the scene has loaded, so every command here has to answer for a viewer that
 * does not exist yet. It REMEMBERS the last one and replays it on the first
 * route (`replayPending`) rather than dropping it as a silent no-op.
 */
export function createTourControls(host: TourControlsHost, events: TourEvents): TourControls {
  let pending: PendingCommand | null = null;
  /** The speed setting outlives the player it is applied to: a later clip starts at it. */
  let speed: TourSpeed = 1;

  /** Engages tour mode for a seek: the pose is discarded, a scrub never flies in. */
  const engaged = (): TourPlayer | null => {
    const player = host.player();
    if (player) host.engageTour();
    return player;
  };

  /**
   * Runs `command` if there is a clip, and remembers it if there is not.
   * One place decides, so every command answers the same way before readiness.
   */
  const now = (command: PendingCommand, run: () => void): void => {
    if (!host.player()) {
      pending = command;
      return;
    }
    run();
  };

  const controls: TourControls = {
    play: () =>
      now({ kind: 'play' }, () => {
        const from = host.engageTour();
        host.player()?.play(from ?? undefined);
      }),
    pause: () => now({ kind: 'pause' }, () => host.player()?.pause()),
    toggle: () => now({ kind: 'toggle' }, () => host.toggleTour()),
    stop: () => now({ kind: 'stop' }, () => host.player()?.stop()),
    seek: (fraction) => now({ kind: 'seek', value: fraction }, () => engaged()?.seek(fraction)),
    seekDistance: (metres) => now({ kind: 'seekDistance', value: metres }, () => engaged()?.seekDistance(metres)),
    seekTime: (seconds) => now({ kind: 'seekTime', value: seconds }, () => engaged()?.seekTime(seconds)),
    setSpeed: (value) => {
      if (!isTourSpeed(value)) {
        throw new ViewerLibError('bad-params', `tour speed must be one of ${TOUR_SPEEDS.join(', ')}, got ${String(value)}`, {
          detail: { speed: value },
        });
      }
      host.player()?.setSpeed(value);
      if (value === speed) return;
      speed = value;
      host.onSpeed?.(value);
    },
    progress: () => host.player()?.progress() ?? null,
    on: (event: 'progress' | 'state' | 'ended', callback: (value: never) => void) => events.on(event as 'ended', callback as () => void),
  };

  /**
   * Runs the command a host issued before the clip existed, once, on the first
   * route. The composition root calls it after `TourPlayer.setRoute`.
   */
  replayPendingOf.set(controls, () => {
    const command = pending;
    pending = null;
    host.player()?.setSpeed(speed);
    if (!command || !host.player()) return;
    if (command.kind === 'seek' || command.kind === 'seekDistance' || command.kind === 'seekTime') {
      controls[command.kind](command.value);
      return;
    }
    controls[command.kind]();
  });

  return controls;
}

/**
 * The replay hook of each `TourControls`, kept off the public type: a host must
 * not be able to fire someone else's pending command. The composition root
 * calls `replayPendingTourCommand(controls)` once the first route is set.
 */
const replayPendingOf = new WeakMap<TourControls, () => void>();

export function replayPendingTourCommand(controls: TourControls): void {
  replayPendingOf.get(controls)?.();
}
