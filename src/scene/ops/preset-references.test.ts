/**
 * Interior presets after an edit that removes or cuts what they dress.
 *
 * A preset is a batch of ordinary operations the validator dry-runs, so an
 * instruction naming something the edit took away would veto the edit itself.
 * A removal forgets every instruction that names what it removed, whatever
 * the operation kind; a split loses nothing, so it rewrites them onto the two
 * halves instead.
 */

import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { ARCHETYPE, OPENING_VARIANT, VARIANT } from '../../assets/catalogue-ids.js';
import { lShapePlan } from '../../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../../materials/finish-ids.js';
import { SceneModel } from '../scene-model.js';
import type { SceneData, SceneOp } from '../types.js';

/** Ids the tests mint, offline like every fixture id. */
const NEW = {
  preset: '01a1f6c0-2b10-7a00-9e00-000000000001',
  node: '01a1f6c0-2b10-7a00-9e00-000000000002',
  first: '01a1f6c0-2b10-7a00-9e00-000000000003',
  second: '01a1f6c0-2b10-7a00-9e00-000000000004',
  nodeE: '01a1f6c0-2b10-7a00-9e00-000000000005',
  firstE: '01a1f6c0-2b10-7a00-9e00-000000000006',
  secondE: '01a1f6c0-2b10-7a00-9e00-000000000007',
} as const;

const { sofa: SOFA, table: TABLE } = L_SHAPE.asset;
const { doorAb: DOOR, windowBEast: WINDOW } = L_SHAPE.opening;

/** The L-shape with one preset holding `ops` and one keeping the table, so a forgotten preset is still a preset list. */
function withPreset(ops: readonly SceneOp[]): SceneData {
  return {
    ...lShapePlan,
    interiors: [
      {
        id: NEW.preset,
        name: 'Warm',
        swatch: [FINISH.oak, FINISH.sand],
        ops: [...ops, { op: 'set_object', assetId: TABLE, material: FINISH.oak }],
      },
    ],
  };
}

function commit(scene: SceneData, ops: readonly SceneOp[]): SceneModel {
  const model = SceneModel.load(scene, CATALOGUE_REGISTRIES);
  const result = model.apply({ baseRev: model.rev, ops });
  expect(result).toMatchObject({ rev: 1 });
  return model;
}

function presetOps(model: SceneModel): readonly SceneOp[] {
  return model.scene.interiors?.[0]?.ops ?? [];
}

describe('a removal forgets every preset instruction that names what it removed', () => {
  const ASSET_OPS: readonly SceneOp[] = [
    { op: 'replace_asset_variant', assetId: SOFA, variant: VARIANT.sofa_3s_boucle },
    { op: 'replace_asset', assetId: SOFA, asset: ARCHETYPE.sofa_3s },
    { op: 'set_object', assetId: SOFA, material: FINISH.oak },
    { op: 'move_object', assetId: SOFA, position: { x: 2, y: 0, z: 5 } },
    { op: 'rotate_object', assetId: SOFA, rotationY: 1 },
    { op: 'mirror_object', assetId: SOFA, mirror: {} },
  ];
  for (const named of ASSET_OPS) {
    test(`remove_object takes a preset ${named.op} on the placement with it`, () => {
      const model = commit(withPreset([named]), [{ op: 'remove_object', assetId: SOFA }]);
      expect(presetOps(model)).toEqual([{ op: 'set_object', assetId: TABLE, material: FINISH.oak }]);
    });
  }

  const OPENING_OPS: readonly SceneOp[] = [
    { op: 'replace_opening_variant', openingId: DOOR, variant: OPENING_VARIANT.door_oak_panelled_knob },
    { op: 'set_opening', openingId: DOOR, width: 1 },
  ];
  for (const named of OPENING_OPS) {
    test(`remove_opening takes a preset ${named.op} on the opening with it`, () => {
      const model = commit(withPreset([named]), [{ op: 'remove_opening', openingId: DOOR }]);
      expect(presetOps(model)).toEqual([{ op: 'set_object', assetId: TABLE, material: FINISH.oak }]);
    });

    test(`remove_wall takes a preset ${named.op} on an opening of the wall with it`, () => {
      const model = commit(withPreset([named]), [{ op: 'remove_wall', wallId: L_SHAPE.wall.wPart }]);
      expect(presetOps(model)).toEqual([{ op: 'set_object', assetId: TABLE, material: FINISH.oak }]);
    });
  }
});

describe('split_wall rewrites the preset instructions on the wall onto both halves', () => {
  const SPLIT_SB: SceneOp = { op: 'split_wall', wallId: L_SHAPE.wall.wSB, at: 1, nodeId: NEW.node, ids: [NEW.first, NEW.second] };

  test('a face paint and a set_wall become one per half, same owner and side', () => {
    const model = commit(
      withPreset([
        { op: 'set_material', target: { room: L_SHAPE.room.b, wallId: L_SHAPE.wall.wSB, side: 'L' }, material: FINISH.sand },
        { op: 'set_wall', wallId: L_SHAPE.wall.wSB, thickness: 0.25 },
      ]),
      [SPLIT_SB],
    );
    expect(presetOps(model)).toEqual([
      { op: 'set_material', target: { room: L_SHAPE.room.b, wallId: NEW.first, side: 'L' }, material: FINISH.sand },
      { op: 'set_material', target: { room: L_SHAPE.room.b, wallId: NEW.second, side: 'L' }, material: FINISH.sand },
      { op: 'set_wall', wallId: NEW.first, thickness: 0.25 },
      { op: 'set_wall', wallId: NEW.second, thickness: 0.25 },
      { op: 'set_object', assetId: TABLE, material: FINISH.oak },
    ]);
  });

  test('a set_opening that puts an opening on the wall lands on the half its centre falls in, measured from that half', () => {
    const model = commit(withPreset([{ op: 'set_opening', openingId: WINDOW, wallId: L_SHAPE.wall.wE, center: 4.5 }]), [
      { op: 'split_wall', wallId: L_SHAPE.wall.wE, at: 4, nodeId: NEW.nodeE, ids: [NEW.firstE, NEW.secondE] },
    ]);
    const moved = presetOps(model)[0];
    expect(moved).toMatchObject({ op: 'set_opening', openingId: WINDOW, wallId: NEW.secondE });
    expect((moved as { center: number }).center).toBeCloseTo(0.5, 9);
  });

  test('a set_opening without a centre on an opening of the wall follows the opening to its half', () => {
    // The east window sits at 2.5 m; cut at 1 m it lands on the second half.
    const model = commit(withPreset([{ op: 'set_opening', openingId: WINDOW, wallId: L_SHAPE.wall.wE, width: 1.2 }]), [
      { op: 'split_wall', wallId: L_SHAPE.wall.wE, at: 1, nodeId: NEW.nodeE, ids: [NEW.firstE, NEW.secondE] },
    ]);
    expect(presetOps(model)[0]).toEqual({ op: 'set_opening', openingId: WINDOW, wallId: NEW.secondE, width: 1.2 });
  });
});
