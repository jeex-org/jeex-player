/**
 * The 22-character form IFC writes a UUID in.
 *
 * An exported entity row (`scene/metadata-table.ts`) carries the entity's own
 * UUID, minted by the document's author, and its IFC compression beside it.
 * This module only re-encodes a UUID it is given; it derives and mints none.
 *
 * The compression to IFC's alphabet is re-implemented from a description of
 * the algorithm — after OpenGeometry `export/ifc.rs` `ifc_guid` (MPL-2.0),
 * read for its description only; no code is copied.
 *
 * Invariant: `ifcGuid` is a pure, injective function of its UUID.
 *
 * Pure module: no `three`, no DOM.
 */

import { ViewerLibError } from './errors.js';

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
