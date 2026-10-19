/**
 * The typed entrance to the op vocabulary: judge an unknown value against the
 * `zod/mini` schemas, then hand the ORIGINAL value back in the hand-written
 * type.
 *
 * It exists for a consumer OUTSIDE this repository — an editor host applies
 * operations it received over the wire, and it compiles with
 * `exactOptionalPropertyTypes: true`. Casting an `unknown` to `SceneOp[]`
 * there is a promise nobody checked, and reading Zod's own inferred type
 * instead spells every optional field `x: T | undefined` rather than `x?: T`,
 * which is a different type and an assignment error at every call site. So the
 * schema is asked the yes/no question and the value the caller already had
 * flows on, narrowed: `parseSceneOps(input) === input` is the invariant, and
 * `scene-parse.test.ts` asserts it with `toBe`.
 *
 * Refusals are `ViewerLibError('scene-invalid')` with the first issue's JSON
 * path on `path` and the capped list on `detail.issues`
 * (`shared/schema-issues.ts`), which is the same shape `validateScene` and the
 * importers already refuse with — one error table for a host, whichever side
 * said no.
 *
 * What this module does NOT decide is what `validateScene` decides: references,
 * ranges, uniqueness, the solved plan. A document that parses here can still be
 * refused there, and that is the split (`types.schema.ts` module header).
 *
 * Pure module: no `three`, no DOM.
 */

import { schemaRefusal } from '../shared/schema-issues.js';
import { sceneIssues, sceneOpsIssues } from './types.schema.js';
import type { SceneData, SceneOp } from './types.js';

/**
 * A batch of operations, judged and returned as it came.
 *
 * @throws ViewerLibError `scene-invalid` when the value is not an array of
 * operations this viewer knows, with every issue in `detail.issues`.
 */
export function parseSceneOps(input: unknown): SceneOp[] {
  const issues = sceneOpsIssues(input);
  if (issues.length > 0) throw schemaRefusal('scene-invalid', 'parseSceneOps', issues);
  return input as SceneOp[];
}

/**
 * A scene document, judged against the whole schema of `types.ts` and returned
 * as it came.
 *
 * @throws ViewerLibError `scene-invalid` when the document is not shaped like a
 * scene, with every issue in `detail.issues`.
 */
export function parseSceneDocument(input: unknown): SceneData {
  const issues = sceneIssues(input);
  if (issues.length > 0) throw schemaRefusal('scene-invalid', 'parseSceneDocument', issues);
  return input as SceneData;
}
