/**
 * What the scene layer needs to look up, declared as an INTERFACE the scene
 * layer owns rather than as imports of the catalogues themselves.
 *
 * The scene layer validates references — a finish, a catalogue archetype, a
 * variant — and validating a reference needs the registry that owns it. Reading
 * that registry by importing it makes `scene/` depend on `materials/` and
 * `assets/`, two layers ABOVE it, and it also makes the
 * validator untestable against anything but the shipped catalogues.
 *
 * So the shape lives here and the values arrive from outside. Every member is
 * the narrowest thing the scene layer actually asks: `isSurfaceFinish` is a
 * yes/no question, not a `Finish`; `findCatalogueEntry` answers with the two
 * fields the validator reads and nothing else. The real catalogue functions
 * satisfy these structurally, so the composition root hands them over
 * unwrapped — which is also why the two lookups answer `null | undefined`:
 * "not found" is what the scene layer asks, and an adapter that normalised the
 * two spellings would be a module whose only job is to please a type.
 *
 * Pure module: no `three`, no DOM.
 */

import { isDoorLike, type DemoAsset, type MaterialDefinition, type MirrorFacts, type OpeningType } from './types.js';

/** Which family of opening a variant was built for. */
export type OpeningVariantFamily = 'window' | 'door';

/** What the scene layer reads of a catalogue variant: the id a placement names. */
export type CatalogueVariantRef = { readonly id: string };

/**
 * One entry of the opening-variant bank as an EDITOR reads it: the id
 * `replace_opening_variant` takes and the label a `<select>` shows.
 *
 * Without it an editor's openings panel offers a text field for a variant id
 * and finds out at apply time whether it exists. The rest of what a variant is
 * — frame sections, glazing, leaf style, the preview swatch — belongs to
 * `assets/opening-variants.ts` and stays there; this is the two fields a
 * chooser needs, and it stays free of a canvas so a host can build the list
 * server-side.
 */
export type OpeningVariantOption = {
  readonly id: string;
  readonly name: string;
  readonly for: OpeningVariantFamily;
  /** True for the entrance-door sets, which are offered apart from interior doors. */
  readonly entrance?: boolean;
};

/** What the scene layer reads of a catalogue archetype: its id, its variants and where it sits. */
export type CatalogueArchetype = {
  readonly id: string;
  readonly variants: readonly CatalogueVariantRef[];
  /** Variant a placement shows when it names none; the first variant when absent. */
  readonly defaultVariant?: string;
  /**
   * Where the archetype's origin belongs: `'floor'` stands on the floor,
   * `'wall'` hangs on a face, `'ceiling'` drops from above. Absent means
   * `'floor'`, which is what the overwhelming majority of a bank is.
   *
   * The scene layer reads it for ONE decision — `place_object` and
   * `move_object` force a floor-standing object's `y` to 0, and
   * would otherwise have to guess from the number the editor sent. The rest of
   * what an anchor means (snapping, mounting heights, the wall-hung layout
   * rules) belongs to `assets/` and `layout/` and stays there.
   */
  readonly anchor?: 'floor' | 'wall' | 'ceiling';
  /** Which axes `mirror_object` may set; absent allows none. */
  readonly mirror?: MirrorFacts | undefined;
};

/** One object bank, keyed the way a reference reaches it: by its library id, then by the bare asset UUID. */
export type LibraryCatalogue = {
  readonly id: string;
  /** Archetypes by their own id. A variant id is resolved by the owning registries. */
  readonly objects: ReadonlyMap<string, CatalogueArchetype>;
};

/** What a placement resolves to: the archetype it names and the variant it shows. */
export type CataloguePlacement = { readonly object: CatalogueArchetype; readonly variant: CatalogueVariantRef };

/** A catalogue reference: the library that owns it and the bare id inside that library. */
export type AssetRef = { readonly library: string; readonly assetId: string };

/**
 * The fields of a placement a reference is built from. A `place_object`
 * operation, which has no legacy `type`, passes its `asset` as the type.
 */
export type AssetRefFields = { readonly type: string; readonly asset?: string | undefined; readonly library?: string | undefined };

