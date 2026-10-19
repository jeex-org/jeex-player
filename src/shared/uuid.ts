/**
 * Name-based UUIDs (RFC 4122 §4.3, version 5) and the 22-character form IFC
 * writes them in.
 *
 * The rule this module serves: every id that leaves the viewer in an exchange
 * format is DERIVED from a stable semantic path, never handed out by a counter
 * or by `randomUUID`. Two exports of the same document, on two machines, in two
 * years, must name the same wall the same thing — that is what makes a
 * re-import an UPDATE instead of a duplicate, and it is what an IFC or IFCX
 * consumer keys its own overrides on. `scene/guid.ts` owns the seeds; this
 * module owns the arithmetic.
 *
 * The compression to IFC's alphabet is re-implemented from a description of
 * the algorithm — after OpenGeometry `export/ifc.rs` `ifc_guid` (MPL-2.0),
 * read for its description only; no code is copied.
 *
 * Invariant: `uuidV5` is a pure function of `(namespace, name)` and nothing
 * else — no clock, no randomness, no locale.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError } from './errors.js';
import { sha1 } from './sha1.js';

/** RFC 4122 Appendix C: the namespace for fully-qualified domain names. */
export const UUID_NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** RFC 4122 Appendix C: the namespace for URLs — the one JEEX derives its own from. */
export const UUID_NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/** The canonical 8-4-4-4-12 form, case-insensitive; braces are tolerated on input. */
const UUID_PATTERN = /^\{?([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}?$/i;

/**
 * IFC's base-64 alphabet (ISO 10303-21 / buildingSMART): digits, uppercase,
 * lowercase, then `_` and `$`. It is NOT RFC 4648's alphabet, and the order is
 * load-bearing — a GUID written with the wrong table reads as a different id.
 */
const IFC_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** The sixteen bytes of `uuid`, or a refusal naming the field. */
function uuidBytes(uuid: string, field: string): Uint8Array {
  const match = UUID_PATTERN.exec(uuid.trim());
  if (!match) {
    throw new ViewerLibError('bad-params', `${field} must be a UUID in 8-4-4-4-12 form, got ${JSON.stringify(uuid)}`, { path: field });
  }
  const hex = match.slice(1).join('');
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** The sixteen bytes back as lowercase 8-4-4-4-12. */
function formatUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * RFC 4122 §4.3: SHA-1 over the namespace's sixteen bytes followed by the
 * UTF-8 name, the first sixteen bytes of the digest taken, then the version
 * (5) written into the high nibble of byte 6 and the variant (10x) into the
 * top bits of byte 8.
 */
export function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = uuidBytes(namespace, 'uuidV5 namespace');
  const nameBytes = new TextEncoder().encode(name);
  const seed = new Uint8Array(namespaceBytes.length + nameBytes.length);
  seed.set(namespaceBytes);
  seed.set(nameBytes, namespaceBytes.length);

  const digest = sha1(seed).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  return formatUuid(digest);
}

/**
 * The 128 bits of `uuid` in IFC's 22-character form.
 *
 * The first byte becomes two characters (twelve bits of room for eight, so the
 * leading character is always `0`–`3`); the remaining fifteen bytes go in five
 * groups of three, each 24-bit group written as four six-bit characters. Two
 * plus twenty is the 22 characters an `IfcRoot.GlobalId` holds, and the mapping
 * is injective — nothing is lost, so a consumer that keeps the compressed form
 * can always recover the UUID.
 */
export function ifcGuid(uuid: string): string {
  const bytes = uuidBytes(uuid, 'ifcGuid uuid');
  // The first byte, as two base-64 digits, most significant first.
  let guid = IFC_ALPHABET[(bytes[0]! >> 6) & 0x3f]! + IFC_ALPHABET[bytes[0]! & 0x3f]!;
  for (let group = 0; group < 5; group += 1) {
    const at = 1 + group * 3;
    const word = (bytes[at]! << 16) | (bytes[at + 1]! << 8) | bytes[at + 2]!;
    for (let shift = 18; shift >= 0; shift -= 6) guid += IFC_ALPHABET[(word >> shift) & 0x3f]!;
  }
  return guid;
}
