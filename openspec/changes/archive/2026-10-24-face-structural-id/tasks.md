# Tasks

## 1. Tests first

- [x] 1.1 `metadata-table.test.ts`: a face row has no `guid`/`ifcGuid`/`id` and exactly one row per face, matching its wall, side and room; every remaining `guid` is a UUID v7 from the document; face rows strictly ordered by `(wallId, side)`; the painted-face lookup by address. Run: red for the right reason.
- [x] 1.2 `structuralMetadataExtension` test: `guid`, `ifcGuid`, `id` declared `required: false`; the three columns are `null` exactly at face rows. Run: red.
- [x] 1.3 `tests/component/export-gltf.test.ts`: in the exported GLB, every face row's id cells are `null`, entity rows keep their UUIDs, there is one wall mesh per face row, each carries a feature id, and each resolves to the face row with its wall, side and room (through the heavy-run queue). Run: red.
- [x] 1.4 `uuid.test.ts`: `ifcGuid` tests on fixed UUID inputs, no `uuidV5`.

## 2. Code

- [x] 2.1 `metadata-table.ts`: union row type, no face id, structural face order, explicit column writer, header rewritten.
- [x] 2.2 `export-graph.ts`: comment and narrowing only.
- [x] 2.3 Remove `scene/guid.ts` + test, `uuidV5`, the namespace constants, the formatter, `shared/sha1.ts` + test, the two purity entries; rewrite the `uuid.ts` header.
- [x] 2.4 `dev/furniture-gallery.ts`: mint a UUID v7 per specimen per load.

## 3. Docs

- [x] 3.1 README `exportGlb` paragraph: entity rows keyed by the entity UUID, face rows addressed by wall, side and room.
- [x] 3.2 CHANGELOG Unreleased, Changed, marked Breaking.

## 4. Checks

- [x] 4.1 Fast tier `bash scripts/check.sh fast`; failed files re-run alone.
- [x] 4.2 Standard tier once at the end through the heavy-run queue. No screenshot baseline changes.
