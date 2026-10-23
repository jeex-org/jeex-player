import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { z } from 'zod/mini';
import type { TourCheckpoint } from './types.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { apartmentScene } from '../demo/scene-data.js';
import { bayPlan, lShapePlan, spawnlessLShapePlan } from '../fixtures/plan-l-shape.js';
import { collectLogger } from '../fixtures/stubs.js';
import { draftOf } from '../shared/committed.js';
import { SceneValidationError } from '../shared/errors.js';
import { issuePath } from '../shared/schema-issues.js';
import { parseSceneOps } from './scene-parse.js';
import { validateScene } from './scene-validator.js';
import { sceneOpSchema, sceneOpsIssues, sceneSchema, sceneShapeIssues } from './types.schema.js';
import type { Draft } from '../shared/committed.js';
import type { Opening, SceneData, SceneOp, Wall } from './types.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { ARCHETYPE, OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { LIBRARY_FINISH } from '../fixtures/library-finishes.js';

const WALL = L_SHAPE.wall;
const OPENING = L_SHAPE.opening;
const ROOM = L_SHAPE.room;
const NODE = L_SHAPE.node;

/** Ids this file adds: entities the L-shape fixture does not have. */
const EXTRA = {
  missingNode: '01a12ff4-f1bd-7992-9ff4-916499104e85',
  missingRoom: '01a12ff4-f1be-7722-ba5a-0ab789ff69cd',
  missingWall: '01a12ff4-f1bf-7ff9-b257-f5bceb40c79e',
  missingAsset: '01a12ff4-f1c0-7416-b25c-bd288002a814',
  missingLibrary: '01a12ff3-28cd-7a6e-9c2b-8d71e4f0a35c',
  preset: '01a12ff4-f1c1-74bc-88b4-5f039b23fe21',
  checkpoint: '01a12ff4-f1c2-7cf0-81ae-b2c127076dd9',
  farNodeA: '01a12ff4-f1c3-7794-b2a5-1a3c0ec2aab2',
  farNodeB: '01a12ff4-f1c4-78bd-b416-be87f9661e92',
  farWall: '01a12ff4-f1c5-7b62-aed0-6c647adc5fb5',
  newNode: '01a12ff4-f1c6-7339-9e06-93838fe7b320',
  newWallLeft: '01a12ff4-f1c7-7c74-b0c0-34d08f264296',
  newWallRight: '01a12ff4-f1c8-7320-9edd-fc9b9dd3485a',
} as const;

/** The sentence a 1.x document is refused with, by the schema and the shape gate alike. */
const SCHEMA_1X = 'schemaVersion must be 2.x';

/**
 * Every API fact the schemas build on, asserted against the INSTALLED `zod`
 * rather than against memory. A fact that stops holding fails
 * here, in one place, instead of in whichever schema happened to lean on it.
 */
describe('Zod 4.6 API facts the schemas rely on', () => {
  test('the parse call in zod/mini is the top-level function form', () => {
    const schema = z.string();
    expect(z.safeParse(schema, 'ok')).toMatchObject({ success: true, data: 'ok' });
    expect(z.safeParse(schema, 7).success).toBe(false);
    // The method form exists on a mini schema too; the schemas spell the
    // functional one everywhere, because that is the form `zod/mini` is built
    // around and the one that stays tree-shakeable.
    expect(typeof schema.safeParse).toBe('function');
  });

  /**
   * `z.number()` here means FINITE number: `NaN` and both infinities are
   * refused as `invalid_type`. That is exactly what `validate/shape.ts` means
   * by `Number.isFinite`, so the schema and the hand-written gate agree with
   * no extra check. (An importer that must accept `NaN` — a Sweet Home 3D
   * file yields it for a missing attribute — needs
   * `z.union([z.number(), z.nan()])` in its own raw-number schema.)
   */
  test('z.number() means finite: it refuses NaN and both infinities', () => {
    const schema = z.number();
    expect(z.safeParse(schema, 1.5).success).toBe(true);
    expect(z.safeParse(schema, Number.NaN).success).toBe(false);
    expect(z.safeParse(schema, Number.POSITIVE_INFINITY).success).toBe(false);
    expect(z.safeParse(schema, Number.NEGATIVE_INFINITY).success).toBe(false);
  });

  test('z.nan() exists and accepts only NaN', () => {
    const schema = z.nan();
    expect(z.safeParse(schema, Number.NaN).success).toBe(true);
    expect(z.safeParse(schema, 1).success).toBe(false);
  });

  test('z.enum accepts a readonly string array', () => {
    const values = ['m', 'cm'] as const satisfies readonly string[];
    const schema = z.enum(values);
    expect(z.safeParse(schema, 'cm').success).toBe(true);
    expect(z.safeParse(schema, 'ft').success).toBe(false);
  });

  test('z.discriminatedUnion takes the key as its first argument', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.number() }),
      z.object({ kind: z.literal('b'), b: z.string() }),
    ]);
    expect(z.safeParse(schema, { kind: 'b', b: 'x' }).success).toBe(true);
    expect(z.safeParse(schema, { kind: 'b', b: 1 }).success).toBe(false);
  });

  test('z.refine works inside .check()', () => {
    const schema = z.string().check(z.refine((value) => value.startsWith('j'), { error: 'must start with j' }));
    expect(z.safeParse(schema, 'jeex').success).toBe(true);
    const refused = z.safeParse(schema, 'nope');
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe('must start with j');
  });

  test('z.optional leaves an absent key absent rather than present-and-undefined', () => {
    const schema = z.object({ name: z.optional(z.string()) });
    const parsed = z.safeParse(schema, {});
    expect(parsed.success).toBe(true);
    expect(Object.hasOwn(parsed.data as object, 'name')).toBe(false);
  });
});

/** The paths of every issue, in the order the schema reported them. */
function pathsOf(value: unknown): string[] {
  return sceneShapeIssues(value).map((issue) => issuePath(issue));
}

/** `scene` with one field replaced, without the readonly type getting in the way. */
function withField(scene: SceneData, field: string, value: unknown): Record<string, unknown> {
  return { ...(scene as unknown as Record<string, unknown>), [field]: value };
}

