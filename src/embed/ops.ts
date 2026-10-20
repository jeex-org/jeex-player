/**
 * `jeex-viewer/ops`: the published entry for the scene-operation vocabulary.
 *
 * It is the entry an EDITOR HOST consumes. Such a host's own ops layer is a
 * thin wrapper over `scene/scene-ops.ts`, applying operations to a document
 * server-side, away from any renderer — so this file re-exports exactly the
 * names that path needs and nothing else: the pure `applyOp` and its `OpError`,
 * the `SceneModel` that owns revision tracking and the accept/reject result
 * shape, the validator the model loads through, the registries interface plus
 * the shipped `CATALOGUE_REGISTRIES` a server-side caller injects, the finish
 * projections, the touched-asset predicates, the plan solver and the layout
 * lint. It also carries the two boundaries the caller reaches for rather than
 * inventing them: the interior-preset helpers (a preset is just a batch of
 * ops) and the `zod/mini` op and scene schemas, so a host can shape-check a
 * document before it hands it to the validator.
 *
 * Three names close the gaps a host would otherwise fill with a workaround of
 * its own: `parseSceneOps` and `parseSceneDocument` judge an unknown value and
 * hand back the HAND-WRITTEN type, so a caller compiling with
 * `exactOptionalPropertyTypes` needs no cast and never touches Zod's own
 * inference; `registriesFromLibrary` builds `SceneRegistries` from a library
 * manifest, so a document may name a project's own `assetLibrary` instead of
 * the host substituting registries behind the validator's back. `assetRefOf`
 * is the one rule a reference is read by (schema 2.2): a placement's bare
 * `asset` UUID in its `library`, else in the document's `assetLibrary`, else in
 * the registries' default — a host asking which library a placement belongs to
 * asks it rather than restating the fallback.
 *
 * Every member of the `SceneOp` union is exported by name, because an editor
 * types one panel to one operation. Two more names serve those panels, and
 * both are answers the REGISTRIES give rather than new functions:
 * `registries.openingVariantsOf(type)` lists what a `<select>` may offer for a door or a window (type
 * `OpeningVariantOption`), and `registries.defaultFloorFinish` says what
 * `add_room` writes when the editor names no floor — the shipped catalogues
 * answer the UUID of their oak floor, a project library answers with its own
 * first floor material.
 *
 * Invariant: this module and everything it imports stay free of `three` and of
 * the DOM. It sits at the top of the layer order (`embed`, above `assets` and
 * `scene` in `.dependency-cruiser.cjs`), so it MAY import anything below it —
 * what it may not do is drag a renderer or a document into the host's
 * process. Every module named here is on the pure side of that line
 * (`src/purity.test.ts`); the schemas it reaches are the documented
 * `zod/mini` boundary modules, which pull in neither.
 *
 * The baked-project boundary closes the same gap for a bake rather than a bare
 * scene: `parseProjectManifest` judges a downloaded `project.json` against the
 * `zod/mini` manifest schema and hands back the very object, and
 * `projectLibraryOf` projects that manifest's library into the narrow
 * `ProjectLibrary` the scene layer reads. The manifest vocabulary travels with
 * them as hand-written types — `BakedProjectManifest`,
 * `ProjectLibraryManifest`, `ProjectMaterial`, `ProjectObject`,
 * `ProjectVariant` — so the producer of a bake types it without importing
 * from `assets/` directly.
 *
 * The entry carries one more set — what external FORMAT CONVERTERS ask for:
 * plan geometry (`dist`, `sub`, `dot`, `pointInPolygon`, `distanceToPolygon`,
 * `closestOnSegment`, `arcFromChord`, `arcLength`, `arcPointAt`,
 * `EPS_PLANAR`), the plan graph (`buildGraph`), openings (`effectiveOpening`,
 * `clampOpening`, `OPENING_EDGE_MARGIN`), tolerances (`DEFAULT_TOLERANCE`),
 * the quantisation key (`quantiseKey`), the error classes and the schema-issue
 * helpers (`ViewerLibError`, `isViewerLibError`, `badParams`, `issueDetail`,
 * `issuePath`) and the vocabulary of scene ids and limits
 * (`UUID_V7_PATTERN`, `isUuidV7`, `WALL_LIMITS`, `isDoorLike`). The scene
 * model stays the viewer's, the converters the host's.
 *
 * The entry also carries two names for the PLAN UNDERLAY in a host editor:
 * `PLAN_PADDING` and `fitTransform` with their types `PlanBounds`/`PlanTransform`
 * (the plan drawing).
 *
 * And the FREE-SPACE HELPER for a host's catalogue dialog: `suggestPlacement`
 * with the types `PlacementRequest`/`PlacementSuggestion` and
 * `projectLayoutCatalogue` with the types `LayoutCatalogue`/`LayoutFacts`.
 * It is a QUERY, not an operation: the viewer answers with a pose, the host
 * composes `place_object`. `catalogue` is optional — without it the shipped
 * bank is read; `projectLayoutCatalogue` is the one public bank builder, and
 * a catalogue dialog asks about the BAKED PROJECT with it, not the shipped one.
 *
 * A name that is not re-exported here is not public, whatever module it lives
 * in — the same façade rule the library's other entries follow. Widening it is
 * one more named export, never an `export *`.
 */

