/**
 * The library's one error type: every failure a host can see carries a machine
 * readable `code`, and — when the failure is about a document — the JSON `path`
 * of the field that caused it.
 *
 * Invariant: nothing in `src/` throws a bare `Error`. `errors.test.ts` walks
 * every non-test module and fails on a `throw new` that does not construct a
 * `ViewerLibError` or a subclass, so a host can write one `instanceof` and
 * switch on `code` instead of matching message prefixes. The two subclasses
 * that live elsewhere (`SceneValidationError` here, `PlanError` in
 * `plan/plan-graph.ts`, `OpError` in `scene/scene-ops.ts`) narrow the code and
 * add a field of their own; they never widen the contract.
 *
 * Lowest layer: this module imports nothing at all, so `plan/`, `scene/` and
 * `shared/` may all raise the same type without an upward edge.
 */

/**
 * Every way the viewer can fail in a way a host can act on.
 *
 * The protocol's `ErrorCode` (`embed/protocol.ts`) mirrors this union plus
 * `timeout`, which only exists across a frame boundary.
 */
export type ViewerErrorCode =
  /** The browser gave no WebGL context; the viewer shows its flat preview. */
  | 'webgl-unavailable'
  /** The scene source could not be read (a fetch failed, a repository threw). */
  | 'scene-load'
  /**
   * A URI inside a GLB (an `images[].uri`, a `buffers[].uri`) names a resource
   * the viewer will not fetch — outside the model's folder, or under a scheme
   * it does not speak (`geometry/model-source.ts`, `resolveModelResource`).
   *
   * Its own code rather than `scene-load` because the container itself was
   * fine: what was refused is what the container ASKED FOR, which a host wants
   * to tell apart from a broken bake.
   */
  | 'model-external-resource'
  /** The document was read but is not a valid scene (`scene-validator.ts`). */
  | 'scene-invalid'
  /**
   * The document was read and says it is a baked project, but is not a valid
   * one (`assets/project-manifest.schema.ts`).
   *
   * Its own code rather than `scene-invalid` because the two say different
   * things to a host: a bad SCENE is a document an editor wrote, a bad PROJECT
   * is a whole folder — the manifest, the library it names and the files it
   * points at — and the two are fixed by different people in different places.
   */
  | 'project-invalid'
  /** No scene source was named at all: no `url`, no `document`, no repository. */
  | 'no-scene-source'
  /** A caller handed the viewer an argument it cannot use. */
  | 'bad-params'
  /** The viewer is not up yet; the command needs a mounted scene. */
  | 'not-ready'
  /** The viewer has been disposed; its handle no longer drives anything. */
  | 'disposed'
  /**
   * The WebGL context was taken away (a driver reset, a backgrounded tab, one
   * context too many on the page). The viewer stops drawing and rebuilds itself
   * when the browser gives the context back; a host that never sees a later
   * `ready` may offer its own reload.
   */
  | 'context-lost'
  /** Anything the viewer itself got wrong; the message says what. */
  | 'internal';

/** Structured context on a failure; always plain, always cloneable. */
export type ErrorDetail = Readonly<Record<string, unknown>>;

/** What a `ViewerLibError` may be told beyond its code and message. */
export type ViewerLibErrorOptions = ErrorOptions & {
  /** JSON path of the offending field: `walls[3].openings[1].head`. */
  path?: string | undefined;
  /** Anything else worth reporting: a status, a URL, an operation name. */
  detail?: ErrorDetail | undefined;
};

/**
 * The base class of every error this library raises.
 *
 * `cause` goes through `ErrorOptions`, so a wrapped failure keeps its original
 * for a host's logger without the message being pasted twice.
 */
export class ViewerLibError extends Error {
  readonly code: ViewerErrorCode;
  readonly path?: string | undefined;
  readonly detail?: ErrorDetail | undefined;

  constructor(code: ViewerErrorCode, message: string, options?: ViewerLibErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ViewerLibError';
    this.code = code;
    this.path = options?.path;
    this.detail = options?.detail;
  }
}

