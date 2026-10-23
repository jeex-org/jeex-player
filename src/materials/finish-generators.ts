/**
 * The ONE registry of parametric finish generators, and the material a baked
 * project's `materials[]` entry becomes.
 *
 * The baked-project format: a project ships its finishes as DATA — either
 * baked PBR maps or a named generator with parameters — while the generator code stays in the
 * viewer as an open set of deterministic functions. There were two such sets:
 * the room-surface kinds (`planks`, `chevron`, `terrazzo`, `tiles`,
 * `plaster`, `stripes`) dispatched inside `finishes.ts`, and the object kinds
 * (`wood_grain`, `plank_floor`, `fabric_weave`, `painted_plaster`,
 * `tile_grid`) dispatched by a `switch` inside `assets/asset-finishes.ts`.
 * Two tables meant a project material could be drawn by one and not the
 * other, and three of the eleven kinds were the same texture under two names.
 * This is the single table: eleven keys over eight entries, the aliases
 * SHARING an entry rather than repeating it.
 *
 * Invariant: a kind this build does not know is never an error. `generatorFor`
 * answers `undefined` and `materialFromProject` falls back to a flat colour
 * plus one `unknown-generator:<kind>` warning, because a project authored
 * against a newer viewer must still draw.
 *
 * DOM: only through `materials/canvas-2d.ts`, whose null policy is the carve-
 * out that lets this module run under Bun — with no document every generator
 * answers `null` and every material keeps its flat colour.
 */

import * as THREE from 'three';
import { defaultLogger, type Logger } from '../shared/logger.js';
import { FALLBACK_FINISH_COLOUR, PROJECT_GENERATOR_ROUGHNESS, type FinishKind } from './finish-catalogue.js';
import type { FinishGenerator, ProjectMaterial } from './finish-types.js';
import {
  chevronTexture,
  fabricBumpTexture,
  fabricTexture,
  plasterTexture,
  planksBumpTexture,
  planksTexture,
  stripesTexture,
  terrazzoTexture,
  tilesBumpTexture,
  tilesTexture,
  woodGrainBumpTexture,
  woodGrainTexture,
} from './textures.js';

/** Grout/joint colour a `tiles` row or a `tile_grid` generator can leave unset. */
const TILE_DEFAULT_ACCENT = '#8f877b';
/** Second stripe colour a `stripes` row can leave unset. */
const STRIPE_DEFAULT_ACCENT = '#d9cbae';
/** Pattern seed a caller that names none draws with; every generator is deterministic in it. */
const DEFAULT_SEED = 1;

/**
 * Every parameter any generator reads, in ONE shape.
 *
 * The two families named the same things differently — a room finish's `base`
 * and `accent` are an object generator's `tone` and `grout` — so the registry
 * would otherwise need one signature per family, which is the second table
 * again. The union of the fields is small (nine, five of them used by one kind
 * each) and every entry reads only what it needs.
 */
export type GeneratorParams = {
  /** Main colour: a room finish's `base`, an object generator's `tone`. */
  readonly tone: string;
  /** Second colour: a room finish's `accent`, a `tile_grid`'s `grout`. */
  readonly accent?: string | undefined;
  readonly seed?: number | undefined;
  /** Tiles, or stripe periods, per texture repeat. */
  readonly grid?: number | undefined;
  readonly style?: 'ceramic' | 'stone' | undefined;
  /** `wood_grain`: grain lines across the texture, and how much they wander. */
  readonly lines?: number | undefined;
  readonly variation?: number | undefined;
  /** `fabric_weave`: threads across the texture, and how much their tone varies. */
  readonly threads?: number | undefined;
  readonly variance?: number | undefined;
};

/** How one generator kind draws: colour always, height detail where the kind has any. */
export type GeneratorEntry = {
  colour(params: GeneratorParams): THREE.Texture | null;
  bump?(params: GeneratorParams): THREE.Texture | null;
  /** Accent colour this kind falls back to when the caller names none. */
  readonly defaultAccent?: string;
};

/** Every generator kind this build can draw: the room-surface family and the object family. */
export type FinishGeneratorKind = FinishKind | FinishGenerator['kind'];

