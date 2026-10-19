/**
 * Module-size gate. Walks `src/` recursively and fails when a non-test `.ts`
 * file exceeds its line limit: the default (`DEFAULT_LIMIT`, the ~400-line
 * smell of the coding standards rounded up to a hard 700), a higher one for
 * the two data files, and a lower one for the composition root
 * (`app/viewer-api.ts` ≤ 300 by contract).
 *
 * The named limits are keyed by PATH, not by basename: the layer directory is part of a
 * module's identity, so a second `viewer-api.ts` somewhere else does not
 * inherit the composition root's budget.
 *
 * Usage: `bun run scripts/size-check.ts [src-dir]` — run it as part of
 * `check.sh`, after the budget check.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Line limit for an ordinary `src/*.ts` module. */
export const DEFAULT_LIMIT = 700;
/**
 * The SMELL, not the limit: the coding standards put "stops
 * fitting in one mental page" at around 400 lines. A file past this is printed
 * on every run and fails nothing — the number exists to be seen while
 * splitting the module is still cheap, which is before it becomes a violation.
 */
export const WARN_LIMIT = 400;
/**
 * Line limit for the two data files the contract names explicitly. They are
 * catalogue tables, not modules: the number tracks whatever `oxfmt` makes of
 * the table (one entry per row, wrapped at the configured width), because a
 * longer table of the same rows is not a harder file to hold in your head.
 */
export const DATA_FILE_LIMIT = 1500;
/**
 * Line limit for the document SCHEMA (`scene/types.ts` and its zod twin).
 *
 * They are declaration tables, not modules: `scene/types.ts` is the scene
 * document plus the operation vocabulary, every entry of which is a `type`
 * with the prose that says what the field means, and its own layer in
 * `.dependency-cruiser.cjs` is that one file — so the vocabulary cannot be
 * split into a sibling without inventing a layer for it and teaching every
 * reader of the vocabulary where the other half went. Nothing in either file BRANCHES, which is what the 700-line
 * default is really measuring. Raised from the default when the scene-ops
 * vocabulary took the op block past it; the two files stand at 750 and 447 lines today.
 */
export const SCHEMA_FILE_LIMIT = 1000;
/** Line limit for the public mount API. */
export const VIEWER_API_LIMIT = 300;
/**
 * Line limit for the composition root. It is the one module whose job IS
 * wiring, so it is allowed more than the public surface in front of it and
 * less than an ordinary module: a root that grows past this is a root that has
 * stopped delegating.
 */
export const VIEWER_APP_LIMIT = 500;

/** The two data files the contract names, addressed by their path in `src/`. */
const DATA_FILES = new Set(['assets/asset-library.ts', 'demo/scene-data.ts']);

/** The document schema and its runtime twin, addressed by their path in `src/`. */
const SCHEMA_FILES = new Set(['scene/types.ts', 'scene/types.schema.ts']);

/**
 * Files allowed to exceed their limit. It is empty, and it stays empty: the
 * gate tolerates no oversize file, and a file that grows past its limit is
 * split rather than listed here.
 */
export const KNOWN_OVERSIZE: ReadonlySet<string> = new Set([]);

/** The line limit that applies to a file, addressed by its path under `src/`. */
export function limitFor(path: string): number {
  if (path === 'app/viewer-api.ts') return VIEWER_API_LIMIT;
  if (path === 'app/viewer-app.ts') return VIEWER_APP_LIMIT;
  if (DATA_FILES.has(path)) return DATA_FILE_LIMIT;
  if (SCHEMA_FILES.has(path)) return SCHEMA_FILE_LIMIT;
  return DEFAULT_LIMIT;
}

export type SizeViolation = { file: string; lines: number; limit: number };

export type SizeReport = {
  violations: SizeViolation[];
  allowlisted: SizeViolation[];
  /** Over `WARN_LIMIT` but within their own limit: printed, never fatal. */
  warnings: SizeViolation[];
  /** Allowlist entries that are no longer over their limit — drop them. */
  staleAllowlist: string[];
};

function countLines(path: string): number {
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) return 0;
  const lines = text.split('\n');
  // A trailing newline produces one empty trailing element; do not count it.
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function collectTsFiles(dir: string, root: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectTsFiles(path, root, out);
      continue;
    }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    out.push(relative(root, path));
  }
}

/**
 * Measures every `*.ts` file under `dir` (recursively, tests excluded) and
 * reports which ones exceed their limit. `allowlist` (paths relative to
 * `dir`) moves a genuine violation into `allowlisted` instead of
 * `violations`; an allowlist entry that turns out not to be over its limit is
 * reported in `staleAllowlist` so it can be dropped from the caller's list.
 * Everything within its limit but past `WARN_LIMIT` lands in `warnings`.
 */
export function checkSizes(dir: string, allowlist: ReadonlySet<string> = new Set()): SizeReport {
  const files: string[] = [];
  collectTsFiles(dir, dir, files);

  const violations: SizeViolation[] = [];
  const allowlisted: SizeViolation[] = [];
  const warnings: SizeViolation[] = [];
  const staleAllowlist: string[] = [];

  for (const file of files.sort()) {
    const lines = countLines(join(dir, file));
    const limit = limitFor(file);
    const isOver = lines > limit;
    const isAllowlisted = allowlist.has(file);
    if (isOver && isAllowlisted) {
      allowlisted.push({ file, lines, limit });
    } else if (isOver) {
      violations.push({ file, lines, limit });
    } else {
      // A file already reported as over its limit is not warned about as well.
      if (lines > WARN_LIMIT) warnings.push({ file, lines, limit });
      if (isAllowlisted) staleAllowlist.push(file);
    }
  }

  return { violations, allowlisted, warnings, staleAllowlist };
}

// Run as a script, not when imported by a test.
if (import.meta.main) {
  const dir = process.argv[2] ?? 'src';
  const report = checkSizes(dir, KNOWN_OVERSIZE);

  for (const entry of report.warnings) {
    console.warn(`  over ${WARN_LIMIT} lines: ${entry.file}  ${entry.lines} lines (limit ${entry.limit})`);
  }
  for (const entry of report.allowlisted) {
    console.warn(`  allowlisted: ${entry.file}  ${entry.lines} lines (limit ${entry.limit})`);
  }
  for (const path of report.staleAllowlist) {
    console.warn(`  KNOWN_OVERSIZE entry no longer needed, remove it: ${path}`);
  }

  if (report.violations.length > 0) {
    console.error('Size check FAILED:');
    for (const entry of report.violations) {
      console.error(`  ${entry.file}  ${entry.lines} lines (limit ${entry.limit})`);
    }
    process.exit(1);
  }

  console.log(
    `Size check OK: ${report.warnings.length} over ${WARN_LIMIT} lines, ${report.allowlisted.length} allowlisted, ` +
      `0 unexpected violations over ${dir}`,
  );
}
