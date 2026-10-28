/**
 * Pure catalogue of swappable surface finishes: the data plus the lookups over
 * it. Split out of `finishes.ts` so the validator, the scene model and the
 * operation appliers can resolve a finish id without importing `three`.
 *
 * Every bank row is addressed by its fixed UUID literal (`FINISH` in
 * `finish-ids.ts`); its readable name is its display-only `slug`. A bound
 * row's maps, tint and tile live in the generated built-in table, which this
 * module does not import: the scene-operation entry reads only ids and names.
 *
 * Invariant: floor and wall finish ids are disjoint, which is what lets
 * `finishKind` route a `set_material` on a room to its floor or to its walls.
 * A retired id (`RETIRED_FINISHES`) answers with its target's row and family;
 * the `Finish.id` such a lookup returns is the target's and is never written
 * back into a document.
 */

import { FINISH } from './finish-ids.js';
import type { FinishGenerator, ProjectMaterial } from './finish-types.js';

export type FinishKind = 'planks' | 'chevron' | 'terrazzo' | 'tiles' | 'plaster' | 'stripes';

/**
 * A swapable surface finish. A bundled row bound to a library material
 * (`builtin-library.ts`) is DRAWN as that material, and its `base` is the
 * material's first-frame colour; the other fields are what the legacy
 * generators draw a kept row, or a scene without the table, with: `tile`
 * (world metres one texture tile covers), the kind's pattern, roughness.
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
  { id: FINISH.oak, slug: 'oak', name: 'Natural oak', kind: 'planks', base: '#83654c', roughness: 0.54, tile: 3.2, bump: 0.035, seed: 1 },
  { id: FINISH.walnut, slug: 'walnut', name: 'Walnut', kind: 'planks', base: '#745224', roughness: 0.5, tile: 3.2, bump: 0.035, seed: 2 },
  { id: FINISH.teak, slug: 'teak', name: 'Honey oak', kind: 'planks', base: '#ab8256', roughness: 0.52, tile: 3.2, bump: 0.035, seed: 4 },
  { id: FINISH.chevron, slug: 'chevron', name: 'Chevron oak', kind: 'chevron', base: '#917258', roughness: 0.48, tile: 2.4, seed: 5 },
  { id: FINISH.terrazzo, slug: 'terrazzo', name: 'White terrazzo', kind: 'terrazzo', base: '#ccc6c2', roughness: 0.62, tile: 2.4, seed: 6 },
  {
    id: FINISH.stone,
    slug: 'stone',
    name: 'Cream limestone',
    kind: 'tiles',
    base: '#ddc9a5',
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
    name: 'Warm stone porcelain',
    kind: 'tiles',
    base: '#b6ad9f',
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
    name: 'Graphite porcelain',
    kind: 'tiles',
    base: '#5e5b56',
    accent: '#33332f',
    roughness: 0.4,
    tile: 2.5,
    style: 'ceramic',
    grid: 4,
    bump: 0.05,
    seed: 9,
  },
  { id: FINISH.herringbone, slug: 'herringbone', name: 'Herringbone oak', kind: 'planks', base: '#9a7a5e', roughness: 0.5, seed: 19 },
  {
    id: FINISH.herringbone_dark,
    slug: 'herringbone-dark',
    name: 'Dark oak herringbone',
    kind: 'planks',
    base: '#513b2a',
    roughness: 0.5,
    seed: 20,
  },
];

export const WALL_FINISHES: BankFinish[] = [
  { id: FINISH.sand, slug: 'sand', name: 'Oat limewash', kind: 'plaster', base: '#d4c7b3', roughness: 0.85, tile: 2.4, seed: 11 },
  { id: FINISH.white, slug: 'white', name: 'Warm white', kind: 'plaster', base: '#ede7db', roughness: 0.85, tile: 2.4, seed: 12 },
  { id: FINISH.sage, slug: 'sage', name: 'Olive limewash', kind: 'plaster', base: '#8f9574', roughness: 0.85, tile: 2.4, seed: 13 },
  { id: FINISH.terra, slug: 'terra', name: 'Clay limewash', kind: 'plaster', base: '#b98570', roughness: 0.85, tile: 2.4, seed: 14 },
  { id: FINISH.graphite, slug: 'graphite', name: 'Mocha', kind: 'plaster', base: '#6b5d53', roughness: 0.85, tile: 2.4, seed: 15 },
  {
    id: FINISH.tiles_white,
    slug: 'tiles-white',
    name: 'Stacked white tile',
    kind: 'tiles',
    base: '#cfc8ba',
    accent: '#bcb8ac',
    roughness: 0.3,
    tile: 0.6,
    style: 'ceramic',
    grid: 2,
    bump: 0.04,
    seed: 18,
  },
  { id: FINISH.pure_white, slug: 'pure-white', name: 'Pure white', kind: 'plaster', base: '#f4f4f2', roughness: 0.85, tile: 2.4, seed: 21 },
  { id: FINISH.ink, slug: 'ink', name: 'Ink blue', kind: 'plaster', base: '#3a4a5e', roughness: 0.85, tile: 2.4, seed: 22 },
  {
    id: FINISH.venetian,
    slug: 'venetian',
    name: 'Polished lime plaster',
    kind: 'plaster',
    base: '#d7cec0',
    roughness: 0.55,
    tile: 2.4,
    seed: 23,
  },
  { id: FINISH.microcement, slug: 'microcement', name: 'Sand microcement', kind: 'plaster', base: '#c9baa4', roughness: 0.85, seed: 24 },
  {
    id: FINISH.microcement_grey,
    slug: 'microcement-grey',
    name: 'Warm grey microcement',
    kind: 'plaster',
    base: '#b8b8b8',
    roughness: 0.85,
    seed: 25,
  },
  {
    id: FINISH.travertine,
    slug: 'travertine',
    name: 'Honed travertine',
    kind: 'tiles',
    base: '#dfccac',
    roughness: 0.7,
    style: 'stone',
    seed: 26,
  },
  { id: FINISH.marble, slug: 'marble', name: 'White marble', kind: 'tiles', base: '#f4f2f1', roughness: 0.4, style: 'stone', seed: 27 },
  {
    id: FINISH.porcelain_grey,
    slug: 'porcelain-grey',
    name: 'Stone porcelain 60x60',
    kind: 'tiles',
    base: '#b7b5b3',
    roughness: 0.8,
    style: 'ceramic',
    seed: 28,
  },
  { id: FINISH.zellige, slug: 'zellige', name: 'Teal zellige', kind: 'tiles', base: '#234f59', roughness: 0.3, style: 'ceramic', seed: 29 },
  // Flat paints: their library materials carry no maps, so they draw without relief.
  { id: FINISH.smooth_white, slug: 'smooth-white', name: 'Smooth white paint', kind: 'plaster', base: '#f5f5f3', roughness: 0.9, seed: 30 },
  {
    id: FINISH.ceiling_white,
    slug: 'ceiling-white',
    name: 'Pure white ceiling',
    kind: 'plaster',
    base: '#f8f8f8',
    roughness: 0.95,
    seed: 31,
  },
];

/** A retired bundled finish: valid in documents, read as `target`, never offered by the picker. */
export type RetiredFinish = { readonly id: string; readonly slug: string; readonly target: string };

/**
 * The retired bundled finishes. Each one is an alias: a document may keep its
 * id forever, and every lookup answers with the TARGET's own row and family
 * (never a copy), so it draws the target's current look. The player never
 * rewrites the stored id. `slug` is the retired row's historical slug, kept
 * for the 1.x translation table.
 */
export const RETIRED_FINISHES: readonly RetiredFinish[] = [
  { id: FINISH.wallpaper_cream, slug: 'wallpaper-cream', target: FINISH.white },
  { id: FINISH.wallpaper_sage, slug: 'wallpaper-sage', target: FINISH.sage },
  { id: FINISH.ash, slug: 'ash', target: FINISH.oak },
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
for (const retired of RETIRED_FINISHES) {
  const target = catalogue.get(retired.target);
  if (target !== undefined) catalogue.set(retired.id, target);
}

/** The bundled finish a retired id reads as, or `undefined` when `id` is not a retired bundled finish. */
export function bundledAliasTarget(id: string): string | undefined {
  return RETIRED_FINISHES.find((retired) => retired.id === id)?.target;
}

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
