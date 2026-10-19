/**
 * The vocabulary a schema refusal is translated INTO: this project's JSON
 * paths, its capped detail objects and its one error type.
 *
 * Invariant: this module imports no Zod, in any spelling. It works on the
 * structural shape a `z.core.$ZodIssue` already has — a path, a sentence and
 * the validator's own code — because the vocabulary of a REFUSAL belongs to the
 * library that refuses, not to the parser that noticed. Two consequences worth
 * the constraint: every bundle that reads errors (`embed/host.ts` at 4 KB gzip
 * included) can use this without paying 4.4 KB for a parser it never calls, and
 * a hand-written check can raise the same shape as a schema.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError, boundDocumentOptions, boundDocumentText } from './errors.js';

/**
 * One issue as a schema reports it. Structurally what `z.core.$ZodIssue`
 * already is, which is why nothing here imports Zod.
 */
export type SchemaIssue = {
  readonly path: readonly (string | number)[];
  readonly message: string;
  /** The validator's own code (`invalid_type`, `too_small`, …); diagnostics only, never a public contract. */
  readonly code?: string;
};

/** Cap on how many issues an error object carries: a hostile document must not make one unbounded. */
export const MAX_REPORTED_ISSUES = 10;

/**
 * The JSON path in this project's spelling: `walls[3].openings[1].head`, and
 * `''` at the root. It is the same spelling `SceneValidationError.path` has
 * published since schema 1.1 (`units`, `storey.elevation`), so a host's error
 * table keeps working whichever side produced the refusal.
 */
export function issuePath(issue: SchemaIssue): string {
  let path = '';
  for (const step of issue.path) {
    if (typeof step === 'number') path += `[${step}]`;
    else path += path.length === 0 ? step : `.${step}`;
  }
  return path;
}

/** The issue a refusal speaks for: the first in schema-declaration order, so one bad document gives one stable answer. */
export function firstIssue(issues: readonly SchemaIssue[]): SchemaIssue | undefined {
  return issues[0];
}

/** Every issue as `{ path, message }` for `ViewerLibError.detail`, capped, with the true `total` alongside. */
export function issueDetail(issues: readonly SchemaIssue[]): {
  readonly issues: readonly { readonly path: string; readonly message: string }[];
  readonly total: number;
} {
  return {
    issues: issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({ path: issuePath(issue), message: issue.message })),
    total: issues.length,
  };
}

/**
 * `ViewerLibError('bad-params')` from a failed shape check: `what` names the
 * seam (`importScene`, `normalisePlan`, `seek`), `path` is the first issue's
 * field, `detail` carries the capped list. The sentence is
 * `<what>: <path> <message>` — never a pasted issue tree.
 *
 * An EMPTY list is the caller's own bug rather than the document's: nothing was
 * found wrong, so the error says `internal` and names the seam that asked. It
 * still returns an error rather than throwing — an error factory that throws
 * turns a mistake in a rare branch into a crash somewhere unrelated.
 */
export function badParams(what: string, issues: readonly SchemaIssue[]): ViewerLibError {
  return schemaRefusal('bad-params', what, issues);
}

/**
 * The same refusal under a chosen `code`, for a seam whose failures are not
 * about a caller's ARGUMENTS: `scene/scene-parse.ts` judges a document and an
 * op batch, and a malformed document is `scene-invalid` everywhere else in the
 * library, so it is `scene-invalid` there too;
 * `assets/project-manifest.schema.ts` judges a bake and says `project-invalid`
 * for the same reason.
 */
export function schemaRefusal(
  code: 'bad-params' | 'scene-invalid' | 'project-invalid',
  what: string,
  issues: readonly SchemaIssue[],
): ViewerLibError {
  const detail = issueDetail(issues);
  const first = firstIssue(issues);
  if (!first) {
    return new ViewerLibError('internal', `${what}: refused a value without saying what was wrong with it`, { path: '', detail });
  }
  const path = issuePath(first);
  const sentence = path.length === 0 ? `${what}: ${first.message}` : `${what}: ${path} ${first.message}`;
  // A DOCUMENT's refusal is bounded (`boundDocumentText`): its paths and the
  // schema's sentences can name keys the document chose. A caller's own
  // arguments (`bad-params`) come back as the caller wrote them.
  if (code === 'bad-params') return new ViewerLibError(code, sentence, { path, detail });
  return new ViewerLibError(code, boundDocumentText(sentence), boundDocumentOptions({ path, detail }));
}
