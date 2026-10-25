/**
 * The libraries one document is drawn, validated and edited with, layered in
 * ONE order: the project's own library, then the host's `offers`, then the
 * bundled bank.
 *
 * Every consumer asks the stack, never a library of its own choosing, so the
 * renderer, the validator, the Replace panel, the floor questions and the
 * light bake answer an id from the first library that declares it. An id both
 * the project and offers declare is the project's everywhere, which is why the
 * popup offers it under the project library (`replace-offers.ts`). It is
 * built whenever a document has a project or offers, a bare scene included
 * (`app/project-wiring.ts`); without either the bundled bank answers alone,
 * exactly as before.
 *
 * Each library's relative paths resolve against its OWN folder: a model by the
 * archetype that owns it, and an offers preview or texture path rewritten once,
 * here, to the absolute address inside the offers folder (a path that would
 * leave the folder is dropped, as `project-catalogue.ts` drops it). What the
 * project library names keeps resolving against the project folder.
 *
 * Pure module: no `three`, no DOM.
 */

import { findCatalogueEntry } from './asset-catalogue.js';
import { projectAssetFacts, shippedAssetFacts, type AssetFactsSource } from './asset-facts.js';
import type { VariantBank } from './asset-variants.js';
import type { CatalogueLookup, FinishIdResolver } from './asset-resolver.js';
import { CATALOGUE_REGISTRIES } from './catalogue-registries.js';
import { projectCatalogue, projectFinishResolver, projectModelUrl, projectPreviewUrl } from './project-catalogue.js';
import { libraryOf, type ProjectLibraryManifest } from './project-manifest.js';
import type { LibraryMap, ProjectMaterial } from '../materials/finish-types.js';
import { projectFinishes } from '../materials/project-finishes.js';
import type { Finish } from '../materials/finish-catalogue.js';
import { registriesFromLibrary, type SceneRegistries } from '../scene/registries.js';

/** One library and the absolute folder URL its relative paths resolve against, trailing slash included. */
export type LibraryLayer = { readonly library: ProjectLibraryManifest; readonly baseUrl: string };

/** Everything the viewer reads of the libraries one document is drawn with. */
export type LibraryStack = {
  /** The project's objects, then the offers, then the bundled bank, by archetype or variant id. */
  readonly catalogue: CatalogueLookup;
  /** The library ids a placement may name beside the document's own: the project's, then the offers'. */
  readonly libraries: readonly string[];
  /** A finish id the project or the offers declare passes through; anything else falls back to the bundled bank. */
  readonly resolveFinish: FinishIdResolver;
  /** The project's materials, then the offers' (their texture paths already inside the offers folder). */
  readonly materials: readonly ProjectMaterial[];
  /** Room-surface finishes over `materials`, the bundled catalogue behind them. */
  readonly findFinish: (id: string) => Finish | null;
  /** An object's model resolved against the folder of the library that owns it; `undefined` for a bundled entry. */
  readonly modelUrl: (asset: { readonly archetypeId: string; readonly model?: string | undefined }) => string | undefined;
  /** What the Replace panel, `describeSelection` and the popup offer. */
  readonly variants: VariantBank;
  /** Floor questions, in the same order. */
  readonly facts: AssetFactsSource;
  /** The registries a document is validated and edited against, in the same order. */
  readonly registries: SceneRegistries;
  /** The offers layer, as it is offered (paths rebased), or `null`. */
  readonly offers: LibraryLayer | null;
};

/** `path` inside `folder`, or `undefined` when it would leave it (the rule `project-catalogue.ts` applies). */
function inside(path: string, folder: string): string | undefined {
  try {
    const resolved = new URL(path, folder);
    return resolved.href.startsWith(new URL(folder).href) ? resolved.href : undefined;
  } catch {
    return undefined;
  }
}

/** A library map whose files are addressed inside `folder`. */
function rebaseMap(map: LibraryMap, folder: string): LibraryMap {
  const files: Record<string, string> = {};
  for (const [size, path] of Object.entries(map.files)) {
    const url = path === undefined ? undefined : inside(path, folder);
    if (url !== undefined) files[size] = url;
  }
  return { ...map, files };
}