/** `scene` without one field at all — not the same thing as one set to `undefined`. */
function withoutField(scene: SceneData, field: string): Record<string, unknown> {
  const copy = { ...(scene as unknown as Record<string, unknown>) };
  delete copy[field];
  return copy;
}

describe('sceneShapeIssues — the documents this build already reads', () => {
  for (const [name, scene] of [
    ['lShapePlan', lShapePlan],
    ['spawnlessLShapePlan', spawnlessLShapePlan],
    ['bayPlan', bayPlan],
    ['apartmentScene', apartmentScene],
  ] as const) {
    test(`${name} is shaped like a scene`, () => {
      expect({ name, issues: pathsOf(scene) }).toEqual({ name, issues: [] });
    });
  }

  test('a document that declares neither units nor storey is shaped like a scene', () => {
    const bare: Record<string, unknown> = withoutField(lShapePlan, 'units');
    delete bare['storey'];
    expect(pathsOf(bare)).toEqual([]);
  });
});

describe('sceneShapeIssues — what it refuses, and where', () => {
  test('a unit that is not metres', () => {
    expect(pathsOf(withField(lShapePlan, 'units', 'ft'))).toEqual(['units']);
  });

  test('a storey that is not an object', () => {
    expect(pathsOf(withField(lShapePlan, 'storey', 'Level 1'))).toEqual(['storey']);
  });

  test('a storey name longer than 64 characters', () => {
    expect(pathsOf(withField(lShapePlan, 'storey', { name: 'x'.repeat(65) }))).toEqual(['storey.name']);
  });

  test('a storey elevation that is not a finite number', () => {
    expect(pathsOf(withField(lShapePlan, 'storey', { elevation: Number.NaN }))).toEqual(['storey.elevation']);
  });

  test('fewer than three plan nodes', () => {
    expect(pathsOf(withField(lShapePlan, 'nodes', [{ id: NODE.n1 }, { id: NODE.n2 }]))).toEqual(['nodes']);
  });

  test.each(['1.1', '1.2'])('a %s document, with the sentence the shape gate says it with', (version) => {
    const issues = sceneShapeIssues(withField(lShapePlan, 'schemaVersion', version));
    expect(issues.map((issue) => issuePath(issue))).toEqual(['schemaVersion']);
    expect(issues[0]!.message).toContain(SCHEMA_1X);
  });

  test('a scene id that is not a UUID v7', () => {
    expect(pathsOf(withField(lShapePlan, 'id', 'test-l-shape'))).toEqual(['id']);
  });

  test('null is refused at the root, with an empty path', () => {
    expect(pathsOf(null)).toEqual(['']);
  });

  test('a scene document is not a bare object', () => {
    const issues = sceneShapeIssues({});
    expect(issues.length).toBeGreaterThan(0);
    expect(issuePath(issues[0]!)).toBe('schemaVersion');
  });

  /**
   * The order is the CONTRACT: `validate/shape.ts` checks `schemaVersion`
   * before `nodes` and reports the first refusal, so a document broken in both
   * places must still answer `schemaVersion` — so one implementation can
   * replace the other without a host seeing a different rule.
   */
  test('issues arrive in declaration order, so the first one is the one shape.ts would report', () => {
    const broken = { ...withField(lShapePlan, 'schemaVersion', '1.3'), nodes: [] };
    expect(pathsOf(broken)).toEqual(['schemaVersion', 'nodes']);
  });
});

describe('the schema judges and never transforms', () => {
  test('it declares no transform, default or catch', async () => {
    const text = await Bun.file(new URL('./types.schema.ts', import.meta.url)).text();
    const code = text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
    for (const forbidden of ['.transform(', '.default(', '.catch(', 'z.transform', 'z.catch', 'z.prefault']) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({ forbidden, present: false });
    }
  });

  test('a valid document is unchanged by being judged: the caller keeps its own object', () => {
    const before = JSON.stringify(lShapePlan);
    expect(sceneShapeIssues(lShapePlan)).toEqual([]);
    expect(JSON.stringify(lShapePlan)).toBe(before);
  });
});

/**
 * The whole document, and the compile-time proof that the schema and the
 * hand-written `SceneData` describe one shape.
 *
 * The agreement lives HERE and not in `scene/types.ts`: a check there would
 * need `typeof sceneSchema`, and even a type-only edge back into the schema
 * closes a cycle `check:arch` refuses (`dependency-cruiser` runs with
 * `tsPreCompilationDeps`). `types.ts` names its twin in prose instead.
 */
type StripUndefined<T> = T extends undefined ? never : T;

/**
 * Strips `readonly` recursively and drops an explicit `| undefined`, exactly
 * as `raw-plan.schema.test.ts` does and for the same reason: `z.infer` is
 * mutable, `SceneData` is not, and neither difference is one a caller can
 * observe.
 *
 * The primitive branch comes FIRST, which that file does not need and this one
 * does: `DemoAssetType` is `(string & {}) | 'sofa' | …` — the open-union idiom
 * that keeps the literals in a completion list — and the intersection member
 * takes the OBJECT branch of a plain `T extends object` test, coming back as a
 * mapped type over `string`'s own keys. `string` is then no longer assignable
 * to it and the whole document reads as a disagreement, in `assets[].type`,
 * over a distinction that does not exist.
 */
type Canonical<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? Canonical<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: StripUndefined<Canonical<T[K]>> }
      : T;

type Agrees<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _document: Agrees<Canonical<z.infer<typeof sceneSchema>>, Canonical<SceneData>> = true;
void _document;

/**
 * The op vocabulary's own agreement, checked directly on `sceneOpSchema`
 * rather than only through `_document`'s detour via `interiors[].ops`: a new
 * operation (`ops/cameras.ts`'s `set_camera`, `set_navigation`,
 * `set_autotour`) fails to compile here the moment its schema and its
 * hand-written type disagree, without needing a scene document that happens
 * to carry a preset built from it.
 */
const _ops: Agrees<Canonical<z.infer<typeof sceneOpSchema>>, Canonical<SceneOp>> = true;
void _ops;

/** The paths of every issue `sceneSchema` found, in the order it reported them. */
function documentPaths(value: unknown): string[] {
  const result = z.safeParse(sceneSchema, value);
  if (result.success) return [];
  return result.error.issues.map((issue) =>
    issuePath({ path: issue.path.map((step) => (typeof step === 'symbol' ? step.toString() : step)), message: issue.message }),
  );
}

