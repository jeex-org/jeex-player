# player-lamp-lights Specification

## Purpose
How the player builds a lamp's lights from its `lights` fact, keeps them at the bulb across the model upgrade, mirroring, scale and variant swaps, tints and marks them like other artificial lights, hangs ceiling bodies from the ceiling plane, and lists them for a light bake.

## Requirements

### Requirement: Lights are built on the first body

When a placement resolves to a variant with `lights`, the player SHALL build one three.js `PointLight` per entry as a child of the `dims` stand-in body (never of the placement group), at the authored position in the body's local frame: the authored colour, intensity `lampCandela(lumens)`, distance `cutoff`, decay 2. Each light SHALL be tagged artificial with its authored colour as «Original» and named `${placementId}-light`, then `${placementId}-light-<n>` for entry n ≥ 2.

#### Scenario: Stand-in is lit
- **WHEN** the fixture's table lamp is loaded and its GLB has not arrived
- **THEN** its stand-in body holds exactly one tagged `PointLight`, named `<placementId>-light`, intensity 1.2, distance 3, decay 2, at local position `[0, 0.443, 0]`

#### Scenario: No fact, no light
- **WHEN** a project object's variant has no `lights`
- **THEN** its placement group holds no light, on the stand-in and after the upgrade

#### Scenario: Several lights
- **WHEN** a variant carries three lights
- **THEN** they are named `<placementId>-light`, `<placementId>-light-2`, `<placementId>-light-3` in array order

### Requirement: No light without a fact

A variant without `lights` and a failure placeholder SHALL get no light. Fact lights SHALL be built only on the stand-in branch, so a body made by a bank builder keeps only the builder's own bulb.

#### Scenario: Bank lamp untouched
- **WHEN** a bank lamp placement is built by its builder
- **THEN** it holds exactly the builder's one bulb, unchanged

#### Scenario: Placeholder unlit
- **WHEN** a lit variant's placement falls back to the failure placeholder
- **THEN** the placeholder holds no light

### Requirement: Lights survive the GLB upgrade

When the GLB body replaces the stand-in, the player SHALL move the SAME light objects onto the GLB body with `add`, keeping their local position, name, tag, current tint and bake mark, so the light follows the drawn GLB's pose. The lights SHALL NOT be counted among the replaced bodies. `stripStageObjects` SHALL keep dropping every light the GLB file brings, and SHALL keep reporting `light-in-model`.

#### Scenario: Same object, same place
- **WHEN** a lit stand-in is upgraded to its GLB
- **THEN** the GLB body holds exactly one tagged light, it is the same object as before, its local position equals the authored position on both bodies, and its world position is unchanged within 1e-6 (both bodies share one pose today)

#### Scenario: Placement scale
- **WHEN** a lit lamp placement has scale 1.5
- **THEN** its light sits at 1.5 × the authored offset in the group's frame, and its distance and intensity are unchanged

#### Scenario: Tint and mark kept
- **WHEN** a lamp light is tinted to 2700 K and marked baked, then its body upgrades
- **THEN** its colour and its `jeexBaked` mark are unchanged, and «Original» still restores the authored colour

#### Scenario: Foreign light dropped
- **WHEN** the GLB file of a lit lamp carries its own `PointLight`
- **THEN** only the variant's own light remains under the group and `modelWarnings` includes `light-in-model`

### Requirement: Variant swap builds the new variant's lights

A variant swap SHALL remove the old variant's lights with its body and build the new variant's lights, or none when the new variant has none, then apply the current global temperature to them.

#### Scenario: Swap to an unlit variant
- **WHEN** a lit lamp is swapped to a variant without `lights`
- **THEN** the placement holds no light

#### Scenario: Swap under a temperature
- **WHEN** the global temperature is 3000 K and a lamp is swapped to a lit variant
- **THEN** the new light carries the 3000 K tint and «Original» restores its authored colour

### Requirement: Mirroring follows the body

Lamp lights SHALL sit under the body, so a mirrored placement mirrors its lights with its geometry.

#### Scenario: Off-axis light mirrored
- **WHEN** a placement mirrored on x holds a light authored at x = 0.2 in a body centred on x = 0
- **THEN** the light's position in the placement group's frame is x = −0.2

### Requirement: Bake marks find lamp lights

Lamp lights SHALL be found by the lightmap binding unchanged: the nearest ancestor with `userData.assetId` is the placement group, so `bindLightBake` marks a listed lamp's lights with `setLampBaked` and restores them on unbind.

#### Scenario: Listed lamp marked
- **WHEN** a light bake lists a lit lamp placement and is bound
- **THEN** that lamp's lights carry the baked mark, and unbinding restores their previous state

### Requirement: Fact lights carry their source

Every light built from a `lights` fact SHALL carry a source tag in its `userData` that says it came from the fact, together with its placement id, its index in the variant's `lights` and its authored `lumens`, `cutoff` and `shadow`. A bank builder's bulb SHALL NOT carry that tag. Moving a light across the GLB upgrade SHALL keep the tag.

#### Scenario: Tag on a fact light
- **WHEN** the fixture's pendant is built
- **THEN** its light's `userData` says source fact, index 0, lumens 600, cutoff 5.2, shadow false

#### Scenario: No tag on a bank bulb
- **WHEN** a bank lamp is built by its builder
- **THEN** its bulb carries no fact source tag

