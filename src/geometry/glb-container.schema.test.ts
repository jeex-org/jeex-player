import { describe, expect, test } from 'bun:test';
import { z } from 'zod/mini';
import { glbDocumentSchema, isGlbDocumentShape } from './glb-container.schema.js';
import type { GlbDocument } from './glb-container.js';

describe('glbDocumentSchema', () => {
  test('a document with embedded and external resources, and every other glTF field, passes', () => {
    const document = {
      asset: { version: '2.0' },
      images: [{ bufferView: 0, mimeType: 'image/png' }, { uri: 'tex/wood.png' }],
      buffers: [{ byteLength: 64 }, { uri: 'data.bin', byteLength: 8 }],
      meshes: [],
    };
    expect(isGlbDocumentShape(document)).toBe(true);
  });

  test('a document with neither field passes: nothing to scan', () => {
    expect(isGlbDocumentShape({ asset: { version: '2.0' } })).toBe(true);
  });

  test.each([
    ['an array', [{}]],
    ['null', null],
    ['a string', 'glTF'],
    ['images that are not an array', { images: { uri: 'a.png' } }],
    ['an image that is not an object', { images: ['a.png'] }],
    ['a buffer uri that is not a string', { buffers: [{ uri: 7 }] }],
  ])('%s is refused', (_name, value) => {
    expect(isGlbDocumentShape(value)).toBe(false);
  });

  test('the hand-written GlbDocument and the schema agree both ways', () => {
    // Compile-time: if the two drift apart, `BothWays` collapses to `false` and
    // the next line stops compiling.
    type SchemaShape = Pick<z.infer<typeof glbDocumentSchema>, 'images' | 'buffers'>;
    type BothWays = SchemaShape extends GlbDocument ? (GlbDocument extends SchemaShape ? true : false) : false;
    const agree: BothWays = true;
    expect(agree).toBe(true);
  });
});
