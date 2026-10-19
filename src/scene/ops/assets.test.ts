/**
 * The furniture operations: `place_object`, `move_object`, `rotate_object`,
 * `set_object`, `remove_object`, plus `replace_asset_variant`,
 * which moved here verbatim from `scene-ops.test.ts` when the appliers were
 * split out of it.
 *
 * The theme is the REGISTRIES: which archetype, which variant and which finish
 * exist is a question for the bank the caller injected, and every refusal below
 * is that bank saying no.
 */

import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { describe, expect, test } from 'bun:test';
import { opDraft, rejectsOp } from '../../fixtures/op-drafts.js';
import { applyOp, touchedAsset } from '../scene-ops.js';
import { OBJECT_SCALE } from './limits.js';
import type { Draft } from '../../shared/committed.js';
import type { SceneData, SceneOp } from '../types.js';
import { L_SHAPE } from '../../fixtures/plan-l-shape-ids.js';
import { ARCHETYPE, VARIANT } from '../../assets/catalogue-ids.js';
import { FINISH } from '../../materials/finish-ids.js';
import { OpError } from './context.js';

const SOFA = L_SHAPE.asset.sofa;
const TABLE = L_SHAPE.asset.table;
const ROOM_A = L_SHAPE.room.a;

/** Ids of the placements these tests create (and of things nobody has), minted offline. */
const NEW = {
  sofa: '01a12ff3-0a47-7230-b346-4866d8f47959',
  floorPiece: '01a12ff3-0a48-7769-9a2a-3edd0a720c9b',
  hungPiece: '01a12ff3-0a49-7307-9ab5-f7f7307fc029',
  turned: '01a12ff3-0a4a-7fe7-b479-bdd74f577abd',
  preset: '01a12ff3-0a4b-72ab-8f71-b496274bdde0',
  ghost: '01a12ff3-0a4c-7cdc-b9b0-42fd93866f55',
} as const;

/** A well-formed UUID of version 4: the right shape, the wrong version. */
const UUID_V4 = '3b241101-e2bb-4255-8caf-4136c566a962';

function apply(scene: Draft<SceneData>, op: Parameters<typeof applyOp>[1]): ReturnType<typeof applyOp> {
  return applyOp(scene, op, CATALOGUE_REGISTRIES);
}

describe('replace_asset_variant', () => {
  test('writes the variant the catalogue offers for that placement', () => {
    const scene = opDraft();
    const outcome = applyOp(scene, { op: 'replace_asset_variant', assetId: SOFA, variant: VARIANT.sofa_3s_boucle }, CATALOGUE_REGISTRIES);
    expect(scene.assets.find((asset) => asset.id === SOFA)!.variant).toBe(VARIANT.sofa_3s_boucle);
    expect(outcome.touched).toEqual([touchedAsset(SOFA)]);
  });

  test('rejects an unknown asset and a variant from another archetype', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'replace_asset_variant', assetId: NEW.ghost, variant: VARIANT.sofa_3s_boucle })).toContain(
      'Unknown asset',
    );
    expect(rejectsOp(scene, { op: 'replace_asset_variant', assetId: SOFA, variant: VARIANT.table_dining_oak })).toContain('is not offered');
  });
});

