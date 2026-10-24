/**
 * The budget of the bundled finishes' maps in a build: the folder is there
 * with every file the index lists, its total stays under the measured
 * budget, no file is over the per-file cap, and every scan at its largest
 * size together stays under the document texture budget (the built-in
 * source never resets its count).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync, truncateSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FINISH_MAPS_BUDGET_BYTES, checkFinishMaps } from './budget-check.ts';
import { FINISH_MAPS_DIR } from './finish-maps-fetch.ts';
import { indexedFiles } from './finish-maps-plugin.ts';

const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A build output whose `finish-maps/` is the shipped folder. */
function build(): string {
  const dir = mkdtempSync(join(tmpdir(), 'finish-maps-budget-'));
  temp.push(dir);
  cpSync(FINISH_MAPS_DIR, join(dir, 'finish-maps'), { recursive: true });
  return dir;
}

describe('checkFinishMaps', () => {
  test('the shipped folder passes, under its measured budget', () => {
    expect(checkFinishMaps(build())).toEqual([]);
  });

  test('a build without the folder fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'finish-maps-budget-'));
    temp.push(dir);
    expect(checkFinishMaps(dir).join('\n')).toMatch(/finish-maps/);
  });

  test('a listed file missing from the build fails', () => {
    const dir = build();
    unlinkSync(join(dir, 'finish-maps', [...indexedFiles(FINISH_MAPS_DIR)][0]!));
    expect(checkFinishMaps(dir).join('\n')).toMatch(/missing/);
  });

  test('a total over the budget fails', () => {
    const dir = build();
    writeFileSync(join(dir, 'finish-maps', 'filler.bin'), new Uint8Array(FINISH_MAPS_BUDGET_BYTES));
    expect(checkFinishMaps(dir).join('\n')).toMatch(/over its/);
  });

  test('a file over the per-file cap fails', () => {
    const dir = build();
    truncateSync(join(dir, 'finish-maps', [...indexedFiles(FINISH_MAPS_DIR)][0]!), 3 * 1024 * 1024);
    expect(checkFinishMaps(dir).join('\n')).toMatch(/MAX_TEXTURE_FILE_BYTES/);
  });
});
