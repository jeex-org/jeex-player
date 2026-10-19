import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import type { LogEntry } from '../shared/logger.js';
import { createLogger } from '../shared/logger.js';
import type { ProjectMaterial } from './finish-types.js';
import type { FinishGeneratorKind } from './finish-generators.js';
import { FINISH_GENERATOR_KINDS, generatorFor, materialFromProject } from './finish-generators.js';

/** A logger that keeps what it was told, so a warning is an assertion rather than console noise. */
function recorder(): { log: ReturnType<typeof createLogger>; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { log: createLogger((entry) => entries.push(entry)), entries };
}

/** A project material around one generator, with the optional halves left out. */
function generated(generator: Extract<ProjectMaterial, { generator: unknown }>['generator'], tile?: number): ProjectMaterial {
  return { id: 'm', name: 'M', apply: ['furniture'], generator, ...(tile !== undefined && { tile }) };
}

describe('the finish generator registry', () => {
  test('covers both families under one key set', () => {
    expect([...FINISH_GENERATOR_KINDS].sort()).toEqual(
      (
        [
          'chevron',
          'fabric_weave',
          'painted_plaster',
          'plank_floor',
          'planks',
          'plaster',
          'stripes',
          'terrazzo',
          'tile_grid',
          'tiles',
          'wood_grain',
        ] satisfies FinishGeneratorKind[]
      ).sort(),
    );
  });

  test('every kind draws without a DOM, and draws nothing there', () => {
    expect(typeof document).toBe('undefined');
    for (const kind of FINISH_GENERATOR_KINDS) {
      const entry = generatorFor(kind);
      expect(entry).toBeDefined();
      const params = { tone: '#b5855a', accent: '#8f877b', seed: 3 };
      expect(entry!.colour(params)).toBeNull();
      expect(entry!.bump?.(params) ?? null).toBeNull();
    }
  });

  test('an unknown kind is not in the registry', () => {
    expect(generatorFor('tartan')).toBeUndefined();
  });

  test('the two families share entries where they draw the same texture', () => {
    expect(generatorFor('plank_floor')).toBe(generatorFor('planks'));
    expect(generatorFor('painted_plaster')).toBe(generatorFor('plaster'));
    expect(generatorFor('tile_grid')).toBe(generatorFor('tiles'));
  });
});

describe('materialFromProject', () => {
  test('a generator material is a standard material in the generator tone', () => {
    const { log, entries } = recorder();
    const material = materialFromProject(generated({ kind: 'plank_floor', tone: '#b5855a', seed: 1 }, 3.2), log);
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    // No DOM here, so there is no map and the tone is the material's colour.
    expect((material as THREE.MeshStandardMaterial).color.getHexString()).toBe('b5855a');
    expect(material.name).toBe('m');
    expect(entries).toEqual([]);
  });

  test('an unknown generator kind gives a flat colour and one warning, never a throw', () => {
    const { log, entries } = recorder();
    const material = materialFromProject(
      { id: 'odd', name: 'Odd', apply: ['wall'], generator: { kind: 'tartan', tone: '#445566', seed: 2 } } as unknown as ProjectMaterial,
      log,
    );
    expect((material as THREE.MeshStandardMaterial).color.getHexString()).toBe('445566');
    expect(entries.map((entry) => entry.code)).toEqual(['unknown-generator:tartan']);
  });

  test('a pbr material is accepted, drawn flat, and says its textures are deferred', () => {
    const { log, entries } = recorder();
    const material = materialFromProject(
      {
        id: 'stone',
        name: 'Stone',
        apply: ['floor'],
        pbr: { albedo: 'tex/stone_albedo.ktx2', roughness: 0.4, metalness: 0.1, tile: [2, 2] },
      },
      log,
    );
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    const standard = material as THREE.MeshStandardMaterial;
    expect(standard.map).toBeNull();
    expect(standard.roughness).toBe(0.4);
    expect(standard.metalness).toBe(0.1);
    expect(entries.map((entry) => entry.code)).toEqual(['pbr-textures-deferred']);
    expect(entries[0]!.detail).toEqual({ id: 'stone', albedo: 'tex/stone_albedo.ktx2' });
  });

  test('the caller may leave the logger out', () => {
    expect(() => materialFromProject(generated({ kind: 'painted_plaster', tone: '#f1eee8', seed: 2 }))).not.toThrow();
  });
});