describe('place_object', () => {
  test("places a bare catalogue id under the caller's id and reports archetype, variant, room and position", () => {
    const scene = opDraft();

    const outcome = apply(scene, {
      op: 'place_object',
      id: NEW.sofa,
      asset: ARCHETYPE.sofa_3s,
      variant: VARIANT.sofa_3s_linen,
      room: ROOM_A,
      position: { x: 1.2, y: 0, z: 2.4 },
    });

    expect(scene.assets.at(-1)).toEqual({
      id: NEW.sofa,
      type: ARCHETYPE.sofa_3s,
      asset: ARCHETYPE.sofa_3s,
      variant: VARIANT.sofa_3s_linen,
      room: ROOM_A,
      position: { x: 1.2, y: 0, z: 2.4 },
    });
    expect(outcome.summary).toBe(
      `Object ${NEW.sofa}: placed ${ARCHETYPE.sofa_3s}@${VARIANT.sofa_3s_linen} in ${ROOM_A} at (1.20, 0.00, 2.40)`,
    );
    expect(outcome.touched).toEqual([touchedAsset(NEW.sofa)]);
  });

  test('accepts the qualified `library:asset_uuid` form and keeps it on the placement', () => {
    const scene = opDraft();

    apply(scene, { op: 'place_object', id: NEW.sofa, asset: `starter:interior-v1:${ARCHETYPE.sofa_3s}`, position: { x: 1, y: 0, z: 2 } });

    const placed = scene.assets.at(-1)!;
    expect(placed.asset).toBe(`starter:interior-v1:${ARCHETYPE.sofa_3s}`);
    expect(placed.type).toBe(ARCHETYPE.sofa_3s);
    // No variant was named, so the placement stays on the archetype's default
    // and the summary says which one that is.
    expect(placed.variant).toBeUndefined();
  });

  test('a floor-standing archetype is forced onto the floor; a wall-hung one keeps the height it was given', () => {
    const scene = opDraft();

    apply(scene, { op: 'place_object', id: NEW.floorPiece, asset: ARCHETYPE.sofa_3s, position: { x: 1, y: 0.8, z: 2 } });
    apply(scene, { op: 'place_object', id: NEW.hungPiece, asset: ARCHETYPE.art_framed, position: { x: 0.2, y: 1.5, z: 4 } });

    expect(scene.assets.find((asset) => asset.id === NEW.floorPiece)!.position.y).toBe(0);
    expect(scene.assets.find((asset) => asset.id === NEW.hungPiece)!.position.y).toBe(1.5);
  });

  test('normalises the yaw into (−π, π]', () => {
    const scene = opDraft();

    apply(scene, { op: 'place_object', id: NEW.turned, asset: ARCHETYPE.sofa_3s, position: { x: 1, y: 0, z: 2 }, rotationY: 3 * Math.PI });

    expect(scene.assets.find((asset) => asset.id === NEW.turned)!.rotationY).toBeCloseTo(Math.PI, 12);
  });

  test('rejects an unknown asset, an unknown variant, a catalogue-form reference, an unknown room, a bad position and an unknown finish', () => {
    const scene = opDraft();
    const position = { x: 1, y: 0, z: 2 };
    expect(rejectsOp(scene, { op: 'place_object', id: NEW.sofa, asset: 'nope', position })).toContain('Unknown asset nope');
    // A catalogue's `publisher/asset@variant` reference is rejected by
    // design: the catalogue translates into the scene's own form.
    expect(
      rejectsOp(scene, { op: 'place_object', id: NEW.sofa, asset: `jeex/${ARCHETYPE.sofa_3s}@${VARIANT.sofa_3s_linen}`, position }),
    ).toContain('Unknown asset');
    expect(
      rejectsOp(scene, { op: 'place_object', id: NEW.sofa, asset: ARCHETYPE.sofa_3s, variant: VARIANT.table_dining_oak, position }),
    ).toContain('is not offered');
    expect(rejectsOp(scene, { op: 'place_object', id: NEW.sofa, asset: ARCHETYPE.sofa_3s, room: NEW.ghost, position })).toContain(
      `Unknown room ${NEW.ghost}`,
    );
    expect(
      rejectsOp(scene, { op: 'place_object', id: NEW.sofa, asset: ARCHETYPE.sofa_3s, position: { x: 1, y: 0, z: Number.NaN } }),
    ).toContain('position');
    expect(rejectsOp(scene, { op: 'place_object', id: NEW.sofa, asset: ARCHETYPE.sofa_3s, position, rotationY: Number.NaN })).toContain(
      'rotationY',
    );
    expect(
      rejectsOp(scene, { op: 'place_object', id: NEW.sofa, asset: ARCHETYPE.sofa_3s, position, finishes: { upholstery: NEW.ghost } }),
    ).toContain(`Unknown finish ${NEW.ghost}`);
    expect(scene.assets).toHaveLength(2);
  });
});

describe('place_object ids', () => {
  /** The `OpError` a `place_object` with this id raises on a fresh draft, or a test failure. */
  function idRefusal(id: unknown): OpError {
    const op = { op: 'place_object', id, asset: ARCHETYPE.sofa_3s, position: { x: 1, y: 0, z: 2 } } as unknown as SceneOp;
    try {
      apply(opDraft(), op);
    } catch (error) {
      if (error instanceof OpError) return error;
      throw error;
    }
    throw new Error('place_object was expected to refuse its id');
  }

  test('a missing id or one that is not a UUID v7 is invalid_id: the viewer mints none', () => {
    expect(idRefusal(undefined).detail).toEqual({ reason: 'invalid_id', field: 'id', id: null, op: 'place_object' });
    expect(idRefusal(UUID_V4).detail).toEqual({ reason: 'invalid_id', field: 'id', id: UUID_V4, op: 'place_object' });
  });

  test('an id the document has already claimed is duplicate_id, whatever kind claimed it', () => {
    expect(idRefusal(SOFA).detail).toEqual({ reason: 'duplicate_id', field: 'id', id: SOFA, op: 'place_object' });
    expect(idRefusal(L_SHAPE.wall.wW).detail).toEqual({ reason: 'duplicate_id', field: 'id', id: L_SHAPE.wall.wW, op: 'place_object' });
  });
});

