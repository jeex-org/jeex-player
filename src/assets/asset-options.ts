/**
 * Typed option bags for the procedural builders.
 *
 * A builder's `options` arrive from a library manifest as
 * `Record<string, number | string | boolean>` — untyped by necessity, because
 * every archetype has different ones. The problem was that untypedness leaking
 * all the way into the geometry (`asset-builders-storage.ts` reached a
 * cognitive complexity of 90): 46 `optionNumber('doors', 0)` /
 * `optionText('legs', 'none')` calls across 25 builders, each re-spelling a key
 * and a default, each clamping with its own `Math.max(0, Math.round(...))`, and
 * `legs === 'taperd'` a typo away from silently taking the other branch.
 *
 * A builder now declares its options ONCE, `as const satisfies
 * Record<string, OptionSpec>`, and reads them in one line. The declaration is
 * the schema:
 *
 * - a `text` option names the CLOSED SET it may take, so `options.legs` is
 *   `'none' | 'tapered'` and a comparison against anything else does not
 *   compile — and a manifest value outside the set falls back to the default
 *   instead of reaching the geometry;
 * - a `number` option carries its range (`min`, `max`, `integer`), so the
 *   clamp lives with the declaration rather than at each use.
 *
 * Invariant: `readOptions` never throws and never answers `undefined`. A
 * missing, mistyped or out-of-set option IS the default — a manifest is data
 * from a publisher, and a viewer that refuses to draw a sofa because one option
 * is misspelt is worse than one that draws the default sofa.
 *
 * Pure module: no `three`, no DOM.
 */

import type { AssetOptions } from './asset-types.js';

/** How one option is read. */
export type OptionSpec =
  | {
      readonly kind: 'number';
      readonly default: number;
      /** Lower clamp, inclusive. */
      readonly min?: number;
      /** Upper clamp, inclusive. */
      readonly max?: number;
      /** Rounded to the nearest integer — a count, not a measurement. */
      readonly integer?: boolean;
    }
  | { readonly kind: 'flag'; readonly default: boolean }
  | {
      readonly kind: 'text';
      /** The closed set. Anything else in the manifest is the default. */
      readonly values: readonly string[];
      readonly default: string;
    };

/** The value one spec produces: a `text` option is narrowed to its own set. */
type OptionValue<S extends OptionSpec> = S extends { readonly kind: 'number' }
  ? number
  : S extends { readonly kind: 'flag' }
    ? boolean
    : S extends { readonly kind: 'text'; readonly values: readonly (infer V)[] }
      ? V
      : never;

/** One builder's whole bag, typed by its own declaration. */
export type Options<S extends Readonly<Record<string, OptionSpec>>> = { readonly [K in keyof S]: OptionValue<S[K]> };

function readNumber(value: unknown, spec: Extract<OptionSpec, { kind: 'number' }>): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : spec.default;
  const rounded = spec.integer === true ? Math.round(raw) : raw;
  const floored = spec.min === undefined ? rounded : Math.max(spec.min, rounded);
  return spec.max === undefined ? floored : Math.min(spec.max, floored);
}

function readOne(value: unknown, spec: OptionSpec): number | string | boolean {
  if (spec.kind === 'number') return readNumber(value, spec);
  if (spec.kind === 'flag') return typeof value === 'boolean' ? value : spec.default;
  return typeof value === 'string' && spec.values.includes(value) ? value : spec.default;
}

/**
 * One builder's options, read against its declaration.
 *
 * The one cast in this module, and the reason it exists: the loop reads the
 * spec keys at runtime, where the mapped type `Options<S>` is not something a
 * `Record<string, …>` accumulator can be given. Every value put into it comes
 * from `readOne` on that key's own spec, which is exactly what the mapped type
 * says.
 */
export function readOptions<S extends Readonly<Record<string, OptionSpec>>>(bag: AssetOptions, spec: S): Options<S> {
  const out: Record<string, number | string | boolean> = {};
  for (const key of Object.keys(spec)) out[key] = readOne(bag[key], spec[key]!);
  return out as Options<S>;
}
