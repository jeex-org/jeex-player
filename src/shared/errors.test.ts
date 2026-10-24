import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SceneValidationError, ViewerLibError, boundDocumentDetail, boundDocumentText, isViewerLibError } from './errors.js';

const SRC = join(import.meta.dirname, '..');

/**
 * Files allowed to construct something other than a `ViewerLibError`.
 *
 * - `shared/errors.ts` declares the base class itself.
 * - `scene-model.ts` raises `TypeError` from the frozen-collection guards on
 *   purpose: a mutation attempt on a frozen `Map` is a JavaScript-level
 *   programming error, and the language's own type is what a caller catches.
 * - `embed/host.ts` raises `EmbedError`, which carries the same `code` contract
 *   but CANNOT extend `ViewerLibError`: nothing in that file may import viewer
 *   code, or a page that embeds by iframe downloads the viewer it was avoiding
 *   (4 KB gzip, `budget-check.ts`). `host.test.ts` asserts the shape instead.
 * - `fixtures/op-drafts.ts` is test scaffolding that happens not to end in
 *   `.test.ts`: when a fixture cannot find what a test asked for, or an
 *   operation the test expected to be refused was accepted, the right thing to
 *   raise is the runner's own `Error`, the same one a `.test.ts` file raises
 *   inline.
 */
const ALLOWLIST = new Set(['shared/errors.ts', 'scene/scene-model.ts', 'embed/host.ts', 'fixtures/op-drafts.ts']);

/** Every non-test `.ts` module under `src/`, as paths relative to `src/`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push(relative(SRC, full));
  }
  return out;
}

/** The constructor name of every `throw new X(` in `text`. */
function thrownConstructors(text: string): string[] {
  return [...text.matchAll(/\bthrow\s+new\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]!);
}

/**
 * Error classes that carry a machine-readable code: every `ViewerLibError`
 * subclass, by construction, and `LightingError`, the coded error of the
 * separately published lighting entry (`lighting/lighting-error.ts`), which
 * carries no viewer code and so cannot extend the viewer's class.
 */
const CODED = new Set([
  'ViewerLibError',
  'LightingError',
  'SceneValidationError',
  'PlanError',
  'OpError',
  'ViewerDisposedError',
  'MissingShellNodeError',
  'MissingSlotError',
  'ByteLimitError',
  'LightBakeError',
]);

describe('ViewerLibError', () => {
  test('carries a code, a path and a detail', () => {
    const error = new ViewerLibError('scene-load', 'Scene fetch failed', {
      path: 'walls[3].openings[1].head',
      detail: { status: 404, url: '/missing.json' },
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('scene-load');
    expect(error.path).toBe('walls[3].openings[1].head');
    expect(error.detail).toEqual({ status: 404, url: '/missing.json' });
    expect(error.name).toBe('ViewerLibError');
  });

  test('keeps the original throw as `cause`', () => {
    const original = new RangeError('nope');
    const error = new ViewerLibError('internal', 'wrapped', { cause: original });
    expect(error.cause).toBe(original);
  });

  test('leaves `cause` absent when none was given', () => {
    const error = new ViewerLibError('internal', 'bare');
    expect('cause' in error).toBe(false);
  });

  test('isViewerLibError narrows subclasses too', () => {
    expect(isViewerLibError(new SceneValidationError('wall-thickness-range', 'too thick'))).toBe(true);
    expect(isViewerLibError(new Error('plain'))).toBe(false);
  });
});

describe('SceneValidationError', () => {
  test('fixes the code and names the rule and the path', () => {
    const error = new SceneValidationError('wall-thickness-range', 'Wall w1 thickness 0.9 is outside 0.05..0.6 m', {
      path: 'walls[0].thickness',
      detail: { value: 0.9 },
    });
    expect(error).toBeInstanceOf(ViewerLibError);
    expect(error.code).toBe('scene-invalid');
    expect(error.rule).toBe('wall-thickness-range');
    expect(error.path).toBe('walls[0].thickness');
  });
});

describe('bounding a document echo', () => {
  test('the author’s own words pass unchanged; urls and long runs do not', () => {
    const own = 'Scene validation failed: Duplicate id kitchen: already used by a room (walls[12].openings[3].head)';
    expect(boundDocumentText(own)).toBe(own);
    expect(boundDocumentText('a mailto:x@y.z, a data:text/html,<b> and (https://h.example/p)')).toBe('a <url> a <url> and (<url>)');
    expect(boundDocumentText('x'.repeat(49))).toBe(`${'x'.repeat(32)}…`);
    expect(boundDocumentText('x'.repeat(48))).toBe('x'.repeat(48));
    expect(boundDocumentText('word '.repeat(100))).toHaveLength(300);
  });

  test('control characters and bidi overrides become spaces, and no cut splits a surrogate pair', () => {
    expect(boundDocumentText('id\nFORGED line\r\u001B[31mred\u202Eevil')).toBe('id FORGED line  [31mred evil');
    const emoji = `${'x'.repeat(31)}${'\u{1F600}'.repeat(10)}`;
    expect(boundDocumentText(emoji)).toBe(`${'x'.repeat(31)}…`);
    expect(boundDocumentText(`${'a '.repeat(149)}\u{1F600}${' b'.repeat(10)}`)).toBe(`${'a '.repeat(149)}…`);
  });

  test('detail keeps numbers and shape, bounds strings and keys, and caps its size', () => {
    const bounded = boundDocumentDetail({
      status: 404,
      ok: false,
      none: null,
      url: 'https://h.example/a',
      [`k${'k'.repeat(60)}`]: 'v',
      list: Array.from({ length: 50 }, (_, index) => index),
      deep: { a: { b: { c: { d: 'hidden' } } } },
    }) as Record<string, unknown>;
    expect(bounded['status']).toBe(404);
    expect(bounded['ok']).toBe(false);
    expect(bounded['none']).toBeNull();
    expect(bounded['url']).toBe('<url>');
    expect(bounded[`${'k'.repeat(32)}…`]).toBe('v');
    expect(bounded['list']).toHaveLength(10);
    expect(JSON.stringify(bounded['deep'])).not.toContain('hidden');
  });
});

describe('the throw policy', () => {
  test('every `throw new` in src/ constructs a ViewerLibError', () => {
    const offenders: string[] = [];
    let coded = 0;
    for (const file of sourceFiles(SRC)) {
      if (ALLOWLIST.has(file)) continue;
      for (const name of thrownConstructors(readFileSync(join(SRC, file), 'utf8'))) {
        if (CODED.has(name)) {
          coded += 1;
          continue;
        }
        offenders.push(`${file}: throw new ${name}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(coded).toBeGreaterThan(50);
  });

  test('the allowlisted files are the only exceptions, and they still exist', () => {
    const files = new Set(sourceFiles(SRC));
    for (const allowed of ALLOWLIST) expect(files.has(allowed)).toBe(true);
  });
});
