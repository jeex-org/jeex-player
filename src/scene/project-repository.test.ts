/**
 * One URL, two shapes. `scene.url` may name a baked project or a bare scene,
 * and the whole point of `ProjectRepository` is that a host never has to say
 * which — so the tests below are mostly about the SEAM between the two: what
 * decides, what the second request looks like, and what a manifest is not
 * allowed to talk the viewer into fetching.
 *
 * The containment tests are the security ones. A manifest is untrusted data
 * and `scene` is a path out of it, so `../`, a leading `/` and a full
 * `https://…` all have to be refused — by the resolved URL, not by a substring
 * hunt for two dots.
 */

import { describe, expect, test } from 'bun:test';
import { ProjectRepository } from './project-repository.js';
import { ViewerLibError } from '../shared/errors.js';
import { MAX_MODEL_BYTES, MAX_MODEL_PARALLEL, MAX_PROJECT_BYTES, MAX_PROJECT_MANIFEST_BYTES, MAX_SCENE_BYTES } from '../shared/limits.js';

/** The project these manifests describe, and its scene: fixed v7 literals generated once offline. */
const PROJECT_ID = '01a12ff7-c21d-7184-be02-82891d18d91e';
const SCENE_ID = '01a12ff7-c21e-76c6-a597-d03c5445ee27';

const FOLDER = 'https://cdn.example/projects/flat-a/';
const MANIFEST_URL = `${FOLDER}project.json`;

type Route = { body: string; contentType?: string | null; ok?: boolean; status?: number };
type Call = { url: string; init?: RequestInit | undefined };

/**
 * Runs `body` with `fetch` answering from a URL → response table, and always
 * puts the real one back. A URL the table does not name is a 404, which is how
 * a mistyped second request shows up as a failure rather than as a pass.
 */
async function withRoutes(routes: Record<string, Route>, body: (calls: Call[]) => Promise<void>): Promise<void> {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return response({ body: 'missing', ok: false, status: 404 });
    return response(route);
  }) as unknown as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = real;
  }
}

function response(route: Route): unknown {
  const chunks = [route.body];
  const contentType = route.contentType === undefined ? 'application/json' : route.contentType;
  let index = 0;
  return {
    ok: route.ok ?? true,
    status: route.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => route.body,
    body: {
      getReader: () => ({
        read: async () => {
          const chunk = chunks[index];
          index += 1;
          return chunk === undefined ? { done: true, value: undefined } : { done: false, value: new TextEncoder().encode(chunk) };
        },
        cancel: async () => undefined,
      }),
    },
  };
}

/** A manifest with `scene` pointing wherever the test needs it to. */
function manifest(scene: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: 'jeex-project', formatVersion: 2, projectId: PROJECT_ID, scene, ...extra });
}

async function refusalOf(promise: Promise<unknown>): Promise<ViewerLibError> {
  const failure = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ViewerLibError);
  return failure as ViewerLibError;
}

