import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { draftOf } from '../shared/committed.js';

import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { apartmentScene } from '../demo/scene-data.js';
import { activeVariantFor } from '../assets/asset-variants.js';
import { defaultOpeningVariant } from '../assets/opening-variants.js';
import { SceneModel, isApplyOk } from './scene-model.js';
import { faceFinishOf, floorFinishOf, roomWallFinishOf } from './scene-ops.js';
import { applyPresetBatch, findPreset, presetBatchOps, presetCoverage, standardPreset } from './interior-presets.js';
import { faceKey, sameFace, type FaceKey, type SceneData } from './types.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { DEMO } from '../demo/demo-ids.js';
import { OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import type { Draft } from '../shared/committed.js';
import type { InteriorPreset } from './scene-ops.js';

/** Ids of the presets these tests author, generated once offline. */
const PRESET = {
  warm: '01a12ff4-c345-7a52-ab1c-b343e7df9f27',
  floorOnly: '01a12ff4-c346-75a2-a470-79c89af8240d',
  doors: '01a12ff4-c347-7c93-b63e-78809a6bde3c',
  doorOnly: '01a12ff4-c348-768f-80fe-ec9e2d4ca51c',
  /** Never declared by any scene. */
  unknown: '01a12ff4-c349-71d3-8692-a2c4168d5997',
} as const;

const ROOM_A = L_SHAPE.room.a;
const ROOM_B = L_SHAPE.room.b;
const SOFA = L_SHAPE.asset.sofa;
const DOOR_AB = L_SHAPE.opening.doorAb;

/** The finish a face wears in a document's `finishes.faces`, or `undefined`. */
function paintedFinish(document: SceneData, face: FaceKey): string | undefined {
  return document.finishes?.faces?.find((entry) => sameFace(entry, face))?.finish;
}

/** Repaints room `a` completely and swaps the sofa. */
const WARM: InteriorPreset = {
  id: PRESET.warm,
  name: 'Warm walnut',
  swatch: [FINISH.walnut, FINISH.terra],
  ops: [
    { op: 'set_material', target: ROOM_A, material: FINISH.walnut },
    { op: 'set_material', target: ROOM_A, material: FINISH.terra },
    { op: 'replace_asset_variant', assetId: SOFA, variant: VARIANT.sofa_3s_boucle },
    { op: 'replace_opening_variant', openingId: DOOR_AB, variant: OPENING_VARIANT.door_oak_panelled_knob },
  ],
};

/** Re-floors room `a` only: its walls are never repainted. */
const FLOOR_ONLY: InteriorPreset = {
  id: PRESET.floorOnly,
  name: 'New floor only',
  swatch: [FINISH.ash, FINISH.white],
  ops: [{ op: 'set_material', target: ROOM_A, material: FINISH.ash }],
};

function scene(presets: readonly InteriorPreset[] = [WARM, FLOOR_ONLY]): Draft<SceneData> {
  const copy = draftOf(lShapePlan);
  copy.interiors = presets.map((preset) => draftOf(preset));
  return copy;
}

describe('preset lookup', () => {
  test('finds a preset by id and reports the standard one first', () => {
    const document = scene();
    expect(findPreset(document, PRESET.floorOnly)?.name).toBe('New floor only');
    expect(standardPreset(document)?.id).toBe(PRESET.warm);
  });

  test('an unknown id is null, and a scene without presets has no standard', () => {
    expect(findPreset(scene(), PRESET.unknown)).toBeNull();
    expect(standardPreset(draftOf(lShapePlan))).toBeNull();
  });
});

describe('presetCoverage', () => {
  test('lists the rooms, placements and openings the preset touches', () => {
    expect(presetCoverage(scene(), WARM)).toEqual({
      rooms: [ROOM_A],
      assets: [SOFA],
      openings: [DOOR_AB],
      faces: [],
    });
  });

  test('the "floors" and "walls" aliases cover every room', () => {
    const global: InteriorPreset = {
      ...WARM,
      ops: [{ op: 'set_material', target: 'floors', material: FINISH.ash }],
    };
    expect(presetCoverage(scene(), global).rooms).toEqual([ROOM_A, ROOM_B]);
  });

  test('a face target credits its owner room and records the face', () => {
    const face = faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L');
    const faceOp: InteriorPreset = {
      ...WARM,
      ops: [{ op: 'set_material', target: face, material: FINISH.graphite, scope: 'face' }],
    };
    expect(presetCoverage(scene(), faceOp)).toEqual({
      rooms: [ROOM_A],
      assets: [],
      openings: [],
      faces: [face],
    });
  });

  test('a facade face target credits no room', () => {
    const facadeOp: InteriorPreset = {
      ...WARM,
      ops: [{ op: 'set_material', target: faceKey(null, L_SHAPE.wall.wSA, 'R'), material: FINISH.graphite, scope: 'face' }],
    };
    expect(presetCoverage(scene(), facadeOp).rooms).toEqual([]);
  });
});

describe('applyPresetBatch', () => {
  test('applies the whole look as exactly one revision', () => {
    const model = new SceneModel(scene(), CATALOGUE_REGISTRIES);
    const result = applyPresetBatch(model, PRESET.warm, 'test');
    expect(isApplyOk(result)).toBe(true);
    expect(model.rev).toBe(1);
    expect(floorFinishOf(model.scene, ROOM_A)).toBe(FINISH.walnut);
    expect(roomWallFinishOf(model.scene, ROOM_A)).toBe(FINISH.terra);
    expect(model.scene.assets.find((asset) => asset.id === SOFA)?.variant).toBe(VARIANT.sofa_3s_boucle);
  });

  test('refuses an unknown preset without touching the scene', () => {
    const model = new SceneModel(scene(), CATALOGUE_REGISTRIES);
    const result = applyPresetBatch(model, PRESET.unknown);
    expect(result).toEqual({ error: 'validation_failed', message: `Unknown interior preset ${PRESET.unknown}` });
    expect(model.rev).toBe(0);
  });

  test('leaves the presets themselves in the committed document', () => {
    const model = new SceneModel(scene(), CATALOGUE_REGISTRIES);
    applyPresetBatch(model, PRESET.warm);
    expect(model.toJSON().interiors?.map((preset) => preset.id)).toEqual([PRESET.warm, PRESET.floorOnly]);
  });
});

describe('per-face overrides do not survive a preset', () => {
  const face = faceKey(ROOM_A, L_SHAPE.wall.wPart, 'L');

  test('a preset that repaints the room clears them through set_material itself', () => {
    const model = new SceneModel(scene(), CATALOGUE_REGISTRIES);
    expect(
      isApplyOk(
        model.apply({
          baseRev: model.rev,
          ops: [{ op: 'set_material', target: face, material: FINISH.graphite, scope: 'face' }],
        }),
      ),
    ).toBe(true);
    expect(paintedFinish(model.scene, face)).toBe(FINISH.graphite);

    expect(isApplyOk(applyPresetBatch(model, PRESET.warm))).toBe(true);
    expect(paintedFinish(model.scene, face)).toBeUndefined();
  });

  test('a preset that only re-floors the room gets an explicit reset appended', () => {
    const model = new SceneModel(scene(), CATALOGUE_REGISTRIES);
    model.apply({
      baseRev: model.rev,
      ops: [{ op: 'set_material', target: face, material: FINISH.graphite, scope: 'face' }],
    });
    const wallBefore = roomWallFinishOf(model.scene, ROOM_A);

    const batch = presetBatchOps(model.scene, FLOOR_ONLY, CATALOGUE_REGISTRIES);
    expect(batch).toEqual([
      { op: 'set_material', target: ROOM_A, material: FINISH.ash },
      { op: 'set_material', target: ROOM_A, material: wallBefore },
    ]);

    expect(isApplyOk(applyPresetBatch(model, PRESET.floorOnly))).toBe(true);
    expect(paintedFinish(model.scene, face)).toBeUndefined();
    // The reset repaints with the finish the room already had: nothing else moves.
    expect(roomWallFinishOf(model.scene, ROOM_A)).toBe(wallBefore);
    expect(floorFinishOf(model.scene, ROOM_A)).toBe(FINISH.ash);
  });

  test('a face of a room the preset never touches keeps its override', () => {
    const model = new SceneModel(scene(), CATALOGUE_REGISTRIES);
    const otherFace = faceKey(ROOM_B, L_SHAPE.wall.wPart, 'R');
    model.apply({
      baseRev: model.rev,
      ops: [{ op: 'set_material', target: otherFace, material: FINISH.graphite, scope: 'face' }],
    });
    expect(isApplyOk(applyPresetBatch(model, PRESET.warm))).toBe(true);
    expect(paintedFinish(model.scene, otherFace)).toBe(FINISH.graphite);
  });

  test('nothing is appended when no face carries an override', () => {
    const model = new SceneModel(scene(), CATALOGUE_REGISTRIES);
    expect(presetBatchOps(model.scene, FLOOR_ONLY, CATALOGUE_REGISTRIES)).toEqual([...FLOOR_ONLY.ops]);
  });
});

describe('the four demo interiors', () => {
  const presets = apartmentScene.interiors ?? [];

  /** Every finish and variant the presets can move, as the plan ships them. */
  function shippedLook(document: SceneData): Record<string, string | null> {
    const look: Record<string, string | null> = {};
    for (const room of document.rooms) {
      look[`floor:${room.id}`] = floorFinishOf(document, room.id);
      look[`walls:${room.id}`] = roomWallFinishOf(document, room.id);
    }
    for (const placement of document.assets) look[`asset:${placement.id}`] = activeVariantFor(placement);
    for (const wall of document.walls) {
      for (const opening of wall.openings ?? []) {
        look[`opening:${opening.id}`] = opening.variant ?? defaultOpeningVariant(opening.type, opening.entrance).id;
      }
    }
    return look;
  }

  test('there are four of them and the first is the shipped standard', () => {
    expect(presets).toHaveLength(4);
    expect(standardPreset(apartmentScene)?.id).toBe(DEMO.preset.oakSand);
  });

  test('every preset applies to a fresh model as one revision', () => {
    for (const preset of presets) {
      const model = new SceneModel(apartmentScene, CATALOGUE_REGISTRIES);
      const result = applyPresetBatch(model, preset.id);
      expect({ preset: preset.id, ok: isApplyOk(result) }).toEqual({ preset: preset.id, ok: true });
      expect(model.rev).toBe(1);
    }
  });

  test("the living room lands on the pair the preset's swatch advertises", () => {
    for (const preset of presets) {
      const model = new SceneModel(apartmentScene, CATALOGUE_REGISTRIES);
      applyPresetBatch(model, preset.id);
      expect({
        preset: preset.id,
        floor: floorFinishOf(model.scene, DEMO.room.living),
        walls: roomWallFinishOf(model.scene, DEMO.room.living),
      }).toEqual({ preset: preset.id, floor: preset.swatch[0], walls: preset.swatch[1] });
    }
  });

  test('the bedroom walls follow the preset, not the living room', () => {
    const expected = [FINISH.sand, FINISH.white, FINISH.terra, FINISH.wallpaper_sage];
    presets.forEach((preset, index) => {
      const model = new SceneModel(apartmentScene, CATALOGUE_REGISTRIES);
      applyPresetBatch(model, preset.id);
      expect({ preset: preset.id, walls: roomWallFinishOf(model.scene, DEMO.room.bedroom) }).toEqual({
        preset: preset.id,
        walls: expected[index]!,
      });
    });
  });

  test('presets 2 to 4 differ from each other in the living floor or the living walls', () => {
    const pairs = presets.slice(1).map((preset) => `${preset.swatch[0]}/${preset.swatch[1]}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test('every preset dresses at least 70 % of the placements', () => {
    const floor = Math.ceil(apartmentScene.assets.length * 0.7);
    for (const preset of presets) {
      const coverage = presetCoverage(apartmentScene, preset);
      expect({ preset: preset.id, enough: coverage.assets.length >= floor }).toEqual({ preset: preset.id, enough: true });
      for (const assetId of coverage.assets) {
        expect(apartmentScene.assets.some((placement) => placement.id === assetId)).toBe(true);
      }
    }
  });

  test('every preset also re-fills every window and door', () => {
    const openings = apartmentScene.walls.flatMap((wall) => (wall.openings ?? []).map((opening) => opening.id));
    for (const preset of presets) {
      expect({ preset: preset.id, openings: [...presetCoverage(apartmentScene, preset).openings].sort() }).toEqual({
        preset: preset.id,
        openings: [...openings].sort(),
      });
    }
  });

  test('a preset drops the per-face overrides of the rooms it repaints', () => {
    const model = new SceneModel(apartmentScene, CATALOGUE_REGISTRIES);
    const face = [...model.plan.faces.keys()].find((key) => key.room === DEMO.room.living)!;
    expect(
      isApplyOk(
        model.apply({
          baseRev: model.rev,
          ops: [{ op: 'set_material', target: face, material: FINISH.graphite, scope: 'face' }],
        }),
      ),
    ).toBe(true);
    expect(paintedFinish(model.scene, face)).toBe(FINISH.graphite);

    expect(isApplyOk(applyPresetBatch(model, DEMO.preset.sageGraphite))).toBe(true);
    expect(paintedFinish(model.scene, face)).toBeUndefined();
    expect(faceFinishOf(model.scene, face)).toBe(FINISH.sage);
  });

  test('preset 1 after preset 3 puts every finish and variant back to the standard', () => {
    const shipped = shippedLook(apartmentScene);
    const model = new SceneModel(apartmentScene, CATALOGUE_REGISTRIES);
    expect(isApplyOk(applyPresetBatch(model, DEMO.preset.walnutTerracotta))).toBe(true);
    // Sanity: the warm preset really did move things.
    expect(shippedLook(model.scene)).not.toEqual(shipped);

    expect(isApplyOk(applyPresetBatch(model, DEMO.preset.oakSand))).toBe(true);
    expect(shippedLook(model.scene)).toEqual(shipped);
  });
});

describe('removing an opening a preset dressed', () => {
  const DRESSES_DOOR: InteriorPreset = {
    id: PRESET.doors,
    name: 'Oak doors',
    swatch: [FINISH.oak, FINISH.sand],
    ops: [
      { op: 'set_material', target: ROOM_A, material: FINISH.oak },
      { op: 'replace_opening_variant', openingId: DOOR_AB, variant: OPENING_VARIANT.door_oak_panelled_knob },
    ],
  };
  const DOOR_ONLY: InteriorPreset = {
    id: PRESET.doorOnly,
    name: 'Nothing but the door',
    swatch: [FINISH.oak, FINISH.sand],
    ops: [{ op: 'replace_opening_variant', openingId: DOOR_AB, variant: OPENING_VARIANT.door_glass_slim }],
  };

  // The plan wins over the decoration: a legal `remove_opening` must not be
  // vetoed by a preset that happened to name the hole.
  test('the op leaves the preset, the rest of the preset stays', () => {
    const model = new SceneModel(scene([DRESSES_DOOR]), CATALOGUE_REGISTRIES);
    expect(isApplyOk(model.apply({ baseRev: model.rev, ops: [{ op: 'remove_opening', openingId: DOOR_AB }] }))).toBe(true);
    expect(model.scene.interiors?.[0]?.ops).toEqual([{ op: 'set_material', target: ROOM_A, material: FINISH.oak }]);
    expect(isApplyOk(applyPresetBatch(model, PRESET.doors))).toBe(true);
  });

  test('a preset left with nothing to do goes with it', () => {
    const model = new SceneModel(scene([DRESSES_DOOR, DOOR_ONLY]), CATALOGUE_REGISTRIES);
    model.apply({ baseRev: model.rev, ops: [{ op: 'remove_opening', openingId: DOOR_AB }] });
    expect(model.scene.interiors?.map((preset) => preset.id)).toEqual([PRESET.doors]);
  });
});
