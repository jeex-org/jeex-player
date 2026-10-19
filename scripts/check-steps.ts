/**
 * Parser for `check.sh`'s own step list.
 *
 * Extracted from `check-tiers.test.ts` so `scripts/ci-parity.test.ts`
 * reads the exact same steps rather than re-deriving them from a second,
 * driftable copy. A small `if`/`fi`-depth-aware scanner — the script nests a
 * `command -v` guard inside the `code-ranker` full-only block and a
 * `[ "$TIER" = fast ]` branch inside the `bun test` step, so a flat "am I
 * inside the last-seen `if`" boolean would mis-close on those inner `fi`s.
 *
 * Three tiers: a step is
 * `full` when `if [ "$TIER" = full ]; then` is anywhere on its enclosing stack,
 * `standard` when `if [ "$TIER" != fast ]; then` is, and `fast` otherwise —
 * `fast` meaning «runs in every tier», which is what makes each tier a superset
 * of the one below it BY CONSTRUCTION. Both guards are read off the same script
 * the gate runs; nothing here is a second list.
 */

import { readFileSync } from 'node:fs';

export const CHECK_SH_PATH = new URL('./check.sh', import.meta.url);

/** The tier a step belongs to; `fast` means «every tier runs it». */
export type Tier = 'fast' | 'standard' | 'full';

export type Step = { readonly label: string; readonly tier: Tier };

/** The guard that makes the steps inside it full-only. */
export const TIER_GUARD = 'if [ "$TIER" = full ]; then';

/** The guard that makes the steps inside it standard-and-full. */
export const STANDARD_GUARD = 'if [ "$TIER" != fast ]; then';

/** What an `if … then` line contributes to the tier of the steps inside it. */
type GuardKind = Tier | 'none';

/** The tier guard an `if … then` line opens, or `none` for any other `if`. */
function guardKind(line: string): GuardKind {
  if (line === TIER_GUARD) return 'full';
  if (line === STANDARD_GUARD) return 'standard';
  return 'none';
}

/**
 * The tier of a step under these open guards: the STRICTEST one wins, because a
 * `full`-only block inside a `standard` block is still full-only.
 */
function tierOf(stack: readonly GuardKind[]): Tier {
  if (stack.includes('full')) return 'full';
  if (stack.includes('standard')) return 'standard';
  return 'fast';
}

/** Parses `check.sh`'s `echo "== …"` step labels off its own source text. */
export function parseSteps(source: string): Step[] {
  const steps: Step[] = [];
  const stack: GuardKind[] = [];
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (/^if\b.*;\s*then$/.test(line)) {
      stack.push(guardKind(line));
      continue;
    }
    if (line === 'fi') {
      stack.pop();
      continue;
    }
    const match = /^echo "== ([^"]+)"$/.exec(line);
    // `match[1]` is the regex's only (non-optional) capturing group: it exists whenever `match` does.
    if (match) steps.push({ label: match[1]!, tier: tierOf(stack) });
  }
  return steps;
}

/** Reads and parses `check.sh` itself. */
export function readCheckShSteps(): Step[] {
  return parseSteps(readFileSync(CHECK_SH_PATH, 'utf8'));
}
