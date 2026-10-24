import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BASISU_FIXTURE_OUTPUT,
  buildBasisuFixtureGlb,
  buildFixtureGlb,
  FIXTURE_DIMS,
  FIXTURE_OUTPUT,
  FIXTURE_SIZE_LIMIT,
  glbJson,
  LAMP_FIXTURES,
} from './make-fixture-glb.ts';

const HERE = import.meta.dirname;

describe('make-fixture-glb', () => {
  const bytes = buildFixtureGlb();
  const json = glbJson(bytes);

  test('is a version 2 GLB container', () => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF');
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(bytes.byteLength);
    expect((json['asset'] as { version: string }).version).toBe('2.0');
    expect((json['extras'] as { jeexFixture: boolean }).jeexFixture).toBe(true);
  });

  test('names its materials after the two slots the loader binds', () => {
    const materials = json['materials'] as { name: string }[];
    expect(materials.map((material) => material.name)).toEqual(['seat', 'frame']);
  });

  test('measures exactly the archetype dims', () => {
    const position = (json['accessors'] as { min: number[]; max: number[] }[])[0]!;
    for (const axis of [0, 1, 2]) expect(position.max[axis]! - position.min[axis]!).toBeCloseTo(FIXTURE_DIMS[axis]!, 3);
  });

  test('carries the pivot convention: floor centre, front -Z', () => {
    const position = (json['accessors'] as { min: number[]; max: number[] }[])[0]!;
    expect(position.min[1]!).toBeCloseTo(0, 6);
    expect(position.min[0]!).toBeCloseTo(-position.max[0]!, 6);
    expect(position.min[2]!).toBeCloseTo(-position.max[2]!, 6);
  });

  test('is deterministic and small enough to commit', () => {
    expect(Buffer.from(buildFixtureGlb())).toEqual(Buffer.from(bytes));
    expect(bytes.byteLength).toBeLessThanOrEqual(FIXTURE_SIZE_LIMIT);
  });

  test('the committed fixture is what the script produces', () => {
    const committed = readFileSync(resolve(HERE, '..', FIXTURE_OUTPUT));
    expect(Buffer.from(committed)).toEqual(Buffer.from(bytes));
  });
});

describe('make-fixture-glb, the KHR_texture_basisu variant', () => {
  const bytes = buildBasisuFixtureGlb();
  const json = glbJson(bytes);

  test('requires KHR_texture_basisu and names its KTX2 image only through the extension', () => {
    expect(json['extensionsUsed']).toEqual(['KHR_texture_basisu']);
    expect(json['extensionsRequired']).toEqual(['KHR_texture_basisu']);
    const texture = (json['textures'] as Record<string, unknown>[])[0]!;
    expect(texture['source']).toBeUndefined();
    expect(texture['extensions']).toEqual({ KHR_texture_basisu: { source: 0 } });
    expect(json['images']).toEqual([{ bufferView: 4, mimeType: 'image/ktx2' }]);
  });

  test('embeds the KTX2 bytes as they are, and the frame samples them', () => {
    const views = json['bufferViews'] as { byteOffset: number; byteLength: number }[];
    const image = views[4]!;
    const binStart = 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true) + 8;
    const embedded = bytes.subarray(binStart + image.byteOffset, binStart + image.byteOffset + image.byteLength);
    expect(Buffer.from(embedded)).toEqual(readFileSync(resolve(HERE, '..', 'tests/fixtures/ktx2/swatch.16.ktx2')));
    const frame = (json['materials'] as { name: string; pbrMetallicRoughness: Record<string, unknown> }[])[1]!;
    expect(frame.pbrMetallicRoughness['baseColorTexture']).toEqual({ index: 0 });
  });

  test('is deterministic, small, and the committed file', () => {
    expect(Buffer.from(buildBasisuFixtureGlb())).toEqual(Buffer.from(bytes));
    expect(bytes.byteLength).toBeLessThanOrEqual(FIXTURE_SIZE_LIMIT);
    expect(readFileSync(resolve(HERE, '..', BASISU_FIXTURE_OUTPUT))).toEqual(Buffer.from(bytes));
  });
});

describe('make-fixture-glb, the lamp bodies', () => {
  for (const fixture of LAMP_FIXTURES) {
    const bytes = buildFixtureGlb(undefined, fixture.model);
    const json = glbJson(bytes);
    const position = (json['accessors'] as { min: number[]; max: number[] }[])[0]!;

    test(`${fixture.model.node} measures its dims in the model frame and names the lamp slots`, () => {
      for (const axis of [0, 1, 2]) expect(position.max[axis]! - position.min[axis]!).toBeCloseTo(fixture.dims[axis]!, 6);
      expect(position.min[1]!).toBeCloseTo(0, 6);
      expect(position.min[0]!).toBeCloseTo(-position.max[0]!, 6);
      expect(position.min[2]!).toBeCloseTo(-position.max[2]!, 6);
      expect((json['materials'] as { name: string }[]).map((material) => material.name)).toEqual(['metal', 'shade']);
    });

    test(`${fixture.model.node} is small and the committed file`, () => {
      expect(bytes.byteLength).toBeLessThanOrEqual(FIXTURE_SIZE_LIMIT);
      expect(Buffer.from(readFileSync(resolve(HERE, '..', fixture.output)))).toEqual(Buffer.from(bytes));
    });
  }
});
