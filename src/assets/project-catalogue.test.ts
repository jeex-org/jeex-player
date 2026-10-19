/**
 * The three lookups a baked project hands the geometry layer.
 *
 * Each is a boundary the render path crosses with UNTRUSTED data — a manifest
 * that arrived over the network — so each is tested for what it refuses as
 * much as for what it answers: a model path that leaves the project folder, an
 * archetype nobody declared, a finish id from neither source.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DemoAsset } from '../scene/types.js';
import { findCatalogueEntry } from './asset-catalogue.js';
import { isResolved, resolveAsset, type ResolvedAsset } from './asset-resolver.js';
import { parseProjectManifest, projectManifestIssues } from './project-manifest.schema.js';
import { projectBank, projectCatalogue, projectFinishResolver, projectModelUrl, projectPreviewUrl } from './project-catalogue.js';
import type { BakedProjectManifest } from './project-manifest.js';
import { ARCHETYPE } from './catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { PROJECT_FIXTURE as FIXTURE } from '../../tests/fixtures/project/fixture-ids.js';

/** Placements of the documents below, and an id nobody declares. */
const SOFA = '01a12ff0-fed2-7ecf-b05b-fe192f680d29';
const BED = '01a12ff3-307b-7a03-a715-a26b693a1b1d';
const NOBODY = '01a12ff3-307c-7430-8032-30605b78532d';
const REMOTE_PREVIEW = `https://cdn.example.com/v1/previews/${FIXTURE.workspaceId}/${FIXTURE.asset.boxSofa}/${FIXTURE.variant.boxSofa}/1.0.0.webp`;

const FIXTURE_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'project');
const BASE_URL = 'https://example.com/w1/fixture/1/';

function fixture(): BakedProjectManifest {
  return parseProjectManifest(JSON.parse(readFileSync(join(FIXTURE_DIR, 'project.json'), 'utf8')) as unknown);
}

describe('a project catalogue', () => {
  const manifest = fixture();

  test('answers an archetype id with the archetype', () => {
    const entry = projectCatalogue(manifest.library)(FIXTURE.asset.boxSofa);
    expect(entry?.object.id).toBe(FIXTURE.asset.boxSofa);
    expect(entry?.variantId).toBeUndefined();
  });

  test('answers a VARIANT id with its archetype and the variant it named', () => {
    const entry = projectCatalogue(manifest.library)(FIXTURE.variant.boxSofa);
    expect({ archetype: entry?.object.id, variant: entry?.variantId }).toEqual({
      archetype: FIXTURE.asset.boxSofa,
      variant: FIXTURE.variant.boxSofa,
    });
  });

  test('answers null for an id the project never declared', () => {
    expect(projectCatalogue(manifest.library)(ARCHETYPE.sofa_3s)).toBeNull();
  });

  test('offers an id it does not carry to the bank behind it, legacy alias included', () => {
    const layered = projectCatalogue(manifest.library, findCatalogueEntry);

    // The shipped bank stays the fallback until the builders are retired, so a
    // document mixing the two resolves both.
    expect(layered(FIXTURE.asset.boxSofa)?.object.id).toBe(FIXTURE.asset.boxSofa);
    expect(layered(ARCHETYPE.sofa_3s)?.object.id).toBe(ARCHETYPE.sofa_3s);
    expect(layered('bed')?.object.id).toBe(ARCHETYPE.bed_double);
    expect(layered(NOBODY)).toBeFalsy();
  });

  test('a project entry with the same id as a bank entry wins', () => {
    const object = manifest.library.objects[0]!;
    const shadowing = { ...manifest.library, objects: [{ ...object, id: ARCHETYPE.sofa_3s }] };

    expect(projectCatalogue(shadowing, findCatalogueEntry)(ARCHETYPE.sofa_3s)?.object.dims).toEqual(object.dims);
  });
});

