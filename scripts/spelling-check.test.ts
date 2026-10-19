import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FORCED_FILES,
  FORCED_NAMES,
  PENDING_FILES,
  SPELLING_RULES,
  checkHygiene,
  hasHeader,
  isExcusedFile,
  isForced,
  spellingHitsIn,
} from './spelling-check.js';

/**
 * The gate's own teeth. A gate nobody proved can fire is a gate that passes
 * because it found nothing to look at, which is exactly what happened to the
 * header rule for eighteen files.
 *
 * Both halves are fed FIXTURE STRINGS, not the real tree: the questions here
 * are "does it catch this" and "does it excuse that", and the answers must not
 * change when `src/` does.
 */

const HEADER = '/**\n * A responsibility, and the invariant that goes with it.\n */\n';

/** A throwaway `src`-shaped directory with the given files in it. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jeex-hygiene-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

describe('spellingHitsIn', () => {
  test('catches every American form the policy names, and says what to write', () => {
    const hits = spellingHitsIn(
      [
        'export type WallCenterline = { thickness: number };',
        'const catalog = new Map();',
        '/** Half-extents in meters. */',
        'const color = pick();',
      ].join('\n'),
    );
    expect(hits.map((hit) => [hit.line, hit.write])).toEqual([
      [1, 'centre'],
      [2, 'catalogue'],
      [3, 'metres'],
      [4, 'colour'],
    ]);
  });

  test('catches the compound forms, not only the bare words', () => {
    expect(spellingHitsIn('for (const centerline of plan.centerlines) {')).toHaveLength(1);
    expect(spellingHitsIn('const centers: Vec3[] = [];')).toHaveLength(1);
    expect(spellingHitsIn('type CatalogEntry = { id: string };')).toHaveLength(1);
    expect(spellingHitsIn('const meter = 1;')).toHaveLength(1);
  });

  test('says nothing about British prose', () => {
    expect(
      spellingHitsIn(
        [
          'export type WallCentreline = { thickness: number };',
          'const catalogue = new Map();',
          '/** Half-extents in metres. */',
          'const colour = pick();',
          'const centrelineOf = (wall: Wall) => wall;',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  test('`catalogue` does not match the `catalog` rule', () => {
    // The word-boundary is why: without it every `catalogue` in the tree —
    // 175 of them — would be a hit.
    expect(spellingHitsIn('import { findCatalogueEntry } from "./asset-catalogue.js";')).toEqual([]);
  });

  test('reports one hit per line, so a line with two forms is one fix', () => {
    expect(spellingHitsIn('const color = centers[0];')).toHaveLength(1);
  });

  test('the BARE word `center` is not a hit: it is the scene.json field name', () => {
    // `Opening.center` is the wire format. Renaming it would break every
    // document; `dcenter` beside it is the documented wart.
    for (const line of [
      '  readonly center: number;',
      '  const t0 = opening.center - opening.width / 2;',
      "  { id: 'door-ab', type: 'door', center: 2.5, width: 0.9 },",
      '  const { center, width } = geometry;',
    ]) {
      expect({ line, hits: spellingHitsIn(line) }).toEqual({ line, hits: [] });
    }
  });
});

describe('isForced', () => {
  test('excuses a line that carries an API name the viewer does not choose', () => {
    for (const line of [
      'box.getCenter(target);',
      'texture.colorSpace = THREE.SRGBColorSpace;',
      'gradient.addColorStop(0, base);',
      'material.color.set(hex);',
      'const { dcenter } = op;',
    ]) {
      expect({ line, forced: isForced(line) }).toEqual({ line, forced: true });
    }
  });

  test('does not excuse a line that merely mentions colour in prose', () => {
    expect(isForced('const colorOfTheDay = pick();')).toBe(false);
  });

  test('every forced name carries a reason', () => {
    for (const forced of FORCED_NAMES) {
      expect({ name: forced.name, reason: forced.reason.length > 0 }).toEqual({ name: forced.name, reason: true });
    }
  });
});

describe('hasHeader', () => {
  test('a JSDoc block at the top passes', () => {
    expect(hasHeader(`${HEADER}\nimport x from './x.js';\n`)).toBe(true);
  });

  test('leading blank lines are allowed', () => {
    expect(hasHeader(`\n\n${HEADER}`)).toBe(true);
  });

  test('an import first, a line comment first, or nothing at all fails', () => {
    expect(hasHeader("import x from './x.js';\n")).toBe(false);
    expect(hasHeader('// a responsibility\nimport x from "./x.js";\n')).toBe(false);
    expect(hasHeader('')).toBe(false);
  });

  test('a block that is not JSDoc fails: `/*` is not `/**`', () => {
    expect(hasHeader('/* a note */\n')).toBe(false);
  });
});

describe('isExcusedFile', () => {
  test('the shader file is excused; PENDING_FILES is empty again after the selection-glow-math split', () => {
    expect(isExcusedFile('geometry/selection-glow-shader.ts')).toBe(true);
    expect(PENDING_FILES.length).toBe(0);
    expect(isExcusedFile('geometry/selection-glow.ts')).toBe(false);
    expect(isExcusedFile('materials/textures.ts')).toBe(false);
  });

  test('every excused file carries a reason', () => {
    for (const entry of [...FORCED_FILES, ...PENDING_FILES]) {
      expect({ file: entry.file, reason: entry.reason.length > 0 }).toEqual({ file: entry.file, reason: true });
    }
  });
});

describe('checkHygiene over a tree', () => {
  test('reports both kinds, with the file and the line', () => {
    const root = tree({
      'good.ts': `${HEADER}export const centre = 1;\n`,
      'bad-spelling.ts': `${HEADER}export const centers = 1;\n`,
      'bad-header.ts': 'export const centre = 1;\n',
      'nested/also-bad.test.ts': 'export const centerline = 1;\n',
    });
    const report = checkHygiene(root);
    expect(report.spelling.map((hit) => `${hit.file}:${hit.line}`)).toEqual(['bad-spelling.ts:4', 'nested/also-bad.test.ts:1']);
    // A TEST file is spell-checked but never asked for a header.
    expect(report.headers.map((miss) => miss.file)).toEqual(['bad-header.ts']);
  });

  test('a clean tree reports nothing', () => {
    const root = tree({ 'a.ts': `${HEADER}export const metres = 1;\n`, 'b.test.ts': 'export const colour = 2;\n' });
    expect(checkHygiene(root)).toEqual({ spelling: [], headers: [] });
  });

  test('a `.d.ts` is not asked for a header either', () => {
    const root = tree({ 'assets.d.ts': "declare module '*.css';\n" });
    expect(checkHygiene(root).headers).toEqual([]);
  });

  test('the rule table is the whole policy: four forms, no more', () => {
    // Bump this deliberately when the policy grows a form, never to make the
    // test pass.
    expect(SPELLING_RULES).toHaveLength(4);
  });
});
