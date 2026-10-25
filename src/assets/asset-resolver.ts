/**
 * Resolves a scene placement against the object bank into one concrete,
 * buildable asset.
 *
 * Pure TypeScript - no `three`, no DOM. Invariant: resolution never throws; an
 * unknown library, asset or variant comes back as a typed failure so the viewer
 * can degrade to a placeholder instead of dropping the object.
 *
 * Layers, in order of increasing priority:
 *   1. archetype defaults (`dims`, `defaultFinishes`, `options`)
 *   2. the selected variant (size / colour / upholstery - the documented axes)
 *   3. the placement's own `finishes` overrides and the `material` shortcut
 */

import { effectiveAsset } from '../scene/types.js';
import type { DemoAsset, MirrorFacts } from '../scene/types.js';
import type { AssetDims, AssetOptions, AssetPricing, CatalogueObject, CatalogueVariant } from './asset-catalogue.js';
import { DEFAULT_LIBRARY, findCatalogueEntry } from './asset-catalogue.js';
import { assetRefOf } from '../scene/registries.js';
import { resolveFinishId } from './asset-finishes.js';
import { surfacesAt, type LampLight, type SlotFinishes, type SlotName, type SurfaceFacts, type VariantAccess } from './asset-types.js';

/**
 * One VARIANT as the resolver reads it: a catalogue variant that may carry a
 * GLB of its own. The bank's display-only `slug` is not part of it: a baked
 * project's variants have none and the resolver reads no name.
 *
 * A baked project writes `obj/<versionId>.glb` per variant version, because
 * the unit of geometry is the variant (`assets/project-manifest.ts`), and the
 * shipped bank writes none — so the field is optional here and the archetype's
 * own `model` is the fallback.
 */
export type ResolvableVariant = Omit<CatalogueVariant, 'slug' | 'finishes'> & {
  /** Open slot names: a baked asset's parts are not `FinishSlot`s. */
  readonly finishes?: SlotFinishes;
  readonly model?: string;
  /**
   * Picture the CONTENT declares for this variant: a path relative to its
   * library's folder, or a catalogue service's public preview address.
   * Resolved to an absolute URL by `assets/project-catalogue.ts` and preferred
   * over the viewer's own render (`ui/selection-options.ts`).
   */
  readonly preview?: string;
  /** The variant's access level as the content declares it; carried, never judged. */
  readonly access?: VariantAccess;
  /** Whether the host's workspace may place it; carried, never judged. */
  readonly allowed?: boolean;
};

/**
 * One ARCHETYPE as the resolver reads it: `CatalogueObject` with `builder`
 * optional.
 *
 * The shipped bank always has a builder and a baked project never does
 * (`ProjectObject`), and both are resolved by the same function, so
 * the widest of the two is what the resolver declares. Nothing is loosened for
 * the catalogue itself: `CatalogueObject.builder` stays required, and a bake
 * carrying one is still refused by `project-manifest.schema.ts`.
 */
export type ResolvableObject = Omit<CatalogueObject, 'slug' | 'builder' | 'variants' | 'slots' | 'defaultFinishes' | 'primarySlot'> & {
  readonly builder?: string;
  /** Open slot names (`SlotName`); the shipped bank's are `FinishSlot`s, a bake's may be anything. */
  readonly slots: readonly SlotName[];
  readonly defaultFinishes: SlotFinishes;
  readonly primarySlot: SlotName;
  readonly variants: readonly ResolvableVariant[];
};

/** What a bank answers when a reference resolves: the archetype, and what the bank knew about the ask. */
export type CatalogueMatch = {
  readonly object: ResolvableObject;
  /** Variant the id itself named, when the id was a variant's rather than an archetype's. */
  readonly variantId?: string | undefined;
  /** Extra facing compensation a legacy `type` alias carries, radians. */
  readonly yaw?: number | undefined;
};

