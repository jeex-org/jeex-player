# Proposal

## Why

The material library approved a contemporary set of room surfaces: warmer plasters and limewashes, matte porcelain, glazed tiles with a clear coat, and eleven new finishes. The player's bundled finishes still show the previous set, and three of them (Cream stripes, Sage stripes, Bleached ash) are retired. Documents that already name the retired finishes must keep working without being rewritten.

## What Changes

1. Existing bundled finishes keep their ids and take their new library looks and names: Warm white, Oat, Olive and Clay limewash, Mocha (the former Graphite), Stacked white tile, White terrazzo with a clear coat, Cream limestone, Warm stone and Graphite porcelain; the four woods keep their scans. The default ceiling becomes a lime plaster in warm white.
2. Eleven new bundled finishes, with the ids the library gives: Pure white, Ink blue, Polished lime plaster, Sand microcement, Warm grey microcement, Honed travertine, White marble, Stone porcelain 60x60 and Teal zellige on walls; Herringbone oak and Dark oak herringbone on floors.
3. **Aliases.** Cream stripes, Sage stripes and Bleached ash become aliases of Warm white, Olive limewash and Natural oak. An alias id stays valid in documents, draws its target's current look when read, and is never rewritten by the player. The picker shows the target as the current choice and never offers the alias itself.
4. Library materials with a clear coat draw on the physical model with that coat (pinned by tests; the code already reads the fields).
5. `finish-maps/` is re-fetched from the final mapping with version changes accepted; the authoring script learns alias rows and validates them; the folder budget is re-measured; the generated table, `SOURCES.md` and the README follow.
6. `jeex-viewer/ops` exports `FINISH_ALIASES` (alias id to target id) and `FINISH_NAMES` (room finish id to display name), a public-API addition for editor hosts.
7. Demo interior presets move off the retired ids and are renamed after their palettes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `builtin-finishes`: no finish is kept any more; aliases resolve to their target; the new finishes and their placement; clear coat on bundled materials.
- `room-surface-textures`: the map of a rectangular tile is rectangular (longer side at the named size).
- `finish-selection`: the current finish and the scope actions of a surface that wears an alias.

## Impact

1. Code: `src/materials` (catalogue rows and aliases, ids, resolution), `src/ui` (picker current and scope, built-in footer), `src/assets/catalogue-slugs.ts`, `src/demo/demo-interiors.ts`, the authoring script and its index schema, the budget check.
2. Files: `finish-maps/` (new versions, removed versions, index, sources), `src/materials/builtin-library-data.ts` (generated), README, CHANGELOG.
3. Scene format and viewer options: unchanged; the public API gains two exports, `FINISH_ALIASES` and `FINISH_NAMES` in `jeex-viewer/ops`. Documents that name an alias validate and keep the alias.
4. The light-bake input hash does not cover bundled finish data and does not change; bakes of scenes that wear a changed finish should be made again.
5. Download size: the shipped folder grows with the new scans; a visitor still fetches only the finishes on screen.
