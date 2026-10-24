/**
 * The shipped `finish-maps/` folder against its own index: every listed file
 * exists with its recorded size and SHA-256, every version reads as a valid
 * library material, every bundled room finish is listed once (bound or kept),
 * every scan has a source row, and the generated runtime table is exactly
 * what the index says. Offline: nothing here reaches a store.
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { finishMapsIndexSchema, type FinishMapsIndex } from './finish-maps-index.schema.js';
import { FINISH_MAPS_DIR, libraryMaterialOf, listedMaps, tableRecords } from './finish-maps-fetch.js';
import { FLOOR_FINISHES, WALL_FINISHES } from '../src/materials/finish-catalogue.js';
import { FINISH } from '../src/materials/finish-ids.js';
import { MAX_TEXTURE_FILE_BYTES } from '../src/shared/limits.js';
import { projectManifestIssues } from '../src/assets/project-manifest.schema.js';
import { BUILTIN_DEFAULT_CEILING, BUILTIN_FINISHES } from '../src/materials/builtin-library.js';
import { BUILTIN_RECORDS } from '../src/materials/builtin-library-data.js';
import { firstFrameColour } from '../src/materials/library-material.js';

const index: FinishMapsIndex = finishMapsIndexSchema.parse(JSON.parse(readFileSync(join(FINISH_MAPS_DIR, 'index.json'), 'utf8')));
const versions = new Map(index.versions.map((version) => [version.version, version]));

/** A valid manifest around `materials`, so the format's own rules judge each version. */
function manifestAround(materials: unknown[]): unknown {
  const id = '01a1683e-d6fd-7e48-b046-25153a9ef95a';
  return {
    format: 'jeex-project',
    formatVersion: 2,
    projectId: id,
    bakeId: id,
    bakedAt: '2026-10-24T00:00:00Z',
    scene: 'scene.json',
    library: { manifestVersion: '1.0', id, publisher: id, license: 'CC0-1.0', objects: [], materials },
    rights: { workspaceId: id, perpetual: true, assets: [] },
    generator: { name: 'finish-maps.test', version: '1' },
  };
}

describe('finish-maps index', () => {
  test('every listed file exists with its size and SHA-256, under the per-file cap, as WebP', () => {
    for (const version of index.versions) {
      for (const [, map] of listedMaps(version)) {
        for (const file of Object.values(map.files)) {
          const path = join(FINISH_MAPS_DIR, file.path);
          expect(existsSync(path)).toBe(true);
          const bytes = readFileSync(path);
          expect(bytes.length).toBe(file.bytes);
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
          expect(bytes.length).toBeLessThanOrEqual(MAX_TEXTURE_FILE_BYTES);
          expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
          expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP');
        }
      }
    }
  });

  test('every version is a valid library material', () => {
    const materials = index.versions.map((version, n) => ({
      id: `01a1683e-d6fd-7e48-b046-${String(n).padStart(12, '0')}`,
      name: version.name,
      apply: ['floor', 'wall', 'ceiling'],
      library: libraryMaterialOf(version),
    }));
    expect(projectManifestIssues(manifestAround(materials))).toEqual([]);
  });

  test('every bundled floor and wall finish is listed once, bound or kept, and the ceiling default too', () => {
    const listed = index.finishes.map((entry) => entry.finish);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...FLOOR_FINISHES, ...WALL_FINISHES].map((finish) => finish.id).sort());
    expect(index.defaults.ceiling.finish).toBe(FINISH.plaster_white);
  });

  test('a bound finish names a listed version and carries a colour exactly when the material is tintable', () => {
    for (const entry of [...index.finishes, index.defaults.ceiling]) {
      if ('kept' in entry) continue;
      const version = versions.get(entry.version);
      expect(version).toBeDefined();
      expect(entry.colour !== undefined).toBe(version?.facts.colourMode === 'tintable');
    }
  });

  test('every scan has a source row naming its page and licence', () => {
    const sources = readFileSync(join(FINISH_MAPS_DIR, 'SOURCES.md'), 'utf8');
    for (const version of index.versions) {
      if (version.kind !== 'scan') continue;
      expect(sources).toContain(version.source.sourcePage);
      expect(sources).toContain(version.source.licence);
    }
  });

  test('the generated runtime table is exactly what the index says', () => {
    expect(BUILTIN_RECORDS).toEqual(tableRecords(index));
  });
});

describe('runtime table', () => {
  test('binds exactly the bound finishes, and the ceiling default when bound', () => {
    const bound = index.finishes.filter((entry) => !('kept' in entry)).map((entry) => entry.finish);
    expect([...BUILTIN_FINISHES.keys()].sort()).toEqual([...bound].sort());
    expect(BUILTIN_DEFAULT_CEILING === null).toBe('kept' in index.defaults.ceiling);
    expect(BUILTIN_FINISHES.has(FINISH.plaster_white)).toBe(false);
  });

  test('a bound catalogue row shows its library first-frame colour as its base', () => {
    for (const finish of [...FLOOR_FINISHES, ...WALL_FINISHES]) {
      const binding = BUILTIN_FINISHES.get(finish.id);
      if (binding === undefined) continue;
      const draw = {
        id: finish.id,
        material: binding.material,
        rotation: binding.rotation,
        ...(binding.colour !== undefined && { colour: binding.colour }),
      };
      expect(finish.base).toBe(`#${firstFrameColour(draw).getHexString(THREE.SRGBColorSpace)}`);
    }
  });
});
