/**
 * The shape gate: the one check that runs before any section, because every
 * section reads fields it proves are there.
 *
 * Invariant: it is a TypeScript assertion function, so a document that survives
 * it is a `SceneData` to the compiler as well as to the reader — which is why
 * nothing downstream needs a cast to reach `scene.walls` or `scene.autotour`
 * (no `as SceneData` anywhere in the sections). What it does NOT check is
 * whether the contents are sound; that is what the sections are for.
 *
 * Pure module: no `three`, no DOM.
 */

import { fail } from './context.js';
import { isUuidV7, SCHEMA_VERSIONS } from '../types.js';
import type { SceneData } from '../types.js';

/** The document versions this build reads: 2.0 and 2.1 (2.1 adds `mirror`, otherwise 2.0). */
const READABLE_VERSIONS: ReadonlySet<unknown> = new Set(SCHEMA_VERSIONS);

/**
 * What a 1.x document is told: it is refused, never guessed at, because its
 * ids are not UUIDs and the viewer never mints one.
 */
const SCHEMA_1X_REFUSAL = 'schemaVersion must be 2.x (every id a UUID v7); 1.x documents are not read';

/** Longest storey name the schema accepts, in characters. */
const MAX_STOREY_NAME = 64;

/**
 * `units`. Absent means metres; any OTHER unit is refused rather than converted, because a viewer that silently
 * reads feet as metres draws a flat twelve times too large. The importer is
 * what is allowed to convert (its own plan normaliser), and
 * it says so in its report.
 */
function checkUnits(scene: Partial<SceneData>): void {
  const units = (scene as { units?: unknown }).units;
  if (units === undefined) return;
  if (units !== 'm') {
    // `units` is `unknown` here, so it is NAMED rather than stringified: a
    // hostile document could carry an object whose `toString` throws.
    const shown = typeof units === 'string' ? units : typeof units;
    fail('units-unsupported', 'units', `Unsupported scene units ${shown}; expected 'm'`, { units: shown });
  }
}

/**
 * `storey`. Both fields are optional, so the only thing to
 * prove is that what IS there is usable: a name short enough to label, and an
 * elevation that is a real number of metres.
 */
function checkStorey(scene: Partial<SceneData>): void {
  const storey = (scene as { storey?: unknown }).storey;
  if (storey === undefined) return;
  if (typeof storey !== 'object' || storey === null || Array.isArray(storey)) {
    fail('storey-invalid', 'storey', 'Scene storey must be an object');
  }
  const { name, elevation } = storey as { name?: unknown; elevation?: unknown };
  if (name !== undefined && (typeof name !== 'string' || name.length === 0 || name.length > MAX_STOREY_NAME)) {
    fail('storey-invalid', 'storey.name', `Scene storey name must be a string of 1..${MAX_STOREY_NAME} characters`);
  }
  if (elevation !== undefined && (typeof elevation !== 'number' || !Number.isFinite(elevation))) {
    const shown = typeof elevation === 'number' ? String(elevation) : typeof elevation;
    fail('storey-invalid', 'storey.elevation', `Scene storey elevation must be a finite number of metres, got ${shown}`);
  }
}

/**
 * Refuses anything that is not a schema-2.0 or 2.1 document with every required field
 * present and of the right container kind, and narrows it to `SceneData`.
 */
export function assertSceneShape(input: unknown): asserts input is SceneData {
  if (!input || typeof input !== 'object') fail('scene-not-object', '', 'Scene must be an object');
  const scene = input as Partial<SceneData>;

  const schemaVersion = (scene as { schemaVersion?: unknown }).schemaVersion;
  if (typeof schemaVersion === 'string' && schemaVersion.startsWith('1.')) {
    fail('schema-version-1x', 'schemaVersion', SCHEMA_1X_REFUSAL, { schemaVersion });
  }
  if (!READABLE_VERSIONS.has(schemaVersion)) {
    fail(
      'schema-version-unsupported',
      'schemaVersion',
      `Unsupported scene schema ${String(schemaVersion)}; expected ${SCHEMA_VERSIONS.map((version) => `'${version}'`).join(' or ')}`,
      {
        schemaVersion: schemaVersion ?? null,
      },
    );
  }
  checkUnits(scene);
  checkStorey(scene);

  if (!scene.id || !scene.name) fail('scene-identity-missing', 'id', 'Scene id and name are required');
  if (!isUuidV7(scene.id)) {
    fail('id-invalid', 'id', `scene id ${JSON.stringify(scene.id)} is not a UUID v7 (lowercase, canonical 8-4-4-4-12)`, {
      kind: 'scene',
      id: typeof scene.id === 'string' ? scene.id : null,
    });
  }
  const ceilingHeight = scene.ceilingHeight;
  if (typeof ceilingHeight !== 'number' || !Number.isFinite(ceilingHeight) || ceilingHeight < 2) {
    fail('ceiling-height-invalid', 'ceilingHeight', 'Scene ceilingHeight is invalid');
  }
  if (!Array.isArray(scene.nodes) || scene.nodes.length < 3) fail('nodes-too-few', 'nodes', 'Scene needs at least three plan nodes');
  if (!Array.isArray(scene.walls) || scene.walls.length < 4) fail('walls-too-few', 'walls', 'Scene needs at least four walls');
  if (!Array.isArray(scene.rooms) || scene.rooms.length === 0) fail('rooms-missing', 'rooms', 'Scene needs rooms');
  if (scene.materials !== undefined && !Array.isArray(scene.materials))
    fail('materials-not-array', 'materials', 'Scene materials must be an array');
  if (!Array.isArray(scene.assets)) fail('assets-not-array', 'assets', 'Scene assets must be an array');
  if (!scene.presentationCamera || !scene.roomCameras || !scene.navigation || !scene.autotour) {
    fail('camera-data-missing', 'presentationCamera', 'Scene camera and navigation data are required');
  }
}
