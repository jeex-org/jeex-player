/**
 * One mounted player's telemetry: it decides whether anything is sent at all,
 * accumulates, builds each send, judges it and hands it to the transport.
 *
 * Off invariant: `createTelemetry` returns `null` when the mount said
 * `analytics: off`, when the host named no endpoint or one the check refuses,
 * or when the browser reports Global Privacy Control. There is no default
 * endpoint. `null` means no collector, no listener, no
 * timer and no request, ever; callers hold an optional and do nothing. GPC is
 * read again before every request.
 *
 * Send invariant: a send is built from a synchronous snapshot, wrapped in the
 * context of the moment it is built (or, for `models_loaded`, of the scene it
 * describes), judged by `isTelemetrySend`, and dropped when it fails. No
 * field links two sends beyond that shared context.
 *
 * View invariant: one `view` per mount, held until the first document settles
 * (loaded, failed, or `ready`), at most `CONTEXT_HOLD_MS`, and built with the
 * subject known then (before that, with the subject `viewed` was told how to
 * read). One `engaged` per end of the view (the page hidden, the scene
 * replaced, or the mount disposed), for the engaged time since the last one,
 * under the subject it was gathered for; none for none. It goes through the
 * same iframe hold as `view`, so it never leaves before it.
 *
 * Page invariant: the page-wide error listeners exist once per page while any
 * telemetry is live, and route each error to the OLDEST live instance, so one
 * error is reported once however many players the page mounts.
 *
 * Pure module: no `three`; the DOM only through the `TelemetryHost` it is handed.
 */

import { reportOf } from './error-report.js';
import { TelemetryCollector } from './collector.js';
import { COUNTER_CAP, dwellBucket, engagedBucket, loadBucket, shareBucket, type FpsBucket, type WidthBucket } from './buckets.js';
import { sanitisePagePath } from './page-path.js';
import { isOwnFile } from './own-files.js';
import { sendTelemetry } from './transport.js';
import { MAX_ASSETS, isTelemetryEndpoint, isTelemetrySend } from './telemetry.schema.js';
import { UUID_V7_PATTERN } from '../scene/types.js';
import {
  TELEMETRY_LANGS,
  TELEMETRY_SCHEMA_VERSION,
  type CounterKey,
  type EmbedForm,
  type ErrorStage,
  type GpuClass,
  type InputType,
  type ModelOutcome,
  type TelemetryContext,
  type TelemetryErrorCode,
  type TelemetryLang,
  type TelemetrySend,
  type TelemetrySubject,
} from './vocabulary.js';

/** How often a long view flushes, in ms. */
export const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long `view` waits for the first document, and the iframe page holds
 * `view` and `ready` for its host's `context`, in ms: long enough for a host on
 * the same connection to answer the frame's load, short enough that a slow or
 * silent one does not lose the view.
 */
export const CONTEXT_HOLD_MS = 2000;

/** What telemetry needs of the page it runs on; `browser-host.ts` is the real one. */
export type TelemetryHost = {
  /** `navigator.globalPrivacyControl === true`, read now. */
  gpc(): boolean;
  /** The origin `site` names, or `null` when it is not known. */
  site(): string | null;
  /** The page path before sanitising, or `null` when it is not known. */
  page(): string | null;
  /** `browser`: family and bucketed major version. */
  browser(): string;
  /** Calls `listener` when the document becomes hidden and on `pagehide`, until `signal` aborts: the end of a view. */
  onLeave(listener: () => void, signal: AbortSignal): void;
  /** Calls `listener` for every page-wide error and unhandled rejection, until `signal` aborts. */
  onPageError(listener: (code: 'exception' | 'rejection', error: unknown) => void, signal: AbortSignal): void;
  /** A repeating timer; the returned function stops it. */
  every(ms: number, run: () => void): () => void;
  /** A one-shot timer; the returned function cancels it. */
  after(ms: number, run: () => void): () => void;
};

/** What a mount decided about telemetry. */
export type TelemetryConfig = {
  mode: 'on' | 'off';
  /** Where the sends go; `undefined`, or anything the endpoint check refuses, turns sending off. */
  endpoint: string | undefined;
  embed: EmbedForm;
  /** `package.json#version` of this build. */
  player: string;
  host: TelemetryHost;
  /** Which script URLs are the player's; the real file check by default. */
  isOwn?: (url: string) => boolean;
  /**
   * The iframe page: `view` and `ready` wait until this calls `release` (the
   * host's `context` arrived, so `site` and `page` are known), the first flush,
   * or `CONTEXT_HOLD_MS`, whichever comes first, and are then sent with what is
   * known at that moment.
   */
  hold?: ((release: () => void) => void) | undefined;
};

/** What the device send says besides frame time. */
export type DeviceFacts = { gpu: GpuClass; width: WidthBucket; input: InputType };

