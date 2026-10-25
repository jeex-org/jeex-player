# Proposal

## Why

The Cream limestone scan (ambientCG Tiles143) shows chalk digits and black pits that read as dirt in walk. The material library moved the finish to a honed Poly Haven marble_01 scan tinted warm cream, under the same finish id. The player's bundled copy still ships the old scan.

## What Changes

1. `finish-maps/` is re-fetched from the library's room-finish mapping with `--update`; only the Cream limestone entry changes: a new library version (marble_01 at 1.5 m real size, tint `#dcc8a4`, roughness about 0.59) replaces the Tiles143 version, whose maps leave the folder.
2. The generated table `src/materials/builtin-library-data.ts` and `finish-maps/SOURCES.md` follow.
3. The catalogue row of Cream limestone keeps its id and name; its `base` follows the new first-frame colour.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `builtin-finishes`: the Cream limestone floor is a continuous honed stone at the scan's real size instead of a grid of 0.62 m tiles.

## Impact

1. Files: `finish-maps/` (one version replaced), the generated table, `SOURCES.md`, the limestone row of `src/materials/finish-catalogue.ts`.
2. Scene format, viewer options and the public API: unchanged. Documents painted with Cream limestone keep the id and draw the new look.
3. The light-bake input hash does not cover bundled finish data; bakes of scenes that wear Cream limestone should be made again (the demo apartment carries no light bake).
