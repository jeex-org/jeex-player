import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CSS_TARGET } from '../vite.css-target.ts';
import { checkDirectory, emittedFiles, findCssDefects } from './css-contract-check.js';

/**
 * The gate's own teeth, and the configuration that keeps it green.
 *
 * The defect this was written for was invisible in the source and
 * plain in the artefact, so the fixtures here ARE artefact text: the exact
 * shape Lightning CSS emitted, and the shape the build must emit instead.
 */

/** The property as the build broke it: the polyfill with no companions. */
const DOWNLEVELLED =
  '.jeex-viewer{--jeex-surface:var(--lightningcss-light,#faf7f0d1)var(--lightningcss-dark,#0e1615c2);color-scheme:var(--jeex-color-scheme,dark)}';

/** The property as the build must leave it. */
const INTACT = '.jeex-viewer{--jeex-surface:light-dark(#faf7f0d1,#0e1615c2);color-scheme:var(--jeex-color-scheme,dark)}';

/** A throwaway `dist`-shaped directory with the given files in it. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jeex-css-contract-'));
  for (const [name, text] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

describe('findCssDefects', () => {
  test('the down-levelled `light-dark()` is a defect, and the message names the fix', () => {
    const defects = findCssDefects('jeex-viewer.js', DOWNLEVELLED);
    expect(defects).toHaveLength(1);
    expect(defects[0]?.problem).toContain('vite.css-target.ts');
  });

  test('the stylesheet with `light-dark()` intact is not a defect', () => {
    expect(findCssDefects('jeex-viewer.js', INTACT)).toEqual([]);
  });

  test('the chrome stylesheet without any `light-dark()` at all is a defect', () => {
    expect(findCssDefects('jeex-viewer.css', '.jeex-viewer{--jeex-surface:#faf7f0d1}')).toHaveLength(1);
  });

  test('a file that is not the chrome stylesheet is judged on the polyfill alone', () => {
    expect(findCssDefects('three.core.js', 'export const x = 1;')).toEqual([]);
  });
});

describe('checkDirectory', () => {
  test('walks nested output and reports the file the defect is in', () => {
    const dir = tree({ 'assets/main.css': DOWNLEVELLED, 'assets/other.js': 'const a = 1;' });
    const defects = checkDirectory(dir);
    expect(defects).toHaveLength(1);
    expect(defects[0]?.file).toBe(join('assets', 'main.css'));
  });

  test('a clean build reports nothing', () => {
    expect(checkDirectory(tree({ 'jeex-viewer.js': INTACT }))).toEqual([]);
  });

  test('a build with no chrome stylesheet in it at all is a defect of its own', () => {
    // The case no per-file rule can see: nothing is broken because nothing is
    // there.
    const defects = checkDirectory(tree({ 'jeex-viewer.js': 'export const x = 1;' }));
    expect(defects).toHaveLength(1);
    expect(defects[0]?.problem).toContain('not in this build at all');
  });

  test('a symlinked directory is not walked into, so a cycle cannot hang the gate', () => {
    const dir = tree({ 'jeex-viewer.js': INTACT });
    symlinkSync(dir, join(dir, 'self'), 'dir');
    expect(emittedFiles(dir)).toEqual(['jeex-viewer.js']);
  });

  test('reads only the emitted JavaScript and CSS', () => {
    const dir = tree({ 'a.js': '', 'b.css': '', 'c.map': '', 'schema/scene.schema.json': '{}' });
    expect(emittedFiles(dir).sort()).toEqual(['a.js', 'b.css']);
  });
});

describe('the CSS baseline the gate depends on', () => {
  test('every engine is pinned at or above its first `light-dark()` version', () => {
    // Baseline newly available 2024-05-13; a target below any of these is what
    // makes Lightning CSS reach for the polyfill again.
    expect([...CSS_TARGET].sort()).toEqual(['chrome123', 'edge123', 'firefox120', 'safari17.5']);
  });
});
