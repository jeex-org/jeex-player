/**
 * The schema-check gate: Ajv (draft 2020-12) compiles
 * both generated schemas, and every document the runtime already accepts as
 * valid — the solver/validator fixtures, the demo apartment, and
 * `resolveViewerOptions`'s own defaults — validates against them too. The
 * schema is SYNTAX; `validateScene`/`resolveViewerOptions` are SEMANTICS
 * (unique ids, plan topology, catalogue references); this file is what keeps
 * the two layers from drifting apart, in either direction — a document the
 * validator accepts that the schema rejects is a bug in the generator or an
 * unwarranted `additionalProperties: false`, not a fixture to special-case.
 *
 * The fixtures are the documents this repository authors itself. A format
 * importer outside it holds the contract «an importer must land inside the
 * schema» with its own tests, which run `validateScene` over its output.
 *
 * `check.sh` also runs `schema-gen.ts --out <tmp>` as its own CLI smoke test
 * immediately before this file (both tiers — neither step touches Playwright
 * or a production build); this file regenerates the same schemas in-process
 * so it stays independently runnable as a plain `bun test`.
 */

import { describe, expect, test } from 'bun:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { z } from 'zod/mini';
import type { ValidateFunction } from 'ajv';
import { SCENE_SCHEMA_TARGET, VIEWER_OPTIONS_SCHEMA_TARGET, generateSchema } from './schema-gen.js';
import { lShapePlan, spawnlessLShapePlan, bayPlan } from '../src/fixtures/plan-l-shape.js';
import { apartmentScene } from '../src/demo/scene-data.js';
import { resolveViewerOptions } from '../src/app/viewer-options.js';
import { validateScene } from '../src/scene/scene-validator.js';
import { CATALOGUE_REGISTRIES } from '../src/assets/catalogue-registries.js';
import { draftOf } from '../src/shared/committed.js';
import { sceneSchema } from '../src/scene/types.schema.js';
import { createLogger, type LogEntry } from '../src/shared/logger.js';
import type { SceneData } from '../src/scene/types.js';

const FIXED_VERSION = '9.9.9-schema-check';

const ajv = new Ajv2020({ strict: true });
const SCENE_SCHEMA = generateSchema(SCENE_SCHEMA_TARGET, FIXED_VERSION);
const VIEWER_OPTIONS_SCHEMA = generateSchema(VIEWER_OPTIONS_SCHEMA_TARGET, FIXED_VERSION);
const validateSceneSchema: ValidateFunction = ajv.compile(SCENE_SCHEMA);
const validateOptionsSchema: ValidateFunction = ajv.compile(VIEWER_OPTIONS_SCHEMA);

/** Every scene document this repository already treats as valid ("every plan"). */
const SCENE_FIXTURES: Record<string, SceneData> = {
  lShapePlan,
  spawnlessLShapePlan,
  bayPlan,
  apartmentScene,
};

describe('Ajv 2020-12 compiles both generated schemas', () => {
  test('the scene schema compiles', () => {
    expect(typeof validateSceneSchema).toBe('function');
  });

  test('the viewer-options schema compiles', () => {
    expect(typeof validateOptionsSchema).toBe('function');
  });
});

describe('every fixture plan and the demo apartment validate against the generated scene schema', () => {
  for (const [name, scene] of Object.entries(SCENE_FIXTURES)) {
    test(`${name} validates`, () => {
      const ok = validateSceneSchema(scene);
      expect(ok, JSON.stringify(validateSceneSchema.errors, null, 2)).toBe(true);
    });
  }

  test('a document the semantic validator accepts is also accepted by the schema (the two layers agree)', () => {
    for (const scene of Object.values(SCENE_FIXTURES)) {
      // `validateScene` throws on a semantic problem; a plan already used by
      // the solver/validator test suite must pass it too, or this file is
      // testing a fixture the rest of the repository does not actually rely on.
      expect(() => validateScene(scene, CATALOGUE_REGISTRIES)).not.toThrow();
      expect(validateSceneSchema(scene)).toBe(true);
    }
  });
});

describe('resolveViewerOptions defaults validate against the viewer-options schema', () => {
  test('the resolved defaults (no partial given)', () => {
    const defaults = resolveViewerOptions();
    const ok = validateOptionsSchema(defaults);
    expect(ok, JSON.stringify(validateOptionsSchema.errors, null, 2)).toBe(true);
  });

  test('defaults merged with a representative partial', () => {
    const options = resolveViewerOptions({ view: { mode: 'tour' }, locale: 'ru', chrome: { brand: false } });
    const ok = validateOptionsSchema(options);
    expect(ok, JSON.stringify(validateOptionsSchema.errors, null, 2)).toBe(true);
  });
});

describe('a top-level `$schema` key is tolerated', () => {
  test('a scene document carrying `$schema` loads through the real validator with zero onLog entries', () => {
    const entries: LogEntry[] = [];
    const log = createLogger((entry) => entries.push(entry));
    const documentWithSchemaKey = { ...apartmentScene, $schema: `https://player.jeex.org/schema/scene/${FIXED_VERSION}.json` };
    expect(() => validateScene(documentWithSchemaKey, CATALOGUE_REGISTRIES, log)).not.toThrow();
    expect(entries).toEqual([]);
  });
});

/**
 * The third layer: the runtime Zod schema
 * (`src/scene/types.schema.ts`) and the published JSON Schema are the same
 * judge of a scene document.
 *
 * Two schemas of one document is a drift risk, not a redundancy: the JSON
 * Schema is generated from the TYPES, the Zod schema is hand-built beside
 * them, and only a test comparing their VERDICTS can prove they still say the
 * same thing. Fixtures alone would not — a schema that accepted everything
 * would pass those — so the same deliberately broken documents go through
 * both, and each must be refused twice.
 */
