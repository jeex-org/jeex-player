## ADDED Requirements

### Requirement: Lights of a bake

The player SHALL answer, for a scene, the lights a light bake of it takes, as one document with the recipe `jeex-bake-lights@1`, the lighting standard's appearance version, the sun, the sky and the lamps. Every number SHALL be read from the player's own lighting standard, sun fitting and scene build, never restated. The module SHALL run in Bun without a DOM and SHALL NOT be part of the package's exports.

#### Scenario: Demo apartment
- **WHEN** the lights of the demo apartment are asked for
- **THEN** the answer passes the bake-lights schema

#### Scenario: Deterministic
- **WHEN** the lights of one scene are asked for twice
- **THEN** both answers are equal and serialise to the same JSON

### Requirement: Units

The answer SHALL use three.js r186 physical units in the linear Rec.709 working space and glTF world axes (+Y up, metres). The standard's colours SHALL be linearised as three's colour management does, and the answer SHALL fail while colour management is off.

#### Scenario: Colour management off
- **WHEN** three's colour management is off
- **THEN** the answer fails, naming colour management, instead of leaving the standard's colours in sRGB

### Requirement: Sun

The sun SHALL be the unit direction its light travels, opposite to the direction the live apartment rig is aimed at for the scene's `site` (the legacy direction when the scene has none), with the live sun light's linear colour and its intensity as the irradiance in W/m² on a surface facing it. No interior factor SHALL be applied.

#### Scenario: Same sun as the live rig
- **WHEN** the demo apartment, and the same apartment with a site (north 30°, morning), are lit by the live apartment rig and its sun-shadow preparation
- **THEN** each answer's sun direction equals the rig's sun-to-target direction, and its colour and strength equal the rig's sun light

### Requirement: Sky

The sky SHALL be recipe `jeex-sky-hemisphere@1`: uniform radiance `upper` over the upper hemisphere and `lower` over the lower one, split at the horizon without a blend, each the live hemisphere light's colour (sky and ground) times its intensity, divided by π, the values of the apartment rig as it is attached (walk mode dims the hemisphere at run time; that is not baked). The environment's diffuse, the walk's ambient floor and the editing fill light SHALL NOT be part of the sky.

#### Scenario: Hemisphere axis
- **WHEN** the live apartment rig is built
- **THEN** its hemisphere light points straight up, the axis the sky splits at

#### Scenario: Open up-facing plane
- **WHEN** an open up-facing plane is lit by the sky
- **THEN** its irradiance π·`upper` equals the live hemisphere light's irradiance on it

#### Scenario: Every normal
- **WHEN** planes tilted 0°, 40°, 90°, 130° and 180° from up are lit by the sky
- **THEN** each irradiance equals three's hemisphere irradiance for that normal within 0.1 %

### Requirement: The bank is named

`bakeLights` SHALL take the bank the live view of the scene resolves placements against as a required argument: `SHIPPED_BANK` for a scene drawn without a project, or a project's catalogue and library. A call without a bank SHALL be a type error and SHALL fail at run time. The scene SHALL be built by the player's own scene builder with that bank, as a live view builds it.

#### Scenario: No bank
- **WHEN** the lights are asked for without a bank
- **THEN** the answer fails, naming the bank

#### Scenario: The bank decides what builds
- **WHEN** the demo apartment is built with the shipped bank, and with a bank that resolves nothing
- **THEN** every placement builds a body, or none does

### Requirement: Lamps through the lamp-lights seam

The lamps SHALL be exactly the lamp lights `collectLampLights` (`render/lamp-lights.ts`) answers for the built scene, in its order (placements in scene order, then index), and nothing else. A bank builder's procedural bulb SHALL NOT be a lamp: it stays live on a baked shell. Until placements declare lights, the collector answers none and every answer has no lamps.

#### Scenario: Bank bulbs stay live
- **WHEN** the demo apartment, whose bank builders create point lights, is answered
- **THEN** the answer has no lamps

#### Scenario: Collected lamps
- **WHEN** a collector answers two lights of one placement and one of another
- **THEN** it was called once, with the built scene, and the answer lists the three in its order

### Requirement: Lamp fields

Each lamp SHALL carry its placement id as `id`, its `index` among the placement's lights, the bulb's world position, its colour as authored («Original») and its intensity in candela, all as the collector gives them, and `power` = 4π × intensity watts: the radiant power of a radius-0 point lamp with the same inverse-square irradiance as three's point light. The live cut-off distance and shadow flag SHALL NOT be part of a lamp. A placement's light SHALL appear once: `(id, index)` is unique.

#### Scenario: Field mapping
- **WHEN** a collected light at (1, 2.5, −3) of 1.2 cd is mapped
- **THEN** the lamp has that id, index, position and colour, intensity 1.2 and power 4π × 1.2

### Requirement: Bake-lights contract

The answer SHALL be judged by one Zod schema that refuses an unknown recipe or sky recipe, an unknown key, a sun direction that is not a unit vector, a negative colour, radiance or strength, a non-finite position, a lamp id that is not a UUID v7, an index that is not a non-negative integer, a placement light listed twice, and a power that is not 4π times the intensity, naming the field. The schema SHALL judge and never repair.

#### Scenario: Refusals
- **WHEN** a document has a lamp id that is not a UUID v7, or a power of 1.2 W for 1.2 cd
- **THEN** it is refused, naming `lamps.0.id` or `lamps.0.power`