describe('move_object', () => {
  test('moves to an absolute position and keeps a floor-standing object on the floor', () => {
    const scene = opDraft();

    const outcome = apply(scene, { op: 'move_object', assetId: SOFA, position: { x: 3.5, y: 0.4, z: 6 } });

    expect(scene.assets[0]!.position).toEqual({ x: 3.5, y: 0, z: 6 });
    expect(outcome.summary).toBe(`Object ${SOFA}: moved to (3.50, 0.00, 6.00)`);
    expect(outcome.touched).toEqual([touchedAsset(SOFA)]);
  });

  test('adds a delta to the current position', () => {
    const scene = opDraft();

    apply(scene, { op: 'move_object', assetId: SOFA, dposition: { x: 0.5, y: 0, z: -1 } });

    expect(scene.assets[0]!.position).toEqual({ x: 2.5, y: 0, z: 5 });
  });

  test('binds and unbinds a room', () => {
    const scene = opDraft();

    const bound = apply(scene, { op: 'move_object', assetId: SOFA, position: { x: 3, y: 0, z: 6 }, room: ROOM_A });
    expect(scene.assets[0]!.room).toBe(ROOM_A);
    expect(bound.summary).toBe(`Object ${SOFA}: moved to (3.00, 0.00, 6.00) in ${ROOM_A}`);

    const unbound = apply(scene, { op: 'move_object', assetId: SOFA, room: null });
    expect(scene.assets[0]!.room).toBeUndefined();
    expect(unbound.summary).toBe(`Object ${SOFA}: unbound from its room`);
  });

  test('rejects an unknown asset, both forms of the position at once, a bad delta and an unknown room', () => {
    const scene = opDraft();
    const position = { x: 1, y: 0, z: 2 };
    expect(rejectsOp(scene, { op: 'move_object', assetId: NEW.ghost, position })).toContain(`Unknown asset ${NEW.ghost}`);
    expect(rejectsOp(scene, { op: 'move_object', assetId: SOFA, position, dposition: position })).toContain('position and dposition');
    expect(rejectsOp(scene, { op: 'move_object', assetId: SOFA, dposition: { x: 1, y: 0, z: Number.NaN } })).toContain('position');
    expect(rejectsOp(scene, { op: 'move_object', assetId: SOFA, room: NEW.ghost })).toContain(`Unknown room ${NEW.ghost}`);
    expect(rejectsOp(scene, { op: 'move_object', assetId: SOFA })).toContain('needs at least one field');
    expect(scene.assets[0]!.position).toEqual({ x: 2, z: 6, y: 0 });
  });
});

describe('rotate_object', () => {
  test('sets an absolute yaw, normalised', () => {
    const scene = opDraft();

    const outcome = apply(scene, { op: 'rotate_object', assetId: TABLE, rotationY: -3 * Math.PI });

    expect(scene.assets[1]!.rotationY).toBeCloseTo(Math.PI, 12);
    expect(outcome.summary).toBe(`Object ${TABLE}: rotated to 3.14 rad`);
    expect(outcome.touched).toEqual([touchedAsset(TABLE)]);
  });

  test('adds a delta to the current yaw and normalises the sum', () => {
    const scene = opDraft();
    scene.assets[0]!.rotationY = Math.PI * 0.75;

    apply(scene, { op: 'rotate_object', assetId: SOFA, drotation: Math.PI * 0.75 });

    expect(scene.assets[0]!.rotationY).toBeCloseTo(-Math.PI * 0.5, 12);
  });

  test('rejects an unknown asset, both forms at once, a non-finite angle and an empty request', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'rotate_object', assetId: NEW.ghost, rotationY: 0 })).toContain(`Unknown asset ${NEW.ghost}`);
    expect(rejectsOp(scene, { op: 'rotate_object', assetId: SOFA, rotationY: 0, drotation: 1 })).toContain('rotationY and drotation');
    expect(rejectsOp(scene, { op: 'rotate_object', assetId: SOFA, rotationY: Number.NaN })).toContain('rotationY');
    expect(rejectsOp(scene, { op: 'rotate_object', assetId: SOFA })).toContain('needs at least one field');
  });
});

