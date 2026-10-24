/**
 * The shell of a bare scene, whose room surfaces wear bundled finishes: the
 * bound ones draw their library material and take their maps from the
 * player's own built-in source, never the document's; the kept ones still
 * draw their generated texture. Everything runs without a WebGL context; the
 * sources are the real ones over stub networks.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SceneBuilder } from './scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { TextureSource } from '../materials/texture-source.js';
import { createLogger } from '../shared/logger.js';
import { BUILTIN_DEFAULT_CEILING, BUILTIN_FINISHES } from '../materials/builtin-library.js';
import { firstFrameColour } from '../materials/library-material.js';
import { DEFAULT_WALL_FINISH } from '../scene/scene-ops.js';
import { draftOf } from '../shared/committed.js';
import type { SceneData } from '../scene/types.js';

const ROOM = L_SHAPE.room;

/** A source over a stub network answering every file, recording the URLs. */
function stubSource(baseUrl: string) {
  const fetched: string[] = [];
  const source = new TextureSource({
    baseUrl,
    log: createLogger(() => undefined),
    maxAnisotropy: 8,
    fetch: async (url) => {
      fetched.push(url);
      return new Response(new Uint8Array(16));
    },
    decode: async () => ({ width: 512, height: 512, close: () => undefined }),
  });
  return { textures: { source, device: 'mid' } as const, fetched };
}

/** The colour a bundled finish shows before its maps, as `#rrggbb`. */
function firstFrameHex(id: string): string {
  const binding = id === FINISH.plaster_white ? BUILTIN_DEFAULT_CEILING! : BUILTIN_FINISHES.get(id)!;
  const draw = {
    id,
    material: binding.material,
    rotation: binding.rotation,
    ...(binding.colour !== undefined && { colour: binding.colour }),
  };
  return `#${firstFrameColour(draw).getHexString()}`;
}

/** A library surface's material is named by the finish it draws (`createLibraryMaterial`); a legacy one is not. */
const isLibrary = (material: THREE.Material, id: string): boolean => material.name === id;
const hexOf = (material: THREE.Material): string => `#${(material as THREE.MeshStandardMaterial).color.getHexString()}`;
const materialOf = (root: THREE.Object3D, name: string) =>
  (root.getObjectByName(name) as THREE.Mesh).material as THREE.MeshStandardMaterial;

async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1)
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
}

/** The L-shape (room a on oak, room b on the kept limestone, sand walls) built with both sources. */
function bare(scene: SceneData = lShapePlan) {
  const builtin = stubSource('https://player.test/finish-maps/');
  const project = stubSource('https://project.test/');
  const builder = new SceneBuilder(scene, solvePlan(scene), { builtinTextures: builtin.textures, textures: project.textures });
  const { root } = builder.build();
  return { builder, root, builtin, project };
}

describe('a bare scene on bundled finishes', () => {
  test('a bound floor starts flat in its first-frame colour, without a generated map', () => {
    const { root } = bare();
    const floor = materialOf(root, `floor-${ROOM.a}`);
    expect(isLibrary(floor, FINISH.oak)).toBe(true);
    expect(hexOf(floor)).toBe(firstFrameHex(FINISH.oak));
    expect(floor.map).toBeNull();
  });

  test('the bound floor and wall maps come from the built-in source, and nothing from the project source', async () => {
    const { builder, builtin, project } = bare();
    builtin.textures.source.start();
    project.textures.source.start();
    await builder.mapsSettled();
    const oak = BUILTIN_FINISHES.get(FINISH.oak)!.material.versionId;
    expect(builtin.fetched.some((url) => url.startsWith(`https://player.test/finish-maps/tex/${oak}/`))).toBe(true);
    expect(project.fetched).toEqual([]);
  });

  test('the maps attach to the bound floor once they arrive', async () => {
    const { builder, root, builtin } = bare();
    builtin.textures.source.start();
    await builder.mapsSettled();
    await flush();
    expect(materialOf(root, `floor-${ROOM.a}`).map).not.toBeNull();
  });

  test('a kept floor still draws through the legacy path', () => {
    const { root } = bare();
    expect(BUILTIN_FINISHES.has(FINISH.stone)).toBe(false);
    expect(isLibrary(materialOf(root, `floor-${ROOM.b}`), FINISH.stone)).toBe(false);
  });

  test('the default walls draw their library material in its tinted first-frame colour', () => {
    const { root } = bare();
    const walls = new Set<THREE.Material>();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData['surface'] === 'wall') walls.add(object.material as THREE.Material);
    });
    expect(walls.size).toBeGreaterThan(0);
    for (const wall of walls) {
      expect(isLibrary(wall, DEFAULT_WALL_FINISH)).toBe(true);
      expect(hexOf(wall)).toBe(firstFrameHex(DEFAULT_WALL_FINISH));
      expect((wall as THREE.MeshStandardMaterial).map).toBeNull();
    }
  });

  test('every ceiling of a room that names none shares one library material in the default ceiling colour', () => {
    const { root } = bare();
    const a = materialOf(root, `ceiling-${ROOM.a}`);
    const b = materialOf(root, `ceiling-${ROOM.b}`);
    expect(a).toBe(b);
    expect(isLibrary(a, FINISH.plaster_white)).toBe(true);
    expect(hexOf(a)).toBe(firstFrameHex(FINISH.plaster_white));
    expect(a.map).toBeNull();
  });

  test('repainting a ceiling back to the default keeps the shared material alive; disposal frees it once', () => {
    const { builder, root } = bare();
    const shared = materialOf(root, `ceiling-${ROOM.a}`);
    let disposed = 0;
    shared.addEventListener('dispose', () => void (disposed += 1));
    expect(builder.setRoomCeiling(ROOM.a)).toBe(true);
    expect(materialOf(root, `ceiling-${ROOM.a}`)).toBe(shared);
    expect(disposed).toBe(0);
    builder.dispose();
    expect(disposed).toBe(1);
  });

  test('junction cores are flat in the default wall colour, without a generated map', () => {
    const { root } = bare();
    let cores = 0;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData['wallJoint'] !== true) return;
      cores += 1;
      expect(hexOf(object.material as THREE.Material)).toBe(firstFrameHex(DEFAULT_WALL_FINISH));
      expect((object.material as THREE.MeshStandardMaterial).map).toBeNull();
    });
    expect(cores).toBeGreaterThan(0);
  });

  test('a room whose floor names nothing the scene knows falls back to the default floor through the library', () => {
    const scene = draftOf(lShapePlan) as SceneData;
    (scene.rooms[0] as { floorMaterial: string }).floorMaterial = '01a167f6-040a-72e4-9504-fef48f8fd18d';
    const { root } = bare(scene);
    expect(isLibrary(materialOf(root, `floor-${ROOM.a}`), FINISH.oak)).toBe(true);
  });

  test('furniture in the bank plaster is not drawn as the default-ceiling library material', () => {
    const { root } = bare();
    const furniture: THREE.Material[] = [];
    root.traverse((group) => {
      if (group.userData['assetId'] !== L_SHAPE.asset.sofa) return;
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) furniture.push(object.material as THREE.Material);
      });
    });
    expect(furniture.length).toBeGreaterThan(0);
    for (const material of furniture) expect(isLibrary(material, FINISH.plaster_white)).toBe(false);
  });
});
