/**
 * The public `jeex-viewer/schema` entry: a façade test, not a behaviour test —
 * the validator, the manifest schema and the registries are covered where they
 * live. Two things are proven here that no other test proves:
 *
 * - the entry is USABLE on its own, the way a catalogue service uses it: a
 *   baked project's manifest is parsed, turned into registries and its scene
 *   validated against them, and the demo apartment against the shipped
 *   catalogues, with every name imported from `./schema.js` alone;
 * - the export surface is EXACTLY the module header's documented list, so a
 *   name added to one of the modules it re-exports does not widen the public
 *   API through this façade by accident.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apartmentScene } from '../demo/scene-data.js';
import * as entry from './schema.js';
import {
  CATALOGUE_ID_BY_SLUG,
  CATALOGUE_REGISTRIES,
  LAMP_MAX_LIGHTS,
  MAX_PROJECT_TEXTURE_FILES,
  ROOM_PURPOSES,
  parseProjectManifest,
  projectLibraryOf,
  projectManifestIssues,
  registriesFromLibrary,
  validateScene,
} from './schema.js';

const FIXTURE = join(import.meta.dirname, '../../tests/fixtures/project');
const QUIET = { warn: () => {}, error: () => {} };

describe('jeex-viewer/schema entry', () => {
  test('a baked project validates through the entry alone: manifest, its registries, then its scene', () => {
    const manifest = parseProjectManifest(JSON.parse(readFileSync(join(FIXTURE, 'project.json'), 'utf8')));
    const registries = registriesFromLibrary(projectLibraryOf(manifest), CATALOGUE_REGISTRIES);
    const scene = validateScene(JSON.parse(readFileSync(join(FIXTURE, 'scene.json'), 'utf8')), registries, QUIET);
    expect(scene.assets.length).toBeGreaterThan(0);
  });

  test('the demo apartment validates against the shipped catalogues', () => {
    expect(validateScene(apartmentScene, CATALOGUE_REGISTRIES, QUIET).rooms.length).toBe(apartmentScene.rooms.length);
  });

  test('a broken manifest is described, not parsed', () => {
    expect(projectManifestIssues({ format: 'nope' }).length).toBeGreaterThan(0);
    expect(() => parseProjectManifest({ format: 'nope' })).toThrow();
  });

  test('the vocabularies and limits a service checks uploads against are the ones the player reads', () => {
    expect(ROOM_PURPOSES).toContain('kitchen');
    expect(CATALOGUE_ID_BY_SLUG.finish['oak']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(LAMP_MAX_LIGHTS).toBeGreaterThan(0);
    expect(MAX_PROJECT_TEXTURE_FILES).toBeGreaterThan(0);
  });

  test('the value surface is exactly the documented list', () => {
    expect(Object.keys(entry).sort()).toEqual(
      [
        'CATALOGUE_ID_BY_SLUG',
        'CATALOGUE_REGISTRIES',
        'LAMP_MAX_CUTOFF',
        'LAMP_MAX_LIGHTS',
        'LAMP_MAX_LUMENS',
        'MAX_MODEL_BYTES',
        'MAX_PROJECT_BYTES',
        'MAX_PROJECT_MANIFEST_BYTES',
        'MAX_PROJECT_TEXTURE_BYTES',
        'MAX_PROJECT_TEXTURE_FILES',
        'MAX_SCENE_BYTES',
        'MAX_TEXTURE_FILE_BYTES',
        'OPENING_TYPES',
        'PROJECT_FORMAT',
        'ROOM_KINDS',
        'ROOM_PURPOSES',
        'SCHEMA_VERSIONS',
        'WALL_ROLES',
        'assetRefOf',
        'isProjectDocument',
        'isSceneShape',
        'lampLightSchema',
        'libraryOf',
        'parseProjectLibrary',
        'parseProjectManifest',
        'parseSceneDocument',
        'projectLibraryOf',
        'projectManifestIssues',
        'projectManifestSchema',
        'registriesFromLibrary',
        'sceneSchema',
        'sceneShapeIssues',
        'validateScene',
      ].sort(),
    );
  });
});
