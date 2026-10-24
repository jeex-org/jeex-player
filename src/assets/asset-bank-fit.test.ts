/**
 * The built-in bank's geometry against the facts it declares about itself.
 *
 * A bank object travels: an exporter bakes the procedural body into a GLB and
 * writes the OVERALL bounding box of that body as the project's `dims`,
 * carrying the archetype's `layout` facts over unchanged. So a fact is only
 * true if it is true of the built body, whatever frame the dims are read in:
 *  - a chair or a media unit is exactly as tall as it says;
 *  - a fixture with a tap says, in `layout.blockingHeight`, where its carcass
 *    ends, so the tap's thin arc never decides what blocks a window;
 *  - the tap never widens the plan, which is why none of them needs a
 *    `layout.footprint` fraction;
 *  - a TV screen reads as a switched-off black panel, not as the brass trim.
 *
 * Each body is built the way the loader builds it: resolved from the shipped
 * catalogue, through `BUILDERS`, with a finish registry of its own.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { BUILDERS } from './asset-builders.js';
import { listCatalogueObjects } from './asset-catalogue.js';
import { FinishRegistry } from './asset-finishes.js';
import { GeometryCache, makeBuildKit } from './asset-kit.js';
import { isResolved, resolveAsset, type ResolvedAsset } from './asset-resolver.js';
import type { CatalogueObject, CatalogueVariant } from './asset-types.js';
import { ARCHETYPE } from './catalogue-ids.js';

const PLACEMENT = '01a16b10-6b3c-7d52-9e1f-3a4b5c6d7e8f';
/** What `mixerTap` names every mesh of a tap. */
const TAP_NAME = 'tap';

type Built = { group: THREE.Group; asset: ResolvedAsset; registry: FinishRegistry; free: () => void };

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
  const registry = new FinishRegistry([]);
  const group = BUILDERS[resolution.asset.builder ?? '']!(resolution.asset, makeBuildKit(geometries, registry, resolution.asset.finishes));
  group.updateMatrixWorld(true);
  return {
    group,
    asset: resolution.asset,
    registry,
    free: () => {
      geometries.dispose();
      registry.dispose();
    },
  };
}

function objectOf(archetype: string): CatalogueObject {
  const object = listCatalogueObjects().find((candidate) => candidate.id === archetype);
  if (!object) throw new Error(`no archetype ${archetype}`);
  return object;
}

/** Every variant of the named archetypes, as `test.each` rows labelled by slug. */
function variantsOf(...archetypes: string[]): Array<[string, CatalogueObject, CatalogueVariant]> {
  return archetypes.flatMap((archetype) => {
    const object = objectOf(archetype);
    return object.variants.map((variant) => [variant.slug, object, variant] as [string, CatalogueObject, CatalogueVariant]);
  });
}

function meshes(group: THREE.Group): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) found.push(child as THREE.Mesh);
  });
  return found;
}

