/**
 * The boundary schema of a baked project, proved on the shape a real bake has.
 *
 * The fixture below is written out here rather than read from
 * `tests/fixtures/project/` because it carries every OPTIONAL part of the
 * format, which the committed bake does not; it shares that bake's ids
 * (`PROJECT_FIXTURE`). Its field set is the one a real catalogue export
 * produces (variants carry their own `model` and `preview`, objects carry
 * `layout` and `lods`, materials carry `generator` + `tile`), so the schema is
 * judged against data that exists rather than against the format's prose
 * alone.
 *
 * A demo project is checked too when `JEEX_DEMO_PROJECT` points at a folder
 * holding one; without it that test is skipped rather than silently
 * passing.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/mini';
import { ViewerLibError } from '../shared/errors.js';
import { PROJECT_FORMAT, isProjectDocument, projectLibraryOf } from './project-manifest.js';
import type { BakedProjectManifest } from './project-manifest.js';
import {
  LAMP_MAX_CUTOFF,
  LAMP_MAX_LIGHTS,
  LAMP_MAX_LUMENS,
  lampLightSchema,
  parseProjectManifest,
  projectManifestIssues,
  projectManifestSchema,
} from './project-manifest.schema.js';
import { LAMP_PROJECT_FIXTURE, PROJECT_FIXTURE as FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';

/** A UUID of version 4, as another system might mint one: well-formed, and still not an id of this format. */
const UUID_V4 = '3f1c2e4a-9b7d-4c1e-8a2f-5d6e7f8a9b0c';
/** A pbr material of the fixture's own, beside its two generator ones. */
const FIXTURE_STONE = '01a12ff0-fed1-7ba5-a17c-f65d7a7dead7';

/** `T`, or `never` for the literal `undefined` member of a union. */
type StripUndefined<T> = T extends undefined ? never : T;

/**
 * Strips `readonly` recursively and drops an explicit `| undefined` from every
 * property, so the hand-written (readonly) manifest family can be compared
 * against `z.infer` (plain, mutable). Under `exactOptionalPropertyTypes`
 * `z.optional(z.string())` infers `field?: string | undefined` while the
 * hand-written type says `field?: string`, which is a different TYPE to the
 * checker and the same observable shape.
 */
type Canonical<T> = T extends readonly (infer U)[]
  ? Canonical<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: StripUndefined<Canonical<T[K]>> }
    : T;

/** Compile-time agreement: the schema and the hand-written type describe one shape. */
type Agrees<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _manifest: Agrees<Canonical<z.infer<typeof projectManifestSchema>>, Canonical<BakedProjectManifest>> = true;
void _manifest;

/**
 * A whole, valid manifest: the committed fixture project (two finishes of its
 * own, one object with one variant on `box-sofa.glb`), with every OPTIONAL
 * part of the format present as well, so the acceptance test covers the format
 * rather than its mandatory core.
 */
function fixtureManifest(): BakedProjectManifest {
  return {
    format: 'jeex-project',
    formatVersion: 2,
    projectId: FIXTURE.projectId,
    bakeId: FIXTURE.bakeId,
    bakedAt: '2026-09-11T09:00:00.000Z',
    title: 'Fixture project',
    scene: 'scene.json',
    library: {
      manifestVersion: '1.0',
      id: FIXTURE.projectId,
      name: 'Fixture library',
      publisher: FIXTURE.workspaceId,
      license: 'Apache-2.0',
      objects: [
        {
          id: FIXTURE.asset.boxSofa,
          name: 'Box sofa',
          category: 'furniture/sofas',
          dims: [2.1, 0.8, 0.9],
          anchor: 'floor',
          wallSnap: true,
          clearance: 0.6,
          tags: ['living'],
          model: 'obj/box-sofa@1.0.0.glb',
          materialSlots: { upholstery: 'Upholstery' },
          lods: [],
          preview: 'prev/box-sofa.webp',
          slots: ['upholstery'],
          defaultFinishes: { upholstery: FIXTURE.material.white },
          primarySlot: 'upholstery',
          variants: [
            {
              id: FIXTURE.variant.boxSofa,
              name: 'Box sofa',
              version: '1.0.0',
              tags: ['light'],
              dims: [2.1, 0.8, 0.9],
              finishes: { upholstery: FIXTURE.material.white },
              options: { seats: 3 },
              pricing: { model: 'free' },
              model: 'obj/box-sofa@1.0.0.glb',
              preview: 'prev/box-sofa.webp',
              access: 'free',
              allowed: true,
            },
          ],
          defaultVariant: FIXTURE.variant.boxSofa,
          options: { seats: 3 },
          layout: { caseGood: false, footprint: 0.9, mount: { bottom: 0 } },
        },
      ],
      materials: [
        {
          id: FIXTURE.material.oak,
          name: 'Fixture oak',
          tags: ['floor', 'planks'],
          apply: ['floor'],
          preview: 'prev/mat_fixture-oak.webp',
          generator: { kind: 'plank_floor', tone: '#b5855a', seed: 1 },
          tile: 3.2,
        },
        {
          id: FIXTURE.material.white,
          name: 'Fixture white',
          apply: ['wall', 'furniture'],
          generator: { kind: 'painted_plaster', tone: '#f1eee8', seed: 2 },
        },
      ],
    },
    media: [{ kind: 'still', preset: 'landscape-1080p', file: 'poster.webp', width: 1920, height: 1080 }],
    rights: {
      workspaceId: FIXTURE.workspaceId,
      perpetual: true,
      assets: [{ assetId: FIXTURE.asset.boxSofa, variantId: FIXTURE.variant.boxSofa, version: '1.0.0', access: 'free' }],
    },
    generator: { name: 'tests/fixtures/project', version: '1' },
    mark: { href: 'https://jeex.org/owners' },
  };
}

/** The fixture as a plain value, with one edit applied — the way a bad document differs from a good one. */
function broken(edit: (manifest: Record<string, unknown>) => void): unknown {
  const manifest = JSON.parse(JSON.stringify(fixtureManifest())) as Record<string, unknown>;
  edit(manifest);
  return manifest;
}

/** The first object of a cloned manifest, as a bag of fields a test may edit. */
function firstObject(manifest: Record<string, unknown>): Record<string, unknown> {
  const library = manifest['library'] as { objects: Record<string, unknown>[] };
  return library.objects[0]!;
}

/** The first variant of the first object of a cloned manifest. */
function firstVariant(manifest: Record<string, unknown>): Record<string, unknown> {
  return (firstObject(manifest)['variants'] as Record<string, unknown>[])[0]!;
}