/**
 * The bank a placement is resolved against: `findCatalogueEntry`'s own shape,
 * injected.
 *
 * The shipped catalogue is a module and a PROJECT's library is data that
 * arrived over the network, so the lookup is a parameter rather than an
 * import — which is also what lets `asset-loader.ts` resolve a placement
 * against the bake it is drawing without the resolver knowing what a bake is.
 */
export type CatalogueLookup = (assetId: string) => CatalogueMatch | null | undefined;

/** Keeps a finish UUID the bank knows, or drops it: `resolveFinishId` for the shipped bank, wider for a project. */
export type FinishIdResolver = (id: string | undefined) => string | undefined;

export type ResolvedAsset = {
  /** Placement id from the scene. */
  placementId: string;
  /** The library the archetype was resolved in: the built-in bank's id, or a library UUID. */
  library: string;
  archetypeId: string;
  variantId: string;
  variantName: string;
  version: string;
  category: string;
  tags: readonly string[];
  /**
   * `[width, height, depth]` in metres, after size variants. For a ceiling
   * anchor the height is the hanging drop, already clamped to the room.
   */
  dims: AssetDims;
  anchor: CatalogueObject['anchor'];
  wallSnap: boolean;
  clearance: number;
  /** World Y the group is placed at - the ceiling plane for ceiling anchors. */
  mountY: number;
  scale: number;
  /** Extra yaw the placement needs, radians - non-zero only for legacy `type` ids. */
  yaw: number;
  /** Procedural builder id; absent for a project object, which is GLB-only. */
  builder?: string | undefined;
  options: AssetOptions;
  finishes: Record<string, string>;
  pricing: AssetPricing;
  /** glTF/GLB path relative to the library `baseUrl`, when the library ships one. */
  model?: string | undefined;
  /** Slot -> glTF material name overrides for that model (`CatalogueObject.materialSlots`). */
  materialSlots?: Readonly<Record<string, string>> | undefined;
  lods?: readonly string[] | undefined;
  /**
   * The variant's GLB renders with the materials it shipped: nothing is
   * swapped by slot and nothing is reported unbound (`isBakedVariant`). It
   * governs GLB material replacement only, not the light bake. Absent means
   * not baked.
   */
  baked?: boolean | undefined;
  /** Mirror axes the archetype allows (`CatalogueObject.mirror`); absent allows none. */
  mirrorFacts?: MirrorFacts | undefined;
  /** Surfaces and tucking at this variant's size; `{}` for none. */
  surfaceFacts?: SurfaceFacts | undefined;
  /** The variant's lamp lights, in its model frame; absent when it emits none (every bank variant). */
  lights?: readonly LampLight[] | undefined;
};

export type ResolveFailure = {
  placementId: string;
  reason: 'unknown-library' | 'unknown-asset' | 'unknown-variant';
  detail: string;
};

export type ResolveResult = { asset: ResolvedAsset } | { failure: ResolveFailure };

export function isResolved(result: ResolveResult): result is { asset: ResolvedAsset } {
  return 'asset' in result;
}

/**
 * Whether a variant renders with the materials its GLB ships, never re-dressed
 * by slot: it has a GLB (its own `model` or the archetype's) and EITHER its
 * archetype has no builder OR no finish is declared on either layer.
 *
 * A builder-less GLB is the whole product (every project object, by format):
 * the finishes it declares describe it and stay in `ResolvedAsset.finishes`,
 * but they never replace a material of its GLB, and neither do a placement's
 * `finishes` or `material`, and its `materialSlots` bind nothing. A GLB
 * served for an archetype WITH a builder keeps the slot dressing
 * (`materialSlots` and the name convention) unless it declares no finish at
 * all. Decided from the record's fields, never from the
 * shape of an id or from which bank answered.
 */
export function isBakedVariant(object: ResolvableObject, variant: ResolvableVariant): boolean {
  if ((variant.model ?? object.model) === undefined) return false;
  if (object.builder === undefined) return true;
  const declares = (finishes: SlotFinishes | undefined): boolean =>
    Object.values(finishes ?? {}).some((id) => typeof id === 'string' && id.length > 0);
  return !declares(object.defaultFinishes) && !declares(variant.finishes);
}

