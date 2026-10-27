/**
 * `jeex-viewer/schema`: the published entry for the document formats the
 * player reads, for a service that checks those documents WITHOUT running a
 * player — a catalogue that accepts baked projects, a pipeline that writes
 * scenes. It is the player's own validation, not a copy of it, so a document
 * the service accepts is one the player draws.
 *
 * It carries:
 * - the scene: `validateScene` (the full check, with the registries it is
 *   checked against), the `zod/mini` shape schema and its two judges, the
 *   `parseSceneDocument` judge, the supported `SCHEMA_VERSIONS` and the closed
 *   vocabularies (`ROOM_PURPOSES`, `ROOM_KINDS`, `OPENING_TYPES`, `WALL_ROLES`);
 * - the baked project: the manifest schema, its parser and issue list, the
 *   library parser and the lamp-light schema with its three ceilings, and the
 *   helpers that read a manifest's library (`projectLibraryOf`, `libraryOf`,
 *   `isProjectDocument`, `PROJECT_FORMAT`);
 * - the catalogues: the shipped `CATALOGUE_REGISTRIES`, `registriesFromLibrary`
 *   for a project's own library, `assetRefOf` (the one rule a placement's
 *   library is read by) and `CATALOGUE_ID_BY_SLUG` for 1.x catalogue slugs;
 * - the size limits a project must keep to load (`MAX_*` of `shared/limits`).
 *   The fetch parallelism and deadline beside them are the player's runtime
 *   choices, not part of a format, and stay out.
 *
 * `jeex-viewer/ops` overlaps with this entry on purpose: an editor host takes
 * the operation vocabulary from there, a service that only checks documents
 * takes this one and carries none of the editing code.
 *
 * Invariant: this module and everything it imports stay free of `three` and of
 * the DOM (`purity.test.ts`). Zod is the consumer's: the library build leaves
 * `zod` as an import (`vite.lib.config.ts`, pass `schema`).
 */

export { validateScene } from '../scene/scene-validator.js';
export { parseSceneDocument } from '../scene/scene-parse.js';
export { sceneSchema, isSceneShape, sceneShapeIssues } from '../scene/types.schema.js';
export { SCHEMA_VERSIONS } from '../scene/types.js';
export type { SceneData } from '../scene/types.js';
export { OPENING_TYPES, ROOM_KINDS, ROOM_PURPOSES, WALL_ROLES } from '../scene/schema-sets.js';

export {
  LAMP_MAX_CUTOFF,
  LAMP_MAX_LIGHTS,
  LAMP_MAX_LUMENS,
  lampLightSchema,
  parseProjectLibrary,
  parseProjectManifest,
  projectManifestIssues,
  projectManifestSchema,
} from '../assets/project-manifest.schema.js';
export { PROJECT_FORMAT, isProjectDocument, libraryOf, projectLibraryOf } from '../assets/project-manifest.js';
export type { BakedProjectManifest, ProjectLibraryManifest } from '../assets/project-manifest.js';

export { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
export { CATALOGUE_ID_BY_SLUG } from '../assets/catalogue-slugs.js';
export { assetRefOf, registriesFromLibrary } from '../scene/registries.js';
export type { ProjectLibrary, SceneRegistries } from '../scene/registries.js';

export {
  MAX_MODEL_BYTES,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_MANIFEST_BYTES,
  MAX_PROJECT_TEXTURE_BYTES,
  MAX_PROJECT_TEXTURE_FILES,
  MAX_SCENE_BYTES,
  MAX_TEXTURE_FILE_BYTES,
} from '../shared/limits.js';
