/**
 * What the 2D plan draws for a host's selection (`ViewerHandle.setSelection`):
 * the wall, the opening, the room or the placement it names, as plan-metre
 * geometry the painter strokes and fills over the drawing (`plan-canvas`).
 *
 * The 3D highlight tints meshes; the 2D drawing has no meshes, so the target
 * is read off the solved plan instead: a wall is its centreline at its own
 * thickness, an opening the stretch of that centreline it spans, a room the
 * floor it owns, a placement the point it stands on.
 *
 * Pure module: no `three`, no DOM.
 */

import { polylineSlice } from './plan-geometry.js';
import type { SolvedPlan } from './plan-solver.js';
import type { SceneData, Vec2 } from '../scene/types.js';

/** A selection target as the highlight reads it: what kind of thing, and its id. */
export type PlanSelectionTarget = { readonly kind: 'wall' | 'opening' | 'room' | 'furniture'; readonly id: string };

/** Plan-metre geometry to paint for a selection: polylines with a width, filled areas, and points. */
export type PlanSelectionMark = {
  readonly lines: readonly { readonly points: readonly Vec2[]; readonly width: number }[];
  readonly areas: readonly (readonly Vec2[])[];
  readonly points: readonly Vec2[];
};

const NOTHING = { lines: [], areas: [], points: [] } as const;

/** The mark for `target` on this plan, or `null` when the document does not carry it. */
export function selectionMark(plan: SolvedPlan, scene: SceneData, target: PlanSelectionTarget): PlanSelectionMark | null {
  switch (target.kind) {
    case 'wall': {
      const line = plan.centrelines.find((candidate) => candidate.wallId === target.id);
      return line ? { ...NOTHING, lines: [{ points: line.polyline, width: line.thickness }] } : null;
    }
    case 'opening': {
      const wall = scene.walls.find((candidate) => (candidate.openings ?? []).some((opening) => opening.id === target.id));
      const opening = wall?.openings?.find((candidate) => candidate.id === target.id);
      const line = wall && plan.centrelines.find((candidate) => candidate.wallId === wall.id);
      if (!opening || !line) return null;
      const span = polylineSlice(line.polyline, line.length, opening.center - opening.width / 2, opening.center + opening.width / 2);
      return span.length < 2 ? null : { ...NOTHING, lines: [{ points: span, width: line.thickness }] };
    }
    case 'room': {
      const room = plan.rooms.find((candidate) => candidate.roomId === target.id);
      return room ? { ...NOTHING, areas: [room.polygon] } : null;
    }
    case 'furniture': {
      const asset = scene.assets.find((candidate) => candidate.id === target.id);
      return asset ? { ...NOTHING, points: [{ x: asset.position.x, z: asset.position.z }] } : null;
    }
  }
}
