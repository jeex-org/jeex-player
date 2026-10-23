/**
 * The JSON document inside a binary glTF container, as a `zod/mini` schema of
 * the two fields that name a network fetch: `images[].uri` and
 * `buffers[].uri` (`model-source.ts` judges every one of them before the
 * loader runs).
 *
 * Loose by design: a glTF document carries far more than these two fields
 * (scenes, nodes, meshes, accessors, extensions), and they are the loader's to
 * read. Only the SHAPE the resource scan depends on is fixed here: when
 * present, each is an array of objects whose `uri`, when present, is a string.
 * Anything else is not a glTF 2.0 document and `glb-container.ts` refuses it
 * as `glb-json` before a single URI is resolved.
 *
 * Judging invariant: this schema never transforms. `readGlbContainer` hands
 * on the document the bytes held, never `result.data`.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';

/** One `images[]` or `buffers[]` entry: an object, its `uri` a string when present. */
const resourceSchema = z.looseObject({ uri: z.optional(z.string()) });

/** The container's JSON document, judged for the fields the resource scan reads. */
export const glbDocumentSchema = z.looseObject({
  images: z.optional(z.readonly(z.array(resourceSchema))),
  buffers: z.optional(z.readonly(z.array(resourceSchema))),
  extensionsUsed: z.optional(z.readonly(z.array(z.string()))),
});

/** Whether `value` has the shape the resource scan reads; the value itself is not touched. */
export function isGlbDocumentShape(value: unknown): boolean {
  return z.safeParse(glbDocumentSchema, value).success;
}
