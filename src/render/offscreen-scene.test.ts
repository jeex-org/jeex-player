import { describe, expect, test } from 'bun:test';
import { documentForState } from './offscreen-scene.js';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import type { SceneData } from '../scene/types.js';

/** The demo apartment with something painted and something re-finished, as a repaint would leave it. */
function painted(): SceneData {
  return {
    ...apartmentScene,
    finishes: {
      rooms: { [DEMO.room.living]: { floor: FINISH.chevron, walls: FINISH.sage } },
      faces: [{ room: DEMO.room.living, wallId: DEMO.wall.bayLiving, side: 'L', finish: FINISH.terra }],
      facade: FINISH.white,
    },
    assets: apartmentScene.assets.map((asset, index) =>
      index === 0 ? { ...asset, material: FINISH.boucle_ivory, finishes: { seat: FINISH.boucle_ivory } } : asset,
    ),
  };
}

describe('documentForState', () => {
  test('the current state is the committed document itself', () => {
    const scene = painted();
    expect(documentForState(scene, 'current')).toEqual(scene);
  });

  test('the default state drops the painted finishes', () => {
    const scene = documentForState(painted(), 'default');
    expect(scene.finishes).toBeUndefined();
  });

  test('the default state drops every asset finish and material override', () => {
    const scene = documentForState(painted(), 'default');
    for (const asset of scene.assets) {
      expect(asset.finishes).toBeUndefined();
      expect(asset.material).toBeUndefined();
    }
  });

  test('the default state changes nothing else: plan, assets, cameras and tour are the document’s own', () => {
    const source = painted();
    const scene = documentForState(source, 'default');
    expect(scene.id).toBe(source.id);
    expect(scene.nodes).toEqual(source.nodes);
    expect(scene.walls).toEqual(source.walls);
    expect(scene.rooms).toEqual(source.rooms);
    expect(scene.presentationCamera).toEqual(source.presentationCamera);
    expect(scene.roomCameras).toEqual(source.roomCameras);
    expect(scene.autotour).toEqual(source.autotour);
    expect(scene.assets.length).toBe(source.assets.length);
    expect(scene.assets.map((asset) => asset.id)).toEqual(source.assets.map((asset) => asset.id));
    expect(scene.assets.map((asset) => asset.position)).toEqual(source.assets.map((asset) => asset.position));
  });

  test('the source document is not mutated', () => {
    const source = painted();
    documentForState(source, 'default');
    expect(source.finishes).toBeDefined();
    expect(source.assets[0]?.material).toBe(FINISH.boucle_ivory);
  });

  test('a document with nothing painted is unchanged by the default state', () => {
    const bare = documentForState(apartmentScene, 'default');
    expect(bare.finishes).toBeUndefined();
    expect(documentForState(bare, 'default')).toEqual(bare);
  });
});
