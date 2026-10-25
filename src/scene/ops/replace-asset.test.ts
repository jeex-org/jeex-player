/**
 * `replace_asset`: a placement takes another asset and keeps its id, room,
 * position, yaw and mirror; everything that belonged to the old body goes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { ARCHETYPE } from '../../assets/catalogue-ids.js';
import { libraryOf } from '../../assets/project-manifest.js';
import { parseProjectLibrary } from '../../assets/project-manifest.schema.js';
import { draftOf, type Draft } from '../../shared/committed.js';
import { opDraft } from '../../fixtures/op-drafts.js';
import { L_SHAPE } from '../../fixtures/plan-l-shape-ids.js';
import { FINISH } from '../../materials/finish-ids.js';
import { OFFERS_FIXTURE as OFFERS } from '../../../tests/fixtures/offers/fixture-ids.js';
import { registriesFromLibrary } from '../registries.js';
import { applyOp, OpError } from '../scene-ops.js';
import { SceneModel } from '../scene-model.js';
import type { DemoAsset, SceneData, SceneOp } from '../types.js';

const OFFERS_DIR = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'offers');
const offers = parseProjectLibrary(JSON.parse(readFileSync(join(OFFERS_DIR, 'library.json'), 'utf8')) as unknown);
const REGISTRIES = registriesFromLibrary(libraryOf(offers), CATALOGUE_REGISTRIES);

const SOFA = L_SHAPE.asset.sofa;
/** A vase standing on a table, placed by the tests below; minted offline. */
const VASE = '01a1f5aa-1024-70de-b917-99e2786d3748';

function placement(scene: Draft<SceneData>, id: string): DemoAsset {
  const found = scene.assets.find((asset) => asset.id === id);
  if (!found) throw new Error(`no placement ${id}`);
  return found;
}