/** The vertex-exact box: a rotated lathe's or torus's bounding box overstates it by millimetres. */
const boxOf = (object: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(object, true);

/** How far a size variant's carcass top may sit from its archetype's one `blockingHeight`, metres. */
const TRIM_M = 0.025;

describe('the bank is as tall as it says', () => {
  test.each(variantsOf(ARCHETYPE.chair_dining))('%s fits its dims and stands on all four legs', (id, object, variant) => {
    const built = build(object, variant);
    const dims = built.asset.dims;
    const size = boxOf(built.group).getSize(new THREE.Vector3());
    expect({ id, tall: size.y > dims[1] + 0.005 }).toEqual({ id, tall: false });
    expect(size.y).toBeGreaterThanOrEqual(dims[1] - 0.005);
    expect(size.x).toBeLessThanOrEqual(dims[0] + 0.005);
    expect(size.z).toBeLessThanOrEqual(dims[2] + 0.005);
    // The rear posts are the back legs: they reach the floor, as the front legs do.
    const posts = meshes(built.group).filter((mesh) => mesh.name === 'chair-post');
    expect(posts.length).toBe(2);
    for (const post of posts) expect(boxOf(post).min.y).toBeLessThan(0.002);
    built.free();
  });

  test.each(variantsOf(ARCHETYPE.tv_unit))('%s is exactly as tall as its dims', (id, object, variant) => {
    const built = build(object, variant);
    const size = boxOf(built.group).getSize(new THREE.Vector3());
    expect({ id, height: Number(size.y.toFixed(3)) }).toEqual({ id, height: built.asset.dims[1] });
    built.free();
  });
});

describe('the media unit reads as a TV', () => {
  test.each(variantsOf(ARCHETYPE.tv_unit))('%s has a near-black, glossy, unlit screen', (_id, object, variant) => {
    const built = build(object, variant);
    const screen = built.registry.get(built.asset.finishes['screen']!) as THREE.MeshStandardMaterial;
    const hsl = screen.color.getHSL({ h: 0, s: 0, l: 0 });
    expect(hsl.l).toBeLessThan(0.02);
    expect(screen.roughness).toBeLessThanOrEqual(0.1);
    expect(screen.emissiveIntensity === 0 || screen.emissive.getHex() === 0).toBe(true);
    built.free();
  });

  test.each(variantsOf(ARCHETYPE.tv_unit))(
    '%s frames its screen in black glass on a stand, never in the metal slot of the handles',
    (_id, object, variant) => {
      const built = build(object, variant);
      const stand = built.registry.get(built.asset.finishes['leg']!);
      const screen = built.registry.get(built.asset.finishes['screen']!);
      // Everything standing on the cabinet top is the TV: plate, post, bezel, panel.
      const tv = meshes(built.group).filter((mesh) => boxOf(mesh).min.y >= 0.5 - 0.001);
      const parts = tv.map((mesh) => (mesh.material === screen ? 'screen' : mesh.material === stand ? 'stand' : 'other'));
      expect(parts.sort()).toEqual(['screen', 'screen', 'stand', 'stand']);
      built.free();
    },
  );
});

describe('a fixture with a tap declares the top of its carcass', () => {
  const FIXTURES = variantsOf(ARCHETYPE.island_kitchen, ARCHETYPE.vanity_sink, ARCHETYPE.bathtub);

  /** The tap's meshes and the box of everything else. */
  function split(group: THREE.Group): { taps: THREE.Mesh[]; body: THREE.Box3; whole: THREE.Box3 } {
    const parts = meshes(group);
    const body = new THREE.Box3();
    for (const mesh of parts) if (mesh.name !== TAP_NAME) body.union(boxOf(mesh));
    return { taps: parts.filter((mesh) => mesh.name === TAP_NAME), body, whole: boxOf(group) };
  }

  test.each(FIXTURES)('%s: layout.blockingHeight is its carcass top, and the tap is what makes it taller', (id, object, variant) => {
    const built = build(object, variant);
    const blocking = object.layout?.blockingHeight;
    expect({ id, declared: blocking !== undefined }).toEqual({ id, declared: true });
    const carcass = meshes(built.group).filter((mesh) => mesh.name === CARCASS_TOP[object.id]);
    expect(carcass.length).toBe(1);
    // One value per archetype: exact for the catalogue size, within a trim for
    // a size variant (the compact bath's rim is 0.56 m against the 0.58 m one).
    expect(Math.abs(boxOf(carcass[0]!).max.y - blocking!)).toBeLessThanOrEqual(variant.dims ? TRIM_M : 0.0005);
    // The overall height an exporter writes as `dims` is the tap's, not the body's.
    const { taps, body, whole } = split(built.group);
    expect(taps.length).toBe(3);
    expect(whole.max.y).toBeGreaterThan(body.max.y + 0.05);
    built.free();
  });

  test.each(FIXTURES)('%s: the tap stands inside the plan of its body, so no footprint fraction is declared', (id, object, variant) => {
    const built = build(object, variant);
    const { taps, body } = split(built.group);
    expect(taps.length).toBe(3);
    for (const tap of taps) {
      const box = boxOf(tap);
      const inside = box.min.x >= body.min.x && box.max.x <= body.max.x && box.min.z >= body.min.z && box.max.z <= body.max.z;
      expect({ id, inside }).toEqual({ id, inside: true });
    }
    expect(object.layout?.footprint).toBeUndefined();
    built.free();
  });
});

describe('the vanity basin is a vessel', () => {
  test.each(variantsOf(ARCHETYPE.vanity_sink))('%s: the basin is open, the stone top its floor', (_id, object, variant) => {
    const built = build(object, variant);
    const basin = meshes(built.group).filter((mesh) => mesh.name === 'vanity-basin');
    expect(basin.length).toBe(1);
    const geometry = basin[0]!.geometry as THREE.CylinderGeometry;
    expect(geometry.parameters.openEnded).toBe(true);
    built.free();
  });
});

/** The one named part whose top is the fixture's carcass top: the worktop, the vanity's stone top, the bath's rim. */
const CARCASS_TOP: Readonly<Record<string, string>> = {
  [ARCHETYPE.island_kitchen]: 'island-worktop',
  [ARCHETYPE.vanity_sink]: 'vanity-top',
  [ARCHETYPE.bathtub]: 'bath-shell',
};