export type SceneRegistries = {
  /** True when the id names a finish that can be painted on a room surface. */
  readonly isSurfaceFinish: (id: string | undefined) => boolean;
  /**
   * True when the id names a finish of the SURFACE catalogue.
   *
   * The same question as `isSurfaceFinish` today; separate because the two
   * callers ask it for different reasons — the validator asks whether a
   * document's reference resolves, `set_material` asks whether an operation
   * may name it — and a future catalogue split would answer them differently.
   */
  readonly isFinish: (id: string) => boolean;
  /** Variants a placement may be replaced with, in offering order. */
  readonly variantsForPlacement: (asset: DemoAsset) => readonly { readonly id: string }[];
  /** Which surface family a finish id belongs to, or `null` when it is unknown. */
  readonly finishKind: (id: string) => 'floor' | 'wall' | null;
  /** True when the id resolves in any catalogue, the scene's own overrides included. */
  readonly isKnownFinish: (id: string | undefined, sceneMaterials: readonly MaterialDefinition[]) => boolean;
  /**
   * Every object bank these registries can resolve a reference against, by id.
   *
   * A document's `assetLibrary`, and a placement's `library`, has to be one of
   * these: the validator checks a placement against the bank that owns it, so
   * a library nobody declared is a reference nothing can prove. `CATALOGUE_REGISTRIES` carries
   * the shipped library alone; `registriesFromLibrary` adds a project's own.
   */
  readonly libraries: ReadonlyMap<string, LibraryCatalogue>;
  /**
   * The library a reference belongs to when neither the placement nor the
   * document names one. For the shipped registries it is the built-in bank's
   * own id, which is code vocabulary and never written into a document.
   */
  readonly defaultLibrary: string;
  /**
   * The archetype and the concrete variant a placement shows, or `undefined`.
   *
   * A placement without `library` is read against `defaultLibrary`, which is
   * what the scene layer can know from a placement alone — the document's own
   * `assetLibrary` is the validator's business, and the validator resolves
   * references itself.
   */
  readonly resolvePlacement: (asset: DemoAsset) => CataloguePlacement | undefined;
  /**
   * The catalogue entry for a bare asset UUID, or a furniture type word through
   * the alias table, or `null`. The two never collide: a UUID is not a word.
   */
  readonly findCatalogueEntry: (assetId: string) => { readonly object: CatalogueArchetype } | null | undefined;
  /** The opening variant with that id, or `null`. */
  readonly findOpeningVariant: (id: string) => { readonly for: OpeningVariantFamily } | null | undefined;
  /** Which variant family an opening of this type takes. */
  readonly variantFamily: (type: OpeningType) => OpeningVariantFamily;
  /**
   * Every variant an opening of this type may be given, in offering order.
   *
   * The list side of `findOpeningVariant`: an editor building a chooser needs
   * to know what exists BEFORE the user picks, and
   * asking the registries is what keeps the bank injected rather than imported.
   * A doorway asks with `{ entrance: true }` for the entrance sets.
   */
  readonly openingVariantsOf: (type: OpeningType, options?: { entrance?: boolean }) => readonly OpeningVariantOption[];
  /**
   * Floor finish a room that names none starts on, or `undefined` when the
   * registries declare no finish at all.
   *
   * `add_room` has to write SOME `floorMaterial` (`Room.floorMaterial` is not
   * optional), and the answer cannot be a catalogue id written into the scene
   * layer: registries built from a project library that never heard of `oak`
   * would have the validator refuse the room the operation just made. So the
   * bank says what its own default is, and `add_room` refuses outright when
   * there is none.
   */
  readonly defaultFloorFinish: string | undefined;
};

/* ------------------------------------------------- reading a reference --- */

/**
 * The reference a placement names, built from its FIELDS: `asset` (else the
 * legacy `type` word) is the id, `library` the library, and a placement that
 * names no library belongs to `defaultLibrary` — the document's
 * `assetLibrary` when the caller knows the document, the registries' own
 * default otherwise.
 *
 * Nothing is parsed out of a string: since schema 2.2 a reference is two
 * fields and an id is never composed from another id. The rule lives here
 * rather than in the object bank because it is the SCENE document's.
 */