describe('a document mixing a project object and a legacy placement', () => {
  const manifest = fixture();
  const bank = projectBank(manifest, BASE_URL);
  const resolve = (placement: DemoAsset): ResolvedAsset => {
    const result = resolveAsset(placement, {
      defaultLibrary: bank.defaultLibrary,
      catalogue: bank.catalogue,
      resolveFinish: bank.resolveFinish,
    });
    if (!isResolved(result)) throw new Error(`unresolved: ${result.failure.reason} ${result.failure.detail}`);
    return result.asset;
  };

  test('resolves the project object to its GLB and the legacy one to a builder', () => {
    const sofa = resolve({
      id: SOFA,
      type: FIXTURE.asset.boxSofa,
      asset: `${FIXTURE.projectId}:${FIXTURE.asset.boxSofa}`,
      variant: FIXTURE.variant.boxSofa,
      position: { x: 0, y: 0, z: 0 },
    });
    expect({ archetype: sofa.archetypeId, builder: sofa.builder }).toEqual({ archetype: FIXTURE.asset.boxSofa, builder: undefined });
    expect(bank.modelUrl(sofa)).toBe(`${BASE_URL}obj/box-sofa@1.0.0.glb`);

    // A legacy `type` the exporter never rewrote: the bank builds it, exactly
    // as it does in a bare scene, rather than degrading to `unknown-asset`.
    const bed = resolve({ id: BED, type: 'bed', position: { x: 0, y: 0, z: 0 } });
    expect(bed.archetypeId).toBe(ARCHETYPE.bed_double);
    expect(bed.builder).toBeTruthy();
  });

  test('a bank entry keeps its builder body: its model is NOT fetched from the project folder', () => {
    // The shipped entries carry `obj/<slug>.glb` paths their library has no
    // `baseUrl` for; resolving them against the project folder would ask a
    // bake for a file no bake ever wrote.
    const bed = resolve({ id: BED, type: 'bed', position: { x: 0, y: 0, z: 0 } });
    expect(bed.model).toBeTruthy();
    expect(bank.modelUrl(bed)).toBeUndefined();
  });
});

describe('a project finish resolver', () => {
  const resolve = projectFinishResolver(fixture().library);

  test('passes the ids the project declares through untouched', () => {
    expect(resolve(FIXTURE.material.oak)).toBe(FIXTURE.material.oak);
    expect(resolve(FIXTURE.material.white)).toBe(FIXTURE.material.white);
  });

  test('falls back to the bundled bank, so a scene naming bank finishes keeps them', () => {
    // A scene names bank finishes no exporter carries into
    // `library.materials`; a 1.x word for one is not a
    // finish at all.
    expect(resolve(FINISH.linen_sand)).toBe(FINISH.linen_sand);
    expect(resolve('linen')).toBeUndefined();
  });

  test('drops an id neither source knows, so the slot falls back to its default', () => {
    expect(resolve(NOBODY)).toBeUndefined();
    expect(resolve(undefined)).toBeUndefined();
  });
});

describe('a project model url', () => {
  const url = projectModelUrl(BASE_URL);

  test('resolves a relative model against the manifest folder', () => {
    expect(url({ model: 'obj/box-sofa@1.0.0.glb' })).toBe(`${BASE_URL}obj/box-sofa@1.0.0.glb`);
  });

  test('is undefined for an entry with no model at all', () => {
    expect(url({})).toBeUndefined();
    expect(url({ model: undefined })).toBeUndefined();
  });

  test('refuses a path that leaves the project folder', () => {
    // The schema refuses these too; this is the second lock, on the request
    // itself, because the resolver is what actually builds the URL.
    expect(url({ model: '../elsewhere/x.glb' })).toBeUndefined();
    expect(url({ model: 'https://evil.example/x.glb' })).toBeUndefined();
    expect(url({ model: '/x.glb' })).toBeUndefined();
  });
});

describe('the bank of one loaded project', () => {
  test('carries the library id as the default library and the variant model over the archetype one', () => {
    const manifest = fixture();
    const bank = projectBank(manifest, BASE_URL);
    expect(bank.defaultLibrary).toBe(FIXTURE.projectId);
    expect(bank.modelUrl({ archetypeId: FIXTURE.asset.boxSofa, model: manifest.library.objects[0]!.variants[0]!.model })).toBe(
      `${BASE_URL}obj/box-sofa@1.0.0.glb`,
    );
  });
});

/**
 * The picture, unlike every other string of a manifest, may point OUTSIDE the
 * folder — a catalogue service serves previews publicly — so this resolver is tested from
 * both sides: what it lets through untouched, and what it still refuses.
 */
