# Proposal

## Why

`exportGlb` names `EXT_mesh_features` and `EXT_structural_metadata` in `extensionsUsed` but writes neither the way the extensions define them. Feature ids sit on glTF nodes as `{ featureCount: 1, propertyTable: 0, nullFeatureId: -1, constant: N }`: the extension lives on mesh primitives, has no `constant` field, and `nullFeatureId` must be non-negative. The property table stores its columns as inline JSON arrays with `null` cells: the extension stores every property in binary bufferViews (`values`, plus `stringOffsets` for strings) and expresses a missing value with the class property's `noData`. A reader that implements the extensions finds no feature ids and cannot read the table. Floors and ceilings point at no row at all, and the meshes inside an opening or a furniture placement carry nothing (only their group node does).

Both extensions are Cesium vendor extensions in draft status (CesiumGS glTF fork, branch `3d-tiles-next`, `extensions/2.0/Vendor/`); the code comment that calls the spec "ratified" is wrong and is corrected.

## What Changes

- **Breaking for readers of the feature ids and the property table.** Feature ids move from nodes to mesh primitives: every primitive of a mesh that belongs to an element carries `EXT_mesh_features: { featureIds: [{ featureCount: 1, attribute: 0, propertyTable: 0 }] }` and a `_FEATURE_ID_0` vertex attribute (`FLOAT`, `SCALAR`) holding the row index on every vertex. No node carries `EXT_mesh_features` any more.
- Which meshes are tagged: a wall-face mesh → its `wallFace` row; floor and ceiling meshes → their `room` row (new); every mesh at or under an opening's group → the opening row; every mesh at or under a furniture placement's group → the placement row. `wall` rows carry no primitive (they are reached through `wallId` of their face rows). Meshes that name no element (wall joints, skirtings, the site) stay untagged.
- **Breaking for readers of the property table.** Every property is stored binary: a UTF-8 `values` bufferView and a `UINT32` `stringOffsets` bufferView (count + 1 offsets), each starting on an 8-byte boundary, appended after the exporter's own bufferViews. A missing value is the empty string, declared as `noData: ""` on every property except `class`, which is `required: true`. Every column is kept regardless of the document. `schema.version` is `"2"`, so a reader can tell the new shape from the old one (which had no version).
- The GLB's JSON and BIN chunks are padded to 8 bytes, as `EXT_structural_metadata` asks.
- The feature attribute is added on a GLB-only wrapper geometry (sharing every attribute and the index of the original); `exportGraph`, the USDZ export and the "geometries are shared with the live graph" invariant are unchanged in what they hand an exporter.
- A conformance test pins it: the Khronos glTF Validator (`gltf-validator`, already a pinned dev dependency) with zero errors and only judged warnings and infos, plus a strict Zod reader of both extensions written from the extension text (the validator does not support them).
- The scene document, its schema, the row set, the row order and the row contents (other than the empty-string encoding of a missing cell) do not change. Re-export stays byte-for-byte identical.

## Capabilities

### Modified Capabilities

- `glb-element-metadata`: how meshes point at their rows (primitive feature ids through an attribute; floors and ceilings included; the meshes inside opening and furniture groups included), how the table is stored (binary, `noData`, `schema.version`), and GLB chunk padding.

## Impact

- Changed: `src/render/export-graph.ts` (reports which cloned mesh belongs to which row instead of writing a node extension), `src/app/export-gltf.ts` (wrapper geometries with `_FEATURE_ID_0`, binary property table, 8-byte padding), `src/scene/metadata-table.ts` (class definition with `required`/`noData`/`version`, binary column encoding; comment corrected).
- Tests: `tests/component/export-glb-conformance.test.ts` and `glb-conformance.ts` (already written, red today); `tests/component/export-gltf.test.ts`, `tests/component/export-graph.test.ts`, `src/render/export-graph.test.ts`, `src/scene/metadata-table.test.ts` move off the node-level `constant` and the inline columns.
- Docs: CHANGELOG (Unreleased, Breaking), README `exportGlb` paragraph, `host-handle.ts` comment if it names the encoding.
- Not changed: USDZ export, the live viewer, bundles (`gltf-validator` stays a test-only dev dependency, checked by the budget and purity checks).
- Out of scope: stripping a foreign `_FEATURE_ID_*` attribute or `gltfExtensions` that a furniture asset might ship (no asset in the bank does); floor and ceiling rows of their own (reserved for a covering export).
