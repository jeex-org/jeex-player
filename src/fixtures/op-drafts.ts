/**
 * The three things every operation test needs: a fresh draft of the L-shape
 * plan, an opening looked up by id, and the message an applier refused with.
 *
 * They live here rather than in one of the test files because `scene-ops.ts`
 * was split into `scene/ops/*` and its tests moved with the appliers — three
 * copies of the same six lines is exactly the duplication a split is supposed
 * to avoid.
 *
 * No `bun:test` import: a refusal is asserted by THROWING when the operation
 * was accepted or raised something other than an `OpError`, so this module
 * stays usable from any runner.
 */

import { draftOf, type Draft } from '../shared/committed.js';
import { lShapePlan } from './plan-l-shape.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { OpError, applyOp, type SceneOp } from '../scene/scene-ops.js';
import type { Opening, SceneData } from '../scene/types.js';

/** A fresh, deeply mutable copy of the L-shape fixture. */
export function opDraft(): Draft<SceneData> {
  return draftOf(lShapePlan);
}

/** The opening with that id, wherever it hangs; throws when the fixture has none. */
export function openingOf(scene: Draft<SceneData>, id: string): Draft<Opening> {
  for (const wall of scene.walls) {
    const found = (wall.openings ?? []).find((candidate) => candidate.id === id);
    if (found) return found;
  }
  throw new Error(`fixture has no opening ${id}`);
}

/** Applies `op` expecting an `OpError`, and answers with its message. */
export function rejectsOp(scene: Draft<SceneData>, op: SceneOp): string {
  try {
    applyOp(scene, op, CATALOGUE_REGISTRIES);
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    return error.message;
  }
  throw new Error(`operation ${String((op as { op?: unknown }).op)} was expected to be rejected`);
}