/** The first material of a cloned manifest. */
function firstMaterial(manifest: Record<string, unknown>): Record<string, unknown> {
  const library = manifest['library'] as { materials: Record<string, unknown>[] };
  return library.materials[0]!;
}

describe('projectManifestIssues — what a bake must look like', () => {
  test('the fixture project passes with no issues', () => {
    expect(projectManifestIssues(fixtureManifest())).toEqual([]);
  });

  test('a pbr material is accepted: the format is judged whole, even where the loader defers the textures', () => {
    const manifest = broken((value) => {
      const library = value['library'] as { materials: unknown[] };
      library.materials = [
        {
          id: FIXTURE_STONE,
          name: 'Fixture stone',
          apply: ['floor'],
          pbr: { albedo: 'tex/stone_albedo.ktx2', normal: 'tex/stone_normal.ktx2', roughness: 0.6, metalness: 0, tile: [1.2, 1.2] },
        },
      ];
    });
    expect(projectManifestIssues(manifest)).toEqual([]);
  });

  test('layout.footprint is a fraction in (0, 1] and layout.blockingHeight is not negative', () => {
    const withLayout = (layout: Record<string, unknown>): unknown => broken((manifest) => void (firstObject(manifest)['layout'] = layout));
    for (const footprint of [0, -0.5, 1.5]) {
      const issues = projectManifestIssues(withLayout({ footprint }));
      expect(issues.map((issue) => issue.path.join('.'))).toEqual(['library.objects.0.layout.footprint']);
    }
    expect(projectManifestIssues(withLayout({ blockingHeight: -0.1 })).map((issue) => issue.path.join('.'))).toEqual([
      'library.objects.0.layout.blockingHeight',
    ]);
    expect(projectManifestIssues(withLayout({ footprint: 1, blockingHeight: 0 }))).toEqual([]);
    expect(projectManifestIssues(withLayout({ footprint: 0.42, blockingHeight: 0.92 }))).toEqual([]);
  });

  test('the producer mark is an http(s) link and nothing else', () => {
    expect(projectManifestIssues(broken((manifest) => void delete manifest['mark']))).toEqual([]);
    expect(projectManifestIssues(broken((manifest) => void (manifest['mark'] = { href: 'http://localhost:8080/owners' })))).toEqual([]);
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '/owners', '']) {
      const issues = projectManifestIssues(broken((manifest) => void (manifest['mark'] = { href })));
      expect(issues.map((issue) => issue.path.join('.'))).toEqual(['mark.href']);
    }
    expect(projectManifestIssues(broken((manifest) => void (manifest['mark'] = { href: 'https://jeex.org', hidden: true }))).length).toBe(
      1,
    );
  });

  test('a scene outside the project folder is refused', () => {
    const issues = projectManifestIssues(broken((manifest) => void (manifest['scene'] = '../x.json')));
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(['scene']);
  });

  test('an absolute scene path is refused', () => {
    expect(projectManifestIssues(broken((manifest) => void (manifest['scene'] = '/scene.json')))).not.toEqual([]);
  });

  test('an absolute model URL is refused: every file of a bake is relative to its own folder', () => {
    const issues = projectManifestIssues(
      broken((manifest) => void (firstObject(manifest)['model'] = 'https://cdn.example.com/box-sofa.glb')),
    );
    expect(issues.map((issue) => issue.path.join('.'))).toContain('library.objects.0.model');
  });

  test('a data: preview is refused', () => {
    expect(projectManifestIssues(broken((manifest) => void (firstObject(manifest)['preview'] = 'data:image/webp;base64,AA')))).not.toEqual(
      [],
    );
  });

  test('a control character in a path is refused', () => {
    expect(projectManifestIssues(broken((manifest) => void (firstObject(manifest)['preview'] = 'prev/box\u0001sofa.webp')))).not.toEqual(
      [],
    );
  });

  test('a format 1 manifest is refused with the version this build reads', () => {
    const issues = projectManifestIssues(broken((manifest) => void (manifest['formatVersion'] = 1)));
    expect(issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))).toEqual([
      { path: 'formatVersion', message: 'expected 2 (every id a UUID v7)' },
    ]);
  });

  test('a format version from the future is refused by the same literal', () => {
    const issues = projectManifestIssues(broken((manifest) => void (manifest['formatVersion'] = 3)));
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(['formatVersion']);
  });

  test('another format is refused', () => {
    expect(projectManifestIssues(broken((manifest) => void (manifest['format'] = 'jeex-scene')))).not.toEqual([]);
  });

  test('an unknown top-level field is refused: a bake carries what the format declares and nothing else', () => {
    expect(projectManifestIssues(broken((manifest) => void (manifest['tour'] = { autoplay: true })))).not.toEqual([]);
  });

  test('a builder on a project object is refused: a bake ships geometry, never a generator id', () => {
    expect(projectManifestIssues(broken((manifest) => void (firstObject(manifest)['builder'] = 'sofa')))).not.toEqual([]);
  });

  test('an object without a model is refused: a project entry has no procedural fallback', () => {
    expect(projectManifestIssues(broken((manifest) => void delete firstObject(manifest)['model']))).not.toEqual([]);
  });

  test('a manifest that is not an object at all is refused without throwing', () => {
    expect(projectManifestIssues(null)).not.toEqual([]);
    expect(projectManifestIssues('project')).not.toEqual([]);
  });
});

/**
 * Format 2: every id and every
 * reference to one is a UUID v7, judged by the scene's own `isUuidV7` — so a
 * well-formed UUID of another version is refused exactly like a word.
 */
