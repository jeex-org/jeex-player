/**
 * `FinishRegistry` over its three sources.
 *
 * Under Bun there is no canvas, so every generator draws `null` and a finish
 * shows as its flat colour — which is exactly what makes the ORDER of the
 * sources readable here: each source is given a different colour and the one
 * that wins is the one the material is painted with. That a project material
 * gets a real texture map needs a document and is proved in
 * `tests/component/project-finishes.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import type { ProjectMaterial } from '../materials/finish-types.js';
import type { LogEntry } from '../shared/logger.js';
import { createLogger } from '../shared/logger.js';
import type { MaterialDefinition } from '../scene/types.js';
import { FinishRegistry, finishById } from './asset-finishes.js';
import { FINISH } from '../materials/finish-ids.js';
import { PROJECT_FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';

/** Ids no bank carries: a scene's own material, a project's pbr stone, an id nobody declares. */
const SCENE_ONLY = '01a12fed-dda5-7305-a168-094e94a20689';
const PROJECT_STONE = '01a12fed-dda6-7194-8a7b-2ba0846f06b6';
const NO_SUCH_FINISH = '01a12ff0-b67e-7975-97e5-145eaa77a3cb';

/** A logger that keeps what it was told, so a warning is an assertion rather than console noise. */
function recorder(): { log: ReturnType<typeof createLogger>; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { log: createLogger((entry) => entries.push(entry)), entries };
}

const projectMaterials: ProjectMaterial[] = [
  {
    id: PROJECT_FIXTURE.material.oak,
    name: 'Fixture oak',
    apply: ['floor', 'furniture'],
    generator: { kind: 'plank_floor', tone: '#b5855a', seed: 1 },
    tile: 3.2,
  },
  {
    id: PROJECT_FIXTURE.material.white,
    name: 'Fixture white',
    apply: ['wall', 'furniture'],
    generator: { kind: 'painted_plaster', tone: '#f1eee8', seed: 2 },
  },
];

/** Hex of a material's colour, the way a flat finish reads without a canvas. */
function colourOf(material: THREE.Material): string {
  return `#${(material as THREE.MeshStandardMaterial).color.getHexString()}`;
}

describe('FinishRegistry sources', () => {
  test('a project material answers first, and is cached like any other', () => {
    const registry = new FinishRegistry([], projectMaterials);
    const material = registry.get(PROJECT_FIXTURE.material.oak);
    expect(colourOf(material)).toBe('#b5855a');
    expect(material.name).toBe(PROJECT_FIXTURE.material.oak);
    expect(registry.get(PROJECT_FIXTURE.material.oak)).toBe(material);
    expect(registry.has(PROJECT_FIXTURE.material.oak)).toBe(true);
    registry.dispose();
  });

  test('a project material outranks a bundled bank finish of the same id', () => {
    const shadow: ProjectMaterial[] = [
      { id: FINISH.linen_sand, name: 'Project linen', apply: ['furniture'], generator: { kind: 'fabric_weave', tone: '#123456', seed: 3 } },
    ];
    expect(finishById(FINISH.linen_sand)).toBeDefined();
    const registry = new FinishRegistry([], shadow);
    expect(colourOf(registry.get(FINISH.linen_sand))).toBe('#123456');
    registry.dispose();
  });

  test('a DemoAsset.material shortcut naming a bank finish still resolves through the bank behind the project', () => {
    // An exporter does not carry the bank finishes a scene
    // names into `library.materials`, so a project-loaded scene that still
    // names them must fall through to the bundled bank rather than go grey.
    const registry = new FinishRegistry([], projectMaterials);
    for (const bank of [FINISH.linen_sand, FINISH.ash_black]) {
      expect(registry.has(bank)).toBe(true);
      expect(colourOf(registry.get(bank))).toBe(finishById(bank)!.pbr.color);
    }
    registry.dispose();
  });

  test('a scene material answers last, and only for an id neither other source has', () => {
    const sceneMaterials: MaterialDefinition[] = [
      { id: PROJECT_FIXTURE.material.oak, name: 'Scene oak', color: '#ff0000', roughness: 0.5 },
      { id: FINISH.linen_sand, name: 'Scene linen', color: '#00ff00', roughness: 0.5 },
      { id: SCENE_ONLY, name: 'Scene only', color: '#0000ff', roughness: 0.4 },
    ];
    const registry = new FinishRegistry(sceneMaterials, projectMaterials);
    expect(colourOf(registry.get(PROJECT_FIXTURE.material.oak))).toBe('#b5855a');
    expect(colourOf(registry.get(FINISH.linen_sand))).toBe(finishById(FINISH.linen_sand)!.pbr.color);
    expect(colourOf(registry.get(SCENE_ONLY))).toBe('#0000ff');
    registry.dispose();
  });

  test('an id no source knows is the grey fallback, named as one', () => {
    const registry = new FinishRegistry([], projectMaterials);
    const material = registry.get(NO_SUCH_FINISH);
    expect(colourOf(material)).toBe('#b0a695');
    expect(material.name).toBe(`${NO_SUCH_FINISH}-fallback`);
    expect(registry.has(NO_SUCH_FINISH)).toBe(false);
    registry.dispose();
  });

  test('a deferred pbr material is drawn, not refused, and says so once per id', () => {
    const { log, entries } = recorder();
    const registry = new FinishRegistry(
      [],
      [{ id: PROJECT_STONE, name: 'Stone', apply: ['floor'], pbr: { albedo: 'tex/stone_albedo.ktx2', roughness: 0.4, tile: [2, 2] } }],
      log,
    );
    registry.get(PROJECT_STONE);
    registry.get(PROJECT_STONE);
    expect(entries.map((entry) => entry.code)).toEqual(['pbr-textures-deferred']);
    registry.dispose();
  });

  test('with neither extra source it is the bundled bank exactly as it was', () => {
    const registry = new FinishRegistry();
    expect(colourOf(registry.get(FINISH.linen_sand))).toBe(finishById(FINISH.linen_sand)!.pbr.color);
    expect(registry.get(FINISH.linen_sand).name).toBe(FINISH.linen_sand);
    registry.dispose();
  });
});