/** A material whose texture paths are addressed inside `folder`, so one texture source serves both folders. */
function rebaseMaterial(material: ProjectMaterial, folder: string): ProjectMaterial {
  if ('pbr' in material) {
    const albedo = inside(material.pbr.albedo, folder) ?? material.pbr.albedo;
    const normal = material.pbr.normal === undefined ? undefined : inside(material.pbr.normal, folder);
    const { normal: _normal, ...pbr } = material.pbr;
    return { ...material, pbr: { ...pbr, albedo, ...(normal === undefined ? {} : { normal }) } };
  }
  if ('library' in material) {
    const maps: Record<string, LibraryMap> = {};
    for (const [role, map] of Object.entries(material.library.maps)) if (map !== undefined) maps[role] = rebaseMap(map, folder);
    return { ...material, library: { ...material.library, maps } };
  }
  return material;
}

/** A preview addressed inside `folder`, or absent. */
function rebasePreview<T extends { readonly preview?: string | undefined }>(entry: T, resolve: (asset: T) => string | undefined): T {
  if (entry.preview === undefined) return entry;
  const preview = resolve(entry);
  const { preview: _preview, ...rest } = entry;
  return (preview === undefined ? rest : { ...rest, preview }) as T;
}

/**
 * The offers library as it is offered: its previews and texture paths
 * absolute inside its folder. Models stay relative and are resolved by the
 * archetype that owns them (`modelUrl`), the way the project's are.
 */
function rebasedOffers(layer: LibraryLayer): LibraryLayer {
  const preview = projectPreviewUrl(layer.baseUrl);
  const library = layer.library;
  return {
    baseUrl: layer.baseUrl,
    library: {
      ...library,
      objects: library.objects.map((object) => ({
        ...rebasePreview(object, preview),
        variants: object.variants.map((variant) => rebasePreview(variant, preview)),
      })),
      materials: library.materials.map((material) => rebaseMaterial(material, layer.baseUrl)),
    },
  };
}

/**
 * The stack for a document: `project` and `offers` are each optional.
 *
 * An offers library whose id is the project's is the caller's to refuse
 * (`app/project-wiring.ts` does, with `offers-invalid`); here the two are
 * assumed distinct.
 */
export function libraryStack(project: LibraryLayer | null, offersLayer: LibraryLayer | null): LibraryStack {
  const offers = offersLayer === null ? null : rebasedOffers(offersLayer);
  const layers = [project, offers].filter((layer): layer is LibraryLayer => layer !== null);
  // ONE lookup instance, built from the bottom up: the render path and the
  // panels answer the same entry for the same id.
  let catalogue: CatalogueLookup = findCatalogueEntry;
  let facts: AssetFactsSource = shippedAssetFacts;
  let registries: SceneRegistries = CATALOGUE_REGISTRIES;
  for (const layer of [...layers].reverse()) {
    catalogue = projectCatalogue(layer.library, catalogue);
    facts = projectAssetFacts(layer.library, facts);
    registries = registriesFromLibrary(libraryOf(layer.library), registries);
  }
  const materials = layers.flatMap((layer) => layer.library.materials);
  const owners = layers.map((layer) => ({
    own: new Set(layer.library.objects.map((object) => object.id)),
    resolve: projectModelUrl(layer.baseUrl),
  }));
  const previewUrl =
    project === null ? (asset: { readonly preview?: string | undefined }) => asset.preview : projectPreviewUrl(project.baseUrl);
  const resolveFinish = projectFinishResolver({ materials });
  const offered: VariantBank['offers'] =
    offers === null
      ? undefined
      : {
          id: offers.library.id,
          objects: offers.library.objects,
          ...(project === null
            ? {}
            : { project: { id: project.library.id, ids: new Set(project.library.objects.map((object) => object.id)) } }),
        };
  return {
    catalogue,
    libraries: layers.map((layer) => layer.library.id),
    resolveFinish,
    materials,
    findFinish: projectFinishes(materials).findFinish,
    // The first library that owns the archetype serves its model: the lookup order.
    modelUrl: (asset) => owners.find((owner) => owner.own.has(asset.archetypeId))?.resolve(asset),
    variants: { catalogue, previewUrl, materials, ...(offered === undefined ? {} : { offers: offered }) },
    facts,
    registries,
    offers,
  };
}