export function assetRefOf(fields: AssetRefFields, defaultLibrary: string): AssetRef {
  return { library: fields.library ?? defaultLibrary, assetId: fields.asset ?? fields.type };
}

/**
 * The library UUID a placement's `asset` belongs to AS THE DOCUMENT SAYS IT:
 * its own `library`, else the document's `assetLibrary`; `undefined` for a
 * placement of the built-in bank (which has no UUID) and for one that names no
 * `asset`. What an export or a renderer tag may write — never the built-in
 * bank's vocabulary id.
 */
export function documentLibraryOf(
  placement: { readonly asset?: string | undefined; readonly library?: string | undefined },
  sceneLibrary: string | undefined,
): string | undefined {
  return placement.asset === undefined ? undefined : (placement.library ?? sceneLibrary);
}

/**
 * The archetype a parsed reference names, or `undefined`.
 *
 * A named library answers first, from `libraries`, where an entry is exactly
 * what its manifest declared. What it cannot answer goes to
 * `findCatalogueEntry`, the registries' own lookup, which knows two things a
 * plain map does not: a variant id stands for its archetype, and a legacy
 * `DemoAsset.type` has an alias — and which, for registries built over a base,
 * is the manifest layered on the shipped bank (`registriesFromLibrary`).
 *
 * That fallback is the contract: two entrances, one validator, and the shipped
 * bank behind the project's own until the builders are removed. It stops at a
 * library NOBODY declared — a reference into one is still a reference nothing
 * can prove, and the validator reports it as such.
 */
export function findArchetype(registries: SceneRegistries, ref: AssetRef): CatalogueArchetype | undefined {
  if (ref.library !== registries.defaultLibrary) {
    const declared = registries.libraries.get(ref.library);
    if (!declared) return undefined;
    const object = declared.objects.get(ref.assetId);
    if (object) return object;
  }
  return registries.findCatalogueEntry(ref.assetId)?.object;
}

/**
 * `resolvePlacement` over any registries: the one implementation both
 * composition roots hand over, so "which variant does this placement show" is
 * answered in a single place.
 */
export function placementIn(registries: SceneRegistries, asset: DemoAsset): CataloguePlacement | undefined {
  const object = findArchetype(registries, assetRefOf(asset, registries.defaultLibrary));
  if (!object) return undefined;
  const wanted = asset.variant ?? object.defaultVariant;
  const named = wanted === undefined ? undefined : object.variants.find((candidate) => candidate.id === wanted);
  const variant = named ?? object.variants[0];
  return variant === undefined ? undefined : { object, variant };
}

/* ------------------------------------------- registries from a manifest --- */

/**
 * What `registriesFromLibrary` reads of a library finish: its id and which
 * surfaces it may dress (the manifest's `apply`, the same word
 * `materials/asset-finish-catalogue.FinishDefinition` uses).
 */
export type LibraryFinish = {
  readonly id: string;
  readonly apply?: readonly ('floor' | 'wall' | 'furniture' | 'fabric' | 'metal' | 'glass' | 'decor')[];
};

/**
 * A library as these registries read it: the library manifest fields the scene
 * layer needs, plus the finishes a PROJECT library ships with its objects.
 *
 * It is declared here rather than imported because
 * `assets/asset-types.LibraryManifest` sits two layers above the scene layer; a
 * manifest satisfies this type structurally, so `registriesFromLibrary` takes
 * one without an adapter. When the baked-project format lands its own
 * `assets/project-manifest.ts`, that module declares the project library in
 * full and this stays the narrow view of it.
 */
export type ProjectLibrary = {
  readonly id: string;
  readonly objects: readonly CatalogueArchetype[];
  /** Finishes the library ships: `set_material` targets and placement slot finishes. */
  readonly materials?: readonly LibraryFinish[];
};

/** Which surface family a library finish dresses; `null` means an object finish. */
function finishFamilyOf(finish: LibraryFinish): 'floor' | 'wall' | null {
  if (finish.apply?.includes('floor')) return 'floor';
  if (finish.apply?.includes('wall')) return 'wall';
  return null;
}

