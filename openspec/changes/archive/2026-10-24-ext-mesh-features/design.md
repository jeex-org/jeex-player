# Design

## Context

`exportGlb` (`src/app/export-gltf.ts`) builds a throwaway scene, clones it through `exportGraph` (`src/render/export-graph.ts`), runs three's `GLTFExporter` (r186) and patches the GLB JSON afterwards (`patchGlbJson`: canonical bufferView order, then the root `EXT_structural_metadata` and `extras.jeex`). `exportUsdz` uses the same `exportGraph`. The metadata rows come from `metadataTable` (`src/scene/metadata-table.ts`), a pure function of the document and the solved plan, in a total order.

The extension text is the CesiumGS glTF fork, branch `3d-tiles-next`, `extensions/2.0/Vendor/EXT_mesh_features` and `EXT_structural_metadata` (both "Status: Draft"). This file states the decisions the implementation follows.

## Goals / Non-Goals

Goals: a file a reader of both extensions can use (feature ids on primitives, a binary table), pinned by the Khronos validator plus a strict reader; byte-identical re-export; no change to USDZ, the live viewer, the scene schema or the bundles.

Non-goals: rows for floors or ceilings of their own (a later covering export), stripping a foreign `_FEATURE_ID_*` a furniture asset might ship, the node-level JSON metadata form the newer draft also allows.

## Decisions

### 1. Feature ids: a constant `_FEATURE_ID_0` attribute per primitive

With neither `attribute` nor `texture`, a vertex's feature id is its index and `featureCount` must equal the vertex count, so "this whole primitive is row N" needs an attribute. `_FEATURE_ID_0` is `FLOAT` (`Float32Array`): a vertex attribute is padded to a 4-byte stride by `GLTFExporter` anyway, so `UNSIGNED_SHORT` saves nothing and caps rows at 65 535; `UNSIGNED_INT` is a validator error for vertex attributes; `FLOAT` is exact to 2^24. The set is `{ featureCount: 1, attribute: 0, propertyTable: 0 }`: no `nullFeatureId` (every vertex has a row), no `label`.

The attribute is named `_feature_id_0` on the geometry; `GLTFExporter` upper-cases custom names that start with `_` and keeps them as they are (`_FEATURE_ID_0`), and keeps a `Float32Array` as `FLOAT`.

### 2. Who tags what: `exportGraph` reports, `exportGlb` wraps

`exportGraph` no longer writes `userData.gltfExtensions` (a node-level extension is not conformant, and the exporter would copy any other key into `extras`). It gains a sibling, `exportGraphWithRows(root, rows): { graph, meshRows: ReadonlyMap<THREE.Mesh, number> }`, mapping each cloned mesh to its row; `exportGraph` returns `exportGraphWithRows(...).graph`, so `exportUsdz` and every other caller see the same graph as today minus the old extension.

A mesh's row is the row of the nearest node at or above it that names an element (`rowIndexFor` extended): `surface: 'wall'` + face key → `wallFace` row; `surface: 'floor'` or `isCeiling` + `roomId` → `room` row (new); `surface: 'opening'` + `openingId` → opening row; `assetId` → placement row. The opening and furniture tags sit on group nodes, so their meshes inherit them; a node that names an element resets the inheritance for its subtree. The test's `meshesOf` walks the same rule from the JSON side.