/** A run of non-space characters longer than this is cut to `DOCUMENT_ECHO_PREFIX` characters and `…`. */
export const DOCUMENT_TOKEN_LIMIT = 48;
/** How much of a long document string survives in a refusal. */
export const DOCUMENT_ECHO_PREFIX = 32;
/** The longest refusal sentence about a document, in characters. */
export const DOCUMENT_MESSAGE_LIMIT = 300;

const URL_LIKE = /\b[a-z][a-z0-9+-]*:\/\/[^\s"'`)]*|\b(?:data|blob|javascript|file|mailto):[^\s"'`)]*|(?<![\w:])\/\/[^\s"'`)]+/gi;
const LONG_TOKEN = new RegExp(`\\S{${DOCUMENT_TOKEN_LIMIT + 1},}`, 'g');
// C0/C1 controls (a forged log line, an ANSI escape) and the bidi overrides
// and isolates (text that reads other than it is stored).
const CONTROL = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

/** The first `limit` UTF-16 units of `text`, never ending on half a surrogate pair. */
function cut(text: string, limit: number): string {
  const head = text.slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

/**
 * A refusal's text with what a DOCUMENT put into it bounded: every control
 * character (line breaks and escapes included) and bidi override becomes a
 * space, every URL-like run becomes `<url>`, every run of more than
 * `DOCUMENT_TOKEN_LIMIT` non-space characters keeps a
 * `DOCUMENT_ECHO_PREFIX`-character prefix, and the whole is capped at
 * `DOCUMENT_MESSAGE_LIMIT` — no cut splits a surrogate pair.
 *
 * Why: a scene or a manifest can be fetched from an address the EMBEDDER chose
 * (`?scene=`, `loadScene({ url })`), and a refusal's sentence travels back to
 * that embedder through the frame bridge. A validator that quoted the value it
 * refused — an id, a room reference, a key — would hand the embedder whatever
 * the fetched document held. The machine-readable half (`code`, `rule`, the
 * structure of `path`) is untouched; the author's own words are short and URL-free, so only document text is cut.
 */
export function boundDocumentText(text: string): string {
  const bounded = text
    .replaceAll(CONTROL, ' ')
    .replaceAll(URL_LIKE, '<url>')
    .replaceAll(LONG_TOKEN, (token) => `${cut(token, DOCUMENT_ECHO_PREFIX)}…`);
  return bounded.length > DOCUMENT_MESSAGE_LIMIT ? `${cut(bounded, DOCUMENT_MESSAGE_LIMIT - 1)}…` : bounded;
}

/**
 * `detail` of a refusal about a document, bounded the same way: every string
 * (keys included) through `boundDocumentText`, at most ten entries per array,
 * twenty keys per object and four levels deep. Numbers, booleans and `null`
 * pass unchanged — they carry no text.
 */
export function boundDocumentDetail(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return boundDocumentText(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 10).map((entry: unknown) => boundDocumentDetail(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, entry]) => [boundDocumentText(key), boundDocumentDetail(entry, depth + 1)]),
  );
}

/** `options` of a refusal about a document, with `path` and `detail` bounded. */
export function boundDocumentOptions(options: ViewerLibErrorOptions | undefined): ViewerLibErrorOptions | undefined {
  if (options === undefined) return undefined;
  const bounded: ViewerLibErrorOptions = { ...options };
  if (options.path !== undefined) bounded.path = boundDocumentText(options.path);
  if (options.detail !== undefined) bounded.detail = boundDocumentDetail(options.detail) as ErrorDetail;
  return bounded;
}

/**
 * A document that was read but does not satisfy the scene schema (2.2).
 *
 * Its message, `path` and `detail` are bounded (`boundDocumentText`): the
 * validator names what it refused, and the refused value came from a document.
 *
 * `rule` is the kebab-case id of the check that refused it — stable across
 * message rewordings, which is what a host's own error table keys on.
 */
export class SceneValidationError extends ViewerLibError {
  declare readonly code: 'scene-invalid';
  readonly rule: string;

  constructor(rule: string, message: string, options?: ViewerLibErrorOptions) {
    super('scene-invalid', boundDocumentText(message), boundDocumentOptions(options));
    this.name = 'SceneValidationError';
    this.rule = rule;
  }
}

/** True when `value` is one of this library's errors. */
export function isViewerLibError(value: unknown): value is ViewerLibError {
  return value instanceof ViewerLibError;
}