export {
  applyOp,
  OpError,
  floorFinishOf,
  roomWallFinishOf,
  facadeFinishOf,
  faceFinishOf,
  TOUCHED_SHELL,
  TOUCHED_FACADE,
  isTouchedAsset,
} from '../scene/scene-ops.js';
export type { OpOutcome, SceneOp, InteriorPreset } from '../scene/scene-ops.js';
// The tour-checkpoint vocabulary: the entity a host editor's panels type, and
// whether a document rides its cameras. The op TYPE travels with the other
// union members above. The route itself (`tourRouteOf`) is NOT exported: it
// walks the plan's doorways, no host consumes it, and the viewer derives it at
// play time — its ~1.2 KB gzip would put this entry over its budget.
export type { TourCheckpoint } from '../scene/types.js';
export { hasTourRoute } from '../scene/tour-route.js';

export { SceneModel, isApplyOk } from '../scene/scene-model.js';
export type {
  ApplyBatch,
  ApplyOk,
  ApplyFailure,
  ApplyResult,
  AppliedOp,
  LintMode,
  RevisionListener,
  SceneModelOptions,
} from '../scene/scene-model.js';

export { validateScene } from '../scene/scene-validator.js';

export { parseSceneOps, parseSceneDocument } from '../scene/scene-parse.js';

export { assetRefOf, registriesFromLibrary } from '../scene/registries.js';
export type {
  SceneRegistries,
  CatalogueArchetype,
  CataloguePlacement,
  CatalogueVariantRef,
  LibraryCatalogue,
  LibraryFinish,
  ProjectLibrary,
  AssetRef,
  AssetRefFields,
  OpeningVariantFamily,
  OpeningVariantOption,
} from '../scene/registries.js';

export type {
  SceneData,
  Vec2,
  Vec3,
  DemoAsset,
  Wall,
  Room,
  Opening,
  PlanNode,
  WallArc,
  WallRole,
  RoomKind,
  OpeningType,
  OpeningShape,
  OpeningHinge,
  OpeningSwing,
  MaterialDefinition,
  CameraPose,
  TourGazeKey,
  TourSpeedZone,
  SchemaVersion,
  LengthUnit,
  Mirror,
  MirrorAxis,
  MirrorFacts,
} from '../scene/types.js';

// Every member of the `SceneOp` union by name, so a host can type an editor
// action ("the door panel produces a `SetOpeningOp`") instead of narrowing the
// union by hand at every call site. The union itself comes through
// `scene-ops.js` above.
export type {
  SetMaterialOp,
  SetCeilingOp,
  AddNodeOp,
  MoveNodeOp,
  RemoveNodeOp,
  AddWallOp,
  SetWallOp,
  RemoveWallOp,
  SplitWallOp,
  AddOpeningOp,
  SetOpeningOp,
  RemoveOpeningOp,
  ReplaceOpeningVariantOp,
  AddRoomOp,
  SetRoomOp,
  RemoveRoomOp,
  PlaceObjectOp,
  MoveObjectOp,
  RotateObjectOp,
  SetObjectOp,
  RemoveObjectOp,
  MirrorObjectOp,
  ReplaceAssetVariantOp,
  SetCameraOp,
  SetCameraTarget,
  SetNavigationOp,
  SetAutotourOp,
  SetTourCheckpointsOp,
} from '../scene/types.js';

export { solvePlan } from '../plan/plan-solver.js';
export type { SolvedPlan } from '../plan/plan-solver.js';

export { lintLayout, countIssues, describeIssues } from '../layout/layout-lint.js';
export type { LayoutIssue, LayoutRule, LayoutIssueCounts } from '../layout/layout-lint.js';
export type { LayoutLinter } from '../layout/layout-issue.js';

/**
 * The free-space helper: a pure QUERY, not an operation — the host gets a pose
 * and composes `place_object` itself. It brings almost no new modules into the entry graph:
 * `lintContext`, `nearestFace`, `door-swing` and the object bank are already
 * reachable through `lintLayout` and `solvePlan`.
 *
 * `PlacementRequest.catalogue` is OPTIONAL — omitted, the helper reads the
 * shipped bank — so these two exports are what a caller needs in order to ask
 * about something else: `projectLayoutCatalogue` is the only public BUILDER of
 * a bank (the shipped default stays private), which is how a catalogue dialog
 * asks about a BAKED PROJECT, and `LayoutCatalogue` / `LayoutFacts` are the
 * types that let a caller name and hold the bank it built.
 */
export { suggestPlacement } from '../layout/free-space.js';
export type { PlacementRequest, PlacementSuggestion } from '../layout/free-space.js';
export { projectLayoutCatalogue } from '../layout/layout-lint.js';
export type { LayoutCatalogue, LayoutFacts } from '../layout/layout-lint.js';