describe('format 2: ids are UUID v7', () => {
  /** The paths of the issues `edit` produces, joined. */
  const pathsOf = (edit: (manifest: Record<string, unknown>) => void): string[] =>
    projectManifestIssues(broken(edit)).map((issue) => issue.path.join('.'));
  const rights = (manifest: Record<string, unknown>) => manifest['rights'] as Record<string, unknown>;
  const library = (manifest: Record<string, unknown>) => manifest['library'] as Record<string, unknown>;

  test('a v4 workspaceId is refused', () => {
    expect(pathsOf((manifest) => void (rights(manifest)['workspaceId'] = UUID_V4))).toEqual(['rights.workspaceId']);
  });

  test('a v4 projectId is refused', () => {
    expect(
      pathsOf((manifest) => {
        manifest['projectId'] = UUID_V4;
        library(manifest)['id'] = UUID_V4;
      }),
    ).toEqual(['projectId', 'library.id']);
  });

  test('a readable or numeric id is refused wherever an id stands', () => {
    expect(pathsOf((manifest) => void (manifest['bakeId'] = 1))).toEqual(['bakeId']);
    expect(pathsOf((manifest) => void (library(manifest)['publisher'] = 'jeex'))).toEqual(['library.publisher']);
    expect(pathsOf((manifest) => void (firstObject(manifest)['defaultVariant'] = 'box-sofa'))).toEqual([
      'library.objects.0.defaultVariant',
    ]);
    expect(pathsOf((manifest) => void (firstVariant(manifest)['finishes'] = { upholstery: 'fixture-white' }))).toEqual([
      'library.objects.0.variants.0.finishes.upholstery',
    ]);
    expect(pathsOf((manifest) => void (firstMaterial(manifest)['id'] = 'fixture-oak'))).toEqual(['library.materials.0.id']);
  });

  test('an upper-case UUID is refused: the canonical form is lower case', () => {
    expect(pathsOf((manifest) => void (manifest['bakeId'] = FIXTURE.bakeId.toUpperCase()))).toEqual(['bakeId']);
  });

  test('library.id must be the projectId: the library of a bake is its project', () => {
    const issues = projectManifestIssues(broken((manifest) => void (library(manifest)['id'] = FIXTURE.workspaceId)));
    expect(issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))).toEqual([
      { path: 'library.id', message: 'must equal projectId: the library of a bake is its project' },
    ]);
  });

  test('a rights entry is { assetId, variantId, version, access }', () => {
    const entry = (manifest: Record<string, unknown>) => (rights(manifest)['assets'] as Record<string, unknown>[])[0]!;
    expect(pathsOf((manifest) => void (entry(manifest)['variantId'] = UUID_V4))).toEqual(['rights.assets.0.variantId']);
    expect(pathsOf((manifest) => void delete entry(manifest)['assetId'])).toEqual(['rights.assets.0.assetId']);
    // The format 1 string ref is not a field of format 2.
    expect(pathsOf((manifest) => void (entry(manifest)['ref'] = 'jeex/box-sofa@box-sofa'))).toEqual(['rights.assets.0']);
  });
});

/**
 * The picture is the one string of the format that may leave the folder: a
 * catalogue service serves previews publicly, and a live library hands out that address instead of a file in a
 * folder it never baked. Everything the viewer FETCHES stays relative, which
 * is what these tests pin from both sides.
 */
describe('preview: a relative path or an absolute http(s) URL, on object, variant and material', () => {
  const REMOTE_PREVIEW = `https://cdn.example.com/v1/previews/${FIXTURE.workspaceId}/${FIXTURE.asset.boxSofa}/${FIXTURE.variant.boxSofa}/1.0.0.webp`;

  test("a variant preview may be a catalogue's public address", () => {
    expect(projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['preview'] = REMOTE_PREVIEW)))).toEqual([]);
  });

  test("an object preview may be a catalogue's public address", () => {
    expect(projectManifestIssues(broken((manifest) => void (firstObject(manifest)['preview'] = REMOTE_PREVIEW)))).toEqual([]);
  });

  test("a material preview may be a catalogue's public address", () => {
    expect(projectManifestIssues(broken((manifest) => void (firstMaterial(manifest)['preview'] = REMOTE_PREVIEW)))).toEqual([]);
  });

  test('plain http is accepted too: a catalogue service on a local origin during development', () => {
    expect(projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['preview'] = 'http://127.0.0.1:8080/p.webp')))).toEqual(
      [],
    );
  });

  test('a relative preview is still accepted: an offline bake ships its own prev/ folder', () => {
    expect(projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['preview'] = 'prev/box-sofa.webp')))).toEqual([]);
  });

  test('a scheme that is not http(s) is refused on every preview: the string ends up in an <img>', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/webp;base64,AA', 'blob:https://x/y', 'file:///etc/passwd']) {
      expect({ bad, issues: projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['preview'] = bad))) }).not.toEqual({
        bad,
        issues: [],
      });
    }
  });

  test('a protocol-relative preview is refused: it is neither a path nor a parseable URL', () => {
    const issues = projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['preview'] = '//cdn.example.com/x.webp')));
    expect(issues.map((issue) => issue.path.join('.'))).toContain('library.objects.0.variants.0.preview');
  });

  test('widening the picture widens no download: model, scene and lods stay inside the folder', () => {
    expect(projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['model'] = REMOTE_PREVIEW)))).not.toEqual([]);
    expect(projectManifestIssues(broken((manifest) => void (firstObject(manifest)['lods'] = [REMOTE_PREVIEW])))).not.toEqual([]);
    expect(projectManifestIssues(broken((manifest) => void (manifest['scene'] = 'https://cdn.example.com/scene.json')))).not.toEqual([]);
  });
});

/**
 * `access` and `allowed` are the host's words, carried and never judged: the
 * viewer's only job is to refuse a value that is not one of the three the
 * format names, so a typo cannot reach a host card as an access level.
 */
describe('access and allowed on a variant', () => {
  test('both are optional: a bake that names neither is a valid bake', () => {
    expect(
      projectManifestIssues(
        broken((manifest) => {
          const variant = firstVariant(manifest);
          delete variant['access'];
          delete variant['allowed'];
        }),
      ),
    ).toEqual([]);
  });

  test('each of the three access words is accepted', () => {
    for (const access of ['free', 'pro', 'exclusive']) {
      expect({ access, issues: projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['access'] = access))) }).toEqual({
        access,
        issues: [],
      });
    }
  });

  test('a fourth access word is refused, with the variant path', () => {
    const issues = projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['access'] = 'premium')));
    expect(issues.map((issue) => issue.path.join('.'))).toContain('library.objects.0.variants.0.access');
  });

  test('allowed is a boolean, not an access word', () => {
    expect(projectManifestIssues(broken((manifest) => void (firstVariant(manifest)['allowed'] = 'yes')))).not.toEqual([]);
  });
});

describe('slot names are open: a baked asset names its parts freely', () => {
  /** The shape a catalogue publishes for a baked variant: own part names, no finish bound anywhere. */
  const baked = (manifest: Record<string, unknown>): void => {
    const object = firstObject(manifest);
    object['slots'] = ['upholstery', 'shell', 'base', 'fittings'];
    object['defaultFinishes'] = {};
    object['primarySlot'] = 'upholstery';
    delete object['materialSlots'];
    firstVariant(manifest)['finishes'] = {};
  };

  test('slots shell, base and fittings parse', () => {
    const value = broken(baked);
    expect(projectManifestIssues(value)).toEqual([]);
    expect(() => parseProjectManifest(value)).not.toThrow();
  });

  test('a finish keyed by a part name outside FinishSlot parses', () => {
    const value = broken((manifest) => {
      baked(manifest);
      firstVariant(manifest)['finishes'] = { shell: FIXTURE.material.white };
    });
    expect(projectManifestIssues(value)).toEqual([]);
  });

  test('an empty slot name is refused, with its path', () => {
    const issues = projectManifestIssues(broken((manifest) => void (firstObject(manifest)['slots'] = ['upholstery', ''])));
    expect(issues.map((issue) => issue.path.join('.'))).toContain('library.objects.0.slots.1');
  });

  test('a slot name that is not an identifier is refused', () => {
    for (const name of ['two words', '../shell', '_lead', 'x'.repeat(65)]) {
      expect(projectManifestIssues(broken((manifest) => void (firstObject(manifest)['primarySlot'] = name)))).not.toEqual([]);
    }
  });
});

