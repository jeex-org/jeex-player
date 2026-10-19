import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No string ever reaches a DOM XSS sink: the Trusted Types negative path,
 * enforced over every production module.
 *
 * The viewer mounts on pages that send `require-trusted-types-for 'script'`
 * and never ships a Trusted Types policy of its own, so under such a page ANY
 * string assigned to `innerHTML` — or passed to `insertAdjacentHTML`, `eval`,
 * a string timer, `document.write` — throws a `TypeError` in whatever code
 * path did it. `tests/e2e/trusted-types.spec.ts` proves the MOUNT survives an
 * enforced page; it cannot reach every later path (a door label, an error
 * card, a tour bar rebuilt on a locale change). This scan can: it reads every
 * non-test module under `src/` after `Bun.Transpiler` has stripped the types
 * and the comments (so a doc comment that names `innerHTML` is not a hit) and
 * refuses any sink.
 *
 * `ALLOWED` is the documented exception list and it is EMPTY. An entry would
 * be a `module → reason` pair naming a Trusted Types policy that module
 * creates; there is none, and the library's promise (README «Content Security
 * Policy») is that there never needs to be.
 */

const SRC = import.meta.dirname;

/** `module (relative to src/) → why it may use a sink`. Empty on purpose. */
const ALLOWED: Readonly<Record<string, string>> = {};

/** The sinks, as they appear in transpiled JavaScript. */
const SINKS: ReadonlyArray<readonly [string, RegExp]> = [
  ['innerHTML/outerHTML assignment', /\.\s*(?:innerHTML|outerHTML)\s*(?:\+?=)(?!=)/],
  // A literal `el['innerHTML']` prints as `el.innerHTML` after the transpiler;
  // what is left is a sink NAMED as a string (`Reflect.set`, a computed key).
  ['sink named as a string', /["'`](?:innerHTML|outerHTML|srcdoc|insertAdjacentHTML)["'`]/],
  ['srcdoc assignment', /\.\s*srcdoc\s*=(?!=)/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\s*\(/],
  ['createContextualFragment', /\bcreateContextualFragment\s*\(/],
  ['setHTMLUnsafe / parseHTMLUnsafe', /\b(?:setHTMLUnsafe|parseHTMLUnsafe)\b/],
  ['DOMParser', /\bnew\s+DOMParser\b/],
  ['document.write', /\bdocument\s*\.\s*write(?:ln)?\s*\(/],
  ['eval', /(?<![.\w$])eval\s*\(/],
  ['Function constructor', /\bnew\s+Function\s*\(/],
  ['string timer', /\bset(?:Timeout|Interval)\s*\(\s*["'`]/],
  ['script element', /\bcreateElement\s*\(\s*["'`]script["'`]/i],
];

const transpiler = new Bun.Transpiler({ loader: 'ts' });

/** Every sink `source` (TypeScript) reaches, by name; comments never count. */
function sinksIn(source: string): string[] {
  const code = transpiler.transformSync(source);
  return SINKS.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

/** Every non-test `.ts` under `src/`, relative to `src/`. */
function productionModules(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...productionModules(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) found.push(relative(SRC, path));
  }
  return found;
}

describe('DOM XSS sinks', () => {
  test('the scanner sees each sink in code and none in a comment', () => {
    // Teeth: every pattern fires on a real use, so an empty result below
    // means "no sink", not "a pattern that can no longer match".
    const planted: ReadonlyArray<readonly [string, string]> = [
      ['innerHTML/outerHTML assignment', "el.innerHTML = '<b>x</b>'; el.outerHTML += html;"],
      ['sink named as a string', "Reflect.set(el, 'innerHTML', html);"],
      ['srcdoc assignment', 'frame.srcdoc = html;'],
      ['insertAdjacentHTML', "el.insertAdjacentHTML('beforeend', html);"],
      ['createContextualFragment', 'range.createContextualFragment(html);'],
      ['setHTMLUnsafe / parseHTMLUnsafe', 'el.setHTMLUnsafe(html);'],
      ['DOMParser', "new DOMParser().parseFromString(html, 'text/html');"],
      ['document.write', 'document.write(html);'],
      ['eval', 'eval(code);'],
      ['Function constructor', "new Function('return 1');"],
      ['string timer', "setTimeout('run()', 10);"],
      ['script element', "document.createElement('script');"],
    ];
    expect(planted.map(([name]) => name)).toEqual(SINKS.map(([name]) => name));
    for (const [name, line] of planted) {
      // A line may hit more than one pattern; each must hit its own.
      expect(sinksIn(`export function f(el: any, frame: any, range: any, html: string, code: string) { ${line} }`)).toContain(name);
    }
    expect(sinksIn('/** assigns no string to `innerHTML`; never eval(x) */\nexport const a = 1;')).toEqual([]);
    expect(sinksIn('export function f(el: HTMLElement) { return el.innerHTML === ""; }')).toEqual([]);
  });

  test('no production module under src/ uses one, and the allowlist is empty', () => {
    const modules = productionModules();
    expect(modules.length).toBeGreaterThan(100);
    const hits = modules
      .filter((module) => !(module in ALLOWED))
      .flatMap((module) => sinksIn(readFileSync(join(SRC, module), 'utf8')).map((sink) => `${module}: ${sink}`));
    expect(hits).toEqual([]);
    expect(Object.keys(ALLOWED)).toEqual([]);
  });
});