In `exportGlb` only, each tagged clone mesh gets a wrapper `BufferGeometry` in place of its geometry: the same attribute objects (by reference), the same index, the same groups and draw range, plus `_feature_id_0`, and `userData = { gltfExtensions: { EXT_mesh_features: … } }` and nothing else (the original geometry's `userData` would otherwise land in `extras` of every primitive). `GLTFExporter` copies a geometry's `userData.gltfExtensions` onto each primitive it writes for that geometry (`serializeUserData(geometry, primitive)` per group), so multi-material meshes are covered. Because the attribute objects are shared, the exporter's per-attribute accessor cache keeps writing each vertex buffer once.

Caches, so the file does not grow beyond the feature attribute itself: one wrapper per (original geometry, row), so two meshes of one placement sharing a geometry and material still dedupe to one glTF mesh; one `_feature_id_0` attribute per (row, vertex count), so equal pairs share an accessor. Wrappers are created on the clone only, never on the builder's live meshes, and are disposed with the export (they own nothing but the feature attribute).

The "geometries are shared with the live graph" invariant of `exportGraph` stays true: the wrapping happens after it, in the GLB path.

### 3. Binary property table

`structuralMetadataExtension(rows)` is replaced by a writer that returns the JSON object and the byte blocks to append: for each of the twelve properties, a UTF-8 `values` block and a `stringOffsets` block (`UINT32`, `count + 1`), the property written as `{ values, stringOffsets, stringOffsetType: 'UINT32' }` with bufferView indexes filled in by `patchGlbJson`. Missing values are written as the empty string; the class declares `noData: ""` on every property except `class` (`required: true`; `noData` is not allowed on a required property). No real value is ever empty (UUIDs, IFC GUIDs, `L`/`R`, opening types, finish ids), so the sentinel never shadows data. The class always declares all twelve properties; the table writes every property that has at least one value and leaves out an optional property whose every cell is empty (core glTF forbids a zero-length bufferView, and a reader treats an omitted optional property as all `noData`). `class` is never empty, so it is always written. `schema.version: "2"` (the old shape had none).

`STRING` and not `ENUM` for `class` and `side`: no gain for this table and more format to get wrong.

### 4. Byte layout and determinism

`patchGlbJson` already canonicalises the exporter's bufferViews into document order. The table's blocks are appended after them in a fixed order (property order, then `values` before `stringOffsets`), each starting on an 8-byte boundary of the BIN chunk, so "accessors before images" and the canonical order hold and the bytes are a function of the document. The JSON chunk is padded with spaces and the BIN chunk with zeros to a multiple of 8; `buffers[0].byteLength` is the padded BIN length. `EXT_structural_metadata` requires a property table's `count` to be at least 1, so a document with no element rows gets the schema and no `propertyTables` (today it writes `count: 0`; the unit test that pins that moves to the new rule).

### 5. Conformance test

Review round amendment: the strict reader also checks that a `stringOffsets` bufferView starts on a multiple of its offset width and holds exactly `count + 1` offsets (both from the extension text; it accepted a misaligned or over-long offset array before).

`tests/component/export-glb-conformance.test.ts` (written first, red on today's export) runs in the browser tier: `gltf-validator` on the exported demo apartment (zero errors; warnings and infos only from a judged list with reasons; the exact list of unsupported extensions), 8-byte chunks, the strict reader `tests/component/glb-conformance.ts` with no finding, every element primitive resolving to its row, and from the row side every non-wall row reached. The strict reader is deliberately stricter than the reference validator in one place, stated in its header: the distinct ids of an attribute must equal `featureCount` (the spec text), where the reference only fails when they exceed it.

`gltf-validator` stays a dev dependency imported only by tests; the budget and purity checks confirm it reaches no library or IIFE bundle.

### 6. Tests that move

`tests/component/export-gltf.test.ts`'s layout test (every bufferView follows the previous one after 4-byte rounding) becomes: the exporter's canonical bufferViews in that layout, then the metadata bufferViews each on an 8-byte boundary, and `buffers[0].byteLength` equal to the padded BIN chunk. `tests/component/export-graph.test.ts` and `src/render/export-graph.test.ts` read `exportGraphWithRows().meshRows` (the graph carries no wrapper); serialized primitive checks (`_FEATURE_ID_0`, `EXT_mesh_features` on primitives) live in the `exportGlb` tests.

## Review round

An independent review, 2026-10-24, asked for a rework with four findings, all accepted: (1) all-empty optional columns are left out of the table instead of writing a zero-length bufferView (the demo's `libraryId` is empty in every row); (2) the strict reader checks offset alignment and the exact offset count; (3) the layout and graph tests are migrated as in decision 6; (4) the delta modifies "Rows of the element table" so an empty document writes no table. The review confirmed the feature id set, the `FLOAT` attribute, the exporter behaviour the design relies on (extensions copied to every primitive, `_FEATURE_ID_0` naming, `FLOAT` kept, mesh and accessor dedupe, UUIDs never serialized), that the demo reaches every non-wall row, and the `required`/`noData`/schema id/version/padding choices.

## Risks / Trade-offs

1. File size: one `FLOAT` per vertex of every tagged mesh (about 4 bytes per vertex; the demo apartment's tagged vertices are a small part of a file dominated by textures). Accepted: it is the only conformant encoding of a per-primitive id.
2. Readers of the old shape (node `constant`, inline columns) break. Nobody known reads them; CHANGELOG marks it **Breaking**, and `schema.version` tells the two apart.
3. A furniture asset that ships its own `_FEATURE_ID_0` or a geometry `gltfExtensions`: GLTFLoader loads the attribute as `_feature_id_0`, which the wrapper overwrites, and the wrapper's `userData` replaces the geometry's, so neither reaches the export. A `_FEATURE_ID_1` or higher would ride along unreferenced; no asset in the bank ships one.

## Migration

None for documents. A reader of the table switches from inline arrays to the extension's binary rules and from `null` to `noData`; a reader of feature ids reads `_FEATURE_ID_0` on primitives.
