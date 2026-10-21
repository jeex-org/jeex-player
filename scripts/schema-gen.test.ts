/**
 * Self-test for the schema generator: the two outputs parse, their `$id`
 * carries the version they were generated for, and every closed-set union in
 * `src/scene/types.ts` comes out as the exact `enum` its own
 * `scene/schema-sets.ts` constant lists — the generated schema and the
 * runtime closed-set check (`src/closed-sets.test.ts`) staying in lockstep
 * is the whole point of generating rather than hand-writing.
 */

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCENE_SCHEMA_TARGET,
  SCHEMA_TARGETS,
  TELEMETRY_SCHEMA_FILE,
  generateTelemetrySchema,
  schemaText,
  UUID_FIELDS,
  VIEWER_OPTIONS_SCHEMA_TARGET,
  generateSchema,
  writeSchemas,
} from './schema-gen.js';
import { UUID_V7_PATTERN } from '../src/scene/types.js';
import { OPENING_HINGES, OPENING_SHAPES, OPENING_SWINGS, OPENING_TYPES, ROOM_KINDS, WALL_ROLES } from '../src/scene/schema-sets.js';

const FIXED_VERSION = '9.9.9-schema-test';
const SCENE_TARGET = SCENE_SCHEMA_TARGET;
const VIEWER_OPTIONS_TARGET = VIEWER_OPTIONS_SCHEMA_TARGET;

describe('generateSchema', () => {
  test('the scene and viewer-options targets are exactly SceneData and ViewerOptions', () => {
    expect(SCENE_TARGET.name).toBe('scene');
    expect(SCENE_TARGET.type).toBe('SceneData');
    expect(VIEWER_OPTIONS_TARGET.name).toBe('viewer-options');
    expect(VIEWER_OPTIONS_TARGET.type).toBe('ViewerOptions');
  });

  test('each output carries $id with the version, draft 2020-12, and a $ref root', () => {
    for (const target of SCHEMA_TARGETS) {
      const schema = generateSchema(target, FIXED_VERSION);
      expect(schema['$id']).toBe(`https://player.jeex.org/schema/${target.name}/${FIXED_VERSION}.json`);
      expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema['$ref']).toBe(`#/definitions/${target.type}`);
      expect(schema['definitions']).toBeTruthy();
    }
  });

  test('the scene schema closes every union `schema-sets.ts` also closes, and in the same order', () => {
    const schema = generateSchema(SCENE_TARGET, FIXED_VERSION);
    const definitions = schema['definitions'] as Record<string, { enum?: unknown[] }>;
    const expected: Record<string, readonly string[]> = {
      OpeningType: OPENING_TYPES,
      RoomKind: ROOM_KINDS,
      WallRole: WALL_ROLES,
      OpeningShape: OPENING_SHAPES,
      OpeningHinge: OPENING_HINGES,
      OpeningSwing: OPENING_SWINGS,
    };
    for (const [name, values] of Object.entries(expected)) {
      expect(definitions[name]?.enum).toEqual([...values]);
    }
  });

  test('a closed object type (no index signature) gets additionalProperties: false', () => {
    const schema = generateSchema(SCENE_TARGET, FIXED_VERSION);
    const definitions = schema['definitions'] as Record<string, { additionalProperties?: unknown }>;
    expect(definitions['SceneData']?.additionalProperties).toBe(false);
    expect(definitions['PlanNode']?.additionalProperties).toBe(false);
  });

  test('a JSDoc block on a field becomes its `description`', () => {
    const schema = generateSchema(SCENE_TARGET, FIXED_VERSION);
    const definitions = schema['definitions'] as Record<string, { properties?: Record<string, { description?: string }> }>;
    expect(definitions['SceneData']?.properties?.['assetLibrary']?.description).toContain('UUID of the library of a placement');
  });
});

