/**
 * The closed schema of every telemetry send, as `zod/mini`, and the check of an
 * endpoint override.
 *
 * Judging invariant: a send is parsed right before it is serialised and is
 * DROPPED when it fails; nothing here repairs, trims or transforms. Every
 * object is strict at every level, every array is bounded and every string is
 * an enum, a bucket, a pattern-checked version, origin, path, UUID or file
 * name — so a send that passes carries nothing the schema does not name.
 * `vocabulary.ts` holds the hand-written types, and the agreement check in
 * `telemetry.schema.test.ts` proves the two describe the same shapes.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { UUID_V7_PATTERN } from '../scene/types.js';
import { DWELL_BUCKETS, FPS_BUCKETS, LOAD_BUCKETS, WIDTH_BUCKETS, COUNTER_CAP } from './buckets.js';
import { MAX_FRAMES } from './stack-frames.js';
import { PAGE_PATH_LIMIT } from './page-path.js';
import {
  COUNTER_KEYS,
  EMBED_FORMS,
  ERROR_CODES,
  ERROR_NAMES,
  ERROR_STAGES,
  GPU_CLASSES,
  INPUT_TYPES,
  MODEL_OUTCOMES,
  TELEMETRY_LANGS,
  type CounterKey,
  type TelemetrySend,
} from './vocabulary.js';

/** At most this many library asset ids in `models_loaded`. */
export const MAX_ASSETS = 50;
/** At most this many rooms in one `rooms` send. */
export const MAX_ROOMS = 100;

const uuid = z.string().check(z.regex(UUID_V7_PATTERN));
const nullableUuid = z.nullable(uuid);
const semver = z.string().check(z.regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,32})?$/));
/** An `http(s)` origin: scheme, host, optional port, nothing else. */
const origin = z.string().check(z.maxLength(253), z.regex(/^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i));
/** A sanitised path: rooted, no query, no fragment, no whitespace. */
const path = z.string().check(z.maxLength(PAGE_PATH_LIMIT), z.regex(/^\/[^?#\s]*$/));
/** A bare published file name of the player. */
const file = z.string().check(z.maxLength(120), z.regex(/^(?:lazy-)?jeex-viewer[\w.-]*\.js$/));
const count = z.int().check(z.gte(0), z.lte(COUNTER_CAP));
const tenth = z.int().check(z.gte(0), z.lte(100), z.multipleOf(10));
const position = z.int().check(z.gte(1), z.lte(10_000_000));
const browser = z.string().check(z.regex(/^(?:chromium-\d{1,3}x|firefox-\d{1,3}x|safari-\d{1,3}|other)$/));

const contextShape = {
  schema: semver,
  player: semver,
  embed: z.enum(EMBED_FORMS),
  site: z.nullable(origin),
  page: z.nullable(path),
  subject: z.strictObject({ project: nullableUuid, bake: nullableUuid, scene: nullableUuid }),
  lang: z.enum(TELEMETRY_LANGS),
};

const lifecycleSchema = z.discriminatedUnion('event', [
  z.strictObject({ ...contextShape, group: z.literal('lifecycle'), event: z.literal('view') }),
  z.strictObject({ ...contextShape, group: z.literal('lifecycle'), event: z.literal('ready'), load: z.enum(LOAD_BUCKETS) }),
  z.strictObject({
    ...contextShape,
    group: z.literal('lifecycle'),
    event: z.literal('models_loaded'),
    load: z.enum(LOAD_BUCKETS),
    outcome: z.enum(MODEL_OUTCOMES),
    failed: count,
    assets: z.array(uuid).check(z.maxLength(MAX_ASSETS)),
  }),
]);

const countsShape = Object.fromEntries(COUNTER_KEYS.map((key) => [key, count])) as Record<CounterKey, typeof count>;

const actionsSchema = z.strictObject({ ...contextShape, group: z.literal('actions'), counts: z.strictObject(countsShape) });

const roomsSchema = z.strictObject({
  ...contextShape,
  group: z.literal('rooms'),
  rooms: z.array(z.strictObject({ room: uuid, dwell: z.enum(DWELL_BUCKETS) })).check(z.minLength(1), z.maxLength(MAX_ROOMS)),
});

const fpsShape = Object.fromEntries(FPS_BUCKETS.map((bucket) => [bucket, tenth])) as Record<(typeof FPS_BUCKETS)[number], typeof tenth>;

const deviceSchema = z.strictObject({
  ...contextShape,
  group: z.literal('device'),
  fps: z.strictObject(fpsShape),
  gpu: z.enum(GPU_CLASSES),
  width: z.enum(WIDTH_BUCKETS),
  input: z.enum(INPUT_TYPES),
  fullscreen: tenth,
});

const errorSchema = z.strictObject({
  ...contextShape,
  group: z.literal('error'),
  code: z.enum(ERROR_CODES),
  stage: z.enum(ERROR_STAGES),
  name: z.enum(ERROR_NAMES),
  frames: z.array(z.strictObject({ file, line: position, column: position })).check(z.maxLength(MAX_FRAMES)),
  browser,
  count: z.int().check(z.gte(1), z.lte(COUNTER_CAP)),
});

/** Every send, by its `group`. Exported for the agreement check and the JSON Schema generator. */
export const telemetrySendSchema = z.discriminatedUnion('group', [lifecycleSchema, actionsSchema, roomsSchema, deviceSchema, errorSchema]);

/** Whether `send` is exactly a send the schema names; anything else is dropped by the caller. */
export function isTelemetrySend(send: unknown): send is TelemetrySend {
  return z.safeParse(telemetrySendSchema, send).success;
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether `raw` may replace the endpoint: an absolute `https:` URL, or `http:`
 * on the local machine, without credentials. Anything else turns sending off;
 * it never falls back to the default endpoint.
 */
function isEndpointUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
}

const endpointSchema = z
  .string()
  .check(z.maxLength(2048), z.refine(isEndpointUrl, { error: 'must be an https URL, or http on this machine' }));

/** Whether an endpoint override may be used. */
export function isTelemetryEndpoint(raw: unknown): raw is string {
  return z.safeParse(endpointSchema, raw).success;
}
