/**
 * How big a placement is on the floor, and the obstacle list the walk collides
 * with.
 *
 * This is a CATALOGUE question — the answer comes from the resolved variant's
 * own dimensions — so it lives with the object bank. What consumes it is
 * `navigation/`, four layers below, which is why the answer is handed down as
 * data (`Obstacle[]`) rather than looked up from there.
 *
 * Invariant: the order is the placement's explicit `collision`, then the object
 * bank, then the legacy per-type table; whatever the source, the result is
 * multiplied by the placement's footprint scale, so a scaled-up sofa is a
 * scaled-up obstacle.
 *
 * Pure module: no `three`, no DOM.
 */

import { footprintFor, parseAssetRef } from './asset-catalogue.js';
import { effectiveAsset, footprintScaleOf } from '../scene/types.js';
import type { Obstacle } from '../navigation/navigation.js';
import type { DemoAsset, DemoAssetType, SceneData } from '../scene/types.js';

/** Footprints (half-extents, metres, before rotationY) used when an asset does not declare its own. */
const DEFAULT_FOOTPRINTS: Partial<Record<DemoAssetType, { hx: number; hz: number }>> = {
  sofa: { hx: 1.34, hz: 0.52 },
  armchair: { hx: 0.46, hz: 0.46 },
  bed: { hx: 0.9, hz: 1.14 },
  nightstand: { hx: 0.27, hz: 0.22 },
  wardrobe: { hx: 0.88, hz: 0.32 },
  dresser: { hx: 0.66, hz: 0.26 },
  desk: { hx: 0.62, hz: 0.34 },
  table: { hx: 0.9, hz: 0.5 },
  chair: { hx: 0.25, hz: 0.25 },
  stool: { hx: 0.2, hz: 0.2 },
  'side-table': { hx: 0.28, hz: 0.28 },
  'tv-unit': { hx: 0.92, hz: 0.24 },
  bookshelf: { hx: 0.8, hz: 0.18 },
  plant: { hx: 0.3, hz: 0.3 },
  lamp: { hx: 0.18, hz: 0.18 },
  counter: { hx: 1.22, hz: 0.36 },
  stove: { hx: 0.38, hz: 0.34 },
  fridge: { hx: 0.4, hz: 0.38 },
  island: { hx: 1.22, hz: 0.58 },
  bathtub: { hx: 0.86, hz: 0.42 },
  toilet: { hx: 0.36, hz: 0.24 },
  vanity: { hx: 0.5, hz: 0.27 },
  'shoe-cabinet': { hx: 0.5, hz: 0.2 },
  'coat-rack': { hx: 0.12, hz: 0.12 },
  console: { hx: 0.45, hz: 0.18 },
};

/**
 * Collision footprint of one placement, metres of half-extent before rotation.
 *
 * Order: the placement's explicit `collision`, then the object bank (the
 * resolved variant's own `dims`, so a size variant collides at its real size),
 * then the legacy per-type table. Whatever the source, the result is multiplied
 * by the absolute placement scale, so a scaled-up sofa is a scaled-up obstacle.
 */
export function footprintOf(asset: DemoAsset): { hx: number; hz: number } | null {
  const scale = footprintScaleOf(asset);
  const explicit = asset.collision;
  if (explicit) return { hx: explicit.hx * scale, hz: explicit.hz * scale };
  const ref = asset.variant ?? bareAssetRef(asset.asset) ?? asset.type;
  const catalogue = footprintFor(ref) ?? (ref === asset.type ? null : footprintFor(asset.type));
  const footprint = catalogue ?? DEFAULT_FOOTPRINTS[asset.type];
  if (!footprint) return null;
  return { hx: footprint.hx * scale, hz: footprint.hz * scale };
}

/**
 * `library:asset_uuid` -> `asset_uuid`; the catalogue indexes bare ids.
 *
 * Delegated to `parseAssetRef`, which splits at the LAST colon: a library id
 * may contain one itself (`starter:interior-v1`), and splitting at the first
 * one turned `starter:interior-v1:<uuid>` into a lookup that never resolved,
 * so the placement silently fell back to its legacy type footprint.
 */
function bareAssetRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return parseAssetRef(ref).assetId;
}

/**
 * Every placement of the scene as a walk obstacle, in authoring order.
 *
 * A placement the bank cannot size is left out rather than given a guess: an
 * obstacle nobody can see the size of is worse than none at all.
 */
export function obstaclesFor(scene: SceneData): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const placement of scene.assets) {
    const footprint = footprintOf(placement);
    if (!footprint) continue;
    const asset = effectiveAsset(placement);
    obstacles.push({
      x: asset.position.x,
      z: asset.position.z,
      hx: footprint.hx,
      hz: footprint.hz,
      cos: Math.cos(asset.rotationY),
      sin: Math.sin(asset.rotationY),
    });
  }
  return obstacles;
}
