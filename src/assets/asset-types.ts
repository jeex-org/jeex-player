/**
 * The shape of an object bank: the types a library manifest and its entries
 * must have.
 *
 * Pure data — no `three`, no DOM, and no dependency on any manifest. It exists
 * so the two halves of the bank can stop importing each other: the manifest
 * (`asset-library.ts`) declares itself against these types, the index over it
 * (`asset-catalogue.ts`) reads them, and neither has to name the other for its
 * types. Before the split those two modules formed an import cycle whose only
 * content was this file.
 *
 * Shape follows the open library-manifest format
 * (`manifestVersion`, `id`, `name`, `license`, `baseUrl`, `objects[]` with
 * `id` / `name` / `category` / `dims` / `anchor` / `wallSnap` / `clearance` /
 * `model` / `lods` / `preview` / `tags`) and the catalogue model:
 * publisher -> library -> asset (an archetype such as the three-seat sofa) ->
 * variant (upholstery, colour, size; the unit of access and purchase) ->
 * version.
 *
 * Every entry is addressed by a UUID v7 `id`; its readable name (`sofa_3s`) is
 * its `slug`, which is display-only: nothing keys
 * on it, and the one table that maps it to the id is `CATALOGUE_ID_BY_SLUG`
 * (`catalogue-slugs.ts`), for hosts translating a 1.x document.
 *
 * Two viewer-local additions sit alongside the documented fields:
 *  - `builder` + `options` name the procedural generator used when no GLB is
 *    available, so the demo works fully offline. `model` still names the
 *    glTF/GLB a catalogue service would serve.
 *  - `slots` / `defaultFinishes` express which surfaces of an archetype a
 *    variant may re-finish.
 */

import type { FinishSlot } from '../materials/asset-finish-catalogue.js';
import type { MirrorFacts } from '../scene/types.js';

/**
 * A finish slot NAME as content declares it: any identifier, not a closed set.
 *
 * `FinishSlot` lists the names the shipped builders and their finish catalogue
 * know; a baked asset names its parts freely (`shell`, `base`, `fittings`) and
 * those names bind nothing. Slot names are names, never ids.
 */
export type SlotName = string;

/** `slot -> finish UUID`, keyed by an open slot name. */
export type SlotFinishes = Readonly<Partial<Record<SlotName, string>>>;

/** Where an object's origin sits and what it snaps to. */
export type AssetAnchor = 'floor' | 'wall' | 'ceiling';

/**
 * The anchor set at runtime, declared ONCE.
 *
 * `as const satisfies readonly AssetAnchor[]`: a new anchor in the union that
 * is not listed here fails `closed-sets.test.ts`, so a manifest validator
 * cannot silently reject an anchor the type system accepts.
 */
export const ASSET_ANCHORS = ['floor', 'wall', 'ceiling'] as const satisfies readonly AssetAnchor[];

/**
 * The access level of ONE variant, as the content declares it: one of three
 * words, also recorded per asset in a bake's `ProjectRights.assets[].access`.
 *
 * The viewer carries it through to the host and judges nothing: which of the
 * three a workspace may place is the host's decision, and no access rule lives
 * in the viewer.
 */
export type VariantAccess = 'free' | 'pro' | 'exclusive';

/** The access set at runtime, declared ONCE (`closed-sets.test.ts` holds it to the union). */
export const VARIANT_ACCESS = ['free', 'pro', 'exclusive'] as const satisfies readonly VariantAccess[];

/**
 * Whether a string is an absolute address a PICTURE may be served from:
 * `http:` or `https:`, and nothing else.
 *
 * One definition, two readers — `project-manifest.schema.ts` decides whether a
 * manifest is admissible and `project-catalogue.ts` decides what to put in an
 * `<img>`. Two copies of this list would drift into the worst failure this
 * feature has: a schema that accepts a `preview` the resolver silently drops,
 * so every picture is gone and nothing anywhere says why.
 *
 * Parsed, never pattern-matched: `new URL` is the reader the browser will use
 * for the request, and the protocol check is what keeps out `javascript:`,
 * `data:`, `blob:` and `file:` — each of which `new URL` parses happily and
 * none of which is a picture on a server.
 */
