/**
 * Every e2e test that compares a screenshot says what it still proves on CI.
 *
 * `playwright.config.ts` ignores screenshot comparisons when `CI` is set (the
 * baselines are rendered on the maintainers' machines). A test whose other
 * steps only prepare its picture then asserts nothing on a hosted runner, yet
 * still runs its setup there, and on a software rasteriser that setup (a
 * pointer resting on the control bar, an idle wait) can fail on its own. Such
 * a test calls `screenshotOnly()` as its first statement and is skipped on CI
 * with the reason. A test that takes a screenshot AND checks something else
 * keeps running there and is listed in `RUNS_ON_CI` with what it checks.
 *
 * The check is textual (each spec split at its `test(` calls, comments
 * removed), so it costs no browser. A raw `.screenshot()` compared inside a
 * test is not a baseline comparison, `ignoreSnapshots` does not touch it, and
 * it is out of scope here.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

const E2E_DIR = new URL('../tests/e2e/', import.meta.url);

/** `<file> › <title>` of the screenshot tests that keep running on CI, and what they check there. */
const RUNS_ON_CI: Readonly<Record<string, string>> = {
  'index.spec.ts › plan2d shows room labels, facade dimensions and the camera marker': 'the plan canvas becomes visible',
  'trusted-types.spec.ts › two viewers mount under require-trusted-types-for, no TypeError, one adopted sheet, both render':
    'no TypeError, two viewers, one adopted style sheet',
  'context-loss.spec.ts › a real WEBGL_lose_context loss raises the card and the context-lost event, and restoreContext() brings the scene back':
    'the card, the events and the restored state',
};

const SCREENSHOT_CALL = /\b(?:expectChromeScreenshot|expectCanvasScreenshot|expectCanvasStillRendering)\(|\.toHaveScreenshot\(/;
const TEST_CALL = /^[ \t]*test\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gm;

type SpecTest = { title: string; screenshot: boolean; marked: boolean; markedFirst: boolean };

/** Line and block comments removed, so a comment that names a helper is not a call. */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The tests of one spec: each `test(` call up to the next one. */
function specTests(source: string): SpecTest[] {
  const code = stripComments(source);
  const starts = [...code.matchAll(TEST_CALL)];
  return starts.map((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]!.index : code.length;
    const chunk = code.slice(match.index, end);
    const arrow = chunk.indexOf('=> {');
    const body = arrow < 0 ? '' : chunk.slice(arrow + 4).trimStart();
    return {
      title: match[2]!,
      screenshot: SCREENSHOT_CALL.test(chunk),
      marked: /\bscreenshotOnly\(/.test(chunk),
      markedFirst: body.startsWith('screenshotOnly('),
    };
  });
}

/** Everything wrong with the classification of the given specs, one line each. */
function classificationErrors(
  specs: ReadonlyArray<{ file: string; source: string }>,
  runsOnCi: Readonly<Record<string, string>>,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const { file, source } of specs) {
    for (const spec of specTests(source)) {
      const key = `${file} › ${spec.title}`;
      if (key in runsOnCi) {
        seen.add(key);
        if (!spec.screenshot) errors.push(`${key}: listed as running on CI but takes no screenshot`);
        if (spec.marked) errors.push(`${key}: listed as running on CI but marked screenshot-only`);
        continue;
      }
      if (spec.marked && !spec.screenshot) errors.push(`${key}: marked screenshot-only but takes no screenshot`);
      else if (spec.marked && !spec.markedFirst) errors.push(`${key}: screenshotOnly() is not the first statement`);
      else if (spec.screenshot && !spec.marked) errors.push(`${key}: takes a screenshot but is neither marked nor listed`);
    }
  }
  for (const key of Object.keys(runsOnCi)) if (!seen.has(key)) errors.push(`${key}: listed as running on CI but not found`);
  return errors;
}

const specFiles = (): Array<{ file: string; source: string }> =>
  readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
    .map((file) => ({ file, source: readFileSync(new URL(file, E2E_DIR), 'utf8') }));

describe('screenshot tests on CI', () => {
  test('every e2e test that compares a screenshot is marked screenshot-only or listed with what it checks on CI', () => {
    expect(classificationErrors(specFiles(), RUNS_ON_CI)).toEqual([]);
  });

  test('the split finds the screenshot tests at all', () => {
    const marked = specFiles().flatMap(({ source }) => specTests(source).filter((spec) => spec.screenshot));
    expect(marked.length).toBeGreaterThanOrEqual(12);
  });
});

describe('classificationErrors', () => {
  const one = (body: string): Array<{ file: string; source: string }> => [
    { file: 'a.spec.ts', source: `test('t', async ({ page }) => {\n${body}\n});\n` },
  ];

  test('an unmarked, unlisted screenshot test is named', () => {
    expect(classificationErrors(one('  await expectChromeScreenshot(page, "x.png");'), {})).toEqual([
      'a.spec.ts › t: takes a screenshot but is neither marked nor listed',
    ]);
  });

  test('a marked test without a screenshot is named', () => {
    expect(classificationErrors(one('  screenshotOnly();\n  await page.goto("/");'), {})).toEqual([
      'a.spec.ts › t: marked screenshot-only but takes no screenshot',
    ]);
  });

  test('a mark after the setup is named', () => {
    expect(
      classificationErrors(one('  await page.goto("/");\n  screenshotOnly();\n  await expectCanvasScreenshot(c, "x.png");'), {}),
    ).toEqual(['a.spec.ts › t: screenshotOnly() is not the first statement']);
  });

  test('a stale or wrong list entry is named', () => {
    expect(classificationErrors(one('  await page.goto("/");'), { 'a.spec.ts › t': 'x', 'a.spec.ts › gone': 'y' })).toEqual([
      'a.spec.ts › t: listed as running on CI but takes no screenshot',
      'a.spec.ts › gone: listed as running on CI but not found',
    ]);
  });

  test('a helper named in a comment is not a call, and a marked first statement passes', () => {
    expect(classificationErrors(one('  // like expectChromeScreenshot(page)\n  await page.goto("/");'), {})).toEqual([]);
    expect(classificationErrors(one('  screenshotOnly();\n  await expectChromeScreenshot(page, "x.png");'), {})).toEqual([]);
  });
});
