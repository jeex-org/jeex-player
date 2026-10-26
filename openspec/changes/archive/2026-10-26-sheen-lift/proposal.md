# Proposal

## Why

A sheen stated without its own colour takes the draw's tint lifted toward white by a fixed 0.2. Dark dyed pile (chenille, velvet) throws a much lighter grazing sheen than that: at 0.2 the sheen lobe of a dark chenille or velvet has almost nothing to show, and the material library's quality check holds eleven such designs. The lift is a property of the fibre, so the material states it.

## What Changes

- `facts.pbr` accepts an optional `sheenLift`, a fraction from 0 to 1.
- A sheen stated without `sheenColour` takes the tint lifted toward white by `sheenLift`, or by 0.2 when it is absent, as today. A stated `sheenColour` still wins, and `sheenLift` beside it changes nothing.
- README's material facts and the CHANGELOG say so.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-materials`: `facts.pbr` accepts `sheenLift` in the unit interval.
- `room-surface-textures`: the sheen lobe's lift is the material's `sheenLift`, 0.2 when absent.

## Impact

`src/assets/project-manifest.schema.ts`, `src/materials/finish-types.ts` (`LibraryPbr`), `src/materials/library-material.ts` (`applyPhysical`), their tests, README, CHANGELOG. The manifest schema is strict, so this player must be the one embedded everywhere before any published material carries the field. Materials without the field draw exactly as before.