export function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || url.protocol === 'http:';
}

export type AssetPricing = {
  model: 'free' | 'subscription' | 'premium';
  tier?: 'standard' | 'pro';
  buyout?: { amount: number; currency: string };
};

/** Dimensions in metres, `[width, height, depth]`, measured on the un-rotated archetype. */
export type AssetDims = readonly [number, number, number];

export type AssetOptions = Readonly<Record<string, number | string | boolean>>;

/**
 * Layout facts of an archetype, read by `layout-lint.ts`.
 *
 * They belong to the object, not to the linter: "a wardrobe stands against a
 * wall", "a wall cabinet hangs with its bottom edge at 1.45 m" are properties
 * of the piece of furniture. Keeping them here means adding an archetype to
 * the bank cannot leave a membership table in the linter behind, which is
 * exactly how `tv_panel` came to sit in a mounting-height table for an
 * archetype the bank never had.
 *
 * Every field is optional: an archetype that names none is simply not subject
 * to those rules.
 */
export type AssetLayout = {
  /** Rule 8: a case good belongs against a wall. */
  caseGood?: boolean;
  /** Rule 9: a base kitchen unit whose run the wall cabinets must stay inside. */
  kitchenBase?: boolean;
  /**
   * Rule 7: the height that actually blocks a window, metres, when it is not
   * the archetype's own `dims[1]`. A counter run's height includes its
   * backsplash, which is a surface on the wall and not a volume in front of
   * the glass.
   */
  blockingHeight?: number;
  /**
   * Rules 1-7: what actually STANDS on the floor, as a fraction of the
   * archetype's own plan size, when that is smaller than its bounding box.
   *
   * A houseplant is the case that needs it: a palm's canopy overhangs its
   * basket by a quarter of a metre, and it is the basket you walk into, park a
   * chair beside and measure a door's clear zone against - the canopy is above
   * knee height and a fan of leaflets does not block a window the way a
   * wardrobe does. Absent means the whole footprint, which is every other
   * archetype in the bank.
   *
   * A fraction, not metres, so a compact size variant gets a compact pot; it
   * is the same number the species builder sizes the pot from, and
   * `asset-builders-plants.test.ts` measures the built pot against it.
   */
  footprint?: number;
  /**
   * Rule 5: where a wall-hung archetype belongs, metres above the floor. The
   * linter allows a fixed tolerance either side of the nominal height.
   */
  mount?: {
    /** Nominal height of the object's CENTRE. */
    centre?: number;
    /** Nominal height of the object's BOTTOM edge. */
    bottom?: number;
  };
};

/**
 * Surfaces and tucking: facts of the
 * archetype, measured on its own `dims` and following a size variant and the
 * placement scale on the axis they measure. Every field is optional and an
 * absent one means "not allowed".
 */
export type KneeSide = 'front' | 'back' | 'left' | 'right';
/** The sides a knee space may name, declared ONCE (`closed-sets.test.ts`). */
export const KNEE_SIDES = ['front', 'back', 'left', 'right'] as const satisfies readonly KneeSide[];
/** A host's top: `y` metres above its base, covering its footprint. */
export type SurfaceTop = { readonly y: number };
/** Room under a top, up to `height` above the floor, entered from `sides`; `depth` caps how far in (absent: the whole footprint). */
export type KneeSpace = { readonly height: number; readonly sides: readonly KneeSide[]; readonly depth?: number };
/** How far a seat goes under a knee space (`depth`), and how high what goes under reaches (`height`). */
export type TuckFacts = { readonly depth: number; readonly height: number };
/** The four facts together, as `LayoutFacts` and `LintItem` carry them. */
export type SurfaceFacts = {
  readonly onSurface?: true;
  readonly top?: SurfaceTop;
  readonly kneeSpace?: KneeSpace;
  readonly tuck?: TuckFacts;
};

/**
 * The surface facts of an archetype declared on `base` dims, at the size `dims`
 * (a size variant): heights follow the height, depths the depth.
 */
export function surfacesAt(facts: SurfaceFacts, base: readonly number[], dims: readonly number[]): SurfaceFacts {
  return scaleSurfaces(facts, dims[1]! / base[1]!, dims[2]! / base[2]!);
}