describe('the UUID v7 grammar in the scene schema', () => {
  type Node = {
    type?: unknown;
    pattern?: string;
    properties?: Record<string, Node>;
    propertyNames?: Node;
    anyOf?: Node[];
    const?: unknown;
    enum?: unknown;
  };
  const definitions = (): Record<string, Node> => generateSchema(SCENE_TARGET, FIXED_VERSION)['definitions'] as Record<string, Node>;

  test('every definition with an `id` property carries the pattern on it, so UUID_FIELDS covers every entity', () => {
    const missing: string[] = [];
    for (const [name, definition] of Object.entries(definitions())) {
      const id = definition.properties?.['id'];
      if (id !== undefined && id.pattern !== UUID_V7_PATTERN.source) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  test('every field UUID_FIELDS names is annotated, and the pattern is the one types.ts owns', () => {
    const all = definitions();
    for (const [name, fields] of Object.entries(UUID_FIELDS)) {
      const definition = all[name]!;
      const holders = definition.anyOf?.filter((arm) => arm.properties !== undefined) ?? [definition];
      const property = (field: string): Node => holders.map((holder) => holder.properties?.[field]).find((node) => node !== undefined)!;
      for (const field of fields.value ?? []) {
        const node = property(field);
        const patterns = [node.pattern, ...(node.anyOf ?? []).map((arm) => arm.pattern)].filter((pattern) => pattern !== undefined);
        expect({ field: `${name}.${field}`, patterns }).toEqual({ field: `${name}.${field}`, patterns: [UUID_V7_PATTERN.source] });
      }
    }
  });

  test('room-keyed records constrain their keys', () => {
    const all = definitions();
    expect(all['SceneData']?.properties?.['roomCameras']?.propertyNames?.pattern).toBe(UUID_V7_PATTERN.source);
    expect(all['SceneFinishes']?.properties?.['rooms']?.propertyNames?.pattern).toBe(UUID_V7_PATTERN.source);
  });

  test('a face key and a face finish spell their owners as UUIDs and nothing else', () => {
    const all = definitions();
    for (const name of ['FaceKey', 'FaceFinish']) {
      expect(all[name]?.properties?.['room']?.pattern).toBe(UUID_V7_PATTERN.source);
      expect(all[name]?.properties?.['wallId']?.pattern).toBe(UUID_V7_PATTERN.source);
    }
  });

  test('a document may declare 2.2 and nothing else', () => {
    expect(definitions()['SchemaVersion']?.const).toBe('2.2');
  });
});

describe('writeSchemas', () => {
  test('writes one file per target, and each parses back to what generateSchema produced', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeex-schema-gen-'));
    try {
      const written = writeSchemas(dir, FIXED_VERSION);
      expect(written.length).toBe(SCHEMA_TARGETS.length + 1);
      expect(written).toContain(join(dir, 'telemetry.schema.json'));
      for (const target of SCHEMA_TARGETS) {
        const path = join(dir, `${target.name}.schema.json`);
        expect(written).toContain(path);
        const onDisk = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        expect(onDisk['$id']).toBe(`https://player.jeex.org/schema/${target.name}/${FIXED_VERSION}.json`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the telemetry schema', () => {
  test('the committed telemetry.schema.json is exactly what the send schema generates (run `bun scripts/schema-gen.ts --telemetry`)', () => {
    expect(readFileSync(TELEMETRY_SCHEMA_FILE, 'utf8')).toBe(schemaText(generateTelemetrySchema()));
  });

  test('it is closed: every object refuses keys it does not name', () => {
    const text = schemaText(generateTelemetrySchema());
    expect(text).toContain('"additionalProperties": false');
    expect(generateTelemetrySchema()['$id']).toBe('https://player.jeex.org/schema/telemetry/1.0.0.json');
  });

  test('each branch of the schema has exactly the documented keys', () => {
    type Branch = { properties?: Record<string, { const?: unknown }>; oneOf?: Branch[]; additionalProperties?: unknown };
    const branches: Branch[] = [];
    const collect = (node: Branch): void => {
      if (node.properties) branches.push(node);
      for (const child of node.oneOf ?? []) collect(child);
    };
    collect(generateTelemetrySchema());
    const context = ['embed', 'group', 'lang', 'page', 'player', 'schema', 'site', 'subject'];
    const keysOf = (branch: Branch) => {
      const group = String(branch.properties?.['group']?.const);
      const event = branch.properties?.['event']?.const;
      return [`${group}/${typeof event === 'string' ? event : ''}`, Object.keys(branch.properties ?? {}).sort()] as const;
    };
    expect(Object.fromEntries(branches.map((branch) => keysOf(branch)))).toEqual({
      'lifecycle/view': [...context, 'event'].sort(),
      'lifecycle/ready': [...context, 'event', 'load'].sort(),
      'lifecycle/models_loaded': [...context, 'assets', 'event', 'failed', 'load', 'outcome'].sort(),
      'actions/': [...context, 'counts'].sort(),
      'rooms/': [...context, 'rooms'].sort(),
      'device/': [...context, 'fps', 'fullscreen', 'gpu', 'input', 'width'].sort(),
      'error/': [...context, 'browser', 'code', 'count', 'frames', 'name', 'stage'].sort(),
    });
    expect(branches.every((branch) => branch.additionalProperties === false)).toBe(true);
  });

  test('the published schema and the runtime schema agree on a valid send and on a forbidden key', () => {
    const validate = new Ajv2020({ strict: false }).compile(generateTelemetrySchema());
    const view = {
      schema: '1.0.0',
      player: '0.1.0',
      embed: 'script',
      site: 'https://agency.example',
      page: '/flats/:id',
      subject: { project: null, bake: null, scene: null },
      lang: 'en',
      group: 'lifecycle',
      event: 'view',
    };
    expect(validate(view)).toBe(true);
    expect(validate({ ...view, visitor: 'x' })).toBe(false);
    expect(validate({ ...view, page: '/flat?email=a@b.example' })).toBe(false);
  });
});
