/**
 * Self-test for `check.sh`'s three tiers.
 *
 * Parses `check.sh` itself — the single source of truth, not a duplicated
 * table — via `scripts/check-steps.ts` (extracted so
 * `scripts/ci-parity.test.ts` reads the exact same steps rather than a second,
 * driftable copy). A step belongs to `full` exactly when
 * `if [ "$TIER" = full ]; then` is anywhere on its enclosing stack, to
 * `standard` when `if [ "$TIER" != fast ]; then` is, and to `fast` otherwise;
 * `fast` therefore means «every tier runs it», which is what makes each tier a
 * superset of the one below BY CONSTRUCTION — all three are read off the same
 * script, the tier argument just skips the guarded steps at run time.
 *
 * The membership lists below are EXACT labels, not substrings: `npm run build`
 * is a prefix of `npm run build:lib` and `npm run check:budget` of
 * `npm run check:budget:lib`, and those two pairs now sit in DIFFERENT tiers,
 * so a substring test would quietly accept the wrong answer.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CHECK_SH_PATH, parseSteps, STANDARD_GUARD, TIER_GUARD } from './check-steps.js';

const SOURCE = readFileSync(CHECK_SH_PATH, 'utf8');
const STEPS = parseSteps(SOURCE);

/** The trailer `echo` that reports which tier ran; matched by the parser, not a gate. */
const TRAILER = 'check.sh: OK ($TIER)';

/** Steps every tier runs: the cheap static gates and the bun-test level. */
const FAST_LABELS = [
  'typecheck (src, dev, vite.config.ts)',
  'typecheck (scripts, vite configs)',
  'lint',
  'format',
  'source hygiene (spelling, headers)',
  'size-check',
  'check:arch',
  'check:dead',
  'schema: generate-to-tmp + check',
  'console policy (src/)',
  'listener policy (signal)',
  'bun test ($DIR, tier=$TIER)',
];

/** Steps `standard` adds: the full test picture and the demo build. */
const STANDARD_ONLY_LABELS = [
  'coverage floors',
  'component tests (Vitest browser mode)',
  'DOM-layer coverage floors',
  'npm run build',
  'npm run check:budget',
];

/** Steps `full` adds: Playwright, the library artefact and the release gates. */
const FULL_ONLY_LABELS = [
  'e2e tests (Playwright)',
  'npm run build:lib',
  'npm run check:budget:lib',
  'check:pkg',
  'bun audit',
  'code-ranker check',
];

function labelsOfTier(tier: 'fast' | 'standard' | 'full'): string[] {
  return STEPS.filter((step) => step.tier === tier && step.label !== TRAILER).map((step) => step.label);
}

