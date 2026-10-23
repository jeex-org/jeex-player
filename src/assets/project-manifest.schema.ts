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
 * A material is `pbr`, `generator` or `library`. The `library` member is a
 * catalogue's scanned texture set or parameter-only material: strict at every
 * depth, with its cross-field rules (colour map by colour mode, `arm` or
 * `roughness`, colour space by role, one size set per material, the exact
 * `tex/<versionId>/<role>.<px>.<webp|ktx2>` path of every file, one format per material) checked on the
 * member and two manifest-wide ones (no texture path twice, at most
 * `MAX_PROJECT_TEXTURE_FILES` listed) on the root. Like the rest, they judge:
 * the defaults the format names (metalness 0, roughness 1, alpha `opaque`,
 * normal strength 1) are the renderer's to apply, never written in here.
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
import { HEX_COLOUR_PATTERN, isUuidV7 } from '../scene/types.js';
import { MAX_PROJECT_TEXTURE_FILES } from '../shared/limits.js';
import type { LibraryMapRole } from '../materials/finish-types.js';
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
const finishApplySchema = z.enum(['floor', 'wall', 'ceiling', 'facade', 'trim', 'furniture', 'fabric', 'metal', 'glass', 'decor']);

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

/* ---------------------------------------------------- library materials --- */

/** A `#rrggbb` colour, the scene schema's own grammar (`HEX_COLOUR_PATTERN`). */
const hexSchema = z.string().check(z.regex(HEX_COLOUR_PATTERN, 'must be a #rrggbb colour'));

/** A fraction: roughness, metalness, opacity and the physical weights. */
const unitSchema = z.number().check(z.gte(0), z.lte(1));

/** A distance or an intensity: zero or more. */
const nonNegativeSchema = z.number().check(z.gte(0));

/** A strictly positive number: a tile edge, a normal strength. */
const positiveSchema = z.number().check(z.gt(0));

/** `LibraryPbr`: glTF's PBR facts, every one optional, with the ranges glTF gives them. */
const libraryPbrSchema = z.strictObject({
  baseColour: z.optional(hexSchema),
  roughness: z.optional(unitSchema),
  metalness: z.optional(unitSchema),
  alphaMode: z.optional(z.enum(['opaque', 'blend', 'mask'])),
  opacity: z.optional(unitSchema),
  sheen: z.optional(unitSchema),
  sheenColour: z.optional(hexSchema),
  clearcoat: z.optional(unitSchema),
  clearcoatRoughness: z.optional(unitSchema),
  transmission: z.optional(unitSchema),
  // 2.333 is diamond's index, the top of what glTF's `KHR_materials_ior` means.
  ior: z.optional(z.number().check(z.gte(1), z.lte(2.333))),
  thicknessM: z.optional(nonNegativeSchema),
  attenuationDistanceM: z.optional(nonNegativeSchema),
  attenuationColour: z.optional(hexSchema),
  emissive: z.optional(hexSchema),
  emissiveIntensity: z.optional(nonNegativeSchema),
});

/** `LibraryFacts`. The cross-field rules (tint by colour mode, `tileM` by kind) are `checkLibraryMaterial`'s. */
const libraryFactsSchema = z.strictObject({
  tileM: z.nullable(z.tuple([positiveSchema, positiveSchema])),
  grain: z.enum(['along_u', 'along_v', 'none', 'unknown']),
  suitability: z.enum(['plank_floor', 'board', 'continuous']),
  normalStrength: z.optional(positiveSchema),
  colourMode: z.enum(['natural', 'tintable']),
  tint: z.optional(
    z.strictObject({
      recipe: z.literal('luma-mid@1'),
      suggestedColours: z.array(z.strictObject({ name: z.string(), hex: hexSchema })).check(z.minLength(1)),
    }),
  ),
  averageColour: hexSchema,
  pbr: libraryPbrSchema,
});

/** The sizes a map may be listed at, smallest first: the keys of `LibraryMap.files`. */
const LIBRARY_MAP_SIZES = ['128', '256', '384', '512', '768'] as const;

/** `LibraryMap`. `files` is strict over the five sizes, so a `1024` file is an unknown key. */
const libraryMapSchema = z.strictObject({
  colourSpace: z.enum(['srgb', 'linear']),
  convention: z.optional(z.literal('opengl')),
  files: z.strictObject(
    Object.fromEntries(LIBRARY_MAP_SIZES.map((size) => [size, z.optional(z.string())])) as Record<
      (typeof LIBRARY_MAP_SIZES)[number],
      z.ZodMiniOptional<z.ZodMiniString>
    >,
  ),
});

/** The map roles, in the order the rules below report them. */
const LIBRARY_MAP_ROLES = ['albedo', 'albedoTint', 'normal', 'roughness', 'ao', 'arm'] as const satisfies readonly LibraryMapRole[];

/** The two roles whose maps hold colour (sRGB); every other role holds data (linear). */
const COLOUR_ROLES: ReadonlySet<LibraryMapRole> = new Set(['albedo', 'albedoTint']);

