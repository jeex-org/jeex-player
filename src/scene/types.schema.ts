/**
 * The scene document of schemas 2.2, 2.3 and 2.4 as a `zod/mini` schema: the whole thing —
 * every entity `types.ts` declares, in the order it declares them — plus the
 * cheap SHAPE gate that only proves the containers.
 *
 * Invariant: this schema JUDGES and never TRANSFORMS. There is no
 * `.transform()`, `.default()` or `.catch()` anywhere in it, so `z.input` and
 * `z.output` coincide and a caller may keep the value it already had. Nothing
 * downstream ever receives `result.data`: `z.object` strips the keys it was not
 * told about, and a document may legitimately carry a key this schema does not
 * name (a top-level `$schema`, which `schema-check.test.ts` pins as accepted).
 *
 * Two schemas, two questions, and they are not the same question:
 *
 * - `sceneShapeSchema` is what `validate/shape.ts` proves and not one field
 *   more — the containers, the versions and the identity a reader needs before
 *   it may look at anything. It is the cheap gate the `jeex-viewer/ops` entry
 *   publishes as `isSceneShape`/`sceneShapeIssues`, which a host editor's
 *   importer runs over an imported document before it becomes a project, and
 *   its key ORDER is a contract (see below).
 * - `sceneSchema` is the whole document. It is the source of the published
 *   JSON Schema's agreement test and the measured candidate for
 *   `validate/shape.ts`. It never runs in the viewer's
 *   own load path today, and no library boot file reaches it
 *   (`src/purity.test.ts`).
 *
 * What it does NOT decide is what `validateScene` decides: ranges
 * (`WALL_LIMITS`, an opening's fit on its wall), references (a node, a room, a
 * catalogue entry, a finish), uniqueness of ids, the solved plan. It does
 * decide that every entity id, and every reference to an entity of the
 * document, is a UUID v7 — the grammar is structural; WHICH entity a UUID
 * names is not. A placement's `asset` and `library` and the document's
 * `assetLibrary` are UUIDs too (schema 2.2), which is grammar; whether the
 * library is declared and holds that asset is not. Other catalogue references
 * (finishes, variants) stay plain strings here: the validator resolves them
 * against the registries it is handed, and a project library is judged there,
 * not by a grammar written into this file. The split is
 * a table, `types.schema.test.ts`'s «rule → structural/semantic», derived from
 * the validator's own sources so a new rule cannot land unclassified.
 *
 * The closed sets (`OpeningType`, `RoomKind`, `RoomPurpose`, `WallRole`,
 * `OpeningShape`, `OpeningHinge`, `OpeningSwing`) are spelled here as literals rather than
 * read from `scene/schema-sets.ts`: that module sits in the `scene` layer,
 * which is ABOVE `scene/types` in the layer order (`.dependency-cruiser.cjs`),
 * so this file may not import it. What binds them to their unions instead is
 * the compile-time agreement check in `types.schema.test.ts` — a value added
 * to `OpeningType` and not to this file fails to compile there.
 *
 * `SceneData` and its entity types stay hand-written in `types.ts` and this
 * schema is their proved twin: a published `.d.ts` built from `z.infer` would
 * leak `zod`'s own types into the package under `check:pkg`.
 *
 * WHAT IT WOULD COST TO RUN THIS INSTEAD OF `validate/shape.ts` (measured on
 * a developer machine: bun 1.4.1, zod 4.6.1, best of seven
 * passes of 1000 runs after 300 warm-up, one process per case). Microseconds
 * per run:
 *
 * |                                    | lShapePlan | apartmentScene |
 * |------------------------------------|-----------:|---------------:|
 * | `assertSceneShape` (today's gate)  |      0.023 |          0.021 |
 * | `isSceneShape` (this file, shape)  |       3.07 |          15.20 |
 * | `safeParse(sceneSchema)`           |      13.75 |         167.28 |
 * | `safeParse(z.compile(…))`          |       1.51 |          29.22 |
 * | `z.validate(sceneSchema)`          |      15.82 |         166.16 |
 * | `z.validate(z.compile(…))`         |       1.04 |          12.38 |
 * | `validateScene`, whole document    |      20.59 |        1030.10 |
 *
 * `z.compile` costs 0.82 ms once. Retained heap per parse of the 52.3 KB demo
 * document: the hand-written gate ~0 B, `safeParse` 52.2 KB (a `z.object`
 * rebuilds the whole document as output), `z.validate` ~0.7 KB — which is why
 * a compiled schema would have to answer the happy path through `z.validate`
 * and reach for `safeParse` only to say what is wrong.
 *
 * Size, gzip -9 per file, both sides measured the same way. The schema travels
 * in `jeex-viewer-ops.js` (its budget is in `scripts/budget-check.ts`), and no
 * library boot file carries it.
 * With `validate/shape.ts` running it, `jeex-viewer-element-<hash>.js` grows
 * by 15.16 KB and `jeex-viewer.iife.js` by 13.75 KB when `z.compile` comes
 * along, and by 5.76 KB / 5.24 KB on the runtime parser. `jeex-viewer-host*`
 * is untouched either way.
 *
 * `z.compile` generates its parser with `new Function`, but a host whose CSP
 * forbids that does not break: `compile()` catches the failure and hands back
 * the original schema on the runtime parser (verified with `Function` blocked
 * — a valid document still parses). `z.withParser` exists for installing a
 * parser generated elsewhere, and is not needed for correctness.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { HEX_COLOUR_PATTERN, SCHEMA_VERSIONS, UUID_V7_PATTERN, schemaVersionBefore } from './types.js';
import type { SchemaIssue } from '../shared/schema-issues.js';
import type { SchemaVersion, SceneData } from './types.js';

/**
 * The document version this build reads (`SchemaVersion`). A 1.x document is
 * refused with the same sentence `validate/shape.ts` refuses it with: its ids
 * are not UUIDs, and the viewer never mints one. Exported for `app/provenance.schema.ts`, which needs the identical
 * version check on `Provenance.schemaVersion` rather than a second, drifting
 * copy of it.
 */
