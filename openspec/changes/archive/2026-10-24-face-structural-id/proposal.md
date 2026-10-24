# Proposal

## Why

The GLB export's element metadata table gives every wall face a GUID the viewer derives from the face's owners (a UUID v5 of the room, the wall and the side). That is an id composed from other ids and minted by the viewer, while the viewer's rule is that it mints no ids and only carries the ids its callers minted. A face has no id in the scene document, so the export stops inventing one and addresses the face by what it is: a side of a wall, seen from a room or from outside.

## What Changes

1. **BREAKING (export format):** a `wallFace` row of the `jeexElements` property table no longer has a `guid`, `ifcGuid` or `id`; those cells are `null` and the three properties are declared `required: false`. The face is addressed by `wallId` + `side` + `roomId` (`null` on the facade), as before present in the row.
2. **BREAKING (export format):** face rows are ordered by `wallId`, then `side` (ordinal comparison), instead of by the derived GUID. Row indexes, and so the `EXT_mesh_features` feature ids of wall meshes, change for the same document. Entity rows and their order are unchanged.
3. The face GUID derivation (`faceGuid`, the JEEX UUID namespace), the name-based UUID v5 helper and the SHA-1 implementation it needed are removed. The IFC GUID compression of entity UUIDs stays.
4. The dev furniture gallery mints a UUID v7 per specimen when it loads instead of deriving one from the variant id.

## Capabilities

### New Capabilities
- `glb-element-metadata`: the element metadata table `exportGlb` writes: which rows exist, how each row is identified or addressed, the property columns, row order and how meshes point at rows.

### Modified Capabilities

## Impact

1. Code: `src/scene/metadata-table.ts`, `src/render/export-graph.ts` (type only), `src/shared/uuid.ts`; removed `src/scene/guid.ts`, `src/shared/sha1.ts` and their tests; `src/purity.test.ts`; `dev/furniture-gallery.ts`.
2. Public output: the `EXT_structural_metadata` table inside every `exportGlb` result (`ViewerHandle.exportGlb`, the embed host's `exportGlb`). The scene document, its schema and `schemaVersion` do not change.
3. Docs: README `exportGlb` paragraph, CHANGELOG entry under Unreleased marked Breaking.
4. No dependency changes.
