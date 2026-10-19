/**
 * The vocabulary every part of the `starter:interior-v1` manifest is written
 * in: the `v()` shorthand one catalogue variant is declared with. Every bundled
 * demo variant is `free`; the pricing fields stay in the format for a catalogue
 * that supplies its own.
 *
 * Pure data helpers, split out of `asset-library.ts` so the manifest can be
 * written across more than one file (`asset-library-plants.ts`) without either
 * half owning the other's shorthand.
 */

import type { AssetDims, AssetOptions, AssetPricing, CatalogueVariant } from './asset-types.js';
import type { FinishSlot } from '../materials/asset-finish-catalogue.js';

const free: AssetPricing = { model: 'free' };

export type VariantExtra = {
  version?: string;
  tags?: readonly string[];
  dims?: AssetDims;
  options?: AssetOptions;
  pricing?: AssetPricing;
};

/**
 * One catalogue variant; `1.0.0` and `free` are the defaults so the data stays
 * readable. `id` is the variant's fixed UUID (`VARIANT.<slug>`,
 * `catalogue-ids.ts`) and `slug` its display-only readable name.
 */
export const v = (
  id: string,
  slug: string,
  name: string,
  finishes: Partial<Record<FinishSlot, string>>,
  extra: VariantExtra = {},
): CatalogueVariant => ({
  id,
  slug,
  name,
  version: extra.version ?? '1.0.0',
  finishes,
  ...(extra.tags ? { tags: extra.tags } : {}),
  ...(extra.dims ? { dims: extra.dims } : {}),
  ...(extra.options ? { options: extra.options } : {}),
  pricing: extra.pricing ?? free,
});