describe('check.sh step parsing', () => {
  test('finds a plausible number of steps (parser sanity)', () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(FAST_LABELS.length + STANDARD_ONLY_LABELS.length + FULL_ONLY_LABELS.length);
  });

  test('every step label is unique', () => {
    const labels = STEPS.map((step) => step.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('check.sh tiers', () => {
  test('the fast tier is exactly the steps every tier runs', () => {
    expect(labelsOfTier('fast').sort()).toEqual([...FAST_LABELS].sort());
  });

  test('standard adds exactly the full test picture and the demo build', () => {
    expect(labelsOfTier('standard').sort()).toEqual([...STANDARD_ONLY_LABELS].sort());
  });

  test('full adds exactly Playwright, the library artefact and the release gates', () => {
    expect(labelsOfTier('full').sort()).toEqual([...FULL_ONLY_LABELS].sort());
  });

  test('every tier is a superset of the one below it', () => {
    const fast = new Set(labelsOfTier('fast'));
    const standard = new Set([...fast, ...labelsOfTier('standard')]);
    const full = new Set([...standard, ...labelsOfTier('full')]);
    for (const label of fast) expect(standard.has(label)).toBe(true);
    for (const label of standard) expect(full.has(label)).toBe(true);
    // And the union is the whole script, so no step escapes a tier.
    const everything = new Set(STEPS.filter((step) => step.label !== TRAILER).map((step) => step.label));
    expect([...full].sort()).toEqual([...everything].sort());
  });
});

describe('check.sh other tier machinery', () => {
  test('the tier is a positional word, and the directory is still a positional', () => {
    expect(SOURCE).toContain('fast | standard | full)');
    expect(SOURCE).toContain('DIR="$arg"');
  });

  test('the default tier is full, so a bare check.sh is still the full gate', () => {
    expect(SOURCE).toContain('TIER="${TIER:-full}"');
  });

  test('a second tier or a second directory is refused, never silently preferred', () => {
    expect(SOURCE).toContain('two tiers given');
    expect(SOURCE).toContain('two directories given');
  });

  test('the fast tier resolves one base and one root list, and exports both', () => {
    expect(SOURCE).toContain('export JEEX_FAST_ROOTS=');
    expect(SOURCE).toContain('scripts/select-tests.ts --print-base');
    expect(SOURCE).toContain('export JEEX_FAST_BASE="$FAST_BASE"');
  });

  test('both tier guards are spelled exactly as the parser expects', () => {
    expect(SOURCE).toContain(TIER_GUARD);
    expect(SOURCE).toContain(STANDARD_GUARD);
  });

  test('the final line reports which tier ran', () => {
    expect(SOURCE).toContain('echo "== check.sh: OK ($TIER)"');
  });

  test('the fast tier runs the selected tests without the repository-wide coverage threshold', () => {
    expect(SOURCE).toContain('bun run scripts/select-tests.ts $JEEX_FAST_ROOTS');
    // Quoted array expansion, not `$SELECTED`: a path with a space in it must
    // stay one filter.
    expect(SOURCE).toContain('bun test --config=scripts/fast-bunfig.toml "${SELECTED[@]}"');
    expect(SOURCE).not.toContain('bun test --config=scripts/fast-bunfig.toml $SELECTED');
  });

  test('a selector that fails takes the gate down with a message, not in silence', () => {
    expect(SOURCE).toContain('error: scripts/select-tests.ts could not name the tests this change reaches');
  });
});

describe('check.sh step order', () => {
  /**
   * Static steps need no runtime, browser or production build; expensive
   * steps need at least one. A gate that runs the expensive steps first
   * spends minutes in bun tests, Vitest browser mode and Playwright before
   * failing on `check:arch`, `check:dead` or `typecheck:scripts` — this pins
   * the order: every static step's script position precedes every expensive
   * step's, so a static failure surfaces in seconds, not minutes.
   */
  const STATIC_SUBSTRINGS = [
    'typecheck (src',
    'typecheck (scripts',
    'lint',
    'format',
    'source hygiene',
    'size-check',
    'check:arch',
    'check:dead',
    'schema: generate-to-tmp',
    'console policy',
    'listener policy',
  ];
  const EXPENSIVE_SUBSTRINGS = [
    'bun test',
    'coverage floors',
    'component tests',
    'DOM-layer coverage floors',
    'e2e tests',
    'npm run build',
    'npm run check:budget',
    'check:pkg',
    'bun audit',
    'code-ranker',
  ];

  function indicesFor(substring: string): number[] {
    return STEPS.map((step, index) => (step.label.includes(substring) ? index : -1)).filter((index) => index >= 0);
  }

  test('every static and expensive substring matches at least one step', () => {
    for (const substring of [...STATIC_SUBSTRINGS, ...EXPENSIVE_SUBSTRINGS]) {
      expect(indicesFor(substring).length, `no step label contains "${substring}"`).toBeGreaterThan(0);
    }
  });

  test('no step label matches both a static and an expensive substring (accidental collision)', () => {
    for (const staticSubstring of STATIC_SUBSTRINGS) {
      for (const expensiveSubstring of EXPENSIVE_SUBSTRINGS) {
        const collision = STEPS.find((step) => step.label.includes(staticSubstring) && step.label.includes(expensiveSubstring));
        expect(collision, `"${staticSubstring}" and "${expensiveSubstring}" both match step "${collision?.label}"`).toBeUndefined();
      }
    }
  });

  test('every cheap static step runs before every step needing a runtime, a browser or a production build', () => {
    let worstStatic: { label: string; index: number } | null = null;
    for (const substring of STATIC_SUBSTRINGS) {
      for (const index of indicesFor(substring)) {
        if (!worstStatic || index > worstStatic.index) worstStatic = { label: STEPS[index]!.label, index };
      }
    }
    let bestExpensive: { label: string; index: number } | null = null;
    for (const substring of EXPENSIVE_SUBSTRINGS) {
      for (const index of indicesFor(substring)) {
        if (!bestExpensive || index < bestExpensive.index) bestExpensive = { label: STEPS[index]!.label, index };
      }
    }
    expect(worstStatic, 'no static step found').not.toBeNull();
    expect(bestExpensive, 'no expensive step found').not.toBeNull();
    expect(
      worstStatic!.index,
      `static step "${worstStatic!.label}" (index ${worstStatic!.index}) does not precede expensive step "${bestExpensive!.label}" (index ${bestExpensive!.index})`,
    ).toBeLessThan(bestExpensive!.index);
  });
});