export const schemaVersionSchema = z.literal(SCHEMA_VERSIONS, {
  error: (issue) =>
    typeof issue.input === 'string' && issue.input.startsWith('1.')
      ? 'schemaVersion must be 2.x (every id a UUID v7); 1.x documents are not read'
      : `Unsupported scene schema; expected ${SCHEMA_VERSIONS.map((version) => `'${version}'`).join(' or ')}`,
});

/** The only unit the schema speaks (`types.ts` `LengthUnit`); absent means metres. */
const lengthUnitSchema = z.literal('m', { error: "Unsupported scene units; expected 'm'" });

/**
 * Every entity id and every reference to an entity: a lowercase canonical UUID
 * v7, READ from `types.ts` (`UUID_V7_PATTERN`, the pattern `isUuidV7` tests)
 * rather than restated, so the schema cannot drift from the validator. A regex
 * check rather than a refine, so the published JSON Schema carries the same
 * `pattern` (`scripts/schema-gen.ts`).
 */
const uuidSchema = z.string().check(z.regex(UUID_V7_PATTERN, { error: 'not a UUID v7' }));

/** A string with something in it: the validator refuses an empty name, colour, type or reference. */
const nonEmptySchema = z.string().check(z.minLength(1));

/** `WallSide`: which side of its wall a face is. */
const wallSideSchema = z.enum(['L', 'R']);

/**
 * `FaceKey`: strict, like `isFaceKey` — a face carries its owners and its side
 * and nothing else, so an unknown key is refused rather than stripped.
 */
export const faceKeySchema = z.strictObject({ room: z.optional(uuidSchema), wallId: uuidSchema, side: wallSideSchema });

/**
 * `FinishObject` (schema 2.3): strict, its `material` a UUID v7, `colour`
 * `#rrggbb` (a regex check, so the published JSON Schema carries the pattern),
 * `rotation` a finite number, and at least one of the two modifiers — an
 * object with neither is the bare UUID spelled twice. WHICH material it may
 * name (a library material that dresses the surface) is the validator's
 * question, like every other finish reference.
 */
