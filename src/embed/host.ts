/**
 * The embedding page's side of the iframe transport: `embedViewer(container,
 * options)` builds the frame, speaks the protocol to it, and hands back an
 * object shaped like the handle a same-page host would have held.
 *
 * Weight invariant, and it is the reason this file exists at all: a page that
 * embeds by iframe must not download the viewer. Nothing here imports the
 * viewer — only `protocol.ts`, which is the wire and nothing more — and
 * `budget-check.ts` fails the build at 4 KB gzip, which no accidental import
 * back into `src/` could survive.
 *
 * Ordering invariant: commands issued before the frame reports `ready` are
 * QUEUED and flushed in order, so a host can call `embed.play()` on the line
 * after `embedViewer(...)` and mean it. The frame's own `not-ready` answer
 * exists for a hand-written host that skips this; through the helper it is
 * unreachable.
 *
 * Liveness invariant: every command times out. A frame that never loads, or
 * one on an origin that answers nothing, must reject the host's promise rather
 * than leave it pending for the life of the page.
 */

import {
  DEFAULT_VIEWER_ID,
  commandMessage,
  isJeexMessage,
  type CaptureStillRequest,
  type CapturePanoramaRequest,
  type CommandMethod,
  type EmbedEventMap,
  type ErrorCode,
  type EventName,
  type JeexReply,
  type Locale,
  type SceneData,
  type TourProgress,
  type TourSpeed,
  type ViewerMode,
  type Provenance,
  type ViewerState,
  type ViewerSelectionTarget,
} from './protocol.js';
import { MAX_SCENE_BYTES, inlineDocumentBytes } from '../shared/limits.js';

/** How long a command waits for its REPLY, once the frame has been sent it, ms. */
export const REPLY_TIMEOUT_MS = 5000;

/**
 * How long a command raised before `ready` waits for the frame to come up, ms.
 *
 * It is a second, longer window on purpose. A reply clock started at the CALL
 * would let a command issued on the line after `embedViewer` — which the
 * queue exists to make legal — spend most of its five seconds waiting for a
 * boot and then time out on a frame that answers perfectly. Two named
 * windows, each doing one job: this one covers the boot, `REPLY_TIMEOUT_MS`
 * covers the round trip, and nothing waits forever either way.
 */
export const QUEUE_TIMEOUT_MS = 20_000;

/**
 * One thing the host handle wants to say. Structurally identical to the
 * viewer's own `LogEntry` (`shared/logger.ts`) and DELIBERATELY not imported
 * from it: nothing in this file may import viewer code, or a page that embeds
 * by iframe would download the viewer it was avoiding (`budget-check.ts` fails
 * the build at 4 KB gzip). The two shapes are checked against each other by
 * `host.test.ts`.
 */
export type EmbedLogEntry = { level: 'warn' | 'error'; code: string; message: string; detail?: unknown };

/**
 * Structurally identical to `ExportGlbOptions` (`app/export-gltf.ts`), and
 * DELIBERATELY not imported from it, for the same reason as `EmbedLogEntry`:
 * `host.ts` may import no viewer code, or a page that embeds by iframe would
 * download the viewer it was avoiding. The two shapes are checked against
 * each other by `host.test.ts`.
 */
export type EmbedExportGlbOptions = {
  includeFurniture?: boolean;
  state?: 'current' | 'default';
  embedDocument?: boolean;
};

/** Structurally identical to `ExportUsdzOptions` (`app/export-usdz.ts`), for the same reason as `EmbedExportGlbOptions`. */
export type EmbedExportUsdzOptions = {
  includeFurniture?: boolean;
};

/** Where the host handle's own warnings go; `EmbedOptions.onLog` replaces it. */
type EmbedLogSink = (entry: EmbedLogEntry) => void;

const embedConsoleSink: EmbedLogSink = (entry) => {
  const line = `[jeex-viewer] ${entry.code}: ${entry.message}`;
  if (entry.level === 'error') console.error(line, entry.detail);
  else console.warn(line, entry.detail);
};

/** Query parameter carrying the host's origin, which the frame answers to. */
export const HOST_PARAM = 'host';
/** Query parameter naming which viewer of several the frame is. */
export const VIEWER_ID_PARAM = 'viewerId';

/**
 * The frame's own box, applied through the CSSOM.
 *
 * A `style` attribute needs `style-src-attr 'unsafe-inline'` from the HOST's
 * policy, which is not a thing a helper may quietly require; `setProperty` is
 * not governed by any CSP directive (README, "Content Security Policy").
 */
