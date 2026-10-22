/**
 * The pure half of the lighting entry gate: what counts as three.js or the
 * DOM in an emitted file, and how the entry's file graph is walked. The build
 * itself runs the gate over the real artefact (`build:lib`).
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOnly, defectsOf, entryGraph } from './lighting-entry-check.ts';

describe('defectsOf', () => {
  test('a clean entry has no defects, prose and messages included', () => {
    const source = `// touches no window
const message = "the document says three.js revision 186";
export function f(three) { return new three.DirectionalLight(); }`;
    expect(defectsOf('entry.js', source)).toEqual([]);
  });

  test('an import of three, its code or its banner is a defect', () => {
    expect(defectsOf('a.js', 'import { Scene } from "three";')).toHaveLength(1);
    expect(defectsOf('b.js', 'import x from "three/addons/x.js";')).toHaveLength(1);
    expect(defectsOf('c.js', 'const REVISION = "186";')).toHaveLength(1);
    expect(defectsOf('d.js', '/** @license Copyright 2010-2026 Three.js Authors */')).toHaveLength(1);
    expect(defectsOf('e.js', 'class WebGLRenderer {}')).toHaveLength(1);
  });

  test('a reference to document or window is a defect', () => {
    expect(defectsOf('a.js', 'const canvas = document.createElement("canvas");')).toEqual([
      { file: 'a.js', problem: 'names the DOM global `document`' },
    ]);
    expect(defectsOf('b.js', 'const ratio = window.devicePixelRatio;')).toHaveLength(1);
  });

  test('codeOnly blanks comments and strings', () => {
    expect(codeOnly('a("window") // document\n/* window */ b')).toBe('a("") \n b');
  });
});

describe('entryGraph', () => {
  test('walks static and dynamic sibling imports once each', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lighting-entry-'));
    try {
      writeFileSync(join(dir, 'entry.js'), 'import { a } from "./a.js";\nexport * from "./b.js";');
      writeFileSync(join(dir, 'a.js'), 'import "./b.js"; const later = () => import("./c.js");');
      writeFileSync(join(dir, 'b.js'), 'export const b = 1;');
      writeFileSync(join(dir, 'c.js'), 'export const c = 1;');
      writeFileSync(join(dir, 'other.js'), 'export const other = 1;');
      expect(entryGraph(dir, 'entry.js').sort()).toEqual(['a.js', 'b.js', 'c.js', 'entry.js']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
