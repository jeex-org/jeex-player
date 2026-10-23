/**
 * The viewer's public event fan-out: `ready`, `error`, `scene` and `mode`.
 *
 * It is the `TourEvents` pattern applied to the viewer itself (`tour-controls.ts`):
 * one registry per event, and a subscriber that throws is reported and skipped
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
import type { CheckpointEdit, CheckpointSelect } from '../camera/checkpoint-overlay.js';
import type { TourSpeed } from '../camera/tour-player.js';
import type { AssetEdit, AssetEditRefused } from '../edit/asset-edit.js';

// The union itself lives in `shared/errors.ts`, one layer below everything that
// raises it, and is re-exported here because `ViewerError` is what a host
// subscribes to.
import type { LightTemperatureChange } from './light-temperature-control.js';
export type { ViewerErrorCode } from '../shared/errors.js';

export type ViewerError = {
  code: ViewerErrorCode;
  message: string;
  /** JSON path of the offending field, when the failure was about a document. */
  path?: string | undefined;
  /** Whatever the failure knew beyond its message: a status, a URL, a rule. */
  detail?: ErrorDetail | undefined;
  /** The original throw, when there was one. */
  cause?: unknown;
};

/** A scene is on screen: the first one, and every one after it. */
export type ViewerReadyInfo = { options: Readonly<ViewerOptions>; sceneId: string };

/** The document changed: a new scene, or a committed revision of this one. */
export type ViewerSceneInfo = { sceneId: string; rev: number };

/**
 * An edit made in the viewer's OWN panel while `edits: 'emit'` is in force: the
 * viewer does NOT commit it and waits for the host's document instead.
 *
 * `baseRev` is `model.rev` at the moment of the click, so a host that applies
 * the batch to its own copy can tell whether anything moved underneath it.
 */
export type ViewerEditRequest = { ops: SceneOp[]; baseRev: number };

export type ViewerEventMap = {
  ready: ViewerReadyInfo;
  error: ViewerError;
  scene: ViewerSceneInfo;
  mode: ViewerMode;
  /** A click named something (or nothing) in the scene; only with `options.select`. */
  select: ViewerSelection;
  /** The built-in panel produced a batch the viewer did not commit; only with `edits: 'emit'`. */
  edit: ViewerEditRequest;
  /** A tour-checkpoint marker was clicked (`id: null` — the focus was cleared); placement overlay only. */
  checkpointSelect: CheckpointSelect;
  /** A placement gesture (drag, add) finished; the HOST commits the list. */
  checkpointEdit: CheckpointEdit;
  /**
   * The walk's current tour camera changed — the walker arrived on one (the
   * entry glide, a step) — or the number of cameras did (a new document).
   * `index` is 0-based, `null` before the walker has stood on any;
   * `getState().walk` reads the same pair.
   */
  walkCamera: ViewerWalkCamera;
  /** The tour's speed setting changed (`tour.setSpeed`, the tour bar's speed button). */
  tourSpeed: ViewerTourSpeed;
  /** A look-through began (`id` — the camera piloted) or ended (`null`); tour-camera tool only. */
  checkpointLookThrough: CheckpointLookThrough;
  /** Click-to-place began (`active: true`) or ended — a drop, Esc, or a mode change; tour-camera tool only. */
  checkpointPlacing: CheckpointPlacing;
  /**
   * The asset move tool released a legal move: `move_object` (+ `rotate_object`) for the HOST to commit as one
   * batch on `baseRev`; the new pose stays on screen until the document
   * answers, `handle.revertAssetEdit()` puts the start pose back.
   */
  assetEdit: AssetEdit;
  /** A move ended illegal and reverted; `issues` are the hard layout issues of the final pose. */
  assetEditRefused: AssetEditRefused;
  /**
   * A drag or an arrow/Q/E burst of the asset move tool began (`dragging`,
   * `nudging`) or ended (`idle`): a host hides what it hangs over the object
   * (a host editor's selection card) while it moves. Edges only, never per frame.
   */
  assetMoveState: AssetMoveStateEvent;
  /**
   * The colour temperature of the artificial light changed: `temperature` in
   * kelvin or `null` for «Original», `source` says whether the host or the
   * viewer's settings panel changed it. Never raised for an unchanged value.
   */
  lightTemperature: LightTemperatureChange;
};

/** The `assetMoveState` payload. */
export type AssetMoveStateEvent = { readonly phase: 'idle' | 'dragging' | 'nudging' };

/** The `checkpointLookThrough` payload. */
export type CheckpointLookThrough = { readonly id: string | null };

/** The `checkpointPlacing` payload. */
export type CheckpointPlacing = { readonly active: boolean };

/** The `tourSpeed` payload: the factor of the tour's 1x pace. */
export type ViewerTourSpeed = { readonly speed: TourSpeed };

/** The `walkCamera` payload: the current tour camera (0-based, `null` when none) and how many there are. */
export type ViewerWalkCamera = { readonly index: number | null; readonly count: number };

export type ViewerEventName = keyof ViewerEventMap;

type Registry = { [K in ViewerEventName]: Fanout<[ViewerEventMap[K]]> };

export class ViewerEvents {
  private readonly log: Logger;

  private readonly listeners: Registry;

  constructor(log: Logger = defaultLogger) {
    this.log = log;
    // One `Fanout` per event, each with the same failure sink: the copy-before-
    // iterate and the per-subscriber try/catch live there now (`shared/fanout.ts`).
    const fanout = <K extends ViewerEventName>(event: K): Fanout<[ViewerEventMap[K]]> =>
      new Fanout<[ViewerEventMap[K]]>((error) => this.log.error('listener-failed', `viewer ${event} listener failed`, error));
    this.listeners = {
      ready: fanout('ready'),
      error: fanout('error'),
      scene: fanout('scene'),
      mode: fanout('mode'),
      select: fanout('select'),
      edit: fanout('edit'),
      checkpointSelect: fanout('checkpointSelect'),
      checkpointEdit: fanout('checkpointEdit'),
      walkCamera: fanout('walkCamera'),
      tourSpeed: fanout('tourSpeed'),
      checkpointLookThrough: fanout('checkpointLookThrough'),
      checkpointPlacing: fanout('checkpointPlacing'),
      assetEdit: fanout('assetEdit'),
      assetEditRefused: fanout('assetEditRefused'),
      assetMoveState: fanout('assetMoveState'),
      lightTemperature: fanout('lightTemperature'),
    };
  }

  on<K extends ViewerEventName>(event: K, callback: (payload: ViewerEventMap[K]) => void): () => void {
    return (this.listeners[event] as Fanout<[ViewerEventMap[K]]>).add(callback);
  }

  emit<K extends ViewerEventName>(event: K, payload: ViewerEventMap[K]): void {
    (this.listeners[event] as Fanout<[ViewerEventMap[K]]>).emit(payload);
  }

  /** Drops every subscriber; part of viewer teardown. */
  clear(): void {
    for (const listeners of Object.values(this.listeners) as AnyFanout[]) listeners.clear();
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