const FRAME_STYLE: ReadonlyArray<readonly [string, string]> = [
  ['border', '0'],
  ['width', '100%'],
  ['height', '100%'],
];

/**
 * The default sandbox, and the reason it is not tighter.
 *
 * `allow-scripts` with `allow-same-origin` is a no-op sandbox for a frame on
 * the host's OWN origin, and that is understood — but dropping
 * `allow-same-origin` gives the frame an OPAQUE origin, whose `event.origin`
 * serialises as `"null"`. Both sides of this protocol check `event.origin`
 * against an exact string and neither may accept `"null"`, so an opaque frame
 * could not answer the host at all: the helper would time out on every command.
 *
 * The real isolation is therefore an ORIGIN, not a sandbox flag — serve the
 * viewer from its own (README, "iframe permissions and origin"). Pass
 * `sandbox` to override this when the host knows better, `''` for the
 * strictest one the browser has.
 */
const FRAME_SANDBOX = 'allow-scripts allow-same-origin';

/**
 * Accessible name of the frame when the host names none.
 *
 * English, and a constant rather than a message key on purpose: this helper is
 * the 4 KB half of the library that never loads the viewer, so it has no
 * catalogue and no locale (`messages.ts` lives on the other side of that
 * budget). A host with another language passes `title`.
 */
export const DEFAULT_FRAME_TITLE = 'JEEX apartment viewer';

/** Option keys that configure the EMBED; everything else goes in the query. */
const EMBED_KEYS: ReadonlySet<string> = new Set(['src', 'viewerId', 'allowFullscreen', 'title', 'sandbox', 'autoHeight']);

/**
 * What `embedViewer` takes: where the frame lives, who it is, and — as any
 * other key — the viewer's own options in their QUERY spelling (`view`,
 * `minimap`, `tourStart`, `scene`, …).
 *
 * Those extra keys are forwarded verbatim and validated by the FRAME, because
 * there is one options validator in this project and it is not here
 * (`viewer-options.resolveViewerOptions`). A host that misspells one gets the
 * viewer's own warning in the frame's console, not a second dialect of it.
 */
type EmbedOptions = {
  /** URL of the viewer's `embed.html`, on the origin that serves it. */
  src: string;
  /** Names this frame when one page drives several; defaults to `jeex`. */
  viewerId?: string;
  /** Whether the frame may go fullscreen. Default `true`. */
  allowFullscreen?: boolean;
  /**
   * Accessible name of the frame, in the HOST page's language. Every iframe
   * needs one (WCAG 4.1.2, axe `frame-title`); defaults to
   * `DEFAULT_FRAME_TITLE`, which is English.
   */
  title?: string;
  /**
   * `sandbox` attribute, overriding the default. See `FRAME_SANDBOX` for why
   * the default keeps `allow-same-origin` and why an ORIGIN, not a flag, is
   * what isolates an untrusted scene.
   */
  sandbox?: string;
  /**
   * Size the frame to its CONTENT instead of filling the
   * container: the frame starts at the container's width and a 16:9 box, then
   * takes the height the frame page reports in its `size` event (the width at
   * the frame's `ratio` option). The script fallback for the browsers that
   * have no responsive iframes (`frame-sizing: content-height`, README
   * "Responsive iframes"). Default `false`: the frame fills the container,
   * which must then have a height.
   */
  autoHeight?: boolean;
  /**
   * Where the handle's own warnings go. Absent means the console, prefixed
   * `[jeex-viewer]` — the same shape and prefix the viewer inside the frame
   * uses for `ViewerOptions.onLog`.
   */
  onLog?: EmbedLogSink;
} & Record<string, unknown>;

/**
 * One artefact as it crosses the frame boundary: the PNG bytes and the
 * provenance sidecar, both structured-cloned. A host turns the bytes into
 * whatever it needs (`new Blob([png], { type: 'image/png' })`, an upload, a
 * `File`) — the helper does not decide that for it.
 */
export type EmbedCapture = { png: ArrayBuffer; provenance: Provenance };

/** What the frame reports when its first scene is on screen. */
type EmbedReady = EmbedEventMap['ready'];

