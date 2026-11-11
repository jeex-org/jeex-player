/**
 * Interior presets rewritten after an edit that keeps what they dress but
 * changes its id: today a split wall, whose halves inherit everything the wall
 * carried. A removal forgets instead (`context.forgetReferencesInPresets`).
 *
 * Pure module: no `three`, no DOM.
 */

import type { Draft } from '../../shared/committed.js';
import type { SceneData, SceneOp, SplitWallOp } from '../types.js';
import { referencesOf } from './context.js';

/**
 * The preset instructions naming a split wall, rewritten onto its halves: a
 * face paint and a `set_wall` (or `remove_wall`) become one per half with the
 * same owner and side, and a `set_opening` that puts an opening on the wall
 * moves to the half its `center` falls in, measured from that half's start.
 * Anything else that names the wall is forgotten, as a removal forgets it.
 */
export function splitWallInPresets(scene: Draft<SceneData>, op: SplitWallOp): void {
  if (!scene.interiors) return;
  const [first, second] = op.ids;
  const halfHolding = (openingId: string): string | undefined =>
    scene.walls.find(
      (wall) => (wall.id === first || wall.id === second) && (wall.openings ?? []).some((opening) => opening.id === openingId),
    )?.id;
  const rewrite = (candidate: Draft<SceneOp>): Draft<SceneOp>[] => {
    if (!referencesOf(candidate).walls.includes(op.wallId)) return [candidate];
    const onBoth = (wallId: string): Draft<SceneOp> | undefined => {
      if (candidate.op === 'set_wall' || candidate.op === 'remove_wall') return { ...candidate, wallId };
      if (candidate.op !== 'set_material') return undefined;
      if (candidate.surface !== undefined)
        return candidate.face === undefined ? undefined : { ...candidate, face: { ...candidate.face, wallId } };
      return typeof candidate.target === 'object' ? { ...candidate, target: { ...candidate.target, wallId } } : undefined;
    };
    const firstCopy = onBoth(first);
    const secondCopy = onBoth(second);
    if (firstCopy !== undefined && secondCopy !== undefined) return [firstCopy, secondCopy];
    if (candidate.op === 'set_opening') {
      const center = candidate.center;
      // Without a centre the instruction edits the opening where it stands:
      // on whichever half now carries it.
      if (center === undefined) return [{ ...candidate, wallId: halfHolding(candidate.openingId) ?? first }];
      if (center < op.at) return [{ ...candidate, wallId: first }];
      return [{ ...candidate, wallId: second, center: center - op.at }];
    }
    return [];
  };
  scene.interiors = scene.interiors.flatMap((preset) => {
    const ops = preset.ops.flatMap(rewrite);
    return ops.length === 0 ? [] : [{ ...preset, ops }];
  });
}
