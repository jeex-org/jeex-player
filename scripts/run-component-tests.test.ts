/**
 * Self-test for the pure logic of `run-component-tests.ts` (the guard that
 * `test:component` runs before Vitest itself).
 *
 * Only the pure parsing/formatting/decision functions are exercised here —
 * lock-file I/O, `ps` output and process signalling are real-world integration
 * behaviour proven by hand against real child processes.
 */

import { describe, expect, test } from 'bun:test';
import {
  BROWSER_COUNT_UNAVAILABLE,
  DEFAULT_COMPONENT_TIMEOUT_MS,
  foreignLockMessage,
  lockPathFor,
  MEASURED_TIER_COST_MS,
  parseLockOwner,
  parseOrphanCandidates,
  reparentedOrphans,
  resolveTimeoutMs,
  watchdogTimeoutMessage,
} from './run-component-tests.js';

describe('lockPathFor', () => {
  test('hashes the resolved reports directory the same way Vitest does', () => {
    // Verbatim expected value: sha256("/a/b/coverage-component").hex.slice(0,16).
    // `vitest/dist/chunks/index.*.js` — class `ReportsDirectoryLock` — computes
    // the identical `createHash('sha256').update(reportsDirectory).digest('hex').slice(0, 16)`.
    const path = lockPathFor('/a/b/coverage-component', '/tmp');
    expect(path).toBe('/tmp/vitest-coverage-7ca44fe8734970e9.lock');
  });

  test('two different worktree paths hash to two different lock files', () => {
    const a = lockPathFor('/worktrees/one/coverage-component', '/tmp');
    const b = lockPathFor('/worktrees/two/coverage-component', '/tmp');
    expect(a).not.toBe(b);
  });

  test('strips a trailing slash from tmpBase', () => {
    expect(lockPathFor('/a/b/coverage-component', '/tmp/')).toBe(lockPathFor('/a/b/coverage-component', '/tmp'));
  });
});

describe('parseLockOwner', () => {
  test('reads a well-formed lock payload', () => {
    const owner = parseLockOwner('{"pid":89083,"reportsDirectory":"/a/b/coverage-component"}');
    expect(owner).toEqual({ pid: 89083, reportsDirectory: '/a/b/coverage-component' });
  });

  test('returns undefined for garbage', () => {
    expect(parseLockOwner('not json')).toBeUndefined();
    expect(parseLockOwner('{}')).toBeUndefined();
    expect(parseLockOwner('{"pid":"not a number"}')).toBeUndefined();
  });
});

describe('foreignLockMessage', () => {
  test('names the pid and the directory, and never suggests waiting silently', () => {
    const message = foreignLockMessage(
      { pid: 89083, reportsDirectory: '/a/b/coverage-component' },
      'etime 00:04:12, command node vitest run',
    );
    expect(message).toContain('89083');
    expect(message).toContain('/a/b/coverage-component');
    expect(message).toContain('etime 00:04:12');
  });
});

describe('parseOrphanCandidates', () => {
  const psFixture = [
    '  PID  PPID COMMAND',
    '    1     0 /sbin/launchd',
    ' 2836     1 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell --type=gpu-process',
    ' 2789   712 /bin/bash -c bun run test:component',
    ' 2854  2836 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell --type=renderer',
    ' 3000     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].join('\n');

  test('finds only chrome-headless-shell rows', () => {
    const candidates = parseOrphanCandidates(psFixture);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.command.includes('chrome-headless-shell'))).toBe(true);
  });

  test('ignores an ordinary (non-headless-shell) browser reparented to init', () => {
    const candidates = parseOrphanCandidates(psFixture);
    expect(candidates.some((candidate) => candidate.command.includes('Google Chrome.app'))).toBe(false);
  });
});

describe('reparentedOrphans', () => {
  test('keeps only processes whose parent is pid 1 — no live run is ever a direct child of init', () => {
    const candidates = [
      { pid: 2836, ppid: 1, command: 'chrome-headless-shell --type=gpu-process' },
      { pid: 2854, ppid: 2836, command: 'chrome-headless-shell --type=renderer' },
    ];
    expect(reparentedOrphans(candidates)).toEqual([{ pid: 2836, ppid: 1, command: 'chrome-headless-shell --type=gpu-process' }]);
  });

  test('empty input gives empty output', () => {
    expect(reparentedOrphans([])).toEqual([]);
  });
});

describe('watchdogTimeoutMessage', () => {
  test('reports the ceiling, the live browser count and the tier’s known cost', () => {
    const message = watchdogTimeoutMessage(600_000, 7, 385_000);
    expect(message).toContain('10.0 min');
    expect(message).toContain('live chrome-headless-shell processes: 7');
    expect(message).toContain('385 s');
  });

  test('names the remedies for each elapsed-time case without asserting a cause', () => {
    const message = watchdogTimeoutMessage(600_000, 0);
    expect(message).not.toContain('Likely cause');
    // The word may appear only as "leaves no orphan behind", never as a diagnosis.
    expect(message).not.toContain('orphaned chrome-headless-shell processes from an earlier killed run');
    expect(message).toContain('raise the default in this file');
    expect(message).toContain('--reporter=verbose');
  });

  test('a browser count of -1 reads as unknown, never as none: 0 is itself a diagnosis here', () => {
    expect(watchdogTimeoutMessage(600_000, BROWSER_COUNT_UNAVAILABLE)).toContain('count unavailable');
    expect(watchdogTimeoutMessage(600_000, 0)).toContain('live chrome-headless-shell processes: 0');
  });

  test('the default ceiling clears the measured tier cost, which 6 min would not', () => {
    expect(DEFAULT_COMPONENT_TIMEOUT_MS).toBeGreaterThan(MEASURED_TIER_COST_MS);
    // A 6-minute ceiling (360_000) would sit BELOW what the tier costs on an idle machine.
    expect(360_000).toBeLessThan(MEASURED_TIER_COST_MS);
  });

  test('names the observable boot lines rather than a vague "no test output"', () => {
    const message = watchdogTimeoutMessage(600_000, 0);
    expect(message).toContain('the two boot lines');
    expect(message).not.toContain('no test output');
  });
});

describe('resolveTimeoutMs', () => {
  test('an explicit positive value wins', () => {
    expect(resolveTimeoutMs('120000')).toBe(120_000);
  });

  test('an absent variable gives the default', () => {
    expect(resolveTimeoutMs(undefined)).toBe(DEFAULT_COMPONENT_TIMEOUT_MS);
  });

  // `??` catches only `undefined`, so `Number('' ?? default)` is 0, and `setTimeout` rounds 0 and
  // NaN up to 1 ms: the watchdog would kill Vitest at launch and report a timeout. A valueless
  // `JEEX_COMPONENT_TIMEOUT_MS=` in a CI config or a shell export is exactly how that happens.
  test.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['non-numeric', 'ten minutes'],
    ['zero', '0'],
    ['negative', '-1'],
    ['infinite', 'Infinity'],
  ])('a %s value falls back to the default instead of firing at launch', (_label, raw) => {
    expect(resolveTimeoutMs(raw)).toBe(DEFAULT_COMPONENT_TIMEOUT_MS);
  });
});
