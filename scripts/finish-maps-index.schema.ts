/**
 * `finish-maps/index.json`: the list of the bundled room finishes' library
 * materials and of every map file shipped for them.
 *
 * `finishes[]` binds each bundled floor and wall finish (by its catalogue id)
 * to a library variant and the version pinned for it, or marks it `kept`: no
 * library material is chosen yet and the finish keeps its generated look.
 * An alias entry names the finish a retired id reads as (`alias`); it has no
 * version and no files. `defaults.ceiling` does the same as a bound or kept
 * entry for the ceiling every room wears when it
 * names none. `versions[]` holds each pinned version once: its facts, the
 * maps by role, and for every file its logical path, byte size and SHA-256.
 * Ids are opaque UUIDs given by the library; nothing here is minted.
 *
 * Read by the authoring script and the repository's tests, never by the
 * viewer at run time.
 */

import { z } from 'zod/mini';

const uuid = z.string().check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'must be a UUID v7'));
const hex = z.string().check(z.regex(/^#[0-9a-f]{6}$/, 'must be a lowercase #rrggbb colour'));
const unit = z.number().check(z.gte(0), z.lte(1));
const positive = z.number().check(z.gt(0));

/** The sizes this folder ships, as the keys of a map's `files`. */
export const SHIPPED_SIZES = ['256', '512', '768'] as const;

/** The roles a shipped scan may list, in the store's projection order. */
export const SHIPPED_ROLES = ['albedo', 'albedoTint', 'normal', 'arm'] as const;

const pbr = z.strictObject({
  baseColour: z.optional(hex),
  roughness: z.optional(unit),
  metalness: z.optional(unit),
  sheen: z.optional(unit),
  sheenColour: z.optional(hex),
  clearcoat: z.optional(unit),
  clearcoatRoughness: z.optional(unit),
  emissive: z.optional(hex),
  emissiveIntensity: z.optional(z.number().check(z.gte(0))),
});

const facts = z.strictObject({
  tileM: z.nullable(z.tuple([positive, positive])),
  grain: z.enum(['along_u', 'along_v', 'none', 'unknown']),
  suitability: z.enum(['plank_floor', 'board', 'continuous']),
  normalStrength: z.optional(positive),
  colourMode: z.enum(['natural', 'tintable']),
  tint: z.optional(
    z.strictObject({
      recipe: z.literal('luma-mid@1'),
      suggestedColours: z.array(z.strictObject({ name: z.string(), hex })).check(z.minLength(1)),
    }),
  ),
  averageColour: hex,
  pbr,
});

const file = z.strictObject({
  path: z.string().check(z.regex(/^tex\/[0-9a-f-]{36}\/[A-Za-z]+\.(256|512|768)\.webp$/, 'must be tex/<version>/<role>.<px>.webp')),
  bytes: z.number().check(z.int(), z.gt(0)),
  sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/, 'must be a lowercase SHA-256')),
});

const map = z.strictObject({
  colourSpace: z.enum(['srgb', 'linear']),
  convention: z.optional(z.literal('opengl')),
  files: z.strictObject({ '256': file, '512': file, '768': file }),
});

const source = z.strictObject({
  provider: z.string().check(z.minLength(1)),
  sourceName: z.string().check(z.minLength(1)),
  sourcePage: z.string().check(z.regex(/^https:\/\//, 'must be an https URL')),
  licence: z.string().check(z.minLength(1)),
});

const version = z
  .strictObject({
    version: uuid,
    variant: uuid,
    name: z.string().check(z.minLength(1)),
    kind: z.enum(['scan', 'parameters']),
    facts,
    maps: z.strictObject({
      albedo: z.optional(map),
      albedoTint: z.optional(map),
      normal: z.optional(map),
      arm: z.optional(map),
    }),
    // A scan credits the files it was made from; a parameters material has no
    // file to credit, so it records no source (its library page is not public).
    source: z.optional(source),
  })
  .check(
    z.refine(
      (entry) => (entry.source !== undefined) === (entry.kind === 'scan'),
      'a scan records its source and a parameters material none',
    ),
  );

const bound = z.strictObject({
  finish: uuid,
  slug: z.string(),
  name: z.optional(z.string().check(z.minLength(1))),
  variant: uuid,
  version: uuid,
  colour: z.optional(hex),
  rotation: z.optional(z.number()),
});

const kept = z.strictObject({ finish: uuid, slug: z.string(), kept: z.literal(true), why: z.enum(['keep', 'pending']) });

/** A retired finish that reads as another bundled finish: it carries no material of its own. */
const alias = z.strictObject({ finish: uuid, slug: z.string(), alias: uuid });

const entry = z.union([bound, kept, alias]);

export const finishMapsIndexSchema = z.strictObject({
  format: z.literal(1),
  finishes: z.array(entry),
  defaults: z.strictObject({ ceiling: z.union([bound, kept]) }),
  versions: z.array(version),
});

export type FinishMapsIndex = z.infer<typeof finishMapsIndexSchema>;
export type FinishMapsVersion = FinishMapsIndex['versions'][number];
export type FinishMapsEntry = z.infer<typeof entry>;
export type FinishMapsCeiling = FinishMapsIndex['defaults']['ceiling'];

/**
 * The library's room-finish mapping, the script's input: one row per bundled
 * finish with its library variant (`material`) and the pinned version's facts
 * as the store projects them for a manifest, or `keep` / `pending` when no
 * material is chosen yet, or `alias` naming the finish a retired id reads as.
 * Only the fields the script reads are judged; the
 * rest (reasons, pending notes) passes through.
 */
const mappingFacts = z.looseObject({
  version: uuid,
  name: z.string().check(z.minLength(1)),
  tileM: z.nullable(z.tuple([positive, positive])),
  grain: z.enum(['along_u', 'along_v', 'none', 'unknown']),
  suitability: z.enum(['plank_floor', 'board', 'continuous']),
  normalStrength: z.optional(z.number().check(z.gte(0))),
  colourMode: z.enum(['natural', 'tintable']),
  tint: z.optional(
    z.strictObject({
      recipe: z.literal('luma-mid@1'),
      suggestedColours: z.array(z.strictObject({ name: z.string(), hex })).check(z.minLength(1)),
    }),
  ),
  averageColour: hex,
  pbr,
  maps: z.array(z.string()),
  source,
});

const mappingRow = z.union([
  z.looseObject({
    finish: uuid,
    slug: z.string(),
    name: z.optional(z.string().check(z.minLength(1))),
    material: uuid,
    colour: z.optional(hex),
    rotation: z.optional(z.number()),
    facts: mappingFacts,
  }),
  z.looseObject({ finish: uuid, slug: z.string(), keep: z.literal(true) }),
  z.looseObject({ finish: uuid, slug: z.string(), pending: z.looseObject({}) }),
  z.looseObject({ finish: uuid, slug: z.string(), alias: uuid }),
]);

/** The fields that say what a mapping row is; a row names exactly one of them. */
export const MAPPING_ROW_MODES = ['material', 'keep', 'pending', 'alias'] as const;

export const finishMappingSchema = z.looseObject({
  version: z.literal(1),
  rows: z.array(mappingRow),
  playerDefaults: z.array(z.looseObject({ surface: z.literal('ceiling') }).check(z.refine((row) => mappingRow.safeParse(row).success))),
});

export type FinishMapping = z.infer<typeof finishMappingSchema>;
export type FinishMappingRow = z.infer<typeof mappingRow>;
export { mappingRow as finishMappingRowSchema };
