# Proposal

## Why

The offline light bake takes two things from the player that need tightening. Its lamp power is computed by a local copy of a conversion the lighting module now publishes, so the two could drift apart. And about half of the charted lightmap area of a real apartment bake is spent on triangles no light reaches in a walk (floor slab undersides and edges, the inner faces of the wall prisms, wall bottoms, end caps inside another wall): they bake to zero, take atlas space at full density, and where the dollhouse cut exposes them they show black.

## What Changes

- The bake lights take the lamp power from the lighting module's `blenderPower`; the local conversion and the schema's own constant are removed. Output is unchanged.
- The assumption that a ceiling lamp's bulb sits at the catalogue's `dims[1]` in a bake built without model URLs is documented and pinned by a test against the GLB upgrade.
- The shell builders record, per triangle, which ones no walk can see. The shell export writes a mesh with such triangles as two nodes: its seen part, then its unseen part marked `unseen: true`.
- The loader refuses UV1 on an unseen node. Adoption gives a live mesh the seen part's geometry and attaches the unseen part as a child drawn with the live material, so it renders with live lighting, while picking, the dollhouse, paint and the highlight behave as on the live shell.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `light-bake-lights`: lamp power from the lighting module's conversion; the ceiling-lamp height assumption.
- `light-bake-shell`: the unseen split in the export, the contract field, the loader rule and adoption of split meshes.

## Impact

`src/lightmap/` (bake lights and their schema, shell export, contract, extras schema, adoption, baked shell), `src/geometry/shell-builder.ts` (records triangle roles; drawn geometry unchanged), a new `src/geometry/shell-unseen.ts`, the stand-in unwrap fixture. The shell file format changes for consumers: a bake tool must treat `unseen` nodes as occluders without UV1, and shell files exported before this change no longer match and must be exported and baked again. No public surface changes.
