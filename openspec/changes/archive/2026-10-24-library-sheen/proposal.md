# Proposal

## Why

Library materials for cloth state a sheen lobe: an intensity, a colour and a roughness. The material factory already states a sheen roughness for its fabrics (cotton percale bedding, for one), but holds it back because no reader accepts it: the player knows the intensity and the colour, not the roughness, and its library schema is strict, so a project manifest that carried `sheenRoughness` would be refused as a whole. The reader goes first; the library then keeps and serves the field. Independently, a sheen stated without a colour draws nothing today, because three.js multiplies the intensity by a black default colour, and fabrics whose sheen colour is taken from their tint are stored exactly that way.

## What Changes

- Library `facts.pbr` accepts an optional `sheenRoughness`, a fraction in [0, 1]; out-of-range and non-finite values refuse the manifest.
- `sheenRoughness` is a physical field: alone or with others it selects `MeshPhysicalMaterial`, and it is drawn as that material's `sheenRoughness`. Absent, three's default (1) applies.
- A material that states `sheen` without `sheenColour` draws its sheen in its tint (the finish colour, else the first suggested colour), or in white when it has no tint; a stated `sheenColour` (`#rrggbb`, sRGB, taken in linear light like every other library colour) is used as before.
- The README's library material reference names the new field, its range and the sheen colour default.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-materials`: the PBR field list and the unit-interval ranges gain `sheenRoughness`.
- `room-surface-textures`: the physical fields that promote a material gain `sheenRoughness`; the sheen fields reach the physical material, with the tint or white as the sheen colour when none is stated.

## Impact

- `src/assets/project-manifest.schema.ts` (`libraryPbrSchema`), `src/materials/finish-types.ts` (`LibraryPbr`), `src/materials/library-material.ts` (`PHYSICAL_FIELDS`, `applyPhysical`) and their tests.
- `README.md` library material reference and `CHANGELOG.md`.
- Follow-up outside this repository: the material library's PBR schema gains `sheenRoughness` and its producers start sending it; until then no stored record carries it and only the sheen colour default changes what is drawn.
- No new dependency, no change to the bundled finishes (none states sheen), the GLB variant path or the legacy asset finish catalogue. GLB export carries the value through three's `KHR_materials_sheen` writer.
