## 1. Red test and review

- [x] 1.1 Conformance test and strict reader (`tests/component/export-glb-conformance.test.ts`, `glb-conformance.ts`), red on the rebased branch for the right reasons (BIN chunk padded to 4, node-level feature ids, inline columns, no primitive resolves)
- [x] 1.2 Design review round answered (rework, four findings accepted); decisions amended; strict reader checks offset alignment and exact count
- [x] 1.3 Before/after format sent to the orchestrator before the implementation commit

## 2. Feature ids

- [x] 2.1 Red unit tests (`src/render/export-graph.test.ts`): `exportGraphWithRows` maps wall-face, floor, ceiling, opening and furniture meshes (inherited through groups) to their rows; no `userData.gltfExtensions` anywhere; geometries still shared
- [x] 2.2 `exportGraphWithRows` and the extended row lookup; `exportGraph` returns its graph
- [x] 2.3 Red component tests: `tests/component/export-gltf.test.ts` reads `_FEATURE_ID_0` on primitives instead of node `constant`, and its layout test expects the canonical exporter views then 8-byte-aligned metadata views; `tests/component/export-graph.test.ts` reads `exportGraphWithRows().meshRows`
- [x] 2.4 Wrapper geometries with `_feature_id_0` in `exportGlb` (caches per geometry+row and row+vertex count)

## 3. Property table

- [x] 3.1 Red unit tests (`src/scene/metadata-table.test.ts`): class with `required`/`noData`/`version`, binary columns decode to the rows, empty cells as `""`, an all-empty optional column left out of the table, no table for zero rows
- [x] 3.2 Binary table writer; comment "ratified" corrected
- [x] 3.3 `patchGlbJson` appends the table blocks 8-byte aligned and pads both chunks to 8

## 4. Docs and checks

- [x] 4.1 CHANGELOG Unreleased (**Breaking**), README `exportGlb` paragraph, `host-handle.ts` comment
- [x] 4.2 Conformance test green; re-export byte-identical; no screenshot baseline changes
- [x] 4.3 Budget and purity: `gltf-validator` in no library or IIFE bundle
- [x] 4.4 Fast tier, the changed component files, one standard tier through the heavy queue
