/**
 * Pure catalogue of swappable surface finishes: the data plus the lookups over
 * it. Split out of `finishes.ts` so the validator, the scene model and the
 * operation appliers can resolve a finish id without importing `three`.
 *
 * Every bank row is addressed by its fixed UUID literal (`FINISH` in
 * `finish-ids.ts`); its readable name is its display-only `slug`.
 *
 * Invariant: floor and wall finish ids are disjoint, which is what lets
 * `finishKind` route a `set_material` on a room to its floor or to its walls.
 */

import { FINISH } from './finish-ids.js';
import type { FinishGenerator, ProjectMaterial } from './finish-types.js';

export type FinishKind = 'planks' | 'chevron' | 'terrazzo' | 'tiles' | 'plaster' | 'stripes';

/**
 * A swapable surface finish. Floor finishes map to procedural textures sized by
 * `tile` (world metres one texture tile covers); wall finishes are plaster
 * paints baked into a subtly noisy texture.
 */
export type Finish = {
  /** UUID v7 of the finish: a bank literal, or a project material's own id. */
  id: string;
  /** Display-only readable name of a bank row (`oak`); a project material has none. Never a key. */
  slug?: string;
  name: string;
  kind: FinishKind;
  base: string;
  accent?: string;
  roughness: number;
  /** World metres covered by one texture repeat. Callers use `length / tile`. */
  tile?: number;
  /** Sub-style inside a kind: `tiles` renders glazed ceramic or veined stone. */
  style?: 'ceramic' | 'stone';
  /** Tiles (or stripe periods) per texture repeat. */
  grid?: number;
  /** `bumpScale` for the generated height detail; omit for flat finishes. */
  bump?: number;
  /** Pattern seed, so two finishes of the same kind do not share a layout. */
  seed?: number;
  /**
   * The generator this finish draws with, whole, when it came from a PROJECT's
   * `materials[]` rather than from the bank below.
   *
   * A bank row says which generator it wants by its `kind` and spreads the
   * parameters across its own fields; a project material carries a
   * `FinishGenerator` object, which can name a kind no `FinishKind` has
   * (`wood_grain`, `fabric_weave`) and carries parameters no `Finish` field
   * exists for (`lines`, `threads`). Keeping it whole is what makes the
   * conversion below lossless; `finishes.drawing` prefers it over `kind`.
   */
  generator?: FinishGenerator;
};

/** A row of the bank below: a `Finish` that always carries its `slug`. */
type BankFinish = Finish & { slug: string };

/**
 * Floor finish a room that names none starts on: the first entry of the bank
 * below.
 *
 * It is written out rather than read off `FLOOR_FINISHES[0]` so that the id is
 * greppable and reordering the bank cannot silently repaint every room that
 * never chose a floor; `finishes.test.ts` holds the two together. The SCENE
 * layer never reads this constant — it asks the registries it was handed
 * (`SceneRegistries.defaultFloorFinish`), because a project library that never
 * heard of the bank's oak has a default of its own.
 */
export const DEFAULT_FLOOR_FINISH = FINISH.oak;

export const FLOOR_FINISHES: BankFinish[] = [
  { id: FINISH.oak, slug: 'oak', name: 'Natural oak', kind: 'planks', base: '#b5855a', roughness: 0.54, tile: 3.2, bump: 0.035, seed: 1 },
  {
    id: FINISH.walnut,
    slug: 'walnut',
    name: 'Dark walnut',
    kind: 'planks',
    base: '#6e4a30',
    roughness: 0.5,
    tile: 3.2,
    bump: 0.035,
    seed: 2,
  },
  { id: FINISH.ash, slug: 'ash', name: 'Bleached ash', kind: 'planks', base: '#d8c6a9', roughness: 0.6, tile: 3.2, bump: 0.03, seed: 3 },
  { id: FINISH.teak, slug: 'teak', name: 'Honey teak', kind: 'planks', base: '#a0673f', roughness: 0.52, tile: 3.2, bump: 0.035, seed: 4 },
  { id: FINISH.chevron, slug: 'chevron', name: 'Chevron parquet', kind: 'chevron', base: '#a97b4e', roughness: 0.48, tile: 2.4, seed: 5 },
  { id: FINISH.terrazzo, slug: 'terrazzo', name: 'Sage terrazzo', kind: 'terrazzo', base: '#a7b5a6', roughness: 0.62, tile: 2.4, seed: 6 },
  {
    id: FINISH.stone,
    slug: 'stone',
    name: 'Warm limestone',
    kind: 'tiles',
    base: '#c6bfb1',
    accent: '#8f877b',
    roughness: 0.7,
    tile: 2.48,
    style: 'stone',
    grid: 4,
    bump: 0.05,
    seed: 7,
  },
  {
    id: FINISH.ceramic_light,
    slug: 'ceramic-light',
    name: 'Light ceramic',
    kind: 'tiles',
    base: '#e9e5dc',
    accent: '#b8b4aa',
    roughness: 0.35,
    tile: 2.5,
    style: 'ceramic',
    grid: 4,
    bump: 0.05,
    seed: 8,
  },
  {
    id: FINISH.ceramic_graphite,
    slug: 'ceramic-graphite',
    name: 'Graphite ceramic',
    kind: 'tiles',
    base: '#4c4c4a',
    accent: '#33332f',
    roughness: 0.4,
    tile: 2.5,
    style: 'ceramic',
    grid: 4,
    bump: 0.05,
    seed: 9,
  },
];

