# Brainstorm

## Problem

Scene schema 2.3 gave documents an optional `site` (north and sun preset), but no edit operation writes it: an editor can only replace the whole document. Editors need one operation that sets or clears either field and re-aims the live sun.

## Related work

1. The editor that consumes the field asked for the operation and agreed its contract before this change was written; until the operation ships it applies the same semantics on its own side and validates with the player's validator.
2. A parallel change adds 2.3 finish operations to the same operation dispatcher; its rule for 2.3 writers (refuse on a 2.2 document, never raise the version: the caller raises it) is followed here.

## Doubts

1. Range of `northDeg`: reject outside [0, 360) or normalise.
2. Clearing both fields: leave `site: {}` (which means north 0 at noon) or remove `site`.
3. An operation with no field at all.
4. Live update: does an operation-driven revision re-aim the sun without a reload.

## Approaches considered

1. **One `set_site` operation with optional, nullable fields (consumer's proposal).** Omitted keeps, `null` clears. Mirrors how editors patch one field at a time.
2. **Two operations, `set_north` and `set_sun_preset`.** Twice the vocabulary for one small object; rejected.
3. **Generic document patch.** No validation per field; rejected.

## Decision

Approach 1, with the contract agreed with the consumer:
1. Shape `{ op: 'set_site', northDeg?: number | null, sun?: 'morning' | 'noon' | 'evening' | null }`; at least one key present, otherwise the operation is invalid.
2. `northDeg` accepts any finite number and is stored normalised to [0, 360); a non-finite or non-number value is refused naming the field.
3. When both fields end absent, `site` is removed: the document returns to the sun of documents without orientation. The operation never writes an empty `site`.
4. Refused on a 2.2 document; never changes `schemaVersion`.
5. No new handle method: the scene mount already re-orients the sun and refits the shadow when a revision changes `site`; a test pins it.

## Rejected

1. Rejecting angles outside [0, 360): editors compute angles by rotation and would need to normalise themselves.
2. Keeping `site: {}` after clearing both: silently changes the sun from the legacy direction to noon.

## Process

The contract was settled with the consuming editor before this change, so no separate partner brainstorm was run; the independent partner reviews the artifacts.