const NO_SUBJECT: TelemetrySubject = { project: null, bake: null, scene: null };
const LANGS: ReadonlySet<string> = new Set(TELEMETRY_LANGS);
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

/** A UUID, or `null`. */
export function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID_V7_PATTERN.test(value) ? value : null;
}

/** `subject` with every id that is not a UUID as `null`. */
function idsOf(subject: TelemetrySubject): TelemetrySubject {
  return { project: uuidOrNull(subject.project), bake: uuidOrNull(subject.bake), scene: uuidOrNull(subject.scene) };
}

/** The live instances, oldest first, and the one set of page-wide listeners they share. */
const live: Telemetry[] = [];
let pageListeners: AbortController | null = null;

function register(telemetry: Telemetry, host: TelemetryHost): void {
  live.push(telemetry);
  if (pageListeners !== null) return;
  pageListeners = new AbortController();
  host.onPageError((code, error) => live[0]?.error(code, 'runtime', error), pageListeners.signal);
}

function unregister(telemetry: Telemetry): void {
  const index = live.indexOf(telemetry);
  if (index !== -1) live.splice(index, 1);
  if (live.length > 0 || pageListeners === null) return;
  pageListeners.abort();
  pageListeners = null;
}

/**
 * The telemetry of one mount, or `null` when nothing may be sent. No endpoint
 * is off; a refused one too, and the options resolver has already said why.
 */
export function createTelemetry(config: TelemetryConfig): Telemetry | null {
  if (config.mode === 'off' || config.host.gpc()) return null;
  const endpoint = config.endpoint;
  if (endpoint === undefined || !isTelemetryEndpoint(endpoint)) return null;
  return new Telemetry(config, endpoint);
}

export class Telemetry {
  private readonly collector = new TelemetryCollector();
  private readonly lifetime = new AbortController();
  private readonly stopTimer: () => void;
  private subject: TelemetrySubject = NO_SUBJECT;
  private lang: TelemetryLang = 'other';
  private device: DeviceFacts | null = null;
  /** `models_loaded` waits for the next flush, with the context of its own scene. */
  private pendingLifecycle: TelemetrySend[] = [];
  private viewSent = false;
  /** `view` was asked for and waits for the first document. */
  private viewPending = false;
  private stopViewHold: () => void = () => undefined;
  /** What `view` names when it leaves before the first document settled. */
  private early: () => TelemetrySubject | null = () => null;
  private disposed = false;
  /** `view`/`ready` waiting for the iframe host's context; `null` once released. */
  private held: Array<() => TelemetrySend> | null = null;
  private stopHold: () => void = () => undefined;

  private readonly config: TelemetryConfig;
  private readonly endpoint: string;

  constructor(config: TelemetryConfig, endpoint: string) {
    this.config = config;
    this.endpoint = endpoint;
    config.host.onLeave(() => this.endView(), this.lifetime.signal);
    this.stopTimer = config.host.every(FLUSH_INTERVAL_MS, () => this.flush());
    register(this, config.host);
    if (config.hold) {
      this.held = [];
      this.stopHold = config.host.after(CONTEXT_HOLD_MS, () => this.release());
      config.hold(() => this.release());
    }
  }

  /** Sends what the hold kept, each built NOW, with the context known now. Idempotent. */
  private release(): void {
    const held = this.held;
    if (held === null) return;
    this.held = null;
    this.stopHold();
    for (const build of held) this.dispatch(build());
  }

  /** A lifecycle send that leaves at once, or when the hold releases it. */
  private soon(build: () => TelemetrySend): void {
    if (this.held === null) this.dispatch(build());
    else this.held.push(build);
  }

  /** What is played from now on; data gathered so far keeps the old subject (end the view first). */
  setSubject(subject: TelemetrySubject): void {
    this.subject = idsOf(subject);
  }

  setLang(locale: string): void {
    this.lang = LANGS.has(locale) ? (locale as TelemetryLang) : 'other';
  }

  setDevice(device: DeviceFacts): void {
    this.device = device;
  }

  /**
   * `view`, once per mount: it leaves when the first document settles, or
   * earlier (after `CONTEXT_HOLD_MS`, or when the view ends) with the subject
   * `early` gives then, when it gives one (a manifest already read).
   */
  viewed(early?: () => TelemetrySubject | null): void {
    if (this.viewSent) return;
    this.viewSent = true;
    this.viewPending = true;
    if (early) this.early = early;
    this.stopViewHold = this.config.host.after(CONTEXT_HOLD_MS, () => this.sendView(false));
  }

  /** The first document settled, loaded or failed: `view` leaves with the subject set now. Idempotent. */
  documentSettled(): void {
    this.sendView(true);
  }

