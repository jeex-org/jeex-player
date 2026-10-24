/**
 * Builder invariants for the four houseplant species, over every variant the
 * bank ships.
 *
 * These are the things the reference photographs and the layout linter between
 * them fix, and that nothing else can check: that a plant fills the box it
 * declares and never leaves it, that its crown was DESIGNED to that box rather
 * than squashed into it, that every blade is above the soil and outside the
 * pot, that the pot really is the footprint `layout.footprint` promises the
 * linter, that one seed is one plant, and that a blade - a surface with no
 * thickness - is the only thing in the object rendered double-sided.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { BUILDERS } from './asset-builders.js';
import { GeometryCache, makeBuildKit } from './asset-kit.js';
import { FinishRegistry } from './asset-finishes.js';
import { listCatalogueObjects } from './asset-catalogue.js';
import { isResolved, resolveAsset, type ResolvedAsset } from './asset-resolver.js';
import { BLADE_NAME, CROWN_NAME, POT_NAME, SOIL_NAME } from './plant-parts.js';
import type { CatalogueObject, CatalogueVariant } from './asset-types.js';
import { ARCHETYPE } from './catalogue-ids.js';

/** The placement every species is built through. */
const PLACEMENT = '01a12ff0-fecd-712b-98c6-335935ef8f90';

/** Per-object triangle budget of the bank (`geometry/asset-loader.test.ts`). */
const TRIANGLE_BUDGET = 5000;

/**
 * Measured triangle count of each species' heaviest variant, recorded so a
 * change to a blade's `rows` or to a frond's leaflet count shows up as a
 * number here rather than as a silent slide toward the 5 000 budget.
 */
const TRIANGLE_CEILING: Readonly<Record<string, number>> = {
  [ARCHETYPE.plant_kentia]: 3800,
  [ARCHETYPE.plant_strelitzia]: 3100,
  [ARCHETYPE.plant_ficus_lyrata]: 4500,
  [ARCHETYPE.plant_strelitzia_white]: 2400,
};

/** How far a built plant may miss the box it declares, metres. */
const BOX_TOLERANCE_M = 0.02;
/** How much of its declared plan size a crown is expected to fill - it is a crown, not a box. */
const FILL_AT_LEAST = 0.55;
/** How much `fitCrown` may slim a crown horizontally before the species is mis-designed. */
const SLIM_AT_LEAST = 0.7;

const SPECIES = listCatalogueObjects().filter((object) => object.category === 'decor/plants');

type Built = { group: THREE.Group; asset: ResolvedAsset; free: () => void };

function build(object: CatalogueObject, variant: CatalogueVariant): Built {
  const resolution = resolveAsset({
    id: PLACEMENT,
    type: object.id,
    asset: object.id,
    variant: variant.id,
    position: { x: 0, y: 0, z: 0 },
  });
  if (!isResolved(resolution)) throw new Error(`unresolved ${variant.slug}`);
  const geometries = new GeometryCache();
  const finishes = new FinishRegistry([]);
  const kit = makeBuildKit(geometries, finishes, resolution.asset.finishes);
  const group = BUILDERS[resolution.asset.builder ?? '']!(resolution.asset, kit);
  return {
    group,
    asset: resolution.asset,
    free: () => {
      geometries.dispose();
      finishes.dispose();
    },
  };
}

/** Every variant of every species, as `test.each` rows labelled by the variant's readable slug. */
const VARIANTS: Array<[string, CatalogueObject, CatalogueVariant]> = SPECIES.flatMap((object) =>
  object.variants.map((variant) => [variant.slug, object, variant] as [string, CatalogueObject, CatalogueVariant]),
);

function meshesNamed(group: THREE.Group, name: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.name === name) found.push(child as THREE.Mesh);
  });
  return found;
}

function triangles(group: THREE.Group): number {
  let total = 0;
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const index = mesh.geometry.index;
    total += (index ? index.count : mesh.geometry.getAttribute('position').count) / 3;
  });
  return total;
}

