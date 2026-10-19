/**
 * What a scene source IS, and the one guarded JSON fetch every URL-shaped
 * source performs.
 *
 * Split out of `scene-repository.ts` rather than left in it because
 * `resolveSceneSource` CONSTRUCTS `ProjectRepository`: an edge back the other
 * way — a type-only one included, since `.dependency-cruiser.cjs` cruises with
 * `tsPreCompilationDeps` — would be a cycle, and `no-circular` is an error
 * there. Nothing in this module knows about any concrete repository, so both
 * `FetchSceneRepository` and `ProjectRepository` can sit above it.
 *
 * Invariant: `fetchJsonCapped` is the ONE place a scene-shaped document is
 * fetched. The timeout, `redirect: 'error'`, the content-type check, the
 * streamed size cap and the credential default are the trust boundary of a
 * HOST-supplied URL, and a second copy of them is a second place for one of the
 * five to be forgotten.
 *
 * Pure module: no `three`, no DOM elements (`fetch` is a global, not a node).
 */

import { ViewerLibError } from '../shared/errors.js';
import { VIEWER_VERSION } from '../shared/version.js';

export interface SceneRepository {
  /** Loads a scene document. `ref` names one when the source holds several. */
  load(ref?: string): Promise<unknown>;
}

/**
 * A project manifest a host already holds, plus the folder its relative paths
 * (`scene`, `objects[].model`, previews) resolve against.
 *
 * `baseUrl` ends with `/`: it is a FOLDER, and `new URL(relative, baseUrl)`
 * only means "inside the project" when it does.
 */
export type InlineLibrary = {
  /** The manifest, unjudged. `assets/project-manifest.schema.ts` is the judge. */
  readonly manifest: unknown;
  /** Absolute URL of the folder the manifest was served from, trailing slash included. */
  readonly baseUrl: string;
};

/**
 * How a host names the scene it wants. Exactly one of the three; when more than
 * one is given the most specific wins (`resolveSceneSource`).
 */
export type SceneSource = {
  /** Fetched over HTTP and parsed as JSON: a baked project, or a bare scene. */
  url?: string | undefined;
  /** A document the host already holds, in memory. */
  document?: unknown;
  /** The host's own loader, for anything the other two cannot express. */
  repository?: SceneRepository;
  /**
   * The project library that goes with an in-memory `document` — for a host
   * (an editor host) that already holds both and would otherwise have to serve the
   * manifest back to itself over HTTP just to be read again.
   *
   * Ignored when the scene comes from a `url`: a fetched project carries its
   * own manifest, and the fetched one wins over a stale copy in the host.
   */
  library?: InlineLibrary | undefined;
};

/** How long a scene fetch may take before it is a failure, milliseconds. */
export const SCENE_FETCH_TIMEOUT_MS = 15_000;

/** The content type a scene document must be served as. */
const SCENE_CONTENT_TYPE = 'application/json';

/**
 * `Accept` sent on every scene fetch, carrying the library's own version so a
 * server can log or branch on it without a second round trip
 * (habr.com/ru/articles/1078548). It is a CORS-SAFELISTED value on purpose —
 * `scene-repository.test.ts` proves it against the Fetch spec's own
 * "CORS-unsafe request-header byte" list — so this never turns a same-origin-
 * looking scene fetch into one that needs a preflight `OPTIONS` a host's
 * static file server was never asked to answer.
 */
export const SCENE_ACCEPT_HEADER = `application/json; jeex-viewer=${VIEWER_VERSION}`;

/** A parsed JSON document and the size of the body it was parsed from, in bytes. */
export type CappedJson = {
  /** `unknown` on purpose: `SceneModel.load` is the one validator. */
  readonly value: unknown;
  /** What was actually read off the wire — the number a per-document limit is judged against. */
  readonly bytes: number;
};

/**
 * Fetches one JSON document with every limit a host-supplied URL needs:
 *
 * - a **timeout**, so a URL that never answers cannot stall the mount forever;
 * - `redirect: 'error'`, so a document cannot be quietly served from somewhere
 *   else — and never overridable, unlike the timeout;
 * - a **content type** check, so an HTML error page is refused as what it is
 *   instead of failing validation later with a message about the wrong thing;
 * - a **size cap** read off the stream, so a body with no `Content-Length` (or
 *   a lying one) cannot be poured into memory.
 * - **no credentials**, so the viewer's origin cannot be turned into a
 *   credentialed read-proxy on a URL the EMBEDDER chose (`?scene=`,
 *   `loadScene({ url })`): a hostile host page must not be able to point the
 *   frame at a session-authorised same-origin resource and read it back
 *   through the bridge.
 *
 * Every failure is a `ViewerLibError` with code `scene-load` and a `detail` that
 * names the status and the URL, because those are the two things a host looks at
 * first — machine readable, not parsed back out of the sentence.
 *
 * `bytes` comes back with the value so a CALLER can apply a tighter limit of
 * its own to a document it only recognises after reading it — a project
 * manifest is one, and it cannot be told apart from a bare scene before the
 * body is in hand.
 */
export async function fetchJsonCapped(url: string, init: RequestInit | undefined, limit: number): Promise<CappedJson> {
  const response = await fetch(url, {
    // The default, not a request the caller made: a caller override still wins
    // (the spread is below) — a host that constructs its own repository for a
    // trusted, cookie-guarded scene passes `credentials: 'same-origin'` itself.
    credentials: 'omit',
    headers: { Accept: SCENE_ACCEPT_HEADER },
    ...init,
    // After the spread on purpose: a caller may replace the timeout with a
    // signal of its own, but not the redirect policy.
    signal: init?.signal ?? AbortSignal.timeout(SCENE_FETCH_TIMEOUT_MS),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new ViewerLibError('scene-load', `Scene fetch failed: ${response.status} ${url}`, {
      detail: { status: response.status, url },
    });
  }
  const type = response.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes(SCENE_CONTENT_TYPE)) {
    throw new ViewerLibError(
      'scene-load',
      `Scene fetch failed: expected ${SCENE_CONTENT_TYPE}, got "${type}" (${response.status} ${url})`,
      {
        detail: { status: response.status, url, contentType: type },
      },
    );
  }
  const read = await readCapped(response, url, limit);
  let value: unknown;
  try {
    value = JSON.parse(read.text);
  } catch (cause) {
    // The engine's own `SyntaxError` quotes a stretch of the body ("… is not
    // valid JSON"), and a refusal's sentence reaches the embedder through the
    // bridge: the body of a URL the embedder chose must not come back that way.
    // The sentence names the url, which the host supplied; the engine's message
    // stays on `cause`, in the frame.
    throw new ViewerLibError('scene-load', `Scene fetch failed: the body is not JSON (${response.status} ${url})`, {
      detail: { status: response.status, url },
      cause,
    });
  }
  return { value, bytes: read.bytes };
}

/**
 * The response body as text, refusing anything over `limit`.
 *
 * Read off the STREAM rather than trusted from `Content-Length`: a chunked
 * response carries no length, and a length header is the server's claim about
 * a body it has not sent yet. A body with no readable stream at all (a test
 * fake, an environment without one) falls back to `text()`, which is honest
 * about what it can promise: nothing was streamed, so nothing was capped.
 */
async function readCapped(response: Response, url: string, limit: number): Promise<{ text: string; bytes: number }> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    return { text, bytes: new TextEncoder().encode(text).byteLength };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ViewerLibError('scene-load', `Scene fetch failed: body over ${limit} bytes (${response.status} ${url})`, {
        detail: { status: response.status, url, limit },
      });
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), bytes: total };
}
