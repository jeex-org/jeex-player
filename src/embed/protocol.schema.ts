/**
 * The iframe protocol's UNTRUSTED half as `zod/mini` schemas: one branch of a
 * discriminated union per command method, one per event, and the error
 * vocabulary composed rather than merged.
 *
 * Direction invariant, and it decides the shape of this file: the arrow runs
 * `protocol.schema.ts` → `protocol.ts` and never back, not even type-only.
 * `dependency-cruiser` runs with `tsPreCompilationDeps: true`, so a single
 * `import type` from `protocol.ts` into this module would close a cycle and
 * `no-circular` is an error. That is why the envelopes (`Envelope`,
 * `JeexCommand`, `JeexReply`, `JeexEvent`) stay DECLARED in `protocol.ts` — a
 * host types against one module — and this file only proves it agrees with
 * them, in `protocol.schema.test.ts`.
 *
 * Weight invariant: `embed/host.ts` imports nothing from here in any spelling.
 * One `zod/mini` is 4.39 KB gzip and the whole host helper's budget is 4 KB
 * (`scripts/budget-check.ts`), so the host proves the `ready` payload by hand
 * and `host.test.ts` runs the hand check and `readyPayloadSchema` over the same
 * fixtures so the two cannot drift.
 *
 * Message invariant: no bundle ships a Zod locale, so Zod's own default
 * sentence is the literal "Invalid input" for every failure. Every field a host
 * can get wrong therefore carries its own `error` string here — the path says
 * WHERE, the sentence says WHAT — and `frame-bridge.ts` reads both through
 * `shared/schema-issues.badParams`.
 *
 * Judging invariant: this schema never transforms. There is no `.transform()`,
 * `.default()` or `.catch()`, so `z.input` and `z.output` coincide, and
 * `readCommand` hands back the object the host actually sent rather than
 * `result.data`.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { OPTION_SCHEMA } from '../app/viewer-options.js';
import { isLocale, locales } from '../ui/messages.js';
import { cameraPoseSchema } from '../scene/types.schema.js';
import { isUuidV7 } from '../scene/types.js';
import type { ViewerErrorCode } from '../shared/errors.js';
import type { SchemaIssue } from '../shared/schema-issues.js';
import { CHANNEL, PROTOCOL_VERSION, type CommandMethod, type JeexMessage, type TourSpeed, type TourState } from './protocol.js';
import type { ViewerSelectionKind } from '../app/selection.js';

// ------------------------------------------------------- the error vocabulary

/**
 * `ViewerErrorCode` (`shared/errors.ts`) as a closed set beside the union, the
 * way every closed set here is written: `satisfies` proves every entry is a
 * real code and the exhaustiveness line below proves none is missing.
 */
const VIEWER_ERROR_CODES = [
  'webgl-unavailable',
  'scene-load',
  'model-external-resource',
  'scene-invalid',
  'project-invalid',
  'no-scene-source',
  'bad-params',
  'not-ready',
  'disposed',
  'context-lost',
  'internal',
] as const satisfies readonly ViewerErrorCode[];
/** Exhaustiveness: fails to compile if `VIEWER_ERROR_CODES` is missing a `ViewerErrorCode`. */
type _MissingViewerErrorCode = Exclude<ViewerErrorCode, (typeof VIEWER_ERROR_CODES)[number]>;
((): _MissingViewerErrorCode extends never ? true : ['VIEWER_ERROR_CODES missing', _MissingViewerErrorCode] => true)();

/** The eleven codes a viewer can raise on its own (`shared/errors.ts`). */
export const viewerErrorCodeSchema = z.enum(VIEWER_ERROR_CODES, { error: `must be one of ${VIEWER_ERROR_CODES.join(', ')}` });

/**
 * `ErrorCode` (`protocol.ts`): the viewer's ten PLUS the two that only exist
 * across a frame boundary.
 *
 * COMPOSED, never merged. `unknown-method` and `timeout` are added here, on top
 * of `viewerErrorCodeSchema`, so the containment `ViewerErrorCode ⊂ ErrorCode`
 * is a fact about the schemas rather than a promise in a comment — and
 * `protocol.schema.test.ts` proves the two extra codes do NOT pass the viewer's
 * own set.
 */
