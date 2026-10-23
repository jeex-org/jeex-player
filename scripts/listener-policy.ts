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
 * - carries an allow marker, `// listener-policy: allow <id>`, on the call's
 *   own line or the line directly above it, and `<id>` is named by a dated,
 *   reasoned entry of the `ALLOWLIST` below for that file.
 *
 * Entries are matched by marker, not by line number, so an import added above
 * the call does not break the gate. The marker and the list are kept honest
 * from both sides: a marker id must be unique within its file, and every one of
 * these is itself a failure — a marker with no entry (an unexplained exception),
 * an entry whose marker is not in its file (a stale exception), and a marker
 * that sits on no failing call (an exception nobody needs any more).
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
  readonly marker: string;
  readonly date: string;
  readonly reason: string;
};
/**
 * An allow marker as found in a file. `covers` is the one line it exempts: its
 * own line when code precedes it there, otherwise the line below it.
 */
export type AllowMarker = { readonly file: string; readonly id: string; readonly line: number; readonly covers: number };
/** A problem with the allowlist itself rather than with a call. */
export type AllowlistProblem = { readonly file: string; readonly line: number | null; readonly reason: string };

/**
 * The dated, reasoned exceptions. Each entry names a marker id that must sit
 * on (or directly above) the exempted call in that file — a new call in the
 * same file, wherever it lands, is NOT covered by someone else's entry,
 * because a marker covers only the call on its own line or the next one.
 */
export const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    file: 'src/fixtures/stubs.ts',
    marker: 'fake-canvas-abort-bookkeeping',
    date: '2026-09-08',
    reason:
      "the fake canvas's own bookkeeping listener on the CALLER's abort signal, registered with { once: true } so it self-unregisters the one time that signal can fire — passing `signal` here would mean the signal removing a listener on its own 'abort' event, which is circular. FakeCanvas is a per-test throwaway object besides.",
  },
];

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SIGNAL_RE = /\bsignal\b/;
const CALL_RE = /\.addEventListener\(/g;
const MARKER_RE = /\/\/\s*listener-policy:\s*allow\s+([A-Za-z0-9_-]+)/g;

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

/**
 * `source` with the contents of string and template literals blanked (quotes
 * and newlines kept) and comments left as they are, so a marker spelled inside
 * a string is not a marker.
 */
function blankStrings(source: string): string {
  let out = '';
  let inString: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (inString) {
      if (ch === '\\' && i + 1 < source.length) {
        out += source[i + 1] === '\n' ? ' \n' : '  ';
        i += 1;
      } else if (ch === inString) {
        inString = null;
        out += ch;
      } else out += ch === '\n' ? '\n' : ' ';
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
      out += source.slice(i, stop);
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

/**
 * Every `// listener-policy: allow <id>` marker in `rawSource`, read from the
 * raw text (the marker IS a comment, so the comment-stripped copy would not
 * have it).
 */
export function scanMarkers(file: string, rawSource: string): AllowMarker[] {
  const markers: AllowMarker[] = [];
  const source = blankStrings(rawSource);
  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(source))) {
    const line = lineAt(source, match.index);
    const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
    const trailing = source.slice(lineStart, match.index).trim() !== '';
    markers.push({ file, id: match[1] as string, line, covers: trailing ? line : line + 1 });
  }
  return markers;
}

/**
 * Splits raw violations into real ones and ones an allowlist entry covers,
 * through the marker on the call's line or the line above it (one marker
 * exempts one call: a second failing call on the covered line stays real and
 * is reported), and reports
 * every way the markers and the list disagree: a duplicated marker id in one
 * file, a marker with no entry, a marker on no failing call, and an entry
 * whose marker is missing. `scannedFiles` bounds that last check to the files
 * this run actually read, so a scan of a subdirectory does not call every
 * entry elsewhere stale.
 */
export function applyAllowlist(
  violations: readonly ListenerViolation[],
  markers: readonly AllowMarker[],
  scannedFiles: ReadonlySet<string>,
  allowlist: readonly AllowlistEntry[] = ALLOWLIST,
): {
  readonly real: ListenerViolation[];
  readonly allowlisted: AllowlistEntry[];
  readonly problems: AllowlistProblem[];
} {
  const real: ListenerViolation[] = [];
  const allowlisted: AllowlistEntry[] = [];
  const problems: AllowlistProblem[] = [];
  const used = new Set<AllowMarker>();
  const seen = new Map<string, AllowMarker>();
  for (const marker of markers) {
    const key = `${marker.file}\0${marker.id}`;
    const first = seen.get(key);
    if (first) {
      problems.push({
        file: marker.file,
        line: marker.line,
        reason: `allow marker "${marker.id}" repeats the one on line ${first.line}; a marker id is unique per file`,
      });
    } else seen.set(key, marker);
  }
  for (const violation of violations) {
    const marker = markers.find((candidate) => candidate.file === violation.file && candidate.covers === violation.line);
    if (marker && used.has(marker)) {
      problems.push({
        file: marker.file,
        line: marker.line,
        reason: `allow marker "${marker.id}" covers more than one addEventListener call without { signal }; one marker exempts one call`,
      });
      real.push(violation);
      continue;
    }
    const entry = marker && allowlist.find((candidate) => candidate.file === marker.file && candidate.marker === marker.id);
    if (marker) used.add(marker);
    if (entry) allowlisted.push(entry);
    else real.push(violation);
  }
  for (const marker of markers) {
    const entry = allowlist.find((candidate) => candidate.file === marker.file && candidate.marker === marker.id);
    if (!entry) {
      problems.push({ file: marker.file, line: marker.line, reason: `allow marker "${marker.id}" has no ALLOWLIST entry` });
    } else if (!used.has(marker)) {
      problems.push({
        file: marker.file,
        line: marker.line,
        reason: `allow marker "${marker.id}" sits on no addEventListener call without { signal }; remove it and its entry`,
      });
    }
  }
  for (const entry of allowlist) {
    if (!scannedFiles.has(entry.file)) continue;
    if (!markers.some((marker) => marker.file === entry.file && marker.id === entry.marker)) {
      problems.push({ file: entry.file, line: null, reason: `ALLOWLIST entry "${entry.marker}" has no allow marker in the file` });
    }
  }
  return { real, allowlisted, problems };
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
  const markers: AllowMarker[] = [];
  const scanned = new Set<string>();
  for (const file of files) {
    const relativePath = relative('.', file);
    const source = readFileSync(file, 'utf8');
    scanned.add(relativePath);
    violations.push(...scanSource(relativePath, source));
    markers.push(...scanMarkers(relativePath, source));
  }
  const { real, allowlisted, problems } = applyAllowlist(violations, markers, scanned);
  if (real.length > 0) {
    console.error('addEventListener without a { signal } reachable in one hop:');
    for (const violation of real) console.error(`  ${violation.file}:${violation.line} — ${violation.reason}`);
  }
  if (problems.length > 0) {
    console.error('listener-policy allowlist out of step with the allow markers:');
    for (const problem of problems) {
      console.error(`  ${problem.file}${problem.line === null ? '' : `:${problem.line}`} — ${problem.reason}`);
    }
  }
  if (real.length > 0 || problems.length > 0) process.exit(1);
  const allowlistNote =
    allowlisted.length > 0
      ? `, ${allowlisted.length} allowlisted (${allowlisted.map((entry) => `${entry.file} ${entry.marker}`).join(', ')})`
      : '';
  console.log(`Listener policy OK: 0 addEventListener without { signal } over ${root}${allowlistNote}`);
}
