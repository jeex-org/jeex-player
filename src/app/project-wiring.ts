/**
 * What a loaded BAKED PROJECT turns into for the rest of the viewer: one
 * object holding the manifest, the registries the document is validated
 * against, and the four injections the geometry layer draws it with.
 *
 * It exists because that assembly is the only place in the viewer where the
 * two halves of the format meet — the scene layer's narrow `ProjectLibrary`
 * (`scene/registries.ts`) and the assets layer's full
 * `ProjectLibraryManifest` (`assets/project-manifest.ts`) — and putting it in
 * `viewer-app.ts` would have the composition root know six module names it
 * has no other use for. The root asks one question, "is this a project", and
 * gets one answer.
 *
 * Invariant: a manifest is JUDGED before anything is built from it.
 * `parseProjectManifest` throws `project-invalid` with the field path, which
 * fails the mount the same way a bad scene document does — a bake that is
 * half-read is worse than one that is refused.
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { parseProjectManifest } from '../assets/project-manifest.schema.js';
import type { BakedProjectManifest } from '../assets/project-manifest.js';
import { libraryStack, type LibraryLayer } from '../assets/library-stack.js';
import { loadOffers, type OffersSource } from '../assets/offers.js';
import type { VariantBank } from '../assets/asset-variants.js';
import type { AssetFactsSource } from '../assets/asset-facts.js';
import type { SceneRegistries } from '../scene/registries.js';
import { ProjectRepository } from '../scene/project-repository.js';
import { SceneModel } from '../scene/scene-model.js';
import type { SceneRepository, SceneSource } from '../scene/scene-repository.js';
import type { SceneBuilderOptions } from '../geometry/scene-builder.js';
import type { Logger } from '../shared/logger.js';

/** What a host reads off `ViewerHandle.project()`. */
export type ProjectInfo = {
  readonly manifest: BakedProjectManifest;
  /** Absolute URL of the folder the manifest was served from, trailing slash included. */
  readonly baseUrl: string;
};

/**
 * A loaded project and the host's offers, prepared for every consumer inside
 * the viewer. It exists whenever a document has either: a bare scene with
 * offers gets one too, with `info` null.
 */
export type LoadedProjectContext = {
  /** The baked project, or `null` for a bare scene opened with offers. */
  readonly info: ProjectInfo | null;
  /** The host's offers library, judged, or `null`. */
  readonly offers: LibraryLayer | null;
  /** The shipped registries with the project's library and the offers added. */
  readonly registries: SceneRegistries;
  /** What `SceneBuilder` is constructed with for this document. */
  readonly builderOptions: SceneBuilderOptions;
  /**
   * What the Replace panel, the popup and `describeSelection` offer for this
   * document: the project's entries, the offers, the shipped bank behind them,
   * and the resolver for the pictures the libraries name.
   */
  readonly variants: VariantBank;
  /** The libraries over the shipped bank, for every floor question (`assets/asset-facts.ts`). */
  readonly facts: AssetFactsSource;
  /**
   * The libraries this document is drawn with, as one comparable value: the
   * folders and the validated libraries. Two loads with the same key draw with
   * the same bank, so the second can be committed as a revision of the first
   * instead of being built from scratch (`SceneMount.present`).
   */
  readonly key: string;
};

/** A validated document and the libraries it is drawn with, if any beyond the bundled bank. */
export type LoadedDocument = { readonly model: SceneModel; readonly project: LoadedProjectContext | null };

/**
 * Loads and VALIDATES one document, whichever of the two shapes it is.
 *
 * A baked project is judged against its OWN registries: the shipped catalogues
 * know nothing about `project:<id>`, so validating a project document against
 * them refuses every placement it holds. A bare scene takes exactly the path it
 * always took, against `CATALOGUE_REGISTRIES`.
 *
 * `offers` are loaded FIRST, before the document is validated: a document may
 * already name the offers library, and a model judged without them would
 * refuse it. An offers library that fails, or whose id is the project's, is
 * an `offers-invalid` warning and the document opens without it.
 *
 * Nothing is torn down here and nothing is mounted: the caller keeps the
 * document on screen until this resolves, which is what makes a failed
 * `loadScene` leave the previous apartment alone.
 */
