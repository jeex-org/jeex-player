/**
 * `offers`: an extra library in the project-library format, given by URL or
 * inline, loaded BEFORE the document is validated, and refused with a
 * warning (never a failed mount) when it is not a library this viewer reads.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOffers } from './offers.js';
import { loadDocument } from '../app/project-wiring.js';
import { InlineSceneRepository } from '../scene/scene-repository.js';
import type { Logger } from '../shared/logger.js';
import { OFFERS_FIXTURE as OFFERS } from '../../tests/fixtures/offers/fixture-ids.js';
import { PROJECT_FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';

const OFFERS_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'offers');
const PROJECT_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project');
const read = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
const OFFERS_URL = 'https://cdn.example.com/catalogue/v3/offers.json';

type Warning = { code: string; message: string };

function recordingLog(): Logger & { warnings: Warning[] } {
  const warnings: Warning[] = [];
  return {
    warnings,
    warn: (code, message) => void warnings.push({ code, message }),
    error: (code, message) => void warnings.push({ code, message }),
  };
}

const realFetch = globalThis.fetch;
const fetched: { url: string; init: RequestInit | undefined }[] = [];

/** Serves `body` as JSON for every request and records what was asked. */
function serve(body: unknown, status = 200): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    fetched.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  fetched.length = 0;
});

describe('loadOffers', () => {
  test('nothing given, nothing loaded', async () => {
    expect(await loadOffers(undefined, recordingLog())).toBeNull();
    expect(await loadOffers({}, recordingLog())).toBeNull();
  });

  test('the URL form fetches without credentials and takes the file folder as its base', async () => {
    serve(read(OFFERS_DIR, 'library.json'));
    const log = recordingLog();
    const loaded = await loadOffers({ url: OFFERS_URL }, log);
    expect(loaded?.library.id).toBe(OFFERS.library);
    expect(loaded?.baseUrl).toBe('https://cdn.example.com/catalogue/v3/');
    expect(fetched[0]?.init?.credentials).toBe('omit');
    expect(log.warnings).toEqual([]);
  });

  test('the inline form is judged by the same schema', async () => {
    const loaded = await loadOffers({ library: read(OFFERS_DIR, 'library.json'), baseUrl: 'https://cdn.example.com/x/' }, recordingLog());
    expect(loaded?.library.objects.map((object) => object.id)).toContain(OFFERS.asset.longSofa);
    expect(loaded?.baseUrl).toBe('https://cdn.example.com/x/');
  });

  test('an invalid file is a warning and no offers, never a throw', async () => {
    serve({ manifestVersion: '1.0', id: 'not-a-uuid', objects: [] });
    const log = recordingLog();
    expect(await loadOffers({ url: OFFERS_URL }, log)).toBeNull();
    expect(log.warnings.map((warning) => warning.code)).toEqual(['offers-invalid']);
  });

  test('a failed fetch is the same warning', async () => {
    serve({}, 404);
    const log = recordingLog();
    expect(await loadOffers({ url: OFFERS_URL }, log)).toBeNull();
    expect(log.warnings.map((warning) => warning.code)).toEqual(['offers-invalid']);
  });
});

describe('loadDocument with offers', () => {
  test('a bare scene naming the offers library validates when the offers are given, and is refused without them', async () => {
    serve(read(OFFERS_DIR, 'library.json'));
    const scene = read(OFFERS_DIR, 'scene.json');
    const log = recordingLog();
    const loaded = await loadDocument(new InlineSceneRepository(scene), undefined, log, undefined, { url: OFFERS_URL });
    expect(loaded.model.scene.assets.find((asset) => asset.id === OFFERS.placement.sofa)?.library).toBe(OFFERS.library);
    // A bare scene with offers still gets a context: the layered bank.
    expect(loaded.project?.offers?.library.id).toBe(OFFERS.library);
    expect(loaded.project?.key).toContain(OFFERS.library);
    await expect(loadDocument(new InlineSceneRepository(scene), undefined, recordingLog())).rejects.toThrow(OFFERS.library);
  });

  test('a broken offers file leaves the scene opening on the bundled bank, with the warning', async () => {
    serve({ nope: true });
    const log = recordingLog();
    // The offers scene without its placements: a bare scene that names nothing of the offers.
    const scene = { ...(read(OFFERS_DIR, 'scene.json') as object), assets: [] };
    const loaded = await loadDocument(new InlineSceneRepository(scene), undefined, log, undefined, { url: OFFERS_URL });
    expect(loaded.project?.offers ?? null).toBeNull();
    expect(log.warnings.map((warning) => warning.code)).toContain('offers-invalid');
  });

  test('offers whose id is the project library id are refused with the same warning', async () => {
    const project = read(PROJECT_DIR, 'project.json') as { library: object };
    const clash = { ...(read(OFFERS_DIR, 'library.json') as object), id: PROJECT_FIXTURE.projectId };
    const log = recordingLog();
    const loaded = await loadDocument(
      new InlineSceneRepository(read(PROJECT_DIR, 'scene.json')),
      { library: { manifest: project, baseUrl: 'https://example.com/p/' } },
      log,
      undefined,
      { library: clash, baseUrl: 'https://example.com/o/' },
    );
    expect(loaded.project?.offers ?? null).toBeNull();
    expect(log.warnings.map((warning) => warning.code)).toEqual(['offers-invalid']);
  });
});
