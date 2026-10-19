import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { apartmentScene } from '../demo/scene-data.js';
import {
  FLOOR_FINISHES,
  WALL_FINISHES,
  applyFinishToMaterial,
  findFinish,
  finishBumpTexture,
  finishKind,
  finishMaterial,
  finishSwatchDataURL,
  finishTexture,
  finishTile,
} from './finishes.js';
import { resolveFinish, resolveSurfaceFinish } from './material-catalogue.js';
import { ASSET_FINISHES } from './asset-finish-catalogue.js';
import { FINISH } from './finish-ids.js';
import { PROJECT_FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';
import { DEFAULT_FLOOR_FINISH, KIND_DEFAULTS, finishFromProjectMaterial, type FinishKind } from './finish-catalogue.js';
import { generatorFor, paramsOfGenerator } from './finish-generators.js';
import type { ProjectMaterial } from './finish-types.js';

/** A project fabric, and a scene's own material: ids no catalogue carries. */
const PROJECT_LINEN = '01a12fed-dd93-7fd8-9160-28bdc277d915';
const PROJECT_WALNUT = '01a12fed-dd94-7d0d-8e8f-993f5daeca49';
const SCENE_MATERIAL = '01a12fed-dd95-7db1-bf96-c154f5be72ca';

describe('finish catalogue', () => {
  test('finish ids are unique across floor and wall sets', () => {
    const ids = [...FLOOR_FINISHES, ...WALL_FINISHES].map((finish) => finish.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the default floor finish is the first entry of the floor bank', () => {
    expect(FLOOR_FINISHES[0]?.id).toBe(DEFAULT_FLOOR_FINISH);
    expect(finishKind(DEFAULT_FLOOR_FINISH)).toBe('floor');
  });

  test('every room floorMaterial resolves to a floor finish', () => {
    for (const room of apartmentScene.rooms) {
      expect(findFinish(room.floorMaterial)).not.toBeNull();
    }
  });

  test('the current wall colour matches a wall finish', () => {
    expect(WALL_FINISHES.some((finish) => finish.id === FINISH.sand)).toBe(true);
    expect(findFinish(FINISH.sand)!.base).toBe('#b0a294');
  });

  test('applyFinishToMaterial falls back to flat colour without a DOM canvas', () => {
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    applyFinishToMaterial(material, findFinish(FINISH.sand)!, 3, 2);
    expect(material.color.getHexString()).toBe(findFinish(FINISH.sand)!.base.replace('#', ''));
    expect(material.map).toBeNull();
  });

  test('finishMaterial respects per-finish roughness', () => {
    const oak = findFinish(FINISH.oak)!;
    const material = finishMaterial(oak, 1, 1);
    expect(material.roughness).toBe(oak.roughness);
  });

  test('applyFinishToMaterial clears the bump map along with the colour map', () => {
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    material.bumpMap = new THREE.Texture();
    applyFinishToMaterial(material, findFinish(FINISH.oak)!, 2, 2);
    expect(material.bumpMap).toBeNull();
  });
});

describe('finish world scale', () => {
  test('every finish declares a positive tile size in metres', () => {
    for (const finish of [...FLOOR_FINISHES, ...WALL_FINISHES]) {
      expect(finishTile(finish)).toBeGreaterThan(0);
      expect(finishTile(finish)).toBeLessThanOrEqual(4);
    }
  });

  test('floor tiles stay in a believable range for a room-sized surface', () => {
    for (const finish of FLOOR_FINISHES) {
      expect(finishTile(finish)).toBeGreaterThanOrEqual(2);
    }
  });

  test('gridded finishes resolve to realistic real-world module sizes', () => {
    // tile metres / grid = one ceramic tile or one stripe period.
    const module = (id: string) => {
      const finish = findFinish(id)!;
      return finishTile(finish) / (finish.grid ?? 1);
    };
    expect(module(FINISH.ceramic_light)).toBeCloseTo(0.625, 3);
    expect(module(FINISH.stone)).toBeCloseTo(0.62, 3);
    expect(module(FINISH.tiles_white)).toBeCloseTo(0.3, 3);
    expect(module(FINISH.wallpaper_cream)).toBeCloseTo(0.1375, 4);
  });

  test('finishTile falls back to a per-kind default', () => {
    expect(finishTile({ id: 'x', name: 'x', kind: 'plaster', base: '#ffffff', roughness: 1 })).toBe(2.4);
    expect(finishTile({ id: 'y', name: 'y', kind: 'planks', base: '#ffffff', roughness: 1 })).toBe(2.6);
  });

  test("KIND_DEFAULTS covers every FinishKind and is finishTile's only source of the fallback", () => {
    const kinds: FinishKind[] = ['planks', 'chevron', 'terrazzo', 'tiles', 'plaster', 'stripes'];
    for (const kind of kinds) {
      expect(KIND_DEFAULTS[kind]).toBeGreaterThan(0);
      expect(finishTile({ id: 'z', name: 'z', kind, base: '#ffffff', roughness: 1 })).toBe(KIND_DEFAULTS[kind]);
    }
  });

  test('every FinishKind is a key of the ONE generator registry', () => {
    const kinds: FinishKind[] = ['planks', 'chevron', 'terrazzo', 'tiles', 'plaster', 'stripes'];
    for (const kind of kinds) {
      const entry = generatorFor(kind);
      expect(entry).toBeDefined();
      // No canvas under Bun, so every generator answers null rather than
      // throwing - this is the same null-safety `finishTexture` relies on.
      const params = { tone: '#ffffff', seed: 1 };
      expect(() => entry!.colour(params)).not.toThrow();
      if (entry!.bump) expect(() => entry!.bump!(params)).not.toThrow();
    }
  });

  test('finishTexture and finishBumpTexture route entirely through generatorFor (no leftover switch)', () => {
    for (const kind of ['planks', 'chevron', 'terrazzo', 'tiles', 'plaster', 'stripes'] as FinishKind[]) {
      const stub = { id: 'z', name: 'z', kind, base: '#ffffff', roughness: 1, bump: 1 };
      const entry = generatorFor(kind)!;
      const params = { tone: '#ffffff', accent: undefined, seed: 1, grid: undefined, style: undefined };
      expect(finishTexture(stub)).toEqual(entry.colour(params));
      expect(finishBumpTexture(stub)).toEqual(entry.bump?.(params) ?? null);
    }
  });

  test('a finish that carries a whole generator draws with THAT, kind or no kind', () => {
    // `wood_grain` is not a `FinishKind` at all: it reaches a room surface only
    // through a project material, and this is the route that lets it.
    const material: ProjectMaterial = {
      id: PROJECT_WALNUT,
      name: 'Project walnut',
      apply: ['wall'],
      generator: { kind: 'wood_grain', tone: '#6e4a30', seed: 4, lines: 40 },
      tile: 2.2,
    };
    const finish = finishFromProjectMaterial(material);
    expect(finish.generator).toBe(material.generator);
    expect(finish.base).toBe('#6e4a30');
    expect(finishTile(finish)).toBe(2.2);
    expect(finishTexture(finish)).toEqual(generatorFor('wood_grain')!.colour(paramsOfGenerator(material.generator)));
  });

  test('findFinish reads a project source instead of the bank, and only surface materials', () => {
    const source: ProjectMaterial[] = [
      {
        id: PROJECT_FIXTURE.material.oak,
        name: 'Fixture oak',
        apply: ['floor'],
        generator: { kind: 'plank_floor', tone: '#b5855a', seed: 1 },
        tile: 3.2,
      },
      { id: PROJECT_LINEN, name: 'Fixture linen', apply: ['fabric'], generator: { kind: 'fabric_weave', tone: '#cdbda2', seed: 2 } },
    ];
    expect(findFinish(PROJECT_FIXTURE.material.oak, source)?.base).toBe('#b5855a');
    // A fabric is not a surface: it exists for a sofa, and painting a floor
    // with it is a reference the room panel must not resolve.
    expect(findFinish(PROJECT_LINEN, source)).toBeNull();
    // The bank is not consulted at all once a source is named, and the source
    // is not consulted when none is.
    expect(findFinish(FINISH.oak, source)).toBeNull();
    expect(findFinish(PROJECT_FIXTURE.material.oak)).toBeNull();
  });

  test('only finishes with a bump scale ask for height detail', () => {
    for (const finish of [...FLOOR_FINISHES, ...WALL_FINISHES]) {
      if (finish.bump === undefined) expect(finishBumpTexture(finish)).toBeNull();
      else expect(finish.bump).toBeGreaterThan(0);
    }
  });

  test('texture builders stay null-safe without a canvas', () => {
    for (const finish of [...FLOOR_FINISHES, ...WALL_FINISHES]) {
      expect(finishTexture(finish)).toBeNull();
      expect(finishSwatchDataURL(finish)).toBeNull();
    }
  });

  test('pattern seeds are unique so no two finishes share a layout', () => {
    const seeds = [...FLOOR_FINISHES, ...WALL_FINISHES].map((finish) => finish.seed);
    expect(seeds.every((seed) => typeof seed === 'number')).toBe(true);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('finish families', () => {
  test('finishKind answers floor for every floor id and wall for every wall id', () => {
    for (const finish of FLOOR_FINISHES) expect({ id: finish.id, kind: finishKind(finish.id) }).toEqual({ id: finish.id, kind: 'floor' });
    for (const finish of WALL_FINISHES) expect({ id: finish.id, kind: finishKind(finish.id) }).toEqual({ id: finish.id, kind: 'wall' });
  });

  test('an id outside the surface catalogue has no family', () => {
    // An object-bank finish resolves through `material-catalogue`, but it is
    // not paintable on a room surface and must not claim a family.
    expect(finishKind(FINISH.oak_natural)).toBeNull();
    expect(finishKind('not-a-finish')).toBeNull();
  });

  test('the two families are disjoint, which is what makes room routing total', () => {
    const floors = new Set(FLOOR_FINISHES.map((finish) => finish.id));
    expect(WALL_FINISHES.filter((finish) => floors.has(finish.id))).toEqual([]);
  });
});

describe('surface and object finishes', () => {
  test('resolveFinish answers from the surface catalogue first', () => {
    for (const finish of [...FLOOR_FINISHES, ...WALL_FINISHES]) {
      const resolved = resolveFinish(finish.id);
      expect({ id: finish.id, source: resolved?.source }).toEqual({ id: finish.id, source: 'surface' });
      expect(resolved?.color).toBe(finish.base);
    }
  });

  test('no id is in both catalogues, so a floor painted oak is the surface oak and never the veneer', () => {
    const surfaces = new Set([...FLOOR_FINISHES, ...WALL_FINISHES].map((finish) => finish.id));
    expect(ASSET_FINISHES.filter((finish) => surfaces.has(finish.id)).map((finish) => finish.slug)).toEqual([]);
    expect(resolveSurfaceFinish(FINISH.oak)?.id).toBe(FINISH.oak);
  });

  test('a readable 1.x word resolves nowhere: a document names finishes by UUID', () => {
    for (const word of ['oak', 'oak_natural', 'linen', 'brass']) expect(resolveFinish(word)).toBeNull();
  });

  test('an object-bank finish resolves, but never as a paintable surface', () => {
    expect(resolveFinish(FINISH.oak_natural)?.source).toBe('object');
    expect(resolveSurfaceFinish(FINISH.oak_natural)).toBeNull();
  });

  test('a scene override can only add an id, never shadow a catalogue one', () => {
    const shadow = [{ id: FINISH.sand, name: 'Impostor', color: '#ff00ff', roughness: 0.1 }];
    expect(resolveFinish(FINISH.sand, shadow)?.color).toBe(findFinish(FINISH.sand)!.base);
    expect(resolveFinish(SCENE_MATERIAL, [{ id: SCENE_MATERIAL, name: 'U', color: '#123456', roughness: 0.4 }])?.source).toBe('scene');
  });
});