describe('the Zod schema and the published JSON Schema accept the same documents', () => {
  for (const [name, scene] of Object.entries(SCENE_FIXTURES)) {
    test(`${name}: both accept it`, () => {
      expect({ name, ajv: validateSceneSchema(scene), zod: z.safeParse(sceneSchema, scene).success }).toEqual({
        name,
        ajv: true,
        zod: true,
      });
    });
  }

  /** One thing wrong per document, each of a kind BOTH schemas can see: a missing required field, a closed set, a field's type, an id's grammar. */
  const REFUSED: readonly (readonly [string, () => unknown])[] = [
    [
      'a document with no schemaVersion',
      () => {
        const scene = draftOf(lShapePlan);
        delete (scene as { schemaVersion?: unknown }).schemaVersion;
        return scene;
      },
    ],
    ['a 1.x document, whose ids are not UUIDs', () => ({ ...draftOf(lShapePlan), schemaVersion: '1.2' })],
    ['a version this build does not read', () => ({ ...draftOf(lShapePlan), schemaVersion: '2.2' })],
    [
      'a wall id that is not a UUID v7',
      () => {
        const scene = draftOf(lShapePlan);
        scene.walls[0]!.id = 'w-s-a';
        return scene;
      },
    ],
    [
      'a wall end that is a UUID of another version (v4)',
      () => {
        const scene = draftOf(lShapePlan);
        scene.walls[0]!.a = '3b241101-e2bb-4255-8caf-4136c566a962';
        return scene;
      },
    ],
    [
      'a room camera keyed by a room name',
      () => {
        const scene = draftOf(lShapePlan);
        scene.roomCameras['living'] = scene.presentationCamera;
        return scene;
      },
    ],
    ['a painted face joined into a string key', () => ({ ...draftOf(lShapePlan), finishes: { faces: { 'a:w-part:L': 'sage' } } })],
    ['a unit that is not metres', () => ({ ...draftOf(lShapePlan), units: 'ft' })],
    [
      'a wall thickness that is a string',
      () => {
        const scene = draftOf(lShapePlan);
        (scene.walls[0] as unknown as Record<string, unknown>)['thickness'] = 'thick';
        return scene;
      },
    ],
    [
      'an opening of a kind the schema does not close over',
      () => {
        const scene = draftOf(lShapePlan);
        (scene.walls[0]!.openings![0] as unknown as Record<string, unknown>)['type'] = 'skylight';
        return scene;
      },
    ],
    [
      'a room with no anchor',
      () => {
        const scene = draftOf(lShapePlan);
        delete (scene.rooms[0] as { anchor?: unknown }).anchor;
        return scene;
      },
    ],
    [
      'a mirror axis written as false (schema 2.1 writes only true)',
      () => {
        const scene = draftOf(apartmentScene);
        (scene.assets[0] as unknown as Record<string, unknown>)['mirror'] = { x: false };
        return scene;
      },
    ],
  ];

  test('a schema 2.1 placement mirrored on x and z: both accept it', () => {
    const scene = draftOf(apartmentScene);
    (scene.assets[0] as unknown as Record<string, unknown>)['mirror'] = { x: true, z: true };
    expect({ ajv: validateSceneSchema(scene), zod: z.safeParse(sceneSchema, scene).success }).toEqual({ ajv: true, zod: true });
  });

  for (const [name, build] of REFUSED) {
    test(`${name}: both refuse it`, () => {
      const document = build();
      expect({ name, ajv: validateSceneSchema(document), zod: z.safeParse(sceneSchema, document).success }).toEqual({
        name,
        ajv: false,
        zod: false,
      });
    });
  }

  /**
   * `z.object` accepts a key it was not told about — which is what lets the
   * same document keep the keys the validator sections still read (the
   * «judge, never transform» rule) — while `schema-gen.ts` closes
   * every object type (`additionalProperties: false`). The exception is the
   * ONE key that gap should not apply to: `$schema`, the top-level key this
   * repository itself publishes on scene documents so editors can find the
   * schema. `schema-gen.ts` names it explicitly in
   * `definitions.SceneData.properties` (optional, string, never required),
   * so the published schema accepts it too; where the two part company is the
   * next test.
   */
  test('a document carrying the `$schema` key this repository publishes for editors is accepted by both', () => {
    const withSchemaKey = { ...apartmentScene, $schema: `https://player.jeex.org/schema/scene/${FIXED_VERSION}.json` };
    expect({ ajv: validateSceneSchema(withSchemaKey), zod: z.safeParse(sceneSchema, withSchemaKey).success }).toEqual({
      ajv: true,
      zod: true,
    });
  });

  /**
   * The teeth: `$schema` is named, not `additionalProperties` loosened. Any
   * OTHER unknown top-level key must still be refused by the published
   * schema (Ajv), even though the Zod schema — unchanged by that fix —
   * still tolerates it by design (the same «judge, never transform» rule
   * above).
   */
  test('an unknown top-level key that is not `$schema` is where the two part company', () => {
    const withOtherKey = { ...apartmentScene, notAPublishedKey: 'anything' };
    expect({ ajv: validateSceneSchema(withOtherKey), zod: z.safeParse(sceneSchema, withOtherKey).success }).toEqual({
      ajv: false,
      zod: true,
    });
  });
});
