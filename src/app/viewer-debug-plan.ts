/**
 * The two plan projections of `window.__viewerDebug` (`viewer-debug.ts`): the
 * solved plan as click coordinates for a browser check, and the primitive
 * counts of the 2D drawing. Beside the contract file rather than in it: that
 * file sits at its 700-line limit, and these two derive data from the model
 * without touching the stage, so they move as one read. They import the plan
 * side one way; nothing imports them back.
 *
 * Pure module: no `three`, no DOM.
 */

import { polylineMidpoint } from '../plan/plan-geometry.js';
import { buildPlanDrawing } from '../plan/plan-drawing.js';
import { planDrawingInputs } from '../assets/plan-fixtures.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { FaceKey } from '../scene/types.js';
import type { AssetFactsSource } from '../assets/asset-facts.js';

/** The solved plan as the debug surface hands it out (`__viewerDebug.plan()`): cloned, never the frozen plan by reference. */
export function planDebugDto(model: SceneModel): {
  rooms: Array<{ id: string; bbox: { minX: number; maxX: number; minZ: number; maxZ: number }; polygon: Array<{ x: number; z: number }> }>;
  facadeWalls: Array<{
    face: FaceKey;
    wallId: string;
    centre: { x: number; z: number };
    outward: { x: number; z: number };
    length: number;
  }>;
} {
  return {
    rooms: model.plan.rooms.map((room) => ({
      id: room.roomId,
      bbox: { ...room.bbox },
      polygon: room.polygon.map((point) => ({ x: point.x, z: point.z })),
    })),
    // A face without a midpoint (a degenerate polyline) is dropped rather
    // than reported at a fabricated origin — a caller that trusted `{0,0}`
    // as a real point would click on whatever facade wall happens to be
    // there instead of getting nothing.
    facadeWalls: model.plan.facade.flatMap((face) => {
      const centre = polylineMidpoint(face.polyline);
      if (!centre) return [];
      return [
        {
          face: { ...face.key },
          wallId: face.wallId,
          centre: { x: centre.x, z: centre.z },
          outward: { x: face.normal.x, z: face.normal.z },
          length: face.length,
        },
      ];
    }),
  };
}

/** How many primitives of each kind the 2D drawing of the current document has (`__viewerDebug.planDrawing()`). */
export function planDrawingCounts(model: SceneModel, assetFacts: AssetFactsSource): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const primitive of buildPlanDrawing(model.plan, model.scene, planDrawingInputs(model.scene, assetFacts)).primitives) {
    counts[primitive.kind] = (counts[primitive.kind] ?? 0) + 1;
  }
  return counts;
}
