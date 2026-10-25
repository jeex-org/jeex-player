/**
 * One raw option value against its `OptionSpec`: the validators, the
 * single `option-invalid` warning every one of them reports through, and the
 * sink that warning goes to for the length of one resolve.
 *
 * It is separate from `viewer-options.ts` because the two answer different
 * questions. That file is the CONTRACT and the TABLE — what the options are,
 * what they default to, and how a query string and a dataset spell them; this
 * is the one place that decides whether a value is usable and what happens
 * when it is not.
 *
 * Refusal invariant: a value that fails its kind never reaches the viewer.
 * Every resolver answers its row's default and says so exactly once, so a
 * host that misspells an option gets a working viewer and a readable
 * complaint rather than a blank canvas. Each resolver now asks
 * `judgeOption` (`viewer-options.schema.ts`) WHETHER a value is usable; this
 * module still decides what happens when it is not (the default, the one
 * warning) and owns the one transform a verdict does not carry —
 * `resolveLocaleTag` for `locale`.
 *
 * Invariant: this module imports no Zod, in any spelling — `check:arch`'s
 * `zod-only-in-schema-modules` rule forbids it, and it is what keeps this
 * file in `src/purity.test.ts`'s `PURE_MODULES`. It calls `judgeOption`,
 * which answers a plain `{ ok }` result, never a Zod type.
 *
 * Pure module: no `three`, no DOM.
 */

import { createLogger, type Logger, type LogSink } from '../shared/logger.js';
import { resolveLocaleTag, type Locale } from '../ui/messages.js';
import { judgeOption, type OptionSpec } from './viewer-options.schema.js';
import { judgeHdriOption } from './hdri-option.schema.js';
import type { HdriOption } from '../lighting/hdri-entry.js';

/**
 * `OptionSpec` is declared in `viewer-options.schema.ts` now (`judgeOption`
 * needs it, and importing it back from here would close a cycle — see that
 * file's header) and re-exported here so that every existing
 * `import { type OptionSpec } from './option-resolvers.js'`
 * (`viewer-options.ts`, `viewer-options.test.ts`) keeps working unedited.
 */
export type { OptionSpec };

/**
 * Where a bad option is reported. It is a module-level binding rather than a
 * parameter threaded through every resolver because `resolveViewerOptions` is
 * synchronous and single-threaded: it points the sink at this call's `onLog`
 * for the length of the fold, and puts it back afterwards.
 */
let sink = createLogger();

/**
 * The one `option-invalid` message, over an EXPLICIT logger — the half of
 * `warn` that does not depend on the module-level `sink`, so the compound
 * pre-pass below (which runs inside `optionsFromRecord`, before a host's
 * `onLog` is known to `resolveViewerOptions`) can still report through
 * whatever logger ITS caller gave it.
 */
export function warnInvalid(log: Logger, path: string, value: unknown, fallback: unknown): void {
  log.warn(
    'option-invalid',
    `viewer options: ${path} = ${JSON.stringify(value) ?? String(value)} is not valid; using ${JSON.stringify(fallback)}`,
    {
      path,
      value,
      fallback,
    },
  );
}

/**
 * The `option-invalid` warning of an option that has no fallback value: the
 * part named by `path` is dropped. The value is not echoed (it may carry
 * signed URLs); `reason` says what was wrong.
 */
function warnDropped(path: string, reason: string): void {
  sink.warn('option-invalid', `viewer options: ${path} is not valid (${reason}); dropped`, { path, reason });
}

/**
 * `lighting.hdri`: a typed object with no string spelling, judged entry by
 * entry (`hdri-option.schema.ts`); a refused entry is dropped with one
 * warning and its siblings are kept.
 */
export function resolveHdri(value: unknown): HdriOption {
  const verdict = judgeHdriOption(value);
  for (const refusal of verdict.refused) warnDropped(refusal.path, refusal.message);
  return verdict.value;
}

function warn(path: string, value: unknown, fallback: unknown): void {
  warnInvalid(sink, path, value, fallback);
}

function resolveEnum(path: string, value: unknown, spec: OptionSpec): string {
  const fallback = spec.default as string;
  if (value === undefined) return fallback;
  if (judgeOption(spec, value).ok) return value as string;
  warn(path, value, fallback);
  return fallback;
}

/** `fraction` and `pixels`: one finite number, judged against its row's range. */
function resolveNumber(path: string, value: unknown, spec: OptionSpec): number {
  const fallback = spec.default as number;
  if (value === undefined) return fallback;
  if (judgeOption(spec, value).ok) return value as number;
  warn(path, value, fallback);
  return fallback;
}

function resolveFlag(path: string, value: unknown, spec: OptionSpec): boolean {
  const fallback = spec.default as boolean;
  if (value === undefined) return fallback;
  if (judgeOption(spec, value).ok) return value as boolean;
  warn(path, value, fallback);
  return fallback;
}

