/**
 * Where a scene comes from. The viewer never imports a fixture directly: it
 * asks a repository, so the same composition root serves a URL, a document
 * the host already holds, a backend of the host's own, or — for the demo
 * page only — the bundled apartment (`fixture-repository.ts`).
 *
 * Invariant: a repository returns raw `unknown`. Validation is the model's job
 * (`SceneModel.load`), so an untrusted source and the bundled fixture take the
 * exact same path — there is one validator and no source can skip it.
 *
 * Second invariant: this module names no fixture. `resolveSceneSource` throws
 * when no source was given rather than quietly mounting the demo flat;
 * `main.ts` passes `LocalFixtureRepository` because that is the DEMO page's
 * decision, and that class lives in `fixture-repository.ts` — a separate
 * module — precisely so this one never imports `scene-data.ts`
 * (`purity.test.ts`, "the library entry").
 *
 * The vocabulary itself (`SceneRepository`, `SceneSource`, `InlineLibrary`)
 * and the guarded fetch both live one module down, in `scene-source.ts`, and
 * are re-exported here: `resolveSceneSource` constructs `ProjectRepository`,
 * so `project-repository.ts` cannot name anything defined HERE without a
 * cycle. This module is the composition root of the three repositories; that
 * one is the alphabet they are written in.
 *
 * Pure module: no `three`, no DOM elements (`fetch` is a global, not a node).
 */

import { ViewerLibError } from '../shared/errors.js';
import { MAX_SCENE_BYTES } from '../shared/limits.js';
import { ProjectRepository } from './project-repository.js';
import { fetchJsonCapped, type SceneRepository, type SceneSource } from './scene-source.js';

// Re-exported, not redefined: every host and every layer above already spells
// these `from '../scene/scene-repository.js'`, and the move below this module
// is an internal one. What is NOT re-exported (`fetchJsonCapped`,
// `InlineLibrary`, the timeout) is imported from `scene-source.js` directly —
// one public spelling per name, which is what `check:dead` insists on.
export type { SceneRepository, SceneSource } from './scene-source.js';
export { SCENE_ACCEPT_HEADER } from './scene-source.js';

// The cap is shared with `embed/host.ts`, which refuses an inline document of
// the same size before it crosses the frame boundary (`shared/limits.ts`).
export { MAX_SCENE_BYTES } from '../shared/limits.js';

/**
 * Fetches a scene document over HTTP. `ref` overrides the configured URL, so
 * one repository can serve `loadScene({ url })` for a different document.
 *
 * A scene URL is HOST-supplied — `?scene=`, `src=`, `loadScene({ url })` — and
 * an embedded viewer can be pointed at any URL at all, which is the design;
 * `fetchJsonCapped` (`scene-source.ts`) carries the five limits that follow
 * from it (timeout, redirect policy, content type, streamed size cap, no
 * credentials by default).
 *
 * Kept as a class of its own beside `ProjectRepository` because it is part of
 * the published surface (`embed/index.ts`) and because it is the plain
 * one-document loader: a host that knows it holds a bare scene, and wants no
 * `format` sniffing at all, passes this as `scene.repository`.
 */
export class FetchSceneRepository implements SceneRepository {
  private readonly url: string;
  private readonly init?: RequestInit | undefined;

  constructor(url: string, init?: RequestInit) {
    this.url = url;
    this.init = init;
  }

  async load(ref?: string): Promise<unknown> {
    return (await fetchJsonCapped(ref ?? this.url, this.init, MAX_SCENE_BYTES)).value;
  }
}

/** A document the host already holds; `ref` is accepted and ignored. */
export class InlineSceneRepository implements SceneRepository {
  private readonly scene: unknown;

  constructor(scene: unknown) {
    this.scene = scene;
  }

  async load(): Promise<unknown> {
    return this.scene;
  }
}

/** What `resolveSceneSource` says when a host named no scene at all. */
export const NO_SCENE_SOURCE = 'viewer: no scene source';

/**
 * Turns a `SceneSource` into the repository that serves it.
 *
 * Precedence is most-specific-first: a `repository` is the host's own loader
 * and beats everything, a `document` is already in hand and beats a `url`, and
 * a `url` is a fetch. Nothing is invented: a source that names none of the
 * three throws, because a viewer that silently mounts SOME apartment is worse
 * than one that says it was not told which.
 *
 * A `url` gets a `ProjectRepository`, not a `FetchSceneRepository`: the two
 * behave identically on a bare scene, and the project case is the one a plain
 * fetch cannot serve at all. `scene.library` belongs to the `document` case
 * and is read by the mount, not here.
 */
export function resolveSceneSource(scene: SceneSource | undefined): SceneRepository {
  if (scene?.repository) return scene.repository;
  if (scene?.document !== undefined) return new InlineSceneRepository(scene.document);
  if (scene?.url) return new ProjectRepository(scene.url);
  throw new ViewerLibError('no-scene-source', NO_SCENE_SOURCE);
}