export const errorCodeSchema = z.union([viewerErrorCodeSchema, z.literal('unknown-method'), z.literal('timeout')], {
  error: 'must be a protocol error code',
});

// --------------------------------------------------------- the leaf sentences

/** `z.number()` is a FINITE number in Zod 4.6: `NaN` and both infinities are refused, which is what the wire has always meant. */
const finiteNumber = z.number({ error: 'must be a finite number' });
const wireString = z.string({ error: 'must be a string' });
const wireBoolean = z.boolean({ error: 'must be a boolean' });
/** An entity id on the wire: a lowercase canonical UUID v7, the scene's own id grammar (`isUuidV7`). */
const wireUuid = wireString.check(z.refine((value: string) => isUuidV7(value), { error: 'must be a UUID v7' }));
/** A wall face on the wire: strict, like `isFaceKey` — its owners' UUIDs and its side, `room` absent on the facade. */
const wireFaceKey = z.strictObject(
  { room: z.optional(wireUuid), wallId: wireUuid, side: z.enum(['L', 'R'], { error: 'must be L or R' }) },
  { error: 'must be a face `{ room?, wallId, side }`' },
);

/** The two documents a capture or an export may ask for (`render/offscreen-scene.ts`, `app/export-types.ts`). */
const SCENE_STATES = ['current', 'default'] as const;
const sceneStateSchema = z.enum(SCENE_STATES, { error: `must be one of ${SCENE_STATES.join(', ')}` });

/** The two poses a still may name by word rather than by coordinates. */
const NAMED_CAMERAS = ['presentation', 'live'] as const;

/** The modes a host may switch to, read from the one option schema rather than spelled again. */
const VIEWER_MODES = OPTION_SCHEMA['view.mode'].values;
const viewerModeSchema = z.enum(VIEWER_MODES, { error: `must be one of ${VIEWER_MODES.join(', ')}` });

const TOUR_STATES = ['ready', 'playing', 'paused', 'ended'] as const satisfies readonly TourState[];
const tourStateSchema = z.enum(TOUR_STATES, { error: `must be one of ${TOUR_STATES.join(', ')}` });

/** The tour's speed settings, spelled here like `TOUR_STATES`; the line below proves the copy whole. */
const TOUR_SPEED_VALUES = [1, 2, 0.5] as const satisfies readonly TourSpeed[];
type _MissingTourSpeed = Exclude<TourSpeed, (typeof TOUR_SPEED_VALUES)[number]>;
((): _MissingTourSpeed extends never ? true : ['TOUR_SPEED_VALUES missing', _MissingTourSpeed] => true)();
const tourSpeedSchema = z.literal(TOUR_SPEED_VALUES, { error: `must be one of ${TOUR_SPEED_VALUES.join(', ')}` });

/**
 * The five words a selection can be, as a closed set beside the union — the
 * `VIEWER_ERROR_CODES` pattern. Spelled here rather than imported as a value
 * so this schema keeps its single runtime edge (`OPTION_SCHEMA`); the
 * exhaustiveness line below is what proves the copy has not drifted.
 */
const SELECTION_KINDS = ['wall', 'opening', 'room', 'furniture', 'none'] as const satisfies readonly ViewerSelectionKind[];
/** Exhaustiveness: fails to compile if `SELECTION_KINDS` is missing a kind. */
type _MissingSelectionKind = Exclude<ViewerSelectionKind, (typeof SELECTION_KINDS)[number]>;
((): _MissingSelectionKind extends never ? true : ['SELECTION_KINDS missing', _MissingSelectionKind] => true)();

const selectionKindSchema = z.enum(SELECTION_KINDS, { error: `must be one of ${SELECTION_KINDS.join(', ')}` });

/** A highlight target: one of the four real kinds plus its UUID. `none` cannot be highlighted. */
const selectionTargetSchema = z.object(
  { kind: z.enum(['wall', 'opening', 'room', 'furniture']), id: wireUuid },
  { error: 'must be an object naming a `kind` and an `id`' },
);