function pickVariant(object: ResolvableObject, requested: string | undefined): ResolvableVariant | undefined {
  const wanted = requested ?? object.defaultVariant;
  return object.variants.find((variant) => variant.id === wanted);
}

/**
 * Merges the finish layers into a `slot -> finish id` map. Unknown ids are
 * dropped, so a bad override degrades to the archetype default rather than to
 * an untextured object.
 */
export function mergeFinishes(
  object: ResolvableObject,
  variant: ResolvableVariant,
  overrides: Record<string, string> | undefined,
  legacyMaterial: string | undefined,
  resolveId: FinishIdResolver = resolveFinishId,
): Record<string, string> {
  const merged: Record<string, string> = {};
  const assign = (slot: string, id: string | undefined): void => {
    const resolved = resolveId(id);
    if (resolved) merged[slot] = resolved;
  };
  for (const slot of object.slots) assign(slot, object.defaultFinishes[slot]);
  for (const [slot, id] of Object.entries(variant.finishes ?? {})) assign(slot, id);
  if (legacyMaterial) assign(object.primarySlot, legacyMaterial);
  for (const [slot, id] of Object.entries(overrides ?? {})) assign(slot, id);
  // A slot left unresolved everywhere falls back to the archetype default id, so
  // the registry can still hand back a neutral material rather than nothing.
  for (const slot of object.slots) {
    if (merged[slot]) continue;
    const fallback = object.defaultFinishes[slot];
    if (fallback) merged[slot] = fallback;
  }
  return merged;
}

/** Ceiling height assumed when a caller resolves an asset outside a scene (gallery, tests). */
export const DEFAULT_CEILING_HEIGHT = 2.7;

/** Headroom kept clear under the lowest point of a hanging fixture, metres. */
export const HANGING_HEADROOM = 1.55;

/** Shortest a hanging fixture may be squeezed to before it stops reading as a pendant. */
export const MIN_HANGING_DROP = 0.18;

/**
 * Hanging drop of a ceiling fixture, measured from the ceiling plane down to
 * the bottom of the shade, clamped so the room keeps `HANGING_HEADROOM` under
 * it. A pendant authored for a 3.15 m ceiling therefore shortens itself in a
 * 2.65 m room instead of hanging into the walkway - and a fixture never pokes
 * through the ceiling, because the drop is measured from it, never from y = 0.
 */
export function clampHangingDrop(requested: number, ceilingHeight: number): number {
  const room = ceilingHeight - HANGING_HEADROOM;
  if (!Number.isFinite(room) || room <= MIN_HANGING_DROP) return MIN_HANGING_DROP;
  return Math.max(MIN_HANGING_DROP, Math.min(requested, room));
}

/**
 * World Y a placement's group sits at. Ceiling anchors ride the scene's
 * ceiling; everything else uses the authored height verbatim. An explicit
 * non-zero `position.y` always wins, so a scene can still hang a fixture low.
 */
export function mountHeightFor(anchor: CatalogueObject['anchor'], positionY: number, ceilingHeight: number): number {
  if (anchor !== 'ceiling') return positionY;
  return positionY > 0 ? positionY : ceilingHeight;
}

export type ResolveOptions = {
  defaultLibrary?: string;
  /** Ceiling height of the scene, metres - drives ceiling-anchored fixtures. */
  ceilingHeight?: number;
  /**
   * The bank to resolve against. Absent means the SHIPPED catalogue, and with
   * it the shipped library id: a reference naming any other library is
   * `unknown-library`, exactly as before. Present, the accepted library is
   * `defaultLibrary` — the document's own `assetLibrary`, which is what a
   * baked project's placements belong to.
   */
  catalogue?: CatalogueLookup | undefined;
  /**
   * The library id the injected `catalogue` answers for — a baked project's
   * `library.id`. A placement that names it in its own `library` is accepted
   * next to `defaultLibrary`, as the validator's registries accept it
   * (`registriesFromLibrary`), whether or not the document says `assetLibrary`.
   */
  catalogueLibrary?: string | undefined;
  /**
   * More library ids the injected `catalogue` answers for, accepted the same
   * way: a layered bank's project and offers libraries (`library-stack.ts`).
   */
  catalogueLibraries?: readonly string[] | undefined;
  /** Which finish UUIDs survive; the shipped bank's own resolver when absent. */
  resolveFinish?: FinishIdResolver | undefined;
};

