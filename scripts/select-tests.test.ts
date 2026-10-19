/**
 * The `fast` tier's test selector.
 *
 * The claim under test is the one the tier rests on: a change is followed
 * UPWARDS through the import graph, so a test two modules above the edit is
 * selected, and a test that cannot see the edit at all is not. The second claim
 * is that the selector never
 * answers «nothing» when it simply could not see: a missing root is an error,
 * and a deleted module — whose importers have no edge left to follow — takes
 * every test rather than none.
 *
 * Everything runs against a throwaway tree on disk rather than the repository
 * itself, so the expectations are exact instead of «whatever `src/` happens to
 * look like».
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importerGraph, resolveSpecifier, selectTests, sourceFiles, TEST_PATTERN } from './select-tests.ts';

/**
 * A three-layer tree: `leaf` ← `middle` ← `top`, each with its own test, plus an
 * `island` nothing imports and a `sideways` module reached only by a
 * side-effect import.
 */
const ROOT = mkdtempSync(join(tmpdir(), 'jeex-select-tests-'));
mkdirSync(join(ROOT, 'nested'), { recursive: true });
writeFileSync(join(ROOT, 'leaf.ts'), 'export const leaf = 1;\n');
writeFileSync(join(ROOT, 'leaf.test.ts'), "import { leaf } from './leaf.ts';\nexport const a = leaf;\n");
writeFileSync(join(ROOT, 'middle.ts'), "import { leaf } from './leaf.js';\nexport const middle = leaf + 1;\n");
writeFileSync(join(ROOT, 'middle.test.ts'), "import { middle } from './middle.ts';\nexport const b = middle;\n");
writeFileSync(join(ROOT, 'nested', 'index.ts'), "import { middle } from '../middle.ts';\nexport const top = middle;\n");
writeFileSync(join(ROOT, 'top.test.ts'), "const load = () => import('./nested');\nexport const c = load;\n");
writeFileSync(join(ROOT, 'island.ts'), 'export const island = 0;\n');
writeFileSync(join(ROOT, 'island.test.ts'), "import { island } from './island.ts';\nexport const d = island;\n");
writeFileSync(join(ROOT, 'sideways.mts'), 'export const sideways = 2;\n');
writeFileSync(join(ROOT, 'sideways.test.ts'), "import './sideways.mjs';\nexport const e = 1;\n");

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const relative = (paths: readonly string[]): string[] => paths.map((path) => path.slice(ROOT.length + 1)).sort();

describe('resolveSpecifier', () => {
  test('resolves a plain relative specifier to its .ts file', () => {
    expect(resolveSpecifier(join(ROOT, 'middle.ts'), './leaf')).toBe(join(ROOT, 'leaf.ts'));
  });

  test("resolves the './x.js' spelling TypeScript uses for './x.ts'", () => {
    expect(resolveSpecifier(join(ROOT, 'middle.ts'), './leaf.js')).toBe(join(ROOT, 'leaf.ts'));
  });

  test("resolves the './x.mjs' spelling TypeScript uses for './x.mts'", () => {
    expect(resolveSpecifier(join(ROOT, 'middle.ts'), './sideways.mjs')).toBe(join(ROOT, 'sideways.mts'));
  });

  test('resolves a directory to its index module', () => {
    expect(resolveSpecifier(join(ROOT, 'top.test.ts'), './nested')).toBe(join(ROOT, 'nested', 'index.ts'));
  });

  test('answers null for something that is not there', () => {
    expect(resolveSpecifier(join(ROOT, 'middle.ts'), './nowhere')).toBeNull();
  });

  test('answers null for a bare specifier: a dependency is not part of the graph', () => {
    expect(resolveSpecifier(join(ROOT, 'middle.ts'), 'three')).toBeNull();
  });
});

describe('importerGraph', () => {
  test('records the reverse edge of every relative import', () => {
    const graph = importerGraph(sourceFiles([ROOT]));
    expect(relative(graph.get(join(ROOT, 'leaf.ts')) ?? [])).toEqual(['leaf.test.ts', 'middle.ts']);
  });

  test('records a side-effect import, which has no `from` clause', () => {
    const graph = importerGraph(sourceFiles([ROOT]));
    expect(relative(graph.get(join(ROOT, 'sideways.mts')) ?? [])).toEqual(['sideways.test.ts']);
  });
});

describe('selectTests', () => {
  test('a leaf change reaches the tests of everything above it, and nothing else', () => {
    const selection = selectTests([ROOT], [join(ROOT, 'leaf.ts')]);
    expect(selection.everything).toBe(false);
    expect(relative(selection.tests)).toEqual(['leaf.test.ts', 'middle.test.ts', 'top.test.ts']);
  });

  test('a change to a module nothing imports selects only its own test', () => {
    expect(relative(selectTests([ROOT], [join(ROOT, 'island.ts')]).tests)).toEqual(['island.test.ts']);
  });

  test('a changed test file selects itself', () => {
    expect(relative(selectTests([ROOT], [join(ROOT, 'island.test.ts')]).tests)).toEqual(['island.test.ts']);
  });

  test('no change selects no test — an empty answer, not every test', () => {
    expect(selectTests([ROOT], []).tests).toEqual([]);
  });

  test('a changed file outside the roots is ignored rather than crashing the run', () => {
    expect(selectTests([ROOT], [join(ROOT, '..', 'somewhere-else.ts')]).tests).toEqual([]);
  });

  test('a DELETED module takes every test under the roots, and says which module', () => {
    const selection = selectTests([ROOT], [join(ROOT, 'gone.ts')]);
    expect(selection.everything).toBe(true);
    expect(selection.reason).toMatch(/deleted or renamed away/);
    expect(selection.reason).toContain('gone.ts');
    expect(relative(selection.tests)).toEqual(['island.test.ts', 'leaf.test.ts', 'middle.test.ts', 'sideways.test.ts', 'top.test.ts']);
  });

  test('a root that does not exist is an error, never an empty selection', () => {
    expect(() => selectTests([join(ROOT, 'no-such-root')], [])).toThrow(/root does not exist/);
  });

  test('a changed manifest takes every test: it is what the edges are built from', () => {
    const selection = selectTests([ROOT], [join(ROOT, 'package.json')], ROOT);
    expect(selection.everything).toBe(true);
    expect(selection.reason).toMatch(/manifest or lockfile changed/);
    expect(selection.tests.length).toBe(5);
  });

  test('a changed lockfile takes every test for the same reason', () => {
    expect(selectTests([ROOT], [join(ROOT, 'bun.lock')], ROOT).everything).toBe(true);
  });
});

describe('TEST_PATTERN', () => {
  test('matches the colocated convention and not a plain module', () => {
    expect(TEST_PATTERN.test('src/plan/solver.test.ts')).toBe(true);
    expect(TEST_PATTERN.test('src/plan/solver.ts')).toBe(false);
    expect(TEST_PATTERN.test('tests/e2e/index.spec.ts')).toBe(false);
  });
});
