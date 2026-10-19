import { describe, expect, test } from 'bun:test';
import { UUID_NAMESPACE_DNS, UUID_NAMESPACE_URL, ifcGuid, uuidV5 } from './uuid.js';

/**
 * RFC 4122 §4.3 vectors, and the IFC compression round-trip.
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

describe('uuidV5', () => {
  test("the RFC's DNS vector", () => {
    expect(uuidV5(UUID_NAMESPACE_DNS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  test('a URL-namespace vector', () => {
    expect(uuidV5(UUID_NAMESPACE_URL, 'https://example.com')).toBe('4fd35a71-71ef-5a55-a9d9-aa75c889a6d0');
  });

  test('stamps version 5 and the RFC 4122 variant', () => {
    const uuid = uuidV5(UUID_NAMESPACE_URL, 'anything at all');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('is a function of the namespace as well as the name', () => {
    expect(uuidV5(UUID_NAMESPACE_DNS, 'python.org')).not.toBe(uuidV5(UUID_NAMESPACE_URL, 'python.org'));
  });

  test('reads a namespace in any case and with braces', () => {
    const plain = uuidV5(UUID_NAMESPACE_DNS, 'python.org');
    expect(uuidV5(UUID_NAMESPACE_DNS.toUpperCase(), 'python.org')).toBe(plain);
    expect(uuidV5(`{${UUID_NAMESPACE_DNS}}`, 'python.org')).toBe(plain);
  });

  test('refuses a namespace that is not a UUID', () => {
    expect(() => uuidV5('not-a-uuid', 'x')).toThrow(/namespace/);
  });

  test('hashes the name as UTF-8, so a non-Latin name is stable', () => {
    expect(uuidV5(UUID_NAMESPACE_URL, 'спальня')).toMatch(/^[0-9a-f]{8}-/);
    expect(uuidV5(UUID_NAMESPACE_URL, 'спальня')).toBe(uuidV5(UUID_NAMESPACE_URL, 'спальня'));
  });
});

describe('ifcGuid', () => {
  test('the zero UUID is twenty-two zeros', () => {
    expect(ifcGuid('00000000-0000-0000-0000-000000000000')).toBe('0000000000000000000000');
  });

  test('is always twenty-two characters of the IFC alphabet', () => {
    for (const name of ['a', 'wall/1', 'спальня', 'x'.repeat(200)]) {
      const guid = ifcGuid(uuidV5(UUID_NAMESPACE_URL, name));
      expect({ name, length: guid.length }).toEqual({ name, length: 22 });
      expect(guid).toMatch(/^[0-9A-Za-z_$]{22}$/);
    }
  });

  test('round-trips: the compression loses nothing', () => {
    const uuid = uuidV5(UUID_NAMESPACE_URL, 'https://example.com');
    expect(parseIfcGuid(ifcGuid(uuid))).toBe(uuid);
  });

  test('two different uuids give two different guids', () => {
    const a = ifcGuid(uuidV5(UUID_NAMESPACE_URL, 'a'));
    const b = ifcGuid(uuidV5(UUID_NAMESPACE_URL, 'b'));
    expect(a).not.toBe(b);
  });

  test('refuses anything that is not a UUID', () => {
    expect(() => ifcGuid('00000000-0000-0000-0000-00000000000')).toThrow(/uuid/i);
  });
});
