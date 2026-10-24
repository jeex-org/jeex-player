/**
 * The single resolver has to answer for both catalogues and for the ids the
 * demo scene actually uses, because `SceneData.materials[]` does not declare
 * them.
 */

import { describe, expect, test } from 'bun:test';
import { finishColorOf, isKnownFinish, resolveFinish, resolveSurfaceFinish } from './material-catalogue.js';
import { FLOOR_FINISHES, WALL_FINISHES } from './finish-catalogue.js';
import { apartmentScene } from '../demo/scene-data.js';
import type { MaterialDefinition } from '../scene/types.js';
import { FINISH } from './finish-ids.js';

/** A scene's own material: an id neither catalogue carries. */
const UNOBTANIUM = '01a12fed-dd96-7016-b64a-76f2b73c299e';
/** A well-formed id nothing declares. */
const NOPE = '01a12fed-dd97-7109-8801-5953696aa1a5';
const LOCAL: MaterialDefinition[] = [{ id: UNOBTANIUM, name: 'Unobtanium', color: '#ff00ff', roughness: 0.5 }];

describe('resolveFinish', () => {
  test('surface finishes resolve first and carry their catalogue entry', () => {
    const oak = resolveFinish(FINISH.oak);
    expect(oak?.source).toBe('surface');
    expect(oak?.color).toBe('#83654c');
    expect(oak?.source === 'surface' && oak.finish.kind).toBe('planks');
  });

  test('object finishes resolve by their UUID, and a 1.x alias word by nothing', () => {
    const linen = resolveFinish(FINISH.linen_sand);
    expect(linen?.source).toBe('object');
    expect(linen?.id).toBe(FINISH.linen_sand);
    expect(resolveFinish('linen')).toBeNull();
  });

  test('a scene override adds an id without shadowing a catalogue one', () => {
    expect(resolveFinish(UNOBTANIUM)).toBeNull();
    expect(resolveFinish(UNOBTANIUM, LOCAL)?.source).toBe('scene');
    // Oak exists in the surface catalogue, so an override with its id loses.
    const shadow: MaterialDefinition[] = [{ id: FINISH.oak, name: 'Fake oak', color: '#000000', roughness: 1 }];
    expect(resolveFinish(FINISH.oak, shadow)?.source).toBe('surface');
  });

  test('an unknown or empty id resolves to null', () => {
    expect(resolveFinish(undefined)).toBeNull();
    expect(resolveFinish('')).toBeNull();
    expect(resolveFinish(NOPE)).toBeNull();
    expect(isKnownFinish(NOPE)).toBe(false);
    expect(isKnownFinish(NOPE, LOCAL)).toBe(false);
    expect(isKnownFinish(UNOBTANIUM, LOCAL)).toBe(true);
  });

  test('finishColorOf gives a chip colour for every source', () => {
    expect(finishColorOf(FINISH.sage)).toBe('#8f9574');
    expect(finishColorOf(FINISH.brass_soft)).toBeTruthy();
    expect(finishColorOf(UNOBTANIUM, LOCAL)).toBe('#ff00ff');
    expect(finishColorOf(NOPE)).toBeNull();
  });
});

describe('resolveSurfaceFinish', () => {
  test('accepts every paintable finish and nothing else', () => {
    for (const finish of [...FLOOR_FINISHES, ...WALL_FINISHES]) {
      expect(resolveSurfaceFinish(finish.id)?.id).toBe(finish.id);
    }
    // An object finish resolves, but is not paintable on a room surface.
    expect(resolveFinish(FINISH.linen_sand)).not.toBeNull();
    expect(resolveSurfaceFinish(FINISH.linen_sand)).toBeNull();
    expect(resolveSurfaceFinish(undefined)).toBeNull();
  });
});

describe('the demo scene needs no materials[] of its own', () => {
  test('every id the apartment references resolves through the catalogues', () => {
    expect(apartmentScene.materials).toBeUndefined();
    for (const room of apartmentScene.rooms) {
      expect(resolveSurfaceFinish(room.floorMaterial)).not.toBeNull();
    }
    for (const asset of apartmentScene.assets) {
      if (!asset.material) continue;
      expect(isKnownFinish(asset.material)).toBe(true);
    }
    // The ceiling paint the shell builder asks for.
    expect(resolveFinish(FINISH.plaster_white)).not.toBeNull();
  });
});