/**
 * The `ready` payload, proved by hand.
 *
 * The host helper carries no Zod — one `zod/mini` is 4.39 KB gzip and this
 * whole helper's budget is 4 KB (`scripts/budget-check.ts`) — so the host
 * side writes its protocol checks out by hand, and this is one of three: the
 * envelope (`protocol.ts` `isJeexMessage`, run against `isJeexEnvelope` in
 * `protocol.schema.test.ts`), this payload, and the `size` height below. This
 * one's contract is `embed/protocol.schema.readyPayloadSchema`, and
 * `host.test.ts` runs the two over one set of fixtures so they cannot drift;
 * `src/purity.test.ts` proves this module reaches no Zod at all.
 *
 * `sceneId` is the whole of it: `options` is `unknown` on the wire, so there is
 * nothing about it a check could prove, and a `ready` that names only its
 * `sceneId` has always been accepted here.
 */
function readyPayload(payload: unknown): EmbedReady | null {
  if (typeof payload !== 'object' || payload === null) return null;
  // The value that travels on is the one the frame sent, not a copy: a host
  // reading `options` must see the object the viewer actually mounted with.
  return typeof (payload as { sceneId?: unknown }).sceneId === 'string' ? (payload as EmbedReady) : null;
}

/** Where the scene comes from, as a host may name it across a frame boundary. */
type EmbedSceneSource = { url: string } | { document: unknown };

/**
 * Viewer ids in use on THIS page, so two frames cannot answer to one name.
 *
 * A collision is silent and awful: the host's `message` filter keys on
 * `viewerId`, so both handles would settle each other's commands and deliver
 * each other's events. `dispose()` gives the id back.
 */
const claimedIds = new Set<string>();

/** A viewer id nothing else on this page is using. */
function freshViewerId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random !== undefined) return `${DEFAULT_VIEWER_ID}-${random}`;
  // No `crypto.randomUUID` (an insecure context, an old engine): a counter is
  // enough, because the only thing it has to be unique against is this page.
  let index = 1;
  while (claimedIds.has(`${DEFAULT_VIEWER_ID}-${index}`)) index += 1;
  return `${DEFAULT_VIEWER_ID}-${index}`;
}

/**
 * The host's handle on an embedded viewer. Every call is a round trip, so
 * everything returns a promise — including the ones the in-page `ViewerHandle`
 * answers synchronously.
 */
export type JeexEmbed = {
  readonly iframe: HTMLIFrameElement;
  /** The id this frame answers to; generated when the host named none. */
  readonly viewerId: string;
  /** Resolves when the frame's first scene is on screen. */
  ready: Promise<EmbedReady>;
  play(): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  stop(): Promise<void>;
  seek(fraction: number): Promise<void>;
  seekDistance(metres: number): Promise<void>;
  seekTime(seconds: number): Promise<void>;
  /** The tour's speed setting; `progress` events carry it back. */
  setTourSpeed(speed: TourSpeed): Promise<void>;
  /** The tour's position, or `null` while the scene carries no clip. */
  progress(): Promise<TourProgress | null>;
  loadScene(source: EmbedSceneSource): Promise<void>;
  setMode(mode: ViewerMode): Promise<void>;
  getMode(): Promise<ViewerMode>;
  focusRoom(roomId: string): Promise<boolean>;
  /**
   * Mode, tour position, furniture, locale, scene and revision in ONE round
   * trip. Across a frame boundary the alternative is six messages whose answers
   * can disagree about the moment they describe.
   */
  getState(): Promise<ViewerState>;
  /**
   * A deep copy of the frame's committed document, or `null` before its first
   * scene is built. Answered before `ready`, like `dispose` — a host may ask
   * what is on screen before there is anything.
   */
  getScene(): Promise<SceneData | null>;
  setFurnitureVisible(visible: boolean): Promise<void>;
  setLocale(locale: Locale): Promise<void>;
  /** Highlights one wall, opening, room or asset in the frame, or clears it with `null`. */
  setSelection(target: ViewerSelectionTarget | null): Promise<void>;
  /** Re-measures the frame's container, for a host whose own layout just changed. */
  resize(): Promise<void>;
  /**
   * One still of the frame's scene, with its provenance. Rejects `not-ready`
   * until the frame's first scene is on screen — the queue in front of every
   * command already waits for that.
   */
  captureStill(request: CaptureStillRequest): Promise<EmbedCapture>;
  /** One equirectangular 360 of one room, with its provenance. */
  capturePanorama(request: CapturePanoramaRequest): Promise<EmbedCapture>;
  /**
   * The staged picture and the unaltered original of the same shot, which is
   * what disclosure rules for virtually staged photos ask for. Two `captureStill`
   * round trips, composed here rather than in the frame.
   */
  capturePair(request: Omit<CaptureStillRequest, 'state'>): Promise<{ current: EmbedCapture; default: EmbedCapture }>;
  /**
   * The committed document as a GLB, with the element metadata table riding
   * along as `EXT_structural_metadata` / `EXT_mesh_features`
   * (`app/export-gltf.ts`). Crosses the frame boundary as an `ArrayBuffer` —
   * wrap it in a `Blob` (`type: 'model/gltf-binary'`) to hand it to a
   * download link or `URL.createObjectURL`. Rejects with `not-ready` before
   * the frame's first scene.
   */
  exportGlb(options?: EmbedExportGlbOptions): Promise<ArrayBuffer>;
  /**
   * The committed document as a USDZ, for iOS Quick Look (`app/export-usdz.ts`).
   * Crosses the frame boundary as an `ArrayBuffer`, the same shape `exportGlb`
   * uses. Rejects with `not-ready` before the frame's first scene.
   */
  exportUsdz(options?: EmbedExportUsdzOptions): Promise<ArrayBuffer>;
  /** Subscribes to one frame event; returns the unsubscribe, like `TourControls`. */
  on<K extends EventName>(event: K, callback: (payload: EmbedEventMap[K]) => void): () => void;
  /** Tells the frame to tear down, then removes it and stops listening. */
  dispose(): void;
};

