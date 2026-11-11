/**
 * Where a mounted viewer's documents come from: a Retry boots the latest
 * replacement with its OWN library and revision, never the first mount's.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apartmentScene } from '../demo/scene-data.js';
import { DocumentSource } from './document-source.js';

const LAMP_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project-lamps');
const QUIET = { warn: () => {}, error: () => {} };

describe('DocumentSource', () => {
  test('a boot after a replacement loads the replacement against its own library, at its own revision', async () => {
    const documents = new DocumentSource({ document: apartmentScene, revision: 1 }, QUIET);
    const manifest: unknown = JSON.parse(readFileSync(join(LAMP_DIR, 'project.json'), 'utf8'));
    const scene: unknown = JSON.parse(readFileSync(join(LAMP_DIR, 'scene.json'), 'utf8'));
    const library = { manifest, baseUrl: 'https://lamps.test/bake/' };
    await documents.replace(
      { document: scene, library, revision: 9 },
      () => false,
      () => undefined,
    );
    const booted = await documents.boot();
    expect(booted.model.rev).toBe(9);
    expect(documents.project()?.baseUrl).toBe(library.baseUrl);
  });

  test('a loaded document says whether its source named a revision, which the edit tools warn about', async () => {
    expect((await new DocumentSource({ document: apartmentScene, revision: 0 }, QUIET).boot()).revisionGiven).toBe(true);
    expect((await new DocumentSource({ document: apartmentScene }, QUIET).boot()).revisionGiven).toBe(false);
    const documents = new DocumentSource({ document: apartmentScene, revision: 3 }, QUIET);
    const replaced = await documents.replace(
      { document: apartmentScene },
      () => false,
      () => undefined,
    );
    expect(replaced?.revisionGiven).toBe(false);
  });

  test('a manifest whose scene fails to load still names its project and bake; a bare scene names none', async () => {
    const manifest: unknown = JSON.parse(readFileSync(join(LAMP_DIR, 'project.json'), 'utf8'));
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string) =>
      Promise.resolve(
        url.endsWith('project.json')
          ? new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } })
          : new Response(null, { status: 404 }),
      )) as typeof fetch;
    try {
      const documents = new DocumentSource({ url: 'https://lamps.test/bake/project.json' }, QUIET);
      expect(documents.manifestRead()).toBeNull();
      await expect(documents.boot()).rejects.toThrow();
      expect(documents.project()).toBeNull();
      const { projectId, bakeId } = manifest as { projectId: string; bakeId: string };
      expect(documents.manifestRead()).toEqual({ projectId, bakeId });
    } finally {
      globalThis.fetch = original;
    }
    const bare = new DocumentSource({ document: apartmentScene }, QUIET);
    await bare.boot();
    expect(bare.manifestRead()).toBeNull();
  });
});
