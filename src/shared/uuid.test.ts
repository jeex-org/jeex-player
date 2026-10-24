import { describe, expect, test } from 'bun:test';
import { ifcGuid } from './uuid.js';

/**
 * The IFC compression: known values, the alphabet, and the round-trip.
 *
 * The parser below lives in the TEST on purpose: nothing in the viewer reads
 * an IFC GUID back, and an exported inverse nobody calls is a dead export. It
 * is here to prove the writer is injective, not to be used.
 */

const IFC_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** The inverse of `ifcGuid`: 22 IFC characters back into a 8-4-4-4-12 UUID. */
function parseIfcGuid(guid: string): string {
  const value = (char: string): number => {
    const index = IFC_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`not an IFC GUID character: ${char}`);
    return index;
  };
  const bytes: number[] = [value(guid[0]!) * 64 + value(guid[1]!)];
  for (let group = 0; group < 5; group += 1) {
    let word = 0;
    for (let index = 0; index < 4; index += 1) word = word * 64 + value(guid[2 + group * 4 + index]!);
    bytes.push((word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Fixed inputs: UUIDs of every version an entity id or a test may hold, generated once offline. */
const SAMPLES = [
  '01a12ff3-14aa-79aa-b152-d6353331ad55',
  '01a12ff3-14ab-7bed-8487-b57fffc0fb81',
  'c09c1625-705f-534e-8af2-608f3a350d16',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
];

describe('ifcGuid', () => {
  test('the zero UUID is twenty-two zeros', () => {
    expect(ifcGuid('00000000-0000-0000-0000-000000000000')).toBe('0000000000000000000000');
  });

  test('is always twenty-two characters of the IFC alphabet', () => {
    for (const uuid of SAMPLES) {
      const guid = ifcGuid(uuid);
      expect({ uuid, length: guid.length }).toEqual({ uuid, length: 22 });
      expect(guid).toMatch(/^[0-9A-Za-z_$]{22}$/);
    }
  });

  test('a known value: the compression is the published IFC one', () => {
    expect(ifcGuid('c09c1625-705f-534e-8af2-608f3a350d16')).toBe('30d1ObS5zJJehoO8ywDGqM');
    expect(ifcGuid('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe('3$$$$$$$$$$$$$$$$$$$$$');
  });

  test('round-trips: the compression loses nothing', () => {
    for (const uuid of SAMPLES) expect(parseIfcGuid(ifcGuid(uuid))).toBe(uuid);
  });

  test('two different uuids give two different guids', () => {
    const a = ifcGuid(SAMPLES[0]!);
    const b = ifcGuid(SAMPLES[1]!);
    expect(a).not.toBe(b);
  });

  test('refuses anything that is not a UUID', () => {
    expect(() => ifcGuid('00000000-0000-0000-0000-00000000000')).toThrow(/uuid/i);
  });
});
