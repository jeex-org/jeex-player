/**
 * Self-test for the bundle budget gate: boot chunks are summed (or judged
 * per file for the library build), lazy chunks are always judged per file
 * against their own, much smaller, limit.
 */

import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUDGET_FAIL_BYTES,
  BUDGET_WARN_BYTES,
  HOST_BUDGET_FAIL_BYTES,
  LAZY_CHUNK_FAIL_BYTES,
  LAZY_CHUNK_PREFIX,
  OPS_BUDGET_FAIL_BYTES,
  LIGHTING_BUDGET_FAIL_BYTES,
  checkBudget,
  formatBytes,
  limitFor,
  measureBundle,
  staticImports,
} from './budget-check.js';

/**
 * Cryptographically random bytes, so gzip cannot shrink the fixture back
 * under a limit the way real (repetitive) source text would. The exact
 * gzip size of `size` random bytes is close enough to `size` (never
 * smaller) that the tests below can reason about it as if gzip were a
 * no-op.
 */
function fillerBytes(size: number): Buffer {
  return randomBytes(size);
}

function fixtureDir(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jeex-budget-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe('constants', () => {
  test('the budget matches the documented limits: 700 KB hard boot, 350 KB soft, 4 KB host, 256 KB lazy', () => {
    expect(BUDGET_FAIL_BYTES).toBe(700 * 1024);
    expect(BUDGET_WARN_BYTES).toBe(350 * 1024);
    expect(HOST_BUDGET_FAIL_BYTES).toBe(4 * 1024);
    expect(LAZY_CHUNK_FAIL_BYTES).toBe(256 * 1024);
    expect(LAZY_CHUNK_PREFIX).toBe('lazy-');
    expect(formatBytes(700 * 1024)).toBe('700.0 KB');
  });

  test('the host helper keeps a budget of its own, three orders smaller', () => {
    expect(limitFor('jeex-viewer-host.js')).toBe(HOST_BUDGET_FAIL_BYTES);
    expect(limitFor('jeex-viewer-host.iife.js')).toBe(HOST_BUDGET_FAIL_BYTES);
    expect(limitFor('jeex-viewer.js')).toBe(BUDGET_FAIL_BYTES);
  });

  test('the ops entry keeps a budget of its own, distinct from the unrelated opening-frame chunk', () => {
    expect(OPS_BUDGET_FAIL_BYTES).toBe(74 * 1024 + 418);
    expect(limitFor('jeex-viewer-ops.js')).toBe(OPS_BUDGET_FAIL_BYTES);
    // `dist-lib/` also carries `jeex-viewer-opening-frame-<hash>.js`, an `es`
    // build chunk that shares the `jeex-viewer-op` prefix with the ops entry
    // by coincidence; it must fall through to the viewer's own 700 KB budget.
    expect(limitFor('jeex-viewer-opening-frame-DM2W4dUD.js')).toBe(BUDGET_FAIL_BYTES);
  });

  test('the lighting entry keeps a budget of its own: no three.js fits in it', () => {
    expect(LIGHTING_BUDGET_FAIL_BYTES).toBe(11_743 + 1024);
    expect(limitFor('jeex-viewer-lighting.js')).toBe(LIGHTING_BUDGET_FAIL_BYTES);
  });
});

describe('measureBundle', () => {
  test('measures only .js files, largest gzip first', () => {
    // Compressible, repetitive source text here (not `fillerBytes`'s random
    // bytes): the point of this fixture is that gzip actually shrinks it,
    // which the last assertion below checks.
    const dir = fixtureDir({
      'small.js': 'a'.repeat(200),
      'large.js': Array.from({ length: 400 }, (_, i) => `const v${i} = ${i};`).join('\n'),
      'ignored.css': 'body{color:red}'.repeat(400),
      'ignored.js.map': '{"version":3}',
    });
    const entries = measureBundle(dir);
    expect(entries.map((entry) => entry.name)).toEqual(['large.js', 'small.js']);
    expect(entries[0]!.gzipBytes).toBeGreaterThan(entries[1]!.gzipBytes);
    expect(entries[0]!.gzipBytes).toBeLessThan(entries[0]!.bytes);
  });

  test('a missing or empty directory is an error, not a silent pass', () => {
    expect(() => checkBudget(join(tmpdir(), 'jeex-budget-does-not-exist'))).toThrow(/npm run build/);
    expect(() => checkBudget(fixtureDir({ 'only.css': 'a{}' }))).toThrow(/npm run build/);
  });
});

describe('checkBudget total mode: boot summed, lazy always per file', () => {
  test('a boot file and a lazy chunk under budget: no failures, split gzip totals', () => {
    const dir = fixtureDir({
      'app-x.js': fillerBytes(600 * 1024), // ~600 KB, incompressible enough to gzip near itself
      'lazy-ifc-x.js': fillerBytes(200 * 1024),
    });
    const report = checkBudget(dir, 'total');
    expect(report.boot.files).toEqual(['app-x.js']);
    expect(report.lazy.files).toEqual(['lazy-ifc-x.js']);
    // The boot total counts only the boot file; the lazy total only the lazy one.
    const entries = measureBundle(dir);
    const bootEntry = entries.find((entry) => entry.name === 'app-x.js')!;
    const lazyEntry = entries.find((entry) => entry.name === 'lazy-ifc-x.js')!;
    expect(report.boot.gzip).toBe(bootEntry.gzipBytes);
    expect(report.lazy.gzip).toBe(lazyEntry.gzipBytes);
    expect(report.failures).toEqual([]);
  });

  test('a lazy chunk that grows past 256 KB fails, and names the file', () => {
    const dir = fixtureDir({
      'app-x.js': fillerBytes(600 * 1024),
      'lazy-ifc-x.js': fillerBytes(300 * 1024),
    });
    const report = checkBudget(dir, 'total');
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain('lazy-ifc-x.js');
  });

  test('a boot total past 700 KB fails', () => {
    const dir = fixtureDir({
      'app-x.js': fillerBytes(800 * 1024),
      'lazy-ifc-x.js': fillerBytes(200 * 1024),
    });
    const report = checkBudget(dir, 'total');
    expect(report.failures.some((message) => message.includes('boot'))).toBe(true);
  });

  test('a boot total between the soft and hard limit warns without failing', () => {
    const dir = fixtureDir({ 'app-x.js': fillerBytes(500 * 1024) });
    const report = checkBudget(dir, 'total');
    expect(report.failures).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('boot');
  });
});

describe('checkBudget per-file mode (the library build)', () => {
  test('boot files are alternatives, so their sum is not the verdict', () => {
    const bulk = fillerBytes(500 * 1024);
    const dir = fixtureDir({ 'jeex-viewer.js': bulk, 'jeex-viewer-element.js': bulk });
    const report = checkBudget(dir, 'per-file');
    expect(report.failures).toEqual([]);
  });

  test('a host helper that grew past 4 KB fails, and says which file', () => {
    const dir = fixtureDir({
      'jeex-viewer.js': 'console.log(1);',
      'jeex-viewer-host.js': fillerBytes(6 * 1024),
    });
    const report = checkBudget(dir, 'per-file');
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain('jeex-viewer-host.js');
  });

  test('a lazy chunk in the library build is still judged per file, not summed into boot', () => {
    const dir = fixtureDir({
      'jeex-viewer.js': fillerBytes(500 * 1024),
      'lazy-jeex-viewer-ifc-writer-abc123.js': fillerBytes(300 * 1024),
    });
    const report = checkBudget(dir, 'per-file');
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain('lazy-jeex-viewer-ifc-writer-abc123.js');
  });
});

describe('boot is what the page reaches on open', () => {
  test('a static import is read, a dynamic one is not', () => {
    expect(
      staticImports('import{a as b}from"./shared-x.js";import"./side-x.js";const c=()=>import("./lazy-y.js");export{d}from"./re-x.js"'),
    ).toEqual(['shared-x.js', 'side-x.js', 're-x.js']);
  });

  test('a chunk only lazy chunks import is lazy, whatever its name; one the entry reaches is boot', () => {
    const dir = fixtureDir({
      'main-x.js': 'import{a}from"./core-x.js";const t=()=>import("./lazy-tool-x.js");',
      'core-x.js': 'export const a=1;',
      'lazy-tool-x.js': 'import{b}from"./shared-x.js";import{a}from"./core-x.js";',
      'lazy-other-x.js': 'import{b}from"./shared-x.js";',
      'shared-x.js': 'export const b=2;',
    });
    const report = checkBudget(dir, 'total');
    expect(report.boot.files.sort()).toEqual(['core-x.js', 'main-x.js']);
    expect(report.lazy.files.sort()).toEqual(['lazy-other-x.js', 'lazy-tool-x.js', 'shared-x.js']);
    expect(report.failures).toEqual([]);
  });

  test('a lazy-named chunk the page loads on open fails: the name would hide boot weight', () => {
    const dir = fixtureDir({ 'main-x.js': 'import{a}from"./lazy-core-x.js";', 'lazy-core-x.js': 'export const a=1;' });
    expect(checkBudget(dir, 'total').failures).toEqual(['main-x.js is loaded on open and imports lazy-core-x.js, which is named lazy']);
  });
});
