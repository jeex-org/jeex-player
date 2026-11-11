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
});
