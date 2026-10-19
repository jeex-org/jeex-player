import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFixtureGlb, FIXTURE_DIMS, FIXTURE_OUTPUT, FIXTURE_SIZE_LIMIT, glbJson } from './make-fixture-glb.ts';

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
