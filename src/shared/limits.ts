/**
 * The size limits both ends of the library have to agree on.
 *
 * `MAX_SCENE_BYTES` lives here rather than in `scene/scene-repository.ts`
 * because the iframe HOST helper checks it too — an inline document that would
 * be refused by the fetch path must not be posted across the frame boundary
 * either — and `embed/host.ts` may not import a line of viewer code (4 KB gzip,
 * `budget-check.ts`). A module holding one number costs the host bundle
 * nothing; the repository would cost it the validator.
 *
 * Lowest layer: this module imports nothing.
 */

/** Largest scene document the library will read into memory, in bytes. */
export const MAX_SCENE_BYTES = 8 * 1024 * 1024;

/**
 * The size of an inline scene document in UTF-8 bytes of its JSON, or `null`
 * when it cannot be weighed (a cyclic object, a `BigInt`).
 *
 * One function for both ends of the frame boundary (`embed/host.ts` before the
 * post, `embed/frame-bridge.ts` after the clone), so the two refuse exactly the
 * same documents. Bytes, not `string.length`: a character between U+0800 and
 * U+FFFF (CJK, for one) is three UTF-8 bytes in one UTF-16 unit, so a length
 * check would admit three times the cap it names. `JSON.stringify` is not the wire format — a
 * structured clone is — but a scene document IS JSON by definition, so its JSON
 * size is the honest measure. `null` means "no opinion": the cap does not
 * refuse what it could not weigh, and the clone or the validator fails it for
 * its own reasons.
 */
export function inlineDocumentBytes(document: unknown): number | null {
  try {
    const text = JSON.stringify(document);
    return text === undefined ? null : new TextEncoder().encode(text).byteLength;
  } catch {
    return null;
  }
}

/**
 * Largest project manifest (`project.json`) the viewer will read, in bytes.
 *
 * A manifest is METADATA — a library of archetypes, materials and rights — and
 * a megabyte of it is already thousands of entries; the geometry and the
 * textures it names are separate files with their own caps below. It cannot be
 * applied while reading: a `scene.url` document is only known to be a manifest
 * once its `format` field has been read, so `ProjectRepository` reads under
 * `MAX_SCENE_BYTES` and judges against this.
 */
export const MAX_PROJECT_MANIFEST_BYTES = 1 * 1024 * 1024;

/** Largest single GLB the viewer will accept for one object variant, in bytes. */
export const MAX_MODEL_BYTES = 16 * 1024 * 1024;

/**
 * How many bytes one project may pull in total before the loader stops and
 * reports `project-budget`. A tab that quietly downloads a gigabyte is a
 * failure even when every individual file was within its own limit.
 */
export const MAX_PROJECT_BYTES = 96 * 1024 * 1024;

/**
 * Largest single texture file of a project library material, in bytes.
 *
 * Enforced at FETCH: the read counts the bytes it receives, without trusting
 * `Content-Length`, and cancels the response once a file passes this, leaving
 * that surface its flat colour. A catalogue bake refuses a larger file before
 * it writes a manifest.
 */
export const MAX_TEXTURE_FILE_BYTES = 2 * 1024 * 1024;

/**
 * How many texture bytes one document may fetch over its lifetime: cache hits
 * excluded, concurrent fetches included. A budget of its own beside
 * `MAX_PROJECT_BYTES`, which stays the model budget.
 *
 * Enforced at FETCH, after the downloads, as the model budget is: the viewer
 * draws one size per material and cannot weigh the sizes it never loads, so
 * the sum of every listed size is the bake's to check. Once reached, queued
 * and active texture work stops and unloaded surfaces keep their flat colours.
 */
export const MAX_PROJECT_TEXTURE_BYTES = 48 * 1024 * 1024;

/**
 * Most texture files a project manifest may LIST, counting every role and
 * size of every library material, sizes the viewer will not draw included.
 *
 * Enforced at VALIDATION (`assets/project-manifest.schema.ts`): a manifest
 * over it is refused before anything is fetched.
 */
export const MAX_PROJECT_TEXTURE_FILES = 512;

/**
 * How many object models may be in flight at once. Four keeps the connection
 * pool available for the textures and the scene itself; the queue is ordered
 * by distance to the presentation camera, so the wait is spent on what is out
 * of shot.
 */
export const MAX_MODEL_PARALLEL = 4;

/**
 * How many library-material texture jobs may be in flight at once. A job is
 * small (a map of at most 768 px), so four keep the surfaces filling in while
 * the models, which are queued the same way, still get connections.
 */
export const MAX_TEXTURE_PARALLEL = 4;

/**
 * How long one texture job may take, in milliseconds, from the moment its URL
 * is asked for (a host's live resolver included) to its last byte. A resolver
 * promise cannot be cancelled, so on expiry the job stops waiting for it,
 * aborts its fetch, frees its slot and leaves the surface flat with a warning;
 * a later answer is ignored.
 */
export const TEXTURE_FETCH_DEADLINE_MS = 30_000;
