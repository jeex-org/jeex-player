import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { ktx2MapProblem, readKtx2Facts } from '../src/materials/ktx2-container.ts';
import { fixturePng, KTX2_FIXTURE_DIR, KTX2_FIXTURE_SIZE_LIMIT, KTX2_FIXTURES, ktxCreateArgs } from './make-fixture-ktx2.ts';

describe('make-fixture-ktx2', () => {
  for (const fixture of KTX2_FIXTURES) {
    test(`${fixture.name} is a small Basis KTX2 of its named size with a full mip chain`, () => {
      const bytes = readFileSync(resolve(import.meta.dirname, '..', KTX2_FIXTURE_DIR, fixture.name));
      expect(bytes.byteLength).toBeLessThanOrEqual(KTX2_FIXTURE_SIZE_LIMIT);
      const facts = readKtx2Facts(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))!;
      expect(ktx2MapProblem(facts, fixture.size)).toBeNull();
      expect(facts.levels).toBe(Math.log2(fixture.size) + 1);
    });
  }

  test('colour maps are ETC1S in sRGB, data maps UASTC in linear', () => {
    expect(ktxCreateArgs('colour')).toEqual(expect.arrayContaining(['basis-lz', 'srgb', 'bt709']));
    expect(ktxCreateArgs('linear')).toEqual(expect.arrayContaining(['uastc', 'linear', 'none']));
  });

  test('writes an RGB PNG whose first row is the top of the picture', () => {
    const orientation = KTX2_FIXTURES.find((fixture) => fixture.name.startsWith('orientation'))!;
    const png = fixturePng(orientation);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(128);
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    // Row 0 (filter byte, then RGB) is white; the last row is black.
    expect([...raw.subarray(1, 4)]).toEqual([255, 255, 255]);
    expect([...raw.subarray(raw.length - 3)]).toEqual([0, 0, 0]);
  });
});
