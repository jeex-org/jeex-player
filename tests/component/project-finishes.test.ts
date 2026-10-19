/**
 * A baked project's `materials[]`, drawn for real.
 *
 * The Bun level (`src/materials/finish-generators.test.ts`,
 * `src/assets/asset-finishes.test.ts`) proves the registry's keys, its source
 * order and its never-refuse rule, but it runs without a document: there every
 * generator answers `null` and every finish is flat. The claim that a project
 * material actually becomes a TEXTURED material — a canvas drawn by the
 * generator, cloned, repeated at `1 / tile` metres — needs a canvas, so it
 * lives here.
 */

import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { FinishRegistry } from '../../src/assets/asset-finishes.js';
import { findFinish } from '../../src/materials/finish-catalogue.js';
import { materialFromProject } from '../../src/materials/finish-generators.js';
import type { ProjectMaterial } from '../../src/materials/finish-types.js';
import { finishTexture } from '../../src/materials/finishes.js';

/** This file's own project materials, by fixed UUID v7. */
const MATERIAL = {
  oak: '01a12ffa-de40-7b97-8264-0a1e92db0f02',
  white: '01a12ffa-de41-7a34-a9f3-e0207e801b20',
  walnut: '01a12ffa-de42-7715-accc-5720ec922724',
} as const;

const OAK: ProjectMaterial = {
  id: MATERIAL.oak,
  name: 'Fixture oak',
  apply: ['floor', 'furniture'],
  generator: { kind: 'plank_floor', tone: '#b5855a', seed: 1 },
  tile: 3.2,
};

const WHITE: ProjectMaterial = {
  id: MATERIAL.white,
  name: 'Fixture white',
  apply: ['wall', 'furniture'],
  generator: { kind: 'painted_plaster', tone: '#f1eee8', seed: 2 },
};

describe('project materials with a canvas', () => {
  test('a generator material carries a colour map repeated by its tile size', () => {
    const material = materialFromProject(OAK) as THREE.MeshStandardMaterial;
    expect(material.map).toBeInstanceOf(THREE.Texture);
    expect(material.map!.repeat.x).toBeCloseTo(1 / 3.2, 6);
    expect(material.map!.repeat.y).toBeCloseTo(1 / 3.2, 6);
    // A mapped material is white: the colour would multiply the texture.
    expect(material.color.getHexString()).toBe('ffffff');
    material.map!.dispose();
    material.dispose();
  });

  test('the registry hands out the same textured material for a project id', () => {
    const registry = new FinishRegistry([], [OAK, WHITE]);
    const oak = registry.get(MATERIAL.oak) as THREE.MeshStandardMaterial;
    const white = registry.get(MATERIAL.white) as THREE.MeshStandardMaterial;
    expect(oak.map).toBeInstanceOf(THREE.Texture);
    expect(white.map).toBeInstanceOf(THREE.Texture);
    expect(oak.map).not.toBe(white.map);
    registry.dispose();
  });

  test('a project material found as a room surface finish draws its own generator', () => {
    const finish = findFinish(MATERIAL.oak, [OAK, WHITE]);
    expect(finish).not.toBeNull();
    const texture = finishTexture(finish!);
    expect(texture).toBeInstanceOf(THREE.Texture);
    // Drawn from the PROJECT's tone and seed rather than looked up by id: the
    // same generator under a different tone is a different canvas. (The same
    // tone and seed would be the same canvas, and should be — the texture
    // cache is keyed by what was drawn, not by who asked.)
    const other = findFinish(MATERIAL.walnut, [
      { ...OAK, id: MATERIAL.walnut, generator: { kind: 'plank_floor', tone: '#6e4a30', seed: 1 } },
    ]);
    expect(finishTexture(other!)).not.toBe(texture);
  });
});
