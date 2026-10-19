import { describe, expect, test } from 'bun:test';
import { sha1, sha1Hex } from './sha1.js';

/**
 * The three RFC 3174 / FIPS 180-1 vectors, and the padding edge they exist to
 * pin: a message that is exactly one block, and one that spans many.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sha1', () => {
  test('the empty message', () => {
    expect(sha1Hex(utf8(''))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  test("the RFC's 'abc'", () => {
    expect(sha1Hex(utf8('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  test("the RFC's 448-bit message, which needs a second padding block", () => {
    expect(sha1Hex(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
  });

  test('one million letters — the length counter past a single byte', () => {
    expect(sha1Hex(utf8('a'.repeat(1_000_000)))).toBe('34aa973cd4c4daa4f61eeb2bdbad27316534016f');
  });

  test('answers with twenty raw bytes', () => {
    const digest = sha1(utf8('abc'));
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(digest.length).toBe(20);
    expect(digest[0]).toBe(0xa9);
    expect(digest[19]).toBe(0x9d);
  });

  test('a byte flipped anywhere changes the digest', () => {
    expect(sha1Hex(utf8('abc'))).not.toBe(sha1Hex(utf8('abd')));
  });

  test('does not read past its input inside a shared buffer', () => {
    // A subarray shares the ArrayBuffer with the bytes after it; a hash that
    // walked the buffer rather than the view would see them.
    const shared = new Uint8Array([0x61, 0x62, 0x63, 0xff, 0xff, 0xff]);
    expect(sha1Hex(shared.subarray(0, 3))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
});
