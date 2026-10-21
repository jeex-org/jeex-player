/**
 * The cost-balanced split of the component tier across CI runners
 * (`tests/component-shards.ts`): every file lands on exactly one shard, the
 * split does not depend on the order the files were found in, and the table
 * of measured costs still names every component test file.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { assignShards, COMPONENT_FILE_COST_S, fileCost, UNKNOWN_FILE_COST_S } from '../tests/component-shards.js';

const COMPONENT_DIR = new URL('../tests/component/', import.meta.url);
const componentFiles = (): string[] =>
  readdirSync(COMPONENT_DIR)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => `/repo/tests/component/${name}`);

const identity = (file: string): string => file;

function split(files: readonly string[], count: number, costOf?: (path: string) => number): string[][] {
  return Array.from({ length: count }, (_, shard) => assignShards(files, shard + 1, count, identity, costOf));
}

describe('assignShards', () => {
  test('every file lands on exactly one shard, for every shard count CI could use', () => {
    const files = componentFiles();
    for (const count of [1, 2, 3, 4, 6]) {
      const shards = split(files, count);
      expect(shards.flat().sort()).toEqual([...files].sort());
    }
  });

  test('the split does not depend on the order the files were listed in', () => {
    const files = componentFiles();
    const reversed = [...files].reverse();
    expect(split(reversed, 4).map((shard) => [...shard].sort())).toEqual(split(files, 4).map((shard) => [...shard].sort()));
  });

  test('heaviest first onto the lightest shard: costs 5, 4, 3, 3 over two shards give 5+3 and 4+3', () => {
    const costs: Record<string, number> = { a: 5, b: 4, c: 3, d: 3 };
    const shards = split(Object.keys(costs), 2, (path) => costs[path]!);
    expect(shards).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ]);
  });

  test('on the measured table no shard of four carries more than the heaviest file or a third over the even share', () => {
    const files = componentFiles();
    const total = files.reduce((sum, file) => sum + fileCost(file), 0);
    const heaviest = Math.max(...files.map((file) => fileCost(file)));
    for (const shard of split(files, 4)) {
      const cost = shard.reduce((sum, file) => sum + fileCost(file), 0);
      expect(cost).toBeLessThanOrEqual(Math.max(heaviest, (total / 4) * 1.34));
    }
  });

  test('a shard index or count outside 1..count is refused, never silently empty', () => {
    expect(() => assignShards(['a'], 0, 2, identity)).toThrow();
    expect(() => assignShards(['a'], 3, 2, identity)).toThrow();
    expect(() => assignShards(['a'], 1, 0, identity)).toThrow();
  });
});

describe('the measured cost table', () => {
  test('names every component test file and nothing else, so a new file is measured rather than guessed', () => {
    const onDisk = componentFiles()
      .map((file) => file.slice(file.lastIndexOf('/') + 1))
      .sort();
    expect(Object.keys(COMPONENT_FILE_COST_S).sort()).toEqual(onDisk);
  });

  test('a file the table does not name costs the documented default', () => {
    expect(fileCost('/repo/tests/component/brand-new.test.ts')).toBe(UNKNOWN_FILE_COST_S);
  });
});
