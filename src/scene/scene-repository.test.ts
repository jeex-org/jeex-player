/**
 * Where a scene comes from, what happens when it comes from nowhere, and what
 * a fetch is allowed to bring back.
 *
 * The load-bearing property of the first half is that `resolveSceneSource`
 * THROWS rather than mounting the bundled apartment: a library that quietly
 * shows some other flat when the host forgot to name one is worse than a
 * library that says so.
 *
 * The second half is the trust boundary. A scene URL is host-supplied and an
 * embedded viewer can be pointed at any URL at all, so the timeout, the
 * redirect policy, the content type and the size cap are all part of the
 * contract, not defensive extras.
 */

import { describe, expect, test } from 'bun:test';
import { ProjectRepository } from './project-repository.js';
import {
  FetchSceneRepository,
  InlineSceneRepository,
  MAX_SCENE_BYTES,
  NO_SCENE_SOURCE,
  SCENE_ACCEPT_HEADER,
  resolveSceneSource,
} from './scene-repository.js';
import { ViewerLibError } from '../shared/errors.js';
import { VIEWER_VERSION } from '../shared/version.js';

/** A scene document's id: a fixed v7 literal generated once offline. */
const SCENE_ID = '01a12ff7-c21f-72c4-b572-2b5ed9f3ff24';

type FakeResponse = {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  /** The body, as one chunk or several; omitted means `{}`. */
  chunks?: string[];
  /** No readable stream at all, the way a minimal fake or an old runtime looks. */
  noBody?: boolean;
};

/** Runs `body` with `fetch` replaced, and always puts the real one back. */
async function withFetch(
  response: FakeResponse,
  body: (calls: Array<{ url: string; init?: RequestInit | undefined }>) => Promise<void>,
): Promise<void> {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const chunks = response.chunks ?? ['{}'];
    const text = chunks.join('');
    const contentType = response.contentType === undefined ? 'application/json' : response.contentType;
    let cancelled = false;
    let index = 0;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
      text: async () => text,
      get cancelled() {
        return cancelled;
      },
      body: response.noBody
        ? null
        : {
            getReader: () => ({
              read: async () => {
                const chunk = chunks[index];
                index += 1;
                return chunk === undefined ? { done: true, value: undefined } : { done: false, value: new TextEncoder().encode(chunk) };
              },
              cancel: async () => {
                cancelled = true;
              },
            }),
          },
    };
  }) as unknown as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = real;
  }
}

describe('resolveSceneSource', () => {
  test('a repository beats a document beats a url', async () => {
    const repository = new InlineSceneRepository({ from: 'repository' });
    expect(await resolveSceneSource({ repository, document: { from: 'document' }, url: '/a.json' }).load()).toEqual({ from: 'repository' });
    expect(await resolveSceneSource({ document: { from: 'document' }, url: '/a.json' }).load()).toEqual({ from: 'document' });
    // A `url` gets the PROJECT repository: it serves a bare scene identically
    // and is the only one of the two that can also open a baked project
    // (`project-repository.ts`). `FetchSceneRepository` stays a host's own
    // choice, passed as `scene.repository`.
    expect(resolveSceneSource({ url: '/a.json' })).toBeInstanceOf(ProjectRepository);
  });

  test('a document of `null` is still a document, not an absent one', async () => {
    // `undefined` means "not given"; `null` is a value the host handed over,
    // and the VALIDATOR is what rejects it — not this.
    expect(await resolveSceneSource({ document: null }).load()).toBeNull();
  });

  test('no source at all throws instead of mounting the demo apartment', () => {
    expect(() => resolveSceneSource(undefined)).toThrow(NO_SCENE_SOURCE);
    expect(() => resolveSceneSource({})).toThrow(NO_SCENE_SOURCE);
    expect(() => resolveSceneSource({ url: '' })).toThrow(NO_SCENE_SOURCE);
  });

  test('and what it throws is coded `no-scene-source`', () => {
    try {
      resolveSceneSource({});
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ViewerLibError);
      expect((error as ViewerLibError).code).toBe('no-scene-source');
    }
  });
});