export async function loadDocument(
  repository: SceneRepository,
  source: SceneSource | undefined,
  log: Logger,
  ref?: string,
  offersSource?: OffersSource,
): Promise<LoadedDocument> {
  const [input, loadedOffers] = await Promise.all([repository.load(ref), loadOffers(offersSource, log)]);
  const info = manifestSourceOf(repository, source);
  let offers = loadedOffers;
  if (offers !== null && info !== null && offers.library.id === info.manifest.library.id) {
    log.warn('offers-invalid', `Offers library ${offers.library.id} has the project library's id; the document opens without offers`);
    offers = null;
  }
  const project = info !== null || offers !== null ? projectContext(info, log, offers) : null;
  return { model: SceneModel.load(input, project?.registries ?? CATALOGUE_REGISTRIES, log), project };
}
/**
 * The raw manifest a mount should read, or `null` for a bare scene.
 *
 * Two sources, and the FETCHED one wins: a repository that just downloaded a
 * `project.json` holds the manifest that belongs to the document on screen,
 * while `scene.library` is a copy a host is holding (an editor host that
 * has both in memory) and may be stale. `SceneSource.library`'s own doc says
 * the same thing from the other side.
 */
export function manifestSourceOf(repository: SceneRepository, source: SceneSource | undefined): ProjectInfo | null {
  const fetched = repository instanceof ProjectRepository ? repository.project() : null;
  const raw = fetched ?? source?.library ?? null;
  if (!raw) return null;
  // Judged here, not where it was downloaded: `scene/project-repository.ts`
  // sits below `assets/` and may not name the schema.
  return { manifest: parseProjectManifest(raw.manifest), baseUrl: raw.baseUrl };
}

/**
 * Everything the viewer needs to validate and draw one document's libraries:
 * the baked project's, the host's offers, or both.
 *
 * The stack (`assets/library-stack.ts`) rather than the project library alone:
 * the shipped opening variants and the bundled finishes stay reachable, so a
 * bake that names none of its own still gets doors that open and a wall it
 * can paint, and the project's own entries answer first, then the offers.
 *
 * Every injection below reads the same stack, and for the same reason — the
 * format has two entrances and ONE validator, so what the document was judged
 * against is what draws it. A lookup that replaced the bank instead degraded
 * every `type`-only placement a host's templates may still carry to an
 * `unknown-asset` placeholder while the validator accepted it (a defect found
 * when project mounting was added).
 */
export function projectContext(info: ProjectInfo | null, log: Logger, offers: LibraryLayer | null = null): LoadedProjectContext {
  const stack = libraryStack(info === null ? null : { library: info.manifest.library, baseUrl: info.baseUrl }, offers);
  const projectLibrary = info?.manifest.library.id;
  return {
    info,
    offers,
    key: JSON.stringify([info?.baseUrl ?? null, info?.manifest ?? null, offers?.baseUrl ?? null, offers?.library ?? null]),
    registries: stack.registries,
    variants: stack.variants,
    facts: stack.facts,
    builderOptions: {
      modelUrl: (asset) => stack.modelUrl(asset),
      catalogue: stack.catalogue,
      ...(projectLibrary === undefined ? {} : { catalogueLibrary: projectLibrary }),
      catalogueLibraries: stack.libraries,
      resolveFinish: stack.resolveFinish,
      projectMaterials: stack.materials,
      // The libraries' surfaces first, the bundled catalogue behind them: a
      // scene authored before the format still names bank ids that no
      // exporter carried into `library.materials`, and a
      // room painted grey because of that is a worse answer than the finish
      // the document asked for.
      findFinish: stack.findFinish,
      // A project or offers folder is static content on some other origin.
      credentials: 'omit',
      log,
    },
  };
}
