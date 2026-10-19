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
import { parseProjectManifest, projectManifestIssues, projectManifestSchema } from './project-manifest.schema.js';
import { PROJECT_FIXTURE as FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';

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
