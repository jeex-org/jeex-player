/**
 * The listener-lifetime gate ("zero `addEventListener` without `signal`").
 *
 * The coding standards already name the pattern: `shared/abort.ts`'s
 * `AbortController` per instance, every `addEventListener` bound with
 * `{ signal }`, nothing paired with a manual `removeEventListener`. Nothing had
 * ever GATED it — the promise was held only by spot-checked unit tests, unlike
 * the console-policy grep next to it in `check.sh`.
 *
 * Scans `src/**\/*.ts` (test files excluded — a fake `EventTarget` honouring
 * `{ signal }` is a concern of the tests' own standards, not this one's) for
 * every REAL `.addEventListener(` call — a leading dot excludes a method
 * declaration/signature such as `FakeCanvas`'s own — and fails unless
 * the call's third argument:
 *
 * - is (or contains) an object literal that names `signal`, inline; or
 * - is a bare identifier bound, in the SAME file, to a `const` whose
 *   right-hand side names `signal` — the codebase's own
 *   `const listener = { signal }` / `const listener = listenerOptions(signal)`
 *   pattern (`shared/abort.ts`'s `listenerOptions`); or
 * - is listed in the dated `ALLOWLIST` below, each entry with a reason.
 *
 * The parser is intentionally NOT a full TypeScript parser — a bracket/string
 * -aware scanner that finds the matching close paren of the call and splits
 * its top-level arguments, the same order of rigour `spelling-check.ts` and
 * `size-check.ts` already apply to `src/`. Block comments are blanked first
 * (keeping line breaks, so line numbers stay accurate) so a `.addEventListener(`
 * mentioned in a `/** *\/` doc comment (`embed/element.ts`) is not a call site.
 *
 * Usage: `bun run scripts/listener-policy.ts [dir=src]`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type ListenerCall = { readonly file: string; readonly line: number };
export type ListenerViolation = ListenerCall & { readonly reason: string };
export type AllowlistEntry = {
  readonly file: string;
  readonly line: number;
  readonly date: string;
  readonly reason: string;
};

/**
 * The dated, reasoned exceptions. Each entry names the exact call site — a
 * new call at the same file, wherever it lands, is NOT covered by someone
 * else's entry, because line numbers are matched exactly.
 */
