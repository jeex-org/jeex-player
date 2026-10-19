/**
 * IDS-style completeness checks: a scene can satisfy `validateScene` — every
 * shape and reference is sound — and still be an unfinished draft.
 * `checkCompleteness` names those gaps as a `SceneReport`, the same shape an
 * importer uses for an `ImportReport` (`scene/types.ts` declares the three
 * names and `embed/ops.ts` publishes them, so the two stay one shape).
 *
 * Invariant: NEVER throws, and every finding is `info` or `warning` — this is
 * a completeness gate over an already-solved plan, not the validity gate
 * `scene-validator.ts` owns. It reads `scene`'s own required fields directly
 * (the same trust `layout-lint.ts` and `__viewerDebug.layoutIssues` place in a
 * committed document) and only guards the fields the schema itself marks
 * optional.
 *
 * Severity decisions, recorded here so a later change does not re-litigate them
 * from scratch:
 * - `room-no-window`, `opening-no-variant`, `storey-missing` and
 *   `units-missing` are `info`. A windowless bathroom, closet or hall, an
 *   opening left at its catalogue default look, and a document that omits
 *   `storey`/`units` (the schema's own documented defaults) are all things a
 *   real, finished apartment does on purpose — the schema carries no
 *   room-kind field that would let this rule single out "should have
 *   daylight" rooms from ones that should not, so `warning` here would be
 *   noise on every normal plan rather than a genuine finding. The demo
 *   apartment (`src/demo/scene-data.ts`) is exactly such a plan: it triggers
 *   all four, which is why they are `info` rather than a downgrade applied
 *   after the fact.
 * - `room-no-door` (skipped entirely when the plan has one room),
 *   `no-entrance`, `asset-outside-rooms`, `room-unnamed` and
 *   `room-no-floor-finish` are `warning`: each names something
 *   `validateScene` does not itself catch on every path that can reach this
 *   function (an importer's intermediate document, or a scene handed
 *   to `__viewerDebug.completeness()` before a full validation pass) and that
 *   a finished, walkable apartment should not have.
 *
 * Pure module: no `three`, no DOM.
 */

import { pointInPolygon } from '../plan/plan-geometry.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { SceneRegistries } from './registries.js';
import { isDoorLike, type Opening, type SceneData, type SceneReport, type SceneReportEntry, type SceneReportSeverity } from './types.js';

/** The rule vocabulary `checkCompleteness` checks, in the order it runs them. */
export type CompletenessRule =
  | 'room-no-door'
  | 'room-no-window'
  | 'no-entrance'
  | 'opening-no-variant'
  | 'asset-outside-rooms'
  | 'room-unnamed'
  | 'storey-missing'
  | 'units-missing'
  | 'room-no-floor-finish';

/** One finding's optional trimmings; `code`, `severity` and `message` are always given. */
type EntryOptions = Pick<SceneReportEntry, 'entity' | 'path' | 'detail'>;

/** Builds one entry without ever assigning `undefined` to an optional field (`exactOptionalPropertyTypes`). */
function finding(
  code: CompletenessRule,
  severity: SceneReportSeverity,
  message: string,
  options?: Partial<EntryOptions>,
): SceneReportEntry {
  return {
    code,
    severity,
    message,
    ...(options?.entity === undefined ? {} : { entity: options.entity }),
    ...(options?.path === undefined ? {} : { path: options.path }),
    ...(options?.detail === undefined ? {} : { detail: options.detail }),
  };
}

function emptyReport(): SceneReport {
  return { entries: [], counts: { info: 0, warning: 0, error: 0 } };
}

function withEntry(report: SceneReport, entry: SceneReportEntry): SceneReport {
  return { entries: [...report.entries, entry], counts: { ...report.counts, [entry.severity]: report.counts[entry.severity] + 1 } };
}

/** Every opening authored on any wall of the document, in wall order. */
function allOpenings(scene: SceneData): readonly Opening[] {
  return scene.walls.flatMap((wall) => wall.openings ?? []);
}

/** A room reached by no door-like opening at all; meaningless with a single room (nothing else to connect to). */
function checkRoomNoDoor(plan: SolvedPlan): SceneReportEntry[] {
  if (plan.rooms.length <= 1) return [];
  return plan.rooms
    .filter((room) => !room.loop.some((face) => face.openings.some((opening) => isDoorLike(opening.type))))
    .map((room) =>
      finding('room-no-door', 'warning', `Room ${room.roomId} has no door or passage`, { entity: { kind: 'room', id: room.roomId } }),
    );
}

