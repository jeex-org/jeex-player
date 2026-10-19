/**
 * The sidecar of one rendered artefact (`app/provenance.ts`), as a compile-time
 * CONTRACT rather than a runtime check.
 *
 * `Provenance` is produced by this library and never accepted from outside
 * it: `provenanceFor` builds one from fields this library itself controls
 * (the scene, the revision, the clock) plus a caller-supplied `camera`/
 * `roomId` that is spread FIRST and so cannot override what the sidecar
 * decides (`provenance.ts`'s own doc comment). There is therefore no boundary
 * here for a `safeParse` to guard — putting one in `provenanceFor` would be
 * validating this library's own internals (schemas guard trust boundaries
 * only). `provenanceSchema` exists to be the source of a generated JSON Schema
 * (a later package) and the target of the compile-time agreement check in
 * `provenance.schema.test.ts`.
 *
 * `generator` and `disclosure` are literals: `provenance.ts`'s own invariant
 * is that a JEEX artefact is a rendering and never a photograph, so neither
 * field is ever anything else.
 *
 * Pure module: no `three`, no DOM.
 */

import { z } from 'zod/mini';
import { cameraPoseSchema, schemaVersionSchema } from '../scene/types.schema.js';
import { UUID_V7_PATTERN } from '../scene/types.js';

/** The scene's and the room's ids are entity UUIDs, the scene schema's own grammar. */
const uuidSchema = z.string().check(z.regex(UUID_V7_PATTERN, { error: 'not a UUID v7' }));

export const provenanceSchema = z.object({
  generator: z.literal('jeex-viewer'),
  version: z.string(),
  sceneId: uuidSchema,
  rev: z.number(),
  schemaVersion: schemaVersionSchema,
  state: z.union([z.literal('current'), z.literal('default')]),
  kind: z.enum(['still', 'panorama', 'plan', 'frame']),
  createdAt: z.string().check(z.refine((value) => !Number.isNaN(Date.parse(value)), 'an ISO 8601 instant')),
  disclosure: z.literal('rendered-3d'),
  camera: z.optional(cameraPoseSchema),
  roomId: z.optional(uuidSchema),
});
