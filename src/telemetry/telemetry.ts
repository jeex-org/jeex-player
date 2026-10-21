/**
 * One mounted player's telemetry: it decides whether anything is sent at all,
 * accumulates, builds each send, judges it and hands it to the transport.
 *
 * Off invariant: `createTelemetry` returns `null` when the mount said
 * `analytics: off`, when the endpoint override is refused, or when the browser
 * reports Global Privacy Control. `null` means no collector, no listener, no
 * timer and no request, ever; callers hold an optional and do nothing. GPC is
 * read again before every request.
 *
 * Send invariant: a send is built from a synchronous snapshot, wrapped in the
 * context of the moment it is built (or, for `models_loaded`, of the scene it
 * describes), judged by `isTelemetrySend`, and dropped when it fails. No
 * field links two sends beyond that shared context.
 *
 * Page invariant: the page-wide error listeners exist once per page while any
 * telemetry is live, and route each error to the OLDEST live instance, so one
 * error is reported once however many players the page mounts.
 *
 * Pure module: no `three`; the DOM only through the `TelemetryHost` it is handed.
 */

import { reportOf } from './error-report.js';
import { TelemetryCollector } from './collector.js';
import { COUNTER_CAP, dwellBucket, loadBucket, shareBucket, type FpsBucket, type WidthBucket } from './buckets.js';
import { sanitisePagePath } from './page-path.js';
import { isOwnFile } from './own-files.js';
import { sendTelemetry } from './transport.js';
import { MAX_ASSETS, isTelemetryEndpoint, isTelemetrySend } from './telemetry.schema.js';
import { UUID_V7_PATTERN } from '../scene/types.js';
import {
  DEFAULT_TELEMETRY_ENDPOINT,
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
 * How long the iframe page holds `view` and `ready` for its host's `context`,
 * in ms: long enough for a host on the same connection to answer the frame's
 * load, short enough that a host which never sends it does not lose the view.
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
  /** Calls `listener` when the document becomes hidden and on `pagehide`, until `signal` aborts. */
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
  /** `undefined` is the default endpoint; anything the endpoint check refuses turns sending off. */
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
 * The telemetry of one mount, or `null` when nothing may be sent. A refused
 * endpoint override is off; the options resolver has already said why.
 */
export function createTelemetry(config: TelemetryConfig): Telemetry | null {
  if (config.mode === 'off' || config.host.gpc()) return null;
  const endpoint = config.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT;
  if (!isTelemetryEndpoint(endpoint)) return null;
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
  private disposed = false;
  /** `view`/`ready` waiting for the iframe host's context; `null` once released. */
  private held: Array<() => TelemetrySend> | null = null;
  private stopHold: () => void = () => undefined;

  private readonly config: TelemetryConfig;
  private readonly endpoint: string;

  constructor(config: TelemetryConfig, endpoint: string) {
    this.config = config;
    this.endpoint = endpoint;
    config.host.onLeave(() => this.flush(), this.lifetime.signal);
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

  /** What is played from now on; data gathered so far keeps the old subject (flush first). */
  setSubject(subject: TelemetrySubject): void {
    this.subject = { project: uuidOrNull(subject.project), bake: uuidOrNull(subject.bake), scene: uuidOrNull(subject.scene) };
  }

  setLang(locale: string): void {
    this.lang = LANGS.has(locale) ? (locale as TelemetryLang) : 'other';
  }

  setDevice(device: DeviceFacts): void {
    this.device = device;
  }

  /** `view`, once per mount, sent now. */
  viewed(): void {
    if (this.viewSent) return;
    this.viewSent = true;
    this.soon(() => ({ ...this.context(), group: 'lifecycle', event: 'view' }));
  }

  /** `ready` for the scene on screen, sent now; `seconds` since the mount or the `loadScene` call. */
  ready(seconds: number): void {
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

  /** An error at `stage`; reported only when `reportOf` allows it. */
  error(code: TelemetryErrorCode, stage: ErrorStage, error: unknown): void {
    if (this.disposed) return;
    const report = reportOf(code, stage, error, this.config.isOwn ?? isOwnFile);
    if (report) this.collector.error(report);
  }

  /** Sends everything gathered, one request per group and per error report. */
  flush(): void {
    if (this.disposed) return;
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

  /** Flushes, then stops every listener and timer of this mount. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.flush();
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