  private sendView(settled: boolean): void {
    if (!this.viewPending) return;
    this.viewPending = false;
    this.stopViewHold();
    const early = settled ? null : this.early();
    const subject = early === null ? { ...this.subject } : idsOf(early);
    this.soon(() => ({ ...this.context(), subject, group: 'lifecycle', event: 'view' }));
  }

  /** `ready` for the scene on screen, sent now; `seconds` since the mount or the `loadScene` call. */
  ready(seconds: number): void {
    // A scene on screen is a settled document, and `view` always goes first.
    this.sendView(true);
    // The subject and the bucket are fixed now; only `site`/`page` may still be learnt.
    const subject = { ...this.subject };
    const load = loadBucket(seconds);
    this.soon(() => ({ ...this.context(), subject, group: 'lifecycle', event: 'ready', load }));
  }

  /** `models_loaded` for the scene on screen, held for the next flush with this scene's context. */
  modelsLoaded(seconds: number, outcome: ModelOutcome, failed: number, assets: readonly string[]): void {
    const ids = [...new Set(assets.map((id) => uuidOrNull(id)).filter((id): id is string => id !== null))].sort().slice(0, MAX_ASSETS);
    this.pendingLifecycle.push({
      ...this.context(),
      group: 'lifecycle',
      event: 'models_loaded',
      load: loadBucket(seconds),
      outcome,
      failed: Math.min(COUNTER_CAP, Math.max(0, Math.floor(failed))),
      assets: ids,
    });
  }

  count(key: CounterKey): void {
    this.collector.count(key);
  }

  frame(intervalMs: number, fullscreen: boolean): void {
    this.collector.frame(intervalMs, fullscreen);
  }

  dwell(room: string, ms: number): void {
    this.collector.dwell(room, ms);
  }

  /** `ms` more of engaged time, in any mode; the caller leaves pauses out. */
  engage(ms: number): void {
    this.collector.engage(ms);
  }

  /** An error at `stage`; reported only when `reportOf` allows it. */
  error(code: TelemetryErrorCode, stage: ErrorStage, error: unknown): void {
    if (this.disposed) return;
    const report = reportOf(code, stage, error, this.config.isOwn ?? isOwnFile);
    if (report) this.collector.error(report);
  }

  /** Sends everything gathered, one request per group and per error report. */
  flush(): void {
    if (this.disposed) return;
    this.sendView(false);
    this.release();
    const lifecycle = this.pendingLifecycle;
    this.pendingLifecycle = [];
    const snapshot = this.collector.snapshot();
    const context = this.context();
    for (const send of lifecycle) this.dispatch(send);
    if (snapshot.counts) this.dispatch({ ...context, group: 'actions', counts: { ...snapshot.counts } });
    if (snapshot.rooms.length > 0) {
      this.dispatch({
        ...context,
        group: 'rooms',
        rooms: snapshot.rooms.map(({ room, ms }) => ({ room, dwell: dwellBucket(ms / 1000) })),
      });
    }
    if (snapshot.frames && this.device) {
      const { buckets, totalMs, fullscreenMs } = snapshot.frames;
      const fps = Object.fromEntries(Object.entries(buckets).map(([bucket, ms]) => [bucket, shareBucket(ms / totalMs)])) as Record<
        FpsBucket,
        number
      >;
      this.dispatch({ ...context, group: 'device', fps, ...this.device, fullscreen: shareBucket(fullscreenMs / totalMs) });
    }
    const browser = this.config.host.browser();
    for (const { report, count } of snapshot.errors) this.dispatch({ ...context, group: 'error', ...report, browser, count });
  }

  /**
   * The view ends (the page hidden, the scene replaced, or the mount disposed):
   * flush, then the engaged time since the last end, both under the subject
   * they were gathered for.
   */
  endView(): void {
    if (this.disposed) return;
    this.flush();
    const ms = this.collector.takeEngaged();
    if (ms === 0) return;
    const engaged = engagedBucket(ms / 1000);
    const subject = { ...this.subject };
    this.soon(() => ({ ...this.context(), subject, group: 'lifecycle', event: 'engaged', engaged }));
  }

  /** Ends the view, then stops every listener and timer of this mount. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.endView();
    this.disposed = true;
    this.stopTimer();
    this.lifetime.abort();
    unregister(this);
  }

  private context(): TelemetryContext {
    const site = this.config.host.site();
    const page = this.config.host.page();
    return {
      schema: TELEMETRY_SCHEMA_VERSION,
      player: this.config.player,
      embed: this.config.embed,
      site: site !== null && ORIGIN.test(site) ? site : null,
      page: page === null ? null : sanitisePagePath(page),
      subject: { ...this.subject },
      lang: this.lang,
    };
  }

  private dispatch(send: TelemetrySend): void {
    if (this.config.host.gpc() || !isTelemetrySend(send)) return;
    sendTelemetry(this.endpoint, JSON.stringify(send));
  }
}
