/**
 * Exchange ids for the things a scene document names.
 *
 * The rule: an ENTITY's exchange GUID is its own UUID — the document already
 * carries a UUID v7 for every wall, opening, room and placement, minted by
 * whoever created it, so there is nothing to derive and nothing to store twice.
 * Its IFC GlobalId is that UUID in IFC's 22-character form
 * (`shared/uuid.ifcGuid`).
 *
 * What has no UUID of its own is DERIVED from the UUIDs it is made of, never
 * minted: a wall face is the side of a wall as seen from a room
 * (`FaceKey`), so its GUID is a UUID v5 of those owning UUIDs plus the side.
 * The same document yields the same face GUID on every machine and in every
 * release, so an IFC file re-exported a year later still names the same face,
 * and a consumer that keyed its own overrides on it still finds them.
 *
 * Invariant: `faceGuid` is a pure function of its face. Its golden values are
 * pinned in `guid.test.ts`; changing the seed grammar, the namespace or the
 * hash is a BREAKING change to every exchange file already written.
 *
 * Pure module: no `three`, no DOM.
 */

import { UUID_NAMESPACE_URL, uuidV5 } from '../shared/uuid.js';
import type { FaceKey } from './types.js';

/**
 * JEEX's own UUID namespace: `uuidV5` of a URL under the RFC 4122 URL
 * namespace. It is a CONSTANT expression rather than a literal so the derivation
 * is readable, and the literal it evaluates to is pinned by the golden test.
 */
export const JEEX_GUID_NAMESPACE = uuidV5(UUID_NAMESPACE_URL, 'https://player.jeex.org/schema/guid');

/**
 * The seed a face GUID derives from: `jeex-face:<room UUID | facade>/<wallId>/<side>`.
 *
 * Readable on purpose. When an id has to be debugged — "which face is
 * `5c1e…`?" — the answer is one hash of a string a human can write out, not a
 * lookup table nobody kept. A UUID never contains `/` and is never the word
 * `facade`, so the seed is unambiguous.
 */
function faceSeed(face: FaceKey): string {
  return `jeex-face:${face.room ?? 'facade'}/${face.wallId}/${face.side}`;
}

/** UUID v5 of the face's seed under the JEEX namespace: same face in, same id out. */
export function faceGuid(face: FaceKey): string {
  return uuidV5(JEEX_GUID_NAMESPACE, faceSeed(face));
}
