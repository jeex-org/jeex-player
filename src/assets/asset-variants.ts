/**
 * The variant list the UI works with, projected from the object bank.
 *
 * `asset-catalogue.ts` owns the manifest; this module is the small, stable
 * surface the replace panel and the debug hooks consume, so the panel never
 * has to know about manifests, pricing tiers or finish slots.
 *
 * Pure TypeScript - no `three`, no DOM. Invariant of the BUNDLED bank: every
 * archetype exposes exactly four variants, and the first is the standard look
 * the scene ships. A project library brings as many as it has.
 */

import type { DemoAsset } from '../scene/types.js';
import { findCatalogueEntry } from './asset-catalogue.js';
import type { CatalogueLookup, CatalogueMatch, ResolvableObject, ResolvableVariant } from './asset-resolver.js';
import type { VariantAccess } from './asset-types.js';
import { finishColour } from '../materials/asset-finish-catalogue.js';
import type { ProjectMaterial } from '../materials/finish-types.js';

export type AssetVariant = {
  id: string;
  name: string;
  /** Archetype the variant belongs to. */
  archetypeId: string;
  tags: readonly string[];
  pricing: 'free' | 'subscription' | 'premium';
  /** Slot -> finish id, for callers that want to explain a variant. */
  finishes: Record<string, string>;
  /** Base colours of those finishes - the chip shown when no render is available. */
  swatch: string[];
  /**
   * Picture the CONTENT declares, already absolute: a catalogue service's
   * public preview address or a file of the bake's folder. The bundled bank
   * declares none, so a shipped archetype leaves it absent and is rendered
   * exactly as before.
   */
  preview?: string;
  /**
   * The variant's access level, as the CONTENT declared it.
   *
   * Carried and never judged: which of the three a workspace may place is the
   * host's decision, and no access rule lives in the viewer.
   */
  access?: VariantAccess;
  /** Whether the host's workspace may place it, as the host decided. Carried, never judged. */
  allowed?: boolean;
};

/**
 * The bank a placement's variants are offered from, injected.
 *
 * A viewer drawing a baked project has TWO banks: the project's own library,
 * which is data that arrived over the network, and the bundled
 * `interiorLibrary`, which is a module. `catalogue` answers first and the
 * bundled bank stands behind it, so an archetype that exists only in the project
 * library gets a Replace list at all while a scene that still names bank ids keeps
 * the one it always had. On an id collision the PROJECT wins: it is the entry
 * whose GLB is actually loaded.
 *
 * `previewUrl` turns one entry's `preview` into an address, because resolving
 * a relative path needs the manifest folder and this module has no idea what a
 * folder is (`assets/project-catalogue.ts` owns both).
 */
export type VariantBank = {
  readonly catalogue: CatalogueLookup;
  readonly previewUrl?: ((asset: { readonly preview?: string | undefined }) => string | undefined) | undefined;
  /** The project's own materials, in manifest order: its library materials are offered first on a room surface. */
  readonly materials?: readonly ProjectMaterial[] | undefined;
};

function project(object: ResolvableObject, variant: ResolvableVariant, bank?: VariantBank): AssetVariant {
  const finishes: Record<string, string> = {};
  for (const slot of object.slots) {
    const id = variant.finishes?.[slot] ?? object.defaultFinishes[slot];
    if (id) finishes[slot] = id;
  }
  const swatch: string[] = [];
  for (const id of Object.values(finishes)) {
    const colour = finishColour(id);
    if (colour && !swatch.includes(colour)) swatch.push(colour);
  }
  const preview = bank?.previewUrl?.(variant);
  return {
    id: variant.id,
    name: variant.name,
    archetypeId: object.id,
    tags: variant.tags ? [...object.tags, ...variant.tags] : object.tags,
    pricing: variant.pricing.model,
    finishes,
    swatch,
    // Spread rather than assigned: under `exactOptionalPropertyTypes` an
    // explicit `undefined` is a DIFFERENT value from an absent key, and a
    // shipped archetype must leave all three absent.
    ...(preview === undefined ? {} : { preview }),
    ...(variant.access === undefined ? {} : { access: variant.access }),
    ...(variant.allowed === undefined ? {} : { allowed: variant.allowed }),
  };
}

/**
 * The entry an id names, project first and the bundled bank behind it.
 *
 * The merge lives here rather than at either bank, because it is the UI's
 * question: `findCatalogueEntry` is the bundled index and a `VariantBank`'s
 * lookup is whatever the loaded document brought. `projectCatalogue` already
 * layers the same way for the RENDER path, so a project bank asked here
 * answers the same entry the loader draws — and asking the bundled bank again
 * behind it costs one map lookup and covers a bank the caller built from a
 * library alone.
 */
function entryFor(idOrType: string, bank?: VariantBank): CatalogueMatch | null {
  return bank?.catalogue(idOrType) ?? findCatalogueEntry(idOrType) ?? null;
}

/**
 * Variants of one archetype. Accepts an archetype UUID, a concrete variant
 * UUID, or a legacy `DemoAsset.type` word (`'sofa'`) - so a placement that
 * names only a type still gets a full replace panel.
 */
export function variantsForType(idOrType: string, bank?: VariantBank): AssetVariant[] {
  const entry = entryFor(idOrType, bank);
  if (!entry) return [];
  return entry.object.variants.map((variant) => project(entry.object, variant, bank));
}

/**
 * Variants offered for a placement, whichever way it names its asset.
 *
 * `bank` is the loaded project's, or absent for a bare scene. Without it this
 * is the bundled library alone — exactly what it always was — which is why a
 * scene the viewer ships behaves identically.
 */
export function variantsForPlacement(placement: DemoAsset, bank?: VariantBank): AssetVariant[] {
  return variantsForType(placement.asset ?? placement.type, bank);
}

/** The variant a placement shows before anyone swaps it. */
export function activeVariantFor(placement: DemoAsset, bank?: VariantBank): string | null {
  if (placement.variant) return placement.variant;
  const entry = entryFor(placement.asset ?? placement.type, bank);
  if (!entry) return null;
  return entry.variantId ?? entry.object.defaultVariant;
}
