/**
 * The closed vocabularies of a telemetry send and the hand-written shapes of
 * every group, the contract `telemetry.schema.ts` is proved against.
 *
 * Invariant: every string a send can carry is either a member of one of these
 * sets, a bucket label from `buckets.ts`, a version, an origin, a sanitised
 * path, a UUID or an own file name. Adding a field or a member here is a
 * schema change: `TELEMETRY_SCHEMA_VERSION` moves, the generated
 * `telemetry.schema.json` is regenerated and `CHANGELOG.md` says so.
 *
 * Pure module: no `three`, no DOM.
 */

import type { DwellBucket, FpsBucket, LoadBucket, WidthBucket } from './buckets.js';
import { SHIPPED_LOCALES } from '../ui/messages.js';

/** Semver of the payload schema; every send carries it as `schema`. */
export const TELEMETRY_SCHEMA_VERSION = '1.0.0';

/** Where sends go when nothing overrides it. */
export const DEFAULT_TELEMETRY_ENDPOINT = 'https://telemetry.jeex.org/v1/player';

export const EMBED_FORMS = ['element', 'iframe', 'script'] as const;
export type EmbedForm = (typeof EMBED_FORMS)[number];

/** `lang`: a shipped locale, or `other` for anything a host registered itself. */
export const TELEMETRY_LANGS = [...SHIPPED_LOCALES, 'other'] as const;
export type TelemetryLang = (typeof TELEMETRY_LANGS)[number];

export const MODEL_OUTCOMES = ['complete', 'partial', 'budget', 'none'] as const;
export type ModelOutcome = (typeof MODEL_OUTCOMES)[number];

/** The keys of `actions.counts`: one accepted user action each. */
export const COUNTER_KEYS = [
  'mode',
  'interior',
  'select_furniture',
  'select_opening',
  'select_wall',
  'select_room',
  'panel',
  'door',
  'fullscreen',
  'minimap',
  'camera_step',
  'tour_start',
  'tour_complete',
] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

export const GPU_CLASSES = ['low', 'mid', 'high', 'none'] as const;
export type GpuClass = (typeof GPU_CLASSES)[number];

export const INPUT_TYPES = ['touch', 'pointer'] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const ERROR_CODES = [
  'network',
  'scene_format',
  'manifest_format',
  'model_format',
  'webgl_unavailable',
  'context_lost',
  'size_limit',
  'exception',
  'rejection',
  'other',
] as const;
export type TelemetryErrorCode = (typeof ERROR_CODES)[number];

/** The codes that are reported only with at least one own stack frame. */
export const STACK_CODES: ReadonlySet<TelemetryErrorCode> = new Set<TelemetryErrorCode>(['exception', 'rejection', 'other']);

export const ERROR_STAGES = ['scene_load', 'model_load', 'capture', 'mode', 'tour', 'embed', 'bridge', 'runtime'] as const;
export type ErrorStage = (typeof ERROR_STAGES)[number];

/**
 * The error class names a report may carry. `error.name` is writable free
 * text, so anything else is reported as `Error`.
 */
export const ERROR_NAMES = [
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
  'InternalError',
  'ViewerLibError',
  'SceneValidationError',
  'AbortError',
  'NetworkError',
  'NotSupportedError',
  'NotAllowedError',
  'InvalidStateError',
  'SecurityError',
  'QuotaExceededError',
  'DataCloneError',
  'EncodingError',
  'TimeoutError',
  'OperationError',
  'UnknownError',
] as const;
export type ErrorName = (typeof ERROR_NAMES)[number];

/** What was played: validated UUIDs only, `null` when unknown. */
export type TelemetrySubject = { project: string | null; bake: string | null; scene: string | null };

/** The fields every send carries. */
export type TelemetryContext = {
  schema: string;
  player: string;
  embed: EmbedForm;
  site: string | null;
  page: string | null;
  subject: TelemetrySubject;
  lang: TelemetryLang;
};

export type LifecycleSend = TelemetryContext &
  (
    | { group: 'lifecycle'; event: 'view' }
    | { group: 'lifecycle'; event: 'ready'; load: LoadBucket }
    | { group: 'lifecycle'; event: 'models_loaded'; load: LoadBucket; outcome: ModelOutcome; failed: number; assets: string[] }
  );

export type ActionsSend = TelemetryContext & { group: 'actions'; counts: Record<CounterKey, number> };

export type RoomsSend = TelemetryContext & { group: 'rooms'; rooms: Array<{ room: string; dwell: DwellBucket }> };

export type DeviceSend = TelemetryContext & {
  group: 'device';
  fps: Record<FpsBucket, number>;
  gpu: GpuClass;
  width: WidthBucket;
  input: InputType;
  fullscreen: number;
};

export type ErrorFrame = { file: string; line: number; column: number };

export type ErrorSend = TelemetryContext & {
  group: 'error';
  code: TelemetryErrorCode;
  stage: ErrorStage;
  name: ErrorName;
  frames: ErrorFrame[];
  browser: string;
  count: number;
};

export type TelemetrySend = LifecycleSend | ActionsSend | RoomsSend | DeviceSend | ErrorSend;
