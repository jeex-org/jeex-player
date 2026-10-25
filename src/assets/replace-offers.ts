/**
 * What the "Replace with another…" popup lists for one placement: every asset
 * `replace_asset` would accept for it, grouped by category.
 *
 * The source is the host's offers when it gave some, else the bundled bank —
 * never the project library, whose objects are the ones the scene already
 * places. An offer shares the placement's anchor pair (`anchor` and the
 * on-surface flag), allows the mirror the placement carries, and is not the
 * placement's own archetype. Offers are grouped by the TOP segment of their
 * category path (`furniture`, `lighting`), in the order those are first seen:
 * one group per leaf left a column of one-card groups, and the card names
 * already say "Dining table" or "Floor lamp". Each group is labelled by that
 * segment made readable: category labels are data, not catalogue copy.
 *
 * A pick names its variant explicitly — the offered archetype's default as
 * listed here — so what is committed never depends on what the default is at
 * commit time.
 *
 * Pure module: no `three`, no DOM. The rendered previews come in through
 * `renderPreview`.
 */

import { listCatalogueObjects } from './asset-catalogue.js';
import { variantsForType, type VariantBank } from './asset-variants.js';
import type { CatalogueMatch, ResolvableObject } from './asset-resolver.js';
import { findCatalogueEntry } from './asset-catalogue.js';
import { disallowedMirrorAxes, mirroredAxes } from '../scene/mirror.js';
import type { DemoAsset, ReplaceAssetOp } from '../scene/types.js';

/** One asset the popup offers. */
export type ReplaceOffer = {
  readonly archetypeId: string;
  /** The offers library id; absent for a bundled archetype. */
  readonly library?: string;
  /** The variant a pick commits: the archetype's default, as listed. */
  readonly variant: string;
  readonly name: string;
  /** The picture the content declares for that variant (or the archetype), already absolute. */
  readonly image?: string;
  /** The viewer's own render of that variant, or `null`. */
  readonly thumbnail: string | null;
  /** Base colours of its finishes: the chip shown when there is no picture. */
  readonly swatch: readonly string[];
};

/** One category of offers. */
export type ReplaceGroup = {
  /** The top segment of the offers' category paths. */
  readonly category: string;
  /** That segment, readable. */
  readonly label: string;
  readonly offers: readonly ReplaceOffer[];
};

/** Renders one variant of a candidate placement, or `null` to fall back to the chip. */
export type CandidatePreview = (candidate: DemoAsset, variantId: string) => string | null;

/** The top segment of a category path: `furniture/tables/dining` -> `furniture`. */
export function topCategory(category: string): string {
  return category.split('/').find((segment) => segment.length > 0) ?? category;
}

/** `home_decor/benches` -> `Home decor`. */
export function categoryLabel(category: string): string {
  const words = topCategory(category).replaceAll(/[-_]+/g, ' ').trim();
  return words.length === 0 ? category : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The placement's current archetype, the way the panel reads it. */
function currentEntry(placement: DemoAsset, bank: VariantBank | undefined): CatalogueMatch | null {
  const id = placement.asset ?? placement.type;
  return bank?.catalogue(id) ?? findCatalogueEntry(id) ?? null;
}

/** The anchor pair an offer must share. */
function anchorPair(object: { readonly anchor?: string | undefined; readonly onSurface?: true | undefined }): string {
  return `${object.anchor ?? 'floor'}|${object.onSurface === true}`;
}

/**
 * The offers for `placement`, grouped. `cache` keeps rendered previews per
 * archetype across openings, since rendering one is the expensive part.
 */
export function replaceOffers(
  placement: DemoAsset,
  bank: VariantBank | undefined,
  renderPreview: CandidatePreview,
  cache?: Map<string, string | null>,
): ReplaceGroup[] {
  const current = currentEntry(placement, bank)?.object;
  if (current === undefined) return [];
  const source: readonly ResolvableObject[] = bank?.offers?.objects ?? listCatalogueObjects();
  const offered = bank?.offers;
  const mirror = placement.mirror ?? {};
  const mirrored = mirroredAxes(mirror).length > 0;
  const groups = new Map<string, ReplaceOffer[]>();
  for (const listed of source) {
    // An id the project declares too is offered as the project's copy: that is the one drawn.
    const shadowed = offered?.project?.ids.has(listed.id) === true;
    const object = shadowed ? (bank?.catalogue(listed.id)?.object ?? listed) : listed;
    const library = shadowed ? offered?.project?.id : offered?.id;
    if (object.id === current.id || anchorPair(object) !== anchorPair(current)) continue;
    if (mirrored && disallowedMirrorAxes(mirror, object.mirror).length > 0) continue;
    const variant = object.variants.find((candidate) => candidate.id === object.defaultVariant) ?? object.variants[0];
    if (variant === undefined) continue;
    const shown = variantsForType(variant.id, bank).find((candidate) => candidate.id === variant.id);
    const candidate: DemoAsset = {
      id: placement.id,
      type: object.id,
      asset: object.id,
      ...(library === undefined ? {} : { library }),
      variant: variant.id,
      position: placement.position,
    };
    let thumbnail = cache?.get(object.id);
    if (thumbnail === undefined) {
      thumbnail = renderPreview(candidate, variant.id);
      cache?.set(object.id, thumbnail);
    }
    const image = shown?.preview ?? object.preview;
    const offer: ReplaceOffer = {
      archetypeId: object.id,
      ...(library === undefined ? {} : { library }),
      variant: variant.id,
      name: object.name,
      ...(image === undefined ? {} : { image }),
      thumbnail,
      swatch: shown?.swatch ?? [],
    };
    const top = topCategory(object.category);
    const list = groups.get(top);
    if (list) list.push(offer);
    else groups.set(top, [offer]);
  }
  return [...groups].map(([category, offers]) => ({ category, label: categoryLabel(category), offers }));
}

/** The op a pick commits: the placement takes the offer, its variant named. */
export function replaceOp(assetId: string, offer: ReplaceOffer): ReplaceAssetOp {
  return {
    op: 'replace_asset',
    assetId,
    asset: offer.archetypeId,
    ...(offer.library === undefined ? {} : { library: offer.library }),
    variant: offer.variant,
  };
}
