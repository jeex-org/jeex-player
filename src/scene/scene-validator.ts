/**
 * Validates a scene against schema 2.2: a shape gate, then a TABLE of sections
 * over one `ValidationContext`, with the plan solved in the middle.
 *
 * Invariant: `validateScene` either returns the very object it was handed
 * (narrowed to `SceneData`) or throws a `SceneValidationError` whose message
 * starts with `Scene validation failed: `, whose `rule` is the kebab-case id of
 * the check that refused it and whose `path` is the JSON path of the offending
 * field (`walls[3].openings[1].head`). A `PlanError` from the solver is
 * rewrapped the same way, keeping its `planCode` in `detail`. Points that fall
 * outside every room and doorway are reported through the injected `Logger`
 * (the host's `onLog`, else the console) and never throw.
 *
 * Structure invariant: the ORDER of the two tables is the contract. A section
 * may assume everything the sections above it checked and nothing else, which
 * is why the sections that read the solved plan are a separate list rather than
 * a flag on one — the plan cannot be solved before the walls are sound, and the
 * preset dry-run cannot run before everything an operation may name is.
 *
 * Identity invariant: every entity id is a UUID v7 (`isUuidV7`) — the scene's
 * own, and every node, wall, room, opening, asset, material, preset and tour
 * checkpoint — and is unique across ALL kinds, the same set a creating
 * operation checks against (`ops/context.claimedIds`). A UUID can never be one of
 * the `set_material` aliases or a prototype key, so nothing else needs
 * reserving; a face is not an entity and is checked as a `FaceKey` against
 * the solved plan (`validate/assets.ts`).
 *
 * Pure module: no `three`, no DOM.
 */

import { PlanError } from '../plan/plan-graph.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import { defaultLogger, type Logger } from '../shared/logger.js';
import { fail, newContext, type PlanSection, type Section, type ValidationContext } from './validate/context.js';
import { assertSceneShape } from './validate/shape.js';
import { checkMaterials, checkNodes, checkRooms } from './validate/plan-entities.js';
import { checkWalls } from './validate/walls.js';
import { checkAssets, checkFinishes } from './validate/assets.js';
import { checkCameras, checkPoses } from './validate/cameras.js';
import { checkReachablePoints } from './validate/reachability.js';
import { checkInteriorPresets } from './validate/presets.js';
import type { SceneRegistries } from './registries.js';
import type { SceneData } from './types.js';

/** The wall schema's numeric limits, re-exported for a host that validates before it builds. */
export { WALL_LIMITS } from './types.js';

/** The sections that run on the document alone, in order. */
const SECTIONS: readonly Section[] = [
  { name: 'poses', check: checkPoses },
  { name: 'nodes', check: checkNodes },
  { name: 'materials', check: checkMaterials },
  { name: 'rooms', check: checkRooms },
  { name: 'walls', check: checkWalls },
];

/**
 * The sections that need the solved plan, in order.
 *
 * `assets` and `cameras` do not read the plan themselves, but they run here
 * because the order is the document's own: face overrides are checked first
 * (they are the reason the plan is solved at all), and the preset dry-run is
 * last.
 */
const PLAN_SECTIONS: readonly PlanSection[] = [
  { name: 'finishes', check: checkFinishes },
  { name: 'assets', check: (ctx) => checkAssets(ctx) },
  { name: 'cameras', check: (ctx) => checkCameras(ctx) },
  { name: 'reachability', check: checkReachablePoints },
  { name: 'presets', check: (ctx) => checkInteriorPresets(ctx) },
];

/**
 * The plan of a document whose walls are already sound, with the solver's own
 * refusal rewrapped as this validator's.
 */
function solve(ctx: ValidationContext): SolvedPlan {
  try {
    return solvePlan(ctx.scene);
  } catch (error) {
    if (error instanceof PlanError) fail('plan-unsolvable', 'walls', `${error.message} [${error.planCode}]`, { planCode: error.planCode });
    throw error;
  }
}

/**
 * Validates a document, or throws.
 *
 * `registries` is what a reference is checked against and is HANDED IN
 * (`scene/registries.ts`): the catalogues live two layers above this one, and
 * a validator that imported them could only ever validate against the shipped
 * bank. `assets/catalogue-registries.CATALOGUE_REGISTRIES` is what a viewer
 * passes.
 */
export function validateScene(input: unknown, registries: SceneRegistries, log: Logger = defaultLogger): SceneData {
  assertSceneShape(input);
  const ctx = newContext(input, registries, log);
  for (const section of SECTIONS) section.check(ctx);
  const plan = solve(ctx);
  for (const section of PLAN_SECTIONS) section.check(ctx, plan);
  return input;
}
