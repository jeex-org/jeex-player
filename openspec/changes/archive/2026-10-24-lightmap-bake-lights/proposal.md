# Proposal

## Why

A light bake replaces part of the live lighting on the apartment shell, so it is right only if it is made with the same lights the player would otherwise draw, in the same units. The bake tool today has the shell (`exportShellForBake`) but no statement of the lights: it would have to restate the lighting standard's numbers, the sun's fitting from the scene's site and the lamps the bank builders create, and any of them could drift from the player without notice.

## What Changes

- An internal module, `bakeLights(scene, bank)`, that answers the lights a bake of `scene` takes, read from the player's own sources: the sun (direction from the scene's `site` by the function the live rig is aimed with, colour and irradiance from the lighting standard, no interior factor), the interim sky (two uniform hemispheres split at the horizon that give every normal the live hemisphere light's irradiance), and the lamps through one seam, `collectLampLights` over the scene built as the live view builds it (placement id, index, bulb world position, intensity in candela, the equivalent radiant power in watts, authored colour). The bank the live view uses is a required argument. The environment's diffuse, the walk's ambient floor, the editing fill light and the bank builders' procedural bulbs are not part of it.
- A stub of the lamp-lights seam (`src/render/lamp-lights.ts`): the type of a declared lamp light and a collector that answers none until placements declare lights.
- The answer's contract as one Zod schema (`src/lightmap/bake-lights.schema.ts`) the bake tool mirrors, with a recipe id (`jeex-bake-lights@1`) and a sky recipe id (`jeex-sky-hemisphere@1`), and the factor between candela and watts named once.
- The sidecar gains an optional `lights` record (`recipe`, `standardVersion`, `skyRecipe`), required for an apartment bake (a calibration room has its own lights), so a bake says which lights it was made with.
- The shell export's finishes become a required option (`SHIPPED_FINISHES` or `projectFinishes(materials)`, the live project view's own composition, now shared): omitting the lookup while giving a project's materials painted a surface with the bundled finish under the same input digest.
- No public API, no viewer option, no scene schema change. Unbaked projects are unchanged.

## Capabilities

### New Capabilities

- `light-bake-lights`: the lights a light bake takes for a scene, their units and their contract.

### Modified Capabilities

- `light-bake`: the sidecar records the lights recipe; an apartment bake without it is refused.
- `light-bake-shell`: the export's finishes are named by the caller.

## Impact

- New: `src/lightmap/bake-lights.ts`, `src/lightmap/bake-lights.schema.ts` and their tests; `src/render/lamp-lights.ts` (stub, replaced by the lighting work that introduces light descriptions).
- New: `src/materials/project-finishes.ts` (the project finish composition, used by `src/app/project-wiring.ts` and the shell export).
- Changed: `src/lightmap/shell-export.ts` (required `finishes`) and its callers (tests, the development page, the component test); `src/lightmap/light-bake.schema.ts`, `light-bake.ts` (optional `lights`), `baked-shell.ts` (an apartment bake must carry it), `src/fixtures/shell-unwrap.ts` (the stand-in sidecar carries it).
- Consumer: the bake tool imports `bakeLights` from the player's source and records its recipe ids in the sidecar.
- Out of scope: light descriptions on placements and the collector's real body (the lighting work), the HDRI sky that will replace the interim recipe, spot and area lamps, run-time lamp switching, colour temperatures other than «Original».