describe('parseProjectManifest — judges, never transforms', () => {
  test('the value the caller handed in is the value that flows on', () => {
    const manifest = fixtureManifest();
    expect(parseProjectManifest(manifest)).toBe(manifest);
  });

  test('a refusal is ViewerLibError(project-invalid) with the first path and the issue list', () => {
    let thrown: unknown;
    try {
      parseProjectManifest(broken((manifest) => void (manifest['scene'] = '../x.json')));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ViewerLibError);
    const error = thrown as ViewerLibError;
    expect(error.code).toBe('project-invalid');
    expect(error.path).toBe('scene');
    expect(error.message).toContain('parseProjectManifest: scene');
    expect((error.detail as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });
});

describe('the manifest module: what a repository and a mount read off a document', () => {
  test('isProjectDocument answers on the format field alone', () => {
    expect(isProjectDocument(fixtureManifest())).toBe(true);
    expect(isProjectDocument({ format: PROJECT_FORMAT })).toBe(true);
    expect(isProjectDocument({ schemaVersion: '2.0', walls: [] })).toBe(false);
    expect(isProjectDocument(null)).toBe(false);
    expect(isProjectDocument('jeex-project')).toBe(false);
  });

  test('projectLibraryOf narrows the library to what the scene layer reads, anchor included', () => {
    const library = projectLibraryOf(fixtureManifest());
    expect(library.id).toBe(FIXTURE.projectId);
    expect(library.objects).toEqual([
      { id: FIXTURE.asset.boxSofa, variants: [{ id: FIXTURE.variant.boxSofa }], defaultVariant: FIXTURE.variant.boxSofa, anchor: 'floor' },
    ]);
    expect(library.materials).toEqual([
      { id: FIXTURE.material.oak, apply: ['floor'] },
      { id: FIXTURE.material.white, apply: ['wall', 'furniture'] },
    ]);
  });
});

/** A demo project, when the machine running the tests has one; `JEEX_DEMO_PROJECT` names its folder. */
const demoProject = process.env['JEEX_DEMO_PROJECT'];
const demoManifest = demoProject === undefined ? undefined : join(demoProject, 'project.json');
const hasDemo = demoManifest !== undefined && existsSync(demoManifest);

describe('the demo project, when JEEX_DEMO_PROJECT points at one', () => {
  test.skipIf(!hasDemo)('it passes the schema unchanged', () => {
    expect(projectManifestIssues(JSON.parse(readFileSync(demoManifest!, 'utf8')))).toEqual([]);
  });
});

/* ------------------------------------------------ the library member --- */

/** Ids the library-member tests add: three materials and the catalogue versions their maps sit under. */
const LIB = {
  oakScan: '01a167ee-5039-79c9-8479-8069a429c30c',
  oakVersion: '01a167ee-5039-735c-bbdf-3f2acd1d2e5a',
  linenScan: '01a167ee-503a-7261-a2a5-15d7d20dc7d8',
  linenVersion: '01a167ee-503a-7da4-acfa-418617c6bc41',
  paint: '01a167ee-503a-79cd-917f-d0ab27855aa6',
  paintVersion: '01a167ee-503a-7db9-a6f4-238603050ab2',
} as const;

/** The file a map of `role` at `size` must be, under `version`. */
const tex = (version: string, role: string, size: string): string => `tex/${version}/${role}.${size}.webp`;

/** One map entry listing `sizes`, every file at its exact path. */
function mapOf(version: string, role: string, colourSpace: 'srgb' | 'linear', sizes: readonly string[], extra: object = {}) {
  return { colourSpace, ...extra, files: Object.fromEntries(sizes.map((size) => [size, tex(version, role, size)])) };
}

/** A natural scan: albedo, normal and arm at 256 and 512. */
function naturalScan(): Record<string, unknown> {
  return {
    id: LIB.oakScan,
    name: 'Oak planks',
    apply: ['floor'],
    library: {
      versionId: LIB.oakVersion,
      kind: 'scan',
      facts: {
        tileM: [2, 1],
        grain: 'along_u',
        suitability: 'plank_floor',
        colourMode: 'natural',
        averageColour: '#9a7b56',
        pbr: {},
      },
      maps: {
        albedo: mapOf(LIB.oakVersion, 'albedo', 'srgb', ['256', '512']),
        normal: mapOf(LIB.oakVersion, 'normal', 'linear', ['256', '512'], { convention: 'opengl' }),
        arm: mapOf(LIB.oakVersion, 'arm', 'linear', ['256', '512']),
      },
    },
  };
}

/** A tintable scan: albedoTint plus separate roughness and ao. */
function tintableScan(): Record<string, unknown> {
  return {
    id: LIB.linenScan,
    name: 'Linen weave',
    apply: ['wall', 'ceiling'],
    library: {
      versionId: LIB.linenVersion,
      kind: 'scan',
      facts: {
        tileM: [0.5, 0.5],
        grain: 'none',
        suitability: 'continuous',
        normalStrength: 0.8,
        colourMode: 'tintable',
        tint: { recipe: 'luma-mid@1', suggestedColours: [{ name: 'Mist', hex: '#c9d6df' }] },
        averageColour: '#808080',
        pbr: { roughness: 0.9 },
      },
      maps: {
        albedoTint: mapOf(LIB.linenVersion, 'albedoTint', 'srgb', ['384']),
        roughness: mapOf(LIB.linenVersion, 'roughness', 'linear', ['384']),
        ao: mapOf(LIB.linenVersion, 'ao', 'linear', ['384']),
      },
    },
  };
}

/** A tintable parameters material: a paint, no maps. */
function paint(): Record<string, unknown> {
  return {
    id: LIB.paint,
    name: 'Matt paint',
    apply: ['wall', 'ceiling', 'facade', 'trim'],
    library: {
      versionId: LIB.paintVersion,
      kind: 'parameters',
      facts: {
        tileM: null,
        grain: 'none',
        suitability: 'continuous',
        colourMode: 'tintable',
        tint: { recipe: 'luma-mid@1', suggestedColours: [{ name: 'Chalk', hex: '#f1eee8' }] },
        averageColour: '#806040',
        pbr: { baseColour: '#806040', roughness: 0.85 },
      },
      maps: {},
    },
  };
}

/** The fixture manifest with `materials` as its library's whole material list. */
function withMaterials(...materials: Record<string, unknown>[]): Record<string, unknown> {
  return broken((manifest) => void ((manifest['library'] as { materials: unknown[] }).materials = materials)) as Record<string, unknown>;
}

/** The fixture manifest with ONE library material, edited by `edit` before it is judged. */
function withLibrary(make: () => Record<string, unknown>, edit: (library: Record<string, any>) => void): unknown {
  const material = JSON.parse(JSON.stringify(make())) as Record<string, any>;
  edit(material['library']);
  return withMaterials(material);
}

/** The joined paths of every issue `value` raises. */
const issuePaths = (value: unknown): string[] => projectManifestIssues(value).map((issue) => issue.path.join('.'));

/** The path prefix of the only material's library member. */
const AT = 'library.materials.0.library';

describe('library member: apply words', () => {
  test('ceiling, facade and trim are surface words a project material may name', () => {
    const manifest = broken((value) => void (firstMaterial(value)['apply'] = ['ceiling', 'facade', 'trim']));
    expect(projectManifestIssues(manifest)).toEqual([]);
  });

  test('a word outside the vocabulary is still refused', () => {
    expect(issuePaths(broken((value) => void (firstMaterial(value)['apply'] = ['floor', 'roof'])))).toEqual([
      'library.materials.0.apply.1',
    ]);
  });
});

describe('library member: the strict shape', () => {
  test('a natural scan, a tintable scan and a paint parse and come back as the very object', () => {
    const manifest = withMaterials(naturalScan(), tintableScan(), paint());
    expect(projectManifestIssues(manifest)).toEqual([]);
    expect(parseProjectManifest(manifest)).toBe(manifest as unknown as BakedProjectManifest);
  });

  test('absent defaults stay absent: no metalness, no normalStrength is written in', () => {
    const manifest = withMaterials(naturalScan()) as unknown as BakedProjectManifest;
    const material = parseProjectManifest(manifest).library.materials[0]!;
    expect('library' in material && material.library.facts).not.toHaveProperty('normalStrength');
    expect('library' in material && material.library.facts.pbr).toEqual({});
  });

  test('an unknown key is refused at every depth, at the object that carries it, and the issue names it', () => {
    const cases: [(library: Record<string, any>) => void, string][] = [
      [(library) => void (library['scale'] = 2), AT],
      [(library) => void (library['facts']['origin'] = 'source'), `${AT}.facts`],
      [(library) => void (library['facts']['pbr']['specular'] = 1), `${AT}.facts.pbr`],
      [(library) => void (library['maps']['albedo']['mime'] = 'image/webp'), `${AT}.maps.albedo`],
      [(library) => void (library['maps']['height'] = mapOf(LIB.oakVersion, 'height', 'linear', ['256'])), `${AT}.maps`],
      [(library) => void (library['maps']['albedo']['files']['1024'] = tex(LIB.oakVersion, 'albedo', '1024')), `${AT}.maps.albedo.files`],
    ];
    for (const [edit, path] of cases) {
      const issues = projectManifestIssues(withLibrary(naturalScan, edit));
      expect(issues.map((issue) => issue.path.join('.'))).toEqual([path]);
      expect(issues[0]!.message).toMatch(/^unknown key "[^"]+"$/);
    }
    const tinted = projectManifestIssues(withLibrary(tintableScan, (library) => void (library['facts']['tint']['mode'] = 'multiply')));
    expect(tinted.map((issue) => issue.path.join('.'))).toEqual([`${AT}.facts.tint`]);
  });

  test('versionId is a lowercase UUID v7', () => {
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['versionId'] = UUID_V4)))).toContain(`${AT}.versionId`);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['versionId'] = LIB.oakVersion.toUpperCase())))).toContain(
      `${AT}.versionId`,
    );
  });

  test('averageColour is #rrggbb', () => {
    for (const colour of ['rgb(10, 10, 10)', '#abc', '9a7b56', '#9a7b5g']) {
      expect(issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['averageColour'] = colour)))).toEqual([
        `${AT}.facts.averageColour`,
      ]);
    }
  });

  test('normalStrength is above 0', () => {
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['normalStrength'] = 0)))).toEqual([
      `${AT}.facts.normalStrength`,
    ]);
  });

  test('kind, grain, suitability and colourMode are closed words', () => {
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['kind'] = 'procedural')))).toEqual([`${AT}.kind`]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['grain'] = 'diagonal')))).toEqual([`${AT}.facts.grain`]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['suitability'] = 'tile')))).toEqual([
      `${AT}.facts.suitability`,
    ]);
  });
});

