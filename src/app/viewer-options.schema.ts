/**
 * The `OptionKind` schemas judged at the mount-option boundary
 * (`option-resolvers.ts`'s resolvers), grown by a later task into the
 * compile-time contract for the whole resolved `ViewerOptions` object.
 *
 * Invariant: fallback-and-warn is `option-resolvers.ts`'s contract, not this
 * file's. A schema here only JUDGES one raw value against its `OptionSpec`
 * row (`judgeOption`); the default, the one `option-invalid` warning and the
 * `resolveLocaleTag` transform for `locale` all stay in the resolver. Refusing by
 * default the way a bare schema would is exactly the behaviour this file
 * must NOT introduce: a host with one slightly wrong attribute would lose the
 * whole viewer instead of one option.
 *
 * `OptionKind`/`OptionSpec` are declared HERE rather than in
 * `option-resolvers.ts` — which re-exports both, so nothing importing them
 * from there changes — because `option-resolvers.ts` calls `judgeOption`:
 * a type import back from here to there would close a two-file cycle
 * `check:arch`'s `no-circular` rule refuses even when one of the two edges is
 * type-only (proved empirically before this file was written: a type edge
 * one way plus a value edge the other way is still a cycle to
 * dependency-cruiser, which is why the rule fired on a two-line throwaway
 * reproduction with exactly that shape).
 *
 * The value sets below are literal copies, for two different reasons.
 * `view.mode`, `tour.mode`, `motion`, `interaction` and `edits` copy closed
 * sets `viewer-options.ts` declares PRIVATELY (`VIEW_MODES`, `TOUR_MODES`,
 * `MOTION_MODES`, `INTERACTION_MODES`, `EDITS_MODES`): importing them would
 * reopen the same cycle one hop further out (`viewer-options.ts` ->
 * `option-resolvers.ts` -> this file -> `viewer-options.ts`). `slots` — a
 * `list`, not an enum — copies `SLOT_VALUES`, which is not private at all: it
 * lives in `app/option-sets.ts`, is itself a copy of `ui/host-slots.ts`'s
 * `SLOT_NAMES`, and is duplicated here for a different reason, the DOM
 * boundary that module's header explains.
 * `viewer-options.schema.test.ts`'s compile-time
 * agreement check is what catches any of them ever
 * drifting apart, so the duplication is PROVEN rather than merely asserted.
 *
 * `viewerOptionsSchema` (added by a later task) judges the WHOLE resolved
 * object at once, minus `onLog` (a function) and `scene` (a host's own
 * document plus a live loader) — `viewer-options.ts`'s `DeepPartial` gives
 * the same reason for excluding both. It is a compile-time contract and a
 * source of documentation, not a second runtime gate on top of
 * `resolveViewerOptions`: nothing in this library ever calls
 * `viewerOptionsSchema.safeParse` on a value it is about to use.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { isLocale } from '../ui/messages.js';
import { isTelemetryEndpoint } from '../telemetry/telemetry.schema.js';
import { isLightTemperature } from '../lighting/colour-temperature.js';
import { TEMPERATURE_RANGE } from '../lighting/temperature-range.js';

/**
 * How one option is declared, resolved and reached from the two adapters.
 *
 * `locale` is its own kind rather than an `enum` because its accepted set is
 * NOT fixed at build time: `messages.registerLocale` lets a host add a
 * language this build never shipped, and a schema built once at module load
 * would refuse it.
 */
export type OptionKind = 'enum' | 'flag' | 'fraction' | 'pixels' | 'string' | 'locale' | 'list' | 'endpoint' | 'switch' | 'temperature';

export type OptionSpec = {
  kind: OptionKind;
  /**
   * Accepted values; READ only by `kind: 'enum'` and `kind: 'list'`, and
   * optional because this is one type for every kind. A row of those two kinds
   * that forgets it still compiles and then refuses every value with an
   * `option-invalid` warning — `buildSchema` builds `z.enum([])`. The generic
   * per-row harness in `viewer-options.test.ts` catches that on the first run;
   * making it a compile error means splitting `OptionSpec` into a discriminated
   * union, which reaches `src/embed/protocol.schema.ts`, so it is left as a
   * known follow-up instead.
   */
  values?: readonly string[];
  default: unknown;
  /** `?<query>=` parameter name. */
  query: string;
  /** `data-<attr>` HTML attribute name (kebab-case; `optionsFromDataset` camelCases it). */
  attr: string;
};

const TEMPERATURE_ERROR = `must be null or a whole multiple of ${TEMPERATURE_RANGE.step} from ${TEMPERATURE_RANGE.min} to ${TEMPERATURE_RANGE.max}`;

/**
 * A whole step of kelvin inside the lighting standard's range, or `null` for
 * «Original»: the one schema the option, the options object and the iframe
 * command and event share. Its message is what an iframe host is told.
 */
export const lightTemperatureSchema = z.nullable(
  z.number({ error: TEMPERATURE_ERROR }).check(z.refine((value) => isLightTemperature(value), { error: TEMPERATURE_ERROR })),
);

/**
 * One schema per `OptionKind`, built fresh from the row.
 *
 * `fraction` refuses `NaN` and both infinities for free: `z.number()` in Zod
 * 4.6 already means FINITE (`scene/types.schema.ts` proved this first), and
 * `Number('x')` — what a garbage query-string value becomes before it gets
 * here — is `NaN`.
 */
