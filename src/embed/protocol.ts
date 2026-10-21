/**
 * The wire between an embedding page and a viewer in an iframe: the envelope,
 * the method vocabulary, the error codes, and the three constructors that
 * build a message.
 *
 * It is the ONE module both sides import — `frame-bridge.ts` inside the frame
 * and `host.ts` on the page — which is why it is pure: no `three`, no DOM, no
 * viewer. A host that embeds by iframe downloads `host.ts` and this, and that
 * is the whole of it (the 4 KB budget in `budget-check.ts` is what keeps it
 * so).
 *
 * Trust invariant: nothing here trusts what it is given. `isJeexMessage`
 * proves the shape of an arbitrary `MessageEvent.data` before either side
 * looks at a field, and it is deliberately NOT an origin check — who sent it
 * is the transport's question and is answered separately, on both sides.
 *
 * Schema invariant: the `zod/mini` twin of this vocabulary lives in the sibling
 * `protocol.schema.ts`, and the arrow runs ONE way — the schema imports this
 * module, never the reverse, not even `import type` (`dependency-cruiser` runs
 * with `tsPreCompilationDeps: true`, so a type-only edge back would be a real
 * cycle). Nothing here imports Zod: the host helper's 4 KB budget could not
 * pay for it, and both sides import THIS file.
 *
 * Version invariant: `version` is the semver-major of this contract. A message
 * carrying another number is not this protocol and is dropped rather than
 * interpreted, so an old page and a new frame fail visibly instead of half
 * working.
 */

/** Discriminator, so a frame that carries other postMessage traffic ignores it. */
export const CHANNEL = 'jeex-embed';

/** Semver-major of the wire contract (the `/embed/v1/` in the embed paths). */
export const PROTOCOL_VERSION = 1;

/**
 * The id a frame answers to when a host named none. A host page driving
 * SEVERAL frames gives each its own (`embedViewer({ viewerId })`); one that
 * drives a single frame need not say anything.
 */
export const DEFAULT_VIEWER_ID = 'jeex';

// The vocabulary types the wire speaks, re-exported so a host that drives a
// frame types against ONE module. They are type-only imports and cost the host
// bundle nothing (`verbatimModuleSyntax` erases them).
export type { ViewerMode } from '../scene/types.js';
export type { Locale } from '../ui/messages.js';
export type { TourProgress, TourSpeed, TourState } from '../camera/tour-controls.js';
export type { ViewerState } from '../app/viewer-handle.js';
export type { SceneData } from '../scene/types.js';
export type { CaptureStillRequest, CapturePanoramaRequest } from '../app/capture-commands.js';
export type { Provenance } from '../app/provenance.js';
export type { ViewerSelection, ViewerSelectionTarget } from '../app/selection.js';

import type { ViewerMode } from '../scene/types.js';
import type { TourProgress, TourState } from '../camera/tour-controls.js';
import type { ViewerSelection } from '../app/selection.js';

/** Every command a host may send. */
export type CommandMethod =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'stop'
  | 'seek'
  | 'seekDistance'
  | 'seekTime'
  /** The tour's speed setting, `{ speed: 0.5 | 1 | 2 }`; the `progress` event carries it back. */
  | 'setTourSpeed'
  | 'progress'
  | 'loadScene'
  | 'setMode'
  | 'getMode'
  | 'focusRoom'
  /** Mode, tour position, furniture, locale, scene and revision, in one reply. */
  | 'getState'
  /** A deep copy of the committed document, or `null` before the first scene. Answered before `ready`. */
  | 'getScene'
  | 'setFurnitureVisible'
  | 'setLocale'
  /** Re-measures the frame's container; the host calls it after its own layout change. */
  | 'resize'
  /** One still, answered as `{ png: ArrayBuffer; provenance }` — a structured clone, not a data URL. */
  | 'captureStill'
  /** One equirectangular room panorama, answered the same way. */
  | 'capturePanorama'
  /** The committed document as a GLB, crossing the boundary as an `ArrayBuffer` (`app/export-gltf.ts`). */
  | 'exportGlb'
  /** The committed document as a USDZ, crossing the boundary as an `ArrayBuffer` (`app/export-usdz.ts`). */
  | 'exportUsdz'
  /** Highlights one wall, opening, room or asset in the frame, or clears it with `null`. */
  | 'setSelection'
  | 'dispose';