/**
 * A locale the registry knows AT PARSE TIME.
 *
 * `messages.registerLocale` may have added a language since this module loaded
 * — a host registers its own, and so do tests — so the set is read INSIDE the
 * check, and the sentence that lists it is built there too. Baking it into a
 * `z.enum` at module load would refuse a language the viewer can in fact speak.
 *
 * `isLocale` and not `locales().includes`, because an ALIAS is a locale the
 * viewer can answer in without being a catalogue name: `setLocale('sr')` from
 * a host written before `sr-Latn` existed still works. The sentence keeps
 * listing the catalogue names — those are what a host should write.
 */
const localeSchema = wireString.check(
  z.refine((value: string) => isLocale(value), {
    error: () => `must be one of ${locales().join(', ')}`,
  }),
);

/** The camera a still names: a word, a room by its UUID, or a pose in full. Absent means the scene's own presentation camera. */
const captureCameraSchema = z.union([z.enum(NAMED_CAMERAS), z.object({ roomId: wireUuid }), cameraPoseSchema], {
  error: 'must be `presentation`, `live`, a room or a pose',
});

// ------------------------------------------------------ one params per method

const seekParamsSchema = z.object({ fraction: finiteNumber }, { error: 'must be an object naming a `fraction`' });
const seekDistanceParamsSchema = z.object({ metres: finiteNumber }, { error: 'must be an object naming `metres`' });
const seekTimeParamsSchema = z.object({ seconds: finiteNumber }, { error: 'must be an object naming `seconds`' });
const setTourSpeedParamsSchema = z.object({ speed: tourSpeedSchema }, { error: 'must be an object naming a `speed`' });
const setModeParamsSchema = z.object({ mode: viewerModeSchema }, { error: 'must be an object naming a `mode`' });
const focusRoomParamsSchema = z.object({ roomId: wireUuid }, { error: 'must be an object naming a `roomId`' });
const setFurnitureVisibleParamsSchema = z.object({ visible: wireBoolean }, { error: 'must be an object naming `visible`' });
const setLocaleParamsSchema = z.object({ locale: localeSchema }, { error: 'must be an object naming a `locale`' });
const setSelectionParamsSchema = z.object(
  { target: z.union([selectionTargetSchema, z.null()], { error: 'must be a selection target or null' }) },
  { error: 'must be an object naming a `target`' },
);

/**
 * `url` or `document`, expressed as the two shapes rather than as one object
 * with two optional keys, because it is the PRESENCE of `document` that
 * decides: a host clearing the scene may hand a `document` of `null`, while
 * `loadScene({})` is `bad-params` (`frame-bridge.test.ts` pins both). A
 * required `z.unknown()` is exactly "this key is here, whatever it holds", so
 * the union carries the rule and the branch that matched carries the type.
 */
const inlineSceneParamsSchema = z.object({
  /** Present, whatever it holds — `null` included. A required `z.unknown()` is exactly that rule. */
  document: z.unknown(),
});

const loadSceneParamsSchema = z.union([inlineSceneParamsSchema, z.object({ url: wireString })], {
  error: 'must name `url` (a string) or `document`',
});

const captureStillParamsSchema = z.object(
  {
    width: finiteNumber,
    height: finiteNumber,
    state: z.optional(sceneStateSchema),
    camera: z.optional(captureCameraSchema),
    fov: z.optional(finiteNumber),
    caption: z.optional(wireBoolean),
  },
  { error: 'must be an object naming `width` and `height`' },
);

const capturePanoramaParamsSchema = z.object(
  {
    width: finiteNumber,
    roomId: wireUuid,
    state: z.optional(sceneStateSchema),
    caption: z.optional(wireBoolean),
  },
  { error: 'must be an object naming `width` and a `roomId`' },
);

/** `ExportGlbOptions` off the wire: every field optional, `exportGlb` itself fills the defaults. */
const exportGlbParamsSchema = z.object(
  {
    includeFurniture: z.optional(wireBoolean),
    state: z.optional(sceneStateSchema),
    embedDocument: z.optional(wireBoolean),
  },
  { error: 'must be an object of export options' },
);

/** `ExportUsdzOptions` off the wire: the one shared field, `exportGlbParamsSchema`'s neighbour. */
const exportUsdzParamsSchema = z.object({ includeFurniture: z.optional(wireBoolean) }, { error: 'must be an object of export options' });

/** `context`: the host page's path, bounded; the frame sanitises it before anything else sees it. */
const contextParamsSchema = z.object({ page: z.string().check(z.maxLength(2048)) }, { error: 'must be { page: string }' });