function buildSchema(spec: OptionSpec) {
  switch (spec.kind) {
    case 'enum':
    case 'switch':
      return z.enum(spec.values ?? []);
    case 'list':
      // A CLOSED list: every member of the array is one of the row's values.
      // An empty array is valid — it is what "no box asked for" looks like —
      // and a bare string is not, which is the mistake `slots: 'top-left'`
      // makes.
      return z.array(z.enum(spec.values ?? []));
    case 'flag':
      return z.boolean();
    case 'fraction':
      return z.number().check(z.gte(0), z.lte(1));
    case 'pixels':
      // A CSS length in pixels: finite (as above) and never negative.
      return z.number().check(z.gte(0));
    case 'string':
      return z.string();
    case 'locale':
      return z.string().check(z.refine((value) => isLocale(value)));
    case 'endpoint':
      // The telemetry endpoint override: judged by telemetry's own check.
      return z.string().check(z.refine((value) => isTelemetryEndpoint(value)));
    case 'temperature':
      return lightTemperatureSchema;
  }
}

type OptionSchema = ReturnType<typeof buildSchema>;

/**
 * Cached by ROW IDENTITY: `OPTION_SCHEMA`'s rows are stable object references
 * for the life of the module, so a row's schema (`z.enum(spec.values)` and
 * the like) is built once rather than once per `resolveViewerOptions` call.
 * `locale` is the one kind excluded — see `schemaFor`.
 */
const SCHEMA_CACHE = new WeakMap<OptionSpec, OptionSchema>();

/**
 * The schema for one row. `locale` is rebuilt on every call rather than
 * cached: `messages.registerLocale` can add a language between two
 * `resolveViewerOptions` calls, and a schema cached at the first call would
 * never see a language registered after it.
 */
function schemaFor(spec: OptionSpec): OptionSchema {
  if (spec.kind === 'locale') return buildSchema(spec);
  const cached = SCHEMA_CACHE.get(spec);
  if (cached) return cached;
  const built = buildSchema(spec);
  SCHEMA_CACHE.set(spec, built);
  return built;
}

/**
 * The verdict on ONE raw option value against its row.
 *
 * It answers a plain result, never a Zod type: `option-resolvers.ts` is not a
 * schema module and may not name one. `undefined` never reaches here — an
 * absent option is the caller's own early return, exactly as before this
 * schema existed.
 */
export function judgeOption(spec: OptionSpec, value: unknown): { readonly ok: true } | { readonly ok: false } {
  return z.safeParse(schemaFor(spec), value).success ? { ok: true } : { ok: false };
}

// -------------------------------------------------------- viewerOptionsSchema --
//
// One literal enum per closed set the resolved object carries. Each is a
// duplicate of a same-named private array in `viewer-options.ts`, by
// necessity (module header); `viewer-options.schema.test.ts`'s compile-time
// agreement check is what proves the duplicate has not drifted.

const VIEW_MODE_VALUES = ['plan2d', 'plan3d', 'orbit', 'walk', 'tour'] as const;
const SLOT_VALUES = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'modal-root',
  'selection-anchor',
] as const;
const EDITS_VALUES = ['local', 'emit', 'off'] as const;
const TOUR_MODE_VALUES = ['play', 'paused', 'off'] as const;
const MOTION_VALUES = ['auto', 'full', 'reduced'] as const;
const INTERACTION_VALUES = ['full', 'none', 'passive'] as const;

/**
 * `ViewerOptions` minus the two fields no schema can usefully describe:
 * `onLog` is a function and `scene` is a `SceneSource` whose `repository` is
 * a live loader and whose `document` is the host's own object
 * (`viewer-options.ts`'s `DeepPartial` says exactly this). Both stay opaque
 * here and are proved only to be present-or-absent by `viewer-options.ts`
 * itself, which is where they are actually used.
 */
export const viewerOptionsSchema = z.object({
  view: z.object({ mode: z.enum(VIEW_MODE_VALUES), minimap: z.boolean() }),
  tour: z.object({
    mode: z.enum(TOUR_MODE_VALUES),
    start: z.number().check(z.gte(0), z.lte(1)),
    progressBar: z.boolean(),
    pauseOnInput: z.boolean(),
  }),
  doors: z.object({ interactive: z.boolean(), autoOpen: z.boolean() }),
  interiors: z.object({ selector: z.boolean() }),
  chrome: z.object({
    brand: z.boolean(),
    controls: z.boolean(),
    status: z.boolean(),
    modeSwitcher: z.boolean(),
    hint: z.boolean(),
    autoHide: z.boolean(),
  }),
  fullscreenButton: z.object({
    show: z.boolean(),
    right: z.number().check(z.gte(0)),
    top: z.number().check(z.gte(0)),
  }),
  readonly: z.boolean(),
  capture: z.object({ disclosure: z.object({ caption: z.boolean(), text: z.optional(z.string()) }) }),
  plan: z.object({ labels: z.boolean(), dimensions: z.boolean(), camera: z.boolean() }),
  locale: z.string(),
  motion: z.enum(MOTION_VALUES),
  interaction: z.enum(INTERACTION_VALUES),
  select: z.boolean(),
  // `z.readonly` is not decoration: `ViewerOptions['slots']` is a READONLY
  // array, and `readonly SlotName[] extends SlotName[]` is false — without it
  // the agreement check in `viewer-options.schema.test.ts` collapses to
  // `false` and stops compiling.
  slots: z.readonly(z.array(z.enum(SLOT_VALUES))),
  edits: z.enum(EDITS_VALUES),
  debug: z.boolean(),
  analytics: z.object({ mode: z.enum(['on', 'off']), endpoint: z.optional(z.string()) }),
  settings: z.object({ show: z.boolean() }),
  lighting: z.object({ temperature: lightTemperatureSchema }),
});