const finishObjectSchema = z
  .strictObject({
    material: uuidSchema,
    colour: z.optional(z.string().check(z.regex(HEX_COLOUR_PATTERN, { error: 'not a #rrggbb colour' }))),
    rotation: z.optional(z.number()),
  })
  .check(
    z.refine((value) => value.colour !== undefined || value.rotation !== undefined, {
      error: 'a finish object needs colour or rotation; use the bare UUID',
    }),
  );

/** `FinishRef`: a bare finish UUID (judged against the registries, like every finish) or a `FinishObject`. */
export const finishRefSchema = z.union([z.string(), finishObjectSchema]);

/** `FaceFinish`: one entry of `finishes.faces`, the face plus the finish it wears. */
const faceFinishSchema = z.strictObject({
  room: z.optional(uuidSchema),
  wallId: uuidSchema,
  side: wallSideSchema,
  finish: finishRefSchema,
});

const vec2Schema = z.object({ x: z.number(), z: z.number() });
const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });

/** Exported for `app/provenance.schema.ts`'s `camera` field (`CameraPose`). */
export const cameraPoseSchema = z.object({ position: vec3Schema, target: vec3Schema });

/** Longest storey name the schema accepts, in characters (`shape.ts`). */
const MAX_STOREY_NAME = 64;

/** `Storey` (`types.ts`): both fields optional, and what IS there has to be usable. */
const storeySchema = z.object({
  name: z.optional(z.string().check(z.minLength(1), z.maxLength(MAX_STOREY_NAME))),
  elevation: z.optional(z.number()),
});

/**
 * `site` (schema 2.3). Strict, unlike its neighbours: a misspelt key
 * (`north_deg`) would otherwise orient nothing, in silence. Whether the
 * document's version may carry it is the documents' own refinement below.
 */
const siteSchema = z.strictObject(
  { northDeg: z.optional(z.number()), sun: z.optional(z.enum(['morning', 'noon', 'evening'])) },
  {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? `site carries an unknown key: ${issue.keys.join(', ')}` : 'site must be an object',
  },
);

/**
 * A 2.2 document carries no library finish: no finish object anywhere, and
 * no room `ceiling` or `trim`. The issue lands at the first such field, the
 * path the runtime validator's `finish-needs-schema-2-3` names.
 */
const finishesNeedTheirVersion = z.superRefine((scene: { schemaVersion?: unknown; finishes?: unknown }, ctx) => {
  if (scene.schemaVersion !== '2.2' || typeof scene.finishes !== 'object' || scene.finishes === null) return;
  const message = "needs schemaVersion '2.3'; a 2.2 document carries no finish object, ceiling or trim";
  const finishes = scene.finishes as { rooms?: Record<string, Record<string, unknown>>; faces?: { finish?: unknown }[]; facade?: unknown };
  for (const [room, entry] of Object.entries(finishes.rooms ?? {})) {
    for (const key of ['floor', 'walls', 'ceiling', 'trim']) {
      const value = entry?.[key];
      if (value === undefined || (typeof value === 'string' && key !== 'ceiling' && key !== 'trim')) continue;
      ctx.addIssue({ code: 'custom', message, path: ['finishes', 'rooms', room, key] });
      return;
    }
  }
  const face = (finishes.faces ?? []).findIndex((entry) => typeof entry?.finish === 'object' && entry.finish !== null);
  if (face >= 0) ctx.addIssue({ code: 'custom', message, path: ['finishes', 'faces', face, 'finish'] });
  else if (typeof finishes.facade === 'object' && finishes.facade !== null)
    ctx.addIssue({ code: 'custom', message, path: ['finishes', 'facade'] });
});

/** A 2.2 document carries no `site`: the field is 2.3's. */
const siteNeedsItsVersion = z.refine(
  (scene: unknown) => {
    const { schemaVersion, site } = scene as { schemaVersion?: unknown; site?: unknown };
    return site === undefined || schemaVersion !== '2.2';
  },
  { error: "site needs schemaVersion '2.3'; a 2.2 document carries no site", path: ['site'] },
);