describe('projectPreviewUrl', () => {
  const resolve = projectPreviewUrl(BASE_URL);

  test('an absolute https address passes through as it came', () => {
    expect(resolve({ preview: REMOTE_PREVIEW })).toBe(REMOTE_PREVIEW);
  });

  test('plain http passes through too: a catalogue service on a local origin during development', () => {
    expect(resolve({ preview: 'http://127.0.0.1:8080/p.webp' })).toBe('http://127.0.0.1:8080/p.webp');
  });

  test('a relative path is resolved against the manifest folder', () => {
    expect(resolve({ preview: 'prev/box-sofa.webp' })).toBe(`${BASE_URL}prev/box-sofa.webp`);
  });

  test('a relative path that leaves the folder answers undefined, exactly like a model that does', () => {
    expect(resolve({ preview: '../../other/p.webp' })).toBeUndefined();
    expect(projectModelUrl(BASE_URL)({ model: '../../other/x.glb' })).toBeUndefined();
  });

  test('a scheme that is not http(s) answers undefined: the string ends up in an <img>', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/webp;base64,AA', 'file:///etc/passwd']) {
      expect({ bad, url: resolve({ preview: bad }) }).toEqual({ bad, url: undefined });
    }
  });

  test('no preview at all is undefined, not an empty string', () => {
    expect(resolve({})).toBeUndefined();
    expect(resolve({ preview: '' })).toBeUndefined();
  });

  test('an unparseable base leaves even a relative picture unresolved', () => {
    expect(projectPreviewUrl('not a url')({ preview: 'prev/box-sofa.webp' })).toBeUndefined();
  });
});

describe('a project bank publishes the variant bank the UI offers', () => {
  test('its catalogue answers the project first and the shipped bank behind it', () => {
    const bank = projectBank(fixture(), BASE_URL);
    expect(bank.variants.catalogue(FIXTURE.asset.boxSofa)?.object.id).toBe(FIXTURE.asset.boxSofa);
    expect(bank.variants.catalogue(ARCHETYPE.sofa_3s)?.object.id).toBe(ARCHETYPE.sofa_3s);
  });

  test('its previewUrl is the folder resolver: a relative picture becomes an absolute one', () => {
    const bank = projectBank(fixture(), BASE_URL);
    expect(bank.variants.previewUrl?.({ preview: 'prev/box-sofa.webp' })).toBe(`${BASE_URL}prev/box-sofa.webp`);
  });

  test('the render path and the Replace panel share ONE lookup, not two equivalent ones', () => {
    const bank = projectBank(fixture(), BASE_URL);
    // Identity, not equality: two instances could only agree by convention,
    // and the panel promising the entry the loader draws is the whole point.
    expect(bank.variants.catalogue).toBe(bank.catalogue);
  });
});

/**
 * The schema admits a manifest and the resolver builds the request, and they
 * read `preview` with the SAME predicate (`assets/asset-types.ts` `isHttpUrl`).
 * If they ever disagree the failure is silent — a document accepted whole
 * whose every picture the resolver drops — so the agreement is asserted rather
 * than assumed.
 */
describe('the schema and the preview resolver agree on every absolute address', () => {
  const resolve = projectPreviewUrl(BASE_URL);
  const CASES = [
    REMOTE_PREVIEW,
    'http://127.0.0.1:8080/p.webp',
    'javascript:alert(1)',
    'data:image/webp;base64,AA',
    'blob:https://x/y',
    'file:///etc/passwd',
    '//cdn.example.com/x.webp',
  ];

  for (const preview of CASES) {
    test(preview, () => {
      const manifest = JSON.parse(JSON.stringify(fixture())) as Record<string, unknown>;
      const library = manifest['library'] as { objects: Record<string, unknown>[] };
      (library.objects[0]!['variants'] as Record<string, unknown>[])[0]!['preview'] = preview;

      const admitted = projectManifestIssues(manifest).length === 0;
      const resolved = resolve({ preview }) !== undefined;
      expect({ preview, admitted, resolved }).toEqual({ preview, admitted: resolved, resolved });
    });
  }
});