describe('library member: PBR ranges', () => {
  const pbrIssues = (field: string, value: unknown): string[] =>
    issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['pbr'][field] = value)));

  test('every unit-interval field refuses -0.01 and 1.01 and accepts both ends', () => {
    for (const field of [
      'roughness',
      'metalness',
      'opacity',
      'sheen',
      'sheenRoughness',
      'clearcoat',
      'clearcoatRoughness',
      'transmission',
    ]) {
      expect({ field, low: pbrIssues(field, -0.01), high: pbrIssues(field, 1.01) }).toEqual({
        field,
        low: [`${AT}.facts.pbr.${field}`],
        high: [`${AT}.facts.pbr.${field}`],
      });
      expect({ field, ends: [...pbrIssues(field, 0), ...pbrIssues(field, 1)] }).toEqual({ field, ends: [] });
    }
  });

  test('ior lies in [1, 2.333]', () => {
    expect(pbrIssues('ior', 0.99)).toEqual([`${AT}.facts.pbr.ior`]);
    expect(pbrIssues('ior', 2.34)).toEqual([`${AT}.facts.pbr.ior`]);
    expect([...pbrIssues('ior', 1), ...pbrIssues('ior', 2.333)]).toEqual([]);
  });

  test('distances and the emissive intensity are not negative', () => {
    for (const field of ['thicknessM', 'attenuationDistanceM', 'emissiveIntensity']) {
      expect({ field, issues: pbrIssues(field, -0.01) }).toEqual({ field, issues: [`${AT}.facts.pbr.${field}`] });
      expect({ field, issues: pbrIssues(field, 0) }).toEqual({ field, issues: [] });
    }
  });

  test('NaN and the infinities are refused in every numeric field', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(pbrIssues('roughness', value)).toEqual([`${AT}.facts.pbr.roughness`]);
      expect(pbrIssues('emissiveIntensity', value)).toEqual([`${AT}.facts.pbr.emissiveIntensity`]);
      expect(pbrIssues('sheenRoughness', value)).toEqual([`${AT}.facts.pbr.sheenRoughness`]);
      expect(issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['tileM'] = [value, 1])))).toEqual([
        `${AT}.facts.tileM.0`,
      ]);
    }
  });

  test('every colour field is #rrggbb', () => {
    for (const field of ['baseColour', 'sheenColour', 'attenuationColour', 'emissive']) {
      expect({ field, issues: pbrIssues(field, 'white') }).toEqual({ field, issues: [`${AT}.facts.pbr.${field}`] });
      expect({ field, issues: pbrIssues(field, '#FFFFFF') }).toEqual({ field, issues: [] });
    }
  });

  test('alphaMode is opaque, blend or mask', () => {
    expect([...pbrIssues('alphaMode', 'mask'), ...pbrIssues('alphaMode', 'blend')]).toEqual([]);
    expect(pbrIssues('alphaMode', 'cutout')).toEqual([`${AT}.facts.pbr.alphaMode`]);
  });
});

