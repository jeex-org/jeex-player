/**
 * Builder invariants for the kitchen and sanitary module. The extractor hood is
 * the one built to a photographic reference, so the checks here are the things
 * that reference fixes: what the object is made of, that the rim is the
 * lowest thing on it (everything under the canopy is recessed behind that rim),
 * that nothing crosses the wall plane it hangs on, and that it fills its
 * catalogue height exactly.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { buildHood } from './asset-builders-kitchen-bath.js';
import { GeometryCache, makeBuildKit, type BuildKit } from './asset-kit.js';
import { FinishRegistry } from './asset-finishes.js';
import type { ResolvedAsset } from './asset-resolver.js';
import { ARCHETYPE, VARIANT } from './catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';

const HOOD_SLOTS = { metal: FINISH.steel_brushed, accent: FINISH.metal_ink, light: FINISH.lamp_warm };
const HOOD_DIMS: [number, number, number] = [0.9, 0.8, 0.52];

function hoodAsset(dims: [number, number, number]): ResolvedAsset {
  return {
    placementId: '01a12ff0-fece-749d-92d8-2bb96829f878',
    library: 'starter',
    archetypeId: ARCHETYPE.hood_extractor,
    variantId: VARIANT.hood_extractor_steel,
    variantName: 'Test hood',
    version: '1.0.0',
    category: 'appliances/ventilation',
    tags: ['kitchen'],
    dims,
    anchor: 'wall',
    wallSnap: true,
    clearance: 0,
    mountY: 1.64,
    scale: 1,
    yaw: 0,
    builder: 'hood',
    options: {},
    finishes: HOOD_SLOTS,
    pricing: { model: 'free' },
  };
}

function kitFor(): { kit: BuildKit; registry: FinishRegistry } {
  const registry = new FinishRegistry([]);
  return { kit: makeBuildKit(new GeometryCache(), registry, HOOD_SLOTS), registry };
}

function named(group: THREE.Group, name: string): THREE.Object3D[] {
  return group.children.filter((child) => child.name === name);
}

describe('buildHood', () => {
  test.each([
    ['catalogue size', HOOD_DIMS],
    ['narrow', [0.6, 0.9, 0.45] as [number, number, number]],
  ])('%s fills its dims and hangs from the mount plane', (_, dims) => {
    const { kit } = kitFor();
    const box = new THREE.Box3().setFromObject(buildHood(hoodAsset(dims), kit));
    // The duct ends exactly `height` above the rim's underside: the hood is
    // sized to reach whatever the resolver mounted it under.
    expect(box.max.y - box.min.y).toBeCloseTo(dims[1], 3);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(dims[0] + 0.001);
    // The push buttons stand 4 mm proud of the rim's front face, the way the
    // cooker's knobs stand proud of its fascia.
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(dims[2] + 0.006);
    // The rim hangs below the mount plane and the rest of the hood is above it.
    expect(box.min.y).toBeGreaterThan(-0.05);
    expect(box.min.y).toBeLessThan(0);
  });

  test('nothing crosses the wall plane the hood hangs on', () => {
    const { kit } = kitFor();
    const group = buildHood(hoodAsset(HOOD_DIMS), kit);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.z).toBeGreaterThanOrEqual(-HOOD_DIMS[2] / 2 - 0.001);
    // The duct stands off the wall rather than being buried in it.
    const duct = new THREE.Box3().setFromObject(named(group, 'hood-duct')[0]!);
    expect(duct.min.z).toBeGreaterThan(-HOOD_DIMS[2] / 2);
  });

  test('the reference parts are all there: rim, canopy, duct, two filters, two lamps, four buttons', () => {
    const { kit } = kitFor();
    const group = buildHood(hoodAsset(HOOD_DIMS), kit);
    expect(named(group, 'hood-rim')).toHaveLength(1);
    expect(named(group, 'hood-canopy')).toHaveLength(1);
    expect(named(group, 'hood-duct')).toHaveLength(1);
    expect(named(group, 'hood-filter')).toHaveLength(2);
    expect(named(group, 'hood-filter-mesh')).toHaveLength(2);
    expect(named(group, 'hood-filter-tab')).toHaveLength(2);
    expect(named(group, 'hood-lamp')).toHaveLength(2);
    expect(named(group, 'hood-button')).toHaveLength(4);
  });

  test('the canopy tapers to the duct and the duct is a third of the width', () => {
    const { kit } = kitFor();
    const group = buildHood(hoodAsset(HOOD_DIMS), kit);
    const canopy = new THREE.Box3().setFromObject(named(group, 'hood-canopy')[0]!);
    const duct = new THREE.Box3().setFromObject(named(group, 'hood-duct')[0]!);
    // The canopy's bounds are its wide base; the duct above it is far narrower.
    expect(canopy.max.x - canopy.min.x).toBeCloseTo(HOOD_DIMS[0] - 0.016, 3);
    expect(duct.max.x - duct.min.x).toBeCloseTo(HOOD_DIMS[0] / 3, 3);
    // Back faces of both stay on the wall side, which is what makes the canopy
    // read as a wall hood rather than an island one.
    expect(duct.min.z).toBeLessThan(0);
    expect(canopy.max.y).toBeCloseTo(duct.min.y + 0.004, 3);
  });

  test('the underside is recessed: the rim edge is the lowest thing on the hood', () => {
    const { kit } = kitFor();
    const group = buildHood(hoodAsset(HOOD_DIMS), kit);
    const rim = new THREE.Box3().setFromObject(named(group, 'hood-rim')[0]!);
    for (const child of group.children) {
      if (child.name === 'hood-rim') continue;
      const box = new THREE.Box3().setFromObject(child);
      // Every filter, lamp and tab sits at least 2 mm up inside the rim.
      expect({ part: child.name, clearsRim: box.min.y >= rim.min.y + 0.002 }).toEqual({ part: child.name, clearsRim: true });
    }
  });

  test('the lamps are the only emissive parts and the buttons the only accent ones', () => {
    const { kit, registry } = kitFor();
    const group = buildHood(hoodAsset(HOOD_DIMS), kit);
    const lampMaterial = registry.get(FINISH.lamp_warm);
    const accentMaterial = registry.get(FINISH.metal_ink);
    const emissive = group.children.filter((child) => child instanceof THREE.Mesh && child.material === lampMaterial);
    expect(emissive.map((child) => child.name)).toEqual(['hood-lamp', 'hood-lamp']);
    const accented = group.children.filter((child) => child instanceof THREE.Mesh && child.material === accentMaterial);
    expect(new Set(accented.map((child) => child.name))).toEqual(new Set(['hood-filter-tab', 'hood-button']));
  });

  test('every mesh draws a material the finish registry handed out', () => {
    const { kit, registry } = kitFor();
    const allowed = new Set([registry.get(FINISH.steel_brushed), registry.get(FINISH.metal_ink), registry.get(FINISH.lamp_warm)]);
    const group = buildHood(hoodAsset(HOOD_DIMS), kit);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) expect(allowed.has(object.material as THREE.Material)).toBe(true);
    });
  });
});
