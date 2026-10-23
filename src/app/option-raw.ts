/**
 * One raw string — what a query string or an HTML attribute carries — turned
 * into the shape its `OptionKind` expects, before anything judges it.
 *
 * It is separate from `viewer-options.ts` (the contract and the table) and
 * from `option-resolvers.ts` (the one validator): this is SYNTAX only. A
 * string that does not read as its kind is handed on as it is, garbage
 * included, so the resolver reports it once, in one place, whatever door it
 * came in through.
 *
 * Pure module: no `three`, no DOM.
 */

import type { OptionKind } from './viewer-options.schema.js';

/**
 * `0`/`1` and `false`/`true` are the accepted spellings. Anything else is
 * handed on as it is so the resolver reports it, rather than being silently
 * read as "false".
 */
export function asFlag(raw: string): boolean {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return raw as unknown as boolean;
}

/** The spelling of «Original» (no colour temperature) in a query string or an attribute. */
export const ORIGINAL_TEMPERATURE = 'original';

/** Converts one raw string to the shape its `OptionKind` expects; validation happens in `resolveViewerOptions`. */
export function convertRaw(kind: OptionKind, raw: string): unknown {
  switch (kind) {
    case 'flag':
      return asFlag(raw);
    case 'fraction':
    case 'pixels':
      // `Number('')` is 0: an empty `?fullscreenButtonRight=` stays a string so it warns and falls back.
      return raw.trim() === '' ? raw : Number(raw);
    case 'temperature':
      // `original` is «Original»; any other word stays a string, so it warns and keeps «Original».
      if (raw === ORIGINAL_TEMPERATURE) return null;
      return raw.trim() === '' ? raw : Number(raw);
    case 'list':
      // Trimmed, because `?slots=a, b ` is what a hand-written URL carries;
      // empty means no box. The names themselves are the resolver's to judge.
      return raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    case 'enum':
    case 'locale':
    case 'string':
    case 'endpoint':
    case 'switch':
      return raw;
  }
}