describe('ProjectRepository, on a bare scene', () => {
  test('returns the document itself and reports no project', async () => {
    await withRoutes({ '/scenes/flat.json': { body: JSON.stringify({ schemaVersion: '2.0', id: SCENE_ID }) } }, async (calls) => {
      const repository = new ProjectRepository('/scenes/flat.json');
      expect(repository.project()).toBeNull();
      expect(await repository.load()).toEqual({ schemaVersion: '2.0', id: SCENE_ID });
      expect(repository.project()).toBeNull();
      expect(calls).toHaveLength(1);
    });
  });

  test('the first request carries no credentials: its url is the embedder’s choice', async () => {
    // Every `scene.url` mount goes through this repository
    // (`resolveSceneSource`), and for a bare scene this is the only request —
    // so this is where the viewer's origin either is or is not a credentialed
    // read-proxy for a hostile host page.
    await withRoutes({ '/a.json': { body: '{}' } }, async (calls) => {
      await new ProjectRepository('/a.json').load();
      expect(calls[0]?.init?.credentials).toBe('omit');
      expect(calls[0]?.init?.redirect).toBe('error');
      expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  test('a document that merely has a `format` of its own is still a scene', async () => {
    await withRoutes({ '/a.json': { body: '{"format":"something-else","scene":"nope.json"}' } }, async (calls) => {
      const repository = new ProjectRepository('/a.json');
      expect(await repository.load()).toEqual({ format: 'something-else', scene: 'nope.json' });
      expect(repository.project()).toBeNull();
      expect(calls).toHaveLength(1);
    });
  });

  test('a bare scene may be as large as a scene is allowed to be', async () => {
    const big = `{"pad":"${'x'.repeat(MAX_PROJECT_MANIFEST_BYTES + 16)}"}`;
    await withRoutes({ '/a.json': { body: big } }, async () => {
      expect(await new ProjectRepository('/a.json').load()).toHaveProperty('pad');
    });
  });
});

describe('ProjectRepository, on a baked project', () => {
  test('fetches the manifest, then its scene, and reports both halves', async () => {
    const scene = { schemaVersion: '2.0', id: SCENE_ID, assetLibrary: PROJECT_ID };
    await withRoutes(
      {
        [MANIFEST_URL]: { body: manifest('scene.json') },
        [`${FOLDER}scene.json`]: { body: JSON.stringify(scene) },
      },
      async (calls) => {
        const repository = new ProjectRepository(MANIFEST_URL);
        expect(await repository.load()).toEqual(scene);
        expect(calls.map((call) => call.url)).toEqual([MANIFEST_URL, `${FOLDER}scene.json`]);
        const loaded = repository.project();
        expect(loaded?.baseUrl).toBe(FOLDER);
        // The manifest is handed on UNJUDGED and unchanged: the schema one
        // layer up is the judge, and it has to see what the server sent.
        expect(loaded?.manifest).toEqual(JSON.parse(manifest('scene.json')) as unknown);
      },
    );
  });

  test('the project’s own scene request omits credentials', async () => {
    await withRoutes({ [MANIFEST_URL]: { body: manifest('scene.json') }, [`${FOLDER}scene.json`]: { body: '{}' } }, async (calls) => {
      await new ProjectRepository(MANIFEST_URL).load();
      expect(calls[0]?.init?.credentials).toBe('omit');
      expect(calls[1]?.init?.credentials).toBe('omit');
      expect(calls[1]?.init?.redirect).toBe('error');
    });
  });

  test('a caller that constructs the repository itself may ask for credentials on both requests', async () => {
    await withRoutes({ [MANIFEST_URL]: { body: manifest('scene.json') }, [`${FOLDER}scene.json`]: { body: '{}' } }, async (calls) => {
      await new ProjectRepository(MANIFEST_URL, { credentials: 'same-origin' }).load();
      expect(calls.map((call) => call.init?.credentials)).toEqual(['same-origin', 'same-origin']);
    });
  });

  test('a scene in a subfolder resolves against the manifest folder', async () => {
    await withRoutes(
      { [MANIFEST_URL]: { body: manifest('./bake/scene.json') }, [`${FOLDER}bake/scene.json`]: { body: '{"id":"deep"}' } },
      async (calls) => {
        expect(await new ProjectRepository(MANIFEST_URL).load()).toEqual({ id: 'deep' });
        expect(calls[1]?.url).toBe(`${FOLDER}bake/scene.json`);
      },
    );
  });

  test('a relative manifest url still yields an absolute project folder', async () => {
    // No `location` under `bun:test`; the folder is still a comparable URL,
    // which is all containment needs.
    await withRoutes({ '/fixtures/project/project.json': { body: manifest('scene.json') } }, async (calls) => {
      const repository = new ProjectRepository('/fixtures/project/project.json');
      await repository.load().catch(() => undefined);
      expect(calls[1]?.url.endsWith('/fixtures/project/scene.json')).toBe(true);
      expect(repository.project()).toBeNull(); // the scene 404s: nothing is reported
    });
  });

  test('`ref` opens a different project, and `project()` follows it', async () => {
    const other = 'https://cdn.example/projects/flat-b/project.json';
    await withRoutes(
      {
        [other]: { body: manifest('scene.json') },
        'https://cdn.example/projects/flat-b/scene.json': { body: '{"id":"b"}' },
      },
      async () => {
        const repository = new ProjectRepository(MANIFEST_URL);
        expect(await repository.load(other)).toEqual({ id: 'b' });
        expect(repository.project()?.baseUrl).toBe('https://cdn.example/projects/flat-b/');
      },
    );
  });

  test('a failed scene fetch leaves no project behind', async () => {
    await withRoutes({ [MANIFEST_URL]: { body: manifest('scene.json') } }, async () => {
      const repository = new ProjectRepository(MANIFEST_URL);
      await expect(repository.load()).rejects.toThrow('404');
      expect(repository.project()).toBeNull();
    });
  });
});

describe('ProjectRepository refuses', () => {
  test('a manifest over the manifest cap, even though a scene that size is fine', async () => {
    const pad = 'x'.repeat(MAX_PROJECT_MANIFEST_BYTES);
    await withRoutes({ [MANIFEST_URL]: { body: manifest('scene.json', { pad }) } }, async (calls) => {
      const failure = await refusalOf(new ProjectRepository(MANIFEST_URL).load());
      expect(failure.code).toBe('scene-load');
      expect(failure.message).toContain(`over ${MAX_PROJECT_MANIFEST_BYTES} bytes`);
      expect(failure.detail).toMatchObject({ url: MANIFEST_URL, limit: MAX_PROJECT_MANIFEST_BYTES });
      // Refused before the scene was asked for.
      expect(calls).toHaveLength(1);
    });
  });

  test.each([
    ['a parent folder', '../flat-b/scene.json'],
    ['a sibling that merely shares a prefix', '../flat-a-evil/scene.json'],
    ['the site root', '/scene.json'],
    ['another origin', 'https://evil.example/scene.json'],
    ['a protocol-relative host', '//evil.example/scene.json'],
  ])('a scene path that escapes the project folder: %s', async (_name, path) => {
    await withRoutes({ [MANIFEST_URL]: { body: manifest(path) } }, async (calls) => {
      const failure = await refusalOf(new ProjectRepository(MANIFEST_URL).load());
      expect(failure.code).toBe('project-invalid');
      expect(failure.path).toBe('scene');
      expect(failure.detail).toMatchObject({ url: MANIFEST_URL, baseUrl: FOLDER });
      expect(calls).toHaveLength(1);
    });
  });

  test('the refusal message does not echo the path the manifest named', async () => {
    // The message travels to the host page through the bridge's `messageOf`, so
    // a document-derived string in it is an echo channel out of the viewer's
    // origin. The path stays where the host can read it deliberately — in
    // `detail.scene`, which is not forwarded.
    const escape = 'https://secret.example/sessions.json';
    await withRoutes({ [MANIFEST_URL]: { body: manifest(escape) } }, async () => {
      const failure = await refusalOf(new ProjectRepository(MANIFEST_URL).load());
      expect(failure.message).toContain('outside the project folder');
      expect(failure.message).toContain(MANIFEST_URL);
      expect(failure.message).not.toContain(escape);
      expect(failure.detail).toMatchObject({ scene: escape });
    });
  });

  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['not a string', 42],
  ])('a manifest whose scene path is %s', async (_name, path) => {
    await withRoutes({ [MANIFEST_URL]: { body: manifest(path) } }, async () => {
      const failure = await refusalOf(new ProjectRepository(MANIFEST_URL).load());
      expect(failure.code).toBe('project-invalid');
      expect(failure.message).toContain('names no scene');
    });
  });
});

describe('ProjectRepository reuses the scene fetch, it does not copy it', () => {
  test('an HTML error page is refused as what it is, on either request', async () => {
    await withRoutes({ [MANIFEST_URL]: { body: '<!doctype html>', contentType: 'text/html; charset=utf-8' } }, async () => {
      await expect(new ProjectRepository(MANIFEST_URL).load()).rejects.toThrow('expected application/json');
    });
    await withRoutes(
      {
        [MANIFEST_URL]: { body: manifest('scene.json') },
        [`${FOLDER}scene.json`]: { body: '<!doctype html>', contentType: 'text/html' },
      },
      async () => {
        const failure = await refusalOf(new ProjectRepository(MANIFEST_URL).load());
        expect(failure.code).toBe('scene-load');
        expect(failure.message).toContain(`${FOLDER}scene.json`);
      },
    );
  });

  test('redirects are refused and a caller’s own signal is honoured on both requests', async () => {
    const controller = new AbortController();
    await withRoutes({ [MANIFEST_URL]: { body: manifest('scene.json') }, [`${FOLDER}scene.json`]: { body: '{}' } }, async (calls) => {
      await new ProjectRepository(MANIFEST_URL, { signal: controller.signal, redirect: 'follow' }).load();
      for (const call of calls) {
        expect(call.init?.redirect).toBe('error');
        expect(call.init?.signal).toBe(controller.signal);
      }
    });
  });

  test('a project scene over the scene cap is refused by the same streamed check', async () => {
    const huge = `{"pad":"${'x'.repeat(MAX_SCENE_BYTES)}"}`;
    await withRoutes({ [MANIFEST_URL]: { body: manifest('scene.json') }, [`${FOLDER}scene.json`]: { body: huge } }, async () => {
      await expect(new ProjectRepository(MANIFEST_URL).load()).rejects.toThrow(`over ${MAX_SCENE_BYTES} bytes`);
    });
  });
});

describe('the project limits', () => {
  test('are the documented project limits', () => {
    expect({
      manifest: MAX_PROJECT_MANIFEST_BYTES,
      model: MAX_MODEL_BYTES,
      project: MAX_PROJECT_BYTES,
      parallel: MAX_MODEL_PARALLEL,
      scene: MAX_SCENE_BYTES,
    }).toEqual({
      manifest: 1024 * 1024,
      model: 16 * 1024 * 1024,
      project: 96 * 1024 * 1024,
      parallel: 4,
      // Unchanged on purpose: the documented figure is 4 MB, the viewer has
      // shipped 8 MB, and a limit is not lowered without a measurement.
      scene: 8 * 1024 * 1024,
    });
  });
});
