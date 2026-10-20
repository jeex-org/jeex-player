/**
 * `mirror_object`: the whole mirror state, absolute, judged against the
 * archetype's catalogue facts.
 */

import { describe, expect, test } from 'bun:test';
import { CATALOGUE_REGISTRIES } from '../../assets/catalogue-registries.js';
import { ARCHETYPE } from '../../assets/catalogue-ids.js';
import { opDraft } from '../../fixtures/op-drafts.js';
import { L_SHAPE } from '../../fixtures/plan-l-shape-ids.js';
import { applyOp } from '../scene-ops.js';
import { validateScene } from '../scene-validator.js';
import { OpError } from './context.js';
import type { Draft } from '../../shared/committed.js';
import type { SceneData, SceneOp } from '../types.js';

const SOFA = L_SHAPE.asset.sofa;
/** A TV placed by the tests below, minted offline. */
const TV = '01a1a0c2-5d10-7a3e-9c41-2f7d8e6b5a01';

function apply(scene: Draft<SceneData>, op: SceneOp): ReturnType<typeof applyOp> {
  return applyOp(scene, op, CATALOGUE_REGISTRIES);
}

function refusal(scene: Draft<SceneData>, op: SceneOp): OpError {
  try {
    apply(scene, op);
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error('expected the op to be refused');
}

describe('mirror_object', () => {
  test('round-trips: the state set is the state read back, and the previous state undoes it', () => {
    const scene = opDraft();
    const outcome = apply(scene, { op: 'mirror_object', assetId: SOFA, mirror: { x: true } });
    expect(scene.assets.find((asset) => asset.id === SOFA)!.mirror).toEqual({ x: true });
    expect(outcome.summary).toContain('mirrored on x');
    // The mirrored document still validates.
    expect(() => validateScene(scene as SceneData, CATALOGUE_REGISTRIES)).not.toThrow();
    apply(scene, { op: 'mirror_object', assetId: SOFA, mirror: {} });
    expect('mirror' in scene.assets.find((asset) => asset.id === SOFA)!).toBe(false);
  });

  test('refuses an axis the facts do not allow with mirror_not_allowed', () => {
    const scene = opDraft();
    // The sofa allows x only; its back is not finished.
    const error = refusal(scene, { op: 'mirror_object', assetId: SOFA, mirror: { x: true, z: true } });
    expect(error.detail).toMatchObject({ reason: 'mirror_not_allowed', op: 'mirror_object', axes: ['z'] });
    expect(scene.assets.find((asset) => asset.id === SOFA)!.mirror).toBeUndefined();
  });

  test('a screen allows no axis at all', () => {
    const scene = opDraft();
    apply(scene, { op: 'place_object', id: TV, asset: ARCHETYPE.tv_unit, position: { x: 2, y: 0, z: 2 } });
    expect(refusal(scene, { op: 'mirror_object', assetId: TV, mirror: { x: true } }).detail).toMatchObject({
      reason: 'mirror_not_allowed',
    });
    // Clearing is always allowed: every asset may be unmirrored.
    expect(() => apply(scene, { op: 'mirror_object', assetId: TV, mirror: {} })).not.toThrow();
  });

  test('refuses when the facts are unknown', () => {
    const scene = opDraft();
    const sofa = scene.assets.find((asset) => asset.id === SOFA)!;
    sofa.type = '01a1a0c2-5d10-7a3e-9c41-2f7d8e6b5a02';
    const error = refusal(scene, { op: 'mirror_object', assetId: SOFA, mirror: { x: true } });
    expect(error.message).toContain('mirror facts are unknown');
    expect(error.detail).toMatchObject({ reason: 'mirror_not_allowed' });
  });

  test('refuses a malformed state and an unknown asset', () => {
    const scene = opDraft();
    const bad = { op: 'mirror_object', assetId: SOFA, mirror: { x: false } } as unknown as SceneOp;
    expect(refusal(scene, bad).message).toContain('mirror: { x?: true');
    expect(refusal(scene, { op: 'mirror_object', assetId: TV, mirror: { x: true } }).message).toContain('Unknown asset');
  });
});

describe('scale is positive from schema 2.1 on', () => {
  test('a negative scale is refused with «use mirror»', () => {
    const scene = opDraft();
    scene.assets.find((asset) => asset.id === SOFA)!.scale = -1;
    expect(() => validateScene(scene as SceneData, CATALOGUE_REGISTRIES)).toThrow('use mirror');
  });

  test('a malformed mirror is refused by the validator', () => {
    const scene = opDraft();
    (scene.assets.find((asset) => asset.id === SOFA)! as { mirror?: unknown }).mirror = { w: true };
    expect(() => validateScene(scene as SceneData, CATALOGUE_REGISTRIES)).toThrow('invalid mirror');
  });
});