describe('library member: colour mode', () => {
  test('a tintable material without a tint is refused', () => {
    expect(issuePaths(withLibrary(tintableScan, (library) => void delete library['facts']['tint']))).toEqual([`${AT}.facts.tint`]);
  });

  test('a natural material with a tint is refused', () => {
    const tint = { recipe: 'luma-mid@1', suggestedColours: [{ name: 'Mist', hex: '#c9d6df' }] };
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['tint'] = tint)))).toEqual([`${AT}.facts.tint`]);
  });

  test('a tint suggests at least one colour, each #rrggbb, under the one recipe', () => {
    expect(issuePaths(withLibrary(tintableScan, (library) => void (library['facts']['tint']['suggestedColours'] = [])))).toEqual([
      `${AT}.facts.tint.suggestedColours`,
    ]);
    expect(
      issuePaths(withLibrary(tintableScan, (library) => void (library['facts']['tint']['suggestedColours'][0]['hex'] = 'mist'))),
    ).toEqual([`${AT}.facts.tint.suggestedColours.0.hex`]);
    expect(issuePaths(withLibrary(tintableScan, (library) => void (library['facts']['tint']['recipe'] = 'luma-mid@2')))).toEqual([
      `${AT}.facts.tint.recipe`,
    ]);
  });

  test('a natural scan ships albedo and no albedoTint', () => {
    const map = mapOf(LIB.oakVersion, 'albedoTint', 'srgb', ['256', '512']);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['albedoTint'] = map)))).toEqual([
      `${AT}.maps.albedoTint`,
    ]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void delete library['maps']['albedo']))).toEqual([`${AT}.maps.albedo`]);
  });

  test('a tintable scan ships albedoTint and no albedo', () => {
    const map = mapOf(LIB.linenVersion, 'albedo', 'srgb', ['384']);
    expect(issuePaths(withLibrary(tintableScan, (library) => void (library['maps']['albedo'] = map)))).toEqual([`${AT}.maps.albedo`]);
    expect(issuePaths(withLibrary(tintableScan, (library) => void delete library['maps']['albedoTint']))).toEqual([
      `${AT}.maps.albedoTint`,
    ]);
  });

  test('a scan has a tile size', () => {
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['tileM'] = null)))).toEqual([`${AT}.facts.tileM`]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['facts']['tileM'] = [0, 1])))).toEqual([`${AT}.facts.tileM.0`]);
  });
});

describe('library member: maps', () => {
  test('colour roles are srgb and every other role is linear', () => {
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['normal']['colourSpace'] = 'srgb')))).toEqual([
      `${AT}.maps.normal.colourSpace`,
    ]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['albedo']['colourSpace'] = 'linear')))).toEqual([
      `${AT}.maps.albedo.colourSpace`,
    ]);
  });

  test('convention appears only on normal, and only as opengl', () => {
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['arm']['convention'] = 'opengl')))).toEqual([
      `${AT}.maps.arm.convention`,
    ]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['normal']['convention'] = 'directx')))).toEqual([
      `${AT}.maps.normal.convention`,
    ]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void delete library['maps']['normal']['convention']))).toEqual([]);
  });

  test('arm or roughness: never arm beside roughness or ao', () => {
    const roughness = mapOf(LIB.oakVersion, 'roughness', 'linear', ['256', '512']);
    const ao = mapOf(LIB.oakVersion, 'ao', 'linear', ['256', '512']);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['roughness'] = roughness)))).toEqual([
      `${AT}.maps.roughness`,
    ]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['ao'] = ao)))).toEqual([`${AT}.maps.ao`]);
  });

  test('ao alone is refused, roughness with ao is accepted, and neither form is accepted too', () => {
    expect(issuePaths(withLibrary(tintableScan, (library) => void delete library['maps']['roughness']))).toEqual([`${AT}.maps.ao`]);
    expect(issuePaths(withMaterials(tintableScan()))).toEqual([]);
    expect(issuePaths(withLibrary(naturalScan, (library) => void delete library['maps']['arm']))).toEqual([]);
  });

  test('every map of a material lists the same sizes', () => {
    const armOnly512 = mapOf(LIB.oakVersion, 'arm', 'linear', ['512']);
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['arm'] = armOnly512)))).toEqual([`${AT}.maps.arm.files`]);
  });

  test('a map lists at least one size, and only 128, 256, 384, 512 or 768', () => {
    expect(issuePaths(withLibrary(naturalScan, (library) => void (library['maps']['albedo']['files'] = {})))).toContain(
      `${AT}.maps.albedo.files`,
    );
    for (const size of ['128', '384', '768']) {
      const sizes = (role: string, space: 'srgb' | 'linear') => mapOf(LIB.oakVersion, role, space, [size]);
      const value = withLibrary(naturalScan, (library) => {
        library['maps'] = { albedo: sizes('albedo', 'srgb'), arm: sizes('arm', 'linear') };
      });
      expect({ size, issues: issuePaths(value) }).toEqual({ size, issues: [] });
    }
    expect(
      issuePaths(
        withLibrary(naturalScan, (library) => void (library['maps']['albedo']['files']['64'] = tex(LIB.oakVersion, 'albedo', '64'))),
      ),
    ).toEqual([`${AT}.maps.albedo.files`]);
  });
});

