/**
 * SHA-1 (RFC 3174 / FIPS 180-1), synchronous and dependency-free.
 *
 * It exists for ONE reason: `uuid.ts` derives a name-based UUID, and a UUID v5
 * is defined as a SHA-1 over the namespace and the name. WebCrypto's
 * `subtle.digest` returns a promise, and every caller here — `scene/guid.ts`,
 * the importers above it — is a pure synchronous function that turns a
 * document into ids while building it; making that chain async to reach a
 * digest would be an async id, which nothing in the schema can hold. Node's
 * `crypto` is not available to a browser bundle, and a package for eighty
 * lines is a dependency the budget does not have.
 *
 * SHA-1 is used here as an id derivation, never as a security primitive: the
 * whole point is that the same seed gives the same id on every machine, and a
 * collision would need a deliberately crafted seed by whoever also authors the
 * document.
 *
 * Invariant: `sha1(bytes)` reads exactly `bytes.length` bytes of the VIEW it
 * is given (never the rest of a shared `ArrayBuffer`) and answers with a fresh
 * twenty-byte array.
 *
 * Pure module: no `three`, no DOM.
 */

/** Bytes in one SHA-1 block. */
const BLOCK_BYTES = 64;

/** Bytes of the digest: 160 bits. */
const DIGEST_BYTES = 20;

/** The five initial chaining values of RFC 3174 §3. */
const H0 = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0] as const;

/** The four round constants, one per twenty steps (RFC 3174 §5). */
const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6] as const;

/** Left rotation of a 32-bit word — the operation the whole algorithm is built from. */
function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/**
 * The padded message: the input, a `0x80` byte, zeros, and the bit length as a
 * big-endian 64-bit integer, rounded up to whole blocks (RFC 3174 §4).
 *
 * The length is written as two 32-bit halves because a JavaScript number
 * cannot hold a 64-bit integer exactly — and `bytes.length * 8` overflows 32
 * bits at 512 MB, which is well inside what a fetched document could be.
 */
function padded(bytes: Uint8Array): Uint8Array {
  const blocks = Math.floor((bytes.length + 8) / BLOCK_BYTES) + 1;
  const message = new Uint8Array(blocks * BLOCK_BYTES);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  const view = new DataView(message.buffer);
  view.setUint32(message.length - 8, Math.floor(bits / 0x1_0000_0000), false);
  view.setUint32(message.length - 4, bits >>> 0, false);
  return message;
}

/** SHA-1 of `bytes`: twenty raw bytes, big-endian as the RFC defines them. */
export function sha1(bytes: Uint8Array): Uint8Array {
  const message = padded(bytes);
  const view = new DataView(message.buffer);
  const h = Int32Array.from(H0);
  const w = new Int32Array(80);

  for (let offset = 0; offset < message.length; offset += BLOCK_BYTES) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getInt32(offset + t * 4, false);
    for (let t = 16; t < 80; t += 1) w[t] = rotl(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1);

    let [a, b, c, d, e] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!];
    for (let t = 0; t < 80; t += 1) {
      const round = Math.floor(t / 20);
      // The four round functions of RFC 3174 §5, in their canonical order.
      const f =
        round === 0
          ? (b & c) | (~b & d)
          : round === 2
            ? (b & c) | (b & d) | (c & d)
            : // Rounds 1 and 3 share the parity function.
              b ^ c ^ d;
      const temp = (rotl(a, 5) + (f >>> 0) + (e >>> 0) + K[round]! + (w[t]! >>> 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) | 0;
      b = a;
      a = temp | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
  }

  const digest = new Uint8Array(DIGEST_BYTES);
  const out = new DataView(digest.buffer);
  for (let index = 0; index < 5; index += 1) out.setInt32(index * 4, h[index]!, false);
  return digest;
}

/** The same digest as lowercase hexadecimal — what a test vector is written in. */
export function sha1Hex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of sha1(bytes)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
