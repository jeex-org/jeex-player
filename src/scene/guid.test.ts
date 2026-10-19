import { describe, expect, test } from 'bun:test';
import { JEEX_GUID_NAMESPACE, faceGuid } from './guid.js';
import { faceKey } from './types.js';
import { ifcGuid } from '../shared/uuid.js';

/**
 * Determinism is the whole contract, so the tests are mostly equalities: the
 * same face must get the same GUID on every machine and in every release. The
 * GOLDEN values at the bottom are what make that a promise rather than an
 * intention — a change to the seed grammar, the namespace or the hash breaks
 * them, which is the point.
 */

/** Fixed ids for these tests, generated once offline. */
const ROOM = '01a12ff3-14aa-79aa-b152-d6353331ad55';
const OTHER_ROOM = '01a12ff3-14ac-7ddc-b8e2-df7a18d944df';
const WALL = '01a12ff3-14ab-7bed-8487-b57fffc0fb81';

const V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('faceGuid', () => {
  test('the same face gives the same id, every time, however the key was built', () => {
    expect(faceGuid(faceKey(ROOM, WALL, 'L'))).toBe(faceGuid({ room: ROOM, wallId: WALL, side: 'L' }));
  });

  test('owner and side are part of the identity', () => {
    const ids = new Set([
      faceGuid(faceKey(ROOM, WALL, 'L')),
      faceGuid(faceKey(ROOM, WALL, 'R')),
      faceGuid(faceKey(OTHER_ROOM, WALL, 'L')),
      faceGuid(faceKey(null, WALL, 'L')),
      faceGuid(faceKey(null, WALL, 'R')),
    ]);
    expect(ids.size).toBe(5);
  });

  test('is a name-based v5 UUID, never a v7 an author could have minted', () => {
    expect(faceGuid(faceKey(ROOM, WALL, 'L'))).toMatch(V5);
    expect(faceGuid(faceKey(null, WALL, 'R'))).toMatch(V5);
  });
});

describe('the golden values', () => {
  /**
   * Published: an IFC consumer keys its overrides on these. Changing any of
   * them is a BREAKING change to every exchange file already in the wild, so
   * it has to break a test first.
   */
  test('the JEEX namespace is fixed', () => {
    expect(JEEX_GUID_NAMESPACE).toBe('11463d0e-2aea-59b3-8e1b-2b5b05c0291c');
  });

  test('a room face derives from jeex-face:<room>/<wall>/<side>', () => {
    const guid = faceGuid(faceKey(ROOM, WALL, 'L'));
    expect(guid).toBe('c09c1625-705f-534e-8af2-608f3a350d16');
    expect(ifcGuid(guid)).toBe('30d1ObS5zJJehoO8ywDGqM');
  });

  test('a facade face derives from jeex-face:facade/<wall>/<side>', () => {
    expect(faceGuid(faceKey(null, WALL, 'R'))).toBe('7da332c1-5bed-5c2f-91dc-4662502a844d');
  });
});