function refused(scene: Draft<SceneData>, op: SceneOp): OpError {
  try {
    applyOp(scene, op, REGISTRIES);
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error('expected the op to be refused');
}

/** The L-shape with its sofa dressed the way a hand edit leaves it: finishes, a scale, a collision box, a mirror. */
function dressedDraft(): Draft<SceneData> {
  const scene = opDraft();
  const sofa = scene.assets.find((asset) => asset.id === SOFA)!;
  sofa.finishes = { upholstery: FINISH.plaster_white };
  sofa.scale = 1.1;
  sofa.collision = { hx: 1, hz: 0.5 };
  sofa.mirror = { x: true };
  sofa.rotationY = 0.5;
  return scene;
}

describe('replace_asset', () => {
  test('keeps id, room, position, yaw and mirror; names the new asset and library; drops the old body', () => {
    const scene = dressedDraft();
    const before = placement(scene, SOFA);
    applyOp(scene, { op: 'replace_asset', assetId: SOFA, asset: OFFERS.asset.longSofa, library: OFFERS.library }, REGISTRIES);
    const after = placement(scene, SOFA);
    expect(after.id).toBe(SOFA);
    expect(after.position).toEqual(before.position);
    expect(after.rotationY).toBe(0.5);
    expect(after.mirror).toEqual({ x: true });
    expect(after.room).toBe(before.room);
    expect(after.asset).toBe(OFFERS.asset.longSofa);
    expect(after.type).toBe(OFFERS.asset.longSofa);
    expect(after.library).toBe(OFFERS.library);
    for (const gone of ['variant', 'finishes', 'material', 'scale', 'collision'] as const) expect(gone in after).toBe(false);
    expect(scene.assets).toHaveLength(opDraft().assets.length);
  });

  test('names the variant when one is given, and removes a library when none is', () => {
    const scene = opDraft();
    applyOp(
      scene,
      { op: 'replace_asset', assetId: SOFA, asset: OFFERS.asset.longSofa, library: OFFERS.library, variant: OFFERS.variant.longSofa[19] },
      REGISTRIES,
    );
    expect(placement(scene, SOFA).variant).toBe(OFFERS.variant.longSofa[19]);
    applyOp(scene, { op: 'replace_asset', assetId: SOFA, asset: ARCHETYPE.armchair }, REGISTRIES);
    expect('library' in placement(scene, SOFA)).toBe(false);
    expect(placement(scene, SOFA).asset).toBe(ARCHETYPE.armchair);
  });

  test('an on-surface vase keeps its height: the position is copied, never reseated', () => {
    const scene = opDraft();
    // As a document stores it: standing on the table, 0.75 m up (`place_object` would seat it on the floor).
    scene.assets.push({
      id: VASE,
      type: OFFERS.asset.budVase,
      asset: OFFERS.asset.budVase,
      library: OFFERS.library,
      position: { x: 8, y: 0.75, z: 2.5 },
    });
    applyOp(scene, { op: 'replace_asset', assetId: VASE, asset: OFFERS.asset.tableLamp, library: OFFERS.library }, REGISTRIES);
    expect(placement(scene, VASE).position.y).toBe(0.75);
  });

  test('refuses an unknown placement, asset or library and a variant of another asset', () => {
    const scene = opDraft();
    const unknownId = '01a1f5aa-1025-7421-999e-3e9c8fe21da8';
    expect(refused(scene, { op: 'replace_asset', assetId: unknownId, asset: ARCHETYPE.armchair }).message).toContain(unknownId);
    expect(refused(scene, { op: 'replace_asset', assetId: SOFA, asset: unknownId }).message).toContain(unknownId);
    expect(refused(scene, { op: 'replace_asset', assetId: SOFA, asset: OFFERS.asset.longSofa, library: unknownId }).message).toContain(
      unknownId,
    );
    expect(
      refused(scene, {
        op: 'replace_asset',
        assetId: SOFA,
        asset: OFFERS.asset.longSofa,
        library: OFFERS.library,
        variant: OFFERS.variant.hallBench,
      }).message,
    ).toContain(OFFERS.variant.hallBench);
    expect(scene).toEqual(opDraft());
  });

  test('refuses a different anchor pair: a floor sofa never becomes a pendant or an on-surface vase', () => {
    const scene = opDraft();
    expect(refused(scene, { op: 'replace_asset', assetId: SOFA, asset: ARCHETYPE.pendant }).message).toContain('anchor');
    expect(refused(scene, { op: 'replace_asset', assetId: SOFA, asset: OFFERS.asset.budVase, library: OFFERS.library }).message).toContain(
      'anchor',
    );
    expect(placement(scene, SOFA).type).toBe('sofa');
  });

  test('refuses a target whose mirror facts forbid the mirror the placement carries', () => {
    const scene = dressedDraft();
    const error = refused(scene, { op: 'replace_asset', assetId: SOFA, asset: OFFERS.asset.hallBench, library: OFFERS.library });
    expect(error.detail).toMatchObject({ reason: 'mirror_not_allowed', op: 'replace_asset' });
    expect(placement(scene, SOFA).type).toBe('sofa');
  });

  test('one revision, and presets forget the variant and finish edits they recorded for the placement', () => {
    const scene = draftOf(opDraft() as SceneData);
    const presetId = '01a1f5aa-1026-7027-8815-fe85df2fbdaa';
    const sofaVariant = CATALOGUE_REGISTRIES.variantsForPlacement(placement(scene, SOFA))[1]!.id;
    scene.interiors = [
      {
        id: presetId,
        name: 'Evening',
        swatch: [FINISH.oak, FINISH.white],
        ops: [
          { op: 'replace_asset_variant', assetId: SOFA, variant: sofaVariant },
          { op: 'set_object', assetId: SOFA, finishes: { upholstery: FINISH.plaster_white } },
          // A scale belongs to the old body too: the op drops it from the placement.
          { op: 'set_object', assetId: SOFA, scale: 1.1 },
          { op: 'set_object', assetId: L_SHAPE.asset.table, material: FINISH.oak },
        ],
      },
    ];
    const model = SceneModel.load(scene, REGISTRIES);
    const rev = model.rev;
    const result = model.apply({
      baseRev: rev,
      ops: [{ op: 'replace_asset', assetId: SOFA, asset: OFFERS.asset.longSofa, library: OFFERS.library }],
    });
    expect(result).toHaveProperty('rev', rev + 1);
    const ops = model.scene.interiors?.[0]?.ops ?? [];
    expect(ops.some((op) => op.op === 'replace_asset_variant' && op.assetId === SOFA)).toBe(false);
    expect(ops.some((op) => op.op === 'set_object' && op.assetId === SOFA)).toBe(false);
    expect(ops.some((op) => op.op === 'set_object' && op.assetId === L_SHAPE.asset.table)).toBe(true);
  });
});