export { applyPresetBatch, findPreset, standardPreset, presetCoverage, presetBatchOps } from '../scene/interior-presets.js';
export type { PresetModel, PresetCoverage } from '../scene/interior-presets.js';

export { sceneSchema, sceneOpSchema, isSceneShape, sceneShapeIssues } from '../scene/types.schema.js';

export { OPENING_TYPES, ROOM_KINDS, WALL_ROLES } from '../scene/schema-sets.js';

export { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';

export { parseProjectManifest } from '../assets/project-manifest.schema.js';
export { projectLibraryOf } from '../assets/project-manifest.js';
export type {
  BakedProjectManifest,
  ProjectLibraryManifest,
  ProjectMaterial,
  ProjectObject,
  ProjectRights,
  ProjectRightsAsset,
  ProjectVariant,
} from '../assets/project-manifest.js';

/**
 * What external FORMAT CONVERTERS take from the viewer.
 *
 * The scene model stays here, the converters live there, and the only channel
 * between them is this entry. None of the modules listed pulls in `three` or
 * touches the DOM, so the header's invariant holds; `plan-geometry`,
 * `plan-graph`, `plan-openings` and `tolerance` were already in the entry's
 * graph through `solvePlan`, and the only new module is `shared/quantise.ts`.
 *
 * `EPS_PLANAR` comes from `plan-geometry.js`, which itself re-exports it from
 * `tolerance.js`: naming it twice would declare one name from two modules.
 */
export {
  EPS_PLANAR,
  arcFromChord,
  arcLength,
  arcPointAt,
  closestOnSegment,
  dist,
  distanceToPolygon,
  dot,
  pointInPolygon,
  sub,
} from '../plan/plan-geometry.js';
export type { ArcDef, Bounds } from '../plan/plan-geometry.js';

export { buildGraph } from '../plan/plan-graph.js';
export type { GraphFace, HalfEdge, PlanGraph } from '../plan/plan-graph.js';

export { OPENING_EDGE_MARGIN, clampOpening, effectiveOpening } from '../plan/plan-openings.js';
export type { OpeningBounds, OpeningGeometry } from '../plan/plan-openings.js';

export { DEFAULT_TOLERANCE } from '../plan/tolerance.js';
export type { Tolerance } from '../plan/tolerance.js';

export { quantiseKey } from '../shared/quantise.js';

export { ViewerLibError, isViewerLibError } from '../shared/errors.js';
export type { ErrorDetail, ViewerErrorCode, ViewerLibErrorOptions } from '../shared/errors.js';

export { badParams, issueDetail, issuePath } from '../shared/schema-issues.js';
export type { SchemaIssue } from '../shared/schema-issues.js';

export { WALL_LIMITS, isDoorLike } from '../scene/types.js';
export type { SceneReport, SceneReportEntry, SceneReportSeverity } from '../scene/types.js';

/**
 * Identifiers: the viewer CHECKS
 * ids and never mints one, so a host gets the very check the validator runs —
 * `UUID_V7_PATTERN` and `isUuidV7` — and nothing that generates. Faces are
 * derived, not entities, and travel as `FaceKey`; `faceKey`, `sameFace` and
 * `isFaceKey` build, compare and judge one; `NewIdRefusal` names the two
 * `OpError.detail.reason` values a creating op refuses an id with.
 * `CATALOGUE_ID_BY_SLUG` is the shipped bank's readable slug -> UUID table
 * per kind, for a host translating a 1.x document; the structural ids (walls, nodes, rooms, openings,
 * placements, checkpoints) have no table — the host mints new UUIDs for them.
 */
export { UUID_V7_PATTERN, isUuidV7, faceKey, sameFace, isFaceKey } from '../scene/types.js';
export type { FaceKey, FaceFinish, SetMaterialAlias, TopologyRemap, TopologyRemapEntry } from '../scene/types.js';
export type { NewIdRefusal, TouchedEntity } from '../scene/scene-ops.js';
export { CATALOGUE_ID_BY_SLUG } from '../assets/catalogue-slugs.js';
export type { CatalogueIdBySlug, CatalogueSlugTable } from '../assets/catalogue-slugs.js';

/**
 * What a HOST EDITOR takes from the viewer for the PLAN UNDERLAY:
 * `PLAN_PADDING` — the margin share when the drawing is fitted
 * to the canvas — and `fitTransform`, the conversion of plan metres to canvas
 * pixels, with their types `PlanBounds` and `PlanTransform`. The
 * drawing and the painter stay the viewer's. `plan-canvas.ts` looks up no DOM
 * roots — `window` is named once, behind a `typeof window === 'undefined'`
 * guard (pixel density), as in `materials/canvas-2d.ts`, so the module imports
 * outside a browser too; `three` is named nowhere, the header's invariant holds.
 */
export { PLAN_PADDING } from '../plan/plan-canvas.js';

export { fitTransform } from '../plan/plan-drawing.js';
export type { PlanBounds, PlanTransform } from '../plan/plan-drawing.js';