describe('houseplant builders', () => {
  test('the bank ships the four species of the reference photographs', () => {
    expect(SPECIES.map((object) => object.id)).toEqual([
      ARCHETYPE.plant_kentia,
      ARCHETYPE.plant_strelitzia,
      ARCHETYPE.plant_ficus_lyrata,
      ARCHETYPE.plant_strelitzia_white,
    ]);
  });

  test.each(VARIANTS)('%s fills the box it declares and never leaves it', (id, _object, variant) => {
    const built = build(_object, variant);
    const dims = variant.dims ?? _object.dims;
    // Vertex-exact: the default box of a leaning, scaled blade overstates its
    // reach, and a crown fitted to that overstatement fell up to 9 cm short.
    const box = new THREE.Box3().setFromObject(built.group, true);
    const size = box.getSize(new THREE.Vector3());
    expect({ id, sunk: box.min.y < -BOX_TOLERANCE_M / 10 }).toEqual({ id, sunk: false });
    expect(box.max.y).toBeCloseTo(dims[1], 2);
    expect({ id, wide: size.x > dims[0] + BOX_TOLERANCE_M }).toEqual({ id, wide: false });
    expect({ id, deep: size.z > dims[2] + BOX_TOLERANCE_M }).toEqual({ id, deep: false });
    expect({ id, thin: size.x < dims[0] * FILL_AT_LEAST || size.z < dims[2] * FILL_AT_LEAST }).toEqual({ id, thin: false });
    built.free();
  });

  test.each(VARIANTS)('%s has a crown designed to its box, not squashed into it', (id, object, variant) => {
    const built = build(object, variant);
    const crown = built.group.getObjectByName(CROWN_NAME)!;
    // `fitCrown` fits the height uniformly and takes any excess reach out of X
    // and Z alone, so this ratio is exactly how much it had to slim the crown.
    const slim = crown.scale.x / crown.scale.y;
    expect({ id, slim: Number(slim.toFixed(3)), enough: slim >= SLIM_AT_LEAST }).toEqual({
      id,
      slim: Number(slim.toFixed(3)),
      enough: true,
    });
    built.free();
  });

  test.each(VARIANTS)('%s keeps every blade above the soil and outside the pot', (id, object, variant) => {
    const built = build(object, variant);
    const soil = meshesNamed(built.group, SOIL_NAME);
    // The disc, plus a pebble each for the two mulched species.
    expect(soil.length).toBeGreaterThanOrEqual(1);
    const surface = new THREE.Box3();
    for (const part of soil) surface.union(new THREE.Box3().setFromObject(part));
    const soilTop = surface.max.y;
    const pot = new THREE.Box3();
    for (const part of meshesNamed(built.group, POT_NAME)) pot.union(new THREE.Box3().setFromObject(part));
    const potRadius = Math.max(pot.max.x, -pot.min.x, pot.max.z, -pot.min.z);
    const blades = meshesNamed(built.group, BLADE_NAME);
    expect(blades.length).toBeGreaterThan(5);
    const centre = new THREE.Vector3();
    for (const blade of blades) {
      new THREE.Box3().setFromObject(blade).getCenter(centre);
      const below = centre.y <= soilTop;
      const insidePot = centre.y < pot.max.y && Math.hypot(centre.x, centre.z) < potRadius;
      expect({ id, blade: blade.uuid, below, insidePot }).toEqual({ id, blade: blade.uuid, below: false, insidePot: false });
    }
    built.free();
  });

  test.each(VARIANTS)('%s stands on the footprint `layout.footprint` promises the linter', (id, object, variant) => {
    const built = build(object, variant);
    const dims = variant.dims ?? object.dims;
    const standing = object.layout?.footprint ?? 1;
    const pot = new THREE.Box3();
    for (const part of meshesNamed(built.group, POT_NAME)) pot.union(new THREE.Box3().setFromObject(part));
    const allowed = { hx: (dims[0] / 2) * standing, hz: (dims[2] / 2) * standing };
    const reach = { hx: Math.max(pot.max.x, -pot.min.x), hz: Math.max(pot.max.z, -pot.min.z) };
    // Inside the promise, and filling most of it: a linter told the pot is
    // twice the size it really is refuses lawful placements just as surely.
    expect({ id, over: reach.hx > allowed.hx + 0.005 || reach.hz > allowed.hz + 0.005 }).toEqual({ id, over: false });
    expect({ id, under: reach.hx < allowed.hx * 0.9 || reach.hz < allowed.hz * 0.9 }).toEqual({ id, under: false });
    built.free();
  });

  test.each(VARIANTS)('%s is the same plant for the same seed', (id, object, variant) => {
    const first = build(object, variant);
    const second = build(object, variant);
    const count = (group: THREE.Group): number => {
      let total = 0;
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) total += mesh.geometry.getAttribute('position').count;
      });
      return total;
    };
    expect({ id, vertices: count(second.group) }).toEqual({ id, vertices: count(first.group) });
    const blade = (group: THREE.Group): number[] => {
      const mesh = meshesNamed(group, BLADE_NAME)[0]!;
      mesh.updateWorldMatrix(true, false);
      return [...mesh.matrixWorld.elements].map((value) => Number(value.toFixed(9)));
    };
    expect(blade(second.group)).toEqual(blade(first.group));
    first.free();
    second.free();
  });

  test.each(VARIANTS)('%s stays inside the per-object triangle budget', (id, object, variant) => {
    const built = build(object, variant);
    const count = triangles(built.group);
    expect({ id, count, over: count > TRIANGLE_BUDGET }).toEqual({ id, count, over: false });
    expect({ id, count, overCeiling: count > TRIANGLE_CEILING[object.id]! }).toEqual({ id, count, overCeiling: false });
    built.free();
  });

  test.each(VARIANTS)('%s renders only its blades double-sided', (id, object, variant) => {
    const built = build(object, variant);
    built.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material;
      expect({ id, part: mesh.name, double: material.side === THREE.DoubleSide }).toEqual({
        id,
        part: mesh.name,
        double: mesh.name === BLADE_NAME,
      });
    });
    built.free();
  });
});