/** `facts` with every height times `h` and every depth times `d`. */
export function scaleSurfaces(facts: SurfaceFacts, h: number, d: number): SurfaceFacts {
  const { onSurface, top, kneeSpace, tuck } = facts;
  return {
    ...(onSurface ? { onSurface } : {}),
    ...(top ? { top: { y: top.y * h } } : {}),
    ...(kneeSpace
      ? {
          kneeSpace: {
            sides: kneeSpace.sides,
            height: kneeSpace.height * h,
            ...(kneeSpace.depth === undefined ? {} : { depth: kneeSpace.depth * d }),
          },
        }
      : {}),
    ...(tuck ? { tuck: { depth: tuck.depth * d, height: tuck.height * h } } : {}),
  };
}

export type CatalogueVariant = {
  /** The variant's UUID v7: what a placement's `variant` and a catalogue reference name. */
  id: string;
  /** Display-only readable name, conventionally `{archetype}_{suffix}` (`sofa_3s_linen`); never a key. */
  slug: string;
  name: string;
  /** Version of this variant (semver); a bake records which version it used. */
  version: string;
  tags?: readonly string[];
  /** Size variants override the archetype dims. */
  dims?: AssetDims;
  /** Colour / upholstery variants re-finish named slots, `slot -> finish UUID`. */
  finishes?: Partial<Record<FinishSlot, string>>;
  /** Configuration tweaks handed to the procedural builder. */
  options?: AssetOptions;
  pricing: AssetPricing;
};

export type CatalogueObject = {
  /** Archetype UUID v7 - the archetype, not a concrete variant. */
  id: string;
  /** Display-only readable name of the archetype (`sofa_3s`); never a key. */
  slug: string;
  name: string;
  /** Slash-delimited category path, e.g. `"mebel/divany"` (furniture/sofas). */
  category: string;
  dims: AssetDims;
  anchor: AssetAnchor;
  wallSnap: boolean;
  /** Free space required in front of the object, metres. */
  clearance: number;
  tags: readonly string[];
  /** glTF/GLB relative to the library `baseUrl`; absent means procedural-only. */
  model?: string;
  /**
   * Binds a GLB's material NAMES to the archetype's finish slots so a variant
   * repaints a loaded model exactly like a procedural one. Keys are slot names
   * from `FinishSlot`, values are glTF material names.
   *
   * Only the exceptions need declaring: the library format asks a library to name a
   * material after the slot it dresses, and the loader binds a material whose
   * name IS a slot id without any entry here. A material bound by neither
   * route keeps whatever the GLB shipped and is reported as
   * `unbound-material:<name>`.
   */
  readonly materialSlots?: Readonly<Record<string, string>>;
  lods?: readonly string[];
  /** Picture of the archetype: relative to its library's folder, or an absolute `http(s)` URL a catalogue service serves. */
  preview?: string;
  /** Procedural builder id used offline or as the GLB fallback. */
  builder: string;
  options?: AssetOptions;
  slots: readonly FinishSlot[];
  /** `slot -> finish UUID` the archetype wears before a variant re-finishes it. */
  defaultFinishes: Partial<Record<FinishSlot, string>>;
  /** Slot targeted by the legacy single-material shortcut on a placement. */
  primarySlot: FinishSlot;
  variants: readonly CatalogueVariant[];
  /** UUID of the variant a placement that names none gets; one of `variants`. */
  defaultVariant: string;
  /** What the layout linter must know about this archetype; absent means "no rule applies". */
  layout?: AssetLayout;
  /** Mirror axes the archetype allows; absent allows none. */
  mirror?: MirrorFacts;
  /** May stand on a host's `top`. */
  onSurface?: true;
  /** Holds what stands on it. */
  top?: SurfaceTop;
  /** Lets a `tuck` seat under its top. */
  kneeSpace?: KneeSpace;
  /** Goes under a `kneeSpace`. */
  tuck?: TuckFacts;
};

export type LibraryManifest = {
  manifestVersion: '1.0';
  id: string;
  name: string;
  publisher: string;
  license: string;
  baseUrl?: string;
  objects: readonly CatalogueObject[];
};
