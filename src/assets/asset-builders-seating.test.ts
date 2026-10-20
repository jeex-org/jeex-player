/**
 * Builder invariants for the seating module: the sofa builder is shared by the
 * `sofa_3s` archetype (seats 3 and 2) and the `armchair` (seats 1), so every
 * shape must stay inside its catalogue dims, stand on the floor, and draw its
 * materials only from the finish registry the kit was built with.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { buildSofa } from './asset-builders-seating.js';
import { GeometryCache, makeBuildKit, type BuildKit } from './asset-kit.js';
import type { ResolvedAsset } from './asset-resolver.js';
import { ARCHETYPE, VARIANT } from './catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { FinishRegistry } from './asset-finishes.js';

function sofaAsset(dims: [number, number, number], seats: number): ResolvedAsset {
  return {
    placementId: '01a12ff0-fecf-7faf-9a83-b97dba8a9328',
    library: 'starter',
    archetypeId: ARCHETYPE.sofa_3s,
    variantId: VARIANT.sofa_3s_linen,
    variantName: 'Test sofa',
    version: '1.0.0',
    category: 'furniture/sofas',
    tags: ['living'],
    dims,
    anchor: 'floor',
    wallSnap: true,
    clearance: 0.6,
    mountY: 0,
    scale: 1,
    yaw: 0,
    builder: 'sofa',
    options: { seats },
    finishes: { upholstery: FINISH.linen_sand, cushion: FINISH.linen_sand, leg: FINISH.oak_natural },
    pricing: { model: 'free' },
  };
}

function kitFor(): { kit: BuildKit; registry: FinishRegistry } {
  const registry = new FinishRegistry([]);
  const kit = makeBuildKit(new GeometryCache(), registry, {
    upholstery: FINISH.linen_sand,
    cushion: FINISH.linen_sand,
    leg: FINISH.oak_natural,
  });
  return { kit, registry };
}

describe('buildSofa', () => {
  test.each([
    ['three-seat', [2.24, 0.86, 0.95] as const, 3],
    ['two-seat', [1.66, 0.86, 0.95] as const, 2],
    ['armchair', [0.84, 0.82, 0.86] as const, 1],
  ])('%s stays inside its dims and stands on the floor', (_, dims, seats) => {
    const { kit } = kitFor();
    const group = buildSofa(sofaAsset([...dims], seats), kit);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box.min.y).toBeLessThanOrEqual(0.005);
    expect(box.max.y).toBeLessThanOrEqual(dims[1] + 0.02);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(dims[0] + 0.03);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(dims[2] + 0.03);
  });

  test.each([
    [3, 3],
    [2, 2],
    [1, 1],
  ])('seats=%i builds that many seat cushions and welt runs', (seats, expected) => {
    const { kit } = kitFor();
    const group = buildSofa(sofaAsset([2.24, 0.86, 0.95], seats), kit);
    const seatsBuilt = group.children.filter((child) => child.name.startsWith('seat-cushion-'));
    expect(seatsBuilt).toHaveLength(expected);
    const welts = group.children.filter((child) => child.name === 'welt');
    // Two per cushion (front seam, back-cushion top seam) plus one per arm.
    expect(welts.length).toBe(expected * 2 + 2);
  });

  test('an armchair gets one throw pillow, a sofa two', () => {
    const { kit } = kitFor();
    const armchair = buildSofa(sofaAsset([0.84, 0.82, 0.86], 1), kit);
    const sofa = buildSofa(sofaAsset([2.24, 0.86, 0.95], 3), kit);
    expect(armchair.children.filter((child) => child.name.startsWith('throw-pillow-'))).toHaveLength(1);
    expect(sofa.children.filter((child) => child.name.startsWith('throw-pillow-'))).toHaveLength(2);
  });

  test('every mesh draws a material the finish registry handed out', () => {
    const { kit, registry } = kitFor();
    const allowed = new Set([registry.get(FINISH.linen_sand), registry.get(FINISH.oak_natural)]);
    const group = buildSofa(sofaAsset([2.24, 0.86, 0.95], 3), kit);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) expect(allowed.has(object.material as THREE.Material)).toBe(true);
    });
  });

  test('legs are turned lathes touching y=0', () => {
    const { kit } = kitFor();
    const group = buildSofa(sofaAsset([2.24, 0.86, 0.95], 3), kit);
    const legs = group.children.filter((child) => child.name === 'leg');
    expect(legs).toHaveLength(4);
    for (const leg of legs) {
      const box = new THREE.Box3().setFromObject(leg);
      expect(box.min.y).toBeCloseTo(0, 3);
    }
  });
});
