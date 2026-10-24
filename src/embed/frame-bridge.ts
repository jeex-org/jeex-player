/**
 * The viewer's side of the iframe transport: turns `postMessage` commands into
 * `ViewerHandle` calls and the handle's events into messages.
 *
 * It is a WRAPPER and nothing else. Every command below is one call on the
 * handle, which is the promise `tour-controls.ts` has carried from the start —
 * "the surface a postMessage transport will one day wrap". Nothing here knows
 * about geometry, the DOM or the shell.
 *
 * Origin invariant, and it is the whole security story of the iframe form:
 * the origin is proved to BE one before the bridge is installed at all
 * (`isExactOrigin`, so never `'*'`, never `null`, never a URL with a path); a
 * message is then read only when it came from the window this bridge was
 * pointed at AND from that origin, and a reply or an event is posted only to
 * it. Anything else is dropped in silence, because a
 * page that embeds this frame may carry other postMessage traffic and an error
 * card about a stranger's message would be noise, not information.
 *
 * Parameter invariant: a command's params are proved ONCE, by
 * `protocol.schema.readCommand`, before `perform` is entered — so `perform`
 * takes a typed command and can no longer fail on a parameter, and nothing is
 * half-applied on the way to a `bad-params` complaint. The sentence a refusal
 * carries names the field and says what it should have been
 * (`shared/schema-issues.badParams`); the `code` is unchanged.
 *
 * Readiness invariant: a command that arrives before the first scene is on
 * screen is answered `not-ready` rather than acted on half-way. A host using
 * the helper (`host.ts`) never sees one — it queues until the `ready` event —
 * so `not-ready` is what a hand-written host gets for skipping that step.
 * `dispose` is the exception: tearing a frame down must work whether or not it
 * ever booted.
 */

import {
  DEFAULT_VIEWER_ID,
  commandReply,
  eventMessage,
  resolveMethod,
  type CommandMethod,
  type CommandOutcome,
  type EmbedEventMap,
  type ErrorCode,
  type EventName,
  type JeexCommand,
} from './protocol.js';
import { isJeexEnvelope, readCommand, type Command, type ParamsOf } from './protocol.schema.js';
import { badParams } from '../shared/schema-issues.js';
import { MAX_SCENE_BYTES, inlineDocumentBytes } from '../shared/limits.js';
import type { CaptureResult, CaptureStillRequest, CapturePanoramaRequest } from '../app/capture-commands.js';
import type { ViewerError } from '../app/viewer-events.js';
import type { ViewerHandle } from '../app/viewer-handle.js';
import type { ExportGlbOptions } from '../app/export-gltf.js';
import type { ExportUsdzOptions } from '../app/export-usdz.js';
import { isExactOrigin } from './frame-page.schema.js';
import { ViewerLibError } from '../shared/errors.js';

type FrameBridgeOptions = {
  /** The exact origin of the embedding page; the only one ever posted to. */
  hostOrigin: string;
  /** The window commands come from and replies go to. Defaults to the parent. */
  target?: Window;
  /** Which viewer this frame is, when a host page drives several. */
  viewerId?: string | undefined;
  /**
   * Where the frame PAGE's content size comes from: a subscription
   * the page hands in, because the size is the page's layout and not the
   * viewer's. Each report goes out as the `size` event. Absent, the bridge
   * raises none — the protocol does not promise one from every frame.
   */
  sizes?: ((listener: (size: EmbedEventMap['size']) => void) => () => void) | undefined;
  /**
   * The frame's telemetry site (`embed/frame-site.ts`): told when a message from
   * the host passed the source and origin checks, and handed the page of the
   * host's `context` command. Absent, `context` is answered and ignored.
   */
  site?: { verified(origin: string): void; context(page: string): void } | undefined;
};

/**
 * Commands that are answered before the first scene exists. `getScene` joins
 * `dispose` here: a host may ask what is on screen before there is anything,
 * and `null` is the honest answer rather than `not-ready`. `context` joins
 * them because the host sends it as soon as the frame has loaded.
 */
const READY_EXEMPT: ReadonlySet<CommandMethod> = new Set<CommandMethod>(['dispose', 'getScene', 'context']);

/** The reply one capture crosses the boundary as: the PNG bytes plus the sidecar. */
async function captureReply(capture: Promise<CaptureResult>): Promise<{ png: ArrayBuffer; provenance: unknown }> {
  const { blob, provenance } = await capture;
  // An `ArrayBuffer` is structured-cloneable; a `Blob` is too, but a host that
  // wants the bytes would then have to await a second read on its own side.
  return { png: await blob.arrayBuffer(), provenance };
}

/**
 * `ExportGlbOptions` off the wire: every field optional, `exportGlb` itself
 * fills the defaults. The spreads are what `exactOptionalPropertyTypes` asks
 * for — an absent field must be ABSENT, never present and `undefined`, or the
 * default stops deciding.
 */
