## MODIFIED Requirements

### Requirement: Lamp fields

Each lamp SHALL carry its placement id as `id`, its `index` among the placement's lights, the bulb's world position, its colour as authored («Original») and its intensity in candela, all as the collector gives them, and `power` in watts as the lighting module's `blenderPower` gives it for that intensity (4π × intensity: the radiant power of a radius-0 point lamp with the same inverse-square irradiance as three's point light). The bake lights and their schema SHALL use that one conversion and keep no copy of it. The live cut-off distance and shadow flag SHALL NOT be part of a lamp. A placement's light SHALL appear once: `(id, index)` is unique.

#### Scenario: Field mapping
- **WHEN** a collected light at (1, 2.5, −3) of 1.2 cd is mapped
- **THEN** the lamp has that id, index, position and colour, intensity 1.2 and power `blenderPower(1.2)`

#### Scenario: One conversion
- **WHEN** the bake lights' schema module is loaded
- **THEN** it exports no lamp power constant of its own

## ADDED Requirements

### Requirement: Ceiling lamps at the catalogue height

The bake lights SHALL build the scene without model URLs, so a ceiling-anchored lamp's body hangs by its catalogue height `dims[1]`. The live view hangs the model's body by its measured top once it arrives and moves the same lights onto it. The two SHALL agree as long as the catalogue keeps `dims` equal to the model's overall box (its measured top at `dims[1]` in the model frame); the bake does not check this at run time.

#### Scenario: Bulb before and after the model
- **WHEN** a ceiling lamp whose model's measured top equals `dims[1]` is built, its model arrives, and its bake lights are answered
- **THEN** the bake's bulb position equals the live bulb's world position before and after the model arrived
