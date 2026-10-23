# Proposal

## Why

The viewer draws room surfaces only with its compiled finishes, and a project `pbr` material with maps is drawn as a flat colour. A project must be able to dress floors, walls, ceilings, facades and trim with library materials (scanned textures or parameter-only materials) that it carries in its own manifest, drawn with no catalogue service access, and a producer must be able to name the surface a paint goes to instead of having the viewer infer it. Catalogue bakes and editor hosts already write and read the agreed wire shape and wait for the viewer, which goes first in every schema change.

## What Changes

- **Project manifest**: a new strict `library` member of a project material, next to `pbr` and `generator`: `{ versionId, kind: 'scan' | 'parameters', facts, maps }`, with every cross-field rule of the agreed contract (colour map by colour mode, `arm` or `roughness` never both, colour space by role, one size set per material, exact `tex/<versionId>/<role>.<px>.webp` paths, value ranges, no duplicate paths) checked at validation, with no defaults or transforms. `apply` gains `ceiling`, `facade` and `trim`. A manifest listing more than 512 texture files is refused.
- **Scene schema 2.3** (2.2 is still read): one finish value, `FinishRef = uuid | { material, colour?, rotation? }`, wherever a finish UUID stands today; the object form always carries a modifier and names only a `library` material; `RoomFinishes` gains `ceiling` and `trim`; `facade` and `faces[].finish` take a `FinishRef`. The value is carried whole through validation, topology remap, presets, export and repaint. The viewer never rewrites a document.
- **`set_material`** gains an explicit form `{ surface, room?, face?, material, colour?, rotation? }`. The surface must be in the material's `apply`; `face` is allowed only for `wall` and `facade`. The existing `target` form is kept unchanged, and only it infers the surface.
- **Textured room surfaces**: library materials draw with their maps on room floors, walls, ceilings, facades and trim. The first frame is a flat colour; maps arrive through a capped, cached, reference-counted texture source sized by device class. Sampling, image orientation, metre UVs (new for trim and wall reveals), grain alignment, tint, normal and ARM wiring are fixed by the viewer.
- **Live texture resolver**: a new host viewer option (`resolveTexture`) turns a logical texture path into a fetchable URL, called lazily per size loaded, so an editor host can serve signed URLs while the manifest keeps its one relative-path shape.
- **Texture limits** in the shared limits module: `MAX_TEXTURE_FILE_BYTES` (2 MiB per file, cancelled at fetch), `MAX_PROJECT_TEXTURE_BYTES` (48 MiB of bytes actually fetched per document, after which flat colours stay) and `MAX_PROJECT_TEXTURE_FILES` (512 listed files, refused at validation).
- **Context restore** remounts with the document's project options, fixing a defect where a restored context lost the project's materials, catalogue and models; textures rebuild from kept bytes.
- **Swatches and selection descriptions** list the project's library materials for the picked surface.
- Legacy compiled finishes, generators, `pbr` flat drawing and `Room.floorMaterial` keep rendering as before.

## Capabilities

### New Capabilities

- `project-materials`: the `library` member of a project manifest material, its cross-field validation rules, its value ranges and the listed-file limit.
- `scene-finishes`: the finish value of a scene document (`FinishRef`), room ceiling and trim finishes, scene schema 2.3, which material may dress which surface, and both forms of the `set_material` operation.
- `room-surface-textures`: how room surfaces draw library materials: texture fetching and its limits, the live resolver option, size choice, sampling, orientation, UVs, first frame, tint, map wiring, resource release and context restore.
- `finish-selection`: which finishes the built-in swatches and the host selection descriptions offer for a picked surface.

### Modified Capabilities

None.

## Impact

- Manifest schema and types (`assets/`, `materials/` types), scene types, scene Zod schema and validator, scene operations, registries and the finish remap.
- Shell geometry: per-room ceiling and trim materials, metre UVs for trim and reveals; shell paint stops disposing maps it does not own.
- New texture source and library-material factory in the materials layer; scene mount and context recovery; project wiring.
- Viewer options gain one host-object option (not in the query/attribute option table, not in the published viewer options JSON schema); the published scene JSON schema changes with 2.3.
- Shared limits gain three exported constants that catalogue bakes check by name.
- Selection options read the project library.
- Tests: unit tests per rule, browser tests for the flat first frame under a delayed response and for loaded-texture tint, UV scale, grain, normal direction and ARM. Bundle budgets are rechecked; no new runtime dependency.
- Out of scope: texture sharing across GLBs, KTX2, texture telemetry stages, editor and catalogue work, removing the legacy finish catalogue.
