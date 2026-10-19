/**
 * One entry, two documents: `scene.url` may name a BAKED PROJECT
 * (`project.json`) or, as before, a bare scene. This repository fetches
 * whatever is there and tells the two apart by a single field, `format`
 * — so no host, embed attribute or query string has to change, and
 * no caller has to say in advance which shape it is pointing at.
 *
 * For a project it then fetches `manifest.scene` from the manifest's own
 * folder and returns THAT as the scene document, so everything above this
 * module keeps seeing exactly one scene and one validator (`SceneModel.load`).
 * The manifest itself is handed on unjudged through `project()`; the judge is
 * `assets/project-manifest.schema.ts`, one layer up, and this module may not
 * import it (layer order: `scene` sits below `assets`). It therefore reads two
 * fields defensively, `format` and `scene`, and nothing else.
 *
 * The security-relevant invariant is CONTAINMENT: a manifest is untrusted
 * data, and `scene` is a path taken from it, so the resolved URL must still be
 * inside the manifest's folder. `../`, a leading `/` and a full `https://…`
 * are all refused the same way — by comparing the resolved URL against the
 * folder URL, not by pattern-matching the string.
 *
 * Pure module: no `three`, no DOM elements (`fetch` is a global, not a node).
 */

import { ViewerLibError } from '../shared/errors.js';
import { MAX_PROJECT_MANIFEST_BYTES, MAX_SCENE_BYTES } from '../shared/limits.js';
import { fetchJsonCapped, type InlineLibrary, type SceneRepository } from './scene-source.js';

/**
 * The one field that tells a baked project from a bare scene.
 *
 * Deliberately a private copy of `PROJECT_FORMAT` in
 * `assets/project-manifest.ts`: the string is the WIRE contract, and this
 * module sits below `assets/` and may not import it. The schema up there is
 * what pins the two copies together, by refusing any manifest whose `format`
 * is not this.
 */
const PROJECT_FORMAT = 'jeex-project';

/**
 * The manifest a `load()` found, and the folder its relative paths resolve
 * against. Structurally the same pair a host may pass inline as
 * `SceneSource.library`, because it is the same thing from the other side.
 */
export type LoadedProject = InlineLibrary;

/**
 * A base for relative URLs when there is no document to resolve against —
 * `bun:test`, a worker, any runtime without `location`. It never reaches the
 * network: a relative URL cannot be fetched in such a runtime anyway, and the
 * only thing this base is used for is comparing two resolved URLs to each
 * other, which needs an origin but not a reachable one.
 */
const PLACEHOLDER_BASE = 'http://jeex.invalid/';

/**
 * Opens a project folder, or a bare scene, from one URL.
 *
 * `ref` overrides the configured URL, so one repository can serve
 * `loadScene({ url })` for a different project — and `project()` then reports
 * the LAST one loaded, or `null` when that load turned out to be a bare scene.
 */
export class ProjectRepository implements SceneRepository {
  private readonly url: string;
  private readonly init?: RequestInit | undefined;
  private loaded: LoadedProject | null = null;

  constructor(url: string, init?: RequestInit) {
    this.url = url;
    this.init = init;
  }

  async load(ref?: string): Promise<unknown> {
    const target = ref ?? this.url;
    this.loaded = null;
    // The first request rides `fetchJsonCapped`'s default, `credentials:
    // 'omit'`: this is the request every `scene.url` — `?scene=`, `src=`,
    // `loadScene({ url })` — actually makes, and the URL is the EMBEDDER's
    // choice, so it must not carry the viewer origin's cookies. For a bare
    // scene it is the only request there is; a default that only
    // `FetchSceneRepository` (which no mount constructs) honoured would close
    // nothing. The second request, which exists solely because the first turned
    // out to be a manifest, omits them too. `init` still wins on both, for a
    // caller that constructs this repository itself.
    const first = await fetchJsonCapped(target, this.init, MAX_SCENE_BYTES);
    const scenePath = projectSceneRef(first.value, target);
    if (scenePath === null) return first.value;

    // The manifest's own, tighter cap. It is applied AFTER the read rather
    // than during it: until the body is in hand there is nothing to say this
    // is a manifest at all. The read is
    // still bounded — by `MAX_SCENE_BYTES`, the larger of the two.
    if (first.bytes > MAX_PROJECT_MANIFEST_BYTES) {
      throw new ViewerLibError('scene-load', `Scene fetch failed: project manifest over ${MAX_PROJECT_MANIFEST_BYTES} bytes (${target})`, {
        detail: { url: target, limit: MAX_PROJECT_MANIFEST_BYTES, bytes: first.bytes },
      });
    }

    const baseUrl = folderOf(target);
    const sceneUrl = insideFolder(scenePath, baseUrl, target);
    const scene = await fetchJsonCapped(sceneUrl, this.init, MAX_SCENE_BYTES);
    this.loaded = { manifest: first.value, baseUrl: baseUrl.href };
    return scene.value;
  }

  /** The project the last `load()` opened; `null` before it, and for a bare scene. */
  project(): LoadedProject | null {
    return this.loaded;
  }
}

/**
 * The `scene` path of a baked project, or `null` when this is a bare scene.
 *
 * Only two fields are read, and neither is trusted further than its type: a
 * manifest that says it is a project and then has no usable `scene` is a
 * `project-invalid`, not a scene document the validator would later reject
 * with a message about walls.
 */
function projectSceneRef(value: unknown, url: string): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const manifest = value as { format?: unknown; scene?: unknown };
  if (manifest.format !== PROJECT_FORMAT) return null;
  if (typeof manifest.scene !== 'string' || manifest.scene.trim() === '') {
    throw new ViewerLibError('project-invalid', `Project manifest names no scene (${url})`, {
      path: 'scene',
      detail: { url, scene: manifest.scene },
    });
  }
  return manifest.scene;
}

/** The folder a document was served from, as an absolute URL ending in `/`. */
function folderOf(url: string): URL {
  const here = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return new URL('.', new URL(url, here ?? PLACEHOLDER_BASE));
  } catch (cause) {
    throw new ViewerLibError('project-invalid', `Project manifest url cannot be resolved: ${url}`, {
      detail: { url },
      cause,
    });
  }
}

/**
 * `path` resolved against the project folder, refused when it lands outside it.
 *
 * The comparison is on the RESOLVED URL against a folder URL that ends in `/`,
 * which is what makes the prefix test sound: `../a-evil/x.json` resolved from
 * `…/a/` gives `…/a-evil/x.json`, which does not start with `…/a/`. A string
 * check for `..` would pass a percent-encoded one and would say nothing at all
 * about `https://elsewhere/x.json`.
 */
function insideFolder(path: string, folder: URL, manifestUrl: string): string {
  let resolved: URL;
  try {
    resolved = new URL(path, folder);
  } catch (cause) {
    // The message carries only the manifest URL the HOST chose, never the
    // `path` the manifest named: the error text crosses the frame boundary
    // through the bridge's `messageOf`, so a document-derived value in it would
    // be an echo channel. The refused path stays in `detail`, which the bridge
    // does not forward.
    throw new ViewerLibError('project-invalid', `Project scene path is not a url (${manifestUrl})`, {
      path: 'scene',
      detail: { url: manifestUrl, scene: path },
      cause,
    });
  }
  if (!resolved.href.startsWith(folder.href)) {
    // No `path` in the message, same reason as above: `detail.scene` holds it.
    throw new ViewerLibError('project-invalid', `Project scene path is outside the project folder (${manifestUrl})`, {
      path: 'scene',
      detail: { url: manifestUrl, scene: path, baseUrl: folder.href },
    });
  }
  return resolved.href;
}