function resolveString(path: string, value: unknown, spec: OptionSpec): string | undefined {
  const fallback = spec.default as string | undefined;
  if (value === undefined) return fallback;
  if (judgeOption(spec, value).ok) return value as string;
  warn(path, value, fallback);
  return fallback;
}

/**
 * A CLOSED list, copied rather than passed through.
 *
 * The copy is what stops the one array in `DEFAULT_VIEWER_OPTIONS` from being
 * handed to every mount on the page — `resolveViewerOptions` already promises
 * never to hand back the defaults object itself — and it means a host that
 * keeps mutating the array it passed cannot change a viewer that is already
 * running.
 */
/**
 * The telemetry endpoint override. An invalid value — a string the endpoint
 * check refuses, or no string at all — resolves to `''`, which telemetry reads
 * as OFF; it must never fall back to `undefined`, which means the DEFAULT
 * endpoint, or a typo would send where the host asked it not to.
 */
function resolveEndpoint(path: string, value: unknown, spec: OptionSpec): string | undefined {
  if (value === undefined) return spec.default as undefined;
  if (judgeOption(spec, value).ok) return value as string;
  warn(path, value, 'telemetry off');
  return '';
}

/**
 * An on/off switch that FAILS CLOSED (`analytics.mode`): absent or exactly
 * `'on'` is on; `'off'` and `false` are off; ANY other value is off too, with
 * the usual warning — a typo must never switch telemetry on.
 */
function resolveSwitch(path: string, value: unknown): 'on' | 'off' {
  if (value === undefined || value === 'on') return 'on';
  if (value !== 'off' && value !== false) warn(path, value, 'off');
  return 'off';
}

function resolveList(path: string, value: unknown, spec: OptionSpec): readonly string[] {
  const fallback = spec.default as readonly string[];
  if (value === undefined) return [...fallback];
  if (judgeOption(spec, value).ok) return [...(value as readonly string[])];
  warn(path, value, fallback);
  return [...fallback];
}

/**
 * A locale the registry knows, or the default.
 *
 * The set is judged at RESOLVE time (`judgeOption`'s schema reads
 * `messages.locales()` through `isLocale` fresh on every call), so a host
 * that called `registerLocale('de', …)` before mounting gets `de` accepted.
 * The `typeof` guard is for TypeScript's narrowing, not for the verdict:
 * `judgeOption` already refuses a non-string through `z.string()` before its
 * `isLocale` check ever runs.
 * The BCP-47 tag is taken to its CANONICAL form on the way out
 * (`resolveLocaleTag`): `lang="ru-RU"` is what an HTML page writes, `sr` is
 * what an old link carries, and `ru` / `sr-Latn` are what the catalogue is
 * keyed by. The schema JUDGES the tag without transforming it.
 */
function resolveLocale(path: string, value: unknown, spec: OptionSpec): Locale {
  const fallback = spec.default as Locale;
  if (value === undefined) return fallback;
  if (typeof value === 'string' && judgeOption(spec, value).ok) return resolveLocaleTag(value) ?? fallback;
  warn(path, value, fallback);
  return fallback;
}

/** `temperature`: a whole step of kelvin inside the range, or `null` for «Original» (the default). */
function resolveTemperature(path: string, value: unknown, spec: OptionSpec): number | null {
  const fallback = spec.default as number | null;
  if (value === undefined) return fallback;
  if (judgeOption(spec, value).ok) return value as number | null;
  warn(path, value, fallback);
  return fallback;
}

/** Validates one raw value against its `OptionSpec`, dispatching on `kind`. */
export function resolveBySpec(path: string, value: unknown, spec: OptionSpec): unknown {
  switch (spec.kind) {
    case 'locale':
      return resolveLocale(path, value, spec);
    case 'enum':
      return resolveEnum(path, value, spec);
    case 'flag':
      return resolveFlag(path, value, spec);
    case 'fraction':
    case 'pixels':
      return resolveNumber(path, value, spec);
    case 'string':
      return resolveString(path, value, spec);
    case 'endpoint':
      return resolveEndpoint(path, value, spec);
    case 'switch':
      return resolveSwitch(path, value);
    case 'list':
      return resolveList(path, value, spec);
    case 'temperature':
      return resolveTemperature(path, value, spec);
  }
}

/**
 * Points the sink at `log` for the length of `run`, and puts it back.
 *
 * `resolveViewerOptions` is synchronous and single-threaded, so one module
 * binding is enough; the alternative is a logger threaded through every
 * resolver and every `resolveBySpec` call, which buys nothing.
 */
export function withOptionSink<T>(log: LogSink | undefined, run: () => T): T {
  const previous = sink;
  sink = createLogger(log);
  try {
    return run();
  } finally {
    sink = previous;
  }
}
