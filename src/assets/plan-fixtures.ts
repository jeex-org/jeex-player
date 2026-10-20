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

import { findCatalogueEntry } from './asset-catalogue.js';
import { footprintOf } from './asset-footprint.js';
import { openingFrameWidth } from './opening-frame.js';
import { obbQuad } from '../plan/plan-geometry.js';
import { isPlanFixtureCategory, type PlanDrawingOptions, type PlanFixture } from '../plan/plan-drawing.js';
import { effectiveAsset, type DemoAsset, type SceneData } from '../scene/types.js';

/** Category of a placement, or `null` when the object bank does not know it. */
function categoryOf(asset: DemoAsset): { category: string; onFloor: boolean } | null {
  const entry = findCatalogueEntry(asset.asset ?? asset.type);
  if (!entry) return null;
  return { category: entry.object.category, onFloor: entry.object.anchor === 'floor' };
}

/** Every bath and kitchen fixture of the scene, as a plan footprint quad. */
export function planFixtures(scene: SceneData): PlanFixture[] {
  const fixtures: PlanFixture[] = [];
  for (const placement of scene.assets) {
    const facts = categoryOf(placement);
    if (!facts || !facts.onFloor || !isPlanFixtureCategory(facts.category)) continue;
    const footprint = footprintOf(placement);
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
export function planDrawingInputs(scene: SceneData): PlanDrawingOptions {
  return { frameWidthOf: openingFrameWidth, fixtures: planFixtures(scene) };
}