/**
 * A pre-2.4 document carries no room `purpose`: the field is 2.4's. The issue
 * lands at the first room that carries one, with the same sentence the runtime
 * validator refuses with. The version is asked first only for a value INSIDE
 * the vocabulary: an out-of-vocabulary value is refused by the room enum
 * before this refinement runs (at the same path), and the version-first order
 * for every value belongs to `checkRooms`. An unknown version gets no issue
 * here either — the version literal above refuses it first.
 */
const purposeNeedsItsVersion = z.superRefine((scene: { schemaVersion?: unknown; rooms?: unknown }, ctx) => {
  if (typeof scene.schemaVersion !== 'string' || !schemaVersionBefore(scene.schemaVersion as SchemaVersion, '2.4')) return;
  const rooms = Array.isArray(scene.rooms) ? scene.rooms : [];
  const at = rooms.findIndex((room) => (room as { purpose?: unknown } | null)?.purpose !== undefined);
  if (at < 0) return;
  const room = rooms[at] as { id?: unknown; purpose?: unknown };
  ctx.addIssue({
    code: 'custom',
    message: `Room ${String(room.id)} purpose needs scene schema 2.4; this document is ${scene.schemaVersion}`,
    path: ['rooms', at, 'purpose'],
  });
});

/* ------------------------------------------------------- plan entities --- */

const planNodeSchema = z.object({ id: uuidSchema, p: vec2Schema });

const wallArcSchema = z.object({ radius: z.number(), ccw: z.boolean() });

const openingSchema = z.object({
  id: uuidSchema,
  type: z.enum(['door', 'window', 'passage']),
  center: z.number(),
  width: z.number(),
  sill: z.optional(z.number()),
  head: z.optional(z.number()),
  shape: z.optional(z.enum(['flat', 'arch'])),
  variant: z.optional(z.string()),
  hinge: z.optional(z.enum(['a', 'b'])),
  swing: z.optional(z.enum(['in', 'out'])),
  entrance: z.optional(z.boolean()),
});

/**
 * `Wall`. `a` and `b` are node UUIDs, so they carry the id grammar: WHICH node
 * they name is `validateScene`'s question, but a string that could not be an
 * id at all is this one's.
 */
const wallSchema = z.object({
  id: uuidSchema,
  a: uuidSchema,
  b: uuidSchema,
  thickness: z.number(),
  arc: z.optional(wallArcSchema),
  role: z.optional(z.enum(['bearing', 'partition', 'facade'])),
  openings: z.optional(z.array(openingSchema)),
});

const roomSchema = z.object({
  id: uuidSchema,
  name: nonEmptySchema,
  anchor: vec2Schema,
  floorMaterial: z.string(),
  accent: z.optional(z.string()),
  kind: z.optional(z.enum(['room', 'loggia'])),
  // The `RoomPurpose` vocabulary, spelled as literals like every closed set
  // here; whether a document's version may carry it is the refinement below.
  purpose: z.optional(
    z.enum([
      'living',
      'kitchen',
      'kitchen-living',
      'bedroom',
      'kids',
      'study',
      'bathroom',
      'wc',
      'hall',
      'corridor',
      'storage',
      'utility',
      'balcony',
    ]),
  ),
  polygon: z.optional(z.array(vec2Schema)),
});

const materialDefinitionSchema = z.object({
  id: uuidSchema,
  name: nonEmptySchema,
  // Wire-format field name: American spelling, as in `scene.json`.
  color: nonEmptySchema,
  roughness: z.number(),
  metalness: z.optional(z.number()),
});

/** `Mirror` (schema 2.1): only `true` is written for an axis; an absent axis is not mirrored. */
const mirrorSchema = z.strictObject({ x: z.optional(z.literal(true)), y: z.optional(z.literal(true)), z: z.optional(z.literal(true)) });

const demoAssetSchema = z.object({
  id: uuidSchema,
  type: nonEmptySchema,
  asset: z.optional(uuidSchema),
  library: z.optional(uuidSchema),
  variant: z.optional(nonEmptySchema),
  room: z.optional(uuidSchema),
  position: vec3Schema,
  rotationY: z.optional(z.number()),
  scale: z.optional(z.number()),
  mirror: z.optional(mirrorSchema),
  finishes: z.optional(z.record(z.string(), z.string())),
  material: z.optional(z.string()),
  collision: z.optional(z.object({ hx: z.number(), hz: z.number() })),
});

