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
import { projectLibraryOf, type BakedProjectManifest } from '../assets/project-manifest.js';
import { projectBank } from '../assets/project-catalogue.js';
import type { VariantBank } from '../assets/asset-variants.js';
import { registriesFromLibrary, type SceneRegistries } from '../scene/registries.js';
import { ProjectRepository } from '../scene/project-repository.js';
import { SceneModel } from '../scene/scene-model.js';
import type { SceneRepository, SceneSource } from '../scene/scene-repository.js';
import { findFinish } from '../materials/finish-catalogue.js';
import type { SceneBuilderOptions } from '../geometry/scene-builder.js';
import type { Logger } from '../shared/logger.js';

/** What a host reads off `ViewerHandle.project()`. */
export type ProjectInfo = {
  readonly manifest: BakedProjectManifest;
  /** Absolute URL of the folder the manifest was served from, trailing slash included. */
  readonly baseUrl: string;
};

/** A loaded project, prepared for every consumer inside the viewer. */
export type LoadedProjectContext = {
  readonly info: ProjectInfo;
  /** The shipped registries with the project's own library added. */
  readonly registries: SceneRegistries;
  /** What `SceneBuilder` is constructed with for this document. */
  readonly builderOptions: SceneBuilderOptions;
  /**
   * What the Replace panel and `describeSelection` offer for this document:
   * the project's own entries, the shipped bank behind them, and the resolver
   * for the pictures the manifest names.
   */
  readonly variants: VariantBank;
  /**
   * The library this document is drawn with, as one comparable value: the
   * folder and the validated manifest. Two loads with the same key draw with
   * the same bank, so the second can be committed as a revision of the first
   * instead of being built from scratch (`SceneMount.present`).
   */
  readonly key: string;
};

/** A validated document and the project it belongs to, if any. */
export type LoadedDocument = { readonly model: SceneModel; readonly project: LoadedProjectContext | null };

/**
 * Loads and VALIDATES one document, whichever of the two shapes it is.
 *
 * A baked project is judged against its OWN registries: the shipped catalogues
 * know nothing about `project:<id>`, so validating a project document against
 * them refuses every placement it holds. A bare scene takes exactly the path it
 * always took, against `CATALOGUE_REGISTRIES`.
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
): Promise<LoadedDocument> {
  const input = await repository.load(ref);
  const info = manifestSourceOf(repository, source);
  const project = info ? projectContext(info, log) : null;
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
 * Everything the viewer needs to validate and draw one baked project.
 *
 * `registriesFromLibrary(…, CATALOGUE_REGISTRIES)` rather than the project
 * library alone: the shipped opening variants and the bundled finishes stay
 * reachable, so a bake that names none of its own still gets doors that open
 * and a wall it can paint. The project's own entries answer first.
 *
 * Every injection below layers the same way, and for the same reason — the
 * format has two entrances and ONE validator, so what the document was judged
 * against is what draws it. A lookup that replaced the bank instead degraded
 * every `type`-only placement a host's templates may still carry to an
 * `unknown-asset` placeholder while the validator accepted it (a defect found
 * when project mounting was added).
 */
export function projectContext(info: ProjectInfo, log: Logger): LoadedProjectContext {
  const manifest = info.manifest;
  const bank = projectBank(manifest, info.baseUrl);
  const materials = manifest.library.materials;
  return {
    info,
    key: JSON.stringify([info.baseUrl, manifest]),
    registries: registriesFromLibrary(projectLibraryOf(manifest), CATALOGUE_REGISTRIES),
    variants: bank.variants,
    builderOptions: {
      modelUrl: (asset) => bank.modelUrl(asset),
      catalogue: bank.catalogue,
      resolveFinish: bank.resolveFinish,
      projectMaterials: materials,
      // The project's surfaces first, the bundled catalogue behind them: a
      // scene authored before the format still names bank ids that no
      // exporter carried into `library.materials`, and a
      // room painted grey because of that is a worse answer than the finish
      // the document asked for.
      findFinish: (id) => findFinish(id, materials) ?? findFinish(id),
      // A project folder is static content on some other origin.
      credentials: 'omit',
      log,
    },
  };
}