describe('sceneSchema — the documents this build already reads', () => {
  for (const [name, scene] of [
    ['lShapePlan', lShapePlan],
    ['spawnlessLShapePlan', spawnlessLShapePlan],
    ['bayPlan', bayPlan],
    ['apartmentScene', apartmentScene],
  ] as const) {
    test(`${name} is a whole scene document`, () => {
      expect({ name, issues: documentPaths(scene) }).toEqual({ name, issues: [] });
    });
  }

  test('a document carrying a top-level $schema is accepted (schema-check.test.ts:108-116)', () => {
    expect(documentPaths({ ...apartmentScene, $schema: 'https://player.jeex.org/schema/scene/0.1.0.json' })).toEqual([]);
  });

  test('a document that declares neither units nor storey is a whole scene document', () => {
    const bare: Record<string, unknown> = withoutField(lShapePlan, 'units');
    delete bare['storey'];
    expect(documentPaths(bare)).toEqual([]);
  });
});

describe('sceneSchema — site (schema 2.3)', () => {
  const at = (site: unknown, schemaVersion = '2.3'): unknown => ({ ...withField(lShapePlan, 'site', site), schemaVersion });

  test('a 2.3 document with a valid site, or none, is a whole scene document', () => {
    for (const site of [{ northDeg: 30, sun: 'evening' }, {}, { sun: 'noon' }, undefined]) {
      expect(documentPaths(at(site))).toEqual([]);
      expect(pathsOf(at(site))).toEqual([]);
    }
  });

  test.each([
    ['an unknown key', { north_deg: 30 }, 'site'],
    ['a NaN north', { northDeg: Number.NaN }, 'site.northDeg'],
    ['a string north', { northDeg: '30' }, 'site.northDeg'],
    ['an infinite north', { northDeg: Number.NEGATIVE_INFINITY }, 'site.northDeg'],
    ['an unknown preset', { sun: 'night' }, 'site.sun'],
    ['null', null, 'site'],
    ['an array', [], 'site'],
    ['a number', 5, 'site'],
  ])('%s is refused at its field', (_name, site, path) => {
    expect(documentPaths(at(site))).toEqual([path]);
    expect(pathsOf(at(site))).toEqual([path]);
  });

  test('an unknown key is named in the message', () => {
    const result = z.safeParse(sceneSchema, at({ north_deg: 30 }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('north_deg');
  });

  test('a 2.2 document carrying a site is refused at site, naming the version', () => {
    expect(documentPaths(at({ northDeg: 0 }, '2.2'))).toEqual(['site']);
    expect(pathsOf(at({ northDeg: 0 }, '2.2'))).toEqual(['site']);
    const result = z.safeParse(sceneSchema, at({ northDeg: 0 }, '2.2'));
    expect(result.error?.issues[0]?.message).toContain('2.3');
  });
});

describe('scene schema versions 2.2 and 2.3', () => {
  test('a 2.2 and a 2.3 document are both read, by the schema and by the shape gate', () => {
    for (const version of ['2.2', '2.3']) {
      const document = withField(lShapePlan, 'schemaVersion', version);
      expect({ version, schema: documentPaths(document), shape: sceneShapeIssues(document) }).toEqual({ version, schema: [], shape: [] });
    }
  });

  test('2.4 is refused, and the refusal names both readable versions', () => {
    const document = withField(lShapePlan, 'schemaVersion', '2.4');
    const result = z.safeParse(sceneSchema, document);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Unsupported scene schema; expected '2.2' or '2.3'");
  });
});

describe('sceneSchema — finish values (schema 2.3)', () => {
  const M = LIBRARY_FINISH.paint;
  const FACE = { room: ROOM.a, wallId: WALL.wPart, side: 'L' } as const;

  /** `lShapePlan` as 2.3 with `value` at one of the six finish places. */
  const at = (place: string, value: unknown): Record<string, unknown> => {
    const finishes =
      place === 'facade'
        ? { facade: value }
        : place === 'face'
          ? { faces: [{ ...FACE, finish: value }] }
          : { rooms: { [ROOM.a]: { [place]: value } } };
    return { ...withField(lShapePlan, 'schemaVersion', '2.3'), finishes };
  };
  /** Where an issue lands for `place`. */
  const pathAt = (place: string): string =>
    place === 'facade' ? 'finishes.facade' : place === 'face' ? 'finishes.faces[0].finish' : `finishes.rooms.${ROOM.a}.${place}`;
  const PLACES = ['floor', 'walls', 'ceiling', 'trim', 'facade', 'face'] as const;

  test('the bare UUID and an object with colour, rotation or both are accepted at all six places', () => {
    for (const place of PLACES) {
      for (const value of [
        M,
        { material: M, colour: '#c9d6df' },
        { material: M, rotation: 90 },
        { material: M, colour: '#D8CBB5', rotation: -45 },
      ]) {
        expect({ place, value, issues: documentPaths(at(place, value)) }).toEqual({ place, value, issues: [] });
      }
    }
  });

  test('a modifier-free object is refused at its place, saying to use the bare UUID', () => {
    for (const place of PLACES) {
      const result = z.safeParse(sceneSchema, at(place, { material: M }));
      const issues = result.error?.issues ?? [];
      expect({ place, paths: documentPaths(at(place, { material: M })) }).toEqual({ place, paths: [pathAt(place)] });
      expect(JSON.stringify(issues)).toContain('use the bare UUID');
    }
  });

  test('an unknown key, a colour that is not #rrggbb, a rotation that is not finite and a material that is not a UUID v7 are refused', () => {
    for (const place of PLACES) {
      for (const value of [
        { material: M, colour: '#c9d6df', scale: 2 },
        { material: M, colour: 'beige' },
        { material: M, colour: '#abc' },
        { material: M, rotation: Number.POSITIVE_INFINITY },
        { material: M, rotation: Number.NaN },
        { material: M, rotation: '90' },
        { material: 'oak', colour: '#c9d6df' },
      ]) {
        expect({ place, value, refused: documentPaths(at(place, value)).length > 0 }).toEqual({ place, value, refused: true });
      }
    }
  });

  test('a room carries ceiling and trim beside floor and walls', () => {
    const finishes = {
      rooms: { [ROOM.a]: { floor: FINISH.oak, walls: FINISH.sand, ceiling: FINISH.sand, trim: { material: M, colour: '#ffffff' } } },
    };
    expect(documentPaths({ ...withField(lShapePlan, 'schemaVersion', '2.3'), finishes })).toEqual([]);
  });
});

describe('sceneOpSchema — the two set_material forms', () => {
  const M = LIBRARY_FINISH.paint;
  const opIssues = (op: unknown): number => sceneOpsIssues([op]).length;

  test('the explicit form parses with room, with face and with neither', () => {
    expect(opIssues({ op: 'set_material', surface: 'ceiling', room: ROOM.a, material: M, colour: '#c9d6df' })).toBe(0);
    expect(
      opIssues({ op: 'set_material', surface: 'wall', face: { room: ROOM.a, wallId: WALL.wPart, side: 'L' }, material: M, rotation: 90 }),
    ).toBe(0);
    expect(opIssues({ op: 'set_material', surface: 'facade', material: M })).toBe(0);
  });

  test('the legacy form still parses', () => {
    expect(opIssues({ op: 'set_material', target: 'floors', material: FINISH.oak })).toBe(0);
    expect(
      opIssues({ op: 'set_material', target: { room: ROOM.a, wallId: WALL.wPart, side: 'L' }, material: FINISH.sand, scope: 'room' }),
    ).toBe(0);
  });

  test('both target and surface, an unknown surface word and a malformed colour are refused', () => {
    expect(opIssues({ op: 'set_material', surface: 'wall', target: 'walls', material: M })).toBeGreaterThan(0);
    expect(opIssues({ op: 'set_material', surface: 'roof', material: M })).toBeGreaterThan(0);
    expect(opIssues({ op: 'set_material', surface: 'wall', material: M, colour: '#abc' })).toBeGreaterThan(0);
  });
});

describe('sceneSchema — UUID v7 ids and face keys', () => {
  test('a v4 UUID is refused where an entity id belongs', () => {
    const v4 = '3b241101-e2bb-4255-8caf-4136c566a962';
    const scene = draftOf(lShapePlan);
    put(scene.rooms[0]!, 'id', v4);
    expect(documentPaths(scene)).toEqual(['rooms[0].id']);
  });

  test('a room camera keyed by something other than a room UUID is refused', () => {
    const scene = draftOf(lShapePlan);
    put(scene.roomCameras, 'living', draftOf(lShapePlan.presentationCamera));
    expect(documentPaths(scene).length).toBeGreaterThan(0);
  });

  test('a face finish carries exactly its face and its finish', () => {
    const face = { room: ROOM.a, wallId: WALL.wPart, side: 'L', finish: FINISH.sage };
    expect(documentPaths({ ...lShapePlan, finishes: { faces: [face] } })).toEqual([]);
    expect(documentPaths({ ...lShapePlan, finishes: { faces: [{ ...face, faceId: 'a:w:L' }] } })).toEqual(['finishes.faces[0]']);
    expect(documentPaths({ ...lShapePlan, finishes: { faces: [{ ...face, side: 'X' }] } })).toEqual(['finishes.faces[0].side']);
    expect(documentPaths({ ...lShapePlan, finishes: { faces: { [`${ROOM.a}/${WALL.wPart}/L`]: FINISH.sage } } })).toEqual([
      'finishes.faces',
    ]);
  });
});

/* ------------------------------------------------------ the rule table --- */

/**
 * Every rule `validateScene` can refuse a document with, and whether the
 * SCHEMA can refuse the same document.
 *
 * `structural` means the schema catches the weakest violation of that rule, so
 * a compiled schema could take the rule over; `semantic` means it does not, so
 * the rule stays code. The document of each case is deliberately the MOST
 * benign input the rule still refuses (a thickness of 0.9 rather than the
 * string `'thick'`, a one-point polygon rather than a number): a rule counts as
 * structural only when even that input fails the schema.
 *
 * This is the table a swap of the shape gate rests on, which is why the rule
 * inventory is read from the validator's own sources — a rule added to any
 * section and not classified here fails the first test below.
 */
type RuleCase = {
  readonly rule: string;
  readonly kind: 'structural' | 'semantic';
  /** A document that makes `validateScene` refuse with exactly `rule`. */
  readonly document: () => unknown;
};

/** `lShapePlan` with exactly one thing broken; every case starts from a document the validator accepts. */
function brokenScene(mutate: (scene: Draft<SceneData>) => void): unknown {
  const scene = draftOf(lShapePlan);
  mutate(scene);
  return scene;
}

/** Writes a value the field's declared type forbids — which is what a shape test is about. */
function put(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

function wallOf(scene: Draft<SceneData>, id: string): Draft<Wall> {
  const found = scene.walls.find((wall) => wall.id === id);
  if (!found) throw new Error(`fixture has no wall ${id}`);
  return found;
}

function openingOf(scene: Draft<SceneData>, wallId: string, openingId: string): Draft<Opening> {
  const found = wallOf(scene, wallId).openings?.find((opening) => opening.id === openingId);
  if (!found) throw new Error(`fixture has no opening ${openingId}`);
  return found;
}

/** A preset that applies cleanly over the L-shape fixture (`scene-validator.test.ts`'s own). */
function soundPreset(): Record<string, unknown> {
  return {
    id: EXTRA.preset,
    name: 'Warm walnut',
    swatch: [FINISH.walnut, FINISH.terra],
    ops: [{ op: 'set_material', target: ROOM.a, material: FINISH.walnut }],
  };
}

/** A tour checkpoint the validator has nothing to say about — eye height, inside the plan. */
function soundCheckpoint(): TourCheckpoint {
  return { id: EXTRA.checkpoint, position: { x: 1.5, y: 1.6, z: 1.5 }, yaw: 0, pitch: -0.1 };
}

const RULE_CASES: readonly RuleCase[] = [
  // ---- validate/shape.ts: the thirteen the shape gate already proves
  { rule: 'scene-not-object', kind: 'structural', document: () => null },
  { rule: 'schema-version-1x', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'schemaVersion', '1.2')) },
  { rule: 'schema-version-unsupported', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'schemaVersion', '2.1')) },
  { rule: 'units-unsupported', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'units', 'ft')) },
  { rule: 'storey-invalid', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'storey', { name: '' })) },
  {
    rule: 'site-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => Object.assign(scene, { schemaVersion: '2.3', site: { sun: 'night' } })),
  },
  { rule: 'scene-identity-missing', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'id', '')) },
  { rule: 'ceiling-height-invalid', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'ceilingHeight', 1.5)) },
  { rule: 'nodes-too-few', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'nodes', scene.nodes.slice(0, 2))) },
  { rule: 'walls-too-few', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'walls', scene.walls.slice(0, 3))) },
  { rule: 'rooms-missing', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'rooms', [])) },
  { rule: 'materials-not-array', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'materials', {})) },
  { rule: 'assets-not-array', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'assets', {})) },
  { rule: 'camera-data-missing', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'navigation', undefined)) },

  // ---- validate/context.ts (and the scene id in shape.ts): the id registry and the shared checks
  {
    rule: 'id-invalid',
    kind: 'structural',
    // A UUID of the wrong version is the most benign id the grammar refuses.
    document: () => brokenScene((scene) => put(scene.nodes[0]!, 'id', '3b241101-e2bb-4255-8caf-4136c566a962')),
  },
  { rule: 'id-duplicate', kind: 'semantic', document: () => brokenScene((scene) => put(scene.nodes[1]!, 'id', NODE.n1)) },
  { rule: 'pose-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'presentationCamera', 5)) },
  {
    rule: 'pose-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.presentationCamera.position, 'x', Number.NaN)),
  },
  { rule: 'finish-unknown', kind: 'semantic', document: () => brokenScene((scene) => put(scene.rooms[0]!, 'floorMaterial', 'unobtanium')) },
  {
    rule: 'finish-wrong-family',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.rooms[0]!, 'floorMaterial', FINISH.terra)),
  },
  {
    rule: 'finish-invalid',
    kind: 'structural',
    document: () =>
      brokenScene((scene) => {
        put(scene, 'schemaVersion', '2.3');
        put(scene, 'finishes', { facade: { material: FINISH.sand, colour: 'beige' } });
      }),
  },
  {
    rule: 'finish-needs-schema-2-3',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene, 'finishes', { rooms: { [ROOM.a]: { ceiling: FINISH.sand } } })),
  },
  {
    rule: 'finish-modifiers-need-library',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => {
        put(scene, 'schemaVersion', '2.3');
        put(scene, 'finishes', { facade: { material: FINISH.sand, colour: '#c9d6df' } });
      }),
  },

  // ---- validate/plan-entities.ts
  { rule: 'node-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene.nodes, '0', 5)) },
  { rule: 'node-coordinates-invalid', kind: 'structural', document: () => brokenScene((scene) => put(scene.nodes[0]!.p, 'x', Number.NaN)) },
  { rule: 'material-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene.materials!, '0', 5)) },
  { rule: 'material-name-missing', kind: 'structural', document: () => brokenScene((scene) => put(scene.materials![0]!, 'name', '')) },
  {
    rule: 'material-colour-missing',
    kind: 'structural',
    // The whole entry is replaced rather than the one field written by name:
    // the wire format spells that field the American way, and
    // a bare quoted key would read to `spelling-check.ts` as a spelling this
    // file chose rather than one `scene.json` forces.
    document: () => brokenScene((scene) => put(scene.materials!, '0', { ...scene.materials![0]!, color: '' })),
  },
  {
    rule: 'material-roughness-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.materials![0]!, 'roughness', Number.NaN)),
  },
  {
    rule: 'material-metalness-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.materials![0]!, 'metalness', Number.NaN)),
  },
  { rule: 'room-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene.rooms, '0', 5)) },
  { rule: 'room-name-missing', kind: 'structural', document: () => brokenScene((scene) => put(scene.rooms[0]!, 'name', '')) },
  { rule: 'room-anchor-invalid', kind: 'structural', document: () => brokenScene((scene) => put(scene.rooms[0]!.anchor, 'x', Number.NaN)) },
  { rule: 'room-kind-unknown', kind: 'structural', document: () => brokenScene((scene) => put(scene.rooms[0]!, 'kind', 'kitchen')) },
  {
    rule: 'room-polygon-invalid',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.rooms[0]!, 'polygon', [{ x: 0, z: 0 }])),
  },

  // ---- validate/walls.ts: the wall's own fields
  { rule: 'wall-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene.walls, '0', 5)) },
  {
    rule: 'wall-role-unknown',
    kind: 'structural',
    document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA), 'role', 'load-bearing')),
  },
  { rule: 'wall-endpoints-invalid', kind: 'structural', document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA), 'a', 5)) },
  {
    rule: 'wall-unknown-node',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA), 'a', EXTRA.missingNode)),
  },
  { rule: 'wall-self-loop', kind: 'semantic', document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA), 'b', NODE.n1)) },
  {
    rule: 'wall-thickness-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA), 'thickness', Number.NaN)),
  },
  {
    rule: 'wall-thickness-range',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA), 'thickness', 0.9)),
  },
  {
    rule: 'arc-radius-invalid',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA), 'arc', { radius: 0, ccw: false })),
  },
  {
    rule: 'arc-radius-below-half-chord',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA), 'arc', { radius: 0.5, ccw: false })),
  },
  {
    rule: 'wall-centreline-too-short',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) =>
        put(
          scene.nodes.find((node) => node.id === NODE.n2)!,
          'p',
          { x: 0.2, z: 0 },
        ),
      ),
  },

  // ---- validate/walls.ts: one opening
  {
    rule: 'opening-not-object',
    kind: 'structural',
    document: () => brokenScene((scene) => put(wallOf(scene, WALL.wSA).openings!, '0', 5)),
  },
  {
    rule: 'opening-type-unknown',
    kind: 'structural',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.doorEntry), 'type', 'skylight')),
  },
  {
    rule: 'opening-width-invalid',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.doorEntry), 'width', 0)),
  },
  {
    rule: 'opening-outside-wall',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.doorEntry), 'width', 40)),
  },
  {
    rule: 'opening-sill-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'sill', Number.NaN)),
  },
  {
    rule: 'opening-head-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'head', Number.NaN)),
  },
  {
    rule: 'opening-sill-head-order',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'sill', 2.4)),
  },
  {
    rule: 'opening-head-above-ceiling',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'head', 3.13)),
  },
  {
    rule: 'door-sill-not-floor',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.doorEntry), 'sill', 0.2)),
  },
  {
    rule: 'opening-shape-unknown',
    kind: 'structural',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.doorEntry), 'shape', 'round')),
  },
  {
    rule: 'opening-entrance-not-boolean',
    kind: 'structural',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'entrance', 'yes')),
  },
  {
    rule: 'opening-entrance-not-door',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'entrance', true)),
  },
  {
    rule: 'opening-second-entrance',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wPart, OPENING.doorAb), 'entrance', true)),
  },
  {
    rule: 'opening-hinge-unknown',
    kind: 'structural',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.doorEntry), 'hinge', 'c')),
  },
  {
    rule: 'opening-hinge-not-door',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'hinge', 'a')),
  },
  {
    rule: 'opening-swing-unknown',
    kind: 'structural',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.doorEntry), 'swing', 'sideways')),
  },
  {
    rule: 'opening-swing-not-door',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'swing', 'in')),
  },
  {
    rule: 'opening-variant-unknown',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.doorEntry), 'variant', 'door-unobtanium')),
  },
  {
    rule: 'opening-variant-family',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'variant', OPENING_VARIANT.door_glass_slim)),
  },
  {
    rule: 'openings-overlap',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(openingOf(scene, WALL.wSA, OPENING.windowASouth), 'center', 2)),
  },

  // ---- validate/assets.ts: painted overrides
  { rule: 'finishes-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'finishes', 5)) },
  {
    rule: 'finishes-unknown-room',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene, 'finishes', { rooms: { [EXTRA.missingRoom]: { walls: FINISH.sage } } })),
  },
  {
    rule: 'finishes-room-not-object',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene, 'finishes', { rooms: { [ROOM.a]: 5 } })),
  },
  {
    rule: 'finishes-faces-not-array',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene, 'finishes', { faces: {} })),
  },
  {
    rule: 'finishes-unknown-face',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) =>
        put(scene, 'finishes', { faces: [{ room: ROOM.a, wallId: EXTRA.missingWall, side: 'L', finish: FINISH.sage }] }),
      ),
  },
  {
    rule: 'finishes-duplicate-face',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => {
        const face = { room: ROOM.a, wallId: WALL.wPart, side: 'L', finish: FINISH.sage };
        put(scene, 'finishes', { faces: [face, { ...face, finish: FINISH.terra }] });
      }),
  },

  // ---- validate/assets.ts: placements
  {
    rule: 'scene-asset-library-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene, 'assetLibrary', 'starter:interior-v1')),
  },
  {
    rule: 'scene-unknown-asset-library',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene, 'assetLibrary', EXTRA.missingLibrary)),
  },
  { rule: 'asset-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene.assets, '0', 5)) },
  { rule: 'asset-type-missing', kind: 'structural', document: () => brokenScene((scene) => put(scene.assets[0]!, 'type', '')) },
  {
    rule: 'asset-position-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.assets[0]!.position, 'x', Number.NaN)),
  },
  {
    rule: 'asset-rotation-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'rotationY', Number.NaN)),
  },
  { rule: 'asset-scale-invalid', kind: 'semantic', document: () => brokenScene((scene) => put(scene.assets[0]!, 'scale', 0)) },
  {
    rule: 'asset-mirror-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'mirror', { x: false })),
  },
  {
    rule: 'asset-unknown-room',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'room', EXTRA.missingRoom)),
  },
  {
    rule: 'asset-reference-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'asset', `starter:interior-v1:${ARCHETYPE.sofa_3s}`)),
  },
  {
    rule: 'asset-library-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'library', 'starter:interior-v1')),
  },
  { rule: 'asset-variant-invalid', kind: 'structural', document: () => brokenScene((scene) => put(scene.assets[0]!, 'variant', '')) },
  {
    rule: 'asset-library-without-asset',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => {
        put(scene.assets[0]!, 'asset', undefined);
        put(scene.assets[0]!, 'library', EXTRA.missingLibrary);
      }),
  },
  {
    rule: 'asset-unknown-library',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => {
        put(scene.assets[0]!, 'asset', ARCHETYPE.sofa_3s);
        put(scene.assets[0]!, 'library', EXTRA.missingLibrary);
      }),
  },
  {
    rule: 'asset-unknown-catalogue-entry',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'asset', EXTRA.missingAsset)),
  },
  {
    rule: 'asset-variant-unknown',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'variant', VARIANT.armchair_velvet)),
  },
  {
    rule: 'asset-collision-invalid',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'collision', { hx: 0, hz: 0.5 })),
  },
  {
    rule: 'asset-slot-finish-unknown',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'finishes', { seat: 'unobtanium' })),
  },
  {
    rule: 'asset-material-unknown',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.assets[0]!, 'material', 'unobtanium')),
  },

  // ---- validate/cameras.ts
  {
    rule: 'room-camera-unknown-room',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.roomCameras, EXTRA.missingRoom, draftOf(lShapePlan.presentationCamera))),
  },
  {
    rule: 'room-camera-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.roomCameras[ROOM.a]!.position, 'x', Number.NaN)),
  },
  { rule: 'navigation-points-missing', kind: 'semantic', document: () => brokenScene((scene) => put(scene.navigation, 'points', [])) },
  {
    rule: 'navigation-point-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.navigation.points[0]!, 'x', Number.NaN)),
  },
  {
    rule: 'autotour-path-too-short',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.autotour, 'path', scene.autotour.path.slice(0, 1))),
  },
  {
    rule: 'autotour-path-point-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.autotour.path[0]!, 'x', Number.NaN)),
  },
  {
    rule: 'autotour-gaze-waypoint-invalid',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.autotour.gaze[0]!, 'at', 9)),
  },
  {
    rule: 'autotour-gaze-target-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene.autotour.gaze[0]!.target, 'x', Number.NaN)),
  },
  {
    rule: 'autotour-zone-waypoint-invalid',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.autotour.zones![0]!, 'at', 9)),
  },
  {
    rule: 'autotour-zone-speed-invalid',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene.autotour.zones![0]!, 'speed', 0)),
  },

  // ---- validate/cameras.ts: the tour checkpoints
  { rule: 'tour-checkpoints-not-array', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'tourCheckpoints', 'nope')) },
  { rule: 'tour-checkpoint-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'tourCheckpoints', [null])) },
  {
    rule: 'tour-checkpoint-position-invalid',
    kind: 'structural',
    document: () =>
      brokenScene((scene) => {
        scene.tourCheckpoints = [{ ...soundCheckpoint(), position: { x: Number.NaN, y: 1.6, z: 1 } }];
      }),
  },
  {
    rule: 'tour-checkpoint-height-out-of-range',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => {
        scene.tourCheckpoints = [{ ...soundCheckpoint(), position: { x: 1, y: 9, z: 1 } }];
      }),
  },
  {
    rule: 'tour-checkpoint-yaw-invalid',
    kind: 'structural',
    document: () =>
      brokenScene((scene) => {
        scene.tourCheckpoints = [{ ...soundCheckpoint(), yaw: Number.NaN }];
      }),
  },
  {
    rule: 'tour-checkpoint-pitch-invalid',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => {
        scene.tourCheckpoints = [{ ...soundCheckpoint(), pitch: 1.2 }];
      }),
  },
  {
    rule: 'tour-checkpoint-name-invalid',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => {
        scene.tourCheckpoints = [{ ...soundCheckpoint(), name: ' Hall ' }];
      }),
  },

  // ---- validate/presets.ts
  { rule: 'interiors-not-array', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'interiors', {})) },
  { rule: 'interior-preset-not-object', kind: 'structural', document: () => brokenScene((scene) => put(scene, 'interiors', [5])) },
  {
    rule: 'interior-preset-name-missing',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene, 'interiors', [{ ...soundPreset(), name: '' }])),
  },
  {
    rule: 'interior-preset-swatch-invalid',
    kind: 'structural',
    document: () => brokenScene((scene) => put(scene, 'interiors', [{ ...soundPreset(), swatch: [FINISH.walnut] }])),
  },
  {
    rule: 'interior-preset-ops-missing',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene, 'interiors', [{ ...soundPreset(), ops: [] }])),
  },
  {
    rule: 'interior-preset-op-creates',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) =>
        put(scene, 'interiors', [{ ...soundPreset(), ops: [{ op: 'add_node', id: EXTRA.farNodeA, p: { x: 90, z: 90 } }] }]),
      ),
  },
  {
    // Orientation is not decoration: a preset may not turn the plan or change its sun.
    rule: 'interior-preset-op-site',
    kind: 'semantic',
    document: () => brokenScene((scene) => put(scene, 'interiors', [{ ...soundPreset(), ops: [{ op: 'set_site', sun: 'evening' }] }])),
  },
  {
    rule: 'interior-preset-op-failed',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) =>
        put(scene, 'interiors', [
          { ...soundPreset(), ops: [{ op: 'replace_asset_variant', assetId: EXTRA.missingAsset, variant: VARIANT.sofa_3s_boucle }] },
        ]),
      ),
  },

  // ---- scene-validator.ts: the solver's own refusal, rewrapped
  {
    rule: 'plan-unsolvable',
    kind: 'semantic',
    document: () =>
      brokenScene((scene) => {
        scene.nodes.push({ id: EXTRA.farNodeA, p: { x: 90, z: 90 } }, { id: EXTRA.farNodeB, p: { x: 92, z: 90 } });
        scene.walls.push({ id: EXTRA.farWall, a: EXTRA.farNodeA, b: EXTRA.farNodeB, thickness: 0.1 });
      }),
  },
];