/* ------------------------------------------------- finishes and presets --- */

/**
 * `TourCheckpoint`. The id grammar here, the ranges (height
 * against the ceiling, the pitch clamp) in `validateScene` — the same split
 * every other entity keeps. Declared BEFORE the op union, which names it.
 */
const tourCheckpointSchema = z.object({
  id: uuidSchema,
  position: vec3Schema,
  yaw: z.number(),
  pitch: z.number(),
  name: z.optional(z.string()),
});

/** `RoomFinishes`. `ceiling` and `trim` are schema 2.3; the validator refuses them in a 2.2 document. */
const roomFinishesSchema = z.object({
  floor: z.optional(finishRefSchema),
  walls: z.optional(finishRefSchema),
  ceiling: z.optional(finishRefSchema),
  trim: z.optional(finishRefSchema),
});

/**
 * `SceneFinishes`. A ROOM key is a room UUID — which room it names is resolved
 * against the document, and the validator says so — and `faces` is a list of
 * face keys with their finish; whether each names a face the plan has, and
 * names it once, is the validator's question too.
 */
const sceneFinishesSchema = z.object({
  rooms: z.optional(z.record(uuidSchema, roomFinishesSchema)),
  faces: z.optional(z.array(faceFinishSchema)),
  facade: z.optional(finishRefSchema),
});

