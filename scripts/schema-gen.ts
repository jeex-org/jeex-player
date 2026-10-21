/**
 * Generates the two published JSON Schemas from the TypeScript types the
 * runtime already uses — `SceneData` (`src/scene/types.ts`) and
 * `ViewerOptions` (`src/app/viewer-options.ts`) — so there is exactly one
 * source of truth for the shape of a scene document and of the mount
 * options. Generation only: neither the generator nor Ajv reaches the shipped
 * bundle (`budget-check.ts` proves it; `check.sh`'s
 * schema-gate step runs this into a throwaway directory).
 *
 * `ts-json-schema-generator@2.9.0` (published 2026-03-04) declares
 * `typescript: ^5.9.3` as its OWN direct dependency, and the repository's own
 * `typescript` is `7.0.2` (published 2026-07-08), which does not satisfy that
 * range — so `bun install` nests a private `typescript@5.9.3` (published
 * 2025-09-30) under `node_modules/ts-json-schema-generator/node_modules`,
 * exactly like npm would. Verified against `SceneData`: generation succeeds with zero errors reading this
 * repository's TS7-authored sources, and `bun.lock` pins the nested version
 * deterministically. No explicit `"typescript5": "npm:typescript@5.x"` alias
 * devDependency was needed, and this paragraph is the record of why.
 *
 * WHY THIS IS STILL `ts-json-schema-generator` after the move to Zod (measured
 * against `zod@4.6.1` and this repository's own `scene/types.schema.ts`, not
 * assumed):
 *
 * - full `zod`'s `z.toJSONSchema()` DOES accept a schema built from `zod/mini`
 *   — the two subpaths share `zod/v4/core` — so the switch was technically
 *   open;
 * - but the output is a different DOCUMENT. It inlines everything: no `$id`
 *   (the generator's `schemaId`), no `$ref` root over `definitions` (34 named
 *   ones here — `SceneData`, `PlanNode`, `OpeningType`, …; `$defs` comes back
 *   empty), and a closed set arrives as `anyOf` of `const`s rather than the
 *   `enum` array `schema-gen.test.ts` matches against `scene/schema-sets.ts`;
 * - and every field DESCRIPTION is lost: 54 of them reach the published file
 *   from the JSDoc in `src/scene/types.ts` through `jsDoc: 'extended'`, and
 *   the Zod output carries none. `z.meta()` exists on the installed version,
 *   so they could be restored — by hand-copying 54 sentences into the schema
 *   beside the ones the types already carry, which is a second source of
 *   truth, not one.
 *
 * The two schemas agree where it matters and that is now PROVED rather than
 * assumed: draft 2020-12, `additionalProperties: false`, the same `required`
 * list, and the same verdict on every fixture and on six deliberately broken
 * documents (`schema-check.test.ts`, third describe). The generator stays; the
 * Zod schema is the runtime judge and the source of the types' proof.
 *
 * ONE deliberate exception to "the generator stays out of the way": a scene
 * document may carry a top-level `$schema` key so an editor can find the schema that describes it — JSON Schema's own
 * convention, not part of `SceneData`'s semantic shape, which is why
 * `src/scene/types.ts` does not declare the field. `validateScene` and the
 * Zod twin (`scene/types.schema.ts`) already tolerate it; the published
 * schema refused it, so a document this project itself publishes for editors
 * failed its own published schema. `additionalProperties: false` on the
 * generated `SceneData` definition is otherwise correct — it is the source of
 * the agreement this file proves above — so the fix is not to loosen it but
 * to name the one key it should let through: `allowPublishedSchemaKey` below
 * adds `$schema` (string, optional, never in `required`) to
 * `definitions.SceneData.properties` only, after generation, leaving the
 * other 34 definitions and `ViewerOptions` untouched.
 *
 * A SECOND post-generation step, for the same reason: the generator only knows
 * the TYPES, and in `types.ts` an entity id is a `string` — the UUID v7
 * grammar is a runtime rule (`UUID_V7_PATTERN`), which no TypeScript type can
 * spell. `annotateUuidFields` writes that pattern onto every field the Zod
 * twin judges with its `uuidSchema` (the table `UUID_FIELDS` below, by
 * definition and property), so the published schema and `sceneIssues` keep
 * refusing the same documents (`schema-check.test.ts`). The pattern is READ
 * from `types.ts`, never restated, and `schema-gen.test.ts` proves that every
 * definition with an `id` property is in the table.
 *
 * CLI: `bun scripts/schema-gen.ts --out <dir>` writes `scene.schema.json` and
 * `viewer-options.schema.json` into `<dir>`; `npm run build:lib` runs it into
 * `dist-lib/schema/` after the three Vite passes.
 */

import { createGenerator } from 'ts-json-schema-generator';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UUID_V7_PATTERN } from '../src/scene/types.js';
import { readPackageVersion } from './config-input.js';

/** JSON Schema draft this repository publishes. */
const SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Where the published schemas live: the player site serves every generated
 * schema at the URL its `$id` names (`scripts/site-build.ts`).
 */
