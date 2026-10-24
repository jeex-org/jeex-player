# Proposal

## Why

Five bundled finishes (Sage terrazzo, Warm limestone, Light ceramic, Graphite ceramic, White wall tiles) still draw generated textures because their library materials were not ready when the bundled finishes moved to library materials. The library now has them, with tile sizes that match each finish's tiles, so they can draw scanned surfaces like the other bound finishes.

## What Changes

1. The shipped `finish-maps/` folder is refreshed from the final mapping: the five finishes become bound to their library versions (Light and Graphite ceramic share one version, tinted differently), and their maps ship at 256, 512 and 768 px. The generated table follows.
2. Only Cream stripes and Sage stripes stay kept and draw their generated look.
3. The catalogue colour (`base`) of a bound finish is its library first-frame colour: Warm limestone takes its scan's average colour, Sage terrazzo, Light ceramic and White wall tiles move one step lighter (the tint times the recipe's gain), Graphite ceramic stays.
4. Sage terrazzo repeats every 1 m instead of 2.4 m; the tiled finishes keep their tile sizes (0.62, 0.625 and 0.3 m).
5. The folder budget is re-measured.

Every bound finish that was bound before keeps its version, tint and files unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `builtin-finishes`: which bundled finishes stay kept.

## Impact

1. Files: `finish-maps/` (four new versions, index, sources), `src/materials/builtin-library-data.ts` (generated), `src/materials/finish-catalogue.ts` (four `base` literals), `scripts/budget-check.ts` (budget), tests.
2. Public API, scene format, ids, names, picker order and the light-bake input hash: unchanged.
3. Download size: a scene showing one of these finishes fetches its maps at the device's size, as for the other scans.