/**
 * The methods that take no parameters. They share ONE branch: a multi-valued
 * `z.literal` discriminates them all and whatever a host sent alongside is
 * ignored.
 */
const PARAMETERLESS = [
  'play',
  'pause',
  'toggle',
  'stop',
  'progress',
  'getMode',
  'getState',
  'getScene',
  'resize',
  'dispose',
] as const satisfies readonly CommandMethod[];

/**
 * One command's params, per method — the discriminated union the bridge
 * dispatches on.
 *
 * `method` is already resolved (aliases included) by `resolveMethod`, so a
 * discriminator that matches nothing is an internal error rather than
 * `unknown-method`: the bridge answers that code before it ever gets here.
 */
export const commandSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal(PARAMETERLESS), params: z.optional(z.unknown()) }),
  z.object({ method: z.literal('seek'), params: seekParamsSchema }),
  z.object({ method: z.literal('seekDistance'), params: seekDistanceParamsSchema }),
  z.object({ method: z.literal('seekTime'), params: seekTimeParamsSchema }),
  z.object({ method: z.literal('setTourSpeed'), params: setTourSpeedParamsSchema }),
  z.object({ method: z.literal('setMode'), params: setModeParamsSchema }),
  z.object({ method: z.literal('focusRoom'), params: focusRoomParamsSchema }),
  z.object({ method: z.literal('setFurnitureVisible'), params: setFurnitureVisibleParamsSchema }),
  z.object({ method: z.literal('setLocale'), params: setLocaleParamsSchema }),
  z.object({ method: z.literal('setSelection'), params: setSelectionParamsSchema }),
  z.object({ method: z.literal('loadScene'), params: loadSceneParamsSchema }),
  z.object({ method: z.literal('captureStill'), params: captureStillParamsSchema }),
  z.object({ method: z.literal('capturePanorama'), params: capturePanoramaParamsSchema }),
  z.object({ method: z.literal('exportGlb'), params: z.optional(exportGlbParamsSchema) }),
  z.object({ method: z.literal('exportUsdz'), params: z.optional(exportUsdzParamsSchema) }),
  z.object({ method: z.literal('context'), params: contextParamsSchema }),
]);

/** One command, method and params together, once the params have been proved. */
export type Command = z.infer<typeof commandSchema>;

/**
 * The params of one method that has a branch of its OWN; `undefined` where they
 * are optional.
 *
 * The ten parameterless methods share a single branch, so they are excluded
 * from the parameter rather than silently answering `never`: there is nothing
 * for a caller to name there, and a `ParamsOf<'play'>` is a mistake worth a
 * compile error.
 */
export type ParamsOf<M extends Exclude<CommandMethod, (typeof PARAMETERLESS)[number]>> = Extract<Command, { method: M }>['params'];

/** Exhaustiveness: fails to compile if a `CommandMethod` has no branch in `commandSchema`. */
type _MissingCommandBranch = Exclude<CommandMethod, Command['method']>;
((): _MissingCommandBranch extends never ? true : ['commandSchema missing', _MissingCommandBranch] => true)();
/** And the other way: a branch for a method the protocol does not have. */
type _ExtraCommandBranch = Exclude<Command['method'], CommandMethod>;
((): _ExtraCommandBranch extends never ? true : ['commandSchema invented', _ExtraCommandBranch] => true)();

/** The typed params of one command, or the issues that refused them. `method` must already be resolved. */
export type CommandRead = { readonly ok: true; readonly value: Command } | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

/**
 * Reads one command's parameters.
 *
 * What travels on is the object the HOST sent, never `result.data`: a
 * `z.object` strips the keys it was not told about, and `loadScene`'s document
 * is a whole scene that must cross the boundary as it arrived. The schema
 * judged the value; it did not replace it.
 */
export function readCommand(method: CommandMethod, params: unknown): CommandRead {
  const command: { method: CommandMethod; params?: unknown } = { method, params };
  const result = z.safeParse(commandSchema, command);
  if (result.success) return { ok: true, value: command as Command };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      // A structured clone carries no symbol keys, so every step of a path
      // found in a `postMessage` command is already a string or an index.
      path: issue.path as readonly (string | number)[],
      message: issue.message,
      code: issue.code,
    })),
  };
}

