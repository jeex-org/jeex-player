# Proposal

## Why

The player's built-in room finishes (nine floors, eight walls and the default ceiling paint) are drawn by canvas generators and look flat next to scanned materials, which reflect light naturally. The player already draws library materials for projects that ship them; a scene without a project should get the same quality from its built-in finishes.

## What Changes

1. Every built-in floor and wall finish that the library mapping binds, and the default ceiling, renders a library material: a CC0 scan with albedo, normal and roughness/occlusion maps, or a parameter-only material for a uniform paint. Each finish keeps its id, its name and its place in the picker; documents do not change. A finish without a chosen material yet (marked kept in the index) keeps its generated look.
2. The maps ship beside the player file in a `finish-maps/` folder (WebP at 256, 512 and 768 px, an index with hashes and versions, a source and licence list). The player fetches a finish's maps only when a scene shows it, at the size its device class asks for.
3. A project material with the same id still wins over the built-in one.
4. Picker swatches of built-ins show the shipped albedo of a scan or the flat library colour; a bound built-in finish is no longer drawn by a canvas generator. The generators stay in the code for the object bank.
5. An authoring script refreshes the folder from pinned library versions and regenerates the player's table; builds and tests never reach a store.
6. GLB/USDZ export writes built-in room surfaces in their flat library colour, as it already does for project library materials.

## Capabilities

### New Capabilities

- `builtin-finishes`: how the bundled room finishes resolve to library materials, where their maps come from, how they load and fail, how they appear in the picker, and what the shipped folder must hold.

### Modified Capabilities

None.

## Impact

1. Code: `src/materials` (built-in table, resolution), `src/geometry/shell-paint.ts` and `library-surface.ts`, `src/app/scene-mount.ts` and `viewer-app.ts` (one built-in texture source per viewer), `src/ui` (swatches, preset chips), a build plugin beside the Basis transcoder plugin, an authoring script, the budget check.
2. Files: a new tracked `finish-maps/` folder, emitted into the demo build (and so the player site) and `dist-lib`, and left out of the npm package.
3. Public API, scene format and viewer options: unchanged. The `ops` entry does not grow. The light-bake input hash is unchanged.
4. An npm consumer, or a host that re-bundles the ES entry, copies `finish-maps/` next to the player file it serves (a documented step); without it built-in surfaces stay flat in their library colour.
