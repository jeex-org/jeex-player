/**
 * The demo page's own scene source: the bundled apartment, served through the
 * same `SceneRepository` contract any other source implements.
 *
 * Deliberately outside `scene-repository.ts`, which the library graph reaches
 * from `embed/index.ts` (`viewer-api.ts` re-exports `FetchSceneRepository`
 * and `InlineSceneRepository`). If this class lived there, its default
 * constructor argument would pull `scene-data.ts` — the 68-object demo flat —
 * into every host's bundle by one static edge. Keeping it here instead means
 * `scene-data.ts` is UNREACHABLE from the library entry, not merely unused by
 * it (`purity.test.ts`, "the library entry").
 *
 * `main.ts`, `main-embed.ts` and the dev pages import this module directly;
 * nothing under `embed/` may.
 *
 * Pure module: no `three`, no DOM elements.
 */

import type { SceneRepository } from '../scene/scene-repository.js';
import { apartmentScene } from './scene-data.js';

/** The bundled demo apartment; `ref` is accepted and ignored. */
import { ViewerLibError } from '../shared/errors.js';

export class LocalFixtureRepository implements SceneRepository {
  private readonly fixtures: Record<string, unknown>;
  private readonly defaultRef: string;

  constructor(fixtures: Record<string, unknown> = { [apartmentScene.id]: apartmentScene }, defaultRef = apartmentScene.id) {
    this.fixtures = fixtures;
    this.defaultRef = defaultRef;
  }

  async load(ref?: string): Promise<unknown> {
    const key = ref ?? this.defaultRef;
    const scene = this.fixtures[key];
    if (scene === undefined) throw new ViewerLibError('scene-load', `Unknown scene reference ${key}`, { detail: { ref: key } });
    return scene;
  }
}