/** A command sent and not yet answered. */
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * A command the frame refused, or never answered.
 *
 * `code` is the protocol's own `ErrorCode` and nothing else: an unanswered
 * command is `timeout`, which is in the union, so a host has ONE list of
 * codes to branch on rather than a union plus a special case.
 */
export class EmbedError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EmbedError';
    this.code = code;
  }
}

/** Telemetry off in any spelling (`'off'`, `false`, `null`, `{ mode: 'off' }`, a typo): it fails closed, like the frame's resolver. */
function analyticsOff(analytics: unknown): boolean {
  const mode = typeof analytics === 'object' && analytics !== null ? (analytics as { mode?: unknown }).mode : analytics;
  return mode !== undefined && mode !== 'on';
}

/** `?host=…&viewerId=…` plus every option key, in the viewer's query spelling. */
function frameSearch(options: EmbedOptions, viewerId: string, hostOrigin: string): string {
  const params = new URLSearchParams();
  params.set(HOST_PARAM, hostOrigin);
  params.set(VIEWER_ID_PARAM, viewerId);
  for (const [key, value] of Object.entries(options)) {
    if (EMBED_KEYS.has(key) || value === undefined) continue;
    // Only a scalar has a query spelling. Anything else would reach the frame
    // as "[object Object]" and silently mis-configure it, so it is dropped.
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    params.set(key, String(value));
  }
  // An object or `null` has no query spelling: the switch goes on its own, so no "off" is lost.
  const analytics = options['analytics'];
  if (analyticsOff(analytics)) params.set('analytics', 'off');
  const endpoint = (analytics as { endpoint?: unknown } | null | undefined)?.endpoint;
  if (typeof endpoint === 'string') params.set('analyticsEndpoint', endpoint);
  return params.toString();
}

/**
 * Builds the iframe, points it at `options.src` and returns the host handle.
 *
 * The frame is created with `allow="fullscreen"` (without it the viewer's
 * fullscreen button reports that fullscreen is unavailable), an accessible
 * `title`, `referrerpolicy="no-referrer"`, `loading="lazy"` and the sandbox
 * `FRAME_SANDBOX` documents. `allow-scripts` with `allow-same-origin` lifts
 * the sandbox for a SAME-ORIGIN frame, which is why the viewer belongs on an
 * origin of its own when the scene content is not trusted.
 */
