/**
 * The pure half of the gate over `jeex-viewer/schema` and `jeex-viewer/lightmap`:
 * what counts as a BUNDLED copy of a peer package in an emitted file. The build
 * itself runs the gate over the real artefact (`build:lib`), teeth included:
 * the same signs must fire on the entries that do bundle a peer.
 */

import { describe, expect, test } from 'bun:test';
import { bundledPeerDefects, peerImports } from './package-entry-check.ts';

describe('bundledPeerDefects', () => {
  test('an import of a peer is not a defect', () => {
    expect(bundledPeerDefects('a.js', 'import { z as e } from "zod/mini";\nimport * as THREE from "three";')).toEqual([]);
  });

  // The library build renames identifiers (`import { z as e }`, `function gn(…)`), so
  // the signs are the ones that survive it: zod's class names are STRING literals
  // handed to its constructor factory, three.js registers itself under a global.
  test('bundled zod is found by its class names, which renaming leaves alone', () => {
    expect(bundledPeerDefects('b.js', 'const t = Yn("$ZodType", (e, n) => {});')).toEqual([{ file: 'b.js', problem: 'bundles zod' }]);
  });

  test('bundled three.js is found by the global it registers under', () => {
    expect(bundledPeerDefects('c.js', 'typeof window < "u" && (window.__THREE__ ? console.warn("x") : window.__THREE__ = Hn);')).toEqual([
      { file: 'c.js', problem: 'bundles three.js' },
    ]);
  });

  test('a comment naming a peer is not its code', () => {
    expect(
      bundledPeerDefects('d.js', '// zod names its classes "$ZodType"; three sets __THREE__\n/* __THREE__ */ export const a = 1;'),
    ).toEqual([]);
  });
});

describe('peerImports', () => {
  test('lists the bare packages a file imports, subpaths kept, relative files left out', () => {
    const source =
      'import { z } from "zod/mini";\nimport * as THREE from "three";\nimport { a } from "./a.js";\nexport { b } from "three/addons/b.js";';
    expect(peerImports(source).sort()).toEqual(['three', 'three/addons/b.js', 'zod/mini']);
  });
});
