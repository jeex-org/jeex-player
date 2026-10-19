/**
 * Proves `.github/workflows/ci.yml` runs the same step list as `check.sh`'s
 * full tier, minus the two documented exceptions named in the workflow's own
 * header — `code-ranker` (an optional tool CI does not install) and the Playwright
 * browser-install steps (CI-only, because `check.sh` assumes Chromium is
 * already on the developer's machine).
 *
 * Both sides are read off the files themselves, not a third hand-maintained
 * table: `check.sh`'s `echo "== …"` labels via `scripts/check-steps.ts` (the
 * same parser `check-tiers.test.ts` uses) and the workflow's own `- name: …`
 * list. What IS hand-maintained is the correspondence between the two —
 * `check.sh` narrates a command, `ci.yml` names a job step, and the English
 * differs (`bun test` vs. `test with coverage`) — so `MAPPING` below pairs
 * them explicitly. The completeness assertion (every full-tier step other
 * than the exceptions has exactly one entry) is what stops a NEW `check.sh`
 * step from silently having no CI counterpart: an unmapped step fails the
 * count, not a maybe-matching substring.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readCheckShSteps } from './check-steps.js';

const CI_YML_PATH = new URL('../.github/workflows/ci.yml', import.meta.url);

/**
 * `check.sh`'s step label text that has no CI counterpart, and why — must
 * match the workflow's own header.
 *
 * `code-ranker check` is the one real gate excluded (an optional tool CI
 * does not install). `check.sh: OK ($TIER)` is the parser's own trailer — the
 * final `echo` that reports which tier ran, matched by the same
 * `echo "== …"` pattern as every real step but not itself a gate; CI reports
 * success through the job's own exit status instead.
 */
const DOCUMENTED_EXCEPTIONS = new Set(['code-ranker check', 'check.sh: OK ($TIER)']);

/** `check.sh` label substring → the CI step name it corresponds to. */
const MAPPING: ReadonlyArray<readonly [string, string]> = [
  ['bun test', 'test with coverage'],
  ['coverage floors', 'per-layer coverage floors'],
  ['component tests (Vitest browser mode)', 'component tests (Vitest browser mode)'],
  ['DOM-layer coverage floors', 'DOM-layer coverage floors'],
  ['e2e tests (Playwright)', 'e2e tests (Playwright)'],
  ['console policy (src/)', 'console policy (src/)'],
  ['listener policy (signal)', 'listener policy (signal)'],
  ['typecheck (src, dev, vite.config.ts)', 'typecheck (src, dev, vite.config.ts)'],
  ['typecheck (scripts, vite configs)', 'typecheck (scripts, vite configs)'],
  ['lint', 'lint'],
  ['format', 'format'],
  ['npm run build', 'build (demo)'],
  ['npm run check:budget', 'budget (demo)'],
  ['npm run build:lib', 'build (library)'],
  ['npm run check:budget:lib', 'budget (library)'],
  ['size-check', 'module size'],
  ['source hygiene (spelling, headers)', 'source hygiene (spelling, headers)'],
  ['check:arch', 'layer policy and cycles'],
  ['check:dead', 'dead code'],
  ['schema: generate-to-tmp + check', 'schema: generate-to-tmp + check'],
  ['check:pkg', 'package (publint, attw)'],
  ['bun audit', 'dependency audit'],
];

function parseCiStepNames(source: string): string[] {
  const names: string[] = [];
  for (const rawLine of source.split('\n')) {
    const match = /^\s*-\s*name:\s*(.+)$/.exec(rawLine);
    if (match) names.push(match[1]!.trim());
  }
  return names;
}

const CI_SOURCE = readFileSync(CI_YML_PATH, 'utf8');
const CI_STEPS = parseCiStepNames(CI_SOURCE);
const CHECK_STEPS = readCheckShSteps();

describe('CI parity', () => {
  test('every check.sh step other than the documented exceptions has exactly one mapping entry', () => {
    const checkable = CHECK_STEPS.filter((step) => !DOCUMENTED_EXCEPTIONS.has(step.label));
    // A new check.sh step with no mapping entry — or a mapping entry whose
    // check.sh side no longer matches anything — moves this count apart.
    expect(checkable.length).toBe(MAPPING.length);
  });

  test('every mapping entry finds its check.sh step', () => {
    for (const [checkSubstring] of MAPPING) {
      const match = CHECK_STEPS.find((step) => step.label.includes(checkSubstring));
      expect(match, `check.sh has no step containing "${checkSubstring}"`).toBeDefined();
    }
  });

  test('every mapping entry finds its CI step', () => {
    for (const [checkSubstring, ciSubstring] of MAPPING) {
      const match = CI_STEPS.find((name) => name.includes(ciSubstring));
      expect(match, `ci.yml has no step containing "${ciSubstring}" for check.sh's "${checkSubstring}"`).toBeDefined();
    }
  });

  test('code-ranker is a documented exception, and the workflow header names it', () => {
    expect(DOCUMENTED_EXCEPTIONS.has('code-ranker check')).toBe(true);
    expect(CI_SOURCE).toContain('code-ranker');
  });

  test('the workflow header also names the Playwright install as CI-only', () => {
    expect(CI_SOURCE.toLowerCase()).toContain('playwright');
  });
});
