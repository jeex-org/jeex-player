/**
 * What the object bank says about ONE placement, whichever bank holds it: the
 * one source every floor question is answered from — walk obstacles, plan
 * fixtures, the layout linter, the free-space probe and the drag tool.
 *
 * Two banks exist. The SHIPPED bank (`asset-catalogue.ts`) is a module; a
 * baked PROJECT's library is data that arrived with the document, and its
 * archetypes carry UUIDs the shipped bank has never heard of. A question asked
 * of the shipped bank alone answered "nothing there" for every placement of
 * such a project, so its sofas were walked through and its bath was missing
 * from the plan. `projectAssetFacts` layers the project's library OVER the
 * shipped bank, the same layering the render path (`project-catalogue.ts`) and
 * the validator use: the project answers first, and what it does not declare
 * (a `type`-only placement no exporter rewrote) falls through to the bank.
 *
 * Invariant: the facts are the archetype's, at the placement's size variant,
 * and they are NOT scaled by the placement — a consumer applies the placement
 * scale itself (`walkFootprint` here, `lintItemOf` in the linter).
 *
 * Pure module: no `three`, no DOM.
 */

import { findCatalogueEntry } from './asset-catalogue.js';
import {
  surfacesAt,
  type AssetAnchor,
  type AssetLayout,
  type KneeSpace,
  type SurfaceFacts,
  type SurfaceTop,
  type TuckFacts,
} from './asset-types.js';
import type { DemoAsset, MirrorFacts } from '../scene/types.js';

/** The comfort gap an archetype that names none wants around itself, metres (the shipped bank's own default). */
const DEFAULT_CLEARANCE_M = 0.6;

/** Everything a floor question reads of the bank for one placement. */
export type AssetFacts = {
  readonly archetype: string;
  readonly anchor: AssetAnchor;
  /** Slash-delimited category path of the store's tree (`bathroom/baths`); empty when the bank names none. */
  readonly category: string;
  readonly wallSnap: boolean;
  readonly clearance: number;
  /**
   * The size variant's `[width, height, depth]`, metres. For the shipped bank
   * these are the CARCASS dimensions the builders are drawn to; for a baked
   * project they are the OVERALL bounding box of its model, taps and
   * backsplashes included. `layout.footprint` and `layout.blockingHeight` say
   * what of that box actually stands on the floor (`walkFootprint`).
   */
  readonly dims: readonly [number, number, number];
  /** Facing compensation a legacy `type` word carries, radians; 0 for everything addressed by id. */
  readonly yaw: number;
  readonly layout: AssetLayout | undefined;
  readonly mirror: MirrorFacts | undefined;
  /** Surfaces and tucking at the variant's size; `{}` when none is allowed. */
  readonly surfaces: SurfaceFacts;
};

/** The bank one document's placements are judged against. */
export type AssetFactsSource = (placement: DemoAsset) => AssetFacts | null;

/** The archetype fields `assetFactsOf` reads, shared by the shipped bank's objects and a project's. */
type FactsObject = {
  readonly id: string;
  readonly anchor: AssetAnchor;
  readonly category?: string | undefined;
  readonly wallSnap?: boolean | undefined;
  readonly clearance?: number | undefined;
  readonly dims: readonly [number, number, number];
  readonly layout?: AssetLayout | undefined;
  readonly mirror?: MirrorFacts | undefined;
  readonly onSurface?: true;
  readonly top?: SurfaceTop;
  readonly kneeSpace?: KneeSpace;
  readonly tuck?: TuckFacts;
  readonly defaultVariant: string;
  readonly variants: readonly { readonly id: string; readonly dims?: readonly [number, number, number] | undefined }[];
};

/** A project library as `projectAssetFacts` reads it: the structural subset of `ProjectLibraryManifest`. */
export type FactsLibrary = { readonly objects: readonly FactsObject[] };

function assetFactsOf(object: FactsObject, variantId: string | undefined, yaw: number): AssetFacts {
  const wanted = variantId ?? object.defaultVariant;
  const variant = object.variants.find((candidate) => candidate.id === wanted);
  const dims = variant?.dims ?? object.dims;
  return {
    archetype: object.id,
    anchor: object.anchor,
    category: object.category ?? '',
    wallSnap: object.wallSnap ?? false,
    clearance: object.clearance ?? DEFAULT_CLEARANCE_M,
    dims,
    yaw,
    layout: object.layout,
    mirror: object.mirror,
    surfaces: surfacesAt(object, object.dims, dims),
  };
}

/**
 * The shipped bank's facts for `placement`.
 *
 * The placement is looked up by `asset ?? type` (an archetype UUID or a legacy
 * type word), the way the render path resolves it, and by its `variant` when
 * that names nothing, so a placement the bank knows only through its variant
 * id is still sized.
 */
export function shippedAssetFacts(placement: DemoAsset): AssetFacts | null {
  const entry =
    findCatalogueEntry(placement.asset ?? placement.type) ?? (placement.variant ? findCatalogueEntry(placement.variant) : undefined);
  if (!entry) return null;
  return assetFactsOf(entry.object, placement.variant ?? entry.variantId, entry.yaw ?? 0);
}

/**
 * A baked project's library layered over `base` (the shipped bank unless a
 * caller testing a manifest alone says otherwise).
 *
 * A project object is addressed by archetype id or by variant id and by
 * nothing else, and it carries no legacy facing compensation.
 */
export function projectAssetFacts(library: FactsLibrary, base: AssetFactsSource = shippedAssetFacts): AssetFactsSource {
  const byId = new Map<string, { object: FactsObject; variantId?: string }>();
  for (const object of library.objects) {
    byId.set(object.id, { object });
    for (const variant of object.variants) byId.set(variant.id, { object, variantId: variant.id });
  }
  return (placement) => {
    const hit = byId.get(placement.asset ?? placement.type) ?? (placement.variant ? byId.get(placement.variant) : undefined);
    if (!hit) return base(placement);
    return assetFactsOf(hit.object, placement.variant ?? hit.variantId, 0);
  };
}