export const WALL_FINISHES: BankFinish[] = [
  { id: FINISH.sand, slug: 'sand', name: 'Warm sand', kind: 'plaster', base: '#b0a294', roughness: 0.85, tile: 2.4, seed: 11 },
  { id: FINISH.white, slug: 'white', name: 'Cotton white', kind: 'plaster', base: '#eae4d6', roughness: 0.85, tile: 2.4, seed: 12 },
  { id: FINISH.sage, slug: 'sage', name: 'Sage green', kind: 'plaster', base: '#a8b5a4', roughness: 0.85, tile: 2.4, seed: 13 },
  { id: FINISH.terra, slug: 'terra', name: 'Terracotta', kind: 'plaster', base: '#c08a70', roughness: 0.85, tile: 2.4, seed: 14 },
  { id: FINISH.graphite, slug: 'graphite', name: 'Graphite', kind: 'plaster', base: '#6a6862', roughness: 0.85, tile: 2.4, seed: 15 },
  {
    id: FINISH.wallpaper_cream,
    slug: 'wallpaper-cream',
    name: 'Cream stripes',
    kind: 'stripes',
    base: '#e7ddc8',
    accent: '#d9cbae',
    roughness: 0.92,
    tile: 0.55,
    grid: 4,
    seed: 16,
  },
  {
    id: FINISH.wallpaper_sage,
    slug: 'wallpaper-sage',
    name: 'Sage stripes',
    kind: 'stripes',
    base: '#dde4d6',
    accent: '#c3ceb9',
    roughness: 0.92,
    tile: 0.42,
    grid: 3,
    seed: 17,
  },
  {
    id: FINISH.tiles_white,
    slug: 'tiles-white',
    name: 'White wall tiles',
    kind: 'tiles',
    base: '#e6e2d8',
    accent: '#bcb8ac',
    roughness: 0.3,
    tile: 0.6,
    style: 'ceramic',
    grid: 2,
    bump: 0.04,
    seed: 18,
  },
];

/**
 * Every `FinishKind` at runtime, declared ONCE.
 *
 * `as const satisfies readonly FinishKind[]`: `KIND_DEFAULTS` below is already
 * exhaustive by construction (the compiler checks a `Record<FinishKind, …>`),
 * but a caller that needs to ITERATE the kinds — the panel that offers them,
 * `closed-sets.test.ts` — needs the list, and one detached from the union is
 * exactly the drift the validator's four `Set<string>` once had.
 */
export const FINISH_KINDS = ['planks', 'chevron', 'terrazzo', 'tiles', 'plaster', 'stripes'] as const satisfies readonly FinishKind[];

/** Default texture-repeat size per `FinishKind`, world metres, when a row sets no `tile` of its own. */
export const KIND_DEFAULTS: Readonly<Record<FinishKind, number>> = {
  planks: 2.6,
  chevron: 2.6,
  terrazzo: 2.6,
  tiles: 2.6,
  plaster: 2.4,
  stripes: 2.6,
};

/**
 * Roughness a project material drawn by a generator gets: the format carries
 * none of its own.
 *
 * Here rather than beside the generators because this is a PURE module and the
 * generators import `three` — and one number in two files is how a finish
 * comes out matt on a wall and glossy on a sofa.
 */
export const PROJECT_GENERATOR_ROUGHNESS = 0.8;

