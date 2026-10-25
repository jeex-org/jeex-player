/**
 * A baked project's library as the RENDER path reads it: the three lookups
 * `asset-loader.ts` needs to draw a placement that names no builder and lives
 * in no shipped catalogue.
 *
 * Each of them LAYERS over the shipped bank rather than replacing it, because
 * the registries the same document is validated against do (two entrances, one
 * validator). The project answers first; what it does not declare falls
 * through to the bank, which keeps its procedural body and its finishes until
 * the builders are retired.
 *
 * `scene/registries.ts` already carries the project library for the VALIDATOR
 * — ids, variant ids, anchors, which surfaces a finish may dress — and that
 * view is deliberately narrow, because the scene layer may not know what a
 * `dims` or a `model` is (`projectLibraryOf`, `assets/project-manifest.ts`).
 * Geometry needs the wide view, and geometry sits above `assets/`, so the wide
 * view is prepared here and handed down as three plain functions.
 *
 * Invariant: nothing in this module fetches, and nothing it returns reaches
 * outside the manifest folder — `modelUrl` resolves against `baseUrl` and a
 * path that escapes it answers `undefined` rather than a URL somewhere else.
 * The schema has already refused `..` and absolute URLs
 * (`project-manifest.schema.ts`); this is the second lock on the same door,
 * because the resolver is what actually builds the request.
 *
 * Pure module: no `three`, no DOM.
 */

import { resolveFinishId } from '../materials/asset-finish-catalogue.js';
import { findCatalogueEntry } from './asset-catalogue.js';
import { isHttpUrl } from './asset-types.js';
import type { VariantBank } from './asset-variants.js';
import type { CatalogueLookup, FinishIdResolver, ResolvableObject } from './asset-resolver.js';
import type { BakedProjectManifest, ProjectLibraryManifest } from './project-manifest.js';

/** Everything the geometry layer needs injected to draw one baked project. */
export type ProjectBank = {
  /** The library id a placement of this project resolves against (`library.id`). */
  readonly defaultLibrary: string;
  /** The project's own objects first, the shipped bank behind them, in `findCatalogueEntry`'s shape. */
  readonly catalogue: CatalogueLookup;
  /** A finish id the project declares passes through; anything else falls back to the bundled bank. */
  readonly resolveFinish: FinishIdResolver;
  /** `objects[].model` (or the variant's own) resolved against the manifest folder; `undefined` for a bank entry. */
  readonly modelUrl: (asset: { readonly archetypeId: string; readonly model?: string | undefined }) => string | undefined;
  /**
   * What the replace panel and `describeSelection` are offered for this
   * document: the project's own entries, the shipped bank behind them, and the
   * resolver that turns a manifest `preview` into a URL an `<img>` can take.
   */
  readonly variants: VariantBank;
};

/**
 * The bank of one loaded project.
 *
 * `baseUrl` is the manifest's own folder, with its trailing slash
 * (`scene/project-repository.ts`), and every relative path in the manifest is
 * resolved against it.
 */
export function projectBank(manifest: BakedProjectManifest, baseUrl: string): ProjectBank {
  const library = manifest.library;
  const own = new Set(library.objects.map((object) => object.id));
  const resolve = projectModelUrl(baseUrl);
  // ONE lookup instance, not two: the render path and the Replace panel must
  // answer the same entry for the same id, and sharing the instance makes that
  // structural instead of conventional — besides saving a second pass over
  // every object and variant on load.
  const catalogue = projectCatalogue(library, findCatalogueEntry);
  return {
    defaultLibrary: library.id,
    catalogue,
    resolveFinish: projectFinishResolver(library),
    // ONLY the project's own objects are served from the project folder. A
    // shipped bank entry carries an `obj/<slug>.glb` path its own library has no
    // `baseUrl` for (`asset-library.ts`), and resolving that against the bake
    // would ask it for a file no bake ever wrote; answering `undefined` keeps
    // the entry on the procedural body it has always had.
    modelUrl: (asset) => (own.has(asset.archetypeId) ? resolve(asset) : undefined),
    variants: { catalogue, previewUrl: projectPreviewUrl(baseUrl), materials: library.materials },
  };
}

/**
 * `findCatalogueEntry` over a project library.
 *
 * Two indexes, exactly as the shipped bank has them: by archetype id, and by
 * variant id — a scene authored by an editor host may name either, and
 * answering only the first turned a legal document into `unknown-asset`.
 *
 * `base` is the bank BEHIND the project, and it is what makes the render path
 * agree with the validator (`scene/registries.registriesFromLibrary`): a
 * project document still carries `type`-only placements no exporter rewrote,
 * the shipped bank still owns them until the builders are retired, and a
 * lookup that replaced the bank instead of layering over it degraded every one
 * of them to `unknown-asset`.
 * The project answers first, so an id it declares wins. Without a base the
 * project is the whole bank, which is what a caller testing a manifest alone
 * asks for. A type word reaches the base's alias table untouched: that table
 * belongs to the base's own history and a bake has none.
 */
