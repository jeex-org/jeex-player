/**
 * Which jamb a door hangs on, which way it opens and how many leaves it has,
 * as a host's door panel shows it: the value the document carries, or the one
 * the viewer derives.
 *
 * It answers from `plan/door-swing.resolveDoorSwing` with the same frame width
 * (`assets/opening-frame.openingFrameWidth`) the layout linter and the plan
 * drawing use, so a panel reading "automatic (now: a)" and the drawn leaf can
 * never disagree. It reads the document only, as they do: a variant's own
 * `swing` is not read (the opening builder lets it fill a missing swing; every
 * shipped variant says `'in'`). `leaves` comes from
 * `assets/opening-frame.openingLeafCount`, the variant's `leaf.style` the
 * builder reads. It sits in `layout/`, the lowest layer that reaches both.
 *
 * Invariants: `explicit` says only whether the document names the value; the
 * answered `hinge` and `swing` are always the resolved ones. With `leaves: 2`
 * the door hangs a leaf on both jambs; `hinge` is still the drawing's jamb,
 * and a panel shows "both jambs" and offers no hinge choice.
 *
 * Pure module: no `three`, no DOM.
 */

import { openingFrameWidth, openingLeafCount } from '../assets/opening-frame.js';
import { resolveDoorSwing } from '../plan/door-swing.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData } from '../scene/types.js';

/** A door's resolved hinge and swing, its leaf count, and whether the document carries each value. */
export type DoorLeaf = {
  /** Jamb the leaf hangs on, named by the wall node it is nearer to; the drawing's jamb when `leaves` is 2. */
  hinge: 'a' | 'b';
  /** `'in'` towards the wall's interior side, `'out'` towards the other one. */
  swing: 'in' | 'out';
  /** `2` for a double door, whose leaves hang on both jambs; `1` otherwise. */
  leaves: 1 | 2;
  explicit: { hinge: boolean; swing: boolean };
};

/**
 * The leaf of the door `openingId`, or `null` when the scene has no door with
 * that id. Without `plan` the scene's plan is solved here; a caller that holds
 * the `SolvedPlan` of this very scene passes it. A scene whose plan does not
 * solve throws the solver's `PlanError` there (a `ViewerLibError` of code
 * `scene-invalid`): validate the scene first, or catch it.
 */
export function doorLeaf(scene: SceneData, openingId: string, plan?: SolvedPlan): DoorLeaf | null {
  for (const wall of scene.walls) {
    const opening = (wall.openings ?? []).find((candidate) => candidate.id === openingId);
    if (!opening) continue;
    if (opening.type !== 'door') return null;
    const swing = resolveDoorSwing(scene, plan ?? solvePlan(scene), wall, opening, openingFrameWidth);
    return {
      hinge: swing.hinge,
      swing: swing.swing,
      leaves: openingLeafCount(opening),
      explicit: { hinge: opening.hinge !== undefined, swing: opening.swing !== undefined },
    };
  }
  return null;
}