export const SCHEMA_HOST = 'https://player.jeex.org/schema';

export type SchemaTarget = {
  /** File stem: `<name>.schema.json`, and the `$id`/`schemaId` segment. */
  readonly name: string;
  /** Source file the type is declared in, relative to the repo root. */
  readonly path: string;
  /** Exported type name to generate a schema for. */
  readonly type: string;
};

/** The scene document target. Named, not indexed off `SCHEMA_TARGETS`, so a caller never needs a non-null assertion to reach it. */
export const SCENE_SCHEMA_TARGET: SchemaTarget = { name: 'scene', path: 'src/scene/types.ts', type: 'SceneData' };
/** The mount-options target. */
export const VIEWER_OPTIONS_SCHEMA_TARGET: SchemaTarget = {
  name: 'viewer-options',
  path: 'src/app/viewer-options.ts',
  type: 'ViewerOptions',
};

/** The two documents a host validates against; order is the write order. */
export const SCHEMA_TARGETS: readonly SchemaTarget[] = [SCENE_SCHEMA_TARGET, VIEWER_OPTIONS_SCHEMA_TARGET];

function packageVersion(): string {
  return readPackageVersion(new URL('../package.json', import.meta.url));
}

/**
 * Generates one target's schema. `version` defaults to `package.json#version`
 * and is a parameter (not read inside) so `schema-gen.test.ts` can assert
 * against a fixed value without depending on whatever the package happens to
 * be at.
 */
export function generateSchema(target: SchemaTarget, version: string = packageVersion()): Record<string, unknown> {
  const generator = createGenerator({
    path: target.path,
    type: target.type,
    tsconfig: 'tsconfig.json',
    expose: 'export',
    jsDoc: 'extended',
    // Closed object types (no index signature) get `additionalProperties:
    // false`; a `Record<string, T>` field is unaffected — it already
    // generates its own `additionalProperties` schema.
    additionalProperties: false,
    schemaId: `${SCHEMA_HOST}/${target.name}/${version}.json`,
    // `ViewerOptions` reaches `ui/messages.ts` (its `Locale` type), whose
    // runtime body needs `dom.iterable`; `scene-repository.ts`'s ambient
    // `__JEEX_VIEWER_VERSION__` (`src/assets.d.ts`) is not pulled into the
    // program at all when the generator builds it from a single `path` rather
    // than the full `tsconfig` file list. Full program correctness is already
    // `bun run typecheck`'s job, running in the same gate; the generator only
    // needs the TYPE SHAPE, not a clean whole-program build (verified against
    // this repository's real sources — see the module header).
    skipTypeCheck: true,
  });
  const schema = generator.createSchema(target.type) as Record<string, unknown>;
  // `createSchema` emits draft-07's `$schema` unconditionally; `Config` has no
  // draft-selection field, so the repository's own draft is set here instead.
  schema['$schema'] = SCHEMA_DRAFT;
  if (target.name === SCENE_SCHEMA_TARGET.name && target.type === SCENE_SCHEMA_TARGET.type) {
    allowPublishedSchemaKey(schema, target.type);
    annotateUuidFields(schema);
  }
  return schema;
}

/**
 * Adds the one property the module header's `$schema` exception documents: `$schema` on
 * `definitions[typeName]` (the scene target's closed root object), typed as
 * an optional string. Never added to `required`, and called for the scene
 * target only — a sibling definition or `ViewerOptions` that also wants this
 * would need its own call, not a loosening of this one.
 */
function allowPublishedSchemaKey(schema: Record<string, unknown>, typeName: string): void {
  const definitions = schema['definitions'] as Record<string, { properties?: Record<string, unknown> }> | undefined;
  const properties = definitions?.[typeName]?.properties;
  if (!properties) {
    throw new Error(`schema-gen: expected definitions.${typeName}.properties to exist`);
  }
  properties['$schema'] = { type: 'string' };
}

/**
 * Where a scene document carries a UUID v7, by definition: `value` lists the
 * properties whose value is one (a nullable or optional one included), `keys`
 * the records whose KEYS are room UUIDs, `items` the tuples of UUIDs. Every
 * entity id and every reference to an entity of the document is here, and so
 * are a placement's `asset` and `library` and the document's `assetLibrary`
 * (schema 2.2: bare UUIDs); other catalogue references (finishes, variants)
 * are not — the validator resolves those against its registries
 * (`types.schema.ts`).
 */
export const UUID_FIELDS: Readonly<
  Record<string, { readonly value?: readonly string[]; readonly keys?: readonly string[]; readonly items?: readonly string[] }>