export function projectCatalogue(library: ProjectLibraryManifest, base?: CatalogueLookup): CatalogueLookup {
  const byArchetype = new Map<string, ResolvableObject>();
  const byVariant = new Map<string, { object: ResolvableObject; variantId: string }>();
  for (const object of library.objects) {
    byArchetype.set(object.id, object);
    for (const variant of object.variants) byVariant.set(variant.id, { object, variantId: variant.id });
  }
  return (assetId) => {
    const object = byArchetype.get(assetId);
    if (object) return { object };
    return byVariant.get(assetId) ?? base?.(assetId) ?? null;
  };
}

/**
 * Which finish ids survive into a resolved asset's slots.
 *
 * The project's own ids pass through untouched — they are the point — and
 * anything else is offered to the bundled bank, because a scene written before
 * the format still names bank ids no exporter carried into
 * `library.materials`. An
 * id neither knows is dropped, exactly as before, so a slot falls back to the
 * archetype default rather than to an untextured mesh.
 */
export function projectFinishResolver(library: Pick<ProjectLibraryManifest, 'materials'>): FinishIdResolver {
  const own = new Set(library.materials.map((material) => material.id));
  return (id) => (id !== undefined && own.has(id) ? id : resolveFinishId(id));
}

/**
 * `model` resolved against the project folder, or `undefined`.
 *
 * `undefined` — not a throw — for a path that leaves the folder: a manifest is
 * untrusted data, and the honest answer to "where is this object's model" for
 * a path that points elsewhere is "nowhere this viewer will fetch", which is
 * the same answer an entry with no model at all gives. The placement keeps its
 * placeholder and the host hears about it through the schema, which refused
 * the manifest in the first place.
 */
export function projectModelUrl(baseUrl: string): (asset: { readonly model?: string | undefined }) => string | undefined {
  const folder = folderOf(baseUrl);
  return (asset) => (asset.model && folder ? insideFolder(asset.model, folder) : undefined);
}

/** The manifest's folder as a URL, or `null` when the caller was handed something that is not one. */
function folderOf(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
}

/**
 * `path` resolved against `folder`, or `undefined` when it would land outside
 * it — the containment rule, written once for both resolvers.
 *
 * It was the same eight lines in `projectModelUrl` and `projectPreviewUrl`,
 * and a rule with two copies is a rule that drifts: a stricter model check
 * that missed the preview, or the reverse, and the reverse is the silent one
 * (every picture gone, no error anywhere).
 */
function insideFolder(path: string, folder: URL): string | undefined {
  let resolved: URL;
  try {
    resolved = new URL(path, folder);
  } catch {
    return undefined;
  }
  return resolved.href.startsWith(folder.href) ? resolved.href : undefined;
}

/**
 * `preview` as an address an `<img>` can take, or `undefined`.
 *
 * Two shapes, because the format now allows two (`project-manifest.schema.ts`):
 * an ABSOLUTE `http(s)` URL is a catalogue service's public preview address
 * and passes through untouched — it is the whole point that the picture lives
 * outside the bake, unsigned and immutable — while a RELATIVE path is a file
 * of the folder and is resolved against it, refusing anything that would leave
 * it exactly as `projectModelUrl` does.
 *
 * `undefined`, never a throw, for everything else: a manifest is untrusted
 * data and the honest answer for a picture the viewer will not load is «there
 * is none», which is the same answer an entry with no `preview` gives. The
 * caller then falls back to its own render and, after that, to the palette.
 */
export function projectPreviewUrl(baseUrl: string): (asset: { readonly preview?: string | undefined }) => string | undefined {
  const folder = folderOf(baseUrl);
  return (asset) => {
    const preview = asset.preview;
    if (!preview) return undefined;
    // `isHttpUrl` is the schema's own predicate (`assets/asset-types.ts`): the
    // document was admitted by exactly this test, so a picture it accepted can
    // never be one this resolver silently drops.
    if (isHttpUrl(preview)) return preview;
    // Anything else is either a path of the folder or an address this viewer
    // will not load — `new URL(preview, folder)` decides which, and a scheme
    // `isHttpUrl` refused (`javascript:`, `data:`) resolves to itself and
    // therefore lands outside the folder.
    return folder ? insideFolder(preview, folder) : undefined;
  };
}
