/**
 * `scripts/fast-bunfig.toml` is the configuration `check.sh fast` hands to
 * `bun test`, and it exists for exactly one difference from `bunfig.toml`: no
 * `[test]` section, therefore no coverage and no repository-wide threshold over
 * a handful of selected files.
 *
 * Everything else must stay identical, and `[define]` is the part that breaks
 * loudly when it does not: `src/shared/version.ts` reads
 * `__JEEX_VIEWER_VERSION__`, so a fast run without it fails to parse. This test
 * is what keeps the two files from drifting apart in silence.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const BUNFIG = readFileSync(new URL('../bunfig.toml', import.meta.url), 'utf8');
const FAST = readFileSync(new URL('./fast-bunfig.toml', import.meta.url), 'utf8');

/** The `[define]` table's key/value lines, in order, ignoring comments. */
function defineLines(source: string): string[] {
  const lines = source.split('\n').map((line) => line.trim());
  const start = lines.indexOf('[define]');
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('[')) break;
    if (line === '' || line.startsWith('#')) continue;
    body.push(line);
  }
  return body;
}

describe('fast-bunfig.toml', () => {
  test('carries the same [define] table as bunfig.toml', () => {
    expect(defineLines(FAST)).toEqual(defineLines(BUNFIG));
    expect(defineLines(FAST).length).toBeGreaterThan(0);
  });

  test('defines the version identifier the source reads', () => {
    expect(FAST).toContain('__JEEX_VIEWER_VERSION__');
  });

  test('carries no coverage configuration at all — that is the whole point', () => {
    const tables = FAST.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('['));
    expect(tables).toEqual(['[define]']);
    const settings = FAST.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(settings.some((line) => line.toLowerCase().includes('coverage'))).toBe(false);
    // And the file it differs from really does have one, so this test is not
    // pinning a difference that stopped existing.
    expect(BUNFIG.toLowerCase()).toContain('coveragethreshold');
  });
});