/**
 * Every reason a command can fail, as a code a host can branch on.
 *
 * It MIRRORS `ViewerErrorCode` (`shared/errors.ts`) and adds the two codes that
 * only exist across a frame boundary: `unknown-method`, for a method this
 * version of the frame does not have, and `timeout`, which the HOST raises when
 * a reply never comes.
 *
 * The two sets are related by COMPOSITION, never by a merge:
 * `protocol.schema.ts` builds `errorCodeSchema` as
 * `z.union([viewerErrorCodeSchema, z.literal('unknown-method'), z.literal('timeout')])`,
 * and its test proves the two frame-only codes do not pass the viewer's own
 * set. The union below stays spelled out here, with its per-member notes,
 * because it is what a host imports and a `z.infer` would carry Zod's types
 * into the published `.d.ts` (`check:pkg`).
 *
 * Protocol note: there is no `bad-message`. A message that is not this protocol
 * — wrong channel, wrong version, wrong `viewerId`, or not addressed to this
 * frame at all — is IGNORED, never answered. A page may host several frames and
 * any script may post to any window, so answering an unaddressed message would
 * both leak that a viewer is listening and let one viewer settle another's
 * pending command.
 */
export type ErrorCode =
  /** A method name this version does not have. */
  | 'unknown-method'
  /** No reply arrived within the host's window (raised host-side). */
  | 'timeout'
  /** The method exists; its parameters were missing or of the wrong type. */
  | 'bad-params'
  /** The first scene is not on screen yet, so there is nothing to command. */
  | 'not-ready'
  /** The viewer has been disposed; its frame no longer drives anything. */
  | 'disposed'
  /** No scene source was named at all (`ViewerErrorCode`). */
  | 'no-scene-source'
  /** The browser gave no WebGL context (`ViewerErrorCode`). */
  | 'webgl-unavailable'
  /** The scene source could not be read (`ViewerErrorCode`). */
  | 'scene-load'
  /** A URI inside a GLB names a resource the viewer refuses to fetch (`ViewerErrorCode`). */
  | 'model-external-resource'
  /** The document was read and is not a valid scene (`ViewerErrorCode`). */
  | 'scene-invalid'
  /** The document is a baked project and is not a valid one (`ViewerErrorCode`). */
  | 'project-invalid'
  /** The frame's WebGL context was taken away (`ViewerErrorCode`). */
  | 'context-lost'
  /** Anything the viewer itself got wrong; the message says what. */
  | 'internal';

/**
 * What the frame pushes to the host, unasked, and what each event carries.
 *
 * It mirrors `ViewerEventMap` (`app/viewer-events.ts`) and adds the tour's four:
 * `progress`, `state`, `ended` — and `disposed`, which the HOST handle raises
 * for itself when it tears the frame down.
 */
export type EmbedEventMap = {
  ready: { options: unknown; sceneId: string };
  error: { code: ErrorCode; message: string };
  scene: { sceneId: string; rev: number };
  mode: ViewerMode;
  /** A click named something in the frame's scene; only with `select` on. */
  select: ViewerSelection;
  progress: TourProgress;
  state: { state: TourState };
  ended: Record<string, never>;
  /**
   * The frame page's CONTENT box, in CSS pixels: its width and the
   * height it wants at that width and its `?ratio=`. Raised once the bridge is
   * up and again whenever either changes, so a host without responsive iframes
   * (`frame-sizing`) can give the frame that height (`embedViewer`'s
   * `autoHeight`). Only `embed.html` raises it; a hand-built frame page may not.
   */
  size: { width: number; height: number };
  disposed: undefined;
};

export type EventName = keyof EmbedEventMap;

/** What every message carries, in both directions. */
export type Envelope = {
  channel: typeof CHANNEL;
  version: typeof PROTOCOL_VERSION;
  /** Which viewer this is for; one host page may drive several frames. */
  viewerId: string;
};

/** Host → frame. `id` is opaque to the frame and comes back on the reply. */
export type JeexCommand = Envelope & {
  kind: 'command';
  id: string;
  method: CommandMethod;
  params?: Record<string, unknown>;
};

/** Frame → host, exactly once per command. */
export type JeexReply = Envelope & {
  kind: 'reply';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: ErrorCode; message: string };
};

/** Frame → host, unasked. */
export type JeexEvent = Envelope & {
  kind: 'event';
  event: EventName;
  payload: unknown;
};

export type JeexMessage = JeexCommand | JeexReply | JeexEvent;

/** How a command turned out; what `commandReply` is built from. */
export type CommandOutcome = { ok: true; result?: unknown } | { ok: false; error: { code: ErrorCode; message: string } };

