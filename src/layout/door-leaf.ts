/**
 * Which jamb a door hangs on and which way it opens, as a host's door panel
 * shows it: the value the document carries, or the one the viewer derives.
 *
 * It answers from `plan/door-swing.resolveDoorSwing` with the same frame width
 * (`assets/opening-frame.openingFrameWidth`) the layout linter, the plan
 * drawing and the opening builder use, so a panel reading "automatic (now:
 * left)" and the drawn leaf can never disagree. It sits in `layout/`, the
 * lowest layer that reaches both.
 *
 * Invariant: `explicit` says only whether the document names the value; the
 * answered `hinge` and `swing` are always the resolved ones.
 *
 * Pure module: no `three`, no DOM.
 */

import { openingFrameWidth } from '../assets/opening-frame.js';
import { resolveDoorSwing } from '../plan/door-swing.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import type { SceneData } from '../scene/types.js';

/** A door's resolved hinge and swing, and whether the document carries each. */
export type DoorLeaf = {
  /** Jamb the leaf hangs on, named by the wall node it is nearer to. */
  hinge: 'a' | 'b';
  /** `'in'` towards the wall's interior side, `'out'` towards the other one. */
  swing: 'in' | 'out';
  explicit: { hinge: boolean; swing: boolean };
};

/**
 * The leaf of the door `openingId`, or `null` when the scene has no door with
 * that id. Without `plan` the scene's plan is solved here; a caller that holds
 * the `SolvedPlan` of this very scene passes it.
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
      explicit: { hinge: opening.hinge !== undefined, swing: opening.swing !== undefined },
    };
  }
  return null;
}