/**
 * Resolves one scene placement against the object bank.
 *
 * A placement names either `asset` (a bare UUID, with its `library` when it
 * names one) or the legacy `type`. Legacy placements pick up the alias' facing compensation and
 * deliberately ignore `material`: the pre-bank loader never read it, so
 * honouring it now would repaint scenes that look correct today.
 */
export function resolveAsset(placement: DemoAsset, options: ResolveOptions = {}): ResolveResult {
  const defaultLibrary = options.defaultLibrary ?? DEFAULT_LIBRARY;
  const ceilingHeight = options.ceilingHeight ?? DEFAULT_CEILING_HEIGHT;
  const legacy = !placement.asset;
  const ref = assetRefOf(placement, defaultLibrary);
  const lookup = options.catalogue ?? findCatalogueEntry;
  // With an injected bank the library a reference may name is the document's
  // own or the bank's; without one it is the shipped library, as it always was.
  const accepted = options.catalogue
    ? [defaultLibrary, options.catalogueLibrary, ...(options.catalogueLibraries ?? [])]
    : [DEFAULT_LIBRARY];
  if (!accepted.includes(ref.library)) {
    return { failure: { placementId: placement.id, reason: 'unknown-library', detail: ref.library } };
  }
  const entry = lookup(ref.assetId);
  if (!entry) return { failure: { placementId: placement.id, reason: 'unknown-asset', detail: ref.assetId } };
  const { object } = entry;
  const requested = placement.variant ?? entry.variantId;
  const variant = pickVariant(object, requested);
  if (!variant) {
    return { failure: { placementId: placement.id, reason: 'unknown-variant', detail: requested ?? object.defaultVariant } };
  }
  const authored = variant.dims ?? object.dims;
  // For a ceiling anchor the "height" is the drop, so it is the room that bounds it.
  const dims: AssetDims = object.anchor === 'ceiling' ? [authored[0], clampHangingDrop(authored[1], ceilingHeight), authored[2]] : authored;
  return {
    asset: {
      placementId: placement.id,
      library: ref.library,
      archetypeId: object.id,
      variantId: variant.id,
      variantName: variant.name,
      version: variant.version,
      category: object.category,
      tags: variant.tags ? [...object.tags, ...variant.tags] : object.tags,
      dims,
      anchor: object.anchor,
      wallSnap: object.wallSnap,
      clearance: object.clearance,
      mountY: mountHeightFor(object.anchor, placement.position.y, ceilingHeight),
      scale: effectiveAsset(placement).scale,
      yaw: entry.yaw ?? 0,
      ...(object.builder !== undefined && { builder: object.builder }),
      options: { ...object.options, ...variant.options },
      finishes: mergeFinishes(object, variant, placement.finishes, legacy ? undefined : placement.material, options.resolveFinish),
      pricing: variant.pricing,
      // The VARIANT's own GLB first: a bake writes one file per variant, and
      // the archetype's `model` is what a library with a single mesh declares.
      model: variant.model ?? object.model,
      materialSlots: object.materialSlots,
      lods: object.lods,
      baked: isBakedVariant(object, variant),
      mirrorFacts: object.mirror,
      surfaceFacts: surfacesAt(object, object.dims, dims),
      ...(variant.lights !== undefined && { lights: variant.lights }),
    },
  };
}

/**
 * Reads a numeric builder option with a default.
 *
 * The one reader left outside `asset-options.ts`, for the one option in the
 * bank whose default depends on the archetype's own dimensions
 * (`buildMediaUnit`'s `screen`). Everything else declares its options as a
 * spec and reads them with `readOptions`, so this module keeps no boolean or
 * string reader.
 */
export function optionNumber(options: AssetOptions, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
