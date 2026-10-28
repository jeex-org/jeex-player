/**
 * Self-test for the module-size gate: line counting, the per-file limit
 * (700 lines, higher for the data files and lower for the composition
 * root), and the `KNOWN_OVERSIZE` allowlist, against a temporary directory
 * rather than the real `src/`. Every limit and every allowlist entry is
 * addressed by PATH under `src/`, so the fixtures are nested the way the real
 * tree is.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSizes,
  limitFor,
  DEFAULT_LIMIT,
  DATA_FILE_LIMIT,
  SCHEMA_FILE_LIMIT,
  VIEWER_API_LIMIT,
  VIEWER_APP_LIMIT,
  WARN_LIMIT,
} from './size-check.js';

function linesOf(n: number): string {
  return Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n';
}

/** Builds a `src/`-rooted fixture and returns that `src/` directory (what `checkSizes` is pointed at for real). */
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jeex-size-'));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return join(dir, 'src');
}

describe('limitFor', () => {
  test('data files get the data-table allowance', () => {
    expect(limitFor('assets/asset-library.ts')).toBe(DATA_FILE_LIMIT);
    expect(limitFor('demo/scene-data.ts')).toBe(DATA_FILE_LIMIT);
    expect(limitFor('materials/builtin-library-data.ts')).toBe(DATA_FILE_LIMIT);
  });

  test('the composition root and its public surface are held to their contracts', () => {
    expect(limitFor('scene/types.ts')).toBe(SCHEMA_FILE_LIMIT);
    expect(limitFor('scene/types.schema.ts')).toBe(SCHEMA_FILE_LIMIT);
    expect(limitFor('app/viewer-api.ts')).toBe(VIEWER_API_LIMIT);
    expect(limitFor('app/viewer-app.ts')).toBe(VIEWER_APP_LIMIT);
  });

  test('everything else gets the default limit', () => {
    expect(limitFor('geometry/picker.ts')).toBe(DEFAULT_LIMIT);
    // A named limit belongs to its PATH, not to a bare file name: the layer
    // directory is part of a module's identity, so a `viewer-api.ts` in some
    // other layer is ordinary and does not inherit the composition contract.
    expect(limitFor('viewer-api.ts')).toBe(DEFAULT_LIMIT);
    expect(limitFor('ui/viewer-api.ts')).toBe(DEFAULT_LIMIT);
    expect(limitFor('scene-data.ts')).toBe(DEFAULT_LIMIT);
    expect(DEFAULT_LIMIT).toBe(700);
    expect(DATA_FILE_LIMIT).toBe(1500);
    expect(SCHEMA_FILE_LIMIT).toBe(1000);
    expect(VIEWER_API_LIMIT).toBe(300);
    expect(VIEWER_APP_LIMIT).toBe(500);
  });
});

describe('checkSizes', () => {
  test('a file under its limit passes', () => {
    const dir = fixtureDir({ 'src/small.ts': linesOf(10) });
    const report = checkSizes(dir);
    expect(report.violations).toEqual([]);
  });

  test('a file over its limit is a violation, unless allowlisted', () => {
    const dir = fixtureDir({ 'src/plan/big.ts': linesOf(701) });
    const report = checkSizes(dir);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]!.file).toBe('plan/big.ts');
    expect(report.violations[0]!.lines).toBe(701);
    expect(report.violations[0]!.limit).toBe(700);

    // The allowlist is keyed by path too, so a bare basename does not excuse
    // a module in some other layer that happens to share its name.
    expect(checkSizes(dir, new Set(['big.ts'])).violations).toHaveLength(1);

    const allowed = checkSizes(dir, new Set(['plan/big.ts']));
    expect(allowed.violations).toEqual([]);
    expect(allowed.allowlisted.map((entry) => entry.file)).toEqual(['plan/big.ts']);
  });

  test('test files and non-.ts files are never measured', () => {
    const dir = fixtureDir({
      'src/big.test.ts': linesOf(2000),
      'src/notes.md': linesOf(2000),
    });
    const report = checkSizes(dir);
    expect(report.violations).toEqual([]);
  });

  test('the data files use the data limit, not the default 700', () => {
    const dir = fixtureDir({
      'src/assets/asset-library.ts': linesOf(900),
      'src/demo/scene-data.ts': linesOf(1501),
    });
    const report = checkSizes(dir);
    expect(report.violations.map((entry) => entry.file)).toEqual(['demo/scene-data.ts']);
  });

  test('an allowlist entry that is actually within its limit is reported so it can be dropped', () => {
    const dir = fixtureDir({ 'src/plan/fixed.ts': linesOf(10) });
    const report = checkSizes(dir, new Set(['plan/fixed.ts']));
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual(['plan/fixed.ts']);
  });

  test('scans subdirectories too', () => {
    const dir = fixtureDir({ 'src/sub/deep.ts': linesOf(800) });
    const report = checkSizes(dir);
    expect(report.violations.map((entry) => entry.file)).toEqual(['sub/deep.ts']);
  });
});

describe('the warning tier', () => {
  test('WARN_LIMIT is the file-size smell, well under the hard limit', () => {
    expect(WARN_LIMIT).toBe(400);
    expect(WARN_LIMIT).toBeLessThan(DEFAULT_LIMIT);
  });

  test('a file over the warn tier but under its limit is a warning, never a violation', () => {
    const dir = fixtureDir({ 'src/plan/wordy.ts': linesOf(401) });
    const report = checkSizes(dir);
    expect(report.violations).toEqual([]);
    expect(report.warnings).toEqual([{ file: 'plan/wordy.ts', lines: 401, limit: 700 }]);
  });

  test('a file exactly at the warn tier is not a warning', () => {
    const report = checkSizes(fixtureDir({ 'src/plan/exact.ts': linesOf(400) }));
    expect(report.warnings).toEqual([]);
  });

  test('a file over its hard limit is a violation and not also a warning', () => {
    const report = checkSizes(fixtureDir({ 'src/plan/huge.ts': linesOf(701) }));
    expect(report.violations.map((entry) => entry.file)).toEqual(['plan/huge.ts']);
    expect(report.warnings).toEqual([]);
  });

  test('an allowlisted oversize file is not double-reported as a warning', () => {
    const dir = fixtureDir({ 'src/plan/huge.ts': linesOf(701) });
    const report = checkSizes(dir, new Set(['plan/huge.ts']));
    expect(report.allowlisted.map((entry) => entry.file)).toEqual(['plan/huge.ts']);
    expect(report.warnings).toEqual([]);
  });
});