const planks: GeneratorEntry = {
  colour: (params) => planksTexture(params.tone, params.seed ?? DEFAULT_SEED),
  bump: (params) => planksBumpTexture(params.tone, params.seed ?? DEFAULT_SEED),
};

const plaster: GeneratorEntry = {
  colour: (params) => plasterTexture(params.tone, params.seed ?? DEFAULT_SEED),
};

const tiles: GeneratorEntry = {
  colour: (params) =>
    tilesTexture(params.tone, params.accent ?? TILE_DEFAULT_ACCENT, params.seed ?? DEFAULT_SEED, {
      grid: params.grid ?? 2,
      style: params.style ?? 'ceramic',
    }),
  bump: (params) => tilesBumpTexture(params.seed ?? DEFAULT_SEED, { grid: params.grid ?? 2 }),
  defaultAccent: TILE_DEFAULT_ACCENT,
};

/**
 * The registry. Three keys of the object family are ALIASES of a room kind
 * — `plank_floor` is `planks`, `painted_plaster` is `plaster`, `tile_grid` is
 * `tiles` — and share the entry object rather than repeating its body, which
 * is what makes "one registry" checkable (`finish-generators.test.ts`).
 *
 * `Record<FinishGeneratorKind, …>`: a kind added to either union without an
 * entry here fails the type check, so the open set cannot go quietly stale.
 */
const GENERATORS: Readonly<Record<FinishGeneratorKind, GeneratorEntry>> = {
  planks,
  plank_floor: planks,
  plaster,
  painted_plaster: plaster,
  tiles,
  tile_grid: tiles,
  chevron: {
    colour: (params) => chevronTexture(params.tone, params.seed ?? DEFAULT_SEED),
  },
  terrazzo: {
    colour: (params) => terrazzoTexture(params.tone, params.seed ?? DEFAULT_SEED),
  },
  stripes: {
    colour: (params) =>
      stripesTexture(params.tone, params.accent ?? STRIPE_DEFAULT_ACCENT, { periods: params.grid ?? 4, seed: params.seed ?? DEFAULT_SEED }),
    defaultAccent: STRIPE_DEFAULT_ACCENT,
  },
  wood_grain: {
    // Spread, not `{ lines: params.lines }`: the texture generators merge their
    // options over defaults, so a key that is PRESENT and `undefined`
    // overwrites the default with `undefined` — `size / lines` then goes NaN
    // and the grain loop never runs (the bug `exactOptionalPropertyTypes`
    // surfaced in `asset-finishes.ts`, carried here with its reason).
    colour: (params) =>
      woodGrainTexture(params.tone, params.seed ?? DEFAULT_SEED, {
        ...(params.lines !== undefined && { lines: params.lines }),
        ...(params.variation !== undefined && { variation: params.variation }),
      }),
    bump: (params) => woodGrainBumpTexture(params.seed ?? DEFAULT_SEED, { ...(params.lines !== undefined && { lines: params.lines }) }),
  },
  fabric_weave: {
    // Same defaults-merge hazard as `wood_grain` above.
    colour: (params) =>
      fabricTexture(params.tone, {
        ...(params.threads !== undefined && { threads: params.threads }),
        ...(params.variance !== undefined && { variance: params.variance }),
        seed: params.seed ?? DEFAULT_SEED,
      }),
    bump: (params) =>
      fabricBumpTexture({ ...(params.threads !== undefined && { threads: params.threads }), seed: params.seed ?? DEFAULT_SEED }),
  },
};

/** Every kind the registry knows, for a caller that has to iterate them. */
export const FINISH_GENERATOR_KINDS = Object.keys(GENERATORS) as readonly FinishGeneratorKind[];

/**
 * How to draw this kind, or `undefined` when this build has never heard of it.
 *
 * Takes a plain `string`: the kind arrives from a project's JSON, so "is it
 * one of ours" is exactly the question, and a caller forced to cast first
 * would be asserting the answer.
 */
export function generatorFor(kind: string): GeneratorEntry | undefined {
  return Object.hasOwn(GENERATORS, kind) ? GENERATORS[kind as FinishGeneratorKind] : undefined;
}