// ------------------------------------------------------------------ the events

/**
 * The `ready` payload alone, named because `embed/host.ts` re-implements it by
 * hand under a 4 KB budget and `host.test.ts` runs both over one set of
 * fixtures.
 *
 * `options` is OPTIONAL here while `EmbedEventMap['ready']` declares it: a
 * `z.unknown()` field is REQUIRED in Zod 4.6 (an absent key is `invalid_type`),
 * and a `ready` that names only its `sceneId` has always been accepted on this
 * wire. `sceneId` is what a host actually branches on, so it is what the check
 * is about.
 */
export const readyPayloadSchema = z.object(
  { options: z.optional(z.unknown()), sceneId: wireString },
  {
    error: 'must be an object naming a `sceneId`',
  },
);

/** What the frame pushes unasked (`EmbedEventMap`); the contract the host's hand check must agree with. */
export const eventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('ready'), payload: readyPayloadSchema }),
  z.object({ event: z.literal('error'), payload: z.object({ code: errorCodeSchema, message: wireString }) }),
  z.object({ event: z.literal('scene'), payload: z.object({ sceneId: wireString, rev: finiteNumber }) }),
  z.object({ event: z.literal('mode'), payload: viewerModeSchema }),
  z.object({
    event: z.literal('select'),
    payload: z.object({
      kind: selectionKindSchema,
      id: z.optional(wireUuid),
      wallId: z.optional(wireUuid),
      roomId: z.optional(wireUuid),
      face: z.optional(wireFaceKey),
      point: z.optional(z.object({ x: finiteNumber, z: finiteNumber })),
      mode: viewerModeSchema,
    }),
  }),
  z.object({
    event: z.literal('progress'),
    payload: z.object({
      state: tourStateSchema,
      fraction: finiteNumber,
      distance: finiteNumber,
      length: finiteNumber,
      elapsed: finiteNumber,
      duration: finiteNumber,
      speed: tourSpeedSchema,
    }),
  }),
  z.object({ event: z.literal('state'), payload: z.object({ state: tourStateSchema }) }),
  z.object({ event: z.literal('ended'), payload: z.object({}) }),
  z.object({ event: z.literal('size'), payload: z.object({ width: finiteNumber, height: finiteNumber }) }),
  z.object({ event: z.literal('disposed'), payload: z.undefined() }),
]);

/** One event, name and payload together. */
export type EmbedEvent = z.infer<typeof eventSchema>;

/** The payload the schema accepts for one event name; `protocol.schema.test.ts` proves it covers `EmbedEventMap`. */
export type PayloadOf<E extends EmbedEvent['event']> = Extract<EmbedEvent, { event: E }>['payload'];

// --------------------------------------------------------------- the envelope

/** The three fields every message of this channel carries (`Envelope` in `protocol.ts`). */
const envelopeShape = { channel: z.literal(CHANNEL), version: z.literal(PROTOCOL_VERSION), viewerId: z.string() };

/**
 * Whether a `MessageEvent.data` is one of ours, as a schema: this channel, this
 * protocol version, a string `viewerId`, and the correlation fields its `kind`
 * needs. The FRAME reads its traffic through `isJeexEnvelope`; the host helper
 * keeps `protocol.ts`'s hand-written `isJeexMessage` for its 4 KB budget, and
 * `protocol.schema.test.ts` runs the two over the same fixtures.
 *
 * Only the envelope is judged here: a command's `params` are `readCommand`'s,
 * and `method` is resolved against the method list by `resolveMethod`.
 */
export const jeexMessageSchema = z.discriminatedUnion('kind', [
  z.object({ ...envelopeShape, kind: z.literal('command'), id: z.string(), method: z.string() }),
  z.object({ ...envelopeShape, kind: z.literal('reply'), id: z.string(), ok: z.boolean() }),
  z.object({ ...envelopeShape, kind: z.literal('event'), event: z.string() }),
]);

/** `jeexMessageSchema` as a guard; the message itself flows on untouched, never `result.data`. */
export function isJeexEnvelope(data: unknown): data is JeexMessage {
  return z.safeParse(jeexMessageSchema, data).success;
}