/**
 * Older method names, accepted on the way IN so a host written against them
 * still works. Nothing is ever emitted under an
 * old name: one name goes out, two come in.
 */
export const METHOD_ALIASES: Readonly<Record<string, CommandMethod>> = {
  playTour: 'play',
  pauseTour: 'pause',
  destroy: 'dispose',
};

/**
 * The full method list, checked against `CommandMethod` at compile time
 * (`as const satisfies`) rather than trusted to a bare `Set<string>`: the
 * previous `new Set<CommandMethod>([...])` proved each entry was valid but
 * nothing caught the union GAINING a member the list forgot.
 *
 * Exported because `protocol.schema.test.ts` walks it to prove that every
 * method has a branch of its own in `commandSchema` — the list drives the
 * test, never the other way round.
 */
export const METHOD_LIST = [
  'play',
  'pause',
  'toggle',
  'stop',
  'seek',
  'seekDistance',
  'seekTime',
  'setTourSpeed',
  'progress',
  'loadScene',
  'setMode',
  'getMode',
  'focusRoom',
  'getState',
  'getScene',
  'setFurnitureVisible',
  'setLocale',
  'resize',
  'captureStill',
  'capturePanorama',
  'exportGlb',
  'exportUsdz',
  'setSelection',
  'dispose',
] as const satisfies readonly CommandMethod[];
/** Exhaustiveness: fails to compile if `METHOD_LIST` is missing a `CommandMethod`. */
type _MissingCommandMethod = Exclude<CommandMethod, (typeof METHOD_LIST)[number]>;
((): _MissingCommandMethod extends never ? true : ['METHOD_LIST missing', _MissingCommandMethod] => true)();

const METHODS: ReadonlySet<string> = new Set(METHOD_LIST);

/**
 * The method a command names, or `null` when this version has no such method.
 * An alias resolves to the name it stands for; everything else must be spelled
 * exactly, because a near miss is a bug in the host, not something to guess at.
 */
export function resolveMethod(method: string): CommandMethod | null {
  if (METHODS.has(method)) return method as CommandMethod;
  // `Object.hasOwn`, never a plain property read: the method name comes off
  // the wire, and `constructor` or `toString` would otherwise resolve to
  // something on `Object.prototype`.
  return Object.hasOwn(METHOD_ALIASES, method) ? METHOD_ALIASES[method]! : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether an arbitrary `MessageEvent.data` is one of ours.
 *
 * Checked before ANY field is read: a page may carry other postMessage
 * traffic, and a foreign message that happens to have an `id` must never be
 * answered as if it were a command.
 *
 * Hand-written on purpose, for the HOST side: `embed/host.ts` has a 4 KB gzip
 * budget and cannot carry `zod/mini` (4.4 KB on its own). The frame reads its
 * traffic through the schema twin, `isJeexEnvelope` in `protocol.schema.ts`,
 * and `protocol.schema.test.ts` runs both over the same fixtures so the two
 * cannot drift.
 */
export function isJeexMessage(data: unknown): data is JeexMessage {
  if (!isRecord(data)) return false;
  if (data['channel'] !== CHANNEL || data['version'] !== PROTOCOL_VERSION) return false;
  if (typeof data['viewerId'] !== 'string') return false;
  if (data['kind'] === 'command') return typeof data['id'] === 'string' && typeof data['method'] === 'string';
  if (data['kind'] === 'reply') return typeof data['id'] === 'string' && typeof data['ok'] === 'boolean';
  if (data['kind'] === 'event') return typeof data['event'] === 'string';
  return false;
}

/** The envelope every constructor below starts from. */
function envelope(viewerId: string): Envelope {
  return { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId };
}

/** Host → frame: one command, awaiting the reply that echoes `id`. */
export function commandMessage(viewerId: string, id: string, method: CommandMethod, params?: Record<string, unknown>): JeexCommand {
  const command: JeexCommand = { ...envelope(viewerId), kind: 'command', id, method };
  return params === undefined ? command : { ...command, params };
}

/** Frame → host: the answer to one command, success or failure. */
export function commandReply(viewerId: string, id: string, outcome: CommandOutcome): JeexReply {
  return outcome.ok
    ? { ...envelope(viewerId), kind: 'reply', id, ok: true, result: outcome.result }
    : { ...envelope(viewerId), kind: 'reply', id, ok: false, error: outcome.error };
}

/** Frame → host: one unasked event. */
export function eventMessage(viewerId: string, event: EventName, payload: unknown): JeexEvent {
  return { ...envelope(viewerId), kind: 'event', event, payload };
}
