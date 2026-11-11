/**
 * The viewer's public event fan-out: `ready`, `error`, `scene`, `mode`, `assets` and the rest of `ViewerEventMap`.
 *
 * It is the `TourEvents` pattern applied to the viewer itself (`tour-controls.ts`):
 * one fan-out per event, created on first use, and a subscriber that throws is reported and skipped
 * so one bad callback on a host page cannot stop the frame or the other
 * subscribers.
 *
 * Why events at all, next to `handle.ready`: `ready` is a ONE-SHOT promise for
 * the first scene. `loadScene` mounts a second, third, nth document, and each
 * of those needs a readiness signal of its own — a promise cannot give one.
 */

import { ViewerLibError, type ErrorDetail, type ViewerErrorCode } from '../shared/errors.js';
import { defaultLogger, type Logger } from '../shared/logger.js';
import { Fanout, type AnyFanout } from '../shared/fanout.js';
import type { SceneOp, ViewerMode } from '../scene/types.js';
import type { ViewerOptions } from './viewer-options.js';
import type { ViewerSelection } from './selection.js';
import type { TourSpeed } from '../camera/tour-player.js';
import type { AuthoringEventMap } from './authoring-events.js';

// The union itself lives in `shared/errors.ts`, one layer below everything that
// raises it, and is re-exported here because `ViewerError` is what a host
// subscribes to.
import type { LightTemperatureChange } from './light-temperature-control.js';
export type { ViewerErrorCode } from '../shared/errors.js';
export type { CheckpointLookThrough, CheckpointPlacing } from './authoring-events.js';

export type ViewerError = {
  code: ViewerErrorCode;
  message: string;
  /** JSON path of the offending field, when the failure was about a document. */
  path?: string | undefined;
  /** Whatever the failure knew beyond its message: a status, a URL, a rule. */
  detail?: ErrorDetail | undefined;
  /** The original throw, when there was one. */
  cause?: unknown;
  /**
   * `true` on the failure that took the viewer down: its error card is on
   * screen and only a `loadScene` or the card's Retry brings a scene back.
   * Absent on an error the viewer carries on through.
   */
  fatal?: true | undefined;
};

/** A scene is on screen: the first one, and every one after it. */
export type ViewerReadyInfo = { options: Readonly<ViewerOptions>; sceneId: string };

/** The document changed: a new scene, or a committed revision of this one. */
export type ViewerSceneInfo = { sceneId: string; rev: number };

/**
 * What a document's libraries delivered, once its first model pass settled:
 * the models swapped in (`upgraded`), the ones left as procedural stand-ins
 * (`failed`), whether the byte budget stopped the pass (`budget`), and the
 * textures whose surface stayed flat.
 */
export type ViewerAssetsInfo = {
  models: { upgraded: number; failed: number; budget: boolean };
  /** `budget`: the texture byte budget was reached, and the surfaces still waiting stayed flat. */
  textures: { failed: number; budget: boolean };
};

/**
 * An edit made in the viewer's OWN panel while `edits: 'emit'` is in force: the
 * viewer does NOT commit it and waits for the host's document instead.
 *
 * `baseRev` is `model.rev` at the moment of the click, so a host that applies
 * the batch to its own copy can tell whether anything moved underneath it.
 */
export type ViewerEditRequest = { ops: SceneOp[]; baseRev: number };

/** The rows every viewer raises; the authoring tools' rows are in `authoring-events.ts`. */
export type CoreEventMap = {
  ready: ViewerReadyInfo;
  error: ViewerError;
  scene: ViewerSceneInfo;
  mode: ViewerMode;
  /** Once per document, when its first model pass settled: what loaded and what fell back (`ViewerAssetsInfo`). */
  assets: ViewerAssetsInfo;
  /** A click named something (or nothing) in the scene; only with `options.select`. */
  select: ViewerSelection;
  /** The built-in panel produced a batch the viewer did not commit; only with `edits: 'emit'`. */
  edit: ViewerEditRequest;
  /**
   * The walk's current tour camera changed — the walker arrived on one (the
   * entry glide, a step) — or the number of cameras did (a new document).
   * `index` is 0-based, `null` before the walker has stood on any;
   * `getState().walk` reads the same pair.
   */
  walkCamera: ViewerWalkCamera;
  /** The tour's speed setting changed (`tour.setSpeed`, the tour bar's speed button). */
  tourSpeed: ViewerTourSpeed;
  /**
   * The colour temperature of the artificial light changed: `temperature` in
   * kelvin or `null` for «Original», `source` says whether the host or the
   * viewer's settings panel changed it. Never raised for an unchanged value.
   */
  lightTemperature: LightTemperatureChange;
};

/** Every event a host can subscribe to. */
export type ViewerEventMap = CoreEventMap & AuthoringEventMap;

/** The `tourSpeed` payload: the factor of the tour's 1x pace. */
export type ViewerTourSpeed = { readonly speed: TourSpeed };

/** The `walkCamera` payload: the current tour camera (0-based, `null` when none) and how many there are. */
export type ViewerWalkCamera = { readonly index: number | null; readonly count: number };

export type ViewerEventName = keyof ViewerEventMap;

export class ViewerEvents {
  private readonly log: Logger;
  /**
   * One `Fanout` per event, created when the event is first named by `on` or
   * `emit`; each carries the same failure sink. The copy-before-iterate and the
   * per-subscriber try/catch live there (`shared/fanout.ts`).
   */
  private readonly listeners = new Map<ViewerEventName, AnyFanout>();

  constructor(log: Logger = defaultLogger) {
    this.log = log;
  }

  private fanout<K extends ViewerEventName>(event: K): Fanout<[ViewerEventMap[K]]> {
    // The map holds each event's own fan-out under its own name, so the read is of that event's type.
    const known = this.listeners.get(event) as Fanout<[ViewerEventMap[K]]> | undefined;
    if (known) return known;
    const fanout = new Fanout<[ViewerEventMap[K]]>((error) => this.log.error('listener-failed', `viewer ${event} listener failed`, error));
    this.listeners.set(event, fanout);
    return fanout;
  }

  on<K extends ViewerEventName>(event: K, callback: (payload: ViewerEventMap[K]) => void): () => void {
    return this.fanout(event).add(callback);
  }

  emit<K extends ViewerEventName>(event: K, payload: ViewerEventMap[K]): void {
    this.fanout(event).emit(payload);
  }

  /** Drops every subscriber of every event named so far; part of viewer teardown. */
  clear(): void {
    for (const listeners of this.listeners.values()) listeners.clear();
  }
}

/**
 * Which half of loading a scene failed.
 *
 * Every failure the library raises is a `ViewerLibError` and carries its own
 * code, so this is a lookup rather than a message-prefix sniff:
 * a host repository that throws something of its own is a source failure, which is exactly what `scene-load` means.
 */
export function sceneErrorCode(error: unknown): ViewerErrorCode {
  return error instanceof ViewerLibError ? error.code : 'scene-load';
}

/**
 * Wraps anything thrown into the reportable shape, keeping the original.
 *
 * A `ViewerLibError` hands over its `path` and `detail` too, so a host that
 * subscribes to `error` sees the same structure the throw carried — it never
 * has to parse the sentence back apart.
 */
export function toViewerError(code: ViewerErrorCode, error: unknown, fallbackMessage: string): ViewerError {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (error instanceof ViewerLibError) return { code, message, path: error.path, detail: error.detail, cause: error };
  return { code, message, cause: error };
}