/** `LibraryMaterial` without its cross-field rules. */
const libraryMaterialSchema = z.strictObject({
  versionId: uuidSchema,
  kind: z.enum(['scan', 'parameters']),
  facts: libraryFactsSchema,
  maps: z.strictObject(
    Object.fromEntries(LIBRARY_MAP_ROLES.map((role) => [role, z.optional(libraryMapSchema)])) as Record<
      LibraryMapRole,
      z.ZodMiniOptional<typeof libraryMapSchema>
    >,
  ),
});

/** A library material as the schema infers it: what the rules below read. */
type LibraryShape = z.infer<typeof libraryMaterialSchema>;

/** One listed map of a library material. */
type LibraryMapShape = z.infer<typeof libraryMapSchema>;

/** The two image formats a library map may be shipped in. */
const LIBRARY_MAP_EXTENSIONS = ['webp', 'ktx2'] as const;
type LibraryMapExtension = (typeof LIBRARY_MAP_EXTENSIONS)[number];

/** The one file name a map of `role` at `size` may have: `tex/<versionId>/<role>.<px>.<ext>`. */
function libraryMapPath(versionId: string, role: LibraryMapRole, size: string, extension: LibraryMapExtension): string {
  return `tex/${versionId}/${role}.${size}.${extension}`;
}

/**
 * The format of a material: the extension of its first listed file when that
 * is one of the two, else WebP. Every other file must use the same, so one
 * texture transform serves every map of the material.
 */
function libraryMapExtension(listed: readonly [LibraryMapRole, LibraryMapShape][]): LibraryMapExtension {
  const first = listed.flatMap(([, map]) =>
    LIBRARY_MAP_SIZES.flatMap((size) => (map.files[size] === undefined ? [] : [map.files[size]])),
  )[0];
  const extension = first?.slice(first.lastIndexOf('.') + 1);
  return LIBRARY_MAP_EXTENSIONS.find((candidate) => candidate === extension) ?? 'webp';
}

/** The listed maps of a library material, role and map, in `LIBRARY_MAP_ROLES` order. */
function listedMaps(library: LibraryShape): [LibraryMapRole, LibraryMapShape][] {
  return LIBRARY_MAP_ROLES.flatMap((role): [LibraryMapRole, LibraryMapShape][] => {
    const map = library.maps[role];
    return map === undefined ? [] : [[role, map]];
  });
}

/**
 * The cross-field rules of a library material: each one an issue of its own,
 * at the field it is about, under the member's `library` key.
 *
 * Judged here rather than in the shape because every one of them reads two
 * fields at once; nothing is filled in or corrected, so a manifest that passes
 * is the manifest that was given.
 */
function checkLibraryMaterial(library: LibraryShape, issue: (message: string, path: readonly (string | number)[]) => void): void {
  const { facts, maps } = library;
  if ((facts.tint !== undefined) !== (facts.colourMode === 'tintable')) {
    issue('must be present exactly when colourMode is tintable', ['facts', 'tint']);
  }
  const listed = listedMaps(library);
  if (library.kind === 'parameters') {
    if (listed.length > 0) issue('must be {} for a parameters material', ['maps']);
    if (facts.tileM !== null) issue('must be null for a parameters material', ['facts', 'tileM']);
    if (facts.pbr.baseColour === undefined) issue('is required for a parameters material', ['facts', 'pbr', 'baseColour']);
    else if (facts.averageColour.toLowerCase() !== facts.pbr.baseColour.toLowerCase()) {
      issue('must equal pbr.baseColour for a parameters material', ['facts', 'averageColour']);
    }
    return;
  }
  if (facts.tileM === null) issue('must be [u, v] metres for a scan', ['facts', 'tileM']);
  const colourRole = facts.colourMode === 'tintable' ? 'albedoTint' : 'albedo';
  const otherRole = colourRole === 'albedo' ? 'albedoTint' : 'albedo';
  if (maps[colourRole] === undefined) issue(`a ${facts.colourMode} scan must ship ${colourRole}`, ['maps', colourRole]);
  if (maps[otherRole] !== undefined) issue(`a ${facts.colourMode} scan must not ship ${otherRole}`, ['maps', otherRole]);
  if (maps.arm !== undefined && maps.roughness !== undefined) issue('must not ship beside arm', ['maps', 'roughness']);
  if (maps.arm !== undefined && maps.ao !== undefined) issue('must not ship beside arm', ['maps', 'ao']);
  if (maps.ao !== undefined && maps.roughness === undefined && maps.arm === undefined) issue('ships only beside roughness', ['maps', 'ao']);
  let sizeSet: string | undefined;
  const extension = libraryMapExtension(listed);
  for (const [role, map] of listed) {
    const space = COLOUR_ROLES.has(role) ? 'srgb' : 'linear';
    if (map.colourSpace !== space) issue(`must be ${space} for ${role}`, ['maps', role, 'colourSpace']);
    if (map.convention !== undefined && role !== 'normal') issue('is allowed only on normal', ['maps', role, 'convention']);
    const sizes = LIBRARY_MAP_SIZES.filter((size) => map.files[size] !== undefined);
    if (sizes.length === 0) issue('must list at least one size', ['maps', role, 'files']);
    for (const size of sizes) {
      const expected = libraryMapPath(library.versionId, role, size, extension);
      if (map.files[size] !== expected) issue(`must be ${expected}`, ['maps', role, 'files', size]);
    }
    const set = sizes.join(',');
    if (sizeSet === undefined) sizeSet = set;
    else if (set !== sizeSet) issue('must list the same sizes as every other map of the material', ['maps', role, 'files']);
  }
}

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
  z
    .strictObject({ ...materialBase, library: libraryMaterialSchema })
    .check(
      z.superRefine((material, ctx) =>
        checkLibraryMaterial(material.library, (message, path) => ctx.addIssue({ code: 'custom', message, path: ['library', ...path] })),
      ),
    ),
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
 * `library.id` must be `projectId`: the library IS the project's, and the scene
 * names it as `assetLibrary` (a placement as `library`), next to the bare
 * `asset` UUID. A manifest whose two
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
    z.superRefine((manifest, ctx) =>
      checkTextureFiles(manifest.library.materials, (message, path) => ctx.addIssue({ code: 'custom', message, path: [...path] })),
    ),
  );

