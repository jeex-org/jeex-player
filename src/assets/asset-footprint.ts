/**
 * How big a placement is on the floor, and the obstacle list the walk collides
 * with.
 *
 * This is a CATALOGUE question, so it lives with the object bank, and it is
 * answered from ONE source (`asset-facts.ts`): the bank the document was
 * loaded with, a baked project's own library over the shipped one. What
 * consumes it is `navigation/`, four layers below, which is why the answer is
 * handed down as data (`Obstacle[]`) rather than looked up from there.
 *
 * Which floor objects are obstacles (the walk rule, in this order):
 * 1. the placement's explicit `collision`, always;
 * 2. else an object the bank knows: floor-anchored, and at least
 *    `MIN_COLLIDABLE_HEIGHT` tall — `layout.blockingHeight` when the archetype
 *    declares one, else its `dims` height — so a rug or a door mat is walked
 *    over while a sofa, a bath or a table lamp is walked around; its plan size
 *    is `dims` times `layout.footprint` (a FRACTION of the plan size: a plant's
 *    pot rather than its canopy) when declared, else all of `dims`;
 *    wall and ceiling pieces are walked under, never around;
 * 3. else the legacy per-type table, for a `type` word the bank has no entry
 *    for;
 * 4. else nothing: a placement no bank can size is left out rather than given
 *    a guess.
 * Whatever the source, the result is multiplied by the placement's footprint
 * scale, so a scaled-up sofa is a scaled-up obstacle.
 *
 * Pure module: no `three`, no DOM.
 */

import { MIN_COLLIDABLE_HEIGHT } from './asset-catalogue.js';
import { shippedAssetFacts, type AssetFacts, type AssetFactsSource } from './asset-facts.js';
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
 * The floor share of an archetype's plan size, half-extents in metres before
 * rotation and before the placement scale; `null` for anything walked over or
 * under (rule 2 of the module header).
 */
function factsFootprint(facts: AssetFacts): { hx: number; hz: number } | null {
  if (facts.anchor !== 'floor') return null;
  const height = facts.layout?.blockingHeight ?? facts.dims[1];
  if (height < MIN_COLLIDABLE_HEIGHT) return null;
  const standing = facts.layout?.footprint ?? 1;
  return { hx: (facts.dims[0] / 2) * standing, hz: (facts.dims[2] / 2) * standing };
}

/**
 * Collision footprint of one placement, metres of half-extent before rotation,
 * by the walk rule of the module header; `source` is the document's bank.
 */
export function footprintOf(asset: DemoAsset, source: AssetFactsSource = shippedAssetFacts): { hx: number; hz: number } | null {
  const scale = footprintScaleOf(asset);
  const explicit = asset.collision;
  if (explicit) return { hx: explicit.hx * scale, hz: explicit.hz * scale };
  const facts = source(asset);
  const footprint = facts ? factsFootprint(facts) : DEFAULT_FOOTPRINTS[asset.type];
  if (!footprint) return null;
  return { hx: footprint.hx * scale, hz: footprint.hz * scale };
}

/**
 * Every placement of the scene as a walk obstacle, in authoring order, sized
 * against `source` — the bank the document was loaded with.
 *
 * A placement the bank cannot size is left out rather than given a guess: an
 * obstacle nobody can see the size of is worse than none at all.
 */
export function obstaclesFor(scene: SceneData, source: AssetFactsSource = shippedAssetFacts): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const placement of scene.assets) {
    const footprint = footprintOf(placement, source);
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