### Requirement: Collect lamp lights for the bake

The player SHALL export `collectLampLights(root: Object3D): CollectedLampLight[]` from `src/render/lamp-lights.ts`, a module that touches no DOM, returning one entry per light under `root` that carries the fact source tag and nothing for bank bulbs or any other light, in a stable order: placements in scene traversal order, then `index` ascending. `bakeLights`, the lightmap bake's own later work, reads these entries.

#### Scenario: Two lamps
- **WHEN** a scene holds the fixture's table lamp and pendant, and `collectLampLights` is called on its root
- **THEN** it returns two entries in placement order, the table lamp with intensity 1.2 and the pendant with intensity 1.8, both decay 2, each with its world position

#### Scenario: Tint ignored
- **WHEN** the global temperature is 2700 K and `collectLampLights` is called
- **THEN** each entry's `colour` is the linear value of the authored `#ffd9a4`, not the tinted colour

#### Scenario: Bank bulbs skipped
- **WHEN** a scene holds a bank lamp and a fact lamp
- **THEN** only the fact lamp's light is returned

#### Scenario: After the upgrade
- **WHEN** a lit lamp's GLB has arrived
- **THEN** `collectLampLights` returns the same entry as before the upgrade, position within 1e-6

#### Scenario: Mirrored placement
- **WHEN** a placement mirrored on x holds a light authored at x = 0.2
- **THEN** the entry's world position is the mirrored one

### Requirement: Collected entry fields

Each collected entry SHALL be a `CollectedLampLight` `{ placementId, index, position, colour, lumens, intensity, decay, cutoff, shadow }`, with `position` and `colour` typed `readonly [number, number, number]`: `placementId` from the group's `userData.assetId`; `position` world metres; `colour` the authored linear colour from the tag, never tinted; `intensity` `lampCandela(lumens)`; `decay` 2; the rest as authored, `shadow` false when absent.

#### Scenario: Fields of the pendant
- **WHEN** the fixture's pendant placement is collected
- **THEN** its entry has index 0, lumens 600, intensity 1.8, decay 2, cutoff 5.2, shadow false

### Requirement: Shadow hint carried, not cast

The player SHALL build lamp lights with `castShadow` false in this change, whatever the `shadow` hint says, and SHALL keep the hint on the light's `userData` for the quality tiers.

#### Scenario: Shadow hint true
- **WHEN** a light says `"shadow": true`
- **THEN** the built light does not cast shadows and its `userData` records the hint

### Requirement: Known costs and limits stated

The player's README SHALL state that adding or removing a lamp light recompiles materials once (a visible hitch on placing or swapping a lamp), that in walk and tour lamp lights feed the room grids and stop at their room's boundary while in the editing modes they reach through walls, that a lamp edit in walk re-bakes, the concave-room limit of `walk-room-lighting` where it stands, that the lumens are nominal (see `lamp-light-fact`), and the low-ceiling stand-in.

#### Scenario: README
- **WHEN** a reader looks up lamp lights in the player README
- **THEN** it names the recompile hitch, the room grids, the room boundary in walk and tour, the walls in the editing modes, the re-bake on a lamp edit, the concave-room limit where it stands, the nominal lumens and the low-ceiling stand-in

#### Scenario: Low-ceiling stand-in described
- **WHEN** a reader looks up ceiling lamps in the player README
- **THEN** it says that under a ceiling lower than 2.73 m the ceiling stand-in is shortened to the clamped drop while the GLB is not, and that the light follows the GLB

### Requirement: Ceiling bodies hang from the ceiling plane

A body that is not made by a builder (the `dims` stand-in and the delivered GLB) on a ceiling anchor SHALL be offset down by its own height inside the placement group, so its top sits at the ceiling plane: `top` = `dims[1]` for the stand-in, the measured bounding-box `max.y` for the GLB. Builder (bank) ceiling bodies SHALL stay unchanged. Lamp lights, children of the body, follow the offset.

#### Scenario: Pendant under a 2.65 m ceiling
- **WHEN** the pendant placement `01a15f1b-dbbd-7657-ab60-6f840ab91f11` (archetype `01a12fdf-14e8-7bc8-8007-8ba4894f374a`) (1.052 m tall, a project object without a builder) is loaded under a 2.65 m ceiling
- **THEN** the top of its stand-in box and, after the upgrade, the top of its GLB body sit at y 2.65 within 1e-3, the GLB spans about 1.60 to 2.65 m and not 2.65 to 3.70 m, and its light sits at about 1.66 m

#### Scenario: Stand-in and GLB agree
- **WHEN** a ceiling placement's stand-in is replaced by its GLB of the same height
- **THEN** both bodies occupy the same world box within 1e-3

#### Scenario: Bank ceiling light unchanged
- **WHEN** a bank pendant built by its builder is placed on a ceiling
- **THEN** its body's position and world box are exactly as before this change

### Requirement: Ceiling facts keep their meaning

The walk obstacle and plan facts and the layout lint of ceiling items SHALL keep their meaning after the ceiling offset, because they read `layout.mount` and the height, not the drawn origin.

#### Scenario: Walk and lint unchanged
- **WHEN** the walk obstacles, the plan facts and the layout lint are computed for a scene with ceiling items before and after the offset
- **THEN** their outputs are identical