/** A project generator read as registry parameters: the two families' field names meet here. */
export function paramsOfGenerator(generator: FinishGenerator): GeneratorParams {
  return {
    tone: generator.tone,
    seed: generator.seed,
    ...(generator.kind === 'tile_grid' && { accent: generator.grout, grid: generator.grid, style: generator.style }),
    ...(generator.kind === 'wood_grain' && { lines: generator.lines, variation: generator.variation }),
    ...(generator.kind === 'fabric_weave' && { threads: generator.threads, variance: generator.variance }),
  };
}

/** The texture clone a repeat of `1 / tile` metres needs; the shared canvas behind it is never touched. */
function repeated(texture: THREE.Texture | null, repeatX: number, repeatY: number): THREE.Texture | null {
  if (!texture) return null;
  const clone = texture.clone();
  clone.needsUpdate = true;
  clone.repeat.set(repeatX, repeatY);
  return clone;
}

/**
 * The THREE material one `materials[]` entry of a baked project becomes.
 *
 * Four outcomes, none of them a throw:
 *  - a generator this build knows → a textured `MeshStandardMaterial` (flat in
 *    the generator's tone where there is no canvas to draw on);
 *  - a generator it does not → the same material, flat, plus
 *    `unknown-generator:<kind>`;
 *  - `library` → flat in its average colour (its maps dress room surfaces);
 *  - `pbr` → flat, plus `pbr-textures-deferred`. Loading the KTX2 maps is not
 *    implemented yet; accepting the material now is what lets the whole format load
 *    today rather than half of it.
 *
 * The caller OWNS what comes back — the material and the texture clone on its
 * `map` — and disposes both (`assets/asset-finishes.FinishRegistry`).
 */
export function materialFromProject(material: ProjectMaterial, log: Logger = defaultLogger): THREE.Material {
  const built =
    'pbr' in material ? deferredPbr(material, log) : 'library' in material ? flatLibrary(material) : fromGenerator(material, log);
  built.name = material.id;
  return built;
}

/**
 * A library material on an object slot: flat in its `averageColour` at its
 * roughness and metalness. Object slots keep the GLB's own materials; this is
 * the answer for a slot finish that names a library material, and its maps
 * are drawn only on room surfaces.
 */
function flatLibrary(material: Extract<ProjectMaterial, { library: unknown }>): THREE.MeshStandardMaterial {
  const { facts } = material.library;
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(facts.averageColour),
    roughness: facts.pbr.roughness ?? 1,
    metalness: facts.pbr.metalness ?? 0,
  });
}

function deferredPbr(material: Extract<ProjectMaterial, { pbr: unknown }>, log: Logger): THREE.MeshStandardMaterial {
  log.warn('pbr-textures-deferred', `Material ${material.id} carries baked PBR maps; this build draws it flat`, {
    id: material.id,
    albedo: material.pbr.albedo,
  });
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(FALLBACK_FINISH_COLOUR),
    roughness: material.pbr.roughness,
    metalness: material.pbr.metalness ?? 0,
  });
}

function fromGenerator(material: Extract<ProjectMaterial, { generator: unknown }>, log: Logger): THREE.MeshStandardMaterial {
  const { generator } = material;
  const entry = generatorFor(generator.kind);
  if (!entry) {
    log.warn('unknown-generator:' + generator.kind, `Material ${material.id} names a generator this build cannot draw`, {
      id: material.id,
      kind: generator.kind,
    });
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(generator.tone ?? FALLBACK_FINISH_COLOUR),
      roughness: PROJECT_GENERATOR_ROUGHNESS,
    });
  }
  const params = paramsOfGenerator(generator);
  // Geometry UVs are baked in metres, so the repeat is the inverse of the physical tile size.
  const repeat = material.tile === undefined ? 1 : 1 / material.tile;
  const map = repeated(entry.colour(params), repeat, repeat);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(map ? '#ffffff' : generator.tone),
    roughness: PROJECT_GENERATOR_ROUGHNESS,
    map,
  });
}