describe('FetchSceneRepository', () => {
  test('parses a 2xx body and asks for the configured url', async () => {
    await withFetch({ chunks: [JSON.stringify({ id: SCENE_ID })] }, async (calls) => {
      expect(await new FetchSceneRepository('/scenes/flat-a.json').load()).toEqual({ id: SCENE_ID });
      expect(calls[0]?.url).toBe('/scenes/flat-a.json');
      // No credentials on an EMBEDDER-chosen url: the fetch must not turn the
      // viewer's origin into a credentialed read-proxy for a hostile host page
      // (`project-repository.test.ts` holds the same for the repository every
      // `scene.url` mount uses).
      expect(calls[0]?.init?.credentials).toBe('omit');
    });
  });

  test('a caller may still ask for credentials of its own', async () => {
    // The default is a default: a host that fetches a scene it trusts on the
    // viewer's own origin can ask for same-origin credentials explicitly.
    await withFetch({ chunks: ['{}'] }, async (calls) => {
      await new FetchSceneRepository('/a.json', { credentials: 'same-origin' }).load();
      expect(calls[0]?.init?.credentials).toBe('same-origin');
    });
  });

  test('a chunked body is reassembled, split mid-character or not', async () => {
    // The two bytes of "é" arrive in different chunks: a decoder that did not
    // stream would turn the split into a replacement character.
    const bytes = new TextEncoder().encode('{"name":"Café"}');
    const decoder = new TextDecoder();
    const first = decoder.decode(bytes.slice(0, 12), { stream: true });
    const rest = decoder.decode(bytes.slice(12));
    await withFetch({ chunks: [first, rest] }, async () => {
      expect(await new FetchSceneRepository('/a.json').load()).toEqual({ name: 'Café' });
    });
  });

  test('`ref` overrides the configured url, so one repository serves several scenes', async () => {
    await withFetch({}, async (calls) => {
      await new FetchSceneRepository('/a.json').load('/b.json');
      expect(calls[0]?.url).toBe('/b.json');
    });
  });

  test('a non-2xx rejects with the status AND the url, never with a parsed error page', async () => {
    await withFetch({ ok: false, status: 404 }, async () => {
      await expect(new FetchSceneRepository('/missing.json').load()).rejects.toThrow('404 /missing.json');
    });
  });

  test('a body that is not JSON is refused as what it is', async () => {
    await withFetch({ contentType: 'text/html; charset=utf-8', chunks: ['<!doctype html>'] }, async () => {
      const failure = new FetchSceneRepository('/login.html').load();
      await expect(failure).rejects.toThrow('expected application/json');
      await expect(failure).rejects.toThrow('/login.html');
    });
  });

  test('a JSON content type over a body that is not JSON is scene-load, and no byte of the body is in the message', async () => {
    // The engine's own SyntaxError quotes a stretch of the body; that sentence
    // would reach the embedder through the bridge.
    await withFetch({ chunks: ['SECRET-SESSION-TOKEN-4f2a {'] }, async () => {
      const failure = await new FetchSceneRepository('/a.json').load().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ViewerLibError);
      expect((failure as ViewerLibError).code).toBe('scene-load');
      expect((failure as ViewerLibError).message).toContain('/a.json');
      expect((failure as ViewerLibError).message).not.toContain('SECRET');
    });
  });

  test('a missing content type is refused too', async () => {
    await withFetch({ contentType: null }, async () => {
      await expect(new FetchSceneRepository('/a.json').load()).rejects.toThrow('expected application/json');
    });
  });

  test('a content type with parameters and odd case is accepted', async () => {
    await withFetch({ contentType: 'Application/JSON; charset=UTF-8', chunks: ['{"id":"x"}'] }, async () => {
      expect(await new FetchSceneRepository('/a.json').load()).toEqual({ id: 'x' });
    });
  });

  test('carries a timeout and refuses redirects', async () => {
    await withFetch({}, async (calls) => {
      await new FetchSceneRepository('/a.json').load();
      expect(calls[0]?.init?.redirect).toBe('error');
      expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  test('a caller may bring its own signal, but not its own redirect policy', async () => {
    const controller = new AbortController();
    await withFetch({}, async (calls) => {
      await new FetchSceneRepository('/a.json', { signal: controller.signal, redirect: 'follow' }).load();
      expect(calls[0]?.init?.signal).toBe(controller.signal);
      expect(calls[0]?.init?.redirect).toBe('error');
    });
  });

  test('a body over the cap is refused and the stream is cancelled', async () => {
    // Two chunks, the second of which crosses the limit: the cap is checked
    // per chunk off the STREAM, not against a Content-Length the server claims.
    const half = 'x'.repeat(MAX_SCENE_BYTES / 2 + 1);
    await withFetch({ chunks: [half, half] }, async () => {
      await expect(new FetchSceneRepository('/huge.json').load()).rejects.toThrow(`over ${MAX_SCENE_BYTES} bytes`);
    });
  });

  test('a body with no readable stream still parses', async () => {
    await withFetch({ noBody: true, chunks: ['{"id":"flat-b"}'] }, async () => {
      expect(await new FetchSceneRepository('/a.json').load()).toEqual({ id: 'flat-b' });
    });
  });

  test('every refusal is a scene-load error naming the status and the url', async () => {
    await withFetch({ ok: false, status: 404, chunks: [''] }, async () => {
      const failure = await new FetchSceneRepository('/missing.json').load().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ViewerLibError);
      expect((failure as ViewerLibError).code).toBe('scene-load');
      expect((failure as ViewerLibError).detail).toEqual({ status: 404, url: '/missing.json' });
    });
  });

  test('carries `Accept: application/json; jeex-viewer=<version>`, the exact string', async () => {
    await withFetch({}, async (calls) => {
      await new FetchSceneRepository('/a.json').load();
      const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
      expect(headers?.['Accept']).toBe(`application/json; jeex-viewer=${VIEWER_VERSION}`);
      expect(SCENE_ACCEPT_HEADER).toBe(`application/json; jeex-viewer=${VIEWER_VERSION}`);
    });
  });

  test('a caller-supplied `headers` replaces the default Accept, same as `credentials`', async () => {
    await withFetch({}, async (calls) => {
      await new FetchSceneRepository('/a.json', { headers: { Accept: 'text/plain' } }).load();
      const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
      expect(headers?.['Accept']).toBe('text/plain');
    });
  });
});

/**
 * The Fetch spec's own "CORS-unsafe request-header byte" list
 * (fetch.spec.whatwg.org/#cors-unsafe-request-header-byte, retrieved
 * 2026-09-08): control bytes below 0x20 other than HT (0x09), DEL (0x7F), and
 * the twelve punctuation bytes below. `/`, `;`, ` ` and `=` are NOT on this
 * list — a `token`-grammar check (RFC 7230) would wrongly reject them, but
 * `token` is not what decides whether a request needs a preflight; this byte
 * list is. Written as a character scan rather than a regex with literal
 * control-character escapes, which `no-control-regex` refuses outright.
 */
const CORS_UNSAFE_PUNCTUATION = new Set(['"', '(', ')', '<', '>', '?', '@', '[', '\\', ']', '{', '}']);
const DEL = 0x7f;
const SPACE = 0x20;
const HORIZONTAL_TAB = 0x09;

function hasCorsUnsafeByte(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === DEL) return true;
    if (code < SPACE && code !== HORIZONTAL_TAB) return true;
    if (CORS_UNSAFE_PUNCTUATION.has(char)) return true;
  }
  return false;
}

describe('SCENE_ACCEPT_HEADER', () => {
  test('is at most 128 bytes, the CORS-safelisted length cap', () => {
    expect(new TextEncoder().encode(SCENE_ACCEPT_HEADER).byteLength).toBeLessThanOrEqual(128);
  });

  test('contains no CORS-unsafe request-header byte, so the scene fetch never needs a preflight', () => {
    expect(hasCorsUnsafeByte(SCENE_ACCEPT_HEADER)).toBe(false);
  });

  test('the byte scan itself catches an unsafe value and passes a safe one (sanity check)', () => {
    expect(hasCorsUnsafeByte('application/json; jeex-viewer=<script>')).toBe(true); // `<`
    expect(hasCorsUnsafeByte('safe-value_123/;= ')).toBe(false);
    expect(hasCorsUnsafeByte('tab\tallowed')).toBe(false); // HT (0x09) is the one exception
  });
});
