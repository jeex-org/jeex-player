import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { draftOf, type Draft } from '../shared/committed.js';
import { diffScenes, sameBody, sameData } from './scene-diff.js';
import { SceneModel } from './scene-model.js';
import { type SceneOp } from './scene-ops.js';
import { TOUCHED_SHELL, TOUCHED_TOUR_CHECKPOINTS, touchedAsset, touchedCamera, type TouchedEntity } from './ops/context.js';
import type { DemoAsset, SceneData } from './types.js';

const SOFA = L_SHAPE.asset.sofa;
const TABLE = L_SHAPE.asset.table;

function edited(change: (draft: Draft<SceneData>) => void): SceneData {
  const draft = draftOf(lShapePlan);
  change(draft);
  return draft;
}

const sofaOf = (draft: Draft<SceneData>): Draft<DemoAsset> => draft.assets.find((asset) => asset.id === SOFA)!;

describe('diffScenes', () => {
  test('the same document touches nothing', () => {
    expect(diffScenes(lShapePlan, draftOf(lShapePlan))).toEqual([]);
  });

  test('a move, a turn or a mirror of one placement touches that placement alone', () => {
    const moved = edited((draft) => {
      sofaOf(draft).position = { x: 3, y: 0, z: 5 };
      sofaOf(draft).rotationY = 0.5;
      sofaOf(draft).mirror = { x: true };
    });
    expect(diffScenes(lShapePlan, moved)).toEqual([touchedAsset(SOFA)]);
  });

  test('an added and a removed placement are each touched', () => {
    const lamp = '01a1318c-6a3e-7c55-9d0b-3c5f2f6b1a01';
    const next = edited((draft) => {
      draft.assets = [...draft.assets.filter((asset) => asset.id !== TABLE), { ...draftOf(lShapePlan.assets[0]!), id: lamp }];
    });
    expect(diffScenes(lShapePlan, next)).toEqual([touchedAsset(lamp), touchedAsset(TABLE)]);
  });

  test('cameras and the tour name their own entities, never the plan', () => {
    const room = L_SHAPE.room.b;
    const next = edited((draft) => {
      draft.roomCameras[room] = { position: { x: 8, y: 1.6, z: 3 }, target: { x: 9, y: 1.4, z: 3 } };
      draft.tourCheckpoints = [];
    });
    const touched = diffScenes(lShapePlan, next);
    expect(touched).toContainEqual(touchedCamera({ room }));
    expect(touched).not.toContainEqual(TOUCHED_SHELL);
  });

  test('a change the plan is built from is a shell rebuild, whatever else changed with it', () => {
    const next = edited((draft) => {
      draft.ceilingHeight += 0.1;
      sofaOf(draft).rotationY = 1;
    });
    const touched: TouchedEntity[] = diffScenes(lShapePlan, next);
    expect(touched[0]).toEqual(TOUCHED_SHELL);
    expect(touched).toContainEqual(touchedAsset(SOFA));
  });

  test('a key the diff does not know is the plan, never silence', () => {
    const next = { ...lShapePlan, unknownFutureKey: 1 } as unknown as SceneData;
    expect(diffScenes(lShapePlan, next)).toEqual([TOUCHED_SHELL]);
  });

  test('it answers what a tour-checkpoint operation answers', () => {
    const next = edited((draft) => {
      draft.tourCheckpoints = [];
    });
    expect(diffScenes(lShapePlan, next)).toEqual([TOUCHED_TOUR_CHECKPOINTS]);
  });
});

describe('sameBody', () => {
  const sofa = lShapePlan.assets.find((asset) => asset.id === SOFA)!;
  test('where and how a body stands is not what it is', () => {
    expect(
      sameBody(sofa, { ...sofa, position: { x: 9, y: 0, z: 9 }, rotationY: 2, scale: 1.2, mirror: { z: true }, room: L_SHAPE.room.b }),
    ).toBe(true);
  });
  test('the variant, the archetype and the finishes are', () => {
    expect(sameBody(sofa, { ...sofa, variant: '01a1318c-6a40-7e22-9f3b-5c7e1dae8013' })).toBe(false);
    const { material: _material, ...bare } = sofa;
    expect(sameBody(sofa, bare)).toBe(false);
    expect(sameBody(sofa, { ...sofa, finishes: { body: 'x' } })).toBe(false);
  });
  test('an absent field equals an undefined one', () => {
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });
});

describe('SceneModel.replaceDocument', () => {
  const load = (document: SceneData): SceneModel => new SceneModel(document, CATALOGUE_REGISTRIES);

  test('commits the next document as ONE revision and tells listeners what it touched, with no operations', () => {
    const model = load(lShapePlan);
    const heard: Array<{ rev: number; touched: readonly TouchedEntity[]; ops: readonly SceneOp[] }> = [];
    model.onRevision((rev, touched, ops) => heard.push({ rev, touched, ops }));
    const next = load(
      edited((draft) => {
        sofaOf(draft).rotationY = 1;
      }),
    );
    expect(model.replaceDocument(next)).toEqual({ rev: 1, touched: [touchedAsset(SOFA)] });
    expect(heard).toEqual([{ rev: 1, touched: [touchedAsset(SOFA)], ops: [] }]);
    expect(model.scene).toBe(next.scene);
    expect(model.plan).toBe(next.plan);
  });

  test('a change that touches no entity (the name) is still a revision', () => {
    const model = load(lShapePlan);
    const renamed = load({ ...lShapePlan, name: 'swapped through src' });
    expect(model.replaceDocument(renamed)).toEqual({ rev: 1, touched: [] });
    expect(model.scene.name).toBe('swapped through src');
  });

  test('the same document commits nothing', () => {
    const model = load(lShapePlan);
    expect(model.replaceDocument(load(lShapePlan))).toBeNull();
    expect(model.rev).toBe(0);
  });

  test('a listener cannot replace the document while a commit is being heard', () => {
    const model = load(lShapePlan);
    const failures: Error[] = [];
    model.onError((error) => failures.push(error));
    model.onRevision(() => {
      model.replaceDocument(load(lShapePlan));
    });
    model.replaceDocument(
      load(
        edited((draft) => {
          sofaOf(draft).rotationY = 1;
        }),
      ),
    );
    expect(failures.map((error) => error.message)).toEqual([expect.stringContaining('cannot replace the document')]);
    expect(model.rev).toBe(1);
  });
});
