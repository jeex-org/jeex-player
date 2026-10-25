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
import { FLOOR_FINISHES, RETIRED_FINISHES, WALL_FINISHES } from '../src/materials/finish-catalogue.js';
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

  test('every bundled floor and wall finish and every alias is listed once, and the ceiling default too', () => {
    const listed = index.finishes.map((entry) => entry.finish);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...FLOOR_FINISHES, ...WALL_FINISHES, ...RETIRED_FINISHES].map((finish) => finish.id).sort());
    expect(index.defaults.ceiling.finish).toBe(FINISH.plaster_white);
  });

  test('a bound finish names a listed version and carries a colour exactly when the material is tintable', () => {
    for (const entry of [...index.finishes, index.defaults.ceiling]) {
      if (!('version' in entry)) continue;
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
    const bound = index.finishes.filter((entry) => 'version' in entry).map((entry) => entry.finish);
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

describe('the contemporary set', () => {
  test("nothing is kept, and the aliases are exactly the player's retired finishes", () => {
    expect(index.finishes.filter((entry) => 'kept' in entry)).toEqual([]);
    const aliases = index.finishes.flatMap((entry) => ('alias' in entry ? [{ id: entry.finish, target: entry.alias }] : []));
    expect(aliases).toEqual(RETIRED_FINISHES.map(({ id, target }) => ({ id, target })));
  });

  test('every catalogue row carries the library name of its finish', () => {
    const names = new Map(
      index.finishes.flatMap((entry) => ('name' in entry && entry.name !== undefined ? [[entry.finish, entry.name] as const] : [])),
    );
    for (const finish of [...FLOOR_FINISHES, ...WALL_FINISHES])
      expect([finish.id, finish.name]).toEqual([finish.id, names.get(finish.id) ?? '']);
  });

  test('the eleven new finishes are bound', () => {
    for (const id of [
      FINISH.pure_white,
      FINISH.ink,
      FINISH.venetian,
      FINISH.microcement,
      FINISH.microcement_grey,
      FINISH.travertine,
      FINISH.marble,
      FINISH.porcelain_grey,
      FINISH.zellige,
      FINISH.herringbone,
      FINISH.herringbone_dark,
    ])
      expect(BUILTIN_FINISHES.has(id)).toBe(true);
  });

  test('the glazed zellige carries its clear coat', () => {
    const { pbr } = BUILTIN_FINISHES.get(FINISH.zellige)!.material.facts;
    expect({ clearcoat: pbr.clearcoat, clearcoatRoughness: pbr.clearcoatRoughness }).toEqual({ clearcoat: 1, clearcoatRoughness: 0.08 });
  });

  test('the default ceiling is the lime plaster tinted warm white', () => {
    expect(BUILTIN_DEFAULT_CEILING?.colour).toBe('#f1ece2');
    expect(BUILTIN_DEFAULT_CEILING?.material.facts.colourMode).toBe('tintable');
  });

  test('the porcelain repeats hold whole tiles', () => {
    expect(BUILTIN_FINISHES.get(FINISH.ceramic_light)?.material.facts.tileM).toEqual([3.6, 1.8]);
    expect(BUILTIN_FINISHES.get(FINISH.porcelain_grey)?.material.facts.tileM).toEqual([3.6, 1.8]);
  });

  test('Cream limestone is the honed marble scan at its real size, tinted warm cream', () => {
    const limestone = BUILTIN_FINISHES.get(FINISH.stone)!;
    expect({
      version: limestone.material.versionId,
      colour: limestone.colour,
      tileM: limestone.material.facts.tileM,
      roughness: limestone.material.facts.pbr.roughness?.toFixed(3),
    }).toEqual({ version: '01a17052-6c88-7224-9c80-240c126fe952', colour: '#dcc8a4', tileM: [1.5, 1.5], roughness: '0.593' });
  });
});