/**
 * The colour anything unresolved is painted: an id no source knows, and a
 * `pbr` project material until its KTX2 maps load (not implemented yet).
 */
export const FALLBACK_FINISH_COLOUR = '#b0a695';

/** One index entry: the finish plus the surface family `finishKind` answers with — an O(1) lookup instead of a scan. */
type CatalogueEntry = { finish: Finish; family: 'floor' | 'wall' };

const catalogue = new Map<string, CatalogueEntry>();
for (const finish of FLOOR_FINISHES) catalogue.set(finish.id, { finish, family: 'floor' });
for (const finish of WALL_FINISHES) catalogue.set(finish.id, { finish, family: 'wall' });

/**
 * One project material as a surface `Finish`.
 *
 * Lossless for a generator material: the generator travels whole in
 * `Finish.generator`, so a kind this `Finish` vocabulary has no word for still
 * draws. A `pbr` material has no maps here — loading them is not implemented
 * yet — and becomes the flat fallback colour, which is what a surface
 * painted with it looks like today.
 */
export function finishFromProjectMaterial(material: ProjectMaterial): Finish {
  if ('library' in material) return flatLibraryFinish(material);
  const generated = 'generator' in material;
  const tile = generated ? material.tile : material.pbr.tile[0];
  return {
    id: material.id,
    name: material.name,
    // `kind` is the BANK's word for a generator and a project material may
    // name one outside it, so the generator below is what actually draws.
    // `plaster` is the neutral flat row and is only ever reached when there
    // is no generator at all, which is the `pbr` case.
    kind: 'plaster',
    base: generated ? material.generator.tone : FALLBACK_FINISH_COLOUR,
    roughness: generated ? PROJECT_GENERATOR_ROUGHNESS : material.pbr.roughness,
    ...(tile !== undefined && { tile }),
    ...(generated && { generator: material.generator }),
  };
}

/**
 * A library material as a flat surface `Finish`: its `averageColour`, or the
 * first suggested colour of a tintable parameters material (a paint has no map
 * to average), at its roughness. What the legacy finish path can say about a
 * library material; its maps, tint and tile are drawn by the library path.
 */
function flatLibraryFinish(material: Extract<ProjectMaterial, { library: unknown }>): Finish {
  const { facts, kind } = material.library;
  const paint = kind === 'parameters' ? facts.tint?.suggestedColours[0]?.hex : undefined;
  return {
    id: material.id,
    name: material.name,
    kind: 'plaster',
    base: paint ?? facts.averageColour,
    roughness: facts.pbr.roughness ?? 1,
    ...(facts.tileM !== null && { tile: facts.tileM[0] }),
  };
}

/** The surface words of `apply`: a project material naming one of them may dress a room surface. */
const SURFACE_APPLY: ReadonlySet<string> = new Set(['floor', 'wall', 'ceiling', 'facade', 'trim']);

/** Whether a project material may dress a room surface at all. */
function isSurfaceMaterial(material: ProjectMaterial): boolean {
  return material.apply.some((word) => SURFACE_APPLY.has(word));
}

/**
 * The finish with that id, or `null`.
 *
 * `source` is a BAKED PROJECT's `materials[]`: the surfaces of a
 * project are painted with the project's own finishes, and the module
 * catalogues below are what a bare scene still has. Only materials that may
 * dress a room surface answer from a project source (`floor`, `wall`, `ceiling`, `facade` or `trim`), which is
 * the same question `finishKind` asks of the bank.
 *
 * Defaulted rather than overloaded so that every existing caller
 * (`shell-paint.ts`, `material-catalogue.ts`, the UI panels) keeps its one
 * argument and its meaning.
 */
export function findFinish(id: string, source?: readonly ProjectMaterial[]): Finish | null {
  if (source === undefined) return catalogue.get(id)?.finish ?? null;
  const material = source.find((candidate) => candidate.id === id && isSurfaceMaterial(candidate));
  return material === undefined ? null : finishFromProjectMaterial(material);
}

/** Metres covered by one texture repeat, with per-kind defaults (`KIND_DEFAULTS`). */
export function finishTile(finish: Finish): number {
  return finish.tile ?? KIND_DEFAULTS[finish.kind];
}

/** Which surface family a finish id belongs to, or `null` when it is unknown. */
export function finishKind(id: string): 'floor' | 'wall' | null {
  return catalogue.get(id)?.family ?? null;
}