describe('set_object', () => {
  test('writes the scale, the material and the slot finishes, and lists them', () => {
    const scene = opDraft();

    const outcome = apply(scene, {
      op: 'set_object',
      assetId: SOFA,
      scale: 1.25,
      material: FINISH.walnut_dark,
      finishes: { upholstery: FINISH.linen_sand },
    });

    expect(scene.assets[0]!.scale).toBe(1.25);
    expect(scene.assets[0]!.material).toBe(FINISH.walnut_dark);
    expect(scene.assets[0]!.finishes).toEqual({ upholstery: FINISH.linen_sand });
    expect(outcome.summary).toBe(`Object ${SOFA}: set scale 1.25, material ${FINISH.walnut_dark}, upholstery ${FINISH.linen_sand}`);
    expect(outcome.touched).toEqual([touchedAsset(SOFA)]);
  });

  test('clamps the scale into the allowed range', () => {
    const scene = opDraft();

    apply(scene, { op: 'set_object', assetId: SOFA, scale: 9 });
    expect(scene.assets[0]!.scale).toBe(OBJECT_SCALE[1]);

    apply(scene, { op: 'set_object', assetId: TABLE, scale: 0.1 });
    expect(scene.assets[1]!.scale).toBe(OBJECT_SCALE[0]);
  });

  test('merges slot finishes onto the ones already there', () => {
    const scene = opDraft();
    scene.assets[0]!.finishes = { frame: FINISH.oak_natural };

    apply(scene, { op: 'set_object', assetId: SOFA, finishes: { upholstery: FINISH.wool_sage } });

    expect(scene.assets[0]!.finishes).toEqual({ frame: FINISH.oak_natural, upholstery: FINISH.wool_sage });
  });

  test('rejects an unknown asset, an unknown finish, a non-finite scale and an empty request', () => {
    const scene = opDraft();
    expect(rejectsOp(scene, { op: 'set_object', assetId: NEW.ghost, scale: 1 })).toContain(`Unknown asset ${NEW.ghost}`);
    expect(rejectsOp(scene, { op: 'set_object', assetId: SOFA, material: NEW.ghost })).toContain(`Unknown finish ${NEW.ghost}`);
    expect(rejectsOp(scene, { op: 'set_object', assetId: SOFA, finishes: { upholstery: NEW.ghost } })).toContain(
      `Unknown finish ${NEW.ghost}`,
    );
    expect(rejectsOp(scene, { op: 'set_object', assetId: SOFA, scale: Number.NaN })).toContain('scale');
    expect(rejectsOp(scene, { op: 'set_object', assetId: SOFA })).toContain('needs at least one field');
    expect(scene.assets[0]!.scale).toBeUndefined();
  });
});

describe('remove_object', () => {
  test('drops the placement', () => {
    const scene = opDraft();

    const outcome = apply(scene, { op: 'remove_object', assetId: SOFA });

    expect(scene.assets.map((asset) => asset.id)).toEqual([TABLE]);
    expect(outcome.summary).toBe(`Object ${SOFA}: removed`);
    expect(outcome.touched).toEqual([touchedAsset(SOFA)]);
  });

  test('drops the removed placement out of every interior preset that dressed it', () => {
    const scene = opDraft();
    scene.interiors = [
      {
        id: NEW.preset,
        name: 'Warm',
        swatch: [FINISH.oak, FINISH.sand],
        ops: [{ op: 'replace_asset_variant', assetId: SOFA, variant: VARIANT.sofa_3s_boucle }],
      },
    ];

    apply(scene, { op: 'remove_object', assetId: SOFA });

    expect(scene.interiors).toEqual([]);
  });

  test('rejects an unknown asset', () => {
    expect(rejectsOp(opDraft(), { op: 'remove_object', assetId: NEW.ghost })).toContain(`Unknown asset ${NEW.ghost}`);
  });
});

describe('the draft is the only thing an applier touches', () => {
  test('no operation of this module changes the fixture it was copied from', () => {
    const scene = opDraft();
    const before = JSON.stringify(scene);

    expect(() => apply(scene, { op: 'place_object', id: NEW.sofa, asset: 'nope', position: { x: 1, y: 0, z: 2 } })).toThrow();

    expect(JSON.stringify(scene)).toBe(before);
  });
});
