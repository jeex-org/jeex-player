/**
 * The pure half of the lighting entry gate: what counts as three.js or the
 * DOM in an emitted file, and how the entry's file graph is walked. The build
 * itself runs the gate over the real artefact (`build:lib`).
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledRevisions, codeOnly, defectsOf, engineDefects, entryGraph } from './lighting-entry-check.ts';

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

describe('the bundled engine', () => {
  // How three.js registers itself, as the ES build and the IIFE build spell it.
  const es = 'dispatchEvent(new CustomEvent("register", { detail: { revision: "186" } }))';
  const iife = 'dispatchEvent(new CustomEvent(`register`,{detail:{revision:`186`}}))';

  test('reads the revision in either quoting, and not a scene revision', () => {
    expect(bundledRevisions(es)).toEqual(['186']);
    expect(bundledRevisions(iife)).toEqual(['186']);
    expect(bundledRevisions('const state = { revision: "12" }; ({ w, h, revision: this.revision })')).toEqual([]);
  });

  test('passes the calibrated revision, and names the file that bundles another', () => {
    expect(
      engineDefects(
        new Map([
          ['a.js', es],
          ['b.iife.js', iife],
        ]),
        '186',
      ),
    ).toEqual([]);
    expect(engineDefects(new Map([['a.js', es.replace('186', '185')]]), '186')).toEqual([
      { file: 'a.js', problem: 'bundles three.js revision 185, the lighting standard requires 186' },
    ]);
  });

  test('a build with no readable three.js fails rather than passing in silence', () => {
    expect(engineDefects(new Map([['a.js', 'export const x = 1;']]), '186')).toHaveLength(1);
  });

  test('a file that carries three.js but spells its revision unreadably fails, even when another file passes', () => {
    expect(
      engineDefects(
        new Map([
          ['a.js', es],
          ['b.iife.js', 'window.__THREE__?w():window.__THREE__=Ga;dispatchEvent(new CustomEvent(`register`,{detail:{revision:Ga}}))'],
        ]),
        '186',
      ),
    ).toEqual([{ file: 'b.iife.js', problem: 'bundles three.js whose revision cannot be read' }]);
  });

  test('a second copy of three.js in a file with no readable revision fails', () => {
    const copy = `window.__THREE__?w():window.__THREE__=1;${es}`;
    expect(engineDefects(new Map([['a.js', copy]]), '186')).toEqual([]);
    expect(engineDefects(new Map([['a.js', `${copy};window.__THREE__?w():window.__THREE__=Ga`]]), '186')).toEqual([
      { file: 'a.js', problem: 'bundles three.js whose revision cannot be read' },
    ]);
  });
});