/** A room with no window on any of its faces. Interior rooms (baths, closets, halls) legitimately have none — see the module doc. */
function checkRoomNoWindow(plan: SolvedPlan): SceneReportEntry[] {
  return plan.rooms
    .filter((room) => !room.loop.some((face) => face.openings.some((opening) => opening.type === 'window')))
    .map((room) => finding('room-no-window', 'info', `Room ${room.roomId} has no window`, { entity: { kind: 'room', id: room.roomId } }));
}

/** The document names no front door (`Opening.entrance`). Scene-wide: no single entity to point at. */
function checkNoEntrance(scene: SceneData): SceneReportEntry[] {
  return allOpenings(scene).some((opening) => opening.entrance === true)
    ? []
    : [finding('no-entrance', 'warning', 'Scene has no entrance door')];
}

/** An opening left at its catalogue default look rather than a chosen variant — see the module doc. */
function checkOpeningNoVariant(scene: SceneData): SceneReportEntry[] {
  return allOpenings(scene)
    .filter((opening) => opening.variant === undefined)
    .map((opening) =>
      finding('opening-no-variant', 'info', `Opening ${opening.id} has no variant; using the default ${opening.type} look`, {
        entity: { kind: 'opening', id: opening.id },
      }),
    );
}

/** A placement whose pivot lands outside every room polygon of the solved plan. */
function checkAssetOutsideRooms(scene: SceneData, plan: SolvedPlan): SceneReportEntry[] {
  const polygons = plan.rooms.map((room) => room.polygon);
  return scene.assets
    .filter((asset) => !polygons.some((polygon) => pointInPolygon({ x: asset.position.x, z: asset.position.z }, polygon)))
    .map((asset) =>
      finding('asset-outside-rooms', 'warning', `Asset ${asset.id} is outside every room`, { entity: { kind: 'asset', id: asset.id } }),
    );
}

/** A room whose name is empty. `validateScene` already refuses this; kept here for a document that reaches this call without one. */
function checkRoomUnnamed(scene: SceneData): SceneReportEntry[] {
  return scene.rooms
    .filter((room) => !room.name.trim())
    .map((room) => finding('room-unnamed', 'warning', `Room ${room.id} has no name`, { entity: { kind: 'room', id: room.id } }));
}

/** The document omits `storey` — the schema's own documented default (one unnamed storey at 0), see the module doc. */
function checkStoreyMissing(scene: SceneData): SceneReportEntry[] {
  return scene.storey === undefined
    ? [finding('storey-missing', 'info', 'Scene names no building storey; assuming one unnamed storey at 0')]
    : [];
}

/** The document omits `units` — the schema's own documented default (metres), see the module doc. */
function checkUnitsMissing(scene: SceneData): SceneReportEntry[] {
  return scene.units === undefined ? [finding('units-missing', 'info', 'Scene names no explicit units; assuming metres')] : [];
}

/** A room whose floor material does not resolve as a floor finish in any catalogue. */
function checkRoomNoFloorFinish(scene: SceneData, registries: SceneRegistries): SceneReportEntry[] {
  return scene.rooms
    .filter((room) => !registries.isSurfaceFinish(room.floorMaterial))
    .map((room) =>
      finding('room-no-floor-finish', 'warning', `Room ${room.id} has no resolvable floor finish`, {
        entity: { kind: 'room', id: room.id },
      }),
    );
}

/**
 * Every completeness finding of `scene`/`plan`, in rule order. Never throws.
 *
 * `plan` is the ALREADY-solved plan of `scene` (`plan/plan-solver.solvePlan`,
 * or `SceneModel.plan`) — this function does not solve one itself, so a
 * caller that already has one (every path that reaches this: the debug
 * surface, a host's importer) pays for the solve once.
 */
export function checkCompleteness(scene: SceneData, plan: SolvedPlan, registries: SceneRegistries): SceneReport {
  const findings: SceneReportEntry[] = [
    ...checkRoomNoDoor(plan),
    ...checkRoomNoWindow(plan),
    ...checkNoEntrance(scene),
    ...checkOpeningNoVariant(scene),
    ...checkAssetOutsideRooms(scene, plan),
    ...checkRoomUnnamed(scene),
    ...checkStoreyMissing(scene),
    ...checkUnitsMissing(scene),
    ...checkRoomNoFloorFinish(scene, registries),
  ];
  return findings.reduce((report, entry) => withEntry(report, entry), emptyReport());
}