export const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    file: 'src/fixtures/stubs.ts',
    line: 103,
    date: '2026-09-08',
    reason:
      "the fake canvas's own bookkeeping listener on the CALLER's abort signal, registered with { once: true } so it self-unregisters the one time that signal can fire — passing `signal` here would mean the signal removing a listener on its own 'abort' event, which is circular. FakeCanvas is a per-test throwaway object besides.",
  },
];

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SIGNAL_RE = /\bsignal\b/;
const CALL_RE = /\.addEventListener\(/g;

/**
 * Blanks `/* … *\/` block comments AND `// …` line comments (newlines kept, so
 * line numbers survive), skipping string and template literals so a `//` in a
 * URL string stays. Line comments matter as much as block ones: this guards
 * against an apostrophe in one (`the root's own`) opening a phantom string in
 * `extractBalanced` that swallows the rest of the call, which then reads as
 * having no options at all.
 */
function stripComments(source: string): string {
  let out = '';
  let inString: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < source.length) {
        i += 1;
        out += source[i];
      } else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      out += ch;
      continue;
    }
    const next = source[i + 1];
    if (ch === '/' && (next === '*' || next === '/')) {
      const end = next === '*' ? source.indexOf('*/', i + 2) : source.indexOf('\n', i + 2);
      const stop = end === -1 ? source.length : next === '*' ? end + 2 : end;
      out += source.slice(i, stop).replaceAll(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/**
 * From `openIndex` (a `(`), the matching `)` — string/template-literal aware,
 * so a stray bracket character inside a string never miscounts the depth.
 * Returns the text BETWEEN the parens, or `null` if the source is unbalanced
 * (defensive; should not happen over valid TypeScript).
 */
function extractBalanced(source: string, openIndex: number): string | null {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** Top-level comma split of a call's argument text — string-literal aware, nesting-aware. */
function splitArgs(argsText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: string | null = null;
  for (let i = 0; i < argsText.length; i += 1) {
    const ch = argsText[i];
    if (inString) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push(argsText.slice(start, i));
      start = i + 1;
    }
  }
  args.push(argsText.slice(start));
  return args.map((argument) => argument.trim()).filter((argument) => argument.length > 0);
}

/** The right-hand side text of `const <name> = …;` (up to the top-level `;`), or `null` if not declared. */
function constRhs(source: string, name: string): string | null {
  const declaration = new RegExp(`\\bconst\\s+${name}\\b\\s*(?::[^=]+)?=\\s*`, 'g');
  const match = declaration.exec(source);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 0;
  let inString: string | null = null;
  let i = start;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (ch === ';' && depth === 0) break;
  }
  return source.slice(start, i);
}

/**
 * Whether an identifier resolves, in the SAME file, to a `const` whose
 * right-hand side names `signal` — the one-hop lookup the module doc
 * describes. `declaration` is re-run from scratch (not reused) because
 * `RegExp.exec` on a `g` pattern is stateful and this helper may be called
 * more than once per file.
 */
function identifierCarriesSignal(source: string, name: string): boolean {
  const rhs = constRhs(source, name);
  return rhs !== null && SIGNAL_RE.test(rhs);
}

/** Every `.addEventListener(` call in `rawSource` that has no `{ signal }` reachable in one hop. */
export function scanSource(file: string, rawSource: string): ListenerViolation[] {
  const source = stripComments(rawSource);
  const violations: ListenerViolation[] = [];
  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_RE.exec(source))) {
    const openIndex = match.index + match[0].length - 1;
    const inner = extractBalanced(source, openIndex);
    if (inner === null) continue;
    const args = splitArgs(inner);
    const optionsArgument = args[2];
    let ok = false;
    if (optionsArgument) {
      if (SIGNAL_RE.test(optionsArgument)) ok = true;
      else if (IDENTIFIER_RE.test(optionsArgument)) ok = identifierCarriesSignal(source, optionsArgument);
    }
    if (!ok) {
      const line = lineAt(source, match.index);
      const reason = optionsArgument
        ? `options argument "${optionsArgument}" has no { signal } reachable in one hop`
        : 'called with no options argument (no { signal } at all)';
      violations.push({ file, line, reason });
    }
  }
  return violations;
}

/** Splits raw violations into real ones and ones a dated allowlist entry covers, by exact file+line. */
export function applyAllowlist(
  violations: readonly ListenerViolation[],
  allowlist: readonly AllowlistEntry[] = ALLOWLIST,
): { readonly real: ListenerViolation[]; readonly allowlisted: AllowlistEntry[] } {
  const real: ListenerViolation[] = [];
  const allowlisted: AllowlistEntry[] = [];
  for (const violation of violations) {
    const entry = allowlist.find((candidate) => candidate.file === violation.file && candidate.line === violation.line);
    if (entry) allowlisted.push(entry);
    else real.push(violation);
  }
  return { real, allowlisted };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// Run as a script, not when imported by a test.
if (import.meta.main) {
  const root = process.argv[2] ?? 'src';
  const files = walk(root);
  const violations: ListenerViolation[] = [];
  for (const file of files) {
    const relativePath = relative('.', file);
    violations.push(...scanSource(relativePath, readFileSync(file, 'utf8')));
  }
  const { real, allowlisted } = applyAllowlist(violations);
  if (real.length > 0) {
    console.error('addEventListener without a { signal } reachable in one hop:');
    for (const violation of real) console.error(`  ${violation.file}:${violation.line} — ${violation.reason}`);
    process.exit(1);
  }
  const allowlistNote =
    allowlisted.length > 0
      ? `, ${allowlisted.length} allowlisted (${allowlisted.map((entry) => `${entry.file}:${entry.line}`).join(', ')})`
      : '';
  console.log(`Listener policy OK: 0 addEventListener without { signal } over ${root}${allowlistNote}`);
}
