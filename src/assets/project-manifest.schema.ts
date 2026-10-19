/**
 * The gate a baked project passes before anything is downloaded from it:
 * `project-manifest.ts`'s types as a `zod/mini` schema.
 *
 * Invariant: this schema JUDGES and never TRANSFORMS. There is no
 * `.transform()`, `.default()` or `.catch()` in it, so `z.input` and
 * `z.output` coincide and `parseProjectManifest` hands back the very object it
 * was given (`parseProjectManifest(value) === value`, asserted with `toBe`) —
 * the hand-written types stay the public ones and a host compiling with
 * `exactOptionalPropertyTypes` needs no cast.
 *
 * Two things it is stricter about than a shape check has to be, both because a
 * bake is a FOLDER and a viewer will resolve every one of these strings
 * against its manifest's URL:
 *
 *  - every path is RELATIVE and stays inside the folder: no `..` segment, no
 *    leading `/`, no URL scheme (`https:`, `data:`, a Windows drive), no
 *    query or fragment. A bake that named `https://cdn…/sofa.glb` would turn
 *    one document into a permission to fetch from anywhere. The ONE exception
 *    is `preview` — on an object, on a variant and on a material — which may
 *    also be an absolute `http(s)` URL, because a catalogue service serves
 *    previews publicly and a live library hands out that address rather than
 *    a file in a folder it has not baked. A preview is put into an `<img>` and never fetched as data, so the
 *    exception widens a picture and not a download;
 *  - every object is STRICT: an unknown key is a refusal, which is what makes
 *    `objects[].builder` — a procedural generator id, the thing a bake exists
 *    to replace — impossible to smuggle in, and what stops a field a future
 *    format version means something by from being silently ignored by this
 *    one.
 *
 * Every id and every reference to one is a UUID v7, judged by the SAME
 * `isUuidV7` that judges every id of the scene (`scene/types.ts`): there is no
 * looser "any UUID" rule anywhere, so a v4 id minted elsewhere is refused here
 * exactly as it would be in a scene. Names stay names: slot names, glTF
 * material names and tags are words.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { schemaRefusal } from '../shared/schema-issues.js';
import type { SchemaIssue } from '../shared/schema-issues.js';
import { isUuidV7 } from '../scene/types.js';
import { ASSET_ANCHORS, KNEE_SIDES, VARIANT_ACCESS, isHttpUrl } from './asset-types.js';
import { PROJECT_FORMAT } from './project-manifest.js';
import type { BakedProjectManifest } from './project-manifest.js';

/**
 * A path a bake may name: relative to the manifest folder and inside it.
 *
 * Spelled as a function rather than one long negative-lookahead regex because
 * the rule is a list of separate refusals and each one reads as itself here:
 * the regex form of the same rule is unreviewable.
 */
function isRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  // A backslash, whitespace, a query or a fragment: none of them belong in a
  // file name a bake ships, and each is a way to make two readers disagree
  // about which file was meant. The control characters are tested by code
  // point rather than by a character class because a regex that matches one is
  // itself a lint failure (`no-control-regex`) and an inline disable is not an
  // option.
  if (/[\s\\?#]/.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  // Any URL scheme, `data:` and a Windows drive letter included.
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return false;
  if (value.startsWith('/')) return false;
  // Empty segments cover `//host/x`, `a//b` and a trailing slash.
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

const relativePathSchema = z
  .string()
  .check(z.refine(isRelativePath, 'must be a relative path inside the project folder: no "..", no leading "/", no URL scheme'));

/**
 * The one string of the format that may point OUTSIDE the folder: a picture.
 *
 * A bake writes `prev/<id>.webp` beside its models, and a live library handed
 * over by an editor host writes a catalogue service's public preview address
 * instead (e.g. `<origin>/previews/<publisher>/<asset>/<variant>/<version>.webp`)
 * — unsigned, immutable, CORS `*`, and the same picture for every host. Both forms are accepted here and nothing else is: a
 * `preview` is put into an `<img>`, so `javascript:` and `data:` are refused
 * for the same reason `relativePathSchema` refuses a scheme at all.
 *
 * Everything the viewer DRAWS from — the scene, the GLBs, the textures — stays
 * `relativePathSchema`, so widening this one field widens no fetch.
 *
 * Plain `http:` is admitted deliberately, for a catalogue service served from a
 * local origin during development (`http://127.0.0.1:<port>/…`). On an `https:` host
 * page such a picture is mixed content and the browser blocks it — which is
 * not a defect but the designed outcome: a picture is BEST-EFFORT everywhere
 * in this feature, and a load that fails degrades to the option's palette chip
 * (`ui/selection-panel.ts`) exactly as an absent one does.
 */
const previewSchema = z
  .string()
  .check(
    z.refine(
      (value: string) => isRelativePath(value) || isHttpUrl(value),
      'must be a relative path inside the project folder or an absolute http(s) URL',
    ),
  );

/** Any id of the format, or a reference to one: a lowercase canonical UUID v7. */
const uuidSchema = z.string().check(z.refine(isUuidV7, 'must be a UUID v7 (lowercase canonical)'));

/** `AssetDims`: metres, `[width, height, depth]`. */
const dimsSchema = z.tuple([z.number(), z.number(), z.number()]);

/** `AssetOptions`: the configuration bag a variant hands to whatever builds it. */
const optionsSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

/**
 * A finish slot NAME (`SlotName`, `assets/asset-types.ts`): an identifier, not
 * a closed set. The shipped builders know the `FinishSlot` names; a baked
 * asset names its parts freely (`shell`, `base`, `fittings`) and refusing them
 * failed the whole project mount. Letters, digits, `_` and `-`, starting with
 * a letter or digit, at most 64 characters.
 */
const SLOT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const slotNameSchema = z.string().check(z.regex(SLOT_NAME, 'must be a slot name: letters, digits, "_" or "-", at most 64'));

/** `slot -> finish UUID` over open slot names. */
const slotFinishesSchema = z.record(slotNameSchema, uuidSchema);

/** `FinishApply`: the surface families a material may dress. */
const finishApplySchema = z.enum(['floor', 'wall', 'furniture', 'fabric', 'metal', 'glass', 'decor']);

/** `FinishGenerator`: the five parametric textures a material may be drawn by. */
const finishGeneratorSchema = z.union([
  z.strictObject({
    kind: z.literal('wood_grain'),
    tone: z.string(),
    seed: z.number(),
    lines: z.optional(z.number()),
    variation: z.optional(z.number()),
  }),
  z.strictObject({ kind: z.literal('plank_floor'), tone: z.string(), seed: z.number() }),
  z.strictObject({
    kind: z.literal('fabric_weave'),
    tone: z.string(),
    seed: z.number(),
    threads: z.optional(z.number()),
    variance: z.optional(z.number()),
  }),
  z.strictObject({ kind: z.literal('painted_plaster'), tone: z.string(), seed: z.number() }),
  z.strictObject({
    kind: z.literal('tile_grid'),
    tone: z.string(),
    grout: z.string(),
    seed: z.number(),
    grid: z.optional(z.number()),
    style: z.optional(z.enum(['ceramic', 'stone'])),
  }),
]);

/** `AssetPricing`: pricing metadata a catalogue supplied for a variant; carried, never interpreted. */
const pricingSchema = z.strictObject({
  model: z.enum(['free', 'subscription', 'premium']),
  tier: z.optional(z.enum(['standard', 'pro'])),
  buyout: z.optional(z.strictObject({ amount: z.number(), currency: z.string() })),
});

/** `AssetLayout`: what the layout linter must know about an archetype. */
const layoutSchema = z.strictObject({
  caseGood: z.optional(z.boolean()),
  kitchenBase: z.optional(z.boolean()),
  blockingHeight: z.optional(z.number()),
  footprint: z.optional(z.number()),
  mount: z.optional(z.strictObject({ centre: z.optional(z.number()), bottom: z.optional(z.number()) })),
});

/** Surfaces and tucking: optional, absent means not allowed. */
const surfaceFactsShape = {
  onSurface: z.optional(z.literal(true)),
  top: z.optional(z.strictObject({ y: z.number() })),
  kneeSpace: z.optional(z.strictObject({ height: z.number(), sides: z.array(z.enum(KNEE_SIDES)), depth: z.optional(z.number()) })),
  tuck: z.optional(z.strictObject({ depth: z.number(), height: z.number() })),
};

/** `ProjectVariant`: a catalogue variant, plus the GLB and the preview a bake gives it. */
const variantSchema = z.strictObject({
  id: uuidSchema,
  name: z.string(),
  version: z.string(),
  tags: z.optional(z.array(z.string())),
  dims: z.optional(dimsSchema),
  finishes: z.optional(slotFinishesSchema),
  options: z.optional(optionsSchema),
  pricing: pricingSchema,
  model: z.optional(relativePathSchema),
  preview: z.optional(previewSchema),
  access: z.optional(z.enum(VARIANT_ACCESS)),
  allowed: z.optional(z.boolean()),
});

/** `ProjectObject`: an archetype of the bake. `model` is required; `builder` is not a field a bake has. */
const objectSchema = z.strictObject({
  id: uuidSchema,
  name: z.string(),
  category: z.string(),
  dims: dimsSchema,
  anchor: z.enum(ASSET_ANCHORS),
  wallSnap: z.boolean(),
  clearance: z.number(),
  tags: z.array(z.string()),
  model: relativePathSchema,
  materialSlots: z.optional(z.record(z.string(), z.string())),
  lods: z.optional(z.array(relativePathSchema)),
  preview: z.optional(previewSchema),
  options: z.optional(optionsSchema),
  slots: z.array(slotNameSchema),
  defaultFinishes: slotFinishesSchema,
  primarySlot: slotNameSchema,
  variants: z.array(variantSchema),
  defaultVariant: uuidSchema,
  layout: z.optional(layoutSchema),
  mirror: z.optional(z.strictObject({ x: z.boolean(), y: z.boolean(), z: z.boolean() })),
  ...surfaceFactsShape,
});

/** What every material carries, whichever way it is drawn. */
const materialBase = {
  id: uuidSchema,
  name: z.string(),
  tags: z.optional(z.array(z.string())),
  apply: z.array(finishApplySchema),
  preview: z.optional(previewSchema),
};

/**
 * `ProjectMaterial`: baked PBR maps or a parametric generator.
 *
 * A `pbr` material is ACCEPTED here although the current loader draws it as a
 * flat colour and warns `pbr-textures-deferred`: the format is judged whole, so a
 * bake that a later viewer will draw in full is never refused by an earlier
 * one for carrying the maps.
 */
const materialSchema = z.union([
  z.strictObject({
    ...materialBase,
    pbr: z.strictObject({
      albedo: relativePathSchema,
      normal: z.optional(relativePathSchema),
      roughness: z.number(),
      metalness: z.optional(z.number()),
      tile: z.tuple([z.number(), z.number()]),
    }),
  }),
  z.strictObject({ ...materialBase, generator: finishGeneratorSchema, tile: z.optional(z.number()) }),
]);

/** `ProjectLibraryManifest`: the library-manifest shape with no `baseUrl` — the manifest folder is the base. */
const librarySchema = z.strictObject({
  manifestVersion: z.literal('1.0'),
  id: uuidSchema,
  name: z.optional(z.string()),
  publisher: uuidSchema,
  license: z.string(),
  objects: z.array(objectSchema),
  materials: z.array(materialSchema),
});

/** `ProjectMedia`: a render the producer made. The viewer lists it for the host and plays nothing. */
const mediaSchema = z.strictObject({
  kind: z.enum(['video', 'still', 'panorama']),
  preset: z.string(),
  file: relativePathSchema,
  width: z.number(),
  height: z.number(),
  durationMs: z.optional(z.number()),
  poster: z.optional(relativePathSchema),
});

/** `ProjectRights`: recorded for humans and for the producer; the viewer reads nothing of it. */
const rightsSchema = z.strictObject({
  workspaceId: uuidSchema,
  perpetual: z.literal(true),
  assets: z.array(z.strictObject({ assetId: uuidSchema, variantId: uuidSchema, version: z.string(), access: z.enum(VARIANT_ACCESS) })),
});

/**
 * The one format version this build reads: an id is not something a reader
 * may guess a UUID for, so any other version is refused, not converted.
 */
const FORMAT_VERSION_MESSAGE = 'expected 2 (every id a UUID v7)';

/**
 * A whole baked project manifest.
 *
 * `formatVersion` is the literal `2`, and every id in it is a UUID: turning a
 * readable word into a UUID is minting, which the viewer never does. Any other
 * version, older or from the future, is refused by the same literal with a
 * message that names the accepted one, rather than half-read.
 *
 * `library.id` must be `projectId`: the library IS the project's, and a
 * placement names it as `<projectId>:<assetId>`. A manifest whose two
 * disagree would validate its scene against one id and file it under another.
 */
export const projectManifestSchema = z
  .strictObject({
    format: z.literal(PROJECT_FORMAT),
    formatVersion: z.literal(2, FORMAT_VERSION_MESSAGE),
    projectId: uuidSchema,
    bakeId: uuidSchema,
    bakedAt: z.string(),
    title: z.optional(z.string()),
    scene: relativePathSchema,
    library: librarySchema,
    media: z.optional(z.array(mediaSchema)),
    rights: rightsSchema,
    generator: z.strictObject({ name: z.string(), version: z.string() }),
    // `BakedProjectManifest.mark`: an `<a href>`, so http(s) only, never
    // `javascript:` or `data:` (the same reasoning as `previewSchema`).
    mark: z.optional(
      z.strictObject({ href: z.string().check(z.refine((value: string) => isHttpUrl(value), 'must be an absolute http(s) URL')) }),
    ),
  })
  .check(
    z.refine((manifest) => manifest.library.id === manifest.projectId, {
      error: 'must equal projectId: the library of a bake is its project',
      path: ['library', 'id'],
    }),
  );

/** A schema's own path step in this project's vocabulary (`scene/types.schema.ts`'s own `pathStep` twin). */
function pathStep(step: PropertyKey): string | number {
  return typeof step === 'symbol' ? step.toString() : step;
}

/** Every issue that keeps `value` from being a baked project manifest; empty means it is one. */
export function projectManifestIssues(value: unknown): readonly SchemaIssue[] {
  const result = z.safeParse(projectManifestSchema, value);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.map(pathStep),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * A manifest, judged and returned as it came.
 *
 * @throws ViewerLibError `project-invalid` when the value is not a manifest
 * this viewer can open, with the first bad field on `path` and the capped list
 * on `detail.issues` — the same refusal shape `parseSceneDocument` raises, so
 * a host has one error table whichever of the two documents said no.
 */
export function parseProjectManifest(value: unknown): BakedProjectManifest {
  const issues = projectManifestIssues(value);
  if (issues.length > 0) throw schemaRefusal('project-invalid', 'parseProjectManifest', issues);
  return value as BakedProjectManifest;
}