function exportGlbOptions(params: ParamsOf<'exportGlb'>): ExportGlbOptions {
  const { includeFurniture, state, embedDocument } = params ?? {};
  return {
    ...(includeFurniture === undefined ? {} : { includeFurniture }),
    ...(state === undefined ? {} : { state }),
    ...(embedDocument === undefined ? {} : { embedDocument }),
  };
}

/** `ExportUsdzOptions` off the wire: the one shared field, `exportGlbOptions`'s neighbour. */
function exportUsdzOptions(params: ParamsOf<'exportUsdz'>): ExportUsdzOptions {
  const includeFurniture = params?.includeFurniture;
  return includeFurniture === undefined ? {} : { includeFurniture };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Installs the bridge and answers with the function that removes it.
 *
 * The listener is on the frame's own `window`; disposing the viewer through
 * the bridge takes it down as well, so a frame that has been told to go away
 * stops answering.
 */
export function installFrameBridge(handle: ViewerHandle, options: FrameBridgeOptions): () => void {
  const { hostOrigin } = options;
  // Refused at INSTALL time, not at the first post. `postMessage` with a
  // malformed target throws, and it is called from inside `ViewerEvents` and
  // `TourEvents` listeners — on every frame of a running tour. `'*'` is worse
  // than malformed: it broadcasts every event to whatever framed this page.
  if (!isExactOrigin(hostOrigin)) {
    throw new ViewerLibError(
      'bad-params',
      `installFrameBridge: hostOrigin must be an exact http(s) origin, got ${JSON.stringify(hostOrigin)}`,
      {
        detail: { hostOrigin },
      },
    );
  }
  const target = options.target ?? window.parent;
  const viewerId = options.viewerId ?? DEFAULT_VIEWER_ID;
  let ready = false;
  let installed = true;
  /** The bridge's own listener lifetime; `uninstall()` is one `abort()`. */
  const listeners = new AbortController();
  /**
   * The last error the viewer reported. `loadScene` emits it and THEN rejects
   * with the same throw, so matching on `cause` identity is what lets a reply
   * carry `scene-invalid` instead of a flat `internal` — no guessing from the
   * message text.
   */
  let lastError: ViewerError | null = null;

  const post = (message: unknown): void => {
    target.postMessage(message, hostOrigin);
  };
  const emit = (event: EventName, payload: unknown): void => {
    post(eventMessage(viewerId, event, payload));
  };

  const subscriptions: Array<() => void> = [
    handle.on('ready', (info) => {
      ready = true;
      emit('ready', info);
    }),
    handle.on('error', (error) => {
      lastError = error;
      emit('error', { code: error.code, message: error.message });
    }),
    handle.on('scene', (info) => emit('scene', info)),
    handle.on('mode', (mode) => emit('mode', mode)),
    handle.on('select', (selection) => emit('select', selection)),
    handle.on('lightTemperature', (change) => emit('lightTemperature', change)),
    handle.tour.on('progress', (progress) => emit('progress', progress)),
    handle.tour.on('state', (state) => emit('state', { state })),
    handle.tour.on('ended', () => emit('ended', {})),
    ...(options.sizes ? [options.sizes((size) => emit('size', size))] : []),
  ];

  const uninstall = (): void => {
    if (!installed) return;
    installed = false;
    for (const unsubscribe of subscriptions) unsubscribe();
    listeners.abort();
  };

  /** The code a rejected `loadScene` should carry, from the event it emitted. */
  const codeOf = (error: unknown): ErrorCode => {
    if (lastError && lastError.cause === error) return lastError.code;
    return 'internal';
  };

  /** Runs one command whose params are already typed; it can no longer fail on a parameter. */
  const perform = async (command: Command): Promise<unknown> => {
    const { tour } = handle;
    switch (command.method) {
      case 'play':
        tour.play();
        return undefined;
      case 'pause':
        tour.pause();
        return undefined;
      case 'toggle':
        tour.toggle();
        return undefined;
      case 'stop':
        tour.stop();
        return undefined;
      case 'seek':
        tour.seek(command.params.fraction);
        return undefined;
      case 'seekDistance':
        tour.seekDistance(command.params.metres);
        return undefined;
      case 'seekTime':
        tour.seekTime(command.params.seconds);
        return undefined;
      case 'setTourSpeed':
        tour.setSpeed(command.params.speed);
        return undefined;
      case 'progress':
        return tour.progress();
      case 'setMode':
        handle.setMode(command.params.mode);
        return undefined;
      case 'getMode':
        return handle.getMode();
      case 'focusRoom':
        return handle.focusRoom(command.params.roomId);
      case 'setFurnitureVisible':
        handle.setFurnitureVisible(command.params.visible);
        return undefined;
      case 'setLocale':
        handle.setLocale(command.params.locale);
        return undefined;
      case 'setLightTemperature':
        handle.setLightTemperature(command.params.temperature);
        return undefined;
      case 'setSelection':
        handle.setSelection(command.params.target);
        return undefined;
      case 'loadScene': {
        // `document` travels as a structured clone, so a host that already
        // holds the scene never serialises it. `url` is resolved against the
        // FRAME's origin, which is where the fetch happens. Which of the two
        // the host meant is the schema's own question: a params object that
        // CARRIES `document` names a document, whatever it holds, and the
        // other shape names a `url`.
        const { params } = command;
        if ('document' in params) return handle.loadScene({ document: params.document });
        return handle.loadScene({ url: params.url });
      }
      case 'getState':
        return handle.getState();
      case 'getScene':
        return handle.getScene();
      case 'resize':
        // A host whose own layout changed in a way the frame's `ResizeObserver`
        // cannot see (a CSS transform, a print stylesheet) says so here.
        handle.resize();
        return undefined;
      case 'captureStill': {
        const { width, height, state, camera, fov, caption } = command.params;
        const request: CaptureStillRequest = { width, height, state, camera, fov, caption };
        return captureReply(handle.capture.still(request));
      }
      case 'capturePanorama': {
        const { width, roomId, state, caption } = command.params;
        const request: CapturePanoramaRequest = { width, roomId, state, caption };
        return captureReply(handle.capture.panorama(request));
      }
      case 'exportGlb': {
        // `Blob` itself is structured-cloneable, but the protocol's contract is
        // an `ArrayBuffer` (`protocol.ts`'s `CommandMethod` doc) — the same
        // shape every binary export crosses the boundary as, with no `Blob`
        // constructor required on the host side.
        const blob = await handle.exportGlb(exportGlbOptions(command.params));
        return blob.arrayBuffer();
      }
      case 'exportUsdz': {
        const blob = await handle.exportUsdz(exportUsdzOptions(command.params));
        return blob.arrayBuffer();
      }
      case 'context':
        options.site?.context(command.params.page);
        return undefined;
      case 'dispose':
        handle.dispose();
        emit('disposed', {});
        uninstall();
        return undefined;
    }
  };

  /**
   * `unknown-method` → `not-ready` → params → run.
   *
   * The params check sits BEFORE `perform`, so nothing is half-applied on the
   * way to a complaint — a property the ten hand-written readers only had
   * because each of them threw on its own first line, and one that now holds by
   * construction.
   */
  const answer = async (command: JeexCommand): Promise<CommandOutcome> => {
    const method = resolveMethod(command.method);
    if (method === null) return { ok: false, error: { code: 'unknown-method', message: `no method ${command.method}` } };
    if (!ready && !READY_EXEMPT.has(method)) {
      return { ok: false, error: { code: 'not-ready', message: 'the first scene is not on screen yet' } };
    }
    const read = readCommand(method, command.params);
    if (!read.ok) return { ok: false, error: { code: 'bad-params', message: badParams(method, read.issues).message } };
    // An inline document over the fetch cap is refused HERE, before the viewer
    // is asked to validate it — the same gate the host helper makes
    // (`host.ts` `loadScene`), and the reason it must exist on BOTH sides: a
    // hand-written host can skip the
    // helper's check and post a document of any size, the structured clone has
    // already copied every byte across the boundary by now, and the fetch
    // path's cap (`shared/limits.ts`) declares an inline document refused by
    // that path must not reach this side at all. Answered like `not-ready`, in
    // the protocol's own shape, rather than thrown — `codeOf` maps an
    // unreported throw to `internal`, and this refusal is not the viewer's.
    if (method === 'loadScene') {
      // The parameterless command members type `params` as `unknown`, so the
      // shape of what arrived is proved here rather than cast: the `method`
      // check above selected the command, this selects the parameter.
      const params: unknown = read.value.params;
      if (typeof params === 'object' && params !== null && 'document' in params) {
        const bytes = inlineDocumentBytes(params.document);
        if (bytes !== null && bytes > MAX_SCENE_BYTES) {
          return {
            ok: false,
            error: { code: 'bad-params', message: `inline scene document is ${bytes} bytes, over the ${MAX_SCENE_BYTES} byte cap` },
          };
        }
      }
    }
    try {
      return { ok: true, result: await perform(read.value) };
    } catch (error) {
      return { ok: false, error: { code: codeOf(error), message: messageOf(error) } };
    }
  };

  function onMessage(event: MessageEvent): void {
    // Who, then what: the window and the origin decide whether the message is
    // even looked at, and only then is its shape read.
    if (event.source !== target || event.origin !== hostOrigin) return;
    const data: unknown = event.data;
    if (!isJeexEnvelope(data) || data.kind !== 'command' || data.viewerId !== viewerId) return;
    options.site?.verified(hostOrigin);
    // A `dispose` uninstalls the bridge inside `perform`, and its own reply is
    // still owed: posting does not go through the listener, so the last answer
    // gets out after the frame has stopped listening for the next one.
    void answer(data).then((outcome) => {
      post(commandReply(viewerId, data.id, outcome));
    });
  }

  window.addEventListener('message', onMessage, { signal: listeners.signal });
  // The scene may already be up when a bridge is installed after the boot.
  handle.ready.then(
    () => {
      ready = true;
    },
    () => undefined,
  );
  return uninstall;
}
