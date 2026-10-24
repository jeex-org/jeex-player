# Design

## Context

Library `facts.pbr` is a strict object (`libraryPbrSchema` in `src/assets/project-manifest.schema.ts`), mirrored by the hand-written `LibraryPbr` type in `src/materials/finish-types.ts` and proved against it by the schema module's compile-time agreement check. `createLibraryMaterial` in `src/materials/library-material.ts` picks `MeshPhysicalMaterial` when any field of `PHYSICAL_FIELDS` is stated and copies those fields in `applyPhysical`. The material library stores the sheen lobe as `sheen` (intensity, a fraction) and `sheenColour` (`#rrggbb`, British spelling like every library colour); its producers also state `sheenRoughness` (a fraction) for fabrics but hold it back until readers accept it. This change is the reader half; the library's schema follows. Producers that take the sheen colour from the tint do not write the colour.

## Goals / Non-Goals

Goals: accept and draw `sheenRoughness`; give a stated sheen a visible colour when the record states none.

Non-goals: sheen maps; a lift or other transform of the tint; sheen on object slots (they draw a library material flat, and furniture carries its own sheen in its GLB); the bundled finish index, whose finishes state no sheen.

## Decisions

1. **Field.** `sheenRoughness: z.optional(unitSchema)` beside `sheen` and `sheenColour`; `readonly sheenRoughness?: number` in `LibraryPbr`. The same unit schema already refuses negatives, values above 1 and non-finite numbers. Zero is safe to draw: three clamps the sheen roughness to [0.0001, 1] in its shader. Absent, three's default of 1 applies; the legacy asset finish catalogue's own default of 0.6 belongs to that separate path and is not copied.
2. **Physical selection.** `sheenRoughness` joins `PHYSICAL_FIELDS`, so it selects the physical model alone, as `clearcoatRoughness` does. Alone it shows nothing (sheen 0), which keeps the rule "any physical field selects the physical model" without an exception.
3. **Sheen colour default.** three's `sheenColor` defaults to black and its sheen uniform is `sheenColor × sheen`, so a sheen with no colour is invisible. When `sheen` is stated and `sheenColour` is not, `applyPhysical` sets the sheen colour from `tintOf(draw)` (finish colour, else first suggested colour) and to white when the draw has no tint. The tint is used as the plain colour, without the tint recipe's map gain: the gain compensates a darkened map, and the sheen lobe samples no map. Alternatives: white for every material (greys a dark tinted fabric, against the producers' tint-taken colour); black (leaves the stated sheen invisible).
4. **No staleness.** A library material is created once per draw, and a change of finish colour builds a new draw, so the tint default always matches the drawn tint.
5. **Export.** three's GLB writer emits `KHR_materials_sheen` with `sheenRoughnessFactor` and `sheenColorFactor` whenever sheen is above 0; nothing in the export changes.

## Risks / Trade-offs

1. Materials already stored with `sheen` and no colour change look on room surfaces and openings: they gain the sheen they state. That is the intent of the record.
2. Producers that lift the tint-taken sheen colour see a slightly darker sheen in the player than in their own preview; the record carries no lift to reproduce.