/**
 * The manifest-wide texture rules: no file path listed twice (refused at its
 * second occurrence), and at most `MAX_PROJECT_TEXTURE_FILES` files listed in
 * all, every role and size counted, the ones a viewer never draws included.
 */
function checkTextureFiles(
  materials: readonly z.infer<typeof materialSchema>[],
  issue: (message: string, path: readonly (string | number)[]) => void,
): void {
  const seen = new Set<string>();
  let count = 0;
  for (const [index, material] of materials.entries()) {
    if (!('library' in material)) continue;
    for (const [role, map] of listedMaps(material.library)) {
      for (const size of LIBRARY_MAP_SIZES) {
        const path = map.files[size];
        if (path === undefined) continue;
        count += 1;
        if (seen.has(path))
          issue('is listed twice in the manifest', ['library', 'materials', index, 'library', 'maps', role, 'files', size]);
        seen.add(path);
      }
    }
  }
  if (count > MAX_PROJECT_TEXTURE_FILES) {
    issue(`lists ${count} texture files; at most MAX_PROJECT_TEXTURE_FILES (${MAX_PROJECT_TEXTURE_FILES}) are allowed`, [
      'library',
      'materials',
    ]);
  }
}

/** A schema's own path step in this project's vocabulary (`scene/types.schema.ts`'s own `pathStep` twin). */
function pathStep(step: PropertyKey): string | number {
  return typeof step === 'symbol' ? step.toString() : step;
}

/** One issue as `zod` raises it. */
type ZodIssue = z.core.$ZodIssue;

/**
 * The member of a refused union the value was meant to be: the one option
 * whose shallowest issue lies deepest. A material that names `library` fails
 * the `pbr` and `generator` members at their own top level (an unknown key, a
 * missing member key) and the `library` member only inside it, so that member
 * is the one worth reporting. A tie means the value matches no member better
 * than another, and the union issue itself stands.
 */
function closestOption(options: readonly (readonly ZodIssue[])[]): readonly ZodIssue[] | undefined {
  const depths = options.map((issues) => Math.min(...issues.map((issue) => issue.path.length)));
  const deepest = Math.max(...depths);
  return depths.filter((depth) => depth === deepest).length === 1 ? options[depths.indexOf(deepest)] : undefined;
}

/**
 * `issue` in this project's vocabulary, under `prefix`: a refused union is
 * opened to the member the value was meant to be, and an unknown key is named
 * in the message (its path is the object that carries it).
 */
function readableIssues(issue: ZodIssue, prefix: readonly PropertyKey[]): SchemaIssue[] {
  const path = [...prefix, ...issue.path];
  if (issue.code === 'invalid_union' && issue.errors.length > 0) {
    const chosen = closestOption(issue.errors);
    if (chosen !== undefined) return chosen.flatMap((inner) => readableIssues(inner, path));
  }
  const message =
    issue.code === 'unrecognized_keys'
      ? `unknown key${issue.keys.length === 1 ? '' : 's'} ${issue.keys.map((key) => JSON.stringify(key)).join(', ')}`
      : issue.message;
  return [{ path: path.map((step) => pathStep(step)), message, code: issue.code }];
}

/** Every issue that keeps `value` from being a baked project manifest; empty means it is one. */
export function projectManifestIssues(value: unknown): readonly SchemaIssue[] {
  const result = z.safeParse(projectManifestSchema, value);
  if (result.success) return [];
  return result.error.issues.flatMap((issue) => readableIssues(issue, []));
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
