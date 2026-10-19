/**
 * Mirror-builder invariants around the ONE live resource in the object bank.
 *
 * A mirror is built long before the page arms live reflections, so the build
 * leaves a callback in a page-global registry that captures the whole scene
 * graph. The cleanup that takes it back out has to be registered by the BUILD,
 * unconditionally - not by the swap, which most viewers never reach - or every
 * mount/unmount cycle pins one more dead scene until the first user gesture
 * fires them all at a corpse.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { buildMirror } from './asset-builders-lighting-decor.js';
import { GeometryCache, makeBuildKit, type BuildKit } from './asset-kit.js';
import type { ResolvedAsset } from './asset-resolver.js';
import { ARCHETYPE, VARIANT } from './catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { FinishRegistry } from './asset-finishes.js';

function mirrorAsset(shape: 'round' | 'rect'): ResolvedAsset {
  const dims: [number, number, number] = shape === 'round' ? [0.76, 0.76, 0.06] : [0.68, 1.06, 0.06];
  return {
    placementId: '01a12ff0-fed0-7bf1-82f0-7054b04d2c83',
    ref: `starter:${ARCHETYPE.mirror_round}`,
    library: 'starter',
    archetypeId: ARCHETYPE.mirror_round,
    variantId: shape === 'round' ? VARIANT.mirror_round_brass : VARIANT.mirror_rect_walnut,
    variantName: 'Test mirror',
    version: '1.0.0',
    category: 'decor/mirrors',
    tags: ['hall'],
    dims,
    anchor: 'wall',
    wallSnap: true,
    clearance: 0,
    mountY: 1.6,
    scale: 1,
    yaw: 0,
    builder: 'mirror',
    options: { shape },
    finishes: { frame: FINISH.brass_soft, glass: FINISH.mirror_silver },
    pricing: { model: 'free' },
  };
}

function kitFor(): { kit: BuildKit; disposals: Array<() => void> } {
  const disposals: Array<() => void> = [];
  const kit = makeBuildKit(
    new GeometryCache(),
    new FinishRegistry([]),
    { frame: FINISH.brass_soft, glass: FINISH.mirror_silver },
    (dispose) => disposals.push(dispose),
  );
  return { kit, disposals };
}

describe('buildMirror', () => {
  test.each([['round'], ['rect']] as const)('%s glass is a mounted, named mesh inside the frame', (shape) => {
    const { kit } = kitFor();
    const group = buildMirror(mirrorAsset(shape), kit);
    const glass = group.getObjectByName('mirror-glass');
    expect(glass).toBeInstanceOf(THREE.Mesh);
    expect(glass?.visible).toBe(true);
    const box = new THREE.Box3().setFromObject(group);
    const dims = mirrorAsset(shape).dims;
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(dims[0] + 0.01);
    expect(box.max.y - box.min.y).toBeLessThanOrEqual(dims[1] + 0.01);
  });

  test.each([['round'], ['rect']] as const)('%s registers its arm-registry cleanup on the BUILD, not on the swap', (shape) => {
    const { kit, disposals } = kitFor();
    buildMirror(mirrorAsset(shape), kit);
    // Nothing armed the page, so the reflector was never mounted and has no GPU
    // resource to free - yet the build must still own exactly one cleanup: the
    // one that releases its arm callback.
    expect(disposals).toHaveLength(1);
    expect(() => {
      for (const dispose of disposals) dispose();
    }).not.toThrow();
  });

  test('every build owns its own cleanup, so disposing one mount does not release another', () => {
    const first = kitFor();
    const second = kitFor();
    buildMirror(mirrorAsset('round'), first.kit);
    buildMirror(mirrorAsset('round'), second.kit);
    expect(first.disposals).toHaveLength(1);
    expect(second.disposals).toHaveLength(1);
    expect(first.disposals[0]).not.toBe(second.disposals[0]);
  });
});