/**
 * The floor finish a room of this library starts on: its first FLOOR material,
 * else its first material, else nothing.
 *
 * "First floor material" rather than plainly "first material" because the
 * fallback is what `add_room` writes into `Room.floorMaterial`, and a library
 * that happens to list a wall paint first would have the validator refuse the
 * room. A library with no floor material at all still gets an answer — its
 * first material — because a finish the document knows is better than a
 * refusal, and one with no materials gets none.
 */
function defaultFloorOf(library: ProjectLibrary): string | undefined {
  const materials = library.materials ?? [];
  return (materials.find((finish) => finishFamilyOf(finish) === 'floor') ?? materials[0])?.id;
}

/**
 * `SceneRegistries` over one library manifest, optionally layered on a base.
 *
 * WITHOUT a base the manifest is the whole world: it is the default library,
 * its materials are the only finishes, and it declares no opening variants (an
 * opening keeps whatever the document authored). WITH a base the base is the
 * FALLBACK, never a bank beside it — its `defaultLibrary` and its opening
 * variants stand, and everything the manifest declares answers AHEAD of it:
 * one more entry in `libraries`, its materials before the base's finishes, its
 * objects before the base's bank lookup. Nothing of the base is lost, so a
 * document may mix a project object with a legacy `type` placement no
 * exporter rewrote. That pair is what lets an editor host validate a
 * project document against the shipped catalogues AND the project's own
 * library.
 */
export function registriesFromLibrary(library: ProjectLibrary, base?: SceneRegistries): SceneRegistries {
  const objects = new Map<string, CatalogueArchetype>(library.objects.map((object) => [object.id, object]));
  const byVariant = new Map<string, CatalogueArchetype>();
  for (const object of library.objects) for (const variant of object.variants) byVariant.set(variant.id, object);

  // The manifest comes LAST, so a library that re-declares one of the base's
  // replaces the base's catalogue rather than being swallowed by it.
  const own: readonly [string, LibraryCatalogue] = [library.id, { id: library.id, objects }];
  const libraries = new Map<string, LibraryCatalogue>([...(base?.libraries ?? []), own]);

  const families = new Map<string, 'floor' | 'wall' | null>();
  for (const finish of library.materials ?? []) families.set(finish.id, finishFamilyOf(finish));

  const finishKind = (id: string): 'floor' | 'wall' | null => (families.has(id) ? families.get(id)! : (base?.finishKind(id) ?? null));
  const isKnownFinish = (id: string | undefined, sceneMaterials: readonly MaterialDefinition[]): boolean => {
    if (id === undefined) return false;
    if (families.has(id)) return true;
    if (base) return base.isKnownFinish(id, sceneMaterials);
    return sceneMaterials.some((material) => material.id === id);
  };

  const registries: SceneRegistries = {
    isSurfaceFinish: (id) => id !== undefined && finishKind(id) !== null,
    isFinish: (id) => families.has(id) || (base?.isFinish(id) ?? false),
    finishKind,
    isKnownFinish,
    variantsForPlacement: (asset) => placementIn(registries, asset)?.object.variants ?? [],
    libraries,
    defaultLibrary: base?.defaultLibrary ?? library.id,
    resolvePlacement: (asset) => placementIn(registries, asset),
    // The manifest first, the base behind it: a project entry with the same id
    // as a bank entry wins, and an id the project never declared still reaches
    // the shipped bank and its alias table.
    findCatalogueEntry: (assetId) => {
      const object = objects.get(assetId) ?? byVariant.get(assetId);
      if (object !== undefined) return { object };
      return base ? base.findCatalogueEntry(assetId) : null;
    },
    findOpeningVariant: base ? base.findOpeningVariant : () => null,
    variantFamily: base ? base.variantFamily : (type) => (isDoorLike(type) ? 'door' : 'window'),
    openingVariantsOf: base ? base.openingVariantsOf : () => [],
    defaultFloorFinish: base?.defaultFloorFinish ?? defaultFloorOf(library),
  };
  return registries;
}