/** Every rule the validator can raise, read from its own sources rather than from a list that drifts. */
function validatorRules(): Set<string> {
  const validateDir = new URL('./validate/', import.meta.url);
  const sources = readdirSync(validateDir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(new URL(name, validateDir), 'utf8'));
  sources.push(readFileSync(new URL('./scene-validator.ts', import.meta.url), 'utf8'));
  const rules = new Set<string>();
  for (const source of sources) {
    for (const match of source.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:ctx\.)?fail\(\s*'([a-z0-9-]+)'/g)) rules.add(match[1]!);
  }
  return rules;
}

/** The rule the validator refuses `document` with, or what it did instead. */
function ruleRaisedBy(document: unknown): string {
  try {
    validateScene(document, CATALOGUE_REGISTRIES, collectLogger().log);
  } catch (error) {
    if (error instanceof SceneValidationError) return error.rule;
    throw error;
  }
  return '(accepted)';
}

/** The table itself, printed by the classification test so a failure shows the whole picture. */
function ruleTable(): string {
  const rows = [...RULE_CASES].sort((left, right) => left.rule.localeCompare(right.rule));
  const structural = rows.filter((row) => row.kind === 'structural').length;
  return [
    `rule -> class (${structural} structural, ${rows.length - structural} semantic of ${rows.length})`,
    ...rows.map((row) => `  ${row.rule.padEnd(32)} ${row.kind}`),
  ].join('\n');
}

