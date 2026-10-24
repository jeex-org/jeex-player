# Design

## Context

`metadataTable(scene, plan)` builds the rows; `structuralMetadataExtension(rows)` turns them into the root `EXT_structural_metadata` object, with values inline as JSON arrays and `null` for an absent optional value (a documented deviation from the binary layout of the extension); `exportGraph` tags every mesh with the index of its row; `exportGlb` writes both. Entity rows use the entity's own UUID. Face rows used a UUID v5 derived from the face's room, wall and side, which this change removes.

## Goals / Non-Goals

**Goals:**
1. No id in the export that the viewer derived or minted.
2. Face rows addressed by data already in the row.
3. Byte-for-byte deterministic export kept.

**Non-Goals:**
1. Per-face UUIDs in the scene document.
2. An IFC writer. When one is built it needs an `IfcRoot.GlobalId` for every face it emits as an element; as the owner of the IFC file it writes it may mint them at write time, or its caller passes them in. That is its own design.
3. Binary property-table encoding, or the `EXT_mesh_features` placement and `constant` field, which deviate from the ratified extension independently of this change.

## Decisions

### The table shape, before and after

The class `jeexElement` keeps its twelve properties in the same order; only the three id properties change their declaration:

| Property | Before | After |
|---|---|---|
| `guid` | `{ type: STRING }` | `{ type: STRING, required: false }` |
| `ifcGuid` | `{ type: STRING }` | `{ type: STRING, required: false }` |
| `class` | `{ type: STRING }` | unchanged |
| `id` | `{ type: STRING }` | `{ type: STRING, required: false }` |
| `roomId`, `wallId`, `side`, `openingType`, `assetId`, `libraryId`, `variantId`, `finish` | `{ type: STRING, required: false }` | unchanged |

A wall-face row, before:

```json
{ "guid": "c09c1625-705f-534e-8af2-608f3a350d16", "ifcGuid": "30d1ObS5zJJehoO8ywDGqM", "class": "wallFace",
  "id": "c09c1625-705f-534e-8af2-608f3a350d16", "roomId": "<room uuid>", "wallId": "<wall uuid>", "side": "L",
  "openingType": null, "assetId": null, "libraryId": null, "variantId": null, "finish": "<finish uuid or null>" }
```

after:

```json
{ "guid": null, "ifcGuid": null, "class": "wallFace",
  "id": null, "roomId": "<room uuid, or null on the facade>", "wallId": "<wall uuid>", "side": "L",
  "openingType": null, "assetId": null, "libraryId": null, "variantId": null, "finish": "<finish uuid or null>" }
```

(Shown per row for reading; the file stores one array per property.) Entity rows are unchanged.

Face address: `(wallId, side)`. It is unique because every side of a wall is one half-edge of the plan graph and bounds exactly one face. `roomId` stays beside it as a cross-reference (the room the face is seen from), `null` on the facade.

Row order: class rank as before; entity rows by `id`; face rows by `wallId`, then `side`, compared ordinally (`<`). Face row indexes change against the previous release; entity rows keep their relative order. The previous entity comparator (`localeCompare`) is left as is to keep entity row order unchanged.

### Types

`ElementRow = EntityRow | WallFaceRow`. `EntityRow` has `guid`, `ifcGuid`, `id` and a `class` that is any `ElementClass` but `wallFace`; `WallFaceRow` has `class: 'wallFace'`, required `wallId` and `side`, optional `roomId` and `finish`, and no id fields. The column writer reads each column by name through one explicit accessor rather than `keyof` the union (which would hold only the shared keys). The types are not exported from any public entry point; their declarations ship only because the library's import graph reaches the module.

### `null` rather than `noData` or a second table

Missing values already travel as inline `null` in every optional column; the id columns follow the same rule. A future binary writer would declare `noData: ""` on every optional string column at once. A second class and table for faces was rejected: it breaks the same readers and adds table selection.

### Removed code

`scene/guid.ts` (`faceGuid`, `JEEX_GUID_NAMESPACE`) and its test; `shared/uuid.ts` loses `uuidV5`, `UUID_NAMESPACE_DNS`, `UUID_NAMESPACE_URL` and the UUID formatter, keeping `ifcGuid` and its parser; `shared/sha1.ts` and its test (its only user was `uuidV5`); the two entries in the purity inventory. The `ifcGuid` tests take fixed UUID inputs.

### Dev gallery

The furniture gallery is the author of its own throwaway document, so it mints one UUID v7 per specimen when the page loads (timestamp plus random bits from `crypto.getRandomValues`). Nothing looks a placement up by id.

## Risks / Trade-offs

1. A reader that keyed overrides on face GUIDs loses them; it must key on `(wallId, side)`. Marked Breaking in the changelog; no such reader exists in this repository.
2. A reader that treats `guid` as a mandatory key must skip or special-case `null`. The schema now says the property is optional.