/** The op vocabulary (`SceneOp`, `types.ts`), discriminated by `op` the way a preset's batch is read. */
export const sceneOpSchema = z.discriminatedUnion('op', [
  // `set_material` has two forms, told apart by `surface` (absent in the
  // legacy form, which may not carry it) and each forbidding the other's key,
  // so an operation carrying both `target` and `surface` matches neither.
  z.discriminatedUnion('surface', [
    z.object({
      op: z.literal('set_material'),
      target: z.union([z.enum(['floors', 'walls', 'facade']), uuidSchema, faceKeySchema]),
      material: z.string(),
      scope: z.optional(z.enum(['room', 'face'])),
      surface: z.optional(z.undefined()),
    }),
    z.object({
      op: z.literal('set_material'),
      surface: z.enum(['floor', 'wall', 'ceiling', 'trim', 'facade']),
      room: z.optional(uuidSchema),
      face: z.optional(faceKeySchema),
      material: z.string(),
      colour: z.optional(z.string().check(z.regex(HEX_COLOUR_PATTERN, { error: 'not a #rrggbb colour' }))),
      rotation: z.optional(z.number()),
      target: z.optional(z.undefined()),
    }),
  ]),
  z.object({ op: z.literal('replace_asset_variant'), assetId: uuidSchema, variant: z.string() }),
  z.object({ op: z.literal('replace_opening_variant'), openingId: uuidSchema, variant: z.string() }),
  z.object({ op: z.literal('set_ceiling'), height: z.number() }),
  z.object({
    op: z.literal('set_opening'),
    openingId: uuidSchema,
    wallId: z.optional(uuidSchema),
    center: z.optional(z.number()),
    width: z.optional(z.number()),
    sill: z.optional(z.number()),
    head: z.optional(z.number()),
    dcenter: z.optional(z.number()),
    dwidth: z.optional(z.number()),
    dsill: z.optional(z.number()),
    dhead: z.optional(z.number()),
  }),
  z.object({
    op: z.literal('add_opening'),
    wallId: uuidSchema,
    type: z.enum(['door', 'window', 'passage']),
    center: z.number(),
    width: z.number(),
    sill: z.optional(z.number()),
    head: z.optional(z.number()),
    id: uuidSchema,
    entrance: z.optional(z.boolean()),
    variant: z.optional(z.string()),
  }),
  z.object({ op: z.literal('remove_opening'), openingId: uuidSchema }),
  z.object({
    op: z.literal('set_camera'),
    target: z.union([z.literal('presentation'), z.literal('walkSpawn'), z.object({ room: uuidSchema })]),
    pose: z.optional(cameraPoseSchema),
    remove: z.optional(z.literal(true)),
  }),
  z.object({ op: z.literal('set_navigation'), points: z.array(vec3Schema) }),
  z.object({
    op: z.literal('set_autotour'),
    path: z.optional(z.array(vec3Schema)),
    gaze: z.optional(z.array(z.object({ at: z.number(), target: vec3Schema }))),
    zones: z.optional(z.array(z.object({ at: z.number(), speed: z.number() }))),
    speed: z.optional(z.number()),
  }),
  // The tour checkpoints, wholesale:
  // the whole ordered list every time, an empty list clearing the field.
  z.object({
    op: z.literal('set_tour_checkpoints'),
    checkpoints: z.array(tourCheckpointSchema),
    speed: z.optional(z.number()),
  }),
  // Rooms. `name` carries `nonEmptySchema` and nothing more: the
  // 60-character ceiling is a RULE of the operation (`ops/limits.ROOM_NAME_MAX`)
  // and `applyAddRoom` refuses it with a sentence naming the limit, which a
  // schema issue could not.
  z.object({
    op: z.literal('add_room'),
    id: uuidSchema,
    name: nonEmptySchema,
    anchor: vec2Schema,
    floorMaterial: z.optional(z.string()),
    kind: z.optional(z.enum(['room', 'loggia'])),
    accent: z.optional(z.string()),
  }),
  z.object({
    op: z.literal('set_room'),
    roomId: uuidSchema,
    name: z.optional(z.string()),
    kind: z.optional(z.enum(['room', 'loggia'])),
    anchor: z.optional(vec2Schema),
    accent: z.optional(z.string()),
  }),
  z.object({ op: z.literal('remove_room'), roomId: uuidSchema }),
  // The purpose is a vocabulary value or `null`, and the key is REQUIRED: an
  // operation that names neither a value nor a clear says nothing. Whether the
  // document's version may take the operation is the applier's refusal
  // (`ops/rooms.ts`), like every version rule of an op.
  z.object({
    op: z.literal('set_room_purpose'),
    roomId: uuidSchema,
    purpose: z.nullable(
      z.enum([
        'living',
        'kitchen',
        'kitchen-living',
        'bedroom',
        'kids',
        'study',
        'bathroom',
        'wc',
        'hall',
        'corridor',
        'storage',
        'utility',
        'balcony',
      ]),
    ),
  }),
  // Furniture.
  z.object({
    op: z.literal('place_object'),
    id: uuidSchema,
    asset: uuidSchema,
    library: z.optional(uuidSchema),
    variant: z.optional(nonEmptySchema),
    room: z.optional(uuidSchema),
    position: vec3Schema,
    rotationY: z.optional(z.number()),
    finishes: z.optional(z.record(z.string(), z.string())),
  }),
  z.object({
    op: z.literal('move_object'),
    assetId: uuidSchema,
    position: z.optional(vec3Schema),
    dposition: z.optional(vec3Schema),
    room: z.optional(z.nullable(uuidSchema)),
  }),
  z.object({
    op: z.literal('rotate_object'),
    assetId: uuidSchema,
    rotationY: z.optional(z.number()),
    drotation: z.optional(z.number()),
  }),
  z.object({
    op: z.literal('set_object'),
    assetId: uuidSchema,
    finishes: z.optional(z.record(z.string(), z.string())),
    material: z.optional(z.string()),
    scale: z.optional(z.number()),
  }),
  z.object({ op: z.literal('remove_object'), assetId: uuidSchema }),
  z.object({ op: z.literal('mirror_object'), assetId: uuidSchema, mirror: mirrorSchema }),
  // The shell operations. WHICH node or wall an id names, whether
  // an edge is a duplicate and whether a move leaves a wall long enough are
  // `scene/ops/shell.ts`'s questions; this schema only proves the shape.
  z.object({ op: z.literal('add_node'), id: uuidSchema, p: vec2Schema }),
  z.object({ op: z.literal('move_node'), nodeId: uuidSchema, p: z.optional(vec2Schema), dp: z.optional(vec2Schema) }),
  z.object({ op: z.literal('remove_node'), nodeId: uuidSchema }),
  z.object({
    op: z.literal('add_wall'),
    id: uuidSchema,
    a: uuidSchema,
    b: uuidSchema,
    thickness: z.number(),
    role: z.optional(z.enum(['bearing', 'partition', 'facade'])),
    arc: z.optional(wallArcSchema),
  }),
  z.object({
    op: z.literal('set_wall'),
    wallId: uuidSchema,
    thickness: z.optional(z.number()),
    role: z.optional(z.enum(['bearing', 'partition', 'facade'])),
    // `null` is a VALUE here, not an omission: it is how `set_wall` says
    // "straighten this wall", which an absent key cannot say.
    arc: z.optional(z.nullable(wallArcSchema)),
  }),
  z.object({ op: z.literal('remove_wall'), wallId: uuidSchema }),
  // The split carries no optional field at all: every id is CALLER-minted, so a
  // journal replay mints the same ids. Whether `at` clears the openings, and
  // whether the ids are free, is `scene/ops/shell.ts`'s question; this schema
  // only proves the shape.
  z.object({
    op: z.literal('split_wall'),
    wallId: uuidSchema,
    at: z.number(),
    nodeId: uuidSchema,
    ids: z.tuple([uuidSchema, uuidSchema]),
  }), // Strict like `site` itself, and every refusal names its field; the
  // applier (`scene/ops/site.ts`) repeats the checks for a caller that
  // skipped this schema.
  z
    .strictObject(
      {
        op: z.literal('set_site'),
        northDeg: z.optional(z.nullable(z.number({ error: 'set_site northDeg must be a finite number or null' }))),
        sun: z.optional(
          z.nullable(z.enum(['morning', 'noon', 'evening'], { error: "set_site sun must be 'morning', 'noon', 'evening' or null" })),
        ),
      },
      {
        error: (issue) =>
          issue.code === 'unrecognized_keys' ? `set_site carries an unknown key: ${issue.keys.join(', ')}` : 'set_site must be an object',
      },
    )
    .check(z.refine((op) => op.northDeg !== undefined || op.sun !== undefined, { error: 'set_site needs northDeg or sun' })),
]);