describe('the rule table: which refusals the schema can make, and which only the validator can', () => {
  test('every rule the validator can raise is classified exactly once', () => {
    const classified = RULE_CASES.map((entry) => entry.rule);
    const declared = new Set(classified);
    const raised = validatorRules();
    const unclassified = [...raised].filter((rule) => !declared.has(rule)).sort();
    const stale = [...declared].filter((rule) => !raised.has(rule)).sort();
    const duplicated = classified.filter((rule, index) => classified.indexOf(rule) !== index).sort();
    expect({ unclassified, stale, duplicated }, ruleTable()).toEqual({ unclassified: [], stale: [], duplicated: [] });
  });

  for (const entry of RULE_CASES) {
    test(`${entry.rule} is ${entry.kind}`, () => {
      const document = entry.document();
      expect({ rule: ruleRaisedBy(document) }).toEqual({ rule: entry.rule });
      expect({ rule: entry.rule, schemaRefuses: documentPaths(document).length > 0 }).toEqual({
        rule: entry.rule,
        schemaRefuses: entry.kind === 'structural',
      });
    });
  }
});

describe('sceneOpSchema — set_camera, set_navigation, set_autotour', () => {
  test('accepts one op of each new kind, target shapes included', () => {
    const ops: SceneOp[] = [
      { op: 'set_camera', target: 'presentation', pose: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } } },
      { op: 'set_camera', target: 'walkSpawn', remove: true },
      { op: 'set_camera', target: { room: ROOM.a }, pose: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } } },
      { op: 'set_navigation', points: [{ x: 1, y: 2, z: 3 }] },
      {
        op: 'set_autotour',
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        gaze: [{ at: 0, target: { x: 0, y: 0, z: 0 } }],
        zones: [{ at: 1, speed: 1 }],
        speed: 1.2,
      },
    ];
    expect(sceneOpsIssues(ops)).toEqual([]);
  });

  test('rejects a target that is none of the three shapes', () => {
    const issues = sceneOpsIssues([{ op: 'set_camera', target: 'nowhere' }]);
    expect(issues.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------ the shell operations --- */

// The union's own type/schema agreement is `_ops` above, which the shell
// operations join automatically — a shape declared in one file and not the
// other fails to compile there.

describe('the shell operations pass the op schema', () => {
  const SHELL_OPS: SceneOp[] = [
    { op: 'add_node', id: EXTRA.newNode, p: { x: 1, z: 2 } },
    { op: 'move_node', nodeId: NODE.n1, p: { x: 1, z: 2 } },
    { op: 'move_node', nodeId: NODE.n1, dp: { x: 0.1, z: 0 } },
    { op: 'remove_node', nodeId: NODE.n1 },
    { op: 'add_wall', id: EXTRA.newWallLeft, a: NODE.n1, b: NODE.n2, thickness: 0.2 },
    { op: 'add_wall', id: EXTRA.newWallRight, a: NODE.n1, b: NODE.n2, thickness: 0.2, role: 'bearing', arc: { radius: 4, ccw: true } },
    { op: 'set_wall', wallId: WALL.wPart, thickness: 0.2 },
    { op: 'set_wall', wallId: WALL.wPart, arc: null },
    { op: 'remove_wall', wallId: WALL.wPart },
    { op: 'split_wall', wallId: WALL.wPart, at: 1.9, nodeId: EXTRA.newNode, ids: [EXTRA.newWallLeft, EXTRA.newWallRight] },
    { op: 'set_opening', openingId: OPENING.doorAb, wallId: WALL.wW, center: 1.2 },
  ];

  test('every one of them parses, and parseSceneOps hands back the array it was given', () => {
    for (const op of SHELL_OPS) expect(z.safeParse(sceneOpSchema, op).success).toBe(true);
    expect(parseSceneOps(SHELL_OPS)).toBe(SHELL_OPS);
  });

  test('a malformed one is refused at the field that is wrong', () => {
    const { newNode, newWallLeft, newWallRight } = EXTRA;
    expect(z.safeParse(sceneOpSchema, { op: 'add_node', id: newNode, p: { x: 1 } }).success).toBe(false);
    expect(z.safeParse(sceneOpSchema, { op: 'move_node' }).success).toBe(false);
    expect(z.safeParse(sceneOpSchema, { op: 'add_wall', id: newWallLeft, a: NODE.n1, b: NODE.n2 }).success).toBe(false);
    expect(z.safeParse(sceneOpSchema, { op: 'set_wall', wallId: WALL.wW, arc: { radius: 'wide', ccw: true } }).success).toBe(false);
    expect(z.safeParse(sceneOpSchema, { op: 'remove_wall' }).success).toBe(false);
    // `null` straightens a wall; it is not a legal ARC, only a legal `set_wall.arc`.
    expect(z.safeParse(sceneOpSchema, { op: 'add_wall', id: newWallLeft, a: NODE.n1, b: NODE.n2, thickness: 0.2, arc: null }).success).toBe(
      false,
    );
    // A split names exactly two halves and a number of metres.
    expect(z.safeParse(sceneOpSchema, { op: 'split_wall', wallId: WALL.wW, at: 1, nodeId: newNode, ids: [newWallLeft] }).success).toBe(
      false,
    );
    expect(
      z.safeParse(sceneOpSchema, { op: 'split_wall', wallId: WALL.wW, at: 'middle', nodeId: newNode, ids: [newWallLeft, newWallRight] })
        .success,
    ).toBe(false);
  });

  test('a creating op without its id, or with an id that is not a UUID v7, is refused', () => {
    expect(z.safeParse(sceneOpSchema, { op: 'add_node', p: { x: 1, z: 2 } }).success).toBe(false);
    expect(z.safeParse(sceneOpSchema, { op: 'add_node', id: 'n9', p: { x: 1, z: 2 } }).success).toBe(false);
    expect(z.safeParse(sceneOpSchema, { op: 'add_wall', a: NODE.n1, b: NODE.n2, thickness: 0.2 }).success).toBe(false);
    expect(z.safeParse(sceneOpSchema, { op: 'remove_wall', wallId: 'w-part' }).success).toBe(false);
  });
});

/* ------------------------------------------------------------ set_site --- */

describe('set_site in the op schema', () => {
  const issues = (op: unknown): string[] => sceneOpsIssues([op]).map((issue) => issue.message);

  test('a value, a null and either key alone parse', () => {
    const ops: SceneOp[] = [
      { op: 'set_site', northDeg: -90, sun: 'evening' },
      { op: 'set_site', northDeg: null },
      { op: 'set_site', sun: null },
      { op: 'set_site', sun: 'morning' },
      { op: 'set_site', northDeg: 720, sun: null },
    ];
    expect(sceneOpsIssues(ops)).toEqual([]);
  });

  test('an operation with neither key is refused', () => {
    expect(issues({ op: 'set_site' })).toEqual(['set_site needs northDeg or sun']);
  });

  test('a bad value is refused naming its field', () => {
    for (const northDeg of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '90']) {
      expect(issues({ op: 'set_site', northDeg })).toEqual(['set_site northDeg must be a finite number or null']);
    }
    expect(issues({ op: 'set_site', sun: 'night' })).toEqual(["set_site sun must be 'morning', 'noon', 'evening' or null"]);
  });

  test('an unknown key is refused: a misspelt field would orient nothing', () => {
    expect(issues({ op: 'set_site', north_deg: 90 })).toContain('set_site carries an unknown key: north_deg');
  });
});