export function embedViewer(container: HTMLElement, options: EmbedOptions): JeexEmbed {
  const viewerId = options.viewerId ?? freshViewerId();
  if (claimedIds.has(viewerId)) {
    throw new EmbedError('bad-params', `viewerId ${JSON.stringify(viewerId)} is already driving a frame on this page`);
  }
  claimedIds.add(viewerId);
  const hostOrigin = window.location.origin;
  const source = new URL(options.src, window.location.href);
  const frameOrigin = source.origin;

  /** Where the handle's own warnings go; `EmbedOptions.onLog` replaces it. */
  const log: EmbedLogSink = (entry) => {
    try {
      (options.onLog ?? embedConsoleSink)(entry);
    } catch {
      // The reporter is what failed; there is nothing left to report it to.
    }
  };

  // The guardrail, not the control: for a frame on the host's OWN origin the
  // default sandbox is a no-op (`FRAME_SANDBOX` above), and the real isolation
  // is serving the viewer from an origin of its own. The misconfiguration that
  // matters most would otherwise pass in silence, so it is named
  // once, at build time, through the handle's own log. The embed is still built — it is the host's page and the
  // host's decision; this only makes sure the decision was an informed one.
  if (frameOrigin === hostOrigin) {
    log({
      level: 'warn',
      code: 'same-origin-frame',
      message:
        'jeex embed: the frame is served from the host page\'s own origin, where the sandbox is a no-op — serve embed.html from an origin of its own when the scene content is not fully trusted (README, "iframe permissions and origin")',
      detail: { frameOrigin },
    });
  }

  source.search = frameSearch(options, viewerId, hostOrigin);

  const iframe = document.createElement('iframe');
  if (options.allowFullscreen ?? true) iframe.setAttribute('allow', 'fullscreen');
  iframe.setAttribute('sandbox', options.sandbox ?? FRAME_SANDBOX);
  // Every iframe needs an accessible name; without one the helper injected a
  // WCAG 4.1.2 violation into every host page that used it.
  iframe.title = options.title ?? DEFAULT_FRAME_TITLE;
  // The viewer needs no referrer, and a host's URL is the host's business.
  iframe.referrerPolicy = 'no-referrer';
  // A frame below the fold costs the host nothing until it is scrolled to.
  iframe.loading = 'lazy';
  for (const [property, value] of FRAME_STYLE) iframe.style.setProperty(property, value);
  const autoHeight = options.autoHeight === true;
  if (autoHeight) {
    // The box before the first report: the container's width at the frame's
    // own `ratio` (16:9 when it names none or no ratio), so the frame neither
    // collapses to the 150 px default nor jumps when the report lands. Read
    // by a pattern, not `embed/ratio.ts`: this helper imports no viewer code.
    const ratio = /^\s*(\d+(?:\.\d+)?)\s*(?:[:/]\s*(\d+(?:\.\d+)?)\s*)?$/.exec(
      typeof options['ratio'] === 'string' ? options['ratio'] : '',
    );
    const wide = Number(ratio?.[1]);
    const tall = ratio?.[2] === undefined ? 1 : Number(ratio[2]);
    iframe.style.setProperty('display', 'block');
    iframe.style.setProperty('height', 'auto');
    iframe.style.setProperty('aspect-ratio', wide > 0 && tall > 0 ? `${wide} / ${tall}` : '16 / 9');
  }
  iframe.src = source.href;
  container.appendChild(iframe);

  const pending = new Map<string, Pending>();
  const listeners = new Map<EventName, Set<(payload: never) => void>>();
  /** Set once the frame is up; the reply clock starts here for a queued command. */
  /** Commands raised before `ready`; sent, in order, the moment it arrives. */
  let queue: Array<() => void> = [];
  let ready = false;
  let disposed = false;
  let nextId = 0;

  let announceReady: (info: EmbedReady) => void = () => undefined;
  let failReady: (error: Error) => void = () => undefined;
  const readyPromise = new Promise<EmbedReady>((resolve, reject) => {
    announceReady = resolve;
    failReady = reject;
  });
  // A host that never awaits `ready` (it listens for the event instead) must
  // not get an unhandled rejection out of `dispose`. `await embed.ready` still
  // throws: this handles a DERIVED promise, not the one handed out.
  readyPromise.catch(() => undefined);

  const deliver = (event: EventName, payload: unknown): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      try {
        (listener as (value: unknown) => void)(payload);
      } catch (error) {
        log({ level: 'error', code: 'listener-failed', message: `jeex embed: ${event} listener failed`, detail: error });
      }
    }
  };

  const settle = (reply: JeexReply): void => {
    const waiting = pending.get(reply.id);
    if (!waiting) return;
    pending.delete(reply.id);
    clearTimeout(waiting.timer);
    if (reply.ok) waiting.resolve(reply.result);
    else waiting.reject(new EmbedError(reply.error?.code ?? 'internal', reply.error?.message ?? 'the frame gave no reason'));
  };

  function onMessage(event: MessageEvent): void {
    // Who, then what: only this frame, only its origin, only this protocol,
    // only this viewer.
    if (event.source !== iframe.contentWindow || event.origin !== frameOrigin) return;
    const data: unknown = event.data;
    if (!isJeexMessage(data) || data.viewerId !== viewerId) return;
    if (data.kind === 'reply') {
      settle(data);
      return;
    }
    if (data.kind !== 'event') return;
    if (data.event === 'ready') {
      const info = readyPayload(data.payload);
      // A `ready` the frame cannot back up is not a readiness: the handle does
      // not become ready, the queue is not flushed and no listener hears it.
      // The existing `QUEUE_TIMEOUT_MS` then gives the host an honest timeout
      // instead of a silently accepted nothing. A log code, not a new
      // `ErrorCode`: nothing was asked, so there is nothing to answer.
      if (info === null) {
        log({
          level: 'error',
          code: 'ready-invalid',
          message: 'jeex embed: the frame reported ready without a sceneId',
          detail: data.payload,
        });
        return;
      }
      if (!ready) {
        ready = true;
        announceReady(info);
        const held = queue;
        queue = [];
        for (const send of held) send();
      }
    }
    if (autoHeight && data.event === 'size') {
      // Proved by hand like `readyPayload`: no Zod in this 4 KB helper. The
      // contract is the `size` branch of `eventSchema` (a finite `height`);
      // only a positive one is applied, an empty frame never collapses the
      // iframe to nothing.
      const height = (data.payload as { height?: unknown } | null)?.height;
      if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
        iframe.style.setProperty('aspect-ratio', 'auto');
        iframe.style.setProperty('height', `${Math.ceil(height)}px`);
      }
    }
    deliver(data.event, data.payload);
  }

  /** The `message` listener's lifetime; `dispose()` is one `abort()`. */
  const transport = new AbortController();
  window.addEventListener('message', onMessage, { signal: transport.signal });
  // The host page's path for the frame's telemetry (TELEMETRY.md): by postMessage, never in the frame
  // URL, not at all when it is off. The reply matches no pending command and is dropped.
  if (!analyticsOff(options['analytics'])) {
    const page = { page: window.location.pathname };
    const post = () => iframe.contentWindow?.postMessage(commandMessage(viewerId, 'context', 'context', page), frameOrigin);
    iframe.addEventListener('load', post, { signal: transport.signal });
  }

  const send = (method: CommandMethod, params?: Record<string, unknown>): Promise<unknown> => {
    if (disposed) return Promise.reject(new EmbedError('disposed', 'this embed has been disposed'));
    const id = `c${(nextId += 1)}`;
    return new Promise<unknown>((resolve, reject) => {
      // The REPLY clock starts when the command is posted, not when it is
      // called: a command raised on the line after `embedViewer` waits out the
      // frame's whole boot, and a slow boot is not a command that failed.
      // Declared before `post` closes over it: a command sent straight away
      // never has a boot timer, and `clearTimeout(undefined)` is a no-op.
      let booting: ReturnType<typeof setTimeout> | undefined;
      const post = (): void => {
        clearTimeout(booting);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new EmbedError('timeout', `no reply to ${method} within ${REPLY_TIMEOUT_MS} ms`));
        }, REPLY_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        try {
          iframe.contentWindow?.postMessage(commandMessage(viewerId, id, method, params), frameOrigin);
        } catch (error) {
          // `postMessage` throws synchronously on a payload it cannot clone.
          // The command was never sent, so its slot and its clock go with it —
          // otherwise the reply timer would fire five seconds later on a
          // promise that has already rejected.
          clearTimeout(timer);
          pending.delete(id);
          reject(error instanceof Error ? error : new EmbedError('bad-params', String(error)));
        }
      };
      // `getScene` joins `dispose`: a host may ask what is on screen before the
      // frame has anything, and `null` is the honest answer rather than a wait
      // for a `ready` that has not happened yet.
      if (ready || method === 'dispose' || method === 'getScene') {
        post();
        return;
      }
      // Queued, and on its own clock: a frame that never comes up must reject
      // the command rather than leave it pending for the life of the page.
      booting = setTimeout(() => {
        queue = queue.filter((queued) => queued !== post);
        reject(new EmbedError('timeout', `the frame was not ready within ${QUEUE_TIMEOUT_MS} ms, so ${method} was never sent`));
      }, QUEUE_TIMEOUT_MS);
      queue.push(post);
    });
  };

  /**
   * `loadScene`, with the two things only the HOST side can catch.
   *
   * An inline document over the fetch cap would be refused on the other side
   * anyway, after a structured clone has copied every byte of it across the
   * boundary; and a document carrying a function, a DOM node or a class
   * instance cannot be cloned at all — `postMessage` throws `DataCloneError`
   * synchronously, out of the middle of `send`, where a host expects a
   * rejection.
   */
  const loadScene = async (scene: EmbedSceneSource): Promise<void> => {
    if ('document' in scene) {
      const size = inlineDocumentBytes(scene.document);
      if (size !== null && size > MAX_SCENE_BYTES) {
        throw new EmbedError('bad-params', `inline scene document is ${size} bytes, over the ${MAX_SCENE_BYTES} byte cap`);
      }
    }
    try {
      await send('loadScene', { ...scene });
    } catch (error) {
      // By NAME, not by `instanceof DOMException`: the exception is raised
      // inside the FRAME's realm, and a cross-realm `instanceof` is false.
      if ((error as { name?: unknown } | null)?.name === 'DataCloneError') {
        throw new EmbedError('bad-params', 'the inline scene document cannot be structured-cloned across the frame boundary', {
          cause: error,
        });
      }
      throw error;
    }
  };

  const nothing = async (method: CommandMethod, params?: Record<string, unknown>): Promise<void> => {
    await send(method, params);
  };

  const captureStill = (request: CaptureStillRequest): Promise<EmbedCapture> =>
    send('captureStill', { ...request }) as Promise<EmbedCapture>;

  return {
    iframe,
    viewerId,
    ready: readyPromise,
    play: () => nothing('play'),
    pause: () => nothing('pause'),
    toggle: () => nothing('toggle'),
    stop: () => nothing('stop'),
    seek: (fraction) => nothing('seek', { fraction }),
    seekDistance: (metres) => nothing('seekDistance', { metres }),
    seekTime: (seconds) => nothing('seekTime', { seconds }),
    setTourSpeed: (speed) => nothing('setTourSpeed', { speed }),
    progress: () => send('progress') as Promise<TourProgress | null>,
    loadScene,
    setMode: (mode) => nothing('setMode', { mode }),
    getMode: () => send('getMode') as Promise<ViewerMode>,
    focusRoom: (roomId) => send('focusRoom', { roomId }) as Promise<boolean>,
    getState: () => send('getState') as Promise<ViewerState>,
    getScene: () => send('getScene') as Promise<SceneData | null>,
    setFurnitureVisible: (visible) => nothing('setFurnitureVisible', { visible }),
    setLocale: (locale) => nothing('setLocale', { locale }),
    setSelection: (target) => nothing('setSelection', { target }),
    resize: () => nothing('resize'),
    captureStill,
    capturePanorama: (request) => send('capturePanorama', { ...request }) as Promise<EmbedCapture>,
    capturePair: async (request) => ({
      current: await captureStill({ ...request, state: 'current' }),
      default: await captureStill({ ...request, state: 'default' }),
    }),
    exportGlb: (exportOptions) => send('exportGlb', { ...exportOptions }) as Promise<ArrayBuffer>,
    exportUsdz: (exportOptions) => send('exportUsdz', { ...exportOptions }) as Promise<ArrayBuffer>,
    on: (event, callback) => {
      const set = listeners.get(event) ?? new Set<(payload: never) => void>();
      listeners.set(event, set);
      const listener = callback as (payload: never) => void;
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      // Best effort, and deliberately not awaited: the frame is about to be
      // removed, so a reply that never comes must not hold the teardown up.
      void send('dispose').catch(() => undefined);
      disposed = true;
      claimedIds.delete(viewerId);
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new EmbedError('disposed', 'this embed has been disposed'));
      }
      pending.clear();
      queue = [];
      // Told synchronously, before listeners are cleared: guards against
      // `dispose()` clearing its own `message` listener in the same tick it
      // posts the command, where a host subscribed to `disposed` would never
      // hear it — the frame's own `disposed` event arrives after this handle
      // has stopped listening for anything.
      deliver('disposed', undefined);
      listeners.clear();
      failReady(new EmbedError('disposed', 'this embed was disposed before it was ready'));
      transport.abort();
      iframe.remove();
    },
  };
}