const interiorPresetSchema = z.object({
  id: uuidSchema,
  name: nonEmptySchema,
  swatch: z.tuple([z.string(), z.string()]),
  ops: z.array(sceneOpSchema),
});

/* --------------------------------------------------- camera collections --- */

const tourGazeKeySchema = z.object({ at: z.number(), target: vec3Schema });
const tourSpeedZoneSchema = z.object({ at: z.number(), speed: z.number() });

const navigationSchema = z.object({ points: z.array(vec3Schema) });

const autotourSchema = z.object({
  speed: z.optional(z.number()),
  path: z.array(vec3Schema),
  gaze: z.array(tourGazeKeySchema),
  zones: z.optional(z.array(tourSpeedZoneSchema)),
});

/* ------------------------------------------------------- the documents --- */

/**
 * What `assertSceneShape` proves before any section runs, and nothing more.
 *
 * KEY ORDER IS THE CONTRACT: issues come back in declaration order (pinned by
 * `types.schema.test.ts`), and `validate/shape.ts` reports the FIRST failure —
 * so this object spells its keys in exactly the order `shape.ts:68-103` checks
 * them, and a later change can swap one for the other without a document changing
 * which rule refuses it.
 *
 * `z.number()` here means FINITE number in Zod 4.6 — `NaN` and both infinities
 * are refused — which is what `shape.ts` spells as `Number.isFinite`.
 */
const sceneShapeSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    units: z.optional(lengthUnitSchema),
    storey: z.optional(storeySchema),
    id: uuidSchema,
    name: nonEmptySchema,
    ceilingHeight: z.number().check(z.gte(2)),
    nodes: z.array(z.unknown()).check(z.minLength(3)),
    walls: z.array(z.unknown()).check(z.minLength(4)),
    rooms: z.array(z.unknown()).check(z.minLength(1)),
    materials: z.optional(z.array(z.unknown())),
    assets: z.array(z.unknown()),
    presentationCamera: cameraPoseSchema,
    roomCameras: z.record(z.string(), cameraPoseSchema),
    navigation: navigationSchema,
    site: z.optional(siteSchema),
    autotour: z.object({ path: z.array(vec3Schema), gaze: z.array(z.unknown()) }),
  })
  .check(siteNeedsItsVersion);

/**
 * The whole document of schemas 2.2, 2.3 and 2.4, key for key in `SceneData`'s own
 * declaration order (`types.ts`) — which is also the order
 * `validate/shape.ts` walks, so the FIRST issue of a document broken in
 * several places is the one the hand-written gate would have reported.
 *
 * Exported because `scripts/schema-gen.ts` and the JSON Schema agreement test
 * are its consumers; the entity schemas above stay private, since an export
 * without an importer is dead weight `knip` should be catching.
 */
export const sceneSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    units: z.optional(lengthUnitSchema),
    storey: z.optional(storeySchema),
    id: uuidSchema,
    name: nonEmptySchema,
    ceilingHeight: z.number().check(z.gte(2)),
    nodes: z.array(planNodeSchema).check(z.minLength(3)),
    walls: z.array(wallSchema).check(z.minLength(4)),
    rooms: z.array(roomSchema).check(z.minLength(1)),
    materials: z.optional(z.array(materialDefinitionSchema)),
    assetLibrary: z.optional(uuidSchema),
    assets: z.array(demoAssetSchema),
    presentationCamera: cameraPoseSchema,
    roomCameras: z.record(uuidSchema, cameraPoseSchema),
    navigation: navigationSchema,
    finishes: z.optional(sceneFinishesSchema),
    interiors: z.optional(z.array(interiorPresetSchema)),
    walkSpawn: z.optional(cameraPoseSchema),
    site: z.optional(siteSchema),
    autotour: autotourSchema,
    tourCheckpoints: z.optional(z.array(tourCheckpointSchema)),
  })
  .check(siteNeedsItsVersion, finishesNeedTheirVersion, purposeNeedsItsVersion);

/** A schema's own path step in this project's vocabulary; a symbol key cannot occur in JSON, and is named rather than dropped. */
function pathStep(step: PropertyKey): string | number {
  return typeof step === 'symbol' ? step.toString() : step;
}

/**
 * What a schema said, in this project's issue vocabulary; empty means it
 * accepted the value.
 *
 * The VALUE is never returned, on purpose: a caller keeps the object it
 * already had (module header), which is what lets the hand-written types stay
 * the public ones.
 */
function issuesOf(schema: z.ZodMiniType, input: unknown): readonly SchemaIssue[] {
  const result = z.safeParse(schema, input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.map(pathStep),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Every issue the shape check found, in declaration order; empty means the
 * value is shaped like a scene.
 */
export function sceneShapeIssues(input: unknown): readonly SchemaIssue[] {
  return issuesOf(sceneShapeSchema, input);
}

/**
 * Every issue the WHOLE document schema found — every field `types.ts`
 * declares, not just the containers the shape gate proves.
 *
 * It is what `scene/scene-parse.ts` judges a document with at a host's
 * import boundary; the viewer's own load path still runs the cheap gate and leaves
 * the rest to `validateScene` (module header, and the measurements in it).
 */
export function sceneIssues(input: unknown): readonly SchemaIssue[] {
  return issuesOf(sceneSchema, input);
}

/** Every issue an ARRAY of scene operations produced; the batch `SceneModel.apply` takes. */
export function sceneOpsIssues(input: unknown): readonly SchemaIssue[] {
  return issuesOf(z.array(sceneOpSchema), input);
}

/**
 * Type predicate over the same schema. It claims `SceneData` for the same
 * reason `assertSceneShape` does: the shape is what every downstream reader
 * needs, and the CONTENTS are `validateScene`'s question, one layer up.
 */
export function isSceneShape(input: unknown): input is SceneData {
  return z.safeParse(sceneShapeSchema, input).success;
}
