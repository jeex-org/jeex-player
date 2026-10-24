# Proposal

## Why

A lamp that arrives in a baked project is dark: a project object has a GLB and no builder, and neither its `dims` stand-in nor its GLB carries a light, so every lamp of a baked project renders unlit while the same lamp from the asset bank glows. A lamp's light has to become a fact of its variant, authored once by whoever bakes the project and carried to the player. Separately, a ceiling body that no builder made (the stand-in and the delivered GLB) stands UP from the ceiling plane instead of hanging from it: a 1.052 m pendant under a 2.65 m ceiling is drawn from 2.65 to 3.70 m.

## What Changes

- New optional variant fact `lights` in the project manifest: 1 to 4 point lights per variant, each `{ kind: 'point', position, colour, lumens, cutoff, shadow? }` in the variant's model frame; strict, a discriminated union on `kind` so spot and area lights can follow without a break. No ids on lights. `formatVersion` stays 2; every existing manifest stays valid. The scene schema does not change.
- One unit conversion in `jeex-viewer/lighting`: `lampCandela(lumens)` and `blenderPower(candela)` in `src/lighting/lamp-units.ts`, and the constant `LIGHTING_STANDARD.lamp.exposure`, calibrated so 400 lm reads as the bank table lamp's 1.2 cd. `LIGHTING_STANDARD_VERSION` stays 1.
- Ceiling bodies that are not builder-made hang from the ceiling plane: the stand-in and the GLB are offset down by their own height inside the placement group. Bank (builder) bodies are unchanged.
- The resolver carries the fact; `AssetLoader` builds tagged point lights under the stand-in body; the GLB upgrade moves the same light objects onto the GLB body; a variant swap builds the new variant's lights; mirroring, the global light temperature and the lightmap bake marks work on them unchanged.
- `collectLampLights(root)` (`src/render/lamp-lights.ts`, no DOM) lists every fact light in world space with its authored linear colour and candela, for the lightmap bake. Bank builder bulbs are not collected.
- Not in this change: lamps feeding the walk probe grid and per-room gating against light through walls (the follow-up «lamp scope»); spot and area lights, emissive bulb slots, IES, a run-time lamp budget; the bake of lamp light itself.

## Capabilities

### New Capabilities

- `lamp-light-fact`: the shape, frame, units, conversion and validation of the `lights` fact.
- `player-lamp-lights`: how the player builds, upgrades, swaps, mirrors, tints, marks and collects lamp lights, and how non-builder ceiling bodies hang.

### Modified Capabilities

None.

## Impact

`src/assets/project-manifest.schema.ts`, `asset-types.ts`, `asset-resolver.ts`, `src/geometry/asset-loader.ts`, `scene-builder.ts`, new `src/render/lamp-lights.ts`, new `src/lighting/lamp-units.ts` and its export from `src/lighting/index.ts`, `lighting-standard.ts` (`lamp.exposure`), a new fixture folder `tests/fixtures/project-lamps/`, README, CHANGELOG. No new dependency.
