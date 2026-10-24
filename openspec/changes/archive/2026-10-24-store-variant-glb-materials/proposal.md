# Proposal

## Why

In a loaded project, every object drawn from its own GLB loses the materials it shipped. The GLB's slot-named materials are replaced by the project's finish materials, which are flat generated surfaces (roughness 0.8, no metal, no clearcoat), so brass stops looking like metal and lacquered tops lose their coat. Library variants are finished products with fixed materials and no finish choice, so the replacement is never wanted for them.

## What Changes

- A variant that draws from its own GLB and has no procedural builder (every object of a project library) renders with the materials its GLB ships, unchanged: no project or bundled finish replaces any of them, and none is tinted.
- The finishes such a variant declares (`defaultFinishes`, variant `finishes`) and placement `finishes` overrides and `material` shortcuts on it stay readable data (the Replace picker's description and the resolved `finishes` keep them) but never dress its GLB.
- A GLB delivered for a shipped archetype that has a builder keeps today's slot dressing (`materialSlots` and the slot-name convention).
- The resolver's `baked` flag carries this rule; the README's project format note is corrected.

## Capabilities

### New Capabilities
- `glb-variant-materials`: which materials a GLB body of a placed object renders with, and what declared finishes mean for it.

### Modified Capabilities
None.

## Impact

- `src/assets/asset-resolver.ts` (`isBakedVariant`), its tests, and a new loader test over a project scene that repacks the committed fixture GLB with physical materials in memory.
- README «Project format» note on baked variants.
- No change to the manifest schema, the scene schema, the public API or any other module.