> = {
  SceneData: { value: ['id', 'assetLibrary'], keys: ['roomCameras'] },
  PlanNode: { value: ['id'] },
  Wall: { value: ['id', 'a', 'b'] },
  Opening: { value: ['id'] },
  Room: { value: ['id'] },
  MaterialDefinition: { value: ['id'] },
  DemoAsset: { value: ['id', 'asset', 'library', 'room'] },
  TourCheckpoint: { value: ['id'] },
  InteriorPreset: { value: ['id'] },
  SceneFinishes: { keys: ['rooms'] },
  FaceKey: { value: ['room', 'wallId'] },
  FaceFinish: { value: ['room', 'wallId'] },
  SetMaterialOp: { value: ['target'] },
  SetCameraTarget: { value: ['room'] },
  ReplaceAssetVariantOp: { value: ['assetId'] },
  ReplaceOpeningVariantOp: { value: ['openingId'] },
  SetOpeningOp: { value: ['openingId', 'wallId'] },
  AddOpeningOp: { value: ['id', 'wallId'] },
  RemoveOpeningOp: { value: ['openingId'] },
  AddRoomOp: { value: ['id'] },
  SetRoomOp: { value: ['roomId'] },
  RemoveRoomOp: { value: ['roomId'] },
  PlaceObjectOp: { value: ['id', 'asset', 'library', 'room'] },
  MoveObjectOp: { value: ['assetId', 'room'] },
  RotateObjectOp: { value: ['assetId'] },
  SetObjectOp: { value: ['assetId'] },
  RemoveObjectOp: { value: ['assetId'] },
  MirrorObjectOp: { value: ['assetId'] },
  AddNodeOp: { value: ['id'] },
  MoveNodeOp: { value: ['nodeId'] },
  RemoveNodeOp: { value: ['nodeId'] },
  AddWallOp: { value: ['id', 'a', 'b'] },
  SetWallOp: { value: ['wallId'] },
  RemoveWallOp: { value: ['wallId'] },
  SplitWallOp: { value: ['wallId', 'nodeId'], items: ['ids'] },
};

/** A JSON Schema node, loosely: the generator's output is plain JSON. */
type SchemaNode = { [key: string]: unknown };

/** True for a node that admits a free string: `type: "string"` (or a type list with it), not a `const`. */
function admitsString(node: SchemaNode): boolean {
  const type = node['type'];
  return node['const'] === undefined && (type === 'string' || (Array.isArray(type) && type.includes('string')));
}

/**
 * Puts the UUID pattern on the string branch of `node`: the node itself (a
 * `pattern` only ever judges strings, so `MoveObjectOp.room`'s
 * `["string", "null"]` keeps its `null`), or the string arm of an `anyOf`
 * (`SetMaterialOp.target` is an alias word, a room UUID or a face key).
 */
function patternOnString(node: SchemaNode, where: string): void {
  if (admitsString(node)) {
    node['pattern'] = UUID_V7_PATTERN.source;
    return;
  }
  const arms = node['anyOf'];
  const stringArms = Array.isArray(arms) ? (arms as SchemaNode[]).filter((arm) => admitsString(arm)) : [];
  if (stringArms.length !== 1) throw new Error(`schema-gen: expected exactly one plain string at ${where}`);
  stringArms[0]!['pattern'] = UUID_V7_PATTERN.source;
}

/** Writes the UUID v7 pattern onto every field `UUID_FIELDS` names; a field that is not there is a generator drift, and throws. */
function annotateUuidFields(schema: Record<string, unknown>): void {
  const definitions = schema['definitions'] as Record<string, SchemaNode>;
  for (const [name, fields] of Object.entries(UUID_FIELDS)) {
    const definition = definitions[name];
    if (definition === undefined) throw new Error(`schema-gen: expected definitions.${name}`);
    // `SetCameraTarget` is a union whose object arm holds `room`.
    const holders = Array.isArray(definition['anyOf'])
      ? (definition['anyOf'] as SchemaNode[]).filter((arm) => arm['properties'] !== undefined)
      : [definition];
    const property = (field: string): SchemaNode => {
      const found = holders.map((holder) => (holder['properties'] as Record<string, SchemaNode>)[field]).find((node) => node !== undefined);
      if (found === undefined) throw new Error(`schema-gen: expected definitions.${name}.properties.${field}`);
      return found;
    };
    for (const field of fields.value ?? []) patternOnString(property(field), `${name}.${field}`);
    for (const field of fields.keys ?? []) property(field)['propertyNames'] = { pattern: UUID_V7_PATTERN.source };
    for (const field of fields.items ?? []) patternOnString(property(field)['items'] as SchemaNode, `${name}.${field}[]`);
  }
}

/** Generates both schemas and writes them into `outDir` as `<name>.schema.json`. */
export function writeSchemas(outDir: string, version: string = packageVersion()): readonly string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const target of SCHEMA_TARGETS) {
    const schema = generateSchema(target, version);
    const path = join(outDir, `${target.name}.schema.json`);
    writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
    written.push(path);
  }
  return written;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (!outDir) {
    console.error('schema-gen: usage: bun scripts/schema-gen.ts --out <dir>');
    process.exit(1);
  }
  const written = writeSchemas(outDir);
  console.log(`schema-gen: wrote ${written.length} schema(s) to ${outDir}`);
}