describe('library member: parameters materials', () => {
  test('a paint ships maps: {} and tileM: null', () => {
    const map = mapOf(LIB.paintVersion, 'roughness', 'linear', ['256']);
    expect(issuePaths(withLibrary(paint, (library) => void (library['maps'] = { roughness: map })))).toEqual([`${AT}.maps`]);
    expect(issuePaths(withLibrary(paint, (library) => void (library['facts']['tileM'] = [1, 1])))).toEqual([`${AT}.facts.tileM`]);
  });

  test('a paint carries pbr.baseColour', () => {
    expect(issuePaths(withLibrary(paint, (library) => void delete library['facts']['pbr']['baseColour']))).toEqual([
      `${AT}.facts.pbr.baseColour`,
    ]);
  });

  test('its averageColour equals pbr.baseColour, compared without case', () => {
    expect(
      issuePaths(
        withLibrary(paint, (library) => {
          library['facts']['pbr']['baseColour'] = '#808080';
          library['facts']['averageColour'] = '#7f7f7f';
        }),
      ),
    ).toEqual([`${AT}.facts.averageColour`]);
    expect(issuePaths(withLibrary(paint, (library) => void (library['facts']['averageColour'] = '#806040'.toUpperCase())))).toEqual([]);
  });
});

describe('library member: texture file paths', () => {
  test('a file under another material’s version is refused', () => {
    const value = withLibrary(
      naturalScan,
      (library) => void (library['maps']['albedo']['files']['512'] = tex(LIB.linenVersion, 'albedo', '512')),
    );
    expect(issuePaths(value)).toEqual([`${AT}.maps.albedo.files.512`]);
  });

  test('a file under another role is refused', () => {
    const value = withLibrary(
      naturalScan,
      (library) => void (library['maps']['albedo']['files']['512'] = tex(LIB.oakVersion, 'roughness', '512')),
    );
    expect(projectManifestIssues(value).map((issue) => ({ path: issue.path.join('.'), message: issue.message }))).toEqual([
      { path: `${AT}.maps.albedo.files.512`, message: `must be ${tex(LIB.oakVersion, 'albedo', '512')}` },
    ]);
  });

  test('the size key and the file name agree', () => {
    const value = withLibrary(
      naturalScan,
      (library) => void (library['maps']['albedo']['files']['512'] = tex(LIB.oakVersion, 'albedo', '256')),
    );
    // The 256 file is also listed under its own key, so the same path is a duplicate as well.
    expect(issuePaths(value)[0]).toBe(`${AT}.maps.albedo.files.512`);
  });

  test('a material whose every file is KTX2 is accepted', () => {
    const value = withLibrary(naturalScan, (library) => {
      for (const map of Object.values(library['maps']) as { files: Record<string, string> }[]) {
        for (const size of Object.keys(map.files)) map.files[size] = map.files[size]!.replace(/\.webp$/, '.ktx2');
      }
    });
    expect(issuePaths(value)).toEqual([]);
  });

  test('one KTX2 file among WebP files of the same material is refused, naming the format the material uses', () => {
    const value = withLibrary(
      naturalScan,
      (library) => void (library['maps']['normal']['files']['512'] = tex(LIB.oakVersion, 'normal', '512').replace(/\.webp$/, '.ktx2')),
    );
    expect(projectManifestIssues(value).map((issue) => ({ path: issue.path.join('.'), message: issue.message }))).toEqual([
      { path: `${AT}.maps.normal.files.512`, message: `must be ${tex(LIB.oakVersion, 'normal', '512')}` },
    ]);
  });

  test('png and a path with a folder prefix are refused', () => {
    for (const path of [
      `tex/${LIB.oakVersion}/albedo.512.png`,
      `bake/tex/${LIB.oakVersion}/albedo.512.webp`,
      `https://cdn.example.com/tex/${LIB.oakVersion}/albedo.512.webp`,
    ]) {
      const value = withLibrary(naturalScan, (library) => void (library['maps']['albedo']['files']['512'] = path));
      expect({ path, issues: issuePaths(value) }).toEqual({ path, issues: [`${AT}.maps.albedo.files.512`] });
    }
  });
});

describe('library member: manifest-wide texture rules', () => {
  test('a path listed by two materials is refused at its second occurrence', () => {
    const second = naturalScan();
    second['id'] = LIB.linenScan;
    const issues = projectManifestIssues(withMaterials(naturalScan(), second));
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(
      ['albedo', 'normal', 'arm'].flatMap((role) => ['256', '512'].map((size) => `library.materials.1.library.maps.${role}.files.${size}`)),
    );
    expect(issues[0]!.message).toBe('is listed twice in the manifest');
  });

  /** `count` scans of one map at one size each, every version its own: `count` listed files. */
  function scans(count: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_, index) => {
      const suffix = index.toString(16).padStart(12, '0');
      const version = `01a167ee-503a-7000-8000-${suffix}`;
      return {
        id: `01a167ee-503b-7000-8000-${suffix}`,
        name: `Scan ${index}`,
        apply: ['floor'],
        library: {
          versionId: version,
          kind: 'scan',
          facts: { tileM: [1, 1], grain: 'none', suitability: 'continuous', colourMode: 'natural', averageColour: '#808080', pbr: {} },
          maps: { albedo: mapOf(version, 'albedo', 'srgb', ['256']) },
        },
      };
    });
  }

  test('512 listed files are accepted', () => {
    expect(projectManifestIssues(withMaterials(...scans(512)))).toEqual([]);
  });

  test('513 are refused with an issue that names the limit', () => {
    const issues = projectManifestIssues(withMaterials(...scans(513)));
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(['library.materials']);
    expect(issues[0]!.message).toContain('MAX_PROJECT_TEXTURE_FILES (512)');
  });
});

describe('library member: the legacy members are untouched', () => {
  test('pbr and generator materials still parse beside library ones', () => {
    const generator = firstMaterial(JSON.parse(JSON.stringify(fixtureManifest())) as Record<string, unknown>);
    const pbr = { id: FIXTURE_STONE, name: 'Stone', apply: ['floor'], pbr: { albedo: 'tex/stone.ktx2', roughness: 0.6, tile: [1.2, 1.2] } };
    expect(projectManifestIssues(withMaterials(generator, pbr, naturalScan(), paint()))).toEqual([]);
  });

  test('a material with two members at once is refused', () => {
    const both = { ...naturalScan(), generator: { kind: 'painted_plaster', tone: '#f1eee8', seed: 2 } };
    expect(projectManifestIssues(withMaterials(both))).not.toEqual([]);
  });
});

