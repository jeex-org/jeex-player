/**
 * Proves the two GitHub workflows together run the same step list as
 * `check.sh`'s full tier, minus the two documented exceptions named in
 * `ci.yml`'s header — `code-ranker` (an optional tool CI does not install)
 * and the Playwright browser-install steps (CI-only, because `check.sh`
 * assumes Chromium is already on the developer's machine). `ci.yml` (every
 * push and pull request) carries every step that needs no browser;
 * `browser.yml` (started by hand only) carries the browser levels, and the
 * split itself is pinned below so a browser step cannot drift back onto every
 * push.
 *
 * Both sides are read off the files themselves, not a third hand-maintained
 * table: `check.sh`'s `echo "== …"` labels via `scripts/check-steps.ts` (the
 * same parser `check-tiers.test.ts` uses) and the workflows' own `- name: …`
 * lists. What IS hand-maintained is the correspondence between the two —
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
const BROWSER_YML_PATH = new URL('../.github/workflows/browser.yml', import.meta.url);

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
  ['site build', 'build (site)'],
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

/** The CI step names that drive a browser; they belong in `browser.yml` only. */
const BROWSER_STEPS = ['component tests (Vitest browser mode)', 'DOM-layer coverage floors', 'e2e tests (Playwright)'];

/** The keys of a workflow's top-level `on:` block, in source order. */
function parseTriggers(source: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === 'on:');
  if (start < 0) return [];
  const triggers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^ {2}([a-z_]+):/.exec(line);
    if (match) triggers.push(match[1]!);
  }
  return triggers;
}

const CI_SOURCE = readFileSync(CI_YML_PATH, 'utf8');
const BROWSER_SOURCE = readFileSync(BROWSER_YML_PATH, 'utf8');
const CI_STEPS = [...parseCiStepNames(CI_SOURCE), ...parseCiStepNames(BROWSER_SOURCE)];
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
      expect(match, `neither workflow has a step containing "${ciSubstring}" for check.sh's "${checkSubstring}"`).toBeDefined();
    }
  });

  test('code-ranker is a documented exception, and the workflow header names it', () => {
    expect(DOCUMENTED_EXCEPTIONS.has('code-ranker check')).toBe(true);
    expect(CI_SOURCE).toContain('code-ranker');
  });

  test('the workflow header also names the Playwright install as CI-only', () => {
    expect(CI_SOURCE.toLowerCase()).toContain('playwright');
  });

  test('the browser levels run only in the hand-started workflow, never on a push or pull request', () => {
    const fastSteps = parseCiStepNames(CI_SOURCE);
    const browserSteps = parseCiStepNames(BROWSER_SOURCE);
    for (const step of BROWSER_STEPS) {
      expect(
        fastSteps.some((name) => name.includes(step)),
        `ci.yml runs "${step}"`,
      ).toBe(false);
      expect(
        browserSteps.some((name) => name.includes(step)),
        `browser.yml has no "${step}"`,
      ).toBe(true);
    }
    // A browser command under another step name is caught by its `run:` line.
    expect(CI_SOURCE).not.toMatch(/^\s+run:.*(test:component|test:e2e|playwright)/m);
    // The setup input that installs Chromium, outside a comment.
    expect(CI_SOURCE).not.toMatch(/^\s+browser:\s*'true'/m);
    expect(BROWSER_SOURCE).toMatch(/^\s+browser:\s*'true'/m);
    expect(parseTriggers(BROWSER_SOURCE)).toEqual(['workflow_dispatch']);
    expect(parseTriggers(CI_SOURCE)).toEqual(['push', 'pull_request', 'schedule']);
  });
});
