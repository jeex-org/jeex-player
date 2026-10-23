/**
 * The two catalogue questions the 2D plan drawing does not ask for itself:
 * WHICH placements are drawn as fixtures, and how big each one is.
 *
 * `plan/plan-drawing.ts` is a pure drawing pass over solved plan data. To
 * outline a bath or a hob it needs a category (from the object bank) and a
 * footprint (from the resolved variant's dimensions), and importing either
 * would make the plan layer depend on the catalogue and the collision system
 * four layers above it. It takes both as data, and this is where the data is
 * resolved.
 *
 * Invariant: only FLOOR-anchored fixtures get an outline. A hood hangs above
 * the worktop and a pendant above the table; neither has a footprint on a floor
 * plan, and `isPlanFixtureCategory` is what says so.
 *
 * Pure module: no `three`, no DOM.
 */

import { shippedAssetFacts, type AssetFactsSource } from './asset-facts.js';
import { footprintOf } from './asset-footprint.js';
import { openingFrameWidth } from './opening-frame.js';
import { obbQuad } from '../plan/plan-geometry.js';
import { isPlanFixtureCategory, type PlanDrawingOptions, type PlanFixture } from '../plan/plan-drawing.js';
import { effectiveAsset, type SceneData } from '../scene/types.js';

/**
 * Every bath and kitchen fixture of the scene, as a plan footprint quad, read
 * against `source` — the bank the document was loaded with — so a baked
 * project's own bath is drawn as surely as the shipped one.
 */
export function planFixtures(scene: SceneData, source: AssetFactsSource = shippedAssetFacts): PlanFixture[] {
  const fixtures: PlanFixture[] = [];
  for (const placement of scene.assets) {
    const facts = source(placement);
    if (!facts || facts.anchor !== 'floor' || !isPlanFixtureCategory(facts.category)) continue;
    const footprint = footprintOf(placement, source);
    if (!footprint) continue;
    const asset = effectiveAsset(placement);
    const polygon = obbQuad({
      x: asset.position.x,
      z: asset.position.z,
      hx: footprint.hx,
      hz: footprint.hz,
      angle: asset.rotationY,
    });
    fixtures.push({ polygon, category: facts.category });
  }
  return fixtures;
}

/**
 * Everything `buildPlanDrawing` needs from the catalogue, in one call.
 *
 * One function so a consumer of the drawing (the `plan2d` mode, the mini-map,
 * the debug surface) says `buildPlanDrawing(plan, scene, planDrawingInputs(scene))`
 * and never has to know which of the inputs came from where.
 */
export function planDrawingInputs(scene: SceneData, source: AssetFactsSource = shippedAssetFacts): PlanDrawingOptions {
  return { frameWidthOf: openingFrameWidth, fixtures: planFixtures(scene, source) };
}