describe('projectLibraryOf marks the library materials', () => {
  test('a library material carries library: true to the scene layer, a generator one does not', () => {
    const generator = firstMaterial(JSON.parse(JSON.stringify(fixtureManifest())) as Record<string, unknown>);
    const manifest = parseProjectManifest(withMaterials(generator, naturalScan(), paint()));
    expect(projectLibraryOf(manifest).materials).toEqual([
      { id: FIXTURE.material.oak, apply: ['floor'] },
      { id: LIB.oakScan, apply: ['floor'], library: true },
      { id: LIB.paint, apply: ['wall', 'ceiling', 'facade', 'trim'], library: true },
    ]);
  });
});

/* ------------------------------------------------------------- lamp lights --- */

/** The spec's minimal point light: a table lamp's bulb. */
const TABLE_BULB = { kind: 'point', position: [0, 0.443, 0], colour: '#ffd9a4', lumens: 400, cutoff: 3 } as const;

/** The fixture with `lights` on its first variant. */
function lit(lights: unknown): unknown {
  return broken((manifest) => {
    firstVariant(manifest)['lights'] = lights;
  });
}

const VARIANT_AT = 'library.objects.0.variants.0';

describe('lights: an optional variant fact', () => {
  test('a manifest without lights is accepted as before', () => {
    expect(projectManifestIssues(fixtureManifest())).toEqual([]);
    expect(fixtureManifest().library.objects[0]!.variants.some((variant) => 'lights' in variant)).toBe(false);
  });

  test('the lamp fixture is accepted, its two variants each carrying one point light', () => {
    const document = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project-lamps', 'project.json'), 'utf8'),
    ) as unknown;
    const manifest = parseProjectManifest(document);
    expect(manifest.projectId).toBe(LAMP_PROJECT_FIXTURE.projectId);
    expect(manifest.library.objects.map((object) => object.variants.map((variant) => variant.lights?.map((light) => light.kind)))).toEqual([
      [['point']],
      [['point']],
    ]);
  });

  test('lights on a library object are an unknown key on that object', () => {
    const value = broken((manifest) => {
      firstObject(manifest)['lights'] = [TABLE_BULB];
    });
    expect(projectManifestIssues(value).map((issue) => ({ path: issue.path.join('.'), message: issue.message }))).toEqual([
      { path: 'library.objects.0', message: 'unknown key "lights"' },
    ]);
  });

  test('a point light with exactly kind, position, colour, lumens, cutoff and shadow is accepted', () => {
    expect(projectManifestIssues(lit([{ ...TABLE_BULB, shadow: true }]))).toEqual([]);
  });

  test('the minimal point light is accepted, and nothing is written into it', () => {
    const value = lit([TABLE_BULB]);
    expect(projectManifestIssues(value)).toEqual([]);
    const parsed = parseProjectManifest(value);
    expect(parsed.library.objects[0]!.variants[0]!.lights).toEqual([TABLE_BULB]);
    expect('shadow' in parsed.library.objects[0]!.variants[0]!.lights![0]!).toBe(false);
  });

  test('a small negative y is legal: the model frame starts at the lowest point, not at the bulb', () => {
    expect(projectManifestIssues(lit([{ ...TABLE_BULB, position: [0, -0.098, 0] }]))).toEqual([]);
  });

  test("1 to 4 lights; an empty array and a fifth light are refused at the variant's lights", () => {
    expect(projectManifestIssues(lit(Array.from({ length: LAMP_MAX_LIGHTS }, () => TABLE_BULB)))).toEqual([]);
    expect(issuePaths(lit(Array.from({ length: LAMP_MAX_LIGHTS + 1 }, () => TABLE_BULB)))).toEqual([`${VARIANT_AT}.lights`]);
    expect(issuePaths(lit([]))).toEqual([`${VARIANT_AT}.lights`]);
  });

  test("an unknown kind is refused at that light's kind", () => {
    expect(issuePaths(lit([{ ...TABLE_BULB, kind: 'spot' }]))).toEqual([`${VARIANT_AT}.lights.0.kind`]);
  });

  test('an id or a decay on a light is an unknown key at that light', () => {
    for (const extra of [{ decay: 2 }, { id: '01a16c46-c3ca-70cd-992f-c22c81ba7995' }]) {
      const issues = projectManifestIssues(lit([TABLE_BULB, { ...TABLE_BULB, ...extra }]));
      expect(issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }))).toEqual([
        { path: `${VARIANT_AT}.lights.1`, code: 'unrecognized_keys' },
      ]);
    }
  });

  test('lumens and cutoff outside their ranges are refused at that field', () => {
    const at = (field: string): string[] => [`${VARIANT_AT}.lights.0.${field}`];
    expect(issuePaths(lit([{ ...TABLE_BULB, lumens: 0 }]))).toEqual(at('lumens'));
    expect(issuePaths(lit([{ ...TABLE_BULB, lumens: -1 }]))).toEqual(at('lumens'));
    expect(issuePaths(lit([{ ...TABLE_BULB, lumens: LAMP_MAX_LUMENS + 1 }]))).toEqual(at('lumens'));
    expect(issuePaths(lit([{ ...TABLE_BULB, cutoff: 0 }]))).toEqual(at('cutoff'));
    expect(issuePaths(lit([{ ...TABLE_BULB, cutoff: 20 }]))).toEqual(at('cutoff'));
    expect(projectManifestIssues(lit([{ ...TABLE_BULB, lumens: LAMP_MAX_LUMENS, cutoff: LAMP_MAX_CUTOFF }]))).toEqual([]);
  });

  test("a colour that is not #rrggbb is refused at that light's colour", () => {
    for (const colour of ['#fd9', 'ffd9a4', 'warm', '#ffd9a4ff']) {
      expect(issuePaths(lit([{ ...TABLE_BULB, colour }]))).toEqual([`${VARIANT_AT}.lights.0.colour`]);
    }
  });

  test("a position holding NaN or Infinity, built in code, is refused at that light's position", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const value = lit([{ ...TABLE_BULB, position: [0, bad, 0] }]);
      expect(issuePaths(value).every((path) => path.startsWith(`${VARIANT_AT}.lights.0.position`))).toBe(true);
      expect(issuePaths(value).length).toBeGreaterThan(0);
    }
  });

  test('the light schema and its limits are published for the formats that mirror it', () => {
    expect({ lumens: LAMP_MAX_LUMENS, cutoff: LAMP_MAX_CUTOFF, lights: LAMP_MAX_LIGHTS }).toEqual({
      lumens: 10_000,
      cutoff: 15,
      lights: 4,
    });
    expect(z.safeParse(lampLightSchema, TABLE_BULB).success).toBe(true);
    expect(z.safeParse(lampLightSchema, { ...TABLE_BULB, lumens: 0 }).success).toBe(false);
  });
});
